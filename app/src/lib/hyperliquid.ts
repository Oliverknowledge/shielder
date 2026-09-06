/**
 * Hyperliquid client helpers for the Trade screen. Market data comes from
 * the public info API (real, no credentials). Orders go through
 * @nktkas/hyperliquid with an agent (API) wallet the user approved once, so
 * ordinary trading never prompts. Agent keys can only trade: they cannot
 * withdraw, send, or touch the vault.
 */
import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export type HlNet = "mainnet" | "testnet";
const AGENT_KEY = "shield.hlAgentKey";

export function transportFor(net: HlNet) {
  return new hl.HttpTransport({ isTestnet: net === "testnet" });
}

export function infoClient(net: HlNet) {
  return new hl.InfoClient({ transport: transportFor(net) });
}

export interface Market {
  coin: string;
  index: number;
  mid: number;
  szDecimals: number;
  maxLeverage: number;
}

export async function loadMarkets(net: HlNet, coins = ["BTC", "ETH", "SOL", "HYPE"]): Promise<Market[]> {
  const info = infoClient(net);
  const [meta, mids] = await Promise.all([info.meta(), info.allMids()]);
  const out: Market[] = [];
  meta.universe.forEach((u, i) => {
    if (!coins.includes(u.name)) return;
    const mid = Number((mids as Record<string, string>)[u.name] ?? NaN);
    if (Number.isFinite(mid)) out.push({ coin: u.name, index: i, mid, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage });
  });
  return out.sort((a, b) => coins.indexOf(a.coin) - coins.indexOf(b.coin));
}

export interface AccountView {
  accountValue: number;
  withdrawable: number;
  positions: Array<{ coin: string; size: number; entry: number | null; unrealisedPnl: number; leverage: number }>;
  exists: boolean;
}

export async function loadAccount(net: HlNet, user: string): Promise<AccountView> {
  const info = infoClient(net);
  const s = await info.clearinghouseState({ user: user as Hex });
  const positions = s.assetPositions.map((p) => ({
    coin: p.position.coin,
    size: Number(p.position.szi),
    entry: p.position.entryPx ? Number(p.position.entryPx) : null,
    unrealisedPnl: Number(p.position.unrealizedPnl),
    leverage: Number(p.position.leverage.value),
  }));
  const accountValue = Number(s.marginSummary.accountValue);
  return { accountValue, withdrawable: Number(s.withdrawable), positions, exists: accountValue > 0 || positions.length > 0 };
}

export async function loadRecentPnl(net: HlNet, user: string, sinceMs: number): Promise<{ closedPnl: number; fills: number }> {
  const info = infoClient(net);
  const fills = await info.userFillsByTime({ user: user as Hex, startTime: sinceMs });
  let closedPnl = 0;
  for (const f of fills) closedPnl += Number(f.closedPnl) - Number(f.fee);
  return { closedPnl, fills: fills.length };
}

export function getAgentKey(): Hex | null {
  return (sessionStorage.getItem(AGENT_KEY) as Hex | null) ?? null;
}
export function setAgentKey(k: Hex | null) {
  if (k) sessionStorage.setItem(AGENT_KEY, k);
  else sessionStorage.removeItem(AGENT_KEY);
}
export function agentAddress(): string | null {
  const k = getAgentKey();
  return k ? privateKeyToAccount(k).address : null;
}

/** Approve an agent key with the user's own signer (a user-signed action, so it needs the master wallet). */
export async function approveAgent(net: HlNet, masterWallet: Parameters<typeof hl.ExchangeClient.prototype.approveAgent>[0] extends infer _ ? { address: Hex; signTypedData: (args: never) => Promise<Hex> } : never, agent: Hex, name = "Shield") {
  const client = new hl.ExchangeClient({ transport: transportFor(net), wallet: masterWallet as never });
  return client.approveAgent({ agentAddress: agent, agentName: name });
}

/** Place a market-ish order (IOC limit at mid ± 1%) with the agent key. Returns the exchange response. */
export async function placeOrder(net: HlNet, market: Market, isBuy: boolean, sizeCoins: number, cloid?: string) {
  const key = getAgentKey();
  if (!key) throw new Error("No agent key. Approve one first.");
  const wallet = privateKeyToAccount(key);
  const client = new hl.ExchangeClient({ transport: transportFor(net), wallet });
  const px = market.mid * (isBuy ? 1.01 : 0.99);
  const pxStr = formatPx(px, market.szDecimals);
  const szStr = sizeCoins.toFixed(market.szDecimals);
  return client.order({ orders: [{ a: market.index, b: isBuy, p: pxStr, s: szStr, r: false, t: { limit: { tif: "Ioc" } }, ...(cloid ? { c: cloid as Hex } : {}) }], grouping: "na" });
}

export async function updateLeverage(net: HlNet, market: Market, leverage: number) {
  const key = getAgentKey();
  if (!key) throw new Error("No agent key. Approve one first.");
  const client = new hl.ExchangeClient({ transport: transportFor(net), wallet: privateKeyToAccount(key) });
  return client.updateLeverage({ asset: market.index, isCross: true, leverage });
}

/** Hyperliquid prices: at most 5 significant figures and 6 - szDecimals decimals. */
export function formatPx(px: number, szDecimals: number): string {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  let s = px.toPrecision(5);
  if (s.includes("e")) s = px.toFixed(maxDecimals);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}
