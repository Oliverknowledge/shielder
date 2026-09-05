use anchor_lang::prelude::*;

#[error_code]
pub enum ShieldError {
    #[msg("Only the vault authority may perform this action.")]
    Unauthorized,

    #[msg("Amount must be greater than zero.")]
    ZeroAmount,

    #[msg("Invalid parameter value.")]
    InvalidParameter,

    #[msg("This owner is already registered under a different, permanent type. Types are immutable and cannot be reused.")]
    AlreadyRegisteredDifferentType,

    #[msg("The vault is funded: adding a destination is a weakening change and must go through the delayed rule-change path.")]
    VaultFundedUseDelayedPath,

    #[msg("The destination owner is not an active registered execution wallet.")]
    DestinationNotExecution,

    #[msg("The destination owner is not an active registered cold address.")]
    DestinationNotCold,

    #[msg("This transfer exceeds the instant cold-transfer cap. Use the 7-day full-exit path instead.")]
    AmountExceedsEmergencyCap,

    #[msg("This transfer would exceed the vault's 24-hour top-up limit.")]
    VelocityThresholdExceeded,

    #[msg("A top-up cooldown is active. No top-up may execute until it ends.")]
    CooldownActive,

    #[msg("This transfer would take the vault below its protected floor.")]
    ProtectedFloorBreached,

    #[msg("This amount is at or above the instant threshold and must take the gated (delayed) top-up path.")]
    AmountRequiresGatedTopUp,

    #[msg("This proposal has not yet matured.")]
    ProposalNotMatured,

    #[msg("This proposal has expired. Cancel it and re-propose.")]
    ProposalExpired,

    #[msg("This proposal was created before a later tightening and is stale. Re-propose under the current configuration.")]
    ProposalStale,

    #[msg("There is no pending proposal of this kind.")]
    NoPendingProposal,

    #[msg("This proposal registers a destination; execute it with the registration-aware instruction.")]
    ProposalRequiresRegistrationPath,

    #[msg("This proposal does not register a destination; execute it with the plain rule-change instruction.")]
    ProposalHasNoRegistration,

    #[msg("No risk monitor is configured for this vault.")]
    NoRiskVerifier,

    #[msg("This verdict was not signed by the vault's pinned risk verifier.")]
    InvalidVerifier,

    #[msg("This verdict has expired.")]
    VerdictExpired,

    #[msg("This verdict's issue time is in the future.")]
    VerdictNotYetValid,

    #[msg("This verdict is bound to a different vault or program.")]
    VerdictWrongBinding,

    #[msg("This verdict nonce has already been used.")]
    VerdictReplayed,

    #[msg("The attested loss is below this vault's loss trigger; the verdict is rejected.")]
    VerdictBelowLossTrigger,

    #[msg("This change is not a tightening. Weakening changes must be proposed and wait.")]
    NotATightening,

    #[msg("This change is not a loosening. Tightening changes apply instantly via tighten.")]
    NotALoosening,

    #[msg("A self-pause cannot exceed the maximum pause length.")]
    PauseTooLong,

    #[msg("Arithmetic overflow.")]
    MathOverflow,

    #[msg("Wrong token mint for this vault.")]
    WrongMint,

    #[msg("The supplied token account is not owned by the registered owner pubkey.")]
    TokenAccountOwnerMismatch,

    #[msg("A cold address can never be registered for an owner that has any execution history.")]
    CannotDowngradeExecutionToCold,

    #[msg("The full-exit destination must be an active registered cold address.")]
    FullExitDestinationNotRegisteredCold,
}
