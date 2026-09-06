#!/usr/bin/env bun
/**
 * Shield server: behavioural indexer + risk monitor + verdict relayer + API.
 *
 *   bun run server/index.ts
 *
 * What it does, per watched vault, every few seconds:
 *   1. reads vault state / proposals / registry from Solana RPC
 *   2. pulls capital flows from The Graph (Substreams, if SUBSTREAMS_API_TOKEN
 *      is set) or the RPC fallback, and decodes Shield events for the feed
 *   3. derives the behavioural profile (server/behaviour.ts)
 *   4. evaluates the user's own loss rule (server/policy.ts); if it is met by
 *      NEW evidence, signs a verdict with the vault's pinned verifier key and
 *      relays it on-chain (the vault then computes the cooldown itself)
 *
 * It is deliberately NOT in the custody path: if this process dies, the
 * vault's floor, limits, delays and any already-armed cooldown keep working,
 * and the recovery CLI still works. See docs/THREAT_MODEL.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { analyseHyperliquid, type HlNetwork } from "./hyperliquid";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import {
  SHIELD_PROGRAM_ID,
  accountDiscriminator,
  applyRiskVerdictIxs,
  bs58Encode,
  decodeVault,
  fetchAllProposals,
  fetchRegistry,
  fetchVault,
  vaultTokenAccountPda,
  OwnerType,
  type ProposalState,
  type RegistryEntryState,
  type VaultState,
} from "../client/shield-client";
import { deriveProfile, serialize, type BehaviourProfile, type Flow } from "./behaviour";
import { assess, buildUnsignedVerdict, signVerdict, verifyVerdictSignature, REASON_LABEL, type Assessment, type PolicyView } from "./policy";
import { syncVaultViaRpc, type ActivityEvent } from "./rpc-source";
import { Store, type VerdictRecord } from "./store";
import { runSubstreamsSource } from "./substreams-source";
import { toHex, verdictFromJson, verdictToJson, type VerdictJson } from "../client/verdict";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const RPC_URL = process.env.SHIELD_RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.SHIELD_PORT ?? 8787);
const STATE_DIR = process.env.SHIELD_STATE_DIR ?? ".shield";
const POLL_MS = Number(process.env.SHIELD_POLL_MS ?? 4000);
const SUBSTREAMS_TOKEN = process.env.SUBSTREAMS_API_TOKEN ?? "";
const SUBSTREAMS_ENDPOINT = process.env.SUBSTREAMS_ENDPOINT ?? "devnet.sol.streamingfast.io:443";
const SUBSTREAMS_SPKG = process.env.SHIELD_SPKG ?? "substreams/shield-behavioral-memory-v0.2.0.spkg";
const SUBSTREAMS_START_SLOT = BigInt(process.env.SUBSTREAMS_START_SLOT ?? "0");
const NETWORK = RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "localnet";
const DEMO_ENABLED = (process.env.SHIELD_DEMO ?? (NETWORK === "mainnet-beta" ? "0" : "1")) === "1";
const MONITOR_ENABLED = (process.env.SHIELD_MONITOR ?? "1") === "1";

const connection = new Connection(RPC_URL, "confirmed");
const store = new Store(`${STATE_DIR}/server-state.${NETWORK}.json`);
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

function loadKeypair(path: string): Keypair | null {
  if (!existsSync(path)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8"))));
}

mkdirSync(STATE_DIR, { recursive: true });
const verifierKeypair = loadKeypair(process.env.SHIELD_RISK_VERIFIER_KEYPAIR ?? `${STATE_DIR}/risk-verifier.json`);
const defaultKeypair = loadKeypair(process.env.SHIELD_AUTHORITY_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`);
const executionKeypair = loadKeypair(`${STATE_DIR}/execution-wallet.json`);
let relayer: Keypair | null = loadKeypair(process.env.SHIELD_RELAYER_KEYPAIR ?? `${STATE_DIR}/relayer.json`);

async function ensureRelayer(): Promise<Keypair | null> {
  if (!relayer) {
    relayer = Keypair.generate();
    writeFileSync(`${STATE_DIR}/relayer.json`, JSON.stringify(Array.from(relayer.secretKey)));
  }
  const bal = await connection.getBalance(relayer.publicKey).catch(() => 0);
  if (bal > 0.01e9) return relayer;
  try {
    const sig = await connection.requestAirdrop(relayer.publicKey, 1e9);
    await connection.confirmTransaction(sig, "confirmed");
    log(`relayer ${relayer.publicKey.toBase58()} airdropped 1 SOL`);
    return relayer;
  } catch {
    if (defaultKeypair) {
      const dbal = await connection.getBalance(defaultKeypair.publicKey).catch(() => 0);
      if (dbal > 0.01e9) {
        log(`relayer has no SOL and airdrop failed; relaying with the default keypair ${defaultKeypair.publicKey.toBase58()}`);
        return defaultKeypair;
      }
    }
    log("no funded relayer available: verdicts will be signed but not relayed");
    return null;
  }
}

// ---------------------------------------------------------------------
// In-memory view per vault
// ---------------------------------------------------------------------

interface VaultView {
  key: string;
  state: VaultState;
  balance: bigint;
  proposals: ProposalState[];
  registry: RegistryEntryState[];
  profile: BehaviourProfile;
  assessment: Assessment;
  lastSyncAt: number;
  lastError: string | null;
}

const views = new Map<string, VaultView>();
const substreamsStatus: { mode: "substreams" | "rpc"; connected: boolean; headSlot: string | null; error: string | null; endpoint: string } = {
  mode: SUBSTREAMS_TOKEN ? "substreams" : "rpc",
  connected: false,
  headSlot: null,
  error: null,
  endpoint: SUBSTREAMS_TOKEN ? SUBSTREAMS_ENDPOINT : RPC_URL,
};

function policyView(state: VaultState): PolicyView {
  return {
    vault: state.address.toBase58(),
    programId: SHIELD_PROGRAM_ID.toBase58(),
    lossTriggerUsdc: state.lossTriggerUsdc,
    lossCooldownSecs: state.lossCooldownSecs,
    cooldownUntil: state.cooldownUntil,
    lastVerdictNonce: state.lastVerdictNonce,
  };
}

async function discoverVaults(): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(SHIELD_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58Encode(accountDiscriminator("Vault")) } }],
  });
  return accounts.map((a) => a.pubkey);
}

async function syncVault(vaultPk: PublicKey): Promise<VaultView | null> {
  const key = vaultPk.toBase58();
  const state = await fetchVault(connection, vaultPk);
  if (!state) return null;
  const [vaultAta] = vaultTokenAccountPda(vaultPk);
  const [balanceInfo, proposals, registry] = await Promise.all([
    getAccount(connection, vaultAta, "confirmed").catch(() => null),
    fetchAllProposals(connection, vaultPk),
    fetchRegistry(connection, vaultPk),
  ]);
  const balance = balanceInfo?.amount ?? 0n;

  const rec = store.vault(key);
  try {
    const synced = await syncVaultViaRpc(connection, vaultPk, vaultAta, registry, rec.rpcCursor);
    // In Substreams mode the stream owns flows; RPC still feeds the activity feed.
    if (substreamsStatus.mode === "rpc") store.addFlows(key, synced.flows);
    store.addEvents(key, synced.events);
    rec.rpcCursor = synced.cursor;
    store.touch();
  } catch (e) {
    log(`[${key.slice(0, 6)}] rpc sync error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const profile = deriveProfile(key, rec.flows, now);
  const assessment = assess(profile, policyView(state), now, rec.lastVerdictLossAt);
  const view: VaultView = { key, state, balance, proposals, registry, profile, assessment, lastSyncAt: now, lastError: null };
  views.set(key, view);
  return view;
}

// ---------------------------------------------------------------------
// Monitor: sign + relay verdicts (server path). The CRE workflow produces
// identical verdicts through /api/verdicts.
// ---------------------------------------------------------------------

async function relayVerdict(json: VerdictJson, source: VerdictRecord["source"], headline: string, lines: string[]): Promise<VerdictRecord> {
  const parsed = verdictFromJson(json);
  const record: VerdictRecord = { verdict: json, headline, lines, relayed: false, signature: null, error: null, issuedAt: Number(parsed.issuedAt), source };
  const vaultKey = json.vault;
  const rec = store.vault(vaultKey);
  try {
    if (!verifyVerdictSignature(parsed, parsed.verifier)) throw new Error("signature does not verify against the presented verifier key");
    const payer = await ensureRelayer();
    if (!payer) throw new Error("no funded relayer keypair");
    const ixs = applyRiskVerdictIxs({
      relayer: payer.publicKey,
      vault: new PublicKey(vaultKey),
      verifier: new PublicKey(parsed.verifier),
      verdict: {
        vault: new PublicKey(parsed.vault),
        programId: new PublicKey(parsed.programId),
        nonce: parsed.nonce,
        issuedAt: parsed.issuedAt,
        expiry: parsed.expiry,
        reasonCode: parsed.reasonCode,
        realizedLossUsdc: parsed.realizedLossUsdc,
        evidenceHash: parsed.evidenceHash,
        signature: parsed.signature,
      },
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [payer], { commitment: "confirmed" });
    record.relayed = true;
    record.signature = sig;
    log(`[${vaultKey.slice(0, 6)}] verdict #${json.nonce} relayed: ${sig}`);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
    log(`[${vaultKey.slice(0, 6)}] verdict relay failed: ${record.error}`);
  }
  rec.verdicts.push(record);
  store.touch();
  return record;
}

async function monitorVault(view: VaultView): Promise<VerdictRecord | null> {
  if (!MONITOR_ENABLED || !verifierKeypair) return null;
  const a = view.assessment;
  if (!a.actionable) return null;
  if (!view.state.riskVerifier.equals(verifierKeypair.publicKey)) {
    // This vault trusts a different monitor (e.g. the CRE enclave key); not ours to sign.
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = view.state.lastVerdictNonce + 1n;
  const unsigned = buildUnsignedVerdict(a, policyView(view.state), nonce, now);
  const { verdict, verifier } = signVerdict(unsigned, verifierKeypair.secretKey);
  const json = verdictToJson(verdict, verifier);
  store.putEvidence(toHex(a.evidenceHash), a.evidence);
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

let loopRunning = false;
async function tick() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    const vaults = await discoverVaults();
    for (const v of vaults) {
      try {
        const view = await syncVault(v);
        if (view) {
          const rec = await monitorVault(view);
          if (rec?.relayed) await syncVault(v);
        }
      } catch (e) {
        log(`[${v.toBase58().slice(0, 6)}] sync error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    store.flush();
  } catch (e) {
    log(`tick error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    loopRunning = false;
  }
}

if (SUBSTREAMS_TOKEN) {
  const abort = new AbortController();
  const anyCursor = store.vaultKeys().map((k) => store.vault(k).substreamsCursor).find(Boolean) ?? null;
  runSubstreamsSource(
    {
      token: SUBSTREAMS_TOKEN,
      endpoint: SUBSTREAMS_ENDPOINT,
      spkgPath: SUBSTREAMS_SPKG,
      module: "map_vault_flows",
      startBlock: SUBSTREAMS_START_SLOT,
      cursor: anyCursor,
      onFlows: (flows, cursor, slot) => {
        const byVault = new Map<string, Flow[]>();
        for (const f of flows) byVault.set(f.vault, [...(byVault.get(f.vault) ?? []), f]);
        for (const [vault, list] of byVault) store.addFlows(vault, list);
        for (const k of store.vaultKeys()) store.vault(k).substreamsCursor = cursor;
        substreamsStatus.headSlot = slot.toString();
        if (flows.length) store.touch();
      },
      onUndo: (lastValid) => log(`substreams undo to slot ${lastValid}`),
      onStatus: (s) => {
        substreamsStatus.connected = s.connected;
        substreamsStatus.error = s.error ?? null;
        if (s.headSlot !== undefined) substreamsStatus.headSlot = s.headSlot.toString();
      },
      log,
    },
    abort.signal
  ).catch((e) => log(`substreams source stopped: ${e}`));
}

setInterval(tick, POLL_MS);
tick();

// ---------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(serialize(body)), { status, headers: { "content-type": "application/json", ...CORS } });
const notFound = (what: string) => json({ error: `${what} not found` }, 404);

function viewPayload(v: VaultView) {
  const rec = store.vault(v.key);
  return {
    vault: v.key,
    network: NETWORK,
    programId: SHIELD_PROGRAM_ID.toBase58(),
    state: { ...v.state, address: v.key, authority: v.state.authority.toBase58(), usdcMint: v.state.usdcMint.toBase58(), vaultTokenAccount: v.state.vaultTokenAccount.toBase58(), riskVerifier: v.state.riskVerifier.toBase58(), lastVerdictEvidence: toHex(v.state.lastVerdictEvidence) },
    balance: v.balance,
    proposals: v.proposals.map((p) => ({ ...p, address: p.address.toBase58(), vault: p.vault.toBase58(), action: serializeAction(p) })),
    registry: v.registry.map((r) => ({ ...r, address: r.address.toBase58(), vault: r.vault.toBase58(), owner: r.owner.toBase58(), kind: r.kind === OwnerType.Cold ? "cold" : "execution" })),
    profile: v.profile,
    assessment: { ...v.assessment, evidenceHash: toHex(v.assessment.evidenceHash), reasonLabel: REASON_LABEL[v.assessment.reasonCode] },
    events: rec.events.slice(-200).reverse(),
    verdicts: rec.verdicts.slice(-20).reverse(),
    source: substreamsStatus,
    lastSyncAt: v.lastSyncAt,
  };
}

function serializeAction(p: ProposalState) {
  const a = p.action;
  if (a.kind === "loosen") {
    return {
      kind: a.kind,
      params: { ...a.params, newRiskVerifier: a.params.newRiskVerifier?.toBase58(), registerOwner: a.params.registerOwner?.toBase58() },
    };
  }
  return { ...a, destinationOwner: a.destinationOwner.toBase58() };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
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
        network: NETWORK,
        rpcUrl: RPC_URL,
        programId: SHIELD_PROGRAM_ID.toBase58(),
        source: substreamsStatus,
        substreamsEndpoint: SUBSTREAMS_ENDPOINT,
        spkg: SUBSTREAMS_SPKG,
        monitor: { enabled: MONITOR_ENABLED, verifier: verifierKeypair?.publicKey.toBase58() ?? null },
        demo: DEMO_ENABLED,
        vaults: [...views.keys()],
        usdcMint: [...views.values()][0]?.state.usdcMint.toBase58() ?? null,
        executionWallet: executionKeypair?.publicKey.toBase58() ?? null,
      });
    }

    // Hyperliquid history (public info API): the onboarding insight and the
    // "your pattern" section. No credentials; mainnet by default.
    const hl = path.match(/^\/api\/hyperliquid\/(0x[0-9a-fA-F]{40})$/);
    if (hl && req.method === "GET") {
      const network = (url.searchParams.get("network") === "testnet" ? "testnet" : "mainnet") as HlNetwork;
      try {
        return json(await analyseHyperliquid(hl[1], network));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (path === "/api/vaults") return json([...views.values()].map((v) => ({ vault: v.key, authority: v.state.authority.toBase58(), balance: v.balance })));

    const vaultMatch = path.match(/^\/api\/vault\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\/(.*))?$/);
    if (vaultMatch) {
      const key = vaultMatch[1];
      const sub = vaultMatch[2] ?? "";
      let view = views.get(key);
      if (!view || sub === "refresh" || (req.method === "POST" && sub === "evaluate")) {
        try {
          view = (await syncVault(new PublicKey(key))) ?? undefined;
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 500);
        }
      }
      if (!view) return notFound("vault");
      if (req.method === "POST" && sub === "evaluate") {
        const record = await monitorVault(view);
        if (record?.relayed) view = (await syncVault(new PublicKey(key))) ?? view;
        store.flush();
        return json({ assessment: viewPayload(view).assessment, verdict: record });
      }
      if (sub === "activity") return json(store.vault(key).events.slice(-500).reverse());
      if (sub === "flows") return json({ vault: key, source: substreamsStatus.mode, flows: store.vault(key).flows });
      if (sub === "profile") return json(view.profile);
      return json(viewPayload(view));
    }

    const evidenceMatch = path.match(/^\/api\/evidence\/([0-9a-fA-F]{64})$/);
    if (evidenceMatch) {
      const bundle = store.evidence(evidenceMatch[1].toLowerCase());
      return bundle ? json(bundle) : notFound("evidence");
    }

    if (req.method === "POST" && path === "/api/verdicts") {
      const body = (await readJson(req)) as unknown as { verdict?: VerdictJson; evidence?: unknown; headline?: string; lines?: string[] } & VerdictJson;
      const verdictJson = body.verdict ?? body;
      if (!verdictJson?.vault || !verdictJson?.signature) return json({ error: "expected a signed verdict" }, 400);
      if (body.evidence) store.putEvidence(verdictJson.evidenceHash.toLowerCase(), body.evidence as never);
      const record = await relayVerdict(verdictJson, "cre", body.headline ?? "Verdict relayed from the confidential workflow", body.lines ?? []);
      if (record.relayed) {
        const rec = store.vault(verdictJson.vault);
        rec.lastVerdictLossAt = Math.floor(Date.now() / 1000);
        await syncVault(new PublicKey(verdictJson.vault)).catch(() => null);
      }
      store.flush();
      return json(record, record.relayed ? 200 : 502);
    }

    // ---- Demo helpers (localnet/devnet only): the trading venue stand-in ----
    if (DEMO_ENABLED && req.method === "POST" && path === "/api/demo/return") {
      const body = await readJson(req);
      const vaultKey = String(body.vault ?? "");
      const amountUsdc = Number(body.amountUsdc ?? 0);
      const view = views.get(vaultKey) ?? (await syncVault(new PublicKey(vaultKey)));
      if (!view) return notFound("vault");
      const walletKey = String(body.wallet ?? executionKeypair?.publicKey.toBase58() ?? "");
      if (!executionKeypair || executionKeypair.publicKey.toBase58() !== walletKey) return json({ error: "no demo execution wallet key for that wallet" }, 400);
      const payer = defaultKeypair ?? executionKeypair;
      const mint = view.state.usdcMint;
      const fromAta = getAssociatedTokenAddressSync(mint, executionKeypair.publicKey);
      const [vaultAta] = vaultTokenAccountPda(new PublicKey(vaultKey));
      const raw = BigInt(Math.round(amountUsdc * 1_000_000));
      try {
        // make sure the stand-in has SOL for the fee
        const bal = await connection.getBalance(executionKeypair.publicKey);
        if (bal < 0.005e9) {
          try {
            const s = await connection.requestAirdrop(executionKeypair.publicKey, 1e9);
            await connection.confirmTransaction(s, "confirmed");
          } catch {
            /* devnet faucet may refuse; fall through and let the tx fail loudly */
          }
        }
        const sig = await sendAndConfirmTransaction(
          connection,
          new Transaction().add(createTransferInstruction(fromAta, vaultAta, executionKeypair.publicKey, raw)),
          [executionKeypair],
          { commitment: "confirmed" }
        );
        const refreshed = await syncVault(new PublicKey(vaultKey));
        const record = refreshed ? await monitorVault(refreshed) : null;
        store.flush();
        void payer;
        return json({ signature: sig, verdict: record, assessment: refreshed ? viewPayload(refreshed).assessment : null });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (DEMO_ENABLED && req.method === "POST" && path === "/api/demo/faucet") {
      // Mint test USDC to any owner (the mint authority is the bootstrap key).
      const body = await readJson(req);
      const owner = new PublicKey(String(body.owner));
      const amountUsdc = Number(body.amountUsdc ?? 1000);
      const mintStr = String(body.mint ?? [...views.values()][0]?.state.usdcMint.toBase58() ?? "");
      if (!defaultKeypair || !mintStr) return json({ error: "faucet unavailable" }, 400);
      const mint = new PublicKey(mintStr);
      const ata = getAssociatedTokenAddressSync(mint, owner);
      try {
        const sig = await sendAndConfirmTransaction(
          connection,
          new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(defaultKeypair.publicKey, ata, owner, mint),
            createMintToInstruction(mint, ata, defaultKeypair.publicKey, BigInt(Math.round(amountUsdc * 1_000_000)))
          ),
          [defaultKeypair],
          { commitment: "confirmed" }
        );
        return json({ signature: sig, ata: ata.toBase58(), mint: mintStr });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    return notFound("route");
  },
});

log(`Shield server on http://localhost:${PORT} (${NETWORK} via ${RPC_URL}); source=${substreamsStatus.mode}; monitor=${MONITOR_ENABLED ? verifierKeypair?.publicKey.toBase58() ?? "no verifier key" : "off"}; demo=${DEMO_ENABLED}`);
