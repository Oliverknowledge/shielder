/**
 * Check the app's claim against Hyperliquid's raw API, and show the working.
 *
 *   bun run scripts/verify-trader.ts 0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea
 *
 * The onboarding replay says a specific thing: on a specific afternoon this
 * trader was already down, added more, and the session ended far worse. This
 * prints that claim, then re-derives the same number straight from the public
 * API without going through any of our session logic, and says whether the two
 * agree. It also prints the reload's own transaction hash so the transfer can
 * be looked up independently.
 *
 * Hyperliquid's block explorer cannot do this job: an address page is a list of
 * "Place order" hashes and a transfer page shows a SystemSendAssetAction with
 * no PnL anywhere. Realised PnL only exists in the fills.
 *
 * Note on which session is chosen: the app picks the most expensive session
 * that contains a RELOAD — money added while already down — not the worst
 * session overall. This account has had worse days with no reload in them.
 * Those are not what Shield is about, so they are not what it shows.
 */
import { analyseHyperliquid } from "../server/hyperliquid";

const API = "https://api.hyperliquid.xyz/info";
const user = (process.argv[2] ?? "").trim();
if (!/^0x[0-9a-fA-F]{40}$/.test(user)) {
  console.error("usage: bun run scripts/verify-trader.ts <0x… Hyperliquid mainnet address>");
  process.exit(2);
}

const post = async <T>(body: unknown): Promise<T> => {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${API} -> ${r.status}`);
  return (await r.json()) as T;
};
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";

const profile = await analyseHyperliquid(user, "mainnet");
const r = profile.replay;
if (!r) { console.log("no reload-after-loss session found for this address"); process.exit(0); }
// A session still open has no close time; fall back to its last timeline event.
const closedAt = r.closedAt ?? r.timeline[r.timeline.length - 1]?.time ?? Date.now();

console.log(`\n  WHAT SHIELD SHOWS`);
console.log(`  session        ${when(r.openedAt)}  ->  ${when(closedAt)}`);
console.log(`  already down   ${usd(r.pnlAtReload)}`);
console.log(`  then added     ${usd(r.reloadAmount)}`);
console.log(`  session ended  ${usd(r.finalPnl)}`);

// Re-derive the same number from the raw endpoint, touching none of our logic.
// aggregateByTime collapses partial fills, so the API's 2,000-row cap covers a
// whole session instead of twenty minutes of it; without it the sum is short.
interface Fill { time: number; closedPnl?: string; fee?: string }
interface Ledger { time: number; hash: string; delta: { type: string; usdc?: string; usdcValue?: string; amount?: string; destination?: string } }
const [fills, ledger] = await Promise.all([
  post<Fill[]>({ type: "userFills", user, aggregateByTime: true }),
  post<Ledger[]>({ type: "userNonFundingLedgerUpdates", user, startTime: 0 }),
]);

const inWindow = fills.filter((f) => f.time >= r.openedAt && f.time <= closedAt);
const summed = inWindow.reduce((s, f) => s + Number(f.closedPnl ?? 0) - Number(f.fee ?? 0), 0);
const agrees = Math.abs(summed - r.finalPnl) < 1;

console.log(`\n  CHECKED AGAINST ${API}   (public, no credentials)`);
console.log(`  ${inWindow.length} fills in that window, sum of (closedPnl - fee) = ${usd(Math.round(summed * 100) / 100)}`);
console.log(`  ${agrees ? "AGREES with what Shield shows" : `DISAGREES by ${usd(summed - r.finalPnl)} — do not put this on camera`}`);

const reload = ledger
  .filter((l) => Math.abs(l.time - (r.timeline[r.reloadIndex]?.time ?? 0)) < 2000)
  .sort((a, b) => Math.abs(a.time - r.timeline[r.reloadIndex].time) - Math.abs(b.time - r.timeline[r.reloadIndex].time))[0];
if (reload) {
  const amt = Number(reload.delta.usdcValue ?? reload.delta.usdc ?? reload.delta.amount ?? 0);
  console.log(`\n  THE RELOAD ITSELF, as its own transfer`);
  console.log(`  ${when(reload.time)}   ${reload.delta.type}   ${usd(amt)}`);
  console.log(`  hash ${reload.hash}`);
  console.log(`  https://app.hyperliquid.xyz/explorer/tx/${reload.hash}`);
}
console.log(`\n  Every figure is the trader's own. Shield only reads them.\n`);
