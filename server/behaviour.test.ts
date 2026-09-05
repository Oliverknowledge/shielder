import { describe, expect, test } from "bun:test";
import { buildSessions, deriveProfile, median, type Flow } from "./behaviour";

const $ = (n: number) => BigInt(Math.round(n * 1_000_000));
const T0 = 1_800_000_000;
let slot = 1;

function flow(kind: Flow["kind"], counterparty: string, amount: number, at: number): Flow {
  return {
    slot: slot++,
    signature: `sig${slot}`,
    blockTime: at,
    vault: "vault",
    kind,
    outbound: kind !== "RETURN" && kind !== "DEPOSIT",
    counterparty,
    amount: $(amount),
    counterpartyIsExecution: kind !== "COLD_TRANSFER" && kind !== "FULL_EXIT" && kind !== "DEPOSIT",
  };
}

describe("sessions", () => {
  test("a top-up followed by a smaller return is a realised loss session", () => {
    const s = buildSessions([flow("TOP_UP_INSTANT", "axiom", 2000, T0), flow("RETURN", "axiom", 580, T0 + 3600)]);
    expect(s).toHaveLength(1);
    expect(s[0].realised).toBe(true);
    expect(s[0].isLoss).toBe(true);
    expect(s[0].net).toBe($(-1420));
  });

  test("money still in the venue is exposure, not loss", () => {
    const s = buildSessions([flow("TOP_UP_INSTANT", "axiom", 2000, T0)]);
    expect(s[0].realised).toBe(false);
    expect(s[0].isLoss).toBe(false);
  });

  test("a top-up after a return starts a new session; returns with no prior top-up are ignored", () => {
    const s = buildSessions([
      flow("RETURN", "axiom", 100, T0 - 10),
      flow("TOP_UP_INSTANT", "axiom", 400, T0),
      flow("RETURN", "axiom", 600, T0 + 100),
      flow("TOP_UP_GATED", "axiom", 1000, T0 + 200),
      flow("RETURN", "axiom", 300, T0 + 300),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].net).toBe($(200));
    expect(s[0].isLoss).toBe(false);
    expect(s[1].net).toBe($(-700));
    expect(s[1].isLoss).toBe(true);
  });

  test("multiple top-ups before a return accumulate into one session (structuring is one episode)", () => {
    const s = buildSessions([
      flow("TOP_UP_INSTANT", "axiom", 400, T0),
      flow("TOP_UP_INSTANT", "axiom", 400, T0 + 60),
      flow("TOP_UP_INSTANT", "axiom", 400, T0 + 120),
      flow("TOP_UP_INSTANT", "axiom", 400, T0 + 180),
      flow("RETURN", "axiom", 200, T0 + 3600),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].sent).toBe($(1600));
    expect(s[0].topUps).toBe(4);
    expect(s[0].net).toBe($(-1400));
  });
});

describe("profile", () => {
  test("the hero numbers: sent, returned, net, realised loss in window, streak, reload-after-loss", () => {
    const now = T0 + 6 * 3600;
    const flows = [
      flow("DEPOSIT", "alex", 10000, T0 - 86400),
      flow("TOP_UP_INSTANT", "axiom", 1500, T0 - 20 * 3600),
      flow("RETURN", "axiom", 900, T0 - 18 * 3600), // loss 600
      flow("TOP_UP_INSTANT", "axiom", 1200, T0 - 17 * 3600), // reload 1h after loss
      flow("RETURN", "axiom", 400, T0 - 10 * 3600), // loss 800
      flow("TOP_UP_INSTANT", "axiom", 1400, T0), // reload
      flow("RETURN", "axiom", 1510, T0 + 3600), // gain 110
      flow("COLD_TRANSFER", "ledger", 200, T0 + 2 * 3600),
    ];
    const p = deriveProfile("vault", flows, now);
    expect(p.totals.sent).toBe($(4100));
    expect(p.totals.returned).toBe($(2810));
    expect(p.totals.net).toBe($(-1290));
    expect(p.totals.deposited).toBe($(10000));
    expect(p.totals.exited).toBe($(200));
    expect(p.wallets).toHaveLength(1);
    expect(p.wallets[0].topUpCount).toBe(3);
    expect(p.wallets[0].medianTopUp).toBe($(1400));
    expect(p.windows.h24.realisedLoss).toBe($(1400));
    expect(p.windows.h24.lossSessions).toBe(2);
    expect(p.windows.h24.realisedGain).toBe($(110));
    expect(p.lossStreak).toBe(0); // most recent session was a gain
    // 1200 came 1h after the first loss (reload); 1400 came 10h after the second (not a reload)
    expect(p.reloadsAfterLoss7d).toBe(1);
    expect(p.velocity24h).toBe($(1400 + 1200 + 200)); // within the last 24h: 1200 (17h ago), 1400, 200 cold
    expect(p.lastLossAmount).toBe($(800));
  });

  test("loss streak counts consecutive realised losses newest-first within 7 days", () => {
    const now = T0;
    const flows = [
      flow("TOP_UP_INSTANT", "axiom", 500, T0 - 9 * 86400),
      flow("RETURN", "axiom", 100, T0 - 9 * 86400 + 100), // old loss, outside window
      flow("TOP_UP_INSTANT", "axiom", 500, T0 - 3 * 86400),
      flow("RETURN", "axiom", 100, T0 - 3 * 86400 + 100),
      flow("TOP_UP_INSTANT", "axiom", 500, T0 - 2 * 86400),
      flow("RETURN", "axiom", 100, T0 - 2 * 86400 + 100),
      flow("TOP_UP_INSTANT", "axiom", 500, T0 - 3600),
    ];
    const p = deriveProfile("vault", flows, now);
    expect(p.lossStreak).toBe(2);
    expect(p.wallets[0].openExposure).toBe($(500));
  });

  test("median", () => {
    expect(median([3n, 1n, 2n])).toBe(2n);
    expect(median([4n, 1n, 2n, 3n])).toBe(2n);
    expect(median([])).toBe(0n);
  });
});
