/**
 * Resolves The Graph Market credentials and endpoints for each Substreams
 * stack. One JWT (`SUBSTREAMS_API_TOKEN`) is shared by both stacks and by
 * the `substreams` CLI; endpoints are explicit and separate per stack.
 *
 *   SUBSTREAMS_API_TOKEN            shared Graph Market JWT (never logged, never committed)
 *   SUBSTREAMS_SOLANA_API_TOKEN     optional per-stack override
 *   SUBSTREAMS_HYPEREVM_API_TOKEN   optional per-stack override
 *   SUBSTREAMS_SOLANA_ENDPOINT      default devnet.sol.streamingfast.io:443
 *   SUBSTREAMS_HYPEREVM_ENDPOINT    default hyperevm.substreams.pinax.network:443
 *   SUBSTREAMS_ENDPOINT             legacy alias for the Solana endpoint
 */
export type SubstreamsStack = "solana" | "hyperevm";

export const DEFAULT_ENDPOINTS: Record<SubstreamsStack, string> = {
  solana: "devnet.sol.streamingfast.io:443",
  hyperevm: "hyperevm.substreams.pinax.network:443",
};

export const DEFAULT_SPKGS: Record<SubstreamsStack, string> = {
  solana: "substreams/shield-behavioral-memory-v0.2.0.spkg",
  hyperevm: "substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg",
};

export interface SubstreamsConfig {
  stack: SubstreamsStack;
  endpoint: string; // host:port, no scheme
  token: string; // "" when not configured
  tokenSource: "stack" | "shared" | "none";
  spkg: string;
  /** JWT expiry (unix seconds) if the token is a decodable JWT, else null. */
  tokenExpiresAt: number | null;
  warnings: string[];
}

function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Reads the `exp` claim without verifying the signature (the endpoint verifies). */
export function jwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function resolveSubstreams(stack: SubstreamsStack, env: NodeJS.ProcessEnv = process.env): SubstreamsConfig {
  const upper = stack.toUpperCase();
  const warnings: string[] = [];
  const stackToken = clean(env[`SUBSTREAMS_${upper}_API_TOKEN`]);
  const sharedToken = clean(env.SUBSTREAMS_API_TOKEN);
  const token = stackToken || sharedToken;
  const tokenSource: SubstreamsConfig["tokenSource"] = stackToken ? "stack" : sharedToken ? "shared" : "none";

  let endpoint = clean(env[`SUBSTREAMS_${upper}_ENDPOINT`]);
  if (!endpoint && stack === "solana" && clean(env.SUBSTREAMS_ENDPOINT)) {
    endpoint = clean(env.SUBSTREAMS_ENDPOINT);
    warnings.push("SUBSTREAMS_ENDPOINT is deprecated; use SUBSTREAMS_SOLANA_ENDPOINT");
  }
  if (!endpoint) endpoint = DEFAULT_ENDPOINTS[stack];
  endpoint = endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/:\d+$/.test(endpoint)) endpoint += ":443";

  const spkg = clean(env[`SUBSTREAMS_${upper}_SPKG`]) || (stack === "solana" ? clean(env.SHIELD_SPKG) : "") || DEFAULT_SPKGS[stack];

  const tokenExpiresAt = token ? jwtExpiry(token) : null;
  if (token && tokenExpiresAt === null) warnings.push("SUBSTREAMS_API_TOKEN does not look like a JWT");
  if (tokenExpiresAt !== null && tokenExpiresAt * 1000 < Date.now()) warnings.push("Graph Market JWT has expired");

  return { stack, endpoint, token, tokenSource, spkg, tokenExpiresAt, warnings };
}

/** Safe-to-log summary: never includes the token. */
export function describeSubstreams(c: SubstreamsConfig): string {
  const tok = c.token ? `token=${c.tokenSource}${c.tokenExpiresAt ? ` (exp ${new Date(c.tokenExpiresAt * 1000).toISOString()})` : ""}` : "no token";
  return `${c.stack} substreams: endpoint=${c.endpoint} spkg=${c.spkg} ${tok}${c.warnings.length ? ` warnings: ${c.warnings.join("; ")}` : ""}`;
}
