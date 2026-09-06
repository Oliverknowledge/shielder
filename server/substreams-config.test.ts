import { describe, expect, test } from "bun:test";
import { describeSubstreams, jwtExpiry, resolveSubstreams } from "./substreams-config";

const jwt = (exp: number) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

describe("substreams config", () => {
  test("stacks have separate default endpoints and share one token", () => {
    const env = { SUBSTREAMS_API_TOKEN: jwt(4102444800) };
    const sol = resolveSubstreams("solana", env);
    const evm = resolveSubstreams("hyperevm", env);
    expect(sol.endpoint).toBe("devnet.sol.streamingfast.io:443");
    expect(evm.endpoint).toBe("hyperevm.substreams.pinax.network:443");
    expect(sol.token).toBe(env.SUBSTREAMS_API_TOKEN);
    expect(evm.token).toBe(env.SUBSTREAMS_API_TOKEN);
    expect(sol.tokenSource).toBe("shared");
    expect(evm.spkg).toContain("substreams-evm/");
  });

  test("per-stack token and endpoint overrides win; scheme and trailing slash normalised", () => {
    const c = resolveSubstreams("hyperevm", {
      SUBSTREAMS_API_TOKEN: jwt(4102444800),
      SUBSTREAMS_HYPEREVM_API_TOKEN: jwt(4102444801),
      SUBSTREAMS_HYPEREVM_ENDPOINT: "https://hyperevm.substreams.pinax.network/",
    });
    expect(c.tokenSource).toBe("stack");
    expect(c.endpoint).toBe("hyperevm.substreams.pinax.network:443");
  });

  test("legacy SUBSTREAMS_ENDPOINT only applies to Solana and warns", () => {
    const env = { SUBSTREAMS_ENDPOINT: "custom.sol:443" };
    expect(resolveSubstreams("solana", env).endpoint).toBe("custom.sol:443");
    expect(resolveSubstreams("solana", env).warnings[0]).toContain("deprecated");
    expect(resolveSubstreams("hyperevm", env).endpoint).toBe("hyperevm.substreams.pinax.network:443");
  });

  test("expired or malformed tokens are flagged, and the token never appears in the description", () => {
    const expired = resolveSubstreams("solana", { SUBSTREAMS_API_TOKEN: jwt(1) });
    expect(expired.warnings).toContain("Graph Market JWT has expired");
    expect(jwtExpiry("not-a-jwt")).toBeNull();
    expect(resolveSubstreams("solana", { SUBSTREAMS_API_TOKEN: "abc" }).warnings[0]).toContain("does not look like a JWT");
    expect(describeSubstreams(expired)).not.toContain(expired.token);
    expect(resolveSubstreams("solana", {}).tokenSource).toBe("none");
  });
});
