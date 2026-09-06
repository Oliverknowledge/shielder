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
 * Config comes from the environment or .shield/demo-state.evm.json.
 */
import { createPublicClient, createWalletClient, getAddress, http, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Store, type VerdictRecord } from "./store";
import { deriveProfile, serialize, type BehaviourProfile, type Flow } from "./behaviour";
import { assess, REASON_LABEL, type Assessment, type PolicyView } from "./policy";
import { analyseHyperliquid, type HlNetwork } from "./hyperliquid";
import { SHIELD_VAULT_ABI } from "../client/abi/ShieldVault";
import { MOCK_USDC_ABI } from "../client/abi/MockUSDC";
import { MOCK_CORE_DEPOSIT_ABI } from "../client/abi/MockCoreDepositWallet";
import { evmCalls, readProposals, readRegistry, readVault, viemChain, type EvmConfig } from "../client/evm";
import { evidenceHashOf, toHex } from "../client/verdict";
import { OwnerKind, type ProposalView, type RegistryView, type VaultView } from "../client/views";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const PORT = Number(process.env.SHIELD_PORT ?? 8787);
const POLL_MS = Number(process.env.SHIELD_POLL_MS ?? 4000);
const demoState = existsSync(`${STATE_DIR}/demo-state.evm.json`) ? (JSON.parse(readFileSync(`${STATE_DIR}/demo-state.evm.json`, "utf8")) as Record<string, string | number>) : {};
const RPC_URL = process.env.EVM_RPC_URL ?? String(demoState.rpcUrl ?? "http://127.0.0.1:8545");
const CHAIN_ID = Number(process.env.EVM_CHAIN_ID ?? demoState.chainId ?? 31337);
const VAULT = getAddress(process.env.SHIELD_VAULT_ADDRESS ?? String(demoState.vault ?? "")) as Address;
const USDC = getAddress(process.env.USDC_ADDRESS ?? String(demoState.usdc ?? "")) as Address;
const CORE_MOCK = (process.env.CORE_DEPOSIT_MOCK ?? demoState.coreDeposit) ? (getAddress(String(process.env.CORE_DEPOSIT_MOCK ?? demoState.coreDeposit)) as Address) : null;
const START_BLOCK = BigInt(process.env.EVM_START_BLOCK ?? demoState.startBlock ?? 0);
const NETWORK = CHAIN_ID === 999 ? "hyperevm" : CHAIN_ID === 998 ? "hyperevm-testnet" : CHAIN_ID === 31337 ? "anvil" : `evm-${CHAIN_ID}`;
const IS_ANVIL = CHAIN_ID === 31337;
const DEMO_ENABLED = (process.env.SHIELD_DEMO ?? (NETWORK === "hyperevm" ? "0" : "1")) === "1";
const MONITOR_ENABLED = (process.env.SHIELD_MONITOR ?? "1") === "1";
const HL_NETWORK: HlNetwork | null = CHAIN_ID === 999 ? "mainnet" : CHAIN_ID === 998 ? "testnet" : null;
const LOG_CHUNK = CHAIN_ID === 998 || CHAIN_ID === 999 ? 50n : 50_000n;

// Anvil's public dev keys, never secrets. On real networks the keys must come from the environment.
const VERIFIER_KEY = (process.env.SHIELD_EVM_VERIFIER_KEY ?? (IS_ANVIL ? "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" : "")) as Hex;
const RELAYER_KEY = (process.env.SHIELD_EVM_RELAYER_KEY ?? (IS_ANVIL ? "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" : "")) as Hex;
const EXECUTION_KEY = (process.env.EVM_EXECUTION_KEY ?? (IS_ANVIL ? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" : "")) as Hex;

const cfg: EvmConfig = { rpcUrl: RPC_URL, chainId: CHAIN_ID, vault: VAULT, usdc: USDC };
const chain = viemChain(cfg);
const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const verifier = VERIFIER_KEY ? privateKeyToAccount(VERIFIER_KEY) : null;
const relayer = RELAYER_KEY ? privateKeyToAccount(RELAYER_KEY) : null;
const execution = EXECUTION_KEY ? privateKeyToAccount(EXECUTION_KEY) : null;
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

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
const known = new Set<string>();
const source = { mode: "rpc" as const, connected: false, headSlot: null as string | null, error: null as string | null, endpoint: RPC_URL };

const policyView = (v: VaultView): PolicyView => ({
  vault: v.authority,
  programId: VAULT,
  lossTriggerUsdc: v.lossTriggerUsdc,
  lossCooldownSecs: v.lossCooldownSecs,
  cooldownUntil: v.cooldownUntil,
  lastVerdictNonce: v.lastVerdictNonce,
});

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const blockTimes = new Map<bigint, number>();
async function blockTime(n: bigint): Promise<number> {
  const hit = blockTimes.get(n);
  if (hit !== undefined) return hit;
  const b = await pub.getBlock({ blockNumber: n });
  const t = Number(b.timestamp);
  blockTimes.set(n, t);
  return t;
}

const labelOf = (hex: Hex) => {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
};

async function getLogsChunked<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const out: T[] = [];
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to;
    out.push(...(await fetchRange(a, b)));
  }
  return out;
}

/** Discover vaults from VaultInitialized logs (cheap on Anvil; chunked elsewhere). */
async function discoverVaults(head: bigint): Promise<void> {
  const from = BigInt(cursors["__discover"] ?? START_BLOCK.toString());
  if (from > head) return;
  const logs = await getLogsChunked((a, b) => pub.getLogs({ address: VAULT, event: parseAbiItem("event VaultInitialized(address indexed vault, address indexed authority, address usdc, uint64 protectedFloor, uint64 velocityThreshold)"), fromBlock: a, toBlock: b }), from, head);
  for (const l of logs) if (l.args.authority) known.add((l.args.authority as string).toLowerCase());
  cursors["__discover"] = (head + 1n).toString();
}

/** Pull new Shield events and USDC returns for one vault into the store. */
async function syncFlows(key: string, authority: Address, registry: RegistryView[], head: bigint): Promise<void> {
  const from = BigInt(cursors[key] ?? START_BLOCK.toString());
  if (from > head) return;
  const execution = new Set(registry.filter((r) => r.kind === OwnerKind.Execution).map((r) => r.owner.toLowerCase()));
  const rawLogs = await getLogsChunked((a, b) => pub.getLogs({ address: VAULT, fromBlock: a, toBlock: b }), from, head);
  const parsed = parseEventLogs({ abi: SHIELD_VAULT_ABI, logs: rawLogs, strict: false });
  const mine = parsed.filter((l) => String((l.args as { vault?: string }).vault ?? "").toLowerCase() === key);
  const flows: Flow[] = [];
  const events: Array<{ name: string; data: Record<string, string | number | boolean>; signature: string; slot: number; blockTime: number }> = [];
  const depositTxs = new Set<string>();
  for (const l of mine) {
    const t = await blockTime(l.blockNumber);
    const args = l.args as Record<string, unknown>;
    const data: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(args)) data[k] = typeof v === "bigint" ? v.toString() : typeof v === "boolean" ? v : k === "label" ? labelOf(v as Hex) : String(v);
    events.push({ name: l.eventName, data, signature: l.transactionHash, slot: Number(l.blockNumber), blockTime: t });
    const base = { slot: Number(l.blockNumber), signature: l.transactionHash, blockTime: t, vault: key };
    if (l.eventName === "Deposited") {
      depositTxs.add(l.transactionHash);
      flows.push({ ...base, kind: "DEPOSIT", outbound: false, counterparty: String(args.depositor), amount: args.amount as bigint, counterpartyIsExecution: false });
    } else if (l.eventName === "TopUpExecuted") {
      flows.push({ ...base, kind: args.instant ? "TOP_UP_INSTANT" : "TOP_UP_GATED", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: true });
    } else if (l.eventName === "ColdTransferExecuted") {
      flows.push({ ...base, kind: "COLD_TRANSFER", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: false });
    } else if (l.eventName === "FullExitExecuted") {
      flows.push({ ...base, kind: "FULL_EXIT", outbound: true, counterparty: String(args.destinationOwner), amount: args.amount as bigint, counterpartyIsExecution: false });
    }
  }
  // Returns: plain USDC transfers into the vault contract that are not deposits.
  const transfers = await getLogsChunked((a, b) => pub.getLogs({ address: USDC, event: TRANSFER, args: { to: VAULT }, fromBlock: a, toBlock: b }), from, head);
  for (const tr of transfers) {
    if (depositTxs.has(tr.transactionHash)) continue;
    const fromAddr = String(tr.args.from).toLowerCase();
    if (!execution.has(fromAddr)) continue; // only money coming back from a registered trading wallet counts as a return
    const t = await blockTime(tr.blockNumber);
    flows.push({ slot: Number(tr.blockNumber), signature: tr.transactionHash, blockTime: t, vault: key, kind: "RETURN", outbound: false, counterparty: getAddress(fromAddr), amount: tr.args.value as bigint, counterpartyIsExecution: true });
  }
  if (flows.length) store.addFlows(key, flows);
  if (events.length) store.addEvents(key, events as never);
  cursors[key] = (head + 1n).toString();
  store.touch();
}

async function syncVault(authority: Address, head?: bigint): Promise<View | null> {
  const key = authority.toLowerCase();
  const r = await readVault(pub, cfg, authority);
  if (!r) return null;
  const [proposals, registry] = await Promise.all([readProposals(pub, cfg, authority), readRegistry(pub, cfg, authority)]);
  const h = head ?? (await pub.getBlockNumber());
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
  const assessment = assess(profile, policyView(r.vault), now, rec.lastVerdictLossAt);
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

async function relayVerdict(v: EvmVerdictJson, sourceTag: VerdictRecord["source"], headline: string, lines: string[]): Promise<VerdictRecord> {
  const record: VerdictRecord = { verdict: v as never, headline, lines, relayed: false, signature: null, error: null, issuedAt: Number(v.issuedAt), source: sourceTag };
  try {
    if (!relayer) throw new Error("no relayer key");
    const wc = createWalletClient({ account: relayer, chain, transport: http(RPC_URL) });
    const call = evmCalls.applyRiskVerdict(cfg, { vault: getAddress(v.vault), nonce: BigInt(v.nonce), issuedAt: BigInt(v.issuedAt), expiry: BigInt(v.expiry), reasonCode: v.reasonCode, realizedLossUsdc: BigInt(v.realizedLossUsdc), evidenceHash: v.evidenceHash as Hex }, v.signature as Hex);
    await pub.call({ account: relayer.address, to: call.to, data: call.data });
    const hash = await wc.sendTransaction({ account: relayer, chain, to: call.to, data: call.data });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error("reverted");
    record.relayed = true;
    record.signature = hash;
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
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const head = await pub.getBlockNumber();
    await discoverVaults(head);
    for (const key of known) {
      try {
        const view = await syncVault(getAddress(key), head);
        if (view) {
          const rec = await monitorVault(view);
          if (rec?.relayed) await syncVault(getAddress(key));
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
        substreamsEndpoint: CHAIN_ID === 999 ? "hyperevm.substreams.pinax.network:443" : "hyperevm.substreams.pinax.network:443 (mainnet only)",
        spkg: "substreams-evm/shield-evm-behavioral-memory",
        monitor: { enabled: MONITOR_ENABLED && !!verifier, verifier: verifier?.address ?? null },
        demo: DEMO_ENABLED,
        vaults: [...known],
        usdcMint: USDC,
        executionWallet: execution?.address ?? null,
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
      if (body.evidence && v.evidenceHash) store.putEvidence(v.evidenceHash.replace(/^0x/, "").toLowerCase(), body.evidence as never);
      const record = await relayVerdict(v, "cre", body.headline ?? "Verdict relayed from the confidential workflow", body.lines ?? []);
      if (record.relayed) {
        store.vault(v.vault.toLowerCase()).lastVerdictLossAt = Math.floor(Date.now() / 1000);
        await syncVault(getAddress(v.vault));
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
