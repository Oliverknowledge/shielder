//! Shield Vault — the safety floor.
//!
//! Implements the Anchor program described in
//! `docs/designs/shield-treasury-vault.md`. Read that doc first; this file
//! implements it, it doesn't re-explain it. Comments here point back to the
//! specific invariant or review finding a piece of code exists to satisfy.
//!
//! The one rule everything else serves: **this program must be correct with
//! every off-chain service (Graph, CRE, Shield's frontend/backend) dead.**

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod ed25519;
pub mod errors;
pub mod state;

use ed25519::verify_ed25519_ix;
use errors::ShieldError;
use state::*;

declare_id!("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");

#[program]
pub mod shield_vault {
    use super::*;

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        cre_verifier: Pubkey,
        top_up_threshold_bps: u16,
        emergency_cap: u64,
        velocity_threshold: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.cre_verifier = cre_verifier;

        vault.top_up_threshold_bps = top_up_threshold_bps;
        vault.emergency_cap = emergency_cap;
        vault.velocity_threshold = velocity_threshold;
        vault.top_up_cooldown_secs = DEFAULT_TOP_UP_COOLDOWN_SECS;
        vault.loosen_cooldown_secs = DEFAULT_LOOSEN_COOLDOWN_SECS;
        vault.full_exit_cooldown_secs = DEFAULT_FULL_EXIT_COOLDOWN_SECS;

        vault.behavioral_cooldown_until = 0;
        vault.velocity_buckets = [0u64; NUM_VELOCITY_BUCKETS];
        vault.bucket_start = 0;
        vault.current_bucket_index = 0;

        vault.config_version = 1;
        vault.proposal_nonce_counter = 0;

        vault.bump = ctx.bumps.vault;
        vault.vault_token_account_bump = ctx.bumps.vault_token_account;

        Ok(())
    }

    // ---------------------------------------------------------------
    // Registration (Invariant 5)
    // ---------------------------------------------------------------

    /// Registering an EXECUTION owner is instant (row 1: tighten). It can
    /// only ever subject that owner to MORE scrutiny (row 4 applies to it),
    /// so it's exactly like tightening a rule.
    pub fn register_execution(ctx: Context<RegisterOwner>, _owner: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        let entry = &mut ctx.accounts.registry_entry;
        if entry.registered_at != 0 {
            // Already exists: permanent type check.
            require!(
                entry.kind == OwnerType::Execution,
                ShieldError::AlreadyRegisteredDifferentType
            );
            entry.active = true;
        } else {
            entry.vault = ctx.accounts.vault.key();
            entry.owner = _owner;
            entry.kind = OwnerType::Execution;
            entry.active = true;
            entry.registered_at = Clock::get()?.unix_timestamp;
            entry.bump = ctx.bumps.registry_entry;
        }
        Ok(())
    }

    /// Removing ANY registration (execution or cold) is instant (row 1:
    /// tighten) -- it can only reduce what the vault will do. The
    /// underlying `kind` on the account is retained forever; it is never
    /// reset, so the owner can never come back under a different type.
    pub fn remove_registration(ctx: Context<ModifyOwnRegistration>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        ctx.accounts.registry_entry.active = false;
        Ok(())
    }

    // ---------------------------------------------------------------
    // Rule changes: tighten (instant) vs loosen (24h, delayed)
    // ---------------------------------------------------------------

    /// Row 1. Every field here may only move in the STRICTER direction;
    /// validated explicitly below so a caller can never sneak a loosening
    /// change through the instant path (the exact monotonicity bug round 2
    /// review found and this program closes structurally, not just by
    /// convention).
    pub fn tighten(
        ctx: Context<Tighten>,
        new_top_up_threshold_bps: Option<u16>,
        new_emergency_cap: Option<u64>,
        new_velocity_threshold: Option<u64>,
        new_top_up_cooldown_secs: Option<i64>,
        new_loosen_cooldown_secs: Option<i64>,
        new_full_exit_cooldown_secs: Option<i64>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);

        let mut changed = false;

        if let Some(v) = new_top_up_threshold_bps {
            require!(v <= vault.top_up_threshold_bps, ShieldError::NotATightening);
            vault.top_up_threshold_bps = v;
            changed = true;
        }
        if let Some(v) = new_emergency_cap {
            require!(v <= vault.emergency_cap, ShieldError::NotATightening);
            vault.emergency_cap = v;
            changed = true;
        }
        if let Some(v) = new_velocity_threshold {
            require!(v <= vault.velocity_threshold, ShieldError::NotATightening);
            vault.velocity_threshold = v;
            changed = true;
        }
        if let Some(v) = new_top_up_cooldown_secs {
            require!(v >= vault.top_up_cooldown_secs, ShieldError::NotATightening);
            vault.top_up_cooldown_secs = v;
            changed = true;
        }
        if let Some(v) = new_loosen_cooldown_secs {
            require!(v >= vault.loosen_cooldown_secs, ShieldError::NotATightening);
            vault.loosen_cooldown_secs = v;
            changed = true;
        }
        if let Some(v) = new_full_exit_cooldown_secs {
            require!(v >= vault.full_exit_cooldown_secs, ShieldError::NotATightening);
            vault.full_exit_cooldown_secs = v;
            changed = true;
        }

        require!(changed, ShieldError::NotATightening);

        // HIGH #7 (round 2 review): any tightening invalidates stale
        // pending weakening proposals by bumping config_version. Their
        // execute-time check will now fail with ProposalStale.
        vault.config_version = vault
            .config_version
            .checked_add(1)
            .ok_or(ShieldError::MathOverflow)?;

        Ok(())
    }

    /// Row 2/3. Always 24h, always cancelable, always queued in the
    /// `RuleChange` category (one pending slot). Every field must be a
    /// genuine loosening or a new cold registration -- validated below.
    pub fn propose_loosen(
        ctx: Context<ProposeRuleChange>,
        new_top_up_threshold_bps: Option<u16>,
        new_emergency_cap: Option<u64>,
        new_velocity_threshold: Option<u64>,
        new_top_up_cooldown_secs: Option<i64>,
        new_loosen_cooldown_secs: Option<i64>,
        new_full_exit_cooldown_secs: Option<i64>,
        register_cold_owner: Option<Pubkey>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);

        let mut touched = false;
        if let Some(v) = new_top_up_threshold_bps {
            require!(v >= vault.top_up_threshold_bps, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = new_emergency_cap {
            require!(v >= vault.emergency_cap, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = new_velocity_threshold {
            require!(v >= vault.velocity_threshold, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = new_top_up_cooldown_secs {
            require!(v <= vault.top_up_cooldown_secs, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = new_loosen_cooldown_secs {
            require!(v <= vault.loosen_cooldown_secs, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = new_full_exit_cooldown_secs {
            require!(v <= vault.full_exit_cooldown_secs, ShieldError::NotALoosening);
            touched = true;
        }
        if register_cold_owner.is_some() {
            touched = true;
        }
        require!(touched, ShieldError::NotALoosening);

        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::RuleChange;
        proposal.action = ProposalAction::Loosen {
            new_top_up_threshold_bps,
            new_emergency_cap,
            new_velocity_threshold,
            new_top_up_cooldown_secs,
            new_loosen_cooldown_secs,
            new_full_exit_cooldown_secs,
            register_cold_owner,
        };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = now
            .checked_add(vault.loosen_cooldown_secs)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.expiry = proposal
            .execute_after
            .checked_add(PROPOSAL_EXECUTION_GRACE_SECS)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        Ok(())
    }

    pub fn execute_rule_change(ctx: Context<ExecuteRuleChange>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let proposal = &ctx.accounts.proposal;

        require!(proposal.category == ProposalCategory::RuleChange, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;

        if let ProposalAction::Loosen {
            new_top_up_threshold_bps,
            new_emergency_cap,
            new_velocity_threshold,
            new_top_up_cooldown_secs,
            new_loosen_cooldown_secs,
            new_full_exit_cooldown_secs,
            register_cold_owner,
        } = &proposal.action
        {
            if let Some(v) = new_top_up_threshold_bps {
                vault.top_up_threshold_bps = *v;
            }
            if let Some(v) = new_emergency_cap {
                vault.emergency_cap = *v;
            }
            if let Some(v) = new_velocity_threshold {
                vault.velocity_threshold = *v;
            }
            if let Some(v) = new_top_up_cooldown_secs {
                vault.top_up_cooldown_secs = *v;
            }
            if let Some(v) = new_loosen_cooldown_secs {
                vault.loosen_cooldown_secs = *v;
            }
            if let Some(v) = new_full_exit_cooldown_secs {
                vault.full_exit_cooldown_secs = *v;
            }
            if let Some(owner) = register_cold_owner {
                let entry = &mut ctx.accounts.registry_entry;
                if entry.registered_at != 0 {
                    require!(
                        entry.kind == OwnerType::Cold,
                        ShieldError::CannotDowngradeExecutionToCold
                    );
                    entry.active = true;
                } else {
                    entry.vault = vault.key();
                    entry.owner = *owner;
                    entry.kind = OwnerType::Cold;
                    entry.active = true;
                    entry.registered_at = Clock::get()?.unix_timestamp;
                    entry.bump = ctx.bumps.registry_entry;
                }
            }
        }

        Ok(())
    }

    /// Cancel a pending proposal in any category, any time before it
    /// executes. If it was a gated top-up that had reserved velocity
    /// capacity, refund that reservation.
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        if let ProposalAction::TopUp {
            amount,
            reserved_bucket_index,
            ..
        } = ctx.accounts.proposal.action.clone()
        {
            ctx.accounts
                .vault
                .refund_velocity_reservation(amount, reserved_bucket_index);
        }
        // Account is closed via the `close = authority` constraint.
        Ok(())
    }

    // ---------------------------------------------------------------
    // Top-ups (row 4) — the hero mechanic
    // ---------------------------------------------------------------

    /// The unrestricted-below-threshold path. Only reachable when:
    ///  - no behavioral cooldown is armed, AND
    ///  - amount is below the per-transaction threshold, AND
    ///  - amount does not push the vault-global rolling sum to/above the
    ///    velocity threshold (checked and reserved atomically here).
    /// Any of those failing routes the caller to `propose_top_up` instead.
    pub fn instant_top_up(ctx: Context<TopUpTransfer>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Execution,
            ShieldError::DestinationNotExecution
        );
        require!(
            now >= ctx.accounts.vault.behavioral_cooldown_until,
            ShieldError::BehavioralCooldownActive
        );

        let balance = ctx.accounts.vault_token_account.amount;
        let threshold = ctx.accounts.vault.top_up_threshold_amount(balance)?;
        require!(amount < threshold, ShieldError::NotATightening); // amount too large for instant path

        ctx.accounts.vault.roll_buckets(now)?;
        ctx.accounts.vault.check_and_reserve_velocity(amount)?;

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        Ok(())
    }

    /// The gated path: proposes a top-up, reserving its velocity capacity
    /// immediately (so a single pending proposal can't be "topped up" by a
    /// second one bypassing the accumulator -- moot in v1 since there is
    /// only one TopUp slot per vault, but reserved-at-propose-time is the
    /// correct invariant regardless of slot count).
    pub fn propose_top_up(ctx: Context<ProposeTopUp>, destination_owner: Pubkey, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Execution,
            ShieldError::DestinationNotExecution
        );

        let now = Clock::get()?.unix_timestamp;
        vault.roll_buckets(now)?;
        vault.check_and_reserve_velocity(amount)?;
        let reserved_bucket_index = vault.current_bucket_index;

        let nonce = next_nonce(vault)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::TopUp;
        proposal.action = ProposalAction::TopUp {
            destination_owner,
            amount,
            reserved_bucket_index,
        };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = now
            .checked_add(vault.top_up_cooldown_secs)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.expiry = proposal
            .execute_after
            .checked_add(PROPOSAL_EXECUTION_GRACE_SECS)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        Ok(())
    }

    pub fn execute_top_up(ctx: Context<ExecuteTopUp>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::TopUp, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;

        let (destination_owner, amount) = match &proposal.action {
            ProposalAction::TopUp {
                destination_owner,
                amount,
                ..
            } => (*destination_owner, *amount),
            _ => return err!(ShieldError::NoPendingProposal),
        };
        require_keys_eq!(
            ctx.accounts.registry_entry.owner,
            destination_owner,
            ShieldError::DestinationNotExecution
        );
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Execution,
            ShieldError::DestinationNotExecution
        );

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        Ok(())
    }

    /// CRITICAL #2 (round 2 review): the ONLY authorized transition that
    /// can arm or extend `behavioral_cooldown_until`, and the only way to
    /// extend a pending top-up's cooldown beyond its static value. Requires
    /// a preceding native Ed25519Program instruction in the same
    /// transaction, signed by `vault.cre_verifier` (HIGH #5 / Invariant
    /// 13), binding to this exact vault + proposal nonce + program ID +
    /// expiry (round 1 review). Both effects are strictly monotonic
    /// (`max(current, new)`) -- there is no code path in this program that
    /// can reduce either value before natural expiry.
    pub fn apply_cre_verdict(ctx: Context<ApplyCreVerdict>, verdict: CreVerdict) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;

        require!(now <= verdict.expiry, ShieldError::VerdictExpired);
        require_keys_eq!(verdict.vault, vault.key(), ShieldError::VerdictWrongBinding);
        require_keys_eq!(verdict.program_id, crate::ID, ShieldError::VerdictWrongBinding);

        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::TopUp, ShieldError::NoPendingProposal);
        require_eq!(proposal.nonce, verdict.proposal_nonce, ShieldError::VerdictWrongBinding);

        // The signature field itself is excluded from the signed message by
        // convention: re-serialize without it for the check.
        let mut signed_fields = verdict.clone();
        signed_fields.signature = [0u8; 64];
        let message = signed_fields
            .try_to_vec()
            .map_err(|_| ShieldError::InvalidVerifier)?;
        verify_ed25519_ix(
            &ctx.accounts.instructions_sysvar,
            &vault.cre_verifier,
            &message,
            &verdict.signature,
        )?;

        require!(
            verdict.extend_until >= proposal.execute_after,
            ShieldError::VerdictMayOnlyExtend
        );
        ctx.accounts.proposal.execute_after = verdict.extend_until;

        // 0 is the documented no-op sentinel (see CreVerdict::behavioral_cooldown_until);
        // max() makes this a genuine no-op rather than requiring a branch.
        vault.behavioral_cooldown_until = vault.behavioral_cooldown_until.max(verdict.behavioral_cooldown_until);

        Ok(())
    }

    // ---------------------------------------------------------------
    // Cold transfers: row 6 (capped, instant) vs row 5 (above cap, 7d)
    // ---------------------------------------------------------------

    /// Row 6. Instant, always -- including with CRE and Graph both dead --
    /// but ONLY at or below the fixed emergency cap, and it shares the same
    /// vault-global velocity accumulator as top-ups (CRITICAL #1, round 1
    /// review: this is what stops the cap from being bled out in
    /// increments).
    pub fn instant_cold_transfer(ctx: Context<ColdTransfer>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active && ctx.accounts.registry_entry.kind == OwnerType::Cold,
            ShieldError::DestinationNotCold
        );
        require!(
            amount <= ctx.accounts.vault.emergency_cap,
            ShieldError::AmountExceedsEmergencyCap
        );

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.vault.roll_buckets(now)?;
        ctx.accounts.vault.check_and_reserve_velocity(amount)?;

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        Ok(())
    }

    /// Row 5 (cold branch). Above the emergency cap, a cold transfer is not
    /// a separate row at all -- it's a full-exit-category proposal, 7 days,
    /// destination and amount locked in now (HIGH #8, round 1 review: the
    /// registry requirement stays universal, this destination must already
    /// be a registered cold address, no exception carved out).
    pub fn propose_cold_transfer_above_cap(
        ctx: Context<ProposeFullExit>,
        destination_owner: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active && ctx.accounts.registry_entry.kind == OwnerType::Cold,
            ShieldError::FullExitDestinationNotRegisteredCold
        );

        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::FullExit;
        proposal.action = ProposalAction::ColdTransferAboveCap {
            destination_owner,
            amount,
        };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = now
            .checked_add(vault.full_exit_cooldown_secs)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.expiry = proposal
            .execute_after
            .checked_add(PROPOSAL_EXECUTION_GRACE_SECS)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        Ok(())
    }

    /// Row 5 (full uninstall branch). Destination must already be a
    /// registered cold address -- same universal-registry rule, no
    /// exception (HIGH #8).
    pub fn propose_uninstall_vault(ctx: Context<ProposeFullExit>, destination_owner: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active && ctx.accounts.registry_entry.kind == OwnerType::Cold,
            ShieldError::FullExitDestinationNotRegisteredCold
        );

        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::FullExit;
        proposal.action = ProposalAction::UninstallVault { destination_owner };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = now
            .checked_add(vault.full_exit_cooldown_secs)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.expiry = proposal
            .execute_after
            .checked_add(PROPOSAL_EXECUTION_GRACE_SECS)
            .ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        Ok(())
    }

    pub fn execute_full_exit(ctx: Context<ExecuteFullExit>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::FullExit, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;

        let amount = match &proposal.action {
            ProposalAction::ColdTransferAboveCap { amount, .. } => *amount,
            ProposalAction::UninstallVault { .. } => ctx.accounts.vault_token_account.amount,
            _ => return err!(ShieldError::NoPendingProposal),
        };

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        Ok(())
    }
}

// =====================================================================
// Shared helpers
// =====================================================================

fn next_nonce(vault: &mut Account<Vault>) -> Result<u64> {
    let n = vault.proposal_nonce_counter;
    vault.proposal_nonce_counter = vault
        .proposal_nonce_counter
        .checked_add(1)
        .ok_or(ShieldError::MathOverflow)?;
    Ok(n)
}

fn check_maturity_and_staleness(vault: &Vault, proposal: &Proposal) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= proposal.execute_after, ShieldError::ProposalNotMatured);
    require!(now <= proposal.expiry, ShieldError::ProposalExpired);
    // HIGH #7: a tighten since this proposal was created invalidates it.
    require!(
        proposal.config_version_at_creation == vault.config_version,
        ShieldError::ProposalStale
    );
    Ok(())
}

fn transfer_from_vault<'info>(
    vault_token_account: &Account<'info, TokenAccount>,
    destination_token_account: &Account<'info, TokenAccount>,
    vault: &Account<'info, Vault>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let vault_key = vault.authority;
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[Vault::SEED_PREFIX, vault_key.as_ref(), &[bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let cpi_accounts = Transfer {
        from: vault_token_account.to_account_info(),
        to: destination_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)
}

// =====================================================================
// Account contexts
// =====================================================================

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Vault::SIZE,
        seeds = [Vault::SEED_PREFIX, authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [Vault::VAULT_TOKEN_SEED_PREFIX, vault.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct RegisterOwner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = authority,
        space = RegistryEntry::SIZE,
        seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), owner.as_ref()],
        bump
    )]
    pub registry_entry: Account<'info, RegistryEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ModifyOwnRegistration<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,
}

#[derive(Accounts)]
pub struct Tighten<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct ProposeRuleChange<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = authority,
        space = Proposal::SIZE,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::RuleChange as u8]],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteRuleChange<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = executor,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::RuleChange as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// Only required/written when the proposal registers a new cold
    /// address; pass the vault authority's own PDA-derived address
    /// deterministically from the client when known, else a placeholder
    /// that's simply unused if `register_cold_owner` is None. Modeled here
    /// as `init_if_needed` keyed off the vault, resolved client-side.
    #[account(
        init_if_needed,
        payer = executor,
        space = RegistryEntry::SIZE,
        seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry_owner_hint.key().as_ref()],
        bump
    )]
    pub registry_entry: Account<'info, RegistryEntry>,

    /// CHECK: purely used as a seed hint for the registry entry PDA above;
    /// the client passes the pubkey named in the proposal's
    /// `register_cold_owner` field (or an arbitrary address if unused).
    pub registry_entry_owner_hint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, close = authority, has_one = vault)]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct TopUpTransfer<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(
        mut,
        constraint = destination_token_account.owner == registry_entry.owner @ ShieldError::TokenAccountOwnerMismatch,
        constraint = destination_token_account.mint == vault.usdc_mint @ ShieldError::WrongMint,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ProposeTopUp<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(
        init,
        payer = authority,
        space = Proposal::SIZE,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::TopUp as u8]],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTopUp<'info> {
    pub executor: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = executor,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::TopUp as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(
        mut,
        constraint = destination_token_account.owner == registry_entry.owner @ ShieldError::TokenAccountOwnerMismatch,
        constraint = destination_token_account.mint == vault.usdc_mint @ ShieldError::WrongMint,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ApplyCreVerdict<'info> {
    pub relayer: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::TopUp as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: verified by address constant against the sysvar ID inside
    /// `verify_ed25519_ix`.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ColdTransfer<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(
        mut,
        constraint = destination_token_account.owner == registry_entry.owner @ ShieldError::TokenAccountOwnerMismatch,
        constraint = destination_token_account.mint == vault.usdc_mint @ ShieldError::WrongMint,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ProposeFullExit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(
        init,
        payer = authority,
        space = Proposal::SIZE,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::FullExit as u8]],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteFullExit<'info> {
    pub executor: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = executor,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::FullExit as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
