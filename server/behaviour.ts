/**
 * Behavioural derivation: turns a vault's capital flows (from the Substreams
 * `map_vault_flows` module, or the RPC fallback that produces the same
 * records) into the numbers Shield shows and acts on.
 *
 * Everything here is pure and deterministic, so the monitor, the CRE
 * workflow and the UI all agree on what "realised loss" means. The
 * definitions are deliberately narrow and defensible on devnet where no
 * DEX history exists:
 *
 *   session   = the top-ups sent to one execution wallet, then everything
 *               that wallet sends back before the next top-up
 *   net flow  = returned - sent for a session (negative = money did not
 *               come back)
 *   realised  = a session counts as realised only once at least one return
 *               has arrived; money still sitting in the venue is exposure,
 *               not loss
 */

export type FlowKind = "TOP_UP_INSTANT" | "TOP_UP_GATED" | "COLD_TRANSFER" | "FULL_EXIT" | "RETURN" | "DEPOSIT";

export interface Flow {
  slot: number;
  signature: string;
  blockTime: number; // unix seconds
  vault: string;
  kind: FlowKind;
  outbound: boolean;
  counterparty: string;
  amount: bigint; // raw USDC (6 dp)
  counterpartyIsExecution: boolean;
}

export interface Session {
  wallet: string;
  openedAt: number;
  lastActivityAt: number;
  sent: bigint;
  returned: bigint;
  net: bigint; // returned - sent
  topUps: number;
  returns: number;
  realised: boolean; // at least one return has come back
  isLoss: boolean; // realised && net < 0
  signatures: string[];
}

export interface WalletSummary {
  owner: string;
  sent: bigint;
  returned: bigint;
  net: bigint;
  topUpCount: number;
  returnCount: number;
  lastTopUpAt: number | null;
  lastReturnAt: number | null;
  medianTopUp: bigint;
  openExposure: bigint; // sent - returned in the current (unrealised) session
}

export interface WindowStats {
  hours: number;
  sent: bigint;
  returned: bigint;
  realisedLoss: bigint; // sum of |net| over loss sessions realised in the window
  realisedGain: bigint;
  topUpCount: number;
  lossSessions: number;
}

export interface BehaviourProfile {
  vault: string;
  asOf: number;
  totals: { sent: bigint; returned: bigint; net: bigint; deposited: bigint; exited: bigint };
  wallets: WalletSummary[];
  sessions: Session[];
  windows: { h24: WindowStats; d7: WindowStats; d30: WindowStats };
  velocity24h: bigint; // outbound top-ups + capped cold transfers in the last 24h
  medianTopUp30d: bigint;
  lossStreak: number; // consecutive realised loss sessions, most recent first, within 7d
  reloadsAfterLoss7d: number; // top-ups within RELOAD_WINDOW of a loss being realised
  lastLossAt: number | null;
  lastLossAmount: bigint;
  timeline: Flow[];
}

export const RELOAD_WINDOW_SECS = 3 * 3600;
const H = 3600;
const D = 24 * H;

const isTopUp = (f: Flow) => f.kind === "TOP_UP_INSTANT" || f.kind === "TOP_UP_GATED";

export function median(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2n : s[mid];
}

/** Group a wallet's flows into sessions (see module doc). */
export function buildSessions(flows: Flow[]): Session[] {
  const byWallet = new Map<string, Flow[]>();
  for (const f of flows) {
    if (!isTopUp(f) && f.kind !== "RETURN") continue;
    const list = byWallet.get(f.counterparty) ?? [];
    list.push(f);
    byWallet.set(f.counterparty, list);
  }
  const sessions: Session[] = [];
  for (const [wallet, list] of byWallet) {
    list.sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
    let current: Session | null = null;
    for (const f of list) {
      const topUp = isTopUp(f);
      if (topUp && current && current.returns > 0) {
        sessions.push(current);
        current = null;
      }
      if (!current) {
        if (!topUp) continue; // a return with no preceding top-up is just a deposit
        current = {
          wallet,
          openedAt: f.blockTime,
          lastActivityAt: f.blockTime,
          sent: 0n,
          returned: 0n,
          net: 0n,
          topUps: 0,
          returns: 0,
          realised: false,
          isLoss: false,
          signatures: [],
        };
      }
      if (topUp) {
        current.sent += f.amount;
        current.topUps += 1;
      } else {
        current.returned += f.amount;
        current.returns += 1;
        current.realised = true;
      }
      current.lastActivityAt = f.blockTime;
      current.net = current.returned - current.sent;
      current.isLoss = current.realised && current.net < 0n;
      current.signatures.push(f.signature);
    }
    if (current) sessions.push(current);
  }
  sessions.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  return sessions;
}

function windowStats(flows: Flow[], sessions: Session[], now: number, hours: number): WindowStats {
  const from = now - hours * H;
  const inWindow = flows.filter((f) => f.blockTime >= from);
  let sent = 0n,
    returned = 0n,
    topUpCount = 0;
  for (const f of inWindow) {
    if (isTopUp(f)) {
      sent += f.amount;
      topUpCount += 1;
    } else if (f.kind === "RETURN") returned += f.amount;
  }
  let realisedLoss = 0n,
    realisedGain = 0n,
    lossSessions = 0;
  for (const s of sessions) {
    if (!s.realised || s.lastActivityAt < from) continue;
    if (s.net < 0n) {
      realisedLoss += -s.net;
      lossSessions += 1;
    } else realisedGain += s.net;
  }
  return { hours, sent, returned, realisedLoss, realisedGain, topUpCount, lossSessions };
}

export function deriveProfile(vault: string, flowsIn: Flow[], now: number): BehaviourProfile {
  const flows = [...flowsIn].sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot);
  const sessions = buildSessions(flows);

  const totals = { sent: 0n, returned: 0n, net: 0n, deposited: 0n, exited: 0n };
  const walletMap = new Map<string, WalletSummary & { topUps: bigint[] }>();
  for (const f of flows) {
    if (isTopUp(f) || f.kind === "RETURN") {
      const w = walletMap.get(f.counterparty) ?? {
        owner: f.counterparty,
        sent: 0n,
        returned: 0n,
        net: 0n,
        topUpCount: 0,
        returnCount: 0,
        lastTopUpAt: null,
        lastReturnAt: null,
        medianTopUp: 0n,
        openExposure: 0n,
        topUps: [],
      };
      if (isTopUp(f)) {
        w.sent += f.amount;
        w.topUpCount += 1;
        w.lastTopUpAt = f.blockTime;
        w.topUps.push(f.amount);
        totals.sent += f.amount;
      } else {
        w.returned += f.amount;
        w.returnCount += 1;
        w.lastReturnAt = f.blockTime;
        totals.returned += f.amount;
      }
      w.net = w.returned - w.sent;
      walletMap.set(f.counterparty, w);
    } else if (f.kind === "DEPOSIT") totals.deposited += f.amount;
    else totals.exited += f.amount;
  }
  totals.net = totals.returned - totals.sent;

  const wallets: WalletSummary[] = [...walletMap.values()].map((w) => {
    const open = sessions.filter((s) => s.wallet === w.owner && !s.realised);
    const openExposure = open.reduce((a, s) => a + s.sent, 0n);
    const { topUps, ...rest } = w;
    return { ...rest, medianTopUp: median(topUps), openExposure };
  });

  const h24 = windowStats(flows, sessions, now, 24);
  const d7 = windowStats(flows, sessions, now, 24 * 7);
  const d30 = windowStats(flows, sessions, now, 24 * 30);

  const velocity24h = flows
    .filter((f) => f.blockTime >= now - D && (isTopUp(f) || f.kind === "COLD_TRANSFER"))
    .reduce((a, f) => a + f.amount, 0n);
  const medianTopUp30d = median(flows.filter((f) => isTopUp(f) && f.blockTime >= now - 30 * D).map((f) => f.amount));

  // Loss streak: walk realised sessions newest-first inside the 7-day window.
  const realised = sessions.filter((s) => s.realised).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  let lossStreak = 0;
  for (const s of realised) {
    if (s.lastActivityAt < now - 7 * D) break;
    if (s.isLoss) lossStreak += 1;
    else break;
  }
  const lastLoss = realised.find((s) => s.isLoss) ?? null;

  // Reload after loss: a top-up inside RELOAD_WINDOW after a loss was realised.
  const lossTimes = realised.filter((s) => s.isLoss && s.lastActivityAt >= now - 7 * D).map((s) => s.lastActivityAt);
  const reloadsAfterLoss7d = flows.filter(
    (f) => isTopUp(f) && lossTimes.some((t) => f.blockTime > t && f.blockTime - t <= RELOAD_WINDOW_SECS)
  ).length;

  return {
    vault,
    asOf: now,
    totals,
    wallets,
    sessions,
    windows: { h24, d7, d30 },
    velocity24h,
    medianTopUp30d,
    lossStreak,
    reloadsAfterLoss7d,
    lastLossAt: lastLoss?.lastActivityAt ?? null,
    lastLossAmount: lastLoss ? -lastLoss.net : 0n,
    timeline: flows.slice(-100).reverse(),
  };
}

/** JSON-safe view (bigint -> string). */
export function serialize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
