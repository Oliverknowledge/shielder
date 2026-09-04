use crate::errors::ShieldError;
use anchor_lang::prelude::*;

/// Six 4-hour buckets covering a rolling 24h window. This is the "fallback"
/// the design doc allows as strictly simpler than a fully pruned sliding
/// window, and it's what we implement directly (not as a degraded fallback)
/// because it's the version that's actually safe to get right in an Anchor
/// program on a hackathon timeline.
pub const NUM_VELOCITY_BUCKETS: usize = 6;
pub const BUCKET_LEN_SECS: i64 = 4 * 60 * 60; // 4 hours
pub const VELOCITY_WINDOW_SECS: i64 = NUM_VELOCITY_BUCKETS as i64 * BUCKET_LEN_SECS; // 24h

pub const DEFAULT_TOP_UP_COOLDOWN_SECS: i64 = 30 * 60; // 30 minutes
pub const DEFAULT_LOOSEN_COOLDOWN_SECS: i64 = 24 * 60 * 60; // 24 hours
pub const DEFAULT_FULL_EXIT_COOLDOWN_SECS: i64 = 7 * 24 * 60 * 60; // 7 days
pub const PROPOSAL_EXECUTION_GRACE_SECS: i64 = 7 * 24 * 60 * 60; // 7 days to execute once matured, else re-propose

/// Basis points denominator (10_000 = 100%).
pub const BPS_DENOM: u64 = 10_000;

#[account]
pub struct Vault {
    /// The user's own key. This is the sole root of authority. There is no
    /// runtime instruction to change it (HIGH #9 from review) -- losing this
    /// key has no recovery path in v1, and that's an accepted limitation,
    /// stated prominently rather than hidden (see design doc).
    pub authority: Pubkey,

    /// Pinned USDC mint. v1 is single-asset by design -- no price oracle
    /// dependency, no multi-asset valuation problem.
    pub usdc_mint: Pubkey,

    /// The vault's own USDC token account (owned by this PDA).
    pub vault_token_account: Pubkey,

    /// The trust root for CRE verdicts (HIGH #5 / Invariant 13). Immutable
    /// after initialization -- there is no runtime instruction to change it,
    /// which is the simplest and strictest way to satisfy "changing that
    /// root must either be impossible or itself a delayed weakening
    /// operation." We chose impossible.
    pub cre_verifier: Pubkey,

    // --- Tunable, governed parameters ---
    /// Row 4 top-up threshold, in basis points of the vault's CURRENT
    /// balance at check time. A single transfer at or above this fraction
    /// of the vault's balance cannot execute instantly.
    pub top_up_threshold_bps: u16,

    /// Row 6 emergency cap, in raw USDC units (6 decimals). A cold transfer
    /// at or below this amount may execute instantly; above it, it is not a
    /// separate row at all -- it routes through the row 5 full-exit path.
    pub emergency_cap: u64,

    /// The vault-global velocity threshold: total outbound to
    /// execution-tagged owners AND capped cold transfers, combined, inside
    /// the rolling 24h window, above which NOTHING may execute instantly --
    /// this is the explicit state transition CRITICAL #1 (round 2 review)
    /// demanded. Crossing this threshold is not just recorded, it BLOCKS
    /// the instant path outright (see `check_and_reserve_velocity`).
    pub velocity_threshold: u64,

    pub top_up_cooldown_secs: i64,
    pub loosen_cooldown_secs: i64,
    pub full_exit_cooldown_secs: i64,

    // --- Behavioral cooldown (Invariant 7 / 12) ---
    /// While `now < behavioral_cooldown_until`, EVERY transfer to an
    /// execution-tagged owner must go through the gated top-up path,
    /// regardless of amount -- no per-transaction floor applies. This can
    /// ONLY be set by `apply_cre_verdict`, signed by `cre_verifier`, and it
    /// is monotonic: a new value can only raise it (`max(current, new)`),
    /// never lower it. It clears only by natural time expiry -- there is no
    /// instruction, delayed or otherwise, that can reduce or clear it early.
    /// This is the single authorized arming transition CRITICAL #2 (round 2
    /// review) demanded.
    pub behavioral_cooldown_until: i64,

    // --- Rolling velocity accumulator (Invariant 6) ---
    /// Sum of outbound transfers to execution-tagged owners and capped cold
    /// transfers, bucketed into six 4-hour windows. `bucket_start` is the
    /// unix timestamp the currently-active bucket began.
    pub velocity_buckets: [u64; NUM_VELOCITY_BUCKETS],
    pub bucket_start: i64,
    pub current_bucket_index: u8,

    /// Bumped every `tighten`. A pending rule-change proposal created under
    /// an older version is stale at execute time and must be re-proposed
    /// (HIGH #7 from round 2 review) -- this makes "wouldn't have power if
    /// re-proposed today" an executable check, not prose.
    pub config_version: u64,

    /// Monotonic nonce for proposal identity, incremented on every new
    /// proposal (any category).
    pub proposal_nonce_counter: u64,

    pub bump: u8,
    pub vault_token_account_bump: u8,
}

impl Vault {
    pub const SEED_PREFIX: &'static [u8] = b"vault";
    pub const VAULT_TOKEN_SEED_PREFIX: &'static [u8] = b"vault-token";

    pub const SIZE: usize = 8 // discriminator
        + 32 * 4 // authority, usdc_mint, vault_token_account, cre_verifier
        + 2 // top_up_threshold_bps
        + 8 // emergency_cap
        + 8 // velocity_threshold
        + 8 * 3 // three cooldowns
        + 8 // behavioral_cooldown_until
        + 8 * NUM_VELOCITY_BUCKETS
        + 8 // bucket_start
        + 1 // current_bucket_index
        + 8 // config_version
        + 8 // proposal_nonce_counter
        + 1 + 1; // bumps

    /// Row 4's per-transaction threshold, computed against the vault's
    /// CURRENT balance (read from the token account, passed in by the
    /// caller since Anchor state doesn't cache external account balances).
    pub fn top_up_threshold_amount(&self, current_balance: u64) -> Result<u64> {
        (current_balance as u128)
            .checked_mul(self.top_up_threshold_bps as u128)
            .and_then(|v| v.checked_div(BPS_DENOM as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(ShieldError::MathOverflow.into())
    }

    /// Roll the bucket window forward to `now`, zeroing any buckets whose
    /// window has fully passed. Must be called before every read or write
    /// of the velocity accumulator so stale volume never lingers.
    pub fn roll_buckets(&mut self, now: i64) -> Result<()> {
        if self.bucket_start == 0 {
            // First-ever transfer: initialize the window at `now`.
            self.bucket_start = now;
            self.current_bucket_index = 0;
            return Ok(());
        }

        let elapsed = now
            .checked_sub(self.bucket_start)
            .ok_or(ShieldError::MathOverflow)?;
        if elapsed < 0 {
            // Clock went backwards relative to our stored start -- treat as
            // no time having passed rather than panicking. Solana's Clock
            // sysvar is monotonic in practice; this is defensive only.
            return Ok(());
        }

        let buckets_elapsed = (elapsed / BUCKET_LEN_SECS).min(NUM_VELOCITY_BUCKETS as i64);
        if buckets_elapsed == 0 {
            return Ok(());
        }

        if buckets_elapsed >= NUM_VELOCITY_BUCKETS as i64 {
            // More than a full window has passed: everything is stale.
            self.velocity_buckets = [0u64; NUM_VELOCITY_BUCKETS];
        } else {
            // Zero out exactly the buckets that have rolled out of the window.
            for i in 0..buckets_elapsed {
                let idx = (self.current_bucket_index as i64 + 1 + i) as usize % NUM_VELOCITY_BUCKETS;
                self.velocity_buckets[idx] = 0;
            }
            self.current_bucket_index =
                ((self.current_bucket_index as i64 + buckets_elapsed) % NUM_VELOCITY_BUCKETS as i64) as u8;
        }

        // Re-anchor bucket_start to the start of the now-current bucket.
        self.bucket_start = self
            .bucket_start
            .checked_add(buckets_elapsed.checked_mul(BUCKET_LEN_SECS).ok_or(ShieldError::MathOverflow)?)
            .ok_or(ShieldError::MathOverflow)?;

        Ok(())
    }

    pub fn velocity_sum(&self) -> u64 {
        self.velocity_buckets.iter().sum()
    }

    /// The explicit state transition CRITICAL #1 (round 2 review) required:
    /// crossing the threshold BLOCKS the transfer outright rather than just
    /// recording it. Call after `roll_buckets`. On success, reserves the
    /// amount into the current bucket atomically with the caller's transfer
    /// logic -- there is no code path that moves funds without this running
    /// first in the same instruction.
    pub fn check_and_reserve_velocity(&mut self, amount: u64) -> Result<()> {
        let sum = self.velocity_sum();
        let would_be = sum
            .checked_add(amount)
            .ok_or(ShieldError::MathOverflow)?;
        require!(
            would_be < self.velocity_threshold,
            ShieldError::VelocityThresholdExceeded
        );
        let idx = self.current_bucket_index as usize;
        self.velocity_buckets[idx] = self.velocity_buckets[idx]
            .checked_add(amount)
            .ok_or(ShieldError::MathOverflow)?;
        Ok(())
    }

    /// Refund a reservation (used when a gated top-up proposal that already
    /// reserved capacity is cancelled before executing).
    pub fn refund_velocity_reservation(&mut self, amount: u64, bucket_index: u8) {
        let idx = bucket_index as usize;
        self.velocity_buckets[idx] = self.velocity_buckets[idx].saturating_sub(amount);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OwnerType {
    Execution,
    Cold,
}

#[account]
pub struct RegistryEntry {
    pub vault: Pubkey,
    pub owner: Pubkey,
    /// Permanent, set exactly once at first registration. There is no
    /// instruction anywhere in this program that can change this field.
    pub kind: OwnerType,
    /// Removing a registration (instant tighten) sets this false. The
    /// `kind` above is retained forever regardless -- an owner can never be
    /// re-registered under a different type, even after removal.
    pub active: bool,
    pub registered_at: i64,
    pub bump: u8,
}

impl RegistryEntry {
    pub const SEED_PREFIX: &'static [u8] = b"registry";
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProposalCategory {
    RuleChange = 0,
    TopUp = 1,
    FullExit = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ProposalAction {
    /// Any subset of fields may change; `None` means "leave as-is". Every
    /// non-None field must be a genuine loosening (validated at propose
    /// time) -- raising an allowance, shortening a cooldown, or registering
    /// a new cold address.
    Loosen {
        new_top_up_threshold_bps: Option<u16>,
        new_emergency_cap: Option<u64>,
        new_velocity_threshold: Option<u64>,
        new_top_up_cooldown_secs: Option<i64>,
        new_loosen_cooldown_secs: Option<i64>,
        new_full_exit_cooldown_secs: Option<i64>,
        register_cold_owner: Option<Pubkey>,
    },
    TopUp {
        destination_owner: Pubkey,
        amount: u64,
        /// The bucket this amount was reserved into at propose time, so a
        /// cancellation can refund the exact reservation.
        reserved_bucket_index: u8,
    },
    UninstallVault {
        destination_owner: Pubkey,
    },
    ColdTransferAboveCap {
        destination_owner: Pubkey,
        amount: u64,
    },
}

#[account]
pub struct Proposal {
    pub vault: Pubkey,
    pub category: ProposalCategory,
    pub action: ProposalAction,
    pub nonce: u64,
    pub created_at: i64,
    pub execute_after: i64,
    pub expiry: i64,
    /// Snapshot of `vault.config_version` at creation. Checked against the
    /// live value at execute time (HIGH #7): a mismatch means the vault was
    /// tightened since this was proposed, and the proposal is stale.
    pub config_version_at_creation: u64,
    pub bump: u8,
}

impl Proposal {
    pub const SEED_PREFIX: &'static [u8] = b"proposal";
    // Generous fixed size to cover the largest ProposalAction variant plus
    // Anchor/Borsh enum overhead.
    pub const SIZE: usize = 8 + 32 + 1 + 1 + (1 + 32 + 8 * 6 + 1 + 33) + 8 + 8 + 8 + 8 + 8 + 1;
}

/// A CRE verdict, passed as instruction data (not a stored account) and
/// verified against `vault.cre_verifier`'s signature over these exact
/// fields. Binding is explicit (HIGH #5 / round 1 review): vault, proposal
/// nonce, program ID, and expiry are all checked, so a verdict can never be
/// replayed against a different proposal or a different vault.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreVerdict {
    pub vault: Pubkey,
    pub proposal_nonce: u64,
    pub program_id: Pubkey,
    pub expiry: i64,
    /// Extend the pending TopUp proposal's `execute_after` to at least this
    /// timestamp. Applying `max(current, extend_until)` makes this
    /// extend-only at the program level regardless of what the verdict
    /// claims.
    pub extend_until: i64,
    /// Arm/extend the behavioral cooldown via `max(current, value)`. `0`
    /// is the "don't touch it" sentinel, not `Option::None` -- since
    /// `behavioral_cooldown_until` is always >= 0 once a vault exists,
    /// `max(current, 0)` is a guaranteed no-op, so a plain `i64` carries
    /// the same "leave untouched vs. extend" semantics as an `Option`
    /// would without needing one on either side of the CRE-workflow wire
    /// (see cre/workflow.ts, which hits a CRE report-schema constraint
    /// that rejects a nullable field here).
    pub behavioral_cooldown_until: i64,
    /// Ed25519 signature over the borsh-serialized fields above, produced
    /// by `vault.cre_verifier`. Verified via the Ed25519 program
    /// instruction introspection pattern (see `verify_verdict_signature`).
    pub signature: [u8; 64],
}
