/**
 * The monitor's evaluation policy — shared verbatim by Shield's server
 * (deterministic demo path) and the Chainlink CRE confidential workflow
 * (the tamper-resistant path). Pure functions, no I/O.
 *
 * What it decides: whether the user's OWN on-chain loss rule has been met
 * ("after $X realised losses, pause top-ups for Y hours"). It never picks
 * the duration (the vault does) and it can only ever produce a verdict the
 * vault will use to tighten.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import type { BehaviourProfile } from "./behaviour";
import { encodeVerdictMessage, evidenceHashOf, bs58Decode, VERDICT_TTL_SECS, type SignedVerdict, type UnsignedVerdict } from "../client/verdict";

export const REASON = {
  REALIZED_LOSS: 1,
  LOSS_STREAK: 2,
  RELOAD_AFTER_LOSS: 3,
  VELOCITY_ANOMALY: 4,
} as const;

export const REASON_LABEL: Record<number, string> = {
  1: "Realised loss above your trigger",
  2: "Consecutive losing sessions",
  3: "Reloading right after a loss",
  4: "Unusual funding velocity",
};

export interface PolicyView {
  vault: string; // base58
  programId: string; // base58
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
  cooldownUntil: bigint;
  lastVerdictNonce: bigint;
}

export interface EvidenceBundle {
  version: 1;
  vault: string;
  asOf: number;
  window: "24h";
  realisedLossUsdc: string;
  lossSessions: number;
  lossStreak: number;
  reloadsAfterLoss7d: number;
  velocity24hUsdc: string;
  medianTopUp30dUsdc: string;
  sessions: Array<{
    wallet: string;
    sent: string;
    returned: string;
    net: string;
    openedAt: number;
    lastActivityAt: number;
    signatures: string[];
  }>;
  policy: { lossTriggerUsdc: string; lossCooldownSecs: string };
  /** Present only when the venue's own API contributed to the loss figure. */
  venue?: { source: "hyperliquid"; network: string; account: string; realisedLossUsdc: string; fills: number; lastFillAt: number | null };
}

/**
 * What the trading venue itself says happened on its side.
 *
 * Vault flows can only see a loss once money comes *back* from the venue.
 * Capital deposited into a Hyperliquid account and lost there never returns,
 * so the venue's own realised PnL is the honest evidence for that half. It is
 * read from Hyperliquid's public API, never inferred from HyperEVM.
 */
export interface VenueLoss {
  source: "hyperliquid";
  network: string;
  account: string;
  /** Realised loss over the window in USDC raw units; positive when losing. */
  realisedLossUsdc: bigint;
  fills: number;
  lastFillAt: number | null;
}

export interface Assessment {
  triggered: boolean; // the user's rule is met by the evidence
  actionable: boolean; // triggered AND there is a new loss since the last verdict AND it would extend the cooldown
  realizedLossUsdc: bigint;
  reasonCode: number;
  headline: string;
  lines: string[];
  evidence: EvidenceBundle;
  evidenceHash: Uint8Array;
  newestLossAt: number | null;
}

const usd = (raw: bigint) => {
  const n = Number(raw) / 1_000_000;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const agoLabel = (secs: number) => {
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
};
const hours = (secs: bigint) => {
  const h = Number(secs) / 3600;
  return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)}h`;
};

export function assess(profile: BehaviourProfile, policy: PolicyView, now: number, sinceLossAt = 0, venue?: VenueLoss | null): Assessment {
  const w = profile.windows.h24;
  const flowLoss = w.realisedLoss;
  const venueLoss = venue && venue.realisedLossUsdc > 0n ? venue.realisedLossUsdc : 0n;
  // Two independent views of the same 24 hours: what did not come back to the
  // vault, and what the venue itself settled. Take the larger, never the sum,
  // so a loss that both can see is never double counted.
  const venueDominates = venueLoss > flowLoss;
  const realizedLossUsdc = venueDominates ? venueLoss : flowLoss;
  const triggered = policy.lossTriggerUsdc > 0n && realizedLossUsdc >= policy.lossTriggerUsdc;

  const newestLossAt = venueDominates ? (venue?.lastFillAt ?? profile.lastLossAt) : profile.lastLossAt;
  const newLoss = newestLossAt !== null && newestLossAt > sinceLossAt;
  const target = BigInt(now) + policy.lossCooldownSecs;
  const wouldExtend = policy.lossCooldownSecs > 0n && target > policy.cooldownUntil;
  const actionable = triggered && newLoss && wouldExtend;

  let reasonCode: number = REASON.REALIZED_LOSS;
  if (profile.reloadsAfterLoss7d > 0) reasonCode = REASON.RELOAD_AFTER_LOSS;
  else if (profile.lossStreak >= 2) reasonCode = REASON.LOSS_STREAK;

  const lines: string[] = [];
  const sessionsInWindow = profile.sessions.filter((s) => s.realised && s.lastActivityAt >= now - 86400);
  for (const s of sessionsInWindow.slice(-3)) {
    const ago = agoLabel(now - s.lastActivityAt);
    lines.push(
      s.net < 0n
        ? `Sent ${usd(s.sent)}, ${usd(s.returned)} came back: ${usd(-s.net)} lost, ${ago}.`
        : `Sent ${usd(s.sent)}, ${usd(s.returned)} came back: ${usd(s.net)} gained, ${ago}.`
    );
  }
  if (venueLoss > 0n) lines.push(`${usd(venueLoss)} realised on Hyperliquid ${venue!.network} over ${venue!.fills} fill${venue!.fills === 1 ? "" : "s"}, read from the venue's own API.`);
  if (profile.lossStreak >= 2) lines.push(`${profile.lossStreak} losing sessions in a row.`);
  if (profile.reloadsAfterLoss7d > 0) lines.push(`Reloaded within 3 hours of a loss ${profile.reloadsAfterLoss7d} time${profile.reloadsAfterLoss7d === 1 ? "" : "s"} this week.`);

  const headline = triggered
    ? `You realised ${usd(realizedLossUsdc)} in losses in the last 24 hours. Your rule pauses new capital for ${hours(policy.lossCooldownSecs)}.`
    : `Realised losses in the last 24 hours: ${usd(realizedLossUsdc)}, below your ${usd(policy.lossTriggerUsdc)} trigger.`;

  const evidence: EvidenceBundle = {
    version: 1,
    vault: profile.vault,
    asOf: now,
    window: "24h",
    realisedLossUsdc: realizedLossUsdc.toString(),
    lossSessions: w.lossSessions,
    lossStreak: profile.lossStreak,
    reloadsAfterLoss7d: profile.reloadsAfterLoss7d,
    velocity24hUsdc: profile.velocity24h.toString(),
    medianTopUp30dUsdc: profile.medianTopUp30d.toString(),
    sessions: sessionsInWindow.map((s) => ({
      wallet: s.wallet,
      sent: s.sent.toString(),
      returned: s.returned.toString(),
      net: s.net.toString(),
      openedAt: s.openedAt,
      lastActivityAt: s.lastActivityAt,
      signatures: s.signatures,
    })),
    policy: { lossTriggerUsdc: policy.lossTriggerUsdc.toString(), lossCooldownSecs: policy.lossCooldownSecs.toString() },
    // Only when the venue reading is the one the verdict rests on: otherwise a
    // reachable-or-not venue would change the hash of identical evidence.
    ...(venueDominates
      ? { venue: { source: "hyperliquid" as const, network: venue!.network, account: venue!.account, realisedLossUsdc: venueLoss.toString(), fills: venue!.fills, lastFillAt: venue!.lastFillAt } }
      : {}),
  };

  return {
    triggered,
    actionable,
    realizedLossUsdc,
    reasonCode,
    headline,
    lines,
    evidence,
    evidenceHash: evidenceHashOf(evidence),
    newestLossAt,
  };
}

export function buildUnsignedVerdict(a: Assessment, policy: PolicyView, nonce: bigint, now: number): UnsignedVerdict {
  return {
    vault: bs58Decode(policy.vault),
    programId: bs58Decode(policy.programId),
    nonce,
    issuedAt: BigInt(now),
    expiry: BigInt(now + VERDICT_TTL_SECS),
    reasonCode: a.reasonCode,
    realizedLossUsdc: a.realizedLossUsdc,
    evidenceHash: a.evidenceHash,
  };
}

/** Sign with an Ed25519 secret (32-byte seed or 64-byte Solana secret key). */
export function signVerdict(unsigned: UnsignedVerdict, secretKey: Uint8Array): { verdict: SignedVerdict; verifier: Uint8Array; message: Uint8Array } {
  const seed = secretKey.length === 64 ? secretKey.subarray(0, 32) : secretKey;
  const message = encodeVerdictMessage(unsigned);
  const signature = ed25519.sign(message, seed);
  const verifier = ed25519.getPublicKey(seed);
  return { verdict: { ...unsigned, signature }, verifier, message };
}

export function verifyVerdictSignature(v: SignedVerdict, verifier: Uint8Array): boolean {
  return ed25519.verify(v.signature, encodeVerdictMessage(v), verifier);
}
