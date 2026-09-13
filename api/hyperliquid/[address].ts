/**
 * Vercel serverless mirror of the Bun server's `/api/hyperliquid/<address>`
 * route (server/evm-index.ts), so the onboarding analysis works on the hosted
 * app with no backend to run and no keys to hold.
 *
 * This is the one endpoint the first-run experience needs: paste a Hyperliquid
 * address, get your own sessions, your reload-after-loss count, the replay of
 * your worst one, and the ladder Shield would propose from those numbers. It
 * reads Hyperliquid's public info API and nothing else — no credentials, no
 * chain access, no state — which is exactly why it can be a static function.
 *
 * `server/hyperliquid.ts` has no imports at all and uses only global fetch, so
 * it runs unchanged on Node as well as Bun.
 *
 *   /api/hyperliquid/0xabc…                      one wallet
 *   /api/hyperliquid/0xabc…,0xdef…               several, analysed as one trader
 *   /api/hyperliquid/0xabc…?network=testnet      default is mainnet
 */
import { analyseHyperliquid, analyseHyperliquidMany, type HlNetwork } from "../../server/hyperliquid";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Hyperliquid's info API is rate-limited per caller, and this function is public. */
const MAX_WALLETS = 5;

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    // The analysis is a pure function of public history, so it is safe to cache
    // and this keeps a judge clicking "try an example" off the rate limiter.
    "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });

  const url = new URL(req.url);
  const raw = decodeURIComponent(url.pathname.replace(/^\/api\/hyperliquid\//, "")).trim();
  const addresses = raw.split(",").map((a) => a.trim()).filter(Boolean);

  if (addresses.length === 0 || addresses.length > MAX_WALLETS || !addresses.every((a) => ADDRESS.test(a))) {
    return new Response(
      JSON.stringify({ error: `give 1 to ${MAX_WALLETS} Hyperliquid addresses as 0x-prefixed hex, comma separated` }),
      { status: 400, headers }
    );
  }

  const network: HlNetwork = url.searchParams.get("network") === "testnet" ? "testnet" : "mainnet";
  try {
    const profile = addresses.length === 1 ? await analyseHyperliquid(addresses[0], network) : await analyseHyperliquidMany(addresses, network);
    return new Response(JSON.stringify(profile), { headers });
  } catch (e) {
    // 502: the failure is upstream at Hyperliquid, not in the request.
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 502, headers });
  }
}
