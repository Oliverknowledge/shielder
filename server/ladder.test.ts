import { describe, expect, test } from "bun:test";
import { decideLadder, ladderFromJson, ladderHashOf, ladderToJson, tierInForce, trailingDrawdownUsdc, type Ladder } from "../client/ladder";

const L: Ladder = { v: 1, reducedAtUsdc: 150_000_000n, reducedVelocityThreshold: 400_000_000n, tierResetSecs: 86_400n, salt: "0x" + "ab".repeat(32) };

describe("risk ladder (private half)", () => {
  test("hash is abi.encode(uint64,uint64,uint64,bytes32) and round-trips through JSON", () => {
    const h = ladderHashOf(L);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ladderHashOf(ladderFromJson(ladderToJson(L)))).toBe(h);
    expect(ladderHashOf({ ...L, reducedAtUsdc: 150_000_001n })).not.toBe(h);
    expect(ladderHashOf({ ...L, salt: "0x" + "cd".repeat(32) })).not.toBe(h);
  });

  test("trailing drawdown from realised peak: plain loss, then giveback", () => {
    expect(trailingDrawdownUsdc([{ time: 1, closedPnl: "-100", fee: "1" }])).toBe(101_000_000n);
    // start flat, +1000 peak, then back to +550: $450 given back, not a $0 loss
    expect(trailingDrawdownUsdc([{ time: 1, closedPnl: "1000", fee: "0" }, { time: 2, closedPnl: "-450", fee: "0" }])).toBe(450_000_000n);
    expect(trailingDrawdownUsdc([{ time: 1, closedPnl: "1000", fee: "0" }])).toBe(0n);
  });

  test("decision: only REDUCED, only against the committed ladder, only downward", () => {
    const h = ladderHashOf(L);
    expect(decideLadder(null, h, 0, 999_000_000n).reason).toBe("no-ladder");
    expect(decideLadder(L, "0x" + "00".repeat(32), 0, 999_000_000n).reason).toBe("hash-mismatch");
    expect(decideLadder(L, h, 1, 999_000_000n).reason).toBe("already-reduced-or-locked");
    expect(decideLadder(L, h, 2, 999_000_000n).reason).toBe("already-reduced-or-locked");
    expect(decideLadder(L, h, 0, 149_999_999n).reason).toBe("below-threshold");
    expect(decideLadder(L, h, 0, 150_000_000n)).toEqual({ tier: 1, reason: "reduced" });
  });

  test("tier in force follows the two clocks", () => {
    expect(tierInForce({ activeTier: 1, tierUntil: 200n, cooldownUntil: 0n }, 199)).toBe(1);
    expect(tierInForce({ activeTier: 1, tierUntil: 200n, cooldownUntil: 0n }, 200)).toBe(0);
    expect(tierInForce({ activeTier: 2, tierUntil: 0n, cooldownUntil: 300n }, 299)).toBe(2);
    expect(tierInForce({ activeTier: 2, tierUntil: 0n, cooldownUntil: 300n }, 300)).toBe(0);
  });
});
