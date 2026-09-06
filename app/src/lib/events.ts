/** Human descriptions of on-chain vault events (server/index.ts decodes them). */
import type { EventJson } from "./api";
import type { Tone } from "../components/ui";
import { usd, clockTime, dateTime } from "./format";

export interface EventView {
  title: string;
  body: string;
  tone: Tone;
  category: string;
  amount?: { text: string; tone: Tone };
}

interface PolicySnapshot {
  protectedFloor?: string;
  velocityThreshold?: string;
  topUpThresholdBps?: number;
  lossTriggerUsdc?: string;
  lossCooldownSecs?: number;
  cooldownUntil?: number;
}

/**
 * Describe a list of events (newest first). Walks oldest→newest so a
 * "Protection tightened" row can say what changed and whether a pause was set.
 */
export function describeEvents(eventsDesc: EventJson[], labelOf: (owner: string) => string, now: number): EventView[] {
  const out: EventView[] = new Array(eventsDesc.length);
  let snap: PolicySnapshot = {};
  for (let i = eventsDesc.length - 1; i >= 0; i--) {
    const e = eventsDesc[i];
    out[i] = describeEvent(e, labelOf, now, snap);
    const d = e.data;
    if (e.name === "VaultInitialized") snap = { protectedFloor: String(d.protectedFloor), velocityThreshold: String(d.velocityThreshold) };
    if (e.name === "PolicyTightened")
      snap = {
        protectedFloor: String(d.protectedFloor),
        velocityThreshold: String(d.velocityThreshold),
        topUpThresholdBps: Number(d.topUpThresholdBps),
        lossTriggerUsdc: String(d.lossTriggerUsdc),
        lossCooldownSecs: Number(d.lossCooldownSecs),
        cooldownUntil: Number(d.cooldownUntil),
      };
    if (e.name === "RiskVerdictApplied") snap = { ...snap, cooldownUntil: Number(d.cooldownUntil) };
  }
  return out;
}

export function describeEvent(e: EventJson, labelOf: (owner: string) => string, now: number, prev?: PolicySnapshot): EventView {
  const d = e.data;
  const s = (k: string) => String(d[k] ?? "");
  const n = (k: string) => Number(d[k] ?? 0);
  switch (e.name) {
    case "VaultInitialized":
      return { title: "Shield activated", body: `Floor ${usd(s("protectedFloor"))} · daily limit ${usd(s("velocityThreshold"))}`, tone: "protect", category: "Activated" };
    case "Deposited":
      return { title: `Deposited ${usd(s("amount"))}`, body: `Treasury now ${usd(s("newBalance"))}`, tone: "protect", category: "Deposit", amount: { text: `+${usd(s("amount"))}`, tone: "protect" } };
    case "RegistrationChanged":
    {
      const cold = Number(d.kind) === 1;
      // A HyperCore destination is the venue itself, so it is named after the
      // venue rather than whatever label the registration was created with.
      const who = !cold && Number(d.route) === 1 ? "Hyperliquid" : s("label") || labelOf(s("owner"));
      return {
        title: d.active ? `${who} connected` : `${who} disconnected`,
        body: d.active
          ? cold
            ? "Your safe wallet: where you can exit to"
            : "Your trading account: the only place Shield can release capital to"
          : "Shield can no longer send here",
        tone: d.active ? "neutral" : "protect",
        category: cold ? "Safe wallet" : "Trading account",
      };
    }
    case "PolicyTightened":
    {
      const parts: string[] = [];
      if (prev) {
        if (prev.protectedFloor !== undefined && prev.protectedFloor !== s("protectedFloor")) parts.push(`floor ${usd(prev.protectedFloor)} → ${usd(s("protectedFloor"))}`);
        if (prev.velocityThreshold !== undefined && prev.velocityThreshold !== s("velocityThreshold")) parts.push(`daily limit ${usd(prev.velocityThreshold)} → ${usd(s("velocityThreshold"))}`);
        if (prev.topUpThresholdBps !== undefined && prev.topUpThresholdBps !== n("topUpThresholdBps")) parts.push(`large releases wait from ${n("topUpThresholdBps") / 100}%`);
        if (prev.lossTriggerUsdc !== undefined && prev.lossTriggerUsdc !== s("lossTriggerUsdc")) parts.push(`loss trigger ${usd(prev.lossTriggerUsdc)} → ${usd(s("lossTriggerUsdc"))}`);
        if (prev.lossCooldownSecs !== undefined && prev.lossCooldownSecs !== n("lossCooldownSecs")) parts.push(`pause after losses now ${Math.round(n("lossCooldownSecs") / 3600)}h`);
        if (n("cooldownUntil") > (prev.cooldownUntil ?? 0) && n("cooldownUntil") > e.blockTime) parts.push(`new capital paused until ${clockTime(n("cooldownUntil"), now)}`);
      }
      const what = parts.length ? parts.join(" · ") : "a rule made stricter";
      return { title: "Protection tightened", body: `${what.charAt(0).toUpperCase()}${what.slice(1)} · applied instantly`, tone: "protect", category: "Tightened" };
    }
    case "LoosenProposed":
      return { title: "Weakening change scheduled", body: `Activates ${dateTime(n("executeAfter"))} · current rules stay active until then`, tone: "pending", category: "Scheduled" };
    case "LoosenExecuted":
      return { title: "Weakening change applied", body: "The waiting period passed and you applied it", tone: "neutral", category: "Applied" };
    case "ProposalCancelled":
      return { title: "Change cancelled", body: "Nothing changed", tone: "protect", category: "Cancelled" };
    case "TopUpExecuted":
      return { title: `Released ${usd(s("amount"))} to ${labelOf(s("destinationOwner"))}`, body: `${d.instant ? "Instant" : "After the 30-minute wait"} · ${usd(s("velocityAfter"))} of today's limit used`, tone: "bankroll", category: "Released", amount: { text: `−${usd(s("amount"))}`, tone: "neutral" } };
    case "TopUpProposed":
      return { title: `Large release of ${usd(s("amount"))} scheduled`, body: `Can move ${clockTime(n("executeAfter"), now)}`, tone: "pending", category: "Scheduled" };
    case "ColdTransferExecuted":
      return { title: `Moved ${usd(s("amount"))} to ${labelOf(s("destinationOwner"))}`, body: "Instant, within your safe-wallet cap", tone: "protect", category: "Safe wallet", amount: { text: `−${usd(s("amount"))}`, tone: "neutral" } };
    case "FullExitProposed":
      return { title: d.uninstall ? "Exit from Shield scheduled" : `Withdrawal of ${usd(s("amount"))} scheduled`, body: `Executes ${dateTime(n("executeAfter"))} · every rule stays in force until then`, tone: "pending", category: "Scheduled" };
    case "FullExitExecuted":
      return { title: `Exited ${usd(s("amount"))} to ${labelOf(s("destinationOwner"))}`, body: "The waiting period passed", tone: "neutral", category: "Exit", amount: { text: `−${usd(s("amount"))}`, tone: "neutral" } };
    case "RiskVerdictApplied":
      return {
        title: "Loss rule paused new capital",
        body: `${usd(s("realizedLossUsdc"))} realised, above your trigger · ${d.extended ? "paused until" : "already paused until"} ${clockTime(n("cooldownUntil"), now)} · verdict #${s("nonce")}`,
        tone: "blocked",
        category: "Cooldown",
      };
    default:
      return { title: e.name, body: "", tone: "neutral", category: "Event" };
  }
}
