//! Verifies that the current transaction contains a preceding native
//! Ed25519Program instruction attesting to (pubkey, message, signature).
//!
//! This is the standard "instruction introspection" pattern for verifying
//! offchain-signed data on Solana (used by Wormhole, Pyth, and others): the
//! actual signature check runs in the native Ed25519 precompile, and this
//! program confirms, via the Instructions sysvar, that such a check ran
//! immediately before this instruction and covered exactly the bytes we
//! expect.
//!
//! The precompile's data layout is: a 2-byte header (`num_signatures`,
//! padding), then one 14-byte offsets struct per signature, then the
//! pubkey / signature / message bytes at the offsets the struct names.
//! We parse the offsets rather than assume where the SDKs put things
//! (web3.js and solana-sdk both emit pubkey, then signature, then message;
//! an earlier draft of this file assumed the opposite order and would have
//! rejected every valid verdict).

use crate::errors::ShieldError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID,
};

const ED25519_PROGRAM_ID: Pubkey = anchor_lang::solana_program::ed25519_program::ID;

const HEADER_SIZE: usize = 2;
const OFFSETS_SIZE: usize = 14;
const SIGNATURE_SIZE: usize = 64;
const PUBKEY_SIZE: usize = 32;
/// In the offsets struct, this index means "the bytes live in this same
/// instruction's data" (as opposed to another instruction in the tx).
const SELF_INSTRUCTION: u16 = u16::MAX;

fn u16_at(data: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([data[at], data[at + 1]])
}

pub fn verify_ed25519_ix<'info>(
    instructions_sysvar: &AccountInfo<'info>,
    expected_pubkey: &Pubkey,
    expected_message: &[u8],
    expected_signature: &[u8; 64],
) -> Result<()> {
    require_keys_eq!(*instructions_sysvar.key, INSTRUCTIONS_SYSVAR_ID, ShieldError::InvalidVerifier);

    let current_index = load_current_index_checked(instructions_sysvar)?;
    require!(current_index > 0, ShieldError::InvalidVerifier);
    let ix = load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;
    require_keys_eq!(ix.program_id, ED25519_PROGRAM_ID, ShieldError::InvalidVerifier);
    require!(ix.accounts.is_empty(), ShieldError::InvalidVerifier);

    let data = &ix.data;
    require!(data.len() >= HEADER_SIZE + OFFSETS_SIZE, ShieldError::InvalidVerifier);
    require!(data[0] == 1, ShieldError::InvalidVerifier); // exactly one signature

    let o = HEADER_SIZE;
    let sig_off = u16_at(data, o) as usize;
    let sig_ix = u16_at(data, o + 2);
    let pk_off = u16_at(data, o + 4) as usize;
    let pk_ix = u16_at(data, o + 6);
    let msg_off = u16_at(data, o + 8) as usize;
    let msg_size = u16_at(data, o + 10) as usize;
    let msg_ix = u16_at(data, o + 12);

    // Every component must come from this instruction's own data; otherwise
    // an attacker could point the precompile at bytes we never inspect.
    require!(
        sig_ix == SELF_INSTRUCTION && pk_ix == SELF_INSTRUCTION && msg_ix == SELF_INSTRUCTION,
        ShieldError::InvalidVerifier
    );
    require!(
        data.len() >= sig_off + SIGNATURE_SIZE
            && data.len() >= pk_off + PUBKEY_SIZE
            && data.len() >= msg_off + msg_size,
        ShieldError::InvalidVerifier
    );

    require!(&data[sig_off..sig_off + SIGNATURE_SIZE] == expected_signature.as_slice(), ShieldError::InvalidVerifier);
    require!(&data[pk_off..pk_off + PUBKEY_SIZE] == expected_pubkey.as_ref(), ShieldError::InvalidVerifier);
    require!(msg_size == expected_message.len(), ShieldError::InvalidVerifier);
    require!(&data[msg_off..msg_off + msg_size] == expected_message, ShieldError::InvalidVerifier);

    Ok(())
}
