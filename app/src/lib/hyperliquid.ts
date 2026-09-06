/**
 * Read-only Hyperliquid client.
 *
 * Shield is not a trading terminal: the user trades on Hyperliquid itself.
 * All this does is read the venue's public info API so Shield can show the
 * connected account's equity, open risk and session result next to the
 * capital it is protecting. There is deliberately no order, leverage or
 * agent-key path here.
 */
import * as hl from "@nktkas/hyperliquid";
import type { Hex } from "viem";

export type HlNet = "mainnet" | "testnet";

export function transportFor(net: HlNet) {
  return new hl.HttpTransport({ isTestnet: net === "testnet" });
}

export function infoClient(net: HlNet) {
  return new hl.InfoClient({ transport: transportFor(net) });
}

/** Where the user goes to actually trade. */
export function venueUrl(net: HlNet): string {
  return net === "mainnet" ? "https://app.hyperliquid.xyz/trade" : "https://app.hyperliquid-testnet.xyz/trade";
}

export interface AccountView {
  accountValue: number;
  withdrawable: number;
  positions: Array<{ coin: string; size: number; entry: number | null; unrealisedPnl: number; leverage: number }>;
  /** False when the venue has never seen this address: show that, don't invent numbers. */
  exists: boolean;
}

/**
 * The account's equity at the venue.
 *
 * A unified account reports a perps `accountValue` of 0 and holds its
 * collateral as spot balances instead, so reading only the perps summary shows
 * $0 for an account with real money in it. Equity is therefore the perps value
 * plus the spot balances priced at the venue's own mids.
 */
export async function loadAccount(net: HlNet, user: string): Promise<AccountView> {
  const info = infoClient(net);
  const [perps, spot, mids] = await Promise.all([
    info.clearinghouseState({ user: user as Hex }),
    info.spotClearinghouseState({ user: user as Hex }).catch(() => ({ balances: [] as Array<{ coin: string; total: string }> })),
    info.allMids().catch(() => ({}) as Record<string, string>),
  ]);
  const positions = perps.assetPositions.map((p) => ({
    coin: p.position.coin,
    size: Number(p.position.szi),
    entry: p.position.entryPx ? Number(p.position.entryPx) : null,
    unrealisedPnl: Number(p.position.unrealizedPnl),
    leverage: Number(p.position.leverage.value),
  }));
  let spotValue = 0;
  for (const b of spot.balances) {
    const total = Number(b.total);
    if (!total) continue;
    // USDC is the quote asset; anything else is worth what the venue says it is.
    // A token with no mid is left out rather than guessed at.
    const mid = b.coin === "USDC" ? 1 : Number((mids as Record<string, string>)[b.coin] ?? NaN);
    if (Number.isFinite(mid)) spotValue += total * mid;
  }
  const accountValue = Number(perps.marginSummary.accountValue) + spotValue;
  return { accountValue, withdrawable: Number(perps.withdrawable) + spotValue, positions, exists: accountValue > 0 || positions.length > 0 };
}

export interface RecentPnl {
  closedPnl: number;
  fills: number;
  /** Earliest fill in the window, so the UI can say when the session started. */
  firstFillAt: number | null;
}

export async function loadRecentPnl(net: HlNet, user: string, sinceMs: number): Promise<RecentPnl> {
  const info = infoClient(net);
  const fills = await info.userFillsByTime({ user: user as Hex, startTime: sinceMs });
  let closedPnl = 0;
  let firstFillAt: number | null = null;
  for (const f of fills) {
    closedPnl += Number(f.closedPnl) - Number(f.fee);
    if (firstFillAt === null || f.time < firstFillAt) firstFillAt = f.time;
  }
  return { closedPnl, fills: fills.length, firstFillAt };
}
