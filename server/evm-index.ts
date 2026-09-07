/**
 * Shield server, EVM edition (HyperEVM / Anvil).
 *
 * Same job as server/index.ts for the Solana program: index the vault's
 * events and the USDC that comes back to it, derive behaviour, evaluate the
 * user's own loss rule, sign a verdict with the monitor key and relay it,
 * and serve the API the app reads. Enforcement never lives here.
 *
 *   SHIELD_CHAIN=evm bun run server/evm-index.ts
 *
 * Config comes from the environment or .shield/demo-state.evm.<network>.json.
 */
import { createPublicClient, createWalletClient, getAddress, http, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Store, type VerdictRecord } from "./store";
import { deriveProfile, serialize, type BehaviourProfile, type Flow } from "./behaviour";
import { assess, REASON_LABEL, type Assessment, type PolicyView, type VenueLoss } from "./policy";
import { analyseHyperliquid, fetchFills, type HlNetwork } from "./hyperliquid";
import { describeSubstreams, resolveSubstreams } from "./substreams-config";
import { runSubstreamsSource } from "./substreams-source";
import { SHIELD_VAULT_ABI } from "../client/abi/ShieldVault";
import { MOCK_USDC_ABI } from "../client/abi/MockUSDC";
import { MOCK_CORE_DEPOSIT_ABI } from "../client/abi/MockCoreDepositWallet";
import { evmCalls, readProposals, readRegistry, readVault, viemChain, type EvmConfig } from "../client/evm";
import { evmNetworkName, readEvmState } from "../client/evm-state";
import { evidenceHashOf, toHex } from "../client/verdict";
import { OwnerKind, type ProposalView, type RegistryView, type VaultView } from "../client/views";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const PORT = Number(process.env.SHIELD_PORT ?? 8787);
// Chain first, because the demo state file is keyed by network.
const legacyState = existsSync(`${STATE_DIR}/demo-state.evm.json`) ? (JSON.parse(readFileSync(`${STATE_DIR}/demo-state.evm.json`, "utf8")) as Record<string, string | number>) : {};
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || legacyState.chainId || 31337);
const demoState = readEvmState(STATE_DIR, evmNetworkName(CHAIN_ID)) as Record<string, string | number>;
const RPC_URL = process.env.EVM_RPC_URL || String(demoState.rpcUrl ?? "http://127.0.0.1:8545");
const VAULT = getAddress(process.env.SHIELD_VAULT_ADDRESS || String(demoState.vault ?? "")) as Address;
const USDC = getAddress(process.env.USDC_ADDRESS || String(demoState.usdc ?? "")) as Address;
const CORE_MOCK = (process.env.CORE_DEPOSIT_MOCK || demoState.coreDeposit) ? (getAddress(String(process.env.CORE_DEPOSIT_MOCK || demoState.coreDeposit)) as Address) : null;
const START_BLOCK = BigInt(process.env.EVM_START_BLOCK || demoState.startBlock || 0);
const NETWORK = evmNetworkName(CHAIN_ID);
const IS_ANVIL = CHAIN_ID === 31337;
const DEMO_ENABLED = (process.env.SHIELD_DEMO ?? (NETWORK === "hyperevm" ? "0" : "1")) === "1";
/**
 * The in-process monitor signs the same EIP-712 verdict the Chainlink
 * confidential workflow signs, with the same key, and relays it the same way.
 * Left on by default it quietly does the enclave's job — it armed a cooldown on
 * the live testnet vault before the enclave was ever asked — which makes the
 * confidential workflow look decorative and makes "only the enclave can sign"
 * false. On Anvil it stays on, because the local demo has no enclave and the
 * loop has to close. On a real network it is opt-in: the verdict comes from CRE.
 */
const MONITOR_ENABLED = (process.env.SHIELD_MONITOR ?? (IS_ANVIL ? "1" : "0")) === "1";
const HL_NETWORK: HlNetwork | null = CHAIN_ID === 999 ? "mainnet" : CHAIN_ID === 998 ? "testnet" : null;
const IS_HYPEREVM = CHAIN_ID === 998 || CHAIN_ID === 999;
// The public HyperEVM RPC caps eth_getLogs at under 200 blocks and meters
// requests by weight, so a long catch-up bursts straight into "rate limited".
// There the indexer polls slower, walks a bounded window per poll, spaces the
// chunk requests out, and backs off when the node pushes back (see `rpc` below).
//
// Backfilling any real span is impossible at 50 blocks a request. EVM_LOG_INDEX_RPC_URL
// points the *log reads only* at an endpoint that allows bulk ranges (dRPC's free
// tier serves 10,000 blocks a call, which covers this contract's whole history in
// three requests); with EVM_LOG_CHUNK raised to match, a cold index takes seconds
// instead of an hour. Everything that signs or sends still goes to EVM_RPC_URL, so
// the canonical endpoint stays the one of record.
const LOG_CHUNK = BigInt(process.env.EVM_LOG_CHUNK || (IS_HYPEREVM ? 50 : 50_000));
const POLL_MS = Number(process.env.SHIELD_POLL_MS || (IS_HYPEREVM ? 15000 : 4000));
const RPC_GAP_MS = Number(process.env.EVM_RPC_GAP_MS || (IS_HYPEREVM ? 500 : 0));
const MAX_BLOCKS_PER_POLL = BigInt(process.env.EVM_MAX_BLOCKS_PER_POLL || (IS_HYPEREVM ? 100 : 10_000_000));
// The Graph indexes HyperEVM mainnet only (`hyper-evm` in the networks registry): the
// Substreams source is used there when a Graph Market token is configured; Anvil and
// the testnet fall back to RPC log indexing.
const SUBSTREAMS = resolveSubstreams("hyperevm");
const SUBSTREAMS_ACTIVE = CHAIN_ID === 999 && !!SUBSTREAMS.token;

// Anvil's public dev keys, never secrets. On real networks the keys must come from the environment.
const VERIFIER_KEY = (process.env.SHIELD_EVM_VERIFIER_KEY || (IS_ANVIL ? "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" : "")) as Hex;
const RELAYER_KEY = (process.env.SHIELD_EVM_RELAYER_KEY || (IS_ANVIL ? "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" : "")) as Hex;
const EXECUTION_KEY = (process.env.EVM_EXECUTION_KEY || (IS_ANVIL ? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" : "")) as Hex;

const LOG_RPC_URL = process.env.EVM_LOG_INDEX_RPC_URL || RPC_URL;

const cfg: EvmConfig = { rpcUrl: RPC_URL, chainId: CHAIN_ID, vault: VAULT, usdc: USDC };
const chain = viemChain(cfg);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
/** Reads historical logs only. Identical to `pub` unless EVM_LOG_INDEX_RPC_URL is set. */
const logClient = LOG_RPC_URL === RPC_URL ? pub : createPublicClient({ chain, transport: http(LOG_RPC_URL) });
const verifier = VERIFIER_KEY ? privateKeyToAccount(VERIFIER_KEY) : null;
const relayer = RELAYER_KEY ? privateKeyToAccount(RELAYER_KEY) : null;
const execution = EXECUTION_KEY ? privateKeyToAccount(EXECUTION_KEY) : null;
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
log(describeSubstreams(SUBSTREAMS) + (SUBSTREAMS.token && !SUBSTREAMS_ACTIVE ? ` (not used on ${NETWORK}: The Graph indexes HyperEVM mainnet only)` : ""));

mkdirSync(STATE_DIR, { recursive: true });
const store = new Store(`${STATE_DIR}/server-state.${NETWORK}.json`);
const cursorPath = `${STATE_DIR}/evm-cursor.${NETWORK}.json`;
const cursors: Record<string, string> = existsSync(cursorPath) ? (JSON.parse(readFileSync(cursorPath, "utf8")) as Record<string, string>) : {};
const saveCursors = () => writeFileSync(cursorPath, JSON.stringify(cursors));

// ---------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------
interface View {
  key: string; // authority address, lowercase
  vault: VaultView;
  balance: bigint;
  proposals: ProposalView[];
  registry: RegistryView[];
  profile: BehaviourProfile;
  assessment: Assessment;
  lastSyncAt: number;
}
const views = new Map<string, View>();
// Vaults are discovered from VaultInitialized logs, but the discovery cursor is
// persisted: on a restart the initialization block is already behind it, so seed
// the set from what the store already knows or the vault would go missing.
const known = new Set<string>(store.vaultKeys());
const source: { mode: "substreams" | "rpc"; connected: boolean; headSlot: string | null; error: string | null; endpoint: string } = {
  mode: SUBSTREAMS_ACTIVE ? "substreams" : "rpc",
  connected: false,
  headSlot: null,
  error: null,
  endpoint: SUBSTREAMS_ACTIVE ? SUBSTREAMS.endpoint : RPC_URL,
};

const policyView = (v: VaultView): PolicyView => ({
  vault: v.authority,
  programId: VAULT,
  lossTriggerUsdc: v.lossTriggerUsdc,
  lossCooldownSecs: v.lossCooldownSecs,
  cooldownUntil: v.cooldownUntil,
  lastVerdictNonce: v.lastVerdictNonce,
});

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Errors worth trying again. "rate limited" is the public HyperEVM RPC pushing
 * back; the rest are the transient upstream failures a load-balanced provider
 * returns while explicitly asking you to retry. Treating those as fatal aborts a
 * whole backfill and rolls the cursor back to where it started.
 */
const isTransient = (e: unknown) =>
  /rate limit|32005|exceeds defined limit|temporary internal error|please retry|try again|timeout|socket hang up|ECONNRESET|502|503|504/i.test(e instanceof Error ? e.message : String(e));

/** One RPC read, retried with exponential backoff while the node pushes back. */
async function rpc<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !isTransient(e)) throw e;
      await sleep(500 * 2 ** i);
    }
  }
}

/**
 * The venue's own 24h realised PnL for a registered HyperCore destination.
 *
 * Capital deposited into a Hyperliquid account and lost there never comes back
 * to the vault, so log indexing alone would report a loss of zero. Hyperliquid's
 * public API is the only honest source for that, and it is used for nothing
 * else: HyperEVM is never presented as knowing what happened on HyperCore.
 * Cached briefly so the monitor loop does not hammer the venue.
 */
const venueLossCache = new Map<string, { at: number; value: VenueLoss | null }>();
async function venueLossFor(account: string): Promise<VenueLoss | null> {
  if (!HL_NETWORK) return null;
  const key = account.toLowerCase();
  const hit = venueLossCache.get(key);
  const nowMs = Date.now();
  if (hit && nowMs - hit.at < 30_000) return hit.value;
  let value: VenueLoss | null = null;
  try {
    const since = nowMs - 86_400_000;
    const fills = (await fetchFills(HL_NETWORK, account)).filter((f) => f.time >= since);
    let net = 0;
    let lastFillAt: number | null = null;
    for (const f of fills) {
      net += Number(f.closedPnl) - Number(f.fee);
      lastFillAt = Math.max(lastFillAt ?? 0, Math.floor(f.time / 1000));
    }
    value = { source: "hyperliquid", network: HL_NETWORK, account, realisedLossUsdc: net < 0 ? BigInt(Math.round(-net * 1e6)) : 0n, fills: fills.length, lastFillAt };
  } catch {
    value = null; // venue unreachable: fall back to flow evidence only, never guess
  }
  venueLossCache.set(key, { at: nowMs, value });
  return value;
}

const blockTimes = new Map<bigint, number>();
async function blockTime(n: bigint): Promise<number> {
  const hit = blockTimes.get(n);
  if (hit !== undefined) return hit;
  const b = await rpc(() => pub.getBlock({ blockNumber: n }));
  const t = Number(b.timestamp);
  blockTimes.set(n, t);
  return t;
}

const labelOf = (hex: Hex) => {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
};

/**
 * One poll asks for the same address-scoped logs once to discover vaults and
 * then twice more per vault, even though the requests are byte-identical — the
 * vault filter happens in memory afterwards. Against an RPC that refuses any
 * getLogs range over ~200 blocks, that is 2N+1 chunked scans of the same range
 * where 2 would do, and it is why backfilling a few thousand blocks saturates
 * the endpoint. The cache lives for one tick and is dropped at the start of the
 * next, so nothing is ever served stale.
 */
let logCache = new Map<string, Promise<unknown[]>>();
const resetLogCache = () => logCache.clear();

function cachedLogs<T>(tag: string, from: bigint, to: bigint, fetchRange: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  const k = `${tag}:${from}:${to}`;
  let p = logCache.get(k);
  if (!p) {
    p = getLogsChunked(fetchRange, from, to) as Promise<unknown[]>;
    logCache.set(k, p);
  }
  return p as Promise<T[]>;
}

async function getLogsChunked<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const out: T[] = [];
  let first = true;
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to;
    if (!first && RPC_GAP_MS) await sleep(RPC_GAP_MS);
    first = false;
    out.push(...(await rpc(() => fetchRange(a, b))));
  }
  return out;
}

/** Discover vaults from VaultInitialized logs (cheap on Anvil; chunked elsewhere). */
async function discoverVaults(head: bigint): Promise<void> {
  const from = BigInt(cursors["__discover"] ?? START_BLOCK.toString());
  if (from > head) return;
  const logs = await cachedLogs("discover", from, head, (a, b) => logClient.getLogs({ address: VAULT, event: parseAbiItem("event VaultInitialized(address indexed vault, address indexed authority, address usdc, uint64 protectedFloor, uint64 velocityThreshold)"), fromBlock: a, toBlock: b }));
  for (const l of logs) if (l.args.authority) known.add((l.args.authority as string).toLowerCase());
  cursors["__discover"] = (head + 1n).toString();
}

/** Pull new Shield events and USDC returns for one vault into the store. */
async function syncFlows(key: string, authority: Address, registry: RegistryView[], head: bigint): Promise<void> {
  const from = BigInt(cursors[key] ?? START_BLOCK.toString());
  if (from > head) return;
  const execution = new Set(registry.filter((r) => r.kind === OwnerKind.Execution).map((r) => r.owner.toLowerCase()));
  const rawLogs = await cachedLogs("vault", from, head, (a, b) => logClient.getLogs({ address: VAULT, fromBlock: a, toBlock: b }));
  const parsed = parseEventLogs({ abi: SHIELD_VAULT_ABI, logs: rawLogs, strict: false });
  const mine = parsed.filter((l) => String((l.args as { vault?: string }).vault ?? "").toLowerCase() === key);
  const flows: Flow[] = [];
  const events: Array<{ name: string; data: Record<string, string | number | boolean>; signature: string; slot: number; blockTime: number }> = [];
  // Every vault shares one contract, so a deposit into someone else's vault is
  // still a USDC transfer into this address. Excluding only *this* vault's
  // deposits would book another tenant's funding as money coming back to us.
  const depositTxs = new Set<string>(parsed.filter((l) => l.eventName === "Deposited").map((l) => l.transactionHash));
  for (const l of mine) {
    const t = await blockTime(l.blockNumber);
    const args = l.args as Record<string, unknown>;
    const data: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(args)) data[k] = typeof v === "bigint" ? v.toString() : typeof v === "boolean" ? v : k === "label" ? labelOf(v as Hex) : String(v);
    events.push({ name: l.eventName, data, signature: l.transactionHash, slot: Number(l.blockNumber), blockTime: t });
    const base = { slot: Number(l.blockNumber), signature: l.transactionHash, blockTime: t, vault: key };
    if (l.eventName === "Deposited") {
      // A raw ERC-20 transfer into the vault contract is never credited to any
      // vault — `deposit()` is the only path that moves `v.balance`, and the
      // contract is immutable with no sweep — so capital "returned" that way is
      // stranded forever. The safe way for a trading wallet to send money back
      // is therefore `deposit()`, and when it does, that is a return, not new
      // capital. Recognising it here is what makes the safe path the one the
      // loss rule can see.
      const depositor = String(args.depositor).toLowerCase();
      const isReturn = execution.has(depositor);
      flows.push({ ...base, kind: isReturn ? "RETURN" : "DEPOSIT", outbound: false, counterparty: String(args.depositor), amount: args.amount as bigint, counterpartyIsExecution: isReturn });
    } else if (l.eventName === "TopUpExecuted") {
      flows.push({ ...base, kind: args.instant ? "TOP_UP_INSTANT" : "TOP_UP_GATED", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: true });
    } else if (l.eventName === "ColdTransferExecuted") {
      flows.push({ ...base, kind: "COLD_TRANSFER", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: false });
    } else if (l.eventName === "FullExitExecuted") {
      flows.push({ ...base, kind: "FULL_EXIT", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: false });
    }
  }
  /**
   * Returns: plain USDC transfers into the vault contract that are not deposits.
   *
   * A raw ERC-20 transfer carries no vault identity, and every vault shares one
   * contract, so the only signal is who sent it. Crediting it to every vault
   * that registered that sender books one $30 return three times — and worse,
   * `registerOwner` needs no consent from the address being registered, so
   * anyone could name a heavy trader's deposit address as their execution
   * destination and have that trader's returns cancel their own realised losses,
   * for free, forever.
   *
   * A return is therefore only credited against capital this vault actually has
   * outstanding to that wallet, and never for more than that. A stranger who
   * registers someone else's address has released nothing to it, so there is
   * nothing for their return to cancel.
   */
  const outstanding = new Map<string, bigint>();
  for (const f of [...store.vault(key).flows, ...flows]) {
    if (!f.counterpartyIsExecution) continue;
    const who = f.counterparty.toLowerCase();
    const prior = outstanding.get(who) ?? 0n;
    if (f.outbound) outstanding.set(who, prior + BigInt(f.amount));
    else if (f.kind === "RETURN") outstanding.set(who, prior - BigInt(f.amount) > 0n ? prior - BigInt(f.amount) : 0n);
  }
  const transfers = await cachedLogs("usdc", from, head, (a, b) => logClient.getLogs({ address: USDC, event: TRANSFER, args: { to: VAULT }, fromBlock: a, toBlock: b }));
  for (const tr of transfers) {
    if (depositTxs.has(tr.transactionHash)) continue;
    const fromAddr = String(tr.args.from).toLowerCase();
    if (!execution.has(fromAddr)) continue; // only money coming back from a registered trading wallet counts as a return
    // A transfer out of the contract in the same transaction means this was a
    // release being routed, not capital returning.
    if (mine.some((l) => l.transactionHash === tr.transactionHash && (l.eventName === "TopUpExecuted" || l.eventName === "ColdTransferExecuted" || l.eventName === "FullExitExecuted"))) continue;
    const owed = outstanding.get(fromAddr) ?? 0n;
    if (owed <= 0n) continue; // nothing outstanding to this wallet: not our money coming back
    const amount = (tr.args.value as bigint) < owed ? (tr.args.value as bigint) : owed;
    outstanding.set(fromAddr, owed - amount);
    const t = await blockTime(tr.blockNumber);
    flows.push({ slot: Number(tr.blockNumber), signature: tr.transactionHash, blockTime: t, vault: key, kind: "RETURN", outbound: false, counterparty: getAddress(fromAddr), amount, counterpartyIsExecution: true });
  }
  if (flows.length) store.addFlows(key, flows);
  if (events.length) store.addEvents(key, events as never);
  cursors[key] = (head + 1n).toString();
  store.touch();
}

async function syncVault(authority: Address, head?: bigint): Promise<View | null> {
  const key = authority.toLowerCase();
  const r = await rpc(() => readVault(pub, cfg, authority));
  if (!r) return null;
  const [proposals, registry] = await Promise.all([rpc(() => readProposals(pub, cfg, authority)), rpc(() => readRegistry(pub, cfg, authority))]);
  const h = head ?? (await rpc(() => pub.getBlockNumber()));
  try {
    await syncFlows(key, authority, registry, h);
    source.connected = true;
    source.headSlot = h.toString();
    source.error = null;
  } catch (e) {
    source.error = e instanceof Error ? e.message : String(e);
    log(`[${key.slice(0, 8)}] log sync error: ${source.error}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const rec = store.vault(key);
  const profile = deriveProfile(key, rec.flows, now);
  const venueAccount = registry.find((x) => x.kind === OwnerKind.Execution && x.active && x.route === 1)?.owner ?? null;
  const venue = venueAccount ? await venueLossFor(venueAccount) : null;
  const assessment = assess(profile, policyView(r.vault), now, rec.lastVerdictLossAt, venue);
  const view: View = { key, vault: r.vault, balance: r.balance, proposals, registry, profile, assessment, lastSyncAt: now };
  views.set(key, view);
  return view;
}

// ---------------------------------------------------------------------
// Monitor: EIP-712 verdict signed by the verifier, relayed by the relayer
// ---------------------------------------------------------------------
const VERDICT_TYPES = {
  RiskVerdict: [
    { name: "vault", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "reasonCode", type: "uint8" },
    { name: "realizedLossUsdc", type: "uint64" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;
const domain = { name: "ShieldVault", version: "1", chainId: CHAIN_ID, verifyingContract: VAULT } as const;

interface EvmVerdictJson {
  vault: string;
  nonce: string;
  issuedAt: string;
  expiry: string;
  reasonCode: number;
  realizedLossUsdc: string;
  evidenceHash: string; // 0x-prefixed 32 bytes
  signature: string;
  verifier: string;
}

/**
 * Submit a signed verdict.
 *
 * `receiptTimeoutMs` bounds how long the caller waits for confirmation. The
 * confidential workflow delivers over an enclave HTTP call with its own
 * deadline, and holding that connection open across a chain write on a
 * rate-limited RPC is what made it time out. The transaction is still
 * confirmed — just in the background, with the record updated when it lands.
 */
async function relayVerdict(v: EvmVerdictJson, sourceTag: VerdictRecord["source"], headline: string, lines: string[], receiptTimeoutMs?: number): Promise<VerdictRecord> {
  const record: VerdictRecord = { verdict: v as never, headline, lines, relayed: false, signature: null, error: null, issuedAt: Number(v.issuedAt), source: sourceTag };
  try {
    if (!relayer) throw new Error("no relayer key");
    const wc = createWalletClient({ account: relayer, chain, transport: http(RPC_URL) });
    const call = evmCalls.applyRiskVerdict(cfg, { vault: getAddress(v.vault), nonce: BigInt(v.nonce), issuedAt: BigInt(v.issuedAt), expiry: BigInt(v.expiry), reasonCode: v.reasonCode, realizedLossUsdc: BigInt(v.realizedLossUsdc), evidenceHash: v.evidenceHash as Hex }, v.signature as Hex);
    await pub.call({ account: relayer.address, to: call.to, data: call.data });
    const hash = await wc.sendTransaction({ account: relayer, chain, to: call.to, data: call.data });
    record.signature = hash;
    if (receiptTimeoutMs) {
      try {
        const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs });
        if (rcpt.status !== "success") throw new Error("reverted");
        record.relayed = true;
      } catch {
        // Submitted but not confirmed inside the caller's budget: keep watching.
        log(`verdict #${v.nonce} submitted, confirming in the background: ${hash}`);
        void pub
          .waitForTransactionReceipt({ hash })
          .then((r) => {
            record.relayed = r.status === "success";
            if (!record.relayed) record.error = "reverted";
            store.touch();
            log(`verdict #${v.nonce} ${record.relayed ? "confirmed" : "reverted"}: ${hash}`);
          })
          .catch(() => null);
        record.relayed = true; // accepted by the chain's mempool; confirmation follows
      }
    } else {
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error("reverted");
      record.relayed = true;
    }
    log(`verdict #${v.nonce} relayed for ${v.vault.slice(0, 8)}: ${hash}`);
  } catch (e) {
    record.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`verdict #${v.nonce} not relayed: ${record.error}`);
  }
  const rec = store.vault(v.vault.toLowerCase());
  rec.verdicts.push(record);
  store.touch();
  return record;
}

async function monitorVault(view: View): Promise<VerdictRecord | null> {
  if (!MONITOR_ENABLED || !verifier) return null;
  const a = view.assessment;
  if (!a.actionable) return null;
  if (!view.vault.riskVerifier || view.vault.riskVerifier.toLowerCase() !== verifier.address.toLowerCase()) return null;
  const now = Math.floor(Date.now() / 1000);
  const nonce = view.vault.lastVerdictNonce + 1n;
  const evidenceHash = `0x${toHex(evidenceHashOf(a.evidence))}` as Hex;
  const message = { vault: getAddress(view.vault.authority), nonce, issuedAt: BigInt(now), expiry: BigInt(now + 15 * 60), reasonCode: a.reasonCode, realizedLossUsdc: a.realizedLossUsdc, evidenceHash };
  const signature = await verifier.signTypedData({ domain, types: VERDICT_TYPES, primaryType: "RiskVerdict", message });
  store.putEvidence(evidenceHash.slice(2).toLowerCase(), a.evidence);
  const json: EvmVerdictJson = { vault: message.vault, nonce: nonce.toString(), issuedAt: String(now), expiry: String(now + 900), reasonCode: a.reasonCode, realizedLossUsdc: a.realizedLossUsdc.toString(), evidenceHash, signature, verifier: verifier.address };
  const record = await relayVerdict(json, "server-monitor", a.headline, a.lines);
  if (record.relayed) {
    const rec = store.vault(view.key);
    rec.lastVerdictLossAt = a.newestLossAt ?? now;
    store.touch();
  }
  return record;
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
/** Never ask for more than MAX_BLOCKS_PER_POLL blocks at once: a cold start far
 *  behind the chain head then catches up over several polls instead of one burst. */
function clampHead(chainHead: bigint): bigint {
  let oldest: bigint | null = null;
  for (const k of ["__discover", ...known]) {
    const c = BigInt(cursors[k] ?? START_BLOCK.toString());
    if (oldest === null || c < oldest) oldest = c;
  }
  if (oldest === null || chainHead - oldest <= MAX_BLOCKS_PER_POLL) return chainHead;
  return oldest + MAX_BLOCKS_PER_POLL;
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const head = clampHead(await rpc(() => pub.getBlockNumber()));
    resetLogCache();
    await discoverVaults(head);
    for (const key of known) {
      try {
        const view = await syncVault(getAddress(key), head);
        if (view) {
          const rec = await monitorVault(view);
          if (rec?.relayed) await syncVault(getAddress(key), head);
        }
      } catch (e) {
        log(`[${key.slice(0, 8)}] ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      }
    }
    saveCursors();
    store.flush();
  } catch (e) {
    source.connected = false;
    source.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  } finally {
    running = false;
  }
}
if (SUBSTREAMS_ACTIVE) {
  // Live flows from The Graph (HyperEVM mainnet). The RPC log sync keeps running for
  // events and as a cross-check; store.addFlows dedups by tx hash + kind + amount.
  const abort = new AbortController();
  const anyCursor = store.vaultKeys().map((k) => store.vault(k).substreamsCursor).find(Boolean) ?? null;
  runSubstreamsSource(
    {
      token: SUBSTREAMS.token,
      endpoint: SUBSTREAMS.endpoint,
      spkgPath: SUBSTREAMS.spkg,
      module: "map_vault_flows",
      startBlock: START_BLOCK,
      cursor: anyCursor,
      onFlows: (flows, cursor, block) => {
        const byVault = new Map<string, Flow[]>();
        for (const f of flows) byVault.set(f.vault.toLowerCase(), [...(byVault.get(f.vault.toLowerCase()) ?? []), f]);
        for (const [vault, list] of byVault) {
          known.add(vault);
          store.addFlows(vault, list);
        }
        for (const k of store.vaultKeys()) store.vault(k).substreamsCursor = cursor;
        source.headSlot = block.toString();
        if (flows.length) store.touch();
      },
      onUndo: (lastValid) => log(`substreams undo to block ${lastValid}`),
      onStatus: (st) => {
        source.connected = st.connected;
        source.error = st.error ?? null;
        if (st.headSlot !== undefined) source.headSlot = st.headSlot.toString();
      },
      log,
    },
    abort.signal
  ).catch((e) => log(`substreams source stopped: ${e}`));
}

setInterval(tick, POLL_MS);
void tick();

// ---------------------------------------------------------------------
// HTTP API (same shape as server/index.ts)
// ---------------------------------------------------------------------
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(serialize(body)), { status, headers: { "content-type": "application/json", ...CORS } });
const notFound = (what: string) => json({ error: `${what} not found` }, 404);
const readJson = async (req: Request) => { try { return (await req.json()) as Record<string, unknown>; } catch { return {}; } };

function viewPayload(v: View) {
  const rec = store.vault(v.key);
  return {
    vault: v.key,
    network: NETWORK,
    programId: VAULT,
    state: v.vault,
    balance: v.balance,
    proposals: v.proposals,
    registry: v.registry,
    profile: v.profile,
    assessment: { ...v.assessment, evidenceHash: toHex(v.assessment.evidenceHash), reasonLabel: REASON_LABEL[v.assessment.reasonCode] },
    events: rec.events.slice(-200).reverse(),
    verdicts: rec.verdicts.slice(-20).reverse(),
    source,
    lastSyncAt: v.lastSyncAt,
  };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (path === "/api/health") {
      return json({
        ok: true,
        chain: "evm",
        network: NETWORK,
        rpcUrl: RPC_URL,
        programId: VAULT,
        source,
        substreamsEndpoint: SUBSTREAMS.endpoint,
        substreamsAvailable: CHAIN_ID === 999 ? "yes" : "no: The Graph indexes HyperEVM mainnet only",
        substreamsToken: SUBSTREAMS.token ? SUBSTREAMS.tokenSource : "none",
        spkg: SUBSTREAMS.spkg,
        monitor: { enabled: MONITOR_ENABLED && !!verifier, verifier: verifier?.address ?? null },
        demo: DEMO_ENABLED,
        vaults: [...known],
        usdcMint: USDC,
        executionWallet: execution?.address ?? (demoState.executionWallet ? String(demoState.executionWallet) : null),
        // Which vault this stack was set up for. Several can exist on one
        // contract, and signing in with the wrong key shows a real but empty
        // one, which looks like a broken app.
        demoAuthority: demoState.authority ? String(demoState.authority) : null,
        evm: { vault: VAULT, usdc: USDC, coreDepositMock: CORE_MOCK, chainId: CHAIN_ID, rpcUrl: RPC_URL },
      });
    }

    const hl = path.match(/^\/api\/hyperliquid\/(0x[0-9a-fA-F]{40})$/);
    if (hl && req.method === "GET") {
      const network = (url.searchParams.get("network") === "testnet" ? "testnet" : "mainnet") as HlNetwork;
      try { return json(await analyseHyperliquid(hl[1], network)); } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 502); }
    }

    if (path === "/api/vaults") return json([...views.values()].map((v) => ({ vault: v.key, authority: v.vault.authority, balance: v.balance })));

    const vaultMatch = path.match(/^\/api\/vault\/(0x[0-9a-fA-F]{40})(?:\/(.*))?$/);
    if (vaultMatch) {
      const key = vaultMatch[1].toLowerCase();
      const sub = vaultMatch[2] ?? "";
      let view = views.get(key);
      if (!view || sub === "refresh" || (req.method === "POST" && sub === "evaluate")) {
        try {
          view = (await syncVault(getAddress(key))) ?? undefined;
          if (view) known.add(key);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 500);
        }
      }
      if (!view) return notFound("vault");
      if (req.method === "POST" && sub === "evaluate") {
        const record = await monitorVault(view);
        if (record?.relayed) view = (await syncVault(getAddress(key))) ?? view;
        store.flush();
        return json({ assessment: viewPayload(view).assessment, verdict: record });
      }
      if (sub === "activity") return json(store.vault(key).events.slice(-500).reverse());
      if (sub === "flows") return json({ vault: key, source: source.mode, flows: store.vault(key).flows });
      if (sub === "profile") return json(view.profile);
      return json(viewPayload(view));
    }

    const evidenceMatch = path.match(/^\/api\/evidence\/([0-9a-fA-F]{64})$/);
    if (evidenceMatch) {
      const bundle = store.evidence(evidenceMatch[1].toLowerCase());
      return bundle ? json(bundle) : notFound("evidence");
    }

    if (req.method === "POST" && path === "/api/verdicts") {
      const body = (await readJson(req)) as unknown as { verdict?: EvmVerdictJson; evidence?: unknown; headline?: string; lines?: string[] } & EvmVerdictJson;
      const v = body.verdict ?? body;
      if (!v?.vault || !v?.signature) return json({ error: "expected a signed verdict" }, 400);
      // The vault stores this hash alongside the verdict, and the UI tells the
      // user the chain vouches for the bundle behind it. That is only true if
      // the bundle actually hashes to the committed value — this endpoint is
      // unauthenticated, so without the check anyone could replace the evidence
      // behind a real verdict with a fabricated one.
      if (body.evidence && v.evidenceHash) {
        const want = v.evidenceHash.replace(/^0x/, "").toLowerCase();
        const got = Buffer.from(evidenceHashOf(body.evidence as never)).toString("hex");
        if (got !== want) return json({ error: "evidence does not hash to evidenceHash" }, 400);
        store.putEvidence(want, body.evidence as never);
      }
      // 20s: well inside the enclave's HTTP deadline. Confirmation continues
      // in the background, and the caller gets the transaction hash either way.
      const record = await relayVerdict(v, "cre", body.headline ?? "Verdict relayed from the confidential workflow", body.lines ?? [], 20_000);
      if (record.relayed) {
        store.vault(v.vault.toLowerCase()).lastVerdictLossAt = Math.floor(Date.now() / 1000);
        void syncVault(getAddress(v.vault)).catch(() => null);
      }
      store.flush();
      return json(record, record.relayed ? 200 : 502);
    }

    if (DEMO_ENABLED && req.method === "POST" && path === "/api/demo/return") {
      const body = await readJson(req);
      const amountUsdc = Number(body.amountUsdc ?? 0);
      if (!execution || !CORE_MOCK) return json({ error: "no demo execution key or mock core" }, 400);
      try {
        const wc = createWalletClient({ account: execution, chain, transport: http(RPC_URL) });
        const raw = BigInt(Math.round(amountUsdc * 1_000_000));
        const h1 = await wc.writeContract({ address: CORE_MOCK, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "withdrawToEvm", args: [raw] });
        await pub.waitForTransactionReceipt({ hash: h1 });
        const h2 = await wc.writeContract({ address: USDC, abi: MOCK_USDC_ABI, functionName: "transfer", args: [VAULT, raw] });
        await pub.waitForTransactionReceipt({ hash: h2 });
        const authority = String(body.vault ?? [...known][0] ?? "");
        const refreshed = authority ? await syncVault(getAddress(authority)) : null;
        const record = refreshed ? await monitorVault(refreshed) : null;
        store.flush();
        return json({ signature: h2, verdict: record });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, 500);
      }
    }

    if (DEMO_ENABLED && req.method === "POST" && path === "/api/demo/loss") {
      const body = await readJson(req);
      if (!execution || !CORE_MOCK) return json({ error: "no demo execution key or mock core" }, 400);
      const raw = BigInt(Math.round(Number(body.amountUsdc ?? 0) * 1_000_000));
      const wc = createWalletClient({ account: execution, chain, transport: http(RPC_URL) });
      const h = await wc.writeContract({ address: CORE_MOCK, abi: MOCK_CORE_DEPOSIT_ABI, functionName: "settleLoss", args: [execution.address, raw] });
      await pub.waitForTransactionReceipt({ hash: h });
      return json({ signature: h });
    }

    if (DEMO_ENABLED && req.method === "POST" && path === "/api/demo/faucet") {
      const body = await readJson(req);
      if (!relayer) return json({ error: "no relayer key" }, 400);
      const raw = BigInt(Math.round(Number(body.amountUsdc ?? 10000) * 1_000_000));
      const wc = createWalletClient({ account: relayer, chain, transport: http(RPC_URL) });
      const h = await wc.writeContract({ address: USDC, abi: MOCK_USDC_ABI, functionName: "mint", args: [getAddress(String(body.owner)), raw] });
      await pub.waitForTransactionReceipt({ hash: h });
      return json({ signature: h });
    }

    return notFound("route");
  },
});

log(`Shield EVM server on http://localhost:${PORT} (${NETWORK} via ${RPC_URL}); vault=${VAULT}; monitor=${verifier?.address ?? "none"}; relayer=${relayer?.address ?? "none"}; demo=${DEMO_ENABLED}`);
