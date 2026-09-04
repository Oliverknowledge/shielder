//! Pure derivation logic: closed-cycle USDC accounting, loss-streak
//! decay, rolling median, and rolling velocity. Deliberately factored out
//! of the substreams map/store handlers so it's unit-testable with plain
//! `cargo test` -- no substreams runtime, no WASM target, no network.
//! This is the actual engineering the design doc flags as the single
//! riskiest item in the plan; it earns being tested in isolation.

use crate::pb::ClosedCycle;

pub const LOSS_STREAK_RECENCY_WINDOW_SECS: i64 = 7 * 24 * 60 * 60; // 7 days
pub const MEDIAN_FUNDING_WINDOW_SECS: i64 = 30 * 24 * 60 * 60; // 30 days
pub const VELOCITY_WINDOW_SECS: i64 = 24 * 60 * 60; // 24 hours

/// Closed-cycle USDC accounting (the design doc's corrected P&L fallback):
/// realized P&L over CLOSED round-trips only. `usdc_in - usdc_out`, summed.
/// Deliberately does not attempt to value any still-open position -- that
/// would need a price oracle, which is an explicit non-goal (see design
/// doc: "Single-asset scope... avoids taking on a price-oracle
/// dependency").
pub fn realized_pnl_usdc_raw(cycles: &[ClosedCycle]) -> i64 {
    cycles
        .iter()
        .map(|c| c.usdc_in_raw as i64 - c.usdc_out_raw as i64)
        .sum()
}

/// Consecutive realized-loss cycles, most-recent-first, decayed by the
/// 7-day recency window: a loss older than the window doesn't count
/// toward the CURRENT streak, and the streak resets to zero the moment a
/// non-loss cycle is encountered walking backward from `now`.
pub fn loss_streak(cycles: &[ClosedCycle], now: i64) -> u32 {
    let mut sorted: Vec<&ClosedCycle> = cycles.iter().collect();
    sorted.sort_by_key(|c| std::cmp::Reverse(c.closed_at));

    let mut streak = 0u32;
    for cycle in sorted {
        if now - cycle.closed_at > LOSS_STREAK_RECENCY_WINDOW_SECS {
            break; // outside the recency window: stop counting
        }
        if cycle.is_loss {
            streak += 1;
        } else {
            break; // a win breaks the streak
        }
    }
    streak
}

/// Median top-up size over a fixed 30-day rolling window. `top_ups` is
/// `(amount_raw, timestamp)` pairs; only entries inside the window count.
pub fn median_funding_size_usdc_raw(top_ups: &[(u64, i64)], now: i64) -> u64 {
    let mut in_window: Vec<u64> = top_ups
        .iter()
        .filter(|(_, ts)| now - ts <= MEDIAN_FUNDING_WINDOW_SECS)
        .map(|(amount, _)| *amount)
        .collect();

    if in_window.is_empty() {
        return 0;
    }
    in_window.sort_unstable();
    let mid = in_window.len() / 2;
    if in_window.len() % 2 == 0 {
        (in_window[mid - 1] + in_window[mid]) / 2
    } else {
        in_window[mid]
    }
}

/// Rolling 24h sum of outbound vault transfers -- mirrors the onchain
/// accumulator's semantics exactly (vault-global, not per-destination) so
/// the subgraph's number and the vault's enforced number never disagree.
pub fn rolling_velocity_usdc_raw(outbound_transfers: &[(u64, i64)], now: i64) -> u64 {
    outbound_transfers
        .iter()
        .filter(|(_, ts)| now - ts <= VELOCITY_WINDOW_SECS)
        .map(|(amount, _)| *amount)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cycle(usdc_out: u64, usdc_in: u64, closed_at: i64) -> ClosedCycle {
        ClosedCycle {
            execution_wallet: "wallet".into(),
            usdc_out_raw: usdc_out,
            usdc_in_raw: usdc_in,
            opened_at: closed_at - 3600,
            closed_at,
            is_loss: usdc_in < usdc_out,
        }
    }

    #[test]
    fn realized_pnl_sums_closed_cycles_only() {
        let cycles = vec![
            cycle(1_000_000, 800_000, 100), // -200,000 (loss)
            cycle(500_000, 900_000, 200),   // +400,000 (win)
        ];
        assert_eq!(realized_pnl_usdc_raw(&cycles), 200_000);
    }

    #[test]
    fn loss_streak_counts_consecutive_recent_losses() {
        let now = 1_000_000;
        let cycles = vec![
            cycle(100, 50, now - 10), // loss, most recent
            cycle(100, 40, now - 20), // loss
            cycle(100, 200, now - 30), // win -- breaks the streak
            cycle(100, 10, now - 40), // loss, but behind a win, doesn't count
        ];
        assert_eq!(loss_streak(&cycles, now), 2);
    }

    #[test]
    fn loss_streak_decays_outside_recency_window() {
        let now = 1_000_000;
        let cycles = vec![cycle(100, 10, now - LOSS_STREAK_RECENCY_WINDOW_SECS - 1)];
        assert_eq!(loss_streak(&cycles, now), 0);
    }

    #[test]
    fn median_funding_ignores_stale_entries() {
        let now = 1_000_000;
        let top_ups = vec![
            (400, now - 10),
            (600, now - 20),
            (200, now - MEDIAN_FUNDING_WINDOW_SECS - 1), // stale, excluded
        ];
        assert_eq!(median_funding_size_usdc_raw(&top_ups, now), 500);
    }

    #[test]
    fn velocity_matches_vault_semantics_four_400s_equal_1600() {
        let now = 1_000_000;
        let transfers = vec![
            (400_000_000, now - 3600),
            (400_000_000, now - 7200),
            (400_000_000, now - 10800),
            (400_000_000, now - 14400),
        ];
        assert_eq!(rolling_velocity_usdc_raw(&transfers, now), 1_600_000_000);
    }
}
