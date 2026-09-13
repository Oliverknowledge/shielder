/**
 * Realise a small loss on Hyperliquid TESTNET from the vault's registered
 * trading account, so the loss rule has something true to act on.
 *
 *   EVM_DEPLOYER_KEY=0x… bun run scripts/hyperevm-losing-trade.ts [target_usd=3.5] [fund_usd=85]
 *
 * Shield never trades; this is a rehearsal tool for the demo's loss beat
 * (docs/DEMO_SCRIPT.md) and it refuses to run against mainnet. It moves test
 * USDC from the funder's spot balance to its perps balance, sends it to the
 * trading account, then round-trips a BTC position with IOC orders until the
 * venue's own fills show closedPnl - fees at or below -target. That is the
 * number the enclave reads (cre/shield-risk/evaluate.ts readVenueLoss).
 */
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import type { Hex } from "viem";

if ((process.env.EVM_CHAIN_ID || "998") === "999") { console.error("refusing: this script trades real money on mainnet"); process.exit(2); }
const TARGET = Number(process.argv[2] ?? 3.5);
const FUND = Number(process.argv[3] ?? 85); // 0 = trade with what the account already holds (e.g. what the vault released)
const ROUNDS = Number(process.argv[4] ?? 6);
const funderKey = process.env.EVM_DEPLOYER_KEY as Hex | undefined;
const keys = JSON.parse(readFileSync(`${process.env.SHIELD_STATE_DIR || ".shield"}/hyperevm-keys.json`, "utf8")) as { execution: Hex };
const venueKey = (process.env.EVM_EXECUTION_KEY as Hex | undefined) ?? keys.execution;
if (!funderKey || !venueKey) { console.error("need EVM_DEPLOYER_KEY and .shield/hyperevm-keys.json .execution"); process.exit(2); }

const transport = new HttpTransport({ isTestnet: true });
const info = new InfoClient({ transport });
const funder = new ExchangeClient({ transport, wallet: privateKeyToAccount(funderKey) });
const venueAcct = privateKeyToAccount(venueKey);
const venue = new ExchangeClient({ transport, wallet: venueAcct });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const since = Date.now();
const realised = async () => {
  const fills = await info.userFillsByTime({ user: venueAcct.address, startTime: since });
  return fills.reduce((a, f) => a + Number(f.closedPnl) - Number(f.fee), 0);
};

// 1. fund the trading account's perps balance from the funder's spot USDC
const perps = async (u: `0x${string}`) => Number((await info.clearinghouseState({ user: u })).withdrawable);
console.log(`venue ${venueAcct.address} perps: $${await perps(venueAcct.address)}`);
if (FUND > 0 && (await perps(venueAcct.address)) < FUND * 0.9) {
  // The funder is a unified account: legacy usdSend/usdClassTransfer are disabled,
  // so move spot USDC straight into the trading account's perps balance with sendAsset.
  const spotMeta = await info.spotMeta();
  const usdc = spotMeta.tokens.find((t) => t.name === "USDC");
  if (!usdc) throw new Error("no USDC in spotMeta");
  await funder.sendAsset({ destination: venueAcct.address, sourceDex: "spot", destinationDex: "", token: `USDC:${usdc.tokenId}`, amount: String(FUND) });
  await sleep(2500);
  console.log(`funded: venue perps now $${await perps(venueAcct.address)}`);
}

// 2. BTC, max leverage, IOC round trips crossing the spread until the realised loss is there
const meta = await info.meta();
const idx = meta.universe.findIndex((u) => u.name === "BTC");
const { szDecimals, maxLeverage } = meta.universe[idx];
const lev = Math.min(40, maxLeverage);
await venue.updateLeverage({ asset: idx, isCross: true, leverage: lev });
const px5 = (p: number) => Number(p.toPrecision(5)).toString();
for (let i = 0; i < ROUNDS; i++) {
  const mid = Number((await info.allMids())["BTC"]);
  const margin = (await perps(venueAcct.address)) * 0.9;
  const size = Number((Math.max(0.0001, (margin * lev) / mid)).toFixed(szDecimals));
  if (size * mid < 10) { console.log(`notional $${(size * mid).toFixed(2)} is under the venue's $10 minimum; stopping`); break; }
  const buy = await venue.order({ orders: [{ a: idx, b: true, p: px5(mid * 1.01), s: String(size), r: false, t: { limit: { tif: "Ioc" } } }], grouping: "na" });
  await sleep(800);
  const sell = await venue.order({ orders: [{ a: idx, b: false, p: px5(mid * 0.99), s: String(size), r: true, t: { limit: { tif: "Ioc" } } }], grouping: "na" });
  await sleep(1500);
  const r = await realised();
  console.log(`round trip ${i + 1}: size ${size} BTC @ ~${mid} (${lev}x) buy=${JSON.stringify(buy.response.data.statuses[0]).slice(0, 60)} sell=${JSON.stringify(sell.response.data.statuses[0]).slice(0, 60)} → realised ${r.toFixed(4)}`);
  if (r <= -TARGET) break;
}
console.log(`venue realised PnL (closedPnl - fees) since start: $${(await realised()).toFixed(4)}; perps balance $${await perps(venueAcct.address)}`);
