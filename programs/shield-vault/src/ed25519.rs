//! Verifies that the current transaction contains a preceding native
//! Ed25519Program instruction attesting to (pubkey, message, signature).
//!
//! This is the standard "instruction introspection" pattern for verifying
//! offchain-signed data on Solana (used by Wormhole, Pyth, and others): the
//! actual signature check runs in the native Ed25519 sysvar program, and our
//! program just confirms, via the Instructions sysvar, that such a check
//! ran immediately before this instruction and covered exactly the bytes we
//! expect. This is what Open Question #2 in the design doc calls "a custom
//! Ed25519 check" as an alternative to a relayer.

use crate::errors::ShieldError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
};

const ED25519_PROGRAM_ID: Pubkey = anchor_lang::solana_program::ed25519_program::ID;

// Layout of a single-signature Ed25519Program instruction's data, per
// solana-sdk's `Ed25519Program::new_instruction`. Header is 2 bytes
// (num_signatures, padding) followed by one 14-byte offsets struct, then
// the signature (64 bytes), the pubkey (32 bytes), and the message.
const HEADER_SIZE: usize = 2;
const SIGNATURE_OFFSETS_SIZE: usize = 14;
const SIGNATURE_SIZE: usize = 64;
const PUBKEY_SIZE: usize = 32;

pub fn verify_ed25519_ix<'info>(
    instructions_sysvar: &AccountInfo<'info>,
    expected_pubkey: &Pubkey,
    expected_message: &[u8],
    expected_signature: &[u8; 64],
) -> Result<()> {
    require_keys_eq!(
        *instructions_sysvar.key,
        INSTRUCTIONS_SYSVAR_ID,
        ShieldError::InvalidVerifier
    );

    // By convention the caller places the Ed25519Program verification
    // instruction immediately before this instruction in the same
    // transaction (index = current_index - 1).
    let current_index =
        anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            instructions_sysvar,
        )?;
    require!(current_index > 0, ShieldError::InvalidVerifier);

    let ix = load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;

    require_keys_eq!(ix.program_id, ED25519_PROGRAM_ID, ShieldError::InvalidVerifier);

    let data = &ix.data;
    require!(
        data.len() >= HEADER_SIZE + SIGNATURE_OFFSETS_SIZE + SIGNATURE_SIZE + PUBKEY_SIZE,
        ShieldError::InvalidVerifier
    );

    let sig_start = HEADER_SIZE + SIGNATURE_OFFSETS_SIZE;
    let sig_end = sig_start + SIGNATURE_SIZE;
    let pubkey_start = sig_end;
    let pubkey_end = pubkey_start + PUBKEY_SIZE;
    let message_start = pubkey_end;

    require!(
        &data[sig_start..sig_end] == expected_signature.as_slice(),
        ShieldError::InvalidVerifier
    );
    require!(
        &data[pubkey_start..pubkey_end] == expected_pubkey.as_ref(),
        ShieldError::InvalidVerifier
    );
    require!(
        &data[message_start..] == expected_message,
        ShieldError::InvalidVerifier
    );

    Ok(())
}
