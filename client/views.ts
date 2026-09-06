/**
 * Chain-agnostic view of a Shield vault, shared by the Solana and EVM
 * adapters and consumed by the app. Addresses are strings (base58 or 0x),
 * amounts are bigints in USDC base units (6 decimals), times are unix
 * seconds as bigints. The rule engine's client-side evaluation works on
 * these views so the app never needs to know which chain it is on.
 */

export type Chain = "solana" | "evm";

export enum OwnerKind {
  Execution = 0,
  Cold = 1,
}

/** Where a top-up to an execution destination is delivered (EVM only). */
export enum Route {
  Evm = 0,
  HyperCore = 1,
}

export enum ProposalKind {
  RuleChange = 0,
  TopUp = 1,
  FullExit = 2,
}

export const COOLDOWN_REASON = { NONE: 0, SELF_PAUSE: 1, RISK_VERDICT: 2 } as const;
export const NUM_VELOCITY_BUCKETS = 6;
export const BUCKET_LEN_SECS = 4 * 60 * 60;

export interface VaultView {
  chain: Chain;
  address: string; // vault account (Solana PDA) or the contract address (EVM)
  authority: string;
  usdc: string;
  riskVerifier: string | null;
  protectedFloor: bigint;
  topUpThresholdBps: number;
  emergencyCap: bigint;
  velocityThreshold: bigint;
  lossTriggerUsdc: bigint;
  lossCooldownSecs: bigint;
  topUpCooldownSecs: bigint;
  loosenCooldownSecs: bigint;
  fullExitCooldownSecs: bigint;
  cooldownUntil: bigint;
  cooldownReason: number;
  cooldownSetAt: bigint;
  lastVerdictNonce: bigint;
  lastVerdictReason: number;
  velocityBuckets: bigint[];
  bucketStart: bigint;
  currentBucketIndex: number;
  configVersion: bigint;
  proposalNonceCounter: bigint;
  createdAt: bigint;
}

export interface RegistryView {
  owner: string;
  kind: OwnerKind;
  route: Route;
  active: boolean;
  registeredAt: bigint;
  label: string;
}

export interface LoosenView {
  newProtectedFloor?: bigint;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newLossTriggerUsdc?: bigint;
  newLossCooldownSecs?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
  /** null = remove the monitor */
  newRiskVerifier?: string | null;
  registerOwner?: string;
  registerKind?: OwnerKind;
  registerRoute?: Route;
  registerLabel?: string;
}

export interface TightenView {
  newProtectedFloor?: bigint;
  newTopUpThresholdBps?: number;
  newEmergencyCap?: bigint;
  newVelocityThreshold?: bigint;
  newLossTriggerUsdc?: bigint;
  newLossCooldownSecs?: bigint;
  newTopUpCooldownSecs?: bigint;
  newLoosenCooldownSecs?: bigint;
  newFullExitCooldownSecs?: bigint;
  pauseTopUpsUntil?: bigint;
  setRiskVerifier?: string;
}

export type ProposalActionView =
  | { kind: "loosen"; params: LoosenView }
  | { kind: "topUp"; destinationOwner: string; amount: bigint }
  | { kind: "uninstallVault"; destinationOwner: string }
  | { kind: "coldTransferAboveCap"; destinationOwner: string; amount: bigint };

export interface ProposalView {
  id: string;
  category: ProposalKind;
  action: ProposalActionView;
  nonce: bigint;
  createdAt: bigint;
  executeAfter: bigint;
  expiry: bigint;
  configVersionAtCreation: bigint;
}

export interface WalletBalanceView {
  owner: string;
  label: string;
  kind: OwnerKind;
  route: Route;
  active: boolean;
  /** USDC held by the destination (on-chain balance, or the HyperCore perps balance for HyperCore routes). */
  usdc: bigint | null;
}

export const SHIELD_ERROR_NAMES = [
  "Unauthorized", "ZeroAmount", "InvalidParameter", "VaultExists", "NoVault", "AlreadyRegisteredDifferentType",
  "VaultFundedUseDelayedPath", "DestinationNotExecution", "DestinationNotCold", "AmountExceedsEmergencyCap",
  "VelocityThresholdExceeded", "CooldownActive", "ProtectedFloorBreached", "AmountRequiresGatedTopUp",
  "ProposalNotMatured", "ProposalExpired", "ProposalStale", "NoPendingProposal", "ProposalSlotOccupied",
  "ProposalRequiresRegistrationPath", "ProposalHasNoRegistration", "NoRiskVerifier", "InvalidVerifier",
  "VerdictExpired", "VerdictNotYetValid", "VerdictWrongBinding", "VerdictReplayed", "VerdictBelowLossTrigger",
  "NotATightening", "NotALoosening", "PauseTooLong", "MathOverflow", "WrongMint", "TokenAccountOwnerMismatch",
  "CannotDowngradeExecutionToCold", "FullExitDestinationNotRegisteredCold", "TransferFailed", "Reentrancy",
] as const;
export type ShieldErrorName = (typeof SHIELD_ERROR_NAMES)[number];

export function parseShieldErrorName(input: string): ShieldErrorName | null {
  for (const name of SHIELD_ERROR_NAMES) if (input.includes(name)) return name;
  return null;
}

// ---------------------------------------------------------------------
// Client-side evaluation (mirrors the on-chain checks, in check order)
// ---------------------------------------------------------------------

export function rollingVelocity(v: VaultView, now: bigint): bigint {
  if (v.bucketStart === 0n) return 0n;
  const elapsed = now - v.bucketStart;
  if (elapsed < 0n) return v.velocityBuckets.reduce((a, b) => a + b, 0n);
  const bucketsElapsed = elapsed / BigInt(BUCKET_LEN_SECS);
  if (bucketsElapsed >= BigInt(NUM_VELOCITY_BUCKETS)) return 0n;
  let sum = 0n;
  for (let i = 0; i < NUM_VELOCITY_BUCKETS; i++) {
    let stale = false;
    for (let k = 1n; k <= bucketsElapsed; k++) {
      if ((BigInt(v.currentBucketIndex) + k) % BigInt(NUM_VELOCITY_BUCKETS) === BigInt(i)) stale = true;
    }
    if (!stale) sum += v.velocityBuckets[i];
  }
  return sum;
}

export interface TopUpDecision {
  path: "instant" | "gated" | "blocked";
  reason: ShieldErrorName | null;
  executeAfter?: bigint;
  velocityRemaining: bigint;
  instantThreshold: bigint;
  floorHeadroom: bigint;
}

export function evaluateTopUp(v: VaultView, balance: bigint, amount: bigint, now: bigint): TopUpDecision {
  const velocity = rollingVelocity(v, now);
  const velocityRemaining = v.velocityThreshold > velocity ? v.velocityThreshold - velocity : 0n;
  const instantThreshold = (balance * BigInt(v.topUpThresholdBps)) / 10_000n;
  const floorHeadroom = balance > v.protectedFloor ? balance - v.protectedFloor : 0n;
  const base = { velocityRemaining, instantThreshold, floorHeadroom };
  if (amount <= 0n) return { path: "blocked", reason: "ZeroAmount", ...base };
  // same order as the programs: cooldown, floor, velocity, threshold
  if (now < v.cooldownUntil) return { path: "blocked", reason: "CooldownActive", executeAfter: v.cooldownUntil, ...base };
  if (amount > floorHeadroom) return { path: "blocked", reason: "ProtectedFloorBreached", ...base };
  if (amount > velocityRemaining) return { path: "blocked", reason: "VelocityThresholdExceeded", ...base };
  if (amount >= instantThreshold) return { path: "gated", reason: "AmountRequiresGatedTopUp", executeAfter: now + v.topUpCooldownSecs, ...base };
  return { path: "instant", reason: null, ...base };
}

export const usdcToRaw = (usd: number | string): bigint => {
  const n = typeof usd === "string" ? Number(usd) : usd;
  return BigInt(Math.round(n * 1_000_000));
};
export const rawToUsdc = (raw: bigint): number => Number(raw) / 1_000_000;
