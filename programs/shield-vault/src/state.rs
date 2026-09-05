//! Account state, policy parameters, and the wire types shared with the
//! off-chain clients (client/shield-client.ts mirrors every layout here
//! field-for-field; substreams/ and cre/ mirror the event and verdict
//! types). Read docs/ARCHITECTURE_DECISION.md and docs/THREAT_MODEL.md for
//! the reasoning; this file is the single source of truth for layout.

use crate::errors::ShieldError;
use anchor_lang::prelude::*;

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/// Six 4-hour buckets covering a rolling 24h window. Sum-and-rotate, never
/// prune-on-read: strictly simpler than a fully pruned sliding window and
/// still closes the structuring gap ("four $400s == one $1,600").
pub const NUM_VELOCITY_BUCKETS: usize = 6;
pub const BUCKET_LEN_SECS: i64 = 4 * 60 * 60;
pub const VELOCITY_WINDOW_SECS: i64 = NUM_VELOCITY_BUCKETS as i64 * BUCKET_LEN_SECS;

pub const DEFAULT_TOP_UP_COOLDOWN_SECS: i64 = 30 * 60; // large top-ups pause 30 minutes
pub const DEFAULT_LOOSEN_COOLDOWN_SECS: i64 = 24 * 60 * 60; // weakening a rule waits 24h
pub const DEFAULT_FULL_EXIT_COOLDOWN_SECS: i64 = 7 * 24 * 60 * 60; // leaving Shield waits 7d
/// Once matured, a proposal stays executable for this long, then expires.
pub const PROPOSAL_EXECUTION_GRACE_SECS: i64 = 7 * 24 * 60 * 60;
/// Hard ceilings/floors on the tunable delays so a "loosen" can never make
/// weakening instant, and a pause can never become a permanent self-lock.
pub const MIN_LOOSEN_COOLDOWN_SECS: i64 = 60 * 60;
pub const MIN_FULL_EXIT_COOLDOWN_SECS: i64 = 60 * 60;
pub const MAX_LOSS_COOLDOWN_SECS: i64 = 30 * 24 * 60 * 60;
pub const MAX_SELF_PAUSE_SECS: i64 = 30 * 24 * 60 * 60;
/// Tolerated skew between the monitor's clock and the Solana clock.
pub const VERDICT_CLOCK_SKEW_SECS: i64 = 5 * 60;

pub const BPS_DENOM: u64 = 10_000;

pub const COOLDOWN_REASON_NONE: u8 = 0;
pub const COOLDOWN_REASON_SELF_PAUSE: u8 = 1;
pub const COOLDOWN_REASON_RISK_VERDICT: u8 = 2;

pub const LABEL_LEN: usize = 24;

// ---------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------

#[account]
pub struct Vault {
    /// The user's own key: the sole root of authority. There is no
    /// instruction to change it. Losing it has no recovery path in v1
    /// (accepted limitation, stated in docs/THREAT_MODEL.md).
    pub authority: Pubkey,
    /// Pinned USDC mint. Single-asset by design: no price oracle needed.
    pub usdc_mint: Pubkey,
    /// The vault's own USDC token account, owned by this PDA.
    pub vault_token_account: Pubkey,
    /// Trust root for risk verdicts. `Pubkey::default()` means "no monitor".
    /// Adding a monitor is a tighten (instant); changing or removing one is
    /// a loosen (delayed). A monitor can only ever arm the loss cooldown.
    pub risk_verifier: Pubkey,

    // ---- Policy (every field is classified tighten/loosen in lib.rs) ----
    /// Top-ups and instant cold transfers may never take the vault below
    /// this balance. Only the 7-day full-exit path ignores it.
    pub protected_floor: u64,
    /// Single-transfer instant threshold, in bps of the CURRENT balance. A
    /// top-up at or above this fraction must take the gated (delayed) path.
    pub top_up_threshold_bps: u16,
    /// Instant cold-transfer cap (raw USDC). Above it, cold transfers take
    /// the 7-day full-exit path.
    pub emergency_cap: u64,
    /// Vault-global 24h rolling cap across top-ups and capped cold
    /// transfers. Exceeding it blocks BOTH the instant and the gated path.
    pub velocity_threshold: u64,
    /// The user's loss rule: a risk verdict must attest realized losses of
    /// at least this much (raw USDC) or the vault rejects it outright.
    pub loss_trigger_usdc: u64,
    /// How long the loss cooldown lasts once armed. The monitor never
    /// chooses this; the vault computes `now + loss_cooldown_secs`.
    pub loss_cooldown_secs: i64,
    pub top_up_cooldown_secs: i64,
    pub loosen_cooldown_secs: i64,
    pub full_exit_cooldown_secs: i64,

    // ---- Cooldown state (extend-only) ----
    /// While `now < cooldown_until`, no top-up may execute on any path.
    /// Set only by `tighten` (self-pause) or `apply_risk_verdict`, always
    /// via `max(current, new)`. It clears only by time passing.
    pub cooldown_until: i64,
    pub cooldown_reason: u8,
    pub cooldown_set_at: i64,
    /// Strictly increasing nonce of the last accepted verdict (replay guard).
    pub last_verdict_nonce: u64,
    pub last_verdict_reason: u8,
    /// Hash of the evidence bundle the last verdict cited, so the UI can
    /// link "why" to a specific, auditable set of on-chain facts.
    pub last_verdict_evidence: [u8; 32],

    // ---- Rolling velocity accumulator ----
    pub velocity_buckets: [u64; NUM_VELOCITY_BUCKETS],
    pub bucket_start: i64,
    pub current_bucket_index: u8,

    // ---- Versioning ----
    /// Bumped on every user-initiated tighten. A pending weakening proposal
    /// created under an older version is stale at execute time.
    pub config_version: u64,
    /// Monotonic proposal identity counter (all categories).
    pub proposal_nonce_counter: u64,
    pub created_at: i64,

    pub bump: u8,
    pub vault_token_account_bump: u8,
}

impl Vault {
    pub const SEED_PREFIX: &'static [u8] = b"vault";
    pub const VAULT_TOKEN_SEED_PREFIX: &'static [u8] = b"vault-token";

    pub const SIZE: usize = 8 // discriminator
        + 32 * 4 // authority, usdc_mint, vault_token_account, risk_verifier
        + 8 // protected_floor
        + 2 // top_up_threshold_bps
        + 8 // emergency_cap
        + 8 // velocity_threshold
        + 8 // loss_trigger_usdc
        + 8 // loss_cooldown_secs
        + 8 * 3 // top_up / loosen / full_exit cooldowns
        + 8 // cooldown_until
        + 1 // cooldown_reason
        + 8 // cooldown_set_at
        + 8 // last_verdict_nonce
        + 1 // last_verdict_reason
        + 32 // last_verdict_evidence
        + 8 * NUM_VELOCITY_BUCKETS
        + 8 // bucket_start
        + 1 // current_bucket_index
        + 8 // config_version
        + 8 // proposal_nonce_counter
        + 8 // created_at
        + 1 + 1 // bumps
        + 64; // reserved

    pub fn top_up_threshold_amount(&self, current_balance: u64) -> Result<u64> {
        (current_balance as u128)
            .checked_mul(self.top_up_threshold_bps as u128)
            .and_then(|v| v.checked_div(BPS_DENOM as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(ShieldError::MathOverflow.into())
    }

    pub fn cooldown_active(&self, now: i64) -> bool {
        now < self.cooldown_until
    }

    /// Balance after `amount` leaves must stay at or above the floor.
    pub fn check_floor(&self, current_balance: u64, amount: u64) -> Result<()> {
        let remaining = current_balance
            .checked_sub(amount)
            .ok_or(ShieldError::ProtectedFloorBreached)?;
        require!(remaining >= self.protected_floor, ShieldError::ProtectedFloorBreached);
        Ok(())
    }

    /// Roll the bucket window forward to `now`, zeroing buckets that have
    /// fully left the 24h window. Call before every velocity read/write.
    pub fn roll_buckets(&mut self, now: i64) -> Result<()> {
        if self.bucket_start == 0 {
            self.bucket_start = now;
            self.current_bucket_index = 0;
            return Ok(());
        }
        let elapsed = now.checked_sub(self.bucket_start).ok_or(ShieldError::MathOverflow)?;
        if elapsed < 0 {
            return Ok(());
        }
        let buckets_elapsed = (elapsed / BUCKET_LEN_SECS).min(NUM_VELOCITY_BUCKETS as i64);
        if buckets_elapsed == 0 {
            return Ok(());
        }
        if buckets_elapsed >= NUM_VELOCITY_BUCKETS as i64 {
            self.velocity_buckets = [0u64; NUM_VELOCITY_BUCKETS];
        } else {
            for i in 0..buckets_elapsed {
                let idx = (self.current_bucket_index as i64 + 1 + i) as usize % NUM_VELOCITY_BUCKETS;
                self.velocity_buckets[idx] = 0;
            }
            self.current_bucket_index =
                ((self.current_bucket_index as i64 + buckets_elapsed) % NUM_VELOCITY_BUCKETS as i64) as u8;
        }
        self.bucket_start = self
            .bucket_start
            .checked_add(buckets_elapsed.checked_mul(BUCKET_LEN_SECS).ok_or(ShieldError::MathOverflow)?)
            .ok_or(ShieldError::MathOverflow)?;
        Ok(())
    }

    pub fn velocity_sum(&self) -> u64 {
        self.velocity_buckets.iter().sum()
    }

    /// Read-only: would `amount` fit inside the 24h limit?
    pub fn check_velocity(&self, amount: u64) -> Result<()> {
        let would_be = self.velocity_sum().checked_add(amount).ok_or(ShieldError::MathOverflow)?;
        require!(would_be <= self.velocity_threshold, ShieldError::VelocityThresholdExceeded);
        Ok(())
    }

    /// Check, then reserve into the current bucket. Atomic with the
    /// caller's transfer/proposal in the same instruction.
    pub fn check_and_reserve_velocity(&mut self, amount: u64) -> Result<()> {
        self.check_velocity(amount)?;
        let idx = self.current_bucket_index as usize;
        self.velocity_buckets[idx] = self.velocity_buckets[idx]
            .checked_add(amount)
            .ok_or(ShieldError::MathOverflow)?;
        Ok(())
    }

    pub fn refund_velocity_reservation(&mut self, amount: u64, bucket_index: u8) {
        let idx = (bucket_index as usize) % NUM_VELOCITY_BUCKETS;
        self.velocity_buckets[idx] = self.velocity_buckets[idx].saturating_sub(amount);
    }
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OwnerType {
    /// A trading venue / execution wallet. Receives top-ups under the rules.
    Execution,
    /// A verified personal exit address. Receives capped instant transfers
    /// and is the only kind of destination a full exit may target.
    Cold,
}

#[account]
pub struct RegistryEntry {
    pub vault: Pubkey,
    pub owner: Pubkey,
    /// Permanent: set exactly once at first registration, never changed.
    pub kind: OwnerType,
    /// Removing a registration (instant tighten) sets this false. `kind`
    /// is retained forever so an owner can never come back under a
    /// different type.
    pub active: bool,
    pub registered_at: i64,
    pub label: [u8; LABEL_LEN],
    pub bump: u8,
}

impl RegistryEntry {
    pub const SEED_PREFIX: &'static [u8] = b"registry";
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 8 + LABEL_LEN + 1 + 16;
}

// ---------------------------------------------------------------------
// Instruction parameter structs
// ---------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeParams {
    pub risk_verifier: Pubkey,
    pub protected_floor: u64,
    pub top_up_threshold_bps: u16,
    pub emergency_cap: u64,
    pub velocity_threshold: u64,
    pub loss_trigger_usdc: u64,
    pub loss_cooldown_secs: i64,
}

/// Every field may only move in the STRICTER direction. Validated in
/// `tighten`; `None` means "leave as-is".
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct TightenParams {
    pub new_protected_floor: Option<u64>,       // must be >= current
    pub new_top_up_threshold_bps: Option<u16>,  // must be <= current
    pub new_emergency_cap: Option<u64>,         // must be <= current
    pub new_velocity_threshold: Option<u64>,    // must be <= current
    pub new_loss_trigger_usdc: Option<u64>,     // must be <= current
    pub new_loss_cooldown_secs: Option<i64>,    // must be >= current
    pub new_top_up_cooldown_secs: Option<i64>,  // must be >= current
    pub new_loosen_cooldown_secs: Option<i64>,  // must be >= current
    pub new_full_exit_cooldown_secs: Option<i64>, // must be >= current
    /// Self-pause: block every top-up until this timestamp (extend-only).
    pub pause_top_ups_until: Option<i64>,
    /// Add a monitor where none exists (none -> some is a tightening).
    pub set_risk_verifier: Option<Pubkey>,
}

/// Every field may only move in the WEAKER direction (or add a
/// destination). Validated at propose time; executes after the delay.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct LoosenParams {
    pub new_protected_floor: Option<u64>,       // must be <= current
    pub new_top_up_threshold_bps: Option<u16>,  // must be >= current
    pub new_emergency_cap: Option<u64>,         // must be >= current
    pub new_velocity_threshold: Option<u64>,    // must be >= current
    pub new_loss_trigger_usdc: Option<u64>,     // must be >= current
    pub new_loss_cooldown_secs: Option<i64>,    // must be <= current
    pub new_top_up_cooldown_secs: Option<i64>,  // must be <= current
    pub new_loosen_cooldown_secs: Option<i64>,  // must be <= current, >= MIN
    pub new_full_exit_cooldown_secs: Option<i64>, // must be <= current, >= MIN
    /// Replace or remove (Pubkey::default()) the monitor.
    pub new_risk_verifier: Option<Pubkey>,
    /// Register a new destination (either kind) once the vault is funded.
    pub register_owner: Option<Pubkey>,
    /// 0 = Execution, 1 = Cold. Only read when `register_owner` is Some.
    pub register_kind: u8,
    pub register_label: [u8; LABEL_LEN],
}

// ---------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProposalCategory {
    RuleChange = 0,
    TopUp = 1,
    FullExit = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ProposalAction {
    Loosen(LoosenParams),
    TopUp {
        destination_owner: Pubkey,
        amount: u64,
        /// Bucket the amount was reserved into at propose time, so a
        /// cancellation refunds the exact reservation.
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
    /// Snapshot of `vault.config_version` at creation; must still match at
    /// execute time, else the proposal is stale.
    pub config_version_at_creation: u64,
    pub bump: u8,
}

impl Proposal {
    pub const SEED_PREFIX: &'static [u8] = b"proposal";
    /// Generous fixed size covering the largest `ProposalAction` variant.
    pub const SIZE: usize = 8 + 32 + 1 + 200 + 8 + 8 + 8 + 8 + 8 + 1 + 32;
}

// ---------------------------------------------------------------------
// Risk verdict (instruction data, never stored)
// ---------------------------------------------------------------------

/// Signed by `vault.risk_verifier` (the CRE confidential workflow's enclave
/// key, or any monitor the user pins). The vault checks binding (vault,
/// program), freshness (expiry, skew), replay (nonce), and — crucially —
/// that the attested loss meets the USER's own trigger. The verdict never
/// carries a duration: the vault computes it from `loss_cooldown_secs`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RiskVerdict {
    pub vault: Pubkey,
    pub program_id: Pubkey,
    pub nonce: u64,
    pub issued_at: i64,
    pub expiry: i64,
    /// What pattern the monitor saw (informational; see docs/THREAT_MODEL.md).
    pub reason_code: u8,
    /// Realized loss the monitor attests over its evaluation window (raw USDC).
    pub realized_loss_usdc: u64,
    /// SHA-256 of the evidence bundle (transactions, windows, derived stats).
    pub evidence_hash: [u8; 32],
    /// Ed25519 signature over the Borsh encoding of the fields above with
    /// this field zeroed.
    pub signature: [u8; 64],
}
