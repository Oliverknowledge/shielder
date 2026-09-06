/**
 * The loss rule has two independent sources of evidence: what did not come
 * back to the vault (on-chain flows) and what the venue itself settled
 * (Hyperliquid's own API). These pin down how they combine, because getting it
 * wrong either double-counts a loss or misses one entirely.
 */
import { describe, expect, test } from "bun:test";
import { deriveProfile, type Flow } from "./behaviour";
import { assess, type PolicyView, type VenueLoss } from "./policy";

const $ = (n: number) => BigInt(Math.round(n * 1_000_000));
const T0 = 1_800_000_000;
let slot = 1;

function flow(kind: Flow["kind"], amount: number, at: number): Flow {
  return {
    slot: slot++,
    signature: `sig${slot}`,
    blockTime: at,
    vault: "vault",
    kind,
    outbound: kind !== "RETURN" && kind !== "DEPOSIT",
    counterparty: "venue",
    amount: $(amount),
    counterpartyIsExecution: true,
  };
}

const policy = (over: Partial<PolicyView> = {}): PolicyView =>
  ({
    vault: "vault",
    programId: "program",
    protectedFloor: $(6000),
    velocityThreshold: $(2000),
    topUpThresholdBps: 2000,
    emergencyCap: $(200),
    lossTriggerUsdc: $(750),
    lossCooldownSecs: 12n * 3600n,
    cooldownUntil: 0n,
    lastVerdictNonce: 0n,
    ...over,
  }) as PolicyView;

const venue = (loss: number, over: Partial<VenueLoss> = {}): VenueLoss => ({
  source: "hyperliquid",
  network: "testnet",
  account: "0xvenue",
  realisedLossUsdc: $(loss),
  fills: 3,
  lastFillAt: T0 + 60,
  ...over,
});

describe("loss evidence", () => {
  const now = T0 + 3600;

  test("a venue loss fires the rule even though nothing came back to the vault", () => {
    // Capital deposited into a Hyperliquid account and lost there never returns,
    // so the flow view alone reports no realised loss at all.
    const profile = deriveProfile("vault", [flow("TOP_UP_INSTANT", 1500, T0)], now);
    expect(profile.windows.h24.realisedLoss).toBe(0n);

    const a = assess(profile, policy(), now, 0, venue(1080));
    expect(a.realizedLossUsdc).toBe($(1080));
    expect(a.triggered).toBe(true);
    expect(a.actionable).toBe(true);
    expect(a.evidence.venue?.realisedLossUsdc).toBe($(1080).toString());
  });

  test("the larger of the two sources wins; they are never summed", () => {
    const profile = deriveProfile("vault", [flow("TOP_UP_INSTANT", 1500, T0), flow("RETURN", 80, T0 + 60)], now);
    expect(profile.windows.h24.realisedLoss).toBe($(1420));

    // The same money, seen twice: 1420 on-chain and 1080 at the venue.
    const a = assess(profile, policy(), now, 0, venue(1080));
    expect(a.realizedLossUsdc).toBe($(1420));
    // The flow view dominates, so the bundle carries no venue claim.
    expect(a.evidence.venue).toBeUndefined();
  });

  test("no venue reading leaves the flow-only behaviour untouched", () => {
    const profile = deriveProfile("vault", [flow("TOP_UP_INSTANT", 1500, T0), flow("RETURN", 80, T0 + 60)], now);
    const withNull = assess(profile, policy(), now, 0, null);
    const without = assess(profile, policy(), now, 0);
    expect(withNull.realizedLossUsdc).toBe($(1420));
    // Identical evidence, so an unreachable venue can never change a verdict hash.
    expect(withNull.evidenceHash).toEqual(without.evidenceHash);
  });

  test("a venue loss below the trigger does not fire", () => {
    const profile = deriveProfile("vault", [flow("TOP_UP_INSTANT", 1500, T0)], now);
    const a = assess(profile, policy(), now, 0, venue(200));
    expect(a.triggered).toBe(false);
    expect(a.actionable).toBe(false);
  });

  test("a venue loss already covered by the running cooldown is not actionable", () => {
    const profile = deriveProfile("vault", [flow("TOP_UP_INSTANT", 1500, T0)], now);
    const cooling = policy({ cooldownUntil: BigInt(now) + 24n * 3600n });
    const a = assess(profile, cooling, now, 0, venue(1080));
    expect(a.triggered).toBe(true);
    // Extending 12h onto a longer pause would shorten nothing and change nothing.
    expect(a.actionable).toBe(false);
  });
});
