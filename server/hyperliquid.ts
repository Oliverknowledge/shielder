/**
 * Hyperliquid history analyser.
 *
 * Reads a Hyperliquid account's public history (ledger updates: deposits,
 * withdrawals, transfers; and fills) from the official info API, mainnet or
 * testnet, with no credentials, and derives the behavioural facts Shield
 * shows during onboarding and on the Behaviour screen. Only claims the data
 * supports: sessions are bounded by capital in/out; realised PnL comes from
 * the venue's own closedPnl.
 */

export type HlNetwork = "mainnet" | "testnet";

const API: Record<HlNetwork, string> = {
  mainnet: "https://api.hyperliquid.xyz/info",
  testnet: "https://api.hyperliquid-testnet.xyz/info",
};

export interface LedgerUpdate {
  time: number;
  hash: string;
  delta: { type: string; usdc?: string; user?: string; destination?: string; toPerp?: boolean; amount?: string; usdcValue?: string; token?: string };
}

export interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  closedPnl: string;
  fee: string;
  hash: string;
  dir: string;
}

export interface HlSession {
  openedAt: number;
  closedAt: number | null;
  deployed: number; // USD deposited into the account during the session
  returned: number; // USD withdrawn at the end (0 if still open)
  realisedPnl: number; // sum of closedPnl minus fees, from fills in the session
  fills: number;
  reloads: number; // deposits after the first one, within the session
  reloadsAfterLoss: number; // deposits made while the session's running PnL was negative
  firstLossAt: number | null;
  firstReloadAfterLossAt: number | null;
  hashes: string[];
}

export interface HlProfile {
  address: string;
  network: HlNetwork;
  asOf: number;
  sessions: HlSession[];
  totals: { deposited: number; withdrawn: number; realisedPnl: number; fills: number; sessions: number };
  typicalSessionSize: number | null; // median deployed
  largestLosingSession: { pnl: number; deployed: number; openedAt: number } | null;
  sessionsWithReloadAfterLoss: number;
  sessionsWithTwoPlusReloads: number;
  medianMinutesToReloadAfterLoss: number | null;
  worstSessionsWithReload: { worst: number; withReload: number };
  /** One sentence the data supports, or null if there isn't enough history. */
  insight: string | null;
  suggestions: Array<{ key: "chasing" | "reloads" | "savings"; text: string }>;
  source: "hyperliquid-info-api";
}

async function info<T>(network: HlNetwork, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API[network], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`hyperliquid info ${String(body.type)}: ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchLedger(network: HlNetwork, user: string, startTime = 0): Promise<LedgerUpdate[]> {
  const out: LedgerUpdate[] = [];
  let cursor = startTime;
  for (let page = 0; page < 20; page++) {
    const batch = await info<LedgerUpdate[]>(network, { type: "userNonFundingLedgerUpdates", user, startTime: cursor });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 500) break;
    cursor = batch[batch.length - 1].time + 1;
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function fetchFills(network: HlNetwork, user: string): Promise<Fill[]> {
  const fills = await info<Fill[]>(network, { type: "userFills", user, aggregateByTime: true });
  return (Array.isArray(fills) ? fills : []).sort((a, b) => a.time - b.time);
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** Capital in/out events that bound a trading session, in USD. */
export function capitalFlows(ledger: LedgerUpdate[], user: string): Array<{ time: number; amount: number; hash: string }> {
  const me = user.toLowerCase();
  const out: Array<{ time: number; amount: number; hash: string }> = [];
  for (const u of ledger) {
    const d = u.delta;
    let amt = 0;
    switch (d.type) {
      case "deposit": amt = Number(d.usdc ?? 0); break;
      case "withdraw": amt = -Number(d.usdc ?? 0); break;
      case "internalTransfer":
      case "subAccountTransfer": {
        const v = Number(d.usdc ?? 0);
        if ((d.destination ?? "").toLowerCase() === me) amt = v;
        else if ((d.user ?? "").toLowerCase() === me) amt = -v;
        break;
      }
      case "spotTransfer": {
        const v = Number(d.usdcValue ?? d.amount ?? 0);
        if ((d.destination ?? "").toLowerCase() === me) amt = v;
        else if ((d.user ?? "").toLowerCase() === me) amt = -v;
        break;
      }
      default: break;
    }
    if (amt !== 0 && Number.isFinite(amt)) out.push({ time: u.time, amount: amt, hash: u.hash });
  }
  return out;
}

/** Inactivity that separates two trading sessions. */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * Sessions: clusters of activity (fills, deposits, withdrawals) separated by
 * at least SESSION_GAP_MS of inactivity, which is how people actually use a
 * perps account (capital stays deposited across many sessions). Within a
 * session: deposits after the first event are reloads; a deposit while the
 * session's running PnL is negative is a reload after loss; withdrawals are
 * capital returned. Realised PnL is the venue's own closedPnl minus fees.
 */
export function deriveSessions(ledger: LedgerUpdate[], fills: Fill[], user: string): HlSession[] {
  type Ev = { time: number; kind: "fill" | "in" | "out"; amount: number; pnl: number; hash: string };
  const events: Ev[] = [];
  for (const f of capitalFlows(ledger, user)) events.push({ time: f.time, kind: f.amount > 0 ? "in" : "out", amount: Math.abs(f.amount), pnl: 0, hash: f.hash });
  for (const f of fills) events.push({ time: f.time, kind: "fill", amount: 0, pnl: Number(f.closedPnl) - Number(f.fee), hash: f.hash });
  events.sort((a, b) => a.time - b.time);

  const sessions: HlSession[] = [];
  let cur: HlSession | null = null;
  let last = 0;
  for (const e of events) {
    if (cur && e.time - last > SESSION_GAP_MS) {
      cur.closedAt = last;
      sessions.push(cur);
      cur = null;
    }
    if (!cur) {
      cur = { openedAt: e.time, closedAt: null, deployed: 0, returned: 0, realisedPnl: 0, fills: 0, reloads: 0, reloadsAfterLoss: 0, firstLossAt: null, firstReloadAfterLossAt: null, hashes: [] };
      if (e.kind === "in") cur.deployed += e.amount;
    } else if (e.kind === "in") {
      cur.deployed += e.amount;
      cur.reloads += 1;
      if (cur.realisedPnl < 0) {
        cur.reloadsAfterLoss += 1;
        if (cur.firstReloadAfterLossAt === null) cur.firstReloadAfterLossAt = e.time;
      }
    }
    if (e.kind === "out") cur.returned += e.amount;
    if (e.kind === "fill") {
      cur.realisedPnl += e.pnl;
      cur.fills += 1;
      if (cur.realisedPnl < 0 && cur.firstLossAt === null) cur.firstLossAt = e.time;
    }
    if (e.hash && cur.hashes.length < 12 && !cur.hashes.includes(e.hash)) cur.hashes.push(e.hash);
    last = e.time;
  }
  if (cur) {
    // still open if the last activity was recent; otherwise closed at its last event
    if (Date.now() - last > SESSION_GAP_MS) cur.closedAt = last;
    sessions.push(cur);
  }
  return sessions.filter((s) => s.fills > 0 || s.deployed > 0);
}

export function summarise(address: string, network: HlNetwork, sessions: HlSession[], now = Date.now()): HlProfile {
  const deposited = sessions.reduce((a, s) => a + s.deployed, 0);
  const withdrawn = sessions.reduce((a, s) => a + s.returned, 0);
  const realisedPnl = sessions.reduce((a, s) => a + s.realisedPnl, 0);
  const fills = sessions.reduce((a, s) => a + s.fills, 0);
  const losing = sessions.filter((s) => s.realisedPnl < 0).sort((a, b) => a.realisedPnl - b.realisedPnl);
  const worstN = losing.slice(0, Math.min(4, losing.length));
  const worstWithReload = worstN.filter((s) => s.reloads > 0).length;
  const reloadDelays = sessions.filter((s) => s.firstLossAt && s.firstReloadAfterLossAt).map((s) => (s.firstReloadAfterLossAt! - s.firstLossAt!) / 60000);
  const sessionsWithReloadAfterLoss = sessions.filter((s) => s.reloadsAfterLoss > 0).length;
  const sessionsWithTwoPlusReloads = sessions.filter((s) => s.reloads >= 2).length;
  const typical = median(sessions.filter((s) => s.deployed > 0).map((s) => s.deployed));
  const largest = losing[0] ? { pnl: losing[0].realisedPnl, deployed: losing[0].deployed, openedAt: losing[0].openedAt } : null;

  let insight: string | null = null;
  if (sessions.length >= 2) {
    if (worstN.length >= 2 && worstWithReload >= Math.ceil(worstN.length / 2)) {
      insight = `${worstWithReload} of your ${worstN.length} largest losing sessions involved another reload.`;
    } else if (sessionsWithReloadAfterLoss > 0) {
      insight = `You added more money while already down in ${sessionsWithReloadAfterLoss} of your ${sessions.length} sessions.`;
    } else if (largest && sessions.filter((s) => s.deployed > 0).length >= 3 && typical !== null) {
      insight = `Your typical session deploys ${usd(typical)}. Your largest losing session cost ${usd(largest.pnl)}.`;
    } else if (largest) {
      insight = `Your largest losing session cost ${usd(largest.pnl)}, out of ${usd(deposited)} you've deposited in total.`;
    } else if (typical !== null) {
      insight = `Your typical session deploys ${usd(typical)} across ${sessions.length} sessions.`;
    }
  } else if (sessions.length === 1 && sessions[0].fills > 0) {
    insight = `One session so far: ${usd(sessions[0].deployed)} deployed, ${sessions[0].realisedPnl < 0 ? `${usd(sessions[0].realisedPnl)} lost` : `${usd(sessions[0].realisedPnl)} gained`}.`;
  }

  const suggestions: HlProfile["suggestions"] = [];
  if (sessionsWithReloadAfterLoss > 0) suggestions.push({ key: "chasing", text: "Pause new funding after a losing session, before the reload." });
  if (sessionsWithTwoPlusReloads > 0) suggestions.push({ key: "reloads", text: "Cap how much can be added in 24 hours, however it is split." });
  if (largest && typical && Math.abs(largest.pnl) > typical) suggestions.push({ key: "savings", text: "Keep a floor the trading account can never pull from." });

  return {
    address,
    network,
    asOf: Math.floor(now / 1000),
    sessions,
    totals: { deposited, withdrawn, realisedPnl, fills, sessions: sessions.length },
    typicalSessionSize: typical,
    largestLosingSession: largest,
    sessionsWithReloadAfterLoss,
    sessionsWithTwoPlusReloads,
    medianMinutesToReloadAfterLoss: median(reloadDelays),
    worstSessionsWithReload: { worst: worstN.length, withReload: worstWithReload },
    insight,
    suggestions,
    source: "hyperliquid-info-api",
  };
}

export async function analyseHyperliquid(address: string, network: HlNetwork): Promise<HlProfile> {
  const [ledger, fills] = await Promise.all([fetchLedger(network, address), fetchFills(network, address)]);
  return summarise(address, network, deriveSessions(ledger, fills, address));
}
