/**
 * The vault's rules as plain-English sentences, plus the mapping from a
 * sentence's value back to the program's tighten/loosen parameters.
 */
import { OwnerKind, usdcToRaw, type LoosenView as LoosenParams, type TightenView as TightenParams, type VaultView as VaultState } from "../../../client/views";
import { usd, hoursLabel, short, rawToNumber } from "./format";

export type RuleKey = "floor" | "daily" | "threshold" | "lossTrigger" | "lossCooldown" | "cap" | "loosenDelay" | "exitDelay";

export interface RuleDef {
  key: RuleKey;
  name: string;
  kind: "usd" | "pct" | "hours" | "days";
  /** Is a higher value the stricter one? */
  strictIsHigher: boolean;
  current: (v: VaultState) => number;
  /** Sentence around the value: before + <value> + after. */
  before: string;
  after: string;
  why: string;
  /**
   * The largest value the app will submit, in the rule's own unit.
   *
   * Tightening is instant and irreversible except through the loosen path, and
   * ShieldVault.sol bounds only the loss cooldown (30 days). Nothing in the
   * contract stops someone setting a weakening delay or an exit delay of a
   * thousand years, which would silently destroy the one promise Shield makes
   * unconditionally: that you can always get your money out. The contract
   * cannot be changed, so the app refuses to be the instrument.
   */
  max?: number;
  maxWhy?: string;
}

export const RULES: RuleDef[] = [
  { key: "floor", name: "Protected floor", kind: "usd", strictIsHigher: true, current: (v) => rawToNumber(v.protectedFloor), before: "Never let a release take my treasury below ", after: ".", why: "Only a full exit, after its delay, can go under the floor." },
  { key: "daily", name: "Daily reload", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.velocityThreshold), before: "Release at most ", after: " to my trading account in any 24 hours.", why: "Added up across every release inside a rolling 24 hours. It has two disclosed defects and is not a hard bound — your floor is: nothing takes the treasury below it except a full exit, after its delay. See docs/THREAT_MODEL.md." },
  { key: "lossTrigger", name: "Loss trigger", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.lossTriggerUsdc), before: "After I lose ", after: " or more in a day, release no new capital.", why: "Measured from what comes back on-chain and from what the venue itself settled." },
  { key: "lossCooldown", name: "Pause after losses", kind: "hours", strictIsHigher: true, current: (v) => Number(v.lossCooldownSecs) / 3600, before: "Keep new capital blocked for ", after: " after that.", why: "The vault sets the length itself; the monitor can't choose it.", max: 720, maxWhy: "The contract refuses anything over 30 days." },
  { key: "threshold", name: "Large release pause", kind: "pct", strictIsHigher: false, current: (v) => v.topUpThresholdBps / 100, before: "Make any single release worth ", after: " of the treasury or more wait 30 minutes.", why: "A short pause before big moves. Cancel it any time." },
  { key: "cap", name: "Instant safe-wallet cap", kind: "usd", strictIsHigher: false, current: (v) => rawToNumber(v.emergencyCap), before: "Let up to ", after: " move to my safe wallet instantly, even during a cooldown.", why: "It comes out of the same 24-hour budget as a release and cannot take you below your floor. Larger amounts, or a spent budget, take the exit path." },
  { key: "loosenDelay", name: "Weakening delay", kind: "hours", strictIsHigher: true, current: (v) => Number(v.loosenCooldownSecs) / 3600, before: "Make any weakening of these rules wait ", after: ".", why: "Never less than 1 hour. Tightening never waits.", max: 168, maxWhy: "Capped at 7 days. A longer wait would also apply to shortening it again, so a slip here is not undoable." },
  { key: "exitDelay", name: "Exit delay", kind: "days", strictIsHigher: true, current: (v) => Number(v.fullExitCooldownSecs) / 86400, before: "Make leaving Shield take ", after: ".", why: "Your whole balance goes to a safe wallet you registered. Cancel any time before.", max: 30, maxWhy: "Capped at 30 days, so that leaving is always something you can actually wait out." },
];

export const ruleByKey = (k: RuleKey): RuleDef => RULES.find((r) => r.key === k)!;

export function paramFor(key: RuleKey, value: number): { tighten: TightenParams; loosen: LoosenParams } {
  switch (key) {
    case "floor": return { tighten: { newProtectedFloor: usdcToRaw(value) }, loosen: { newProtectedFloor: usdcToRaw(value) } };
    case "daily": return { tighten: { newVelocityThreshold: usdcToRaw(value) }, loosen: { newVelocityThreshold: usdcToRaw(value) } };
    case "threshold": return { tighten: { newTopUpThresholdBps: Math.round(value * 100) }, loosen: { newTopUpThresholdBps: Math.round(value * 100) } };
    case "lossTrigger": return { tighten: { newLossTriggerUsdc: usdcToRaw(value) }, loosen: { newLossTriggerUsdc: usdcToRaw(value) } };
    case "lossCooldown": return { tighten: { newLossCooldownSecs: BigInt(Math.round(value * 3600)) }, loosen: { newLossCooldownSecs: BigInt(Math.round(value * 3600)) } };
    case "cap": return { tighten: { newEmergencyCap: usdcToRaw(value) }, loosen: { newEmergencyCap: usdcToRaw(value) } };
    case "loosenDelay": return { tighten: { newLoosenCooldownSecs: BigInt(Math.round(value * 3600)) }, loosen: { newLoosenCooldownSecs: BigInt(Math.round(value * 3600)) } };
    case "exitDelay": return { tighten: { newFullExitCooldownSecs: BigInt(Math.round(value * 86400)) }, loosen: { newFullExitCooldownSecs: BigInt(Math.round(value * 86400)) } };
  }
}

export function fmtRule(def: Pick<RuleDef, "kind">, value: number): string {
  if (def.kind === "usd") return usd(value);
  if (def.kind === "pct") return `${value}%`;
  if (def.kind === "hours") return hoursLabel(value * 3600);
  return `${value} day${value === 1 ? "" : "s"}`;
}

export const isStricter = (def: RuleDef, from: number, to: number): boolean => (def.strictIsHigher ? to > from : to < from);

export interface ChangeLine {
  name: string;
  from: string | null;
  to: string;
}

/** A pending weakening proposal, as "name: from → to" lines. */
export function describeLoosen(p: LoosenParams, v: VaultState | null): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const cur = (k: RuleKey) => (v ? fmtRule(ruleByKey(k), ruleByKey(k).current(v)) : null);
  if (p.newProtectedFloor !== undefined) lines.push({ name: "Protected floor", from: cur("floor"), to: usd(p.newProtectedFloor) });
  if (p.newVelocityThreshold !== undefined) lines.push({ name: "Daily reload", from: cur("daily"), to: usd(p.newVelocityThreshold) });
  if (p.newTopUpThresholdBps !== undefined) lines.push({ name: "Large release pause", from: cur("threshold"), to: `${p.newTopUpThresholdBps / 100}%` });
  if (p.newLossTriggerUsdc !== undefined) lines.push({ name: "Loss trigger", from: cur("lossTrigger"), to: usd(p.newLossTriggerUsdc) });
  if (p.newLossCooldownSecs !== undefined) lines.push({ name: "Pause after losses", from: cur("lossCooldown"), to: hoursLabel(p.newLossCooldownSecs) });
  if (p.newEmergencyCap !== undefined) lines.push({ name: "Instant safe-wallet cap", from: cur("cap"), to: usd(p.newEmergencyCap) });
  if (p.newLoosenCooldownSecs !== undefined) lines.push({ name: "Weakening delay", from: cur("loosenDelay"), to: hoursLabel(p.newLoosenCooldownSecs) });
  if (p.newFullExitCooldownSecs !== undefined) lines.push({ name: "Exit delay", from: cur("exitDelay"), to: hoursLabel(p.newFullExitCooldownSecs) });
  if (p.newRiskVerifier !== undefined) lines.push(p.newRiskVerifier === null ? { name: "Monitor", from: "on", to: "off" } : { name: "Monitor", from: null, to: short(p.newRiskVerifier) });
  if (p.registerOwner) lines.push({ name: p.registerKind === OwnerKind.Cold ? "New safe wallet" : "New trading account", from: null, to: p.registerLabel || short(p.registerOwner) });
  return lines.length ? lines : [{ name: "Rule change", from: null, to: "" }];
}
