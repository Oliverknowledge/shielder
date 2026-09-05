//! Shield Vault — the safety floor.
//!
//! A self-custodial treasury that gates the *reload*, not the trade. The
//! user (the sole authority) sets rules while calm; the program enforces
//! them deterministically, and every path that weakens protection is
//! delayed while every path that strengthens it is instant.
//!
//! The one rule everything else serves: **this program must be correct with
//! every off-chain service (Graph, CRE, Shield's frontend/backend) dead.**
//!
//! Policy surface (see docs/THREAT_MODEL.md for the tighten/loosen table):
//!   - protected_floor         top-ups can never take the vault below it
//!   - velocity_threshold      24h rolling top-up limit, vault-global
//!   - top_up_threshold_bps    large single top-ups pause `top_up_cooldown_secs`
//!   - loss_trigger / cooldown a signed loss verdict at/above the trigger arms
//!                             a cooldown the VAULT computes, never the monitor
//!   - emergency_cap           small instant transfers to cold addresses
//!   - loosen / full-exit      the delays that make "loosen slowly" real
//!
//! Comments reference the design review findings each check closes.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod ed25519;
pub mod errors;
pub mod events;
pub mod state;

use ed25519::verify_ed25519_ix;
use errors::ShieldError;
use events::*;
use state::*;

declare_id!("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");

#[program]
pub mod shield_vault {
    use super::*;

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------

    pub fn initialize_vault(ctx: Context<InitializeVault>, params: InitializeParams) -> Result<()> {
        require!(params.top_up_threshold_bps as u64 <= BPS_DENOM, ShieldError::InvalidParameter);
        require!(
            params.loss_cooldown_secs >= 0 && params.loss_cooldown_secs <= MAX_LOSS_COOLDOWN_SECS,
            ShieldError::InvalidParameter
        );
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.risk_verifier = params.risk_verifier;

        vault.protected_floor = params.protected_floor;
        vault.top_up_threshold_bps = params.top_up_threshold_bps;
        vault.emergency_cap = params.emergency_cap;
        vault.velocity_threshold = params.velocity_threshold;
        vault.loss_trigger_usdc = params.loss_trigger_usdc;
        vault.loss_cooldown_secs = params.loss_cooldown_secs;
        vault.top_up_cooldown_secs = DEFAULT_TOP_UP_COOLDOWN_SECS;
        vault.loosen_cooldown_secs = DEFAULT_LOOSEN_COOLDOWN_SECS;
        vault.full_exit_cooldown_secs = DEFAULT_FULL_EXIT_COOLDOWN_SECS;

        vault.cooldown_until = 0;
        vault.cooldown_reason = COOLDOWN_REASON_NONE;
        vault.cooldown_set_at = 0;
        vault.last_verdict_nonce = 0;
        vault.last_verdict_reason = 0;
        vault.last_verdict_evidence = [0u8; 32];

        vault.velocity_buckets = [0u64; NUM_VELOCITY_BUCKETS];
        vault.bucket_start = 0;
        vault.current_bucket_index = 0;

        vault.config_version = 1;
        vault.proposal_nonce_counter = 0;
        vault.created_at = now;
        vault.bump = ctx.bumps.vault;
        vault.vault_token_account_bump = ctx.bumps.vault_token_account;

        emit!(VaultInitialized {
            vault: vault.key(),
            authority: vault.authority,
            usdc_mint: vault.usdc_mint,
            protected_floor: vault.protected_floor,
            velocity_threshold: vault.velocity_threshold,
        });
        Ok(())
    }

    /// Deposits are always unrestricted. Anyone may deposit; the program
    /// only ever governs what LEAVES the vault.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ShieldError::ZeroAmount);
        let cpi_accounts = Transfer {
            from: ctx.accounts.source_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )?;
        ctx.accounts.vault_token_account.reload()?;
        emit!(Deposited {
            vault: ctx.accounts.vault.key(),
            depositor: ctx.accounts.depositor.key(),
            amount,
            new_balance: ctx.accounts.vault_token_account.amount,
        });
        Ok(())
    }

    // ---------------------------------------------------------------
    // Registration (destination allow-list)
    // ---------------------------------------------------------------

    /// Register a destination while the vault is EMPTY. Once funded, adding
    /// any destination (either kind) is a weakening change and must go
    /// through `propose_loosen` + 24h — this closes the "register the
    /// scammer's address, then top it up" hole found in review.
    pub fn register_owner(
        ctx: Context<RegisterOwner>,
        owner: Pubkey,
        kind: OwnerType,
        label: [u8; LABEL_LEN],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.vault_token_account.amount == 0,
            ShieldError::VaultFundedUseDelayedPath
        );
        let now = Clock::get()?.unix_timestamp;
        let vault_key = ctx.accounts.vault.key();
        apply_registration(&mut ctx.accounts.registry_entry, vault_key, owner, kind, label, now, ctx.bumps.registry_entry)?;
        Ok(())
    }

    /// Removing ANY registration is instant (a tighten): it can only reduce
    /// where funds may go. `kind` is retained forever.
    pub fn remove_registration(ctx: Context<ModifyOwnRegistration>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        let entry = &mut ctx.accounts.registry_entry;
        entry.active = false;
        let vault = &mut ctx.accounts.vault;
        vault.config_version = vault.config_version.checked_add(1).ok_or(ShieldError::MathOverflow)?;
        emit!(RegistrationChanged {
            vault: vault.key(),
            owner: entry.owner,
            kind: entry.kind as u8,
            active: false,
            label: entry.label,
        });
        Ok(())
    }

    // ---------------------------------------------------------------
    // Rule changes: tighten (instant) vs loosen (delayed)
    // ---------------------------------------------------------------

    /// Instant. Every field may only move in the STRICTER direction —
    /// validated field by field so nothing weakening can ride the fast path.
    pub fn tighten(ctx: Context<Tighten>, params: TightenParams) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);

        let mut changed = false;
        if let Some(v) = params.new_protected_floor {
            require!(v >= vault.protected_floor, ShieldError::NotATightening);
            vault.protected_floor = v;
            changed = true;
        }
        if let Some(v) = params.new_top_up_threshold_bps {
            require!(v <= vault.top_up_threshold_bps, ShieldError::NotATightening);
            vault.top_up_threshold_bps = v;
            changed = true;
        }
        if let Some(v) = params.new_emergency_cap {
            require!(v <= vault.emergency_cap, ShieldError::NotATightening);
            vault.emergency_cap = v;
            changed = true;
        }
        if let Some(v) = params.new_velocity_threshold {
            require!(v <= vault.velocity_threshold, ShieldError::NotATightening);
            vault.velocity_threshold = v;
            changed = true;
        }
        if let Some(v) = params.new_loss_trigger_usdc {
            require!(v <= vault.loss_trigger_usdc, ShieldError::NotATightening);
            vault.loss_trigger_usdc = v;
            changed = true;
        }
        if let Some(v) = params.new_loss_cooldown_secs {
            require!(v >= vault.loss_cooldown_secs, ShieldError::NotATightening);
            require!(v <= MAX_LOSS_COOLDOWN_SECS, ShieldError::InvalidParameter);
            vault.loss_cooldown_secs = v;
            changed = true;
        }
        if let Some(v) = params.new_top_up_cooldown_secs {
            require!(v >= vault.top_up_cooldown_secs, ShieldError::NotATightening);
            vault.top_up_cooldown_secs = v;
            changed = true;
        }
        if let Some(v) = params.new_loosen_cooldown_secs {
            require!(v >= vault.loosen_cooldown_secs, ShieldError::NotATightening);
            vault.loosen_cooldown_secs = v;
            changed = true;
        }
        if let Some(v) = params.new_full_exit_cooldown_secs {
            require!(v >= vault.full_exit_cooldown_secs, ShieldError::NotATightening);
            vault.full_exit_cooldown_secs = v;
            changed = true;
        }
        if let Some(until) = params.pause_top_ups_until {
            // Self-pause: extend-only, bounded, and it must actually extend.
            require!(until > now, ShieldError::NotATightening);
            require!(until > vault.cooldown_until, ShieldError::NotATightening);
            require!(
                until <= now.checked_add(MAX_SELF_PAUSE_SECS).ok_or(ShieldError::MathOverflow)?,
                ShieldError::PauseTooLong
            );
            vault.cooldown_until = until;
            vault.cooldown_reason = COOLDOWN_REASON_SELF_PAUSE;
            vault.cooldown_set_at = now;
            changed = true;
        }
        if let Some(v) = params.set_risk_verifier {
            // Adding a monitor where none exists only adds scrutiny.
            require!(vault.risk_verifier == Pubkey::default(), ShieldError::NotATightening);
            require!(v != Pubkey::default(), ShieldError::InvalidParameter);
            vault.risk_verifier = v;
            changed = true;
        }
        require!(changed, ShieldError::NotATightening);

        // Any user-initiated tighten invalidates stale pending weakening
        // proposals (config_version mismatch at execute time).
        vault.config_version = vault.config_version.checked_add(1).ok_or(ShieldError::MathOverflow)?;

        emit!(PolicyTightened {
            vault: vault.key(),
            config_version: vault.config_version,
            cooldown_until: vault.cooldown_until,
            protected_floor: vault.protected_floor,
            velocity_threshold: vault.velocity_threshold,
            top_up_threshold_bps: vault.top_up_threshold_bps,
            loss_trigger_usdc: vault.loss_trigger_usdc,
            loss_cooldown_secs: vault.loss_cooldown_secs,
        });
        Ok(())
    }

    /// Delayed (`loosen_cooldown_secs`), always cancelable, one pending slot.
    /// Every field must be a genuine loosening (or a new destination).
    pub fn propose_loosen(ctx: Context<ProposeRuleChange>, params: LoosenParams) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);

        let mut touched = false;
        if let Some(v) = params.new_protected_floor {
            require!(v <= vault.protected_floor, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_top_up_threshold_bps {
            require!(v >= vault.top_up_threshold_bps, ShieldError::NotALoosening);
            require!(v as u64 <= BPS_DENOM, ShieldError::InvalidParameter);
            touched = true;
        }
        if let Some(v) = params.new_emergency_cap {
            require!(v >= vault.emergency_cap, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_velocity_threshold {
            require!(v >= vault.velocity_threshold, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_loss_trigger_usdc {
            require!(v >= vault.loss_trigger_usdc, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_loss_cooldown_secs {
            require!(v <= vault.loss_cooldown_secs && v >= 0, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_top_up_cooldown_secs {
            require!(v <= vault.top_up_cooldown_secs && v >= 0, ShieldError::NotALoosening);
            touched = true;
        }
        if let Some(v) = params.new_loosen_cooldown_secs {
            require!(v <= vault.loosen_cooldown_secs, ShieldError::NotALoosening);
            require!(v >= MIN_LOOSEN_COOLDOWN_SECS, ShieldError::InvalidParameter);
            touched = true;
        }
        if let Some(v) = params.new_full_exit_cooldown_secs {
            require!(v <= vault.full_exit_cooldown_secs, ShieldError::NotALoosening);
            require!(v >= MIN_FULL_EXIT_COOLDOWN_SECS, ShieldError::InvalidParameter);
            touched = true;
        }
        if params.new_risk_verifier.is_some() {
            // Replacing or removing the monitor is always treated as weakening.
            touched = true;
        }
        if params.register_owner.is_some() {
            require!(params.register_kind <= 1, ShieldError::InvalidParameter);
            touched = true;
        }
        require!(touched, ShieldError::NotALoosening);

        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;
        let execute_after = now.checked_add(vault.loosen_cooldown_secs).ok_or(ShieldError::MathOverflow)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::RuleChange;
        proposal.action = ProposalAction::Loosen(params);
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = execute_after;
        proposal.expiry = execute_after.checked_add(PROPOSAL_EXECUTION_GRACE_SECS).ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        emit!(LoosenProposed { vault: vault.key(), nonce, execute_after });
        Ok(())
    }

    /// Execute a matured rule change that does NOT register a destination.
    pub fn execute_rule_change(ctx: Context<ExecuteRuleChange>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::RuleChange, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;
        let params = match &proposal.action {
            ProposalAction::Loosen(p) => p.clone(),
            _ => return err!(ShieldError::NoPendingProposal),
        };
        require!(params.register_owner.is_none(), ShieldError::ProposalRequiresRegistrationPath);
        apply_loosen(vault, &params)?;
        emit!(LoosenExecuted { vault: vault.key(), nonce: proposal.nonce });
        Ok(())
    }

    /// Execute a matured rule change that registers a new destination.
    pub fn execute_rule_change_with_registration(
        ctx: Context<ExecuteRuleChangeWithRegistration>,
        owner: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::RuleChange, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;
        let params = match &proposal.action {
            ProposalAction::Loosen(p) => p.clone(),
            _ => return err!(ShieldError::NoPendingProposal),
        };
        let proposed_owner = params.register_owner.ok_or(ShieldError::ProposalHasNoRegistration)?;
        // The registry PDA is derived from the instruction's `owner`; it must
        // be exactly the owner locked into the proposal (no substitution).
        require_keys_eq!(proposed_owner, owner, ShieldError::VerdictWrongBinding);
        let kind = if params.register_kind == 1 { OwnerType::Cold } else { OwnerType::Execution };
        let vault_key = vault.key();
        apply_registration(
            &mut ctx.accounts.registry_entry,
            vault_key,
            owner,
            kind,
            params.register_label,
            now,
            ctx.bumps.registry_entry,
        )?;
        apply_loosen(vault, &params)?;
        emit!(LoosenExecuted { vault: vault.key(), nonce: proposal.nonce });
        Ok(())
    }

    /// Cancel a pending proposal in any category, any time before it
    /// executes. Refunds a gated top-up's velocity reservation.
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        let proposal = &ctx.accounts.proposal;
        if let ProposalAction::TopUp { amount, reserved_bucket_index, .. } = proposal.action.clone() {
            ctx.accounts.vault.refund_velocity_reservation(amount, reserved_bucket_index);
        }
        emit!(ProposalCancelled {
            vault: ctx.accounts.vault.key(),
            category: proposal.category as u8,
            nonce: proposal.nonce,
        });
        Ok(())
    }

    // ---------------------------------------------------------------
    // Top-ups — the hero mechanic
    // ---------------------------------------------------------------

    /// The instant path. Every gate is checked in the order the UI explains
    /// them: cooldown, floor, 24h limit, then the large-transfer threshold.
    pub fn instant_top_up(ctx: Context<TopUpTransfer>, amount: u64) -> Result<()> {
        require!(amount > 0, ShieldError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active && ctx.accounts.registry_entry.kind == OwnerType::Execution,
            ShieldError::DestinationNotExecution
        );
        require!(!ctx.accounts.vault.cooldown_active(now), ShieldError::CooldownActive);

        let balance = ctx.accounts.vault_token_account.amount;
        ctx.accounts.vault.check_floor(balance, amount)?;

        ctx.accounts.vault.roll_buckets(now)?;
        ctx.accounts.vault.check_velocity(amount)?;

        let threshold = ctx.accounts.vault.top_up_threshold_amount(balance)?;
        require!(amount < threshold, ShieldError::AmountRequiresGatedTopUp);

        ctx.accounts.vault.check_and_reserve_velocity(amount)?;

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        emit!(TopUpExecuted {
            vault: ctx.accounts.vault.key(),
            destination_owner: ctx.accounts.registry_entry.owner,
            amount,
            instant: true,
            nonce: 0,
            velocity_after: ctx.accounts.vault.velocity_sum(),
            balance_after: balance.saturating_sub(amount),
        });
        Ok(())
    }

    /// The gated path: reserve the 24h capacity now, transfer after the
    /// delay. If a cooldown is active, the proposal cannot mature before it
    /// ends — a cooldown is a hard wall, not a longer queue.
    pub fn propose_top_up(ctx: Context<ProposeTopUp>, destination_owner: Pubkey, amount: u64) -> Result<()> {
        require!(amount > 0, ShieldError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Execution
                && ctx.accounts.registry_entry.owner == destination_owner,
            ShieldError::DestinationNotExecution
        );

        let balance = ctx.accounts.vault_token_account.amount;
        vault.check_floor(balance, amount)?;
        vault.roll_buckets(now)?;
        vault.check_and_reserve_velocity(amount)?;
        let reserved_bucket_index = vault.current_bucket_index;

        let nonce = next_nonce(vault)?;
        let static_after = now.checked_add(vault.top_up_cooldown_secs).ok_or(ShieldError::MathOverflow)?;
        let execute_after = static_after.max(vault.cooldown_until);

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::TopUp;
        proposal.action = ProposalAction::TopUp { destination_owner, amount, reserved_bucket_index };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = execute_after;
        proposal.expiry = execute_after.checked_add(PROPOSAL_EXECUTION_GRACE_SECS).ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        emit!(TopUpProposed { vault: vault.key(), destination_owner, amount, nonce, execute_after });
        Ok(())
    }

    pub fn execute_top_up(ctx: Context<ExecuteTopUp>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::TopUp, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;
        // A cooldown armed AFTER the proposal was created still applies.
        require!(!vault.cooldown_active(now), ShieldError::CooldownActive);

        let (destination_owner, amount) = match &proposal.action {
            ProposalAction::TopUp { destination_owner, amount, .. } => (*destination_owner, *amount),
            _ => return err!(ShieldError::NoPendingProposal),
        };
        require!(
            ctx.accounts.registry_entry.owner == destination_owner
                && ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Execution,
            ShieldError::DestinationNotExecution
        );
        let balance = ctx.accounts.vault_token_account.amount;
        vault.check_floor(balance, amount)?;

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;

        emit!(TopUpExecuted {
            vault: vault.key(),
            destination_owner,
            amount,
            instant: false,
            nonce: proposal.nonce,
            velocity_after: vault.velocity_sum(),
            balance_after: balance.saturating_sub(amount),
        });
        Ok(())
    }

    /// The ONLY external transition, and it can only tighten. A monitor
    /// (the CRE confidential workflow's enclave key, or any verifier the user
    /// pins) attests a realized loss; the vault checks binding, freshness,
    /// replay, and that the loss meets the USER's own trigger, then arms a
    /// cooldown of the USER's own length. The monitor chooses neither the
    /// rule nor the duration, and it can never touch cold or exit paths.
    pub fn apply_risk_verdict(ctx: Context<ApplyRiskVerdict>, verdict: RiskVerdict) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.vault;

        require!(vault.risk_verifier != Pubkey::default(), ShieldError::NoRiskVerifier);
        require_keys_eq!(verdict.vault, vault.key(), ShieldError::VerdictWrongBinding);
        require_keys_eq!(verdict.program_id, crate::ID, ShieldError::VerdictWrongBinding);
        require!(now <= verdict.expiry, ShieldError::VerdictExpired);
        require!(
            verdict.issued_at <= now.checked_add(VERDICT_CLOCK_SKEW_SECS).ok_or(ShieldError::MathOverflow)?,
            ShieldError::VerdictNotYetValid
        );
        require!(verdict.nonce > vault.last_verdict_nonce, ShieldError::VerdictReplayed);
        require!(
            verdict.realized_loss_usdc >= vault.loss_trigger_usdc,
            ShieldError::VerdictBelowLossTrigger
        );

        let mut signed = verdict.clone();
        signed.signature = [0u8; 64];
        let message = signed.try_to_vec().map_err(|_| ShieldError::InvalidVerifier)?;
        verify_ed25519_ix(
            &ctx.accounts.instructions_sysvar,
            &vault.risk_verifier,
            &message,
            &verdict.signature,
        )?;

        vault.last_verdict_nonce = verdict.nonce;
        vault.last_verdict_reason = verdict.reason_code;
        vault.last_verdict_evidence = verdict.evidence_hash;

        let target = now.checked_add(vault.loss_cooldown_secs).ok_or(ShieldError::MathOverflow)?;
        let extended = target > vault.cooldown_until;
        if extended {
            vault.cooldown_until = target;
            vault.cooldown_reason = COOLDOWN_REASON_RISK_VERDICT;
            vault.cooldown_set_at = now;
        }

        emit!(RiskVerdictApplied {
            vault: vault.key(),
            nonce: verdict.nonce,
            reason_code: verdict.reason_code,
            realized_loss_usdc: verdict.realized_loss_usdc,
            cooldown_until: vault.cooldown_until,
            extended,
            evidence_hash: verdict.evidence_hash,
        });
        Ok(())
    }

    // ---------------------------------------------------------------
    // Cold transfers: capped instant vs. delayed full exit
    // ---------------------------------------------------------------

    /// Instant, always — including with every off-chain service dead — but
    /// only at or below the emergency cap, above the floor, and inside the
    /// same 24h accumulator as top-ups (so it can't be bled out in slices).
    pub fn instant_cold_transfer(ctx: Context<ColdTransfer>, amount: u64) -> Result<()> {
        require!(amount > 0, ShieldError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active && ctx.accounts.registry_entry.kind == OwnerType::Cold,
            ShieldError::DestinationNotCold
        );
        require!(amount <= ctx.accounts.vault.emergency_cap, ShieldError::AmountExceedsEmergencyCap);

        let now = Clock::get()?.unix_timestamp;
        let balance = ctx.accounts.vault_token_account.amount;
        ctx.accounts.vault.check_floor(balance, amount)?;
        ctx.accounts.vault.roll_buckets(now)?;
        ctx.accounts.vault.check_and_reserve_velocity(amount)?;

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;
        emit!(ColdTransferExecuted {
            vault: ctx.accounts.vault.key(),
            destination_owner: ctx.accounts.registry_entry.owner,
            amount,
            instant: true,
        });
        Ok(())
    }

    /// Above the cap, a cold transfer is a full-exit-category proposal:
    /// destination and amount locked now, executes after the exit delay.
    pub fn propose_cold_transfer_above_cap(
        ctx: Context<ProposeFullExit>,
        destination_owner: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ShieldError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Cold
                && ctx.accounts.registry_entry.owner == destination_owner,
            ShieldError::FullExitDestinationNotRegisteredCold
        );
        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;
        let execute_after = now.checked_add(vault.full_exit_cooldown_secs).ok_or(ShieldError::MathOverflow)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::FullExit;
        proposal.action = ProposalAction::ColdTransferAboveCap { destination_owner, amount };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = execute_after;
        proposal.expiry = execute_after.checked_add(PROPOSAL_EXECUTION_GRACE_SECS).ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        emit!(FullExitProposed {
            vault: vault.key(),
            destination_owner,
            nonce,
            execute_after,
            uninstall: false,
            amount,
        });
        Ok(())
    }

    /// Leave Shield entirely: the whole balance, to a registered cold
    /// address, after the full-exit delay. The longest wait in the system,
    /// on purpose — it's the one impulsive-you reaches for first.
    pub fn propose_uninstall_vault(ctx: Context<ProposeFullExit>, destination_owner: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.vault.authority,
            ShieldError::Unauthorized
        );
        require!(
            ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Cold
                && ctx.accounts.registry_entry.owner == destination_owner,
            ShieldError::FullExitDestinationNotRegisteredCold
        );
        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;
        let nonce = next_nonce(vault)?;
        let execute_after = now.checked_add(vault.full_exit_cooldown_secs).ok_or(ShieldError::MathOverflow)?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.vault = vault.key();
        proposal.category = ProposalCategory::FullExit;
        proposal.action = ProposalAction::UninstallVault { destination_owner };
        proposal.nonce = nonce;
        proposal.created_at = now;
        proposal.execute_after = execute_after;
        proposal.expiry = execute_after.checked_add(PROPOSAL_EXECUTION_GRACE_SECS).ok_or(ShieldError::MathOverflow)?;
        proposal.config_version_at_creation = vault.config_version;
        proposal.bump = ctx.bumps.proposal;

        emit!(FullExitProposed {
            vault: vault.key(),
            destination_owner,
            nonce,
            execute_after,
            uninstall: true,
            amount: 0,
        });
        Ok(())
    }

    pub fn execute_full_exit(ctx: Context<ExecuteFullExit>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require_keys_eq!(ctx.accounts.authority.key(), vault.authority, ShieldError::Unauthorized);
        let proposal = &ctx.accounts.proposal;
        require!(proposal.category == ProposalCategory::FullExit, ShieldError::NoPendingProposal);
        check_maturity_and_staleness(vault, proposal)?;

        let (destination_owner, amount) = match &proposal.action {
            ProposalAction::ColdTransferAboveCap { destination_owner, amount } => (*destination_owner, *amount),
            ProposalAction::UninstallVault { destination_owner } => {
                (*destination_owner, ctx.accounts.vault_token_account.amount)
            }
            _ => return err!(ShieldError::NoPendingProposal),
        };
        // What executes is exactly what was proposed: the destination was
        // locked at creation and must still be an active cold address, and
        // the token account handed in must belong to it (review finding:
        // the earlier draft never checked this).
        require!(
            ctx.accounts.registry_entry.owner == destination_owner
                && ctx.accounts.registry_entry.active
                && ctx.accounts.registry_entry.kind == OwnerType::Cold,
            ShieldError::FullExitDestinationNotRegisteredCold
        );
        require_keys_eq!(
            ctx.accounts.destination_token_account.owner,
            destination_owner,
            ShieldError::TokenAccountOwnerMismatch
        );
        require!(amount > 0, ShieldError::ZeroAmount);

        transfer_from_vault(
            &ctx.accounts.vault_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            amount,
        )?;
        emit!(FullExitExecuted { vault: vault.key(), destination_owner, amount });
        Ok(())
    }
}

// =====================================================================
// Shared helpers
// =====================================================================

fn next_nonce(vault: &mut Account<Vault>) -> Result<u64> {
    let n = vault.proposal_nonce_counter.checked_add(1).ok_or(ShieldError::MathOverflow)?;
    vault.proposal_nonce_counter = n;
    Ok(n)
}

fn check_maturity_and_staleness(vault: &Vault, proposal: &Proposal) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= proposal.execute_after, ShieldError::ProposalNotMatured);
    require!(now <= proposal.expiry, ShieldError::ProposalExpired);
    require!(
        proposal.config_version_at_creation == vault.config_version,
        ShieldError::ProposalStale
    );
    Ok(())
}

fn apply_loosen(vault: &mut Account<Vault>, p: &LoosenParams) -> Result<()> {
    if let Some(v) = p.new_protected_floor {
        vault.protected_floor = v;
    }
    if let Some(v) = p.new_top_up_threshold_bps {
        vault.top_up_threshold_bps = v;
    }
    if let Some(v) = p.new_emergency_cap {
        vault.emergency_cap = v;
    }
    if let Some(v) = p.new_velocity_threshold {
        vault.velocity_threshold = v;
    }
    if let Some(v) = p.new_loss_trigger_usdc {
        vault.loss_trigger_usdc = v;
    }
    if let Some(v) = p.new_loss_cooldown_secs {
        vault.loss_cooldown_secs = v;
    }
    if let Some(v) = p.new_top_up_cooldown_secs {
        vault.top_up_cooldown_secs = v;
    }
    if let Some(v) = p.new_loosen_cooldown_secs {
        vault.loosen_cooldown_secs = v;
    }
    if let Some(v) = p.new_full_exit_cooldown_secs {
        vault.full_exit_cooldown_secs = v;
    }
    if let Some(v) = p.new_risk_verifier {
        vault.risk_verifier = v;
    }
    Ok(())
}

fn apply_registration(
    entry: &mut Account<RegistryEntry>,
    vault: Pubkey,
    owner: Pubkey,
    kind: OwnerType,
    label: [u8; LABEL_LEN],
    now: i64,
    bump: u8,
) -> Result<()> {
    if entry.registered_at != 0 {
        // Exists: the type is permanent. Re-activation under the same type
        // is allowed; anything else is rejected.
        require!(entry.kind == kind, ShieldError::AlreadyRegisteredDifferentType);
        entry.active = true;
        entry.label = label;
    } else {
        entry.vault = vault;
        entry.owner = owner;
        entry.kind = kind;
        entry.active = true;
        entry.registered_at = now;
        entry.label = label;
        entry.bump = bump;
    }
    emit!(RegistrationChanged { vault, owner, kind: kind as u8, active: true, label });
    Ok(())
}

fn transfer_from_vault<'info>(
    vault_token_account: &Account<'info, TokenAccount>,
    destination_token_account: &Account<'info, TokenAccount>,
    vault: &Account<'info, Vault>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let authority_key = vault.authority;
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[Vault::SEED_PREFIX, authority_key.as_ref(), &[bump]];
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
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = source_token_account.mint == vault.usdc_mint @ ShieldError::WrongMint)]
    pub source_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct RegisterOwner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

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

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
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
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = authority,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::RuleChange as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct ExecuteRuleChangeWithRegistration<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = authority,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::RuleChange as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

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

    #[account(address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

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
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = authority,
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
pub struct ApplyRiskVerdict<'info> {
    /// Anyone may relay a valid verdict: it can only tighten.
    pub relayer: Signer<'info>,

    #[account(mut, seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    /// CHECK: address-pinned to the Instructions sysvar; contents are read
    /// by `verify_ed25519_ix`.
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
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [Vault::SEED_PREFIX, vault.authority.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut, address = vault.vault_token_account)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = authority,
        seeds = [Proposal::SEED_PREFIX, vault.key().as_ref(), &[ProposalCategory::FullExit as u8]],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(seeds = [RegistryEntry::SEED_PREFIX, vault.key().as_ref(), registry_entry.owner.as_ref()], bump = registry_entry.bump)]
    pub registry_entry: Account<'info, RegistryEntry>,

    #[account(mut, constraint = destination_token_account.mint == vault.usdc_mint @ ShieldError::WrongMint)]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
