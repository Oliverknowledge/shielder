/**
 * The confidential evaluation, written against a tiny I/O interface so the
 * exact same function runs (a) inside the CRE enclave (main.ts adapts
 * `TeeRuntime`) and (b) locally for dry runs and tests (dryrun.ts adapts
 * `fetch`). No CRE types here, no Node built-ins, no nulls in the result.
 */
import { deriveProfile, type Flow, type FlowKind } from "../../server/behaviour";
import { assess, buildUnsignedVerdict, signVerdict, type PolicyView, type VenueLoss } from "../../server/policy";
import { toHex, verdictToJson } from "../../client/verdict";
import { evmAddressOf, evmVerdictToJson, signEvmVerdict } from "./evm-verdict";

export interface EnclaveConfig {
  shieldApiUrl: string;
  programId: string;
  secretId: string;
  deliver: boolean;
  /** "solana" (default) or "evm" (ShieldVault.sol: EIP-712 verdict signed with a secp256k1 key held only in the enclave). */
  chain?: "solana" | "evm";
  chainId?: number;
}

export interface EnclaveIO {
  getSecret(id: string): string;
  get(url: string): { status: number; body: string };
  postJson(url: string, body: string): { status: number; body: string };
  now(): number; // unix seconds
  log(msg: string): void;
}

export interface EvaluationResult {
  vault: string;
  triggered: boolean;
  actionable: boolean;
  realisedLossUsdc: string;
  lossTriggerUsdc: string;
  headline: string;
  evidenceHash: string;
  nonce: string;
  verifier: string;
  relayed: boolean;
  signature: string;
  error: string;
}

interface VaultView {
  state: { lossTriggerUsdc: string; lossCooldownSecs: string; cooldownUntil: string; lastVerdictNonce: string; riskVerifier: string };
  verdicts?: Array<{ relayed: boolean; issuedAt: number }>;
  registry?: Array<{ owner: string; kind: number; route: number; active: boolean }>;
}

interface FlowsView {
  flows: Array<Omit<Flow, "amount"> & { amount: string; kind: FlowKind }>;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out: number[] = [];
  let bits = 0,
    acc = 0;
  for (const ch of clean) {
    acc = ((acc << 6) | B64.indexOf(ch)) >>> 0;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1],
      c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63] + (b === undefined ? "=" : B64[(triple >> 6) & 63]) + (c === undefined ? "=" : B64[triple & 63]);
  }
  return out;
}

/** The venue's own settled PnL over the window, read from its public info API. */
function readVenueLoss(io: EnclaveIO, view: VaultView, config: EnclaveConfig, now: number): VenueLoss | null {
  const host = config.chainId === 999 ? "https://api.hyperliquid.xyz/info" : config.chainId === 998 ? "https://api.hyperliquid-testnet.xyz/info" : null;
  if (!host) return null; // no venue API for this chain (Anvil): flow view only
  const account = (view.registry ?? []).find((r) => r.active && r.kind === 0 && r.route === 1)?.owner;
  if (!account) return null;
  try {
    const since = (now - 86_400) * 1000;
    const res = io.postJson(host, JSON.stringify({ type: "userFillsByTime", user: account, startTime: since }));
    if (res.status < 200 || res.status >= 300) return null;
    const fills = JSON.parse(res.body) as Array<{ closedPnl: string; fee: string; time: number }>;
    let net = 0;
    let lastFillAt: number | null = null;
    for (const f of fills) {
      net += Number(f.closedPnl) - Number(f.fee);
      lastFillAt = Math.max(lastFillAt ?? 0, Math.floor(f.time / 1000));
    }
    const network = config.chainId === 999 ? "mainnet" : "testnet";
    return { source: "hyperliquid", network, account, realisedLossUsdc: net < 0 ? BigInt(Math.round(-net * 1e6)) : 0n, fills: fills.length, lastFillAt };
  } catch {
    return null; // unreachable: fall back to the flow view, never guess
  }
}

export function evaluateVault(io: EnclaveIO, config: EnclaveConfig, vault: string): EvaluationResult {
  if (!vault) throw new Error("trigger payload must include { vault: <address> }");
  const isEvm = config.chain === "evm";

  const secret = io.getSecret(config.secretId);
  const seed = isEvm ? new Uint8Array(0) : base64Decode(secret);
  if (!isEvm && seed.length !== 32) throw new Error("verifier seed must be 32 bytes");
  if (isEvm && !/^0x[0-9a-fA-F]{64}$/.test(secret.trim())) throw new Error("EVM verifier secret must be a 0x-prefixed 32-byte private key");

  const viewRes = io.get(`${config.shieldApiUrl}/api/vault/${vault}`);
  if (viewRes.status < 200 || viewRes.status >= 300) throw new Error(`vault view request failed: ${viewRes.status}`);
  const view = JSON.parse(viewRes.body) as VaultView;
  const flowsRes = io.get(`${config.shieldApiUrl}/api/vault/${vault}/flows`);
  if (flowsRes.status < 200 || flowsRes.status >= 300) throw new Error(`flows request failed: ${flowsRes.status}`);
  const flows: Flow[] = (JSON.parse(flowsRes.body) as FlowsView).flows.map((f) => ({ ...f, amount: BigInt(f.amount) }));

  // 3. Independent derivation + the user's own rule.
  const now = io.now();
  const profile = deriveProfile(vault, flows, now);
  const policy: PolicyView = {
    vault,
    programId: config.programId,
    lossTriggerUsdc: BigInt(view.state.lossTriggerUsdc),
    lossCooldownSecs: BigInt(view.state.lossCooldownSecs),
    cooldownUntil: BigInt(view.state.cooldownUntil),
    lastVerdictNonce: BigInt(view.state.lastVerdictNonce),
  };
  const lastRelayed = (view.verdicts ?? []).filter((v) => v.relayed).map((v) => v.issuedAt);
  const sinceLossAt = lastRelayed.length ? Math.max(...lastRelayed) : 0;

  /**
   * The flow view cannot tell capital that was lost from capital that is still
   * deployed, so on its own it books an open position as a realised loss and can
   * pause a trader the venue says is winning. The server already defers to the
   * venue's own settlement where the venue answers; the enclave has to do the
   * same, or the two signers disagree about the rule and the enclave is the one
   * that signs. It reads the venue directly over its own HTTP capability rather
   * than taking the server's number, which is the whole point of evaluating here.
   *
   * Unreachable venue falls back to the flow view, exactly as the server does:
   * over-counting exposure is the safe direction to be wrong in.
   */
  const venue = readVenueLoss(io, view, config, now);
  const a = assess(profile, policy, now, sinceLossAt, venue);

  io.log(
    `Enclave evaluation: vault=${vault} flows=${flows.length} realisedLoss24h=${a.realizedLossUsdc} trigger=${policy.lossTriggerUsdc} ` +
      `lossStreak=${profile.lossStreak} reloadsAfterLoss=${profile.reloadsAfterLoss7d} triggered=${a.triggered} actionable=${a.actionable}`
  );

  const summary: EvaluationResult = {
    vault,
    triggered: a.triggered,
    actionable: a.actionable,
    realisedLossUsdc: a.realizedLossUsdc.toString(),
    lossTriggerUsdc: policy.lossTriggerUsdc.toString(),
    headline: a.headline,
    evidenceHash: toHex(a.evidenceHash),
    nonce: "",
    verifier: "",
    relayed: false,
    signature: "",
    error: "",
  };
  if (!a.actionable) return summary;

  // 4. Sign inside the enclave.
  let verdictJson: { nonce: string; verifier: string; evidenceHash: string } & Record<string, unknown>;
  if (isEvm) {
    const key = secret.trim();
    const verifierAddr = evmAddressOf(key);
    const ev = { vault, nonce: policy.lastVerdictNonce + 1n, issuedAt: BigInt(now), expiry: BigInt(now + 15 * 60), reasonCode: a.reasonCode, realizedLossUsdc: a.realizedLossUsdc, evidenceHash: `0x${toHex(a.evidenceHash)}` };
    const signature = signEvmVerdict(BigInt(config.chainId ?? 0), config.programId, ev, key);
    verdictJson = evmVerdictToJson(ev, signature, verifierAddr);
  } else {
    const unsigned = buildUnsignedVerdict(a, policy, policy.lastVerdictNonce + 1n, now);
    const { verdict, verifier } = signVerdict(unsigned, seed);
    verdictJson = verdictToJson(verdict, verifier) as unknown as typeof verdictJson;
  }
  if (view.state.riskVerifier && view.state.riskVerifier.toLowerCase() !== verdictJson.verifier.toLowerCase()) {
    io.log(`Enclave key ${verdictJson.verifier} is not the verifier this vault pinned (${view.state.riskVerifier}); the vault would reject it.`);
  }

  // 5. Deliver: only the signed verdict and the public evidence bundle leave.
  let relayed = false;
  let signature = "";
  let error = "";
  if (config.deliver) {
    const res = io.postJson(`${config.shieldApiUrl}/api/verdicts`, JSON.stringify({ verdict: verdictJson, evidence: a.evidence, headline: a.headline, lines: a.lines }));
    try {
      const parsed = JSON.parse(res.body) as { relayed?: boolean; signature?: string | null; error?: string | null };
      relayed = Boolean(parsed.relayed);
      signature = parsed.signature ?? "";
      error = parsed.error ?? (res.status < 300 ? "" : `relayer responded ${res.status}`);
    } catch {
      error = `relayer responded ${res.status}`;
    }
    io.log(`Verdict #${verdictJson.nonce} ${relayed ? `relayed on-chain: ${signature}` : `not relayed: ${error}`}`);
  }

  return { ...summary, nonce: verdictJson.nonce, verifier: verdictJson.verifier, evidenceHash: verdictJson.evidenceHash, relayed, signature, error };
}
