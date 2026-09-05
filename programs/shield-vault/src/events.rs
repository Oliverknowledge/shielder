//! Anchor events ("Program data:" logs). These are what the Substreams
//! pipeline, the CRE Solana log trigger, and the app's activity feed all
//! decode — one event per state transition that matters to a user.

use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub protected_floor: u64,
    pub velocity_threshold: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct RegistrationChanged {
    pub vault: Pubkey,
    pub owner: Pubkey,
    /// 0 = Execution, 1 = Cold
    pub kind: u8,
    pub active: bool,
    pub label: [u8; 24],
}

#[event]
pub struct PolicyTightened {
    pub vault: Pubkey,
    pub config_version: u64,
    pub cooldown_until: i64,
    pub protected_floor: u64,
    pub velocity_threshold: u64,
    pub top_up_threshold_bps: u16,
    pub loss_trigger_usdc: u64,
    pub loss_cooldown_secs: i64,
}

#[event]
pub struct LoosenProposed {
    pub vault: Pubkey,
    pub nonce: u64,
    pub execute_after: i64,
}

#[event]
pub struct LoosenExecuted {
    pub vault: Pubkey,
    pub nonce: u64,
}

#[event]
pub struct ProposalCancelled {
    pub vault: Pubkey,
    pub category: u8,
    pub nonce: u64,
}

#[event]
pub struct TopUpExecuted {
    pub vault: Pubkey,
    pub destination_owner: Pubkey,
    pub amount: u64,
    pub instant: bool,
    pub nonce: u64,
    pub velocity_after: u64,
    pub balance_after: u64,
}

#[event]
pub struct TopUpProposed {
    pub vault: Pubkey,
    pub destination_owner: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub execute_after: i64,
}

#[event]
pub struct ColdTransferExecuted {
    pub vault: Pubkey,
    pub destination_owner: Pubkey,
    pub amount: u64,
    pub instant: bool,
}

#[event]
pub struct FullExitProposed {
    pub vault: Pubkey,
    pub destination_owner: Pubkey,
    pub nonce: u64,
    pub execute_after: i64,
    pub uninstall: bool,
    pub amount: u64,
}

#[event]
pub struct FullExitExecuted {
    pub vault: Pubkey,
    pub destination_owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RiskVerdictApplied {
    pub vault: Pubkey,
    pub nonce: u64,
    pub reason_code: u8,
    pub realized_loss_usdc: u64,
    pub cooldown_until: i64,
    pub extended: bool,
    pub evidence_hash: [u8; 32],
}
