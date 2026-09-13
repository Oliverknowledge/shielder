/**
 * The risk ladder's private half.
 *
 * The chain holds `ladderHash` (a salted commitment), the REDUCED allowance and
 * the REDUCED duration. The threshold that selects REDUCED — how far into a
 * session's realised drawdown the user is prepared to go before their own
 * reload budget shrinks — lives only with the user and inside the enclave.
 * This module is dependency-light on purpose: it runs in the browser, under
 * Bun, and in the CRE enclave's QuickJS.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";

export const TIER_NORMAL = 0;
export const TIER_REDUCED = 1;
export const TIER_LOCKED = 2;
export const TIER_NAME: Record<number, string> = { 0: "NORMAL", 1: "REDUCED", 2: "LOCKED" };
export const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface Ladder {
  v: 1;
  /** Trailing realised session drawdown (USDC raw, 6 dp) at which REDUCED applies. Private. */
  reducedAtUsdc: bigint;
  /** 24h release budget while REDUCED (USDC raw). Public on chain. */
  reducedVelocityThreshold: bigint;
  /** How long REDUCED lasts once set (seconds). Public on chain. */
  tierResetSecs: bigint;
  /** 32-byte salt, so the commitment does not leak a small threshold by brute force. */
  salt: string; // 0x + 64 hex
}

const hexBytes = (h: string): Uint8Array => {
  const s = h.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const word = (n: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0 && v > 0n; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};
const toHex = (b: Uint8Array) => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

/** keccak256(abi.encode(uint64 reducedAtUsdc, uint64 reducedVelocityThreshold, uint64 tierResetSecs, bytes32 salt)) */
export function ladderHashOf(l: Ladder): string {
  const buf = new Uint8Array(128);
  buf.set(word(l.reducedAtUsdc), 0);
  buf.set(word(l.reducedVelocityThreshold), 32);
  buf.set(word(l.tierResetSecs), 64);
  buf.set(hexBytes(l.salt), 96);
  return toHex(keccak_256(buf));
}

export function ladderToJson(l: Ladder): string {
  return JSON.stringify({ v: 1, reducedAtUsdc: l.reducedAtUsdc.toString(), reducedVelocityThreshold: l.reducedVelocityThreshold.toString(), tierResetSecs: l.tierResetSecs.toString(), salt: l.salt });
}

export function ladderFromJson(s: string): Ladder {
  const j = JSON.parse(s) as { v?: number; reducedAtUsdc: string; reducedVelocityThreshold: string; tierResetSecs: string; salt: string };
  if (j.v !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(j.salt ?? "")) throw new Error("ladder: unsupported format");
  return { v: 1, reducedAtUsdc: BigInt(j.reducedAtUsdc), reducedVelocityThreshold: BigInt(j.reducedVelocityThreshold), tierResetSecs: BigInt(j.tierResetSecs), salt: j.salt };
}

/** The rung in force right now, from the vault's public state (mirrors ShieldVault._currentTier). */
export function tierInForce(state: { activeTier: number | string; tierUntil: bigint | string; cooldownUntil: bigint | string }, now: number): number {
  const t = Number(state.activeTier);
  if (t === TIER_LOCKED) return Number(state.cooldownUntil) > now ? TIER_LOCKED : TIER_NORMAL;
  if (t === TIER_REDUCED) return Number(state.tierUntil) > now ? TIER_REDUCED : TIER_NORMAL;
  return TIER_NORMAL;
}

/**
 * Trailing realised session drawdown from the venue's own closed fills:
 * cum(t) = Σ (closedPnl − fee), peak(t) = max(0, max cum(s ≤ t)), drawdown = peak − cum.
 * Equals plain net loss when the session never went positive, and giveback when it did.
 */
export function trailingDrawdownUsdc(fills: Array<{ time: number; closedPnl: string | number; fee: string | number }>): bigint {
  const sorted = [...fills].sort((a, b) => a.time - b.time);
  let cum = 0, peak = 0;
  for (const f of sorted) {
    cum += Number(f.closedPnl) - Number(f.fee);
    if (cum > peak) peak = cum;
  }
  const dd = peak - cum;
  return dd > 0 ? BigInt(Math.round(dd * 1e6)) : 0n;
}

export interface LadderDecision {
  tier: number; // TIER_REDUCED when the ladder selects it, else TIER_NORMAL
  reason: "no-ladder" | "hash-mismatch" | "already-reduced-or-locked" | "below-threshold" | "reduced";
}

/** Pure decision. Never selects LOCKED (that is the public loss rule) and never moves up. */
export function decideLadder(ladder: Ladder | null, onChainHash: string | null, currentTier: number, drawdownUsdc: bigint): LadderDecision {
  if (!ladder) return { tier: TIER_NORMAL, reason: "no-ladder" };
  if (!onChainHash || ladderHashOf(ladder).toLowerCase() !== onChainHash.toLowerCase()) return { tier: TIER_NORMAL, reason: "hash-mismatch" };
  if (currentTier >= TIER_REDUCED) return { tier: TIER_NORMAL, reason: "already-reduced-or-locked" };
  if (drawdownUsdc < ladder.reducedAtUsdc) return { tier: TIER_NORMAL, reason: "below-threshold" };
  return { tier: TIER_REDUCED, reason: "reduced" };
}
