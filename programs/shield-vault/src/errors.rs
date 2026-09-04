use anchor_lang::prelude::*;

#[error_code]
pub enum ShieldError {
    #[msg("Only the vault authority may perform this action.")]
    Unauthorized,

    #[msg("This owner pubkey is not registered with Shield.")]
    NotRegistered,

    #[msg("This owner is already registered under a different, permanent type. Types are immutable and cannot be reused.")]
    AlreadyRegisteredDifferentType,

    #[msg("The destination owner is not registered as an execution venue.")]
    DestinationNotExecution,

    #[msg("The destination owner is not registered as a cold/safe address.")]
    DestinationNotCold,

    #[msg("This transfer exceeds the fixed emergency-cap for instant cold transfers. Use propose_cold_transfer_above_cap instead (routes through the 7-day full-exit path).")]
    AmountExceedsEmergencyCap,

    #[msg("This transfer would exceed the vault-global 24h rolling velocity threshold. It must go through the delayed top-up path instead of executing instantly.")]
    VelocityThresholdExceeded,

    #[msg("A behavioral cooldown is currently armed: every transfer to an execution-tagged owner must go through the delayed top-up path while it is active.")]
    BehavioralCooldownActive,

    #[msg("This proposal has not yet matured (execute_after has not passed).")]
    ProposalNotMatured,

    #[msg("This proposal has expired. Cancel it and re-propose.")]
    ProposalExpired,

    #[msg("This proposal was created under a configuration version that has since been tightened. It is stale and must be re-proposed under the current configuration.")]
    ProposalStale,

    #[msg("There is no pending proposal in this category.")]
    NoPendingProposal,

    #[msg("There is already a pending proposal in this category. Cancel it first, or wait for it to mature/expire.")]
    ProposalAlreadyPending,

    #[msg("This CRE verdict was not signed by the vault's pinned verifier identity.")]
    InvalidVerifier,

    #[msg("This CRE verdict has expired.")]
    VerdictExpired,

    #[msg("This CRE verdict is bound to a different proposal, vault, or program and cannot be applied here.")]
    VerdictWrongBinding,

    #[msg("A CRE verdict may only extend a cooldown, never shorten it.")]
    VerdictMayOnlyExtend,

    #[msg("This configuration change is not a tightening action. Use propose_loosen (delayed) instead.")]
    NotATightening,

    #[msg("This configuration change is not a loosening action. Use tighten (instant) instead.")]
    NotALoosening,

    #[msg("Arithmetic overflow.")]
    MathOverflow,

    #[msg("Wrong token mint for this vault.")]
    WrongMint,

    #[msg("Wrong SPL token program for this vault.")]
    WrongTokenProgram,

    #[msg("The supplied token account is not owned by the registered owner pubkey.")]
    TokenAccountOwnerMismatch,

    #[msg("A cold address can never be registered for an owner that has any execution history.")]
    CannotDowngradeExecutionToCold,

    #[msg("The full-exit destination must already be a registered cold address.")]
    FullExitDestinationNotRegisteredCold,
}
