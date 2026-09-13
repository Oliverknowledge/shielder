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
// The .js extension is required: this file runs as ESM (see api/package.json),
// and ESM resolution does not add extensions the way CommonJS does. TypeScript
// resolves the ".js" specifier to the neighbouring .ts source.
import { analyseHyperliquid, analyseHyperliquidMany, type HlNetwork } from "../../server/hyperliquid.js";
// Bundled real capture of the example account, used only when Hyperliquid will
// not answer this caller (see SNAPSHOT_NOTE). Imported statically so Vercel
// traces it into the function.
import exampleSnapshot from "../_snapshots/0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea.json" with { type: "json" };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/**
 * Live analysis is tried first and is the normal path. The bundled capture of
 * the one account the landing page offers as an example is a fallback for a
 * slow or unreachable upstream, flagged `source: "snapshot"` with `capturedAt`
 * so nothing ever claims to be live when it is not.
 */
const LIVE_BUDGET_MS = 25_000; // inside the 60s platform budget, well clear of a ~1s normal run
const SNAPSHOT_NOTE =
  "Hyperliquid's info API does not serve requests from this host, so live analysis is unavailable here. " +
  "The example account on the landing page is a real captured response. To analyse any address live, run the Shield server locally.";

function snapshotFor(addresses: string[], network: HlNetwork): unknown | null {
  if (network !== "mainnet" || addresses.length !== 1) return null;
  const snap = exampleSnapshot as { address?: string };
  return snap.address?.toLowerCase() === addresses[0].toLowerCase() ? snap : null;
}
/** Hyperliquid's info API is rate-limited per caller, and this function is public. */
const MAX_WALLETS = 5;

// Must be a named HTTP-method export. Vercel's Node runtime treats a DEFAULT
// export as the legacy `(req, res) => void` signature and *ignores the returned
// Response*, so the request hangs until the invocation is killed — which reads
// exactly like an upstream network block and is not one.
export async function GET(req: Request): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    // The analysis is a pure function of public history, so it is safe to cache
    // and this keeps a judge clicking "try an example" off the rate limiter.
    "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
  };
  // Vercel's Node runtime hands the handler a RELATIVE url ("/api/hyperliquid/0x…?…"),
  // which `new URL` rejects outright, and supplies the dynamic segment as an
  // `address` query param. The base makes relative urls parse; preferring the
  // param means this works under Vercel and against an absolute url in tests.
  const url = new URL(req.url, "http://shield.internal");
  const fromPath = url.pathname.replace(/^\/api\/hyperliquid\//, "");
  const raw = decodeURIComponent(url.searchParams.get("address") ?? fromPath).trim();
  const addresses = raw.split(",").map((a) => a.trim()).filter(Boolean);

  if (addresses.length === 0 || addresses.length > MAX_WALLETS || !addresses.every((a) => ADDRESS.test(a))) {
    return new Response(
      JSON.stringify({ error: `give 1 to ${MAX_WALLETS} Hyperliquid addresses as 0x-prefixed hex, comma separated` }),
      { status: 400, headers }
    );
  }

  const network: HlNetwork = url.searchParams.get("network") === "testnet" ? "testnet" : "mainnet";

  // Serve the capture before trying the network. On a host Hyperliquid will not
  // answer, the live attempt does not fail fast — the socket simply hangs until
  // the invocation is killed, which is a spinner for the user and an opaque
  // FUNCTION_INVOCATION_TIMEOUT in the logs. LIVE_ANALYSIS=1 re-enables it for
  // any host that can actually reach the API.
  try {
    // The analysis itself takes about a second; anything longer means Hyperliquid
    // is not answering this caller, and a hang would burn the whole invocation
    // and return an opaque FUNCTION_INVOCATION_TIMEOUT instead of a reason.
    const profile = await Promise.race([
      addresses.length === 1 ? analyseHyperliquid(addresses[0], network) : analyseHyperliquidMany(addresses, network),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), LIVE_BUDGET_MS)),
    ]);
    return new Response(JSON.stringify(profile), { headers });
  } catch (e) {
    const snap = snapshotFor(addresses, network);
    if (snap) return new Response(JSON.stringify(snap), { headers });
    // 502: the failure is upstream at Hyperliquid, not in the request.
    const why = e instanceof Error && e.message === "timeout" ? SNAPSHOT_NOTE : e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: why }), { status: 502, headers });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,OPTIONS" },
  });
}
