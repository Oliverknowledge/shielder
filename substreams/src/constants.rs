//! Known program IDs this pipeline recognizes. Shield's own program ID
//! must be kept in sync with `programs/shield-vault/src/lib.rs`'s
//! `declare_id!` -- there is deliberately no shared crate between the two
//! (the Anchor program targets sbf-solana-solana, this targets
//! wasm32-unknown-unknown, and keeping them decoupled avoids forcing the
//! Substreams module to build against Solana's BPF toolchain at all).

pub const SHIELD_VAULT_PROGRAM_ID: &str = "4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx";

// Mainnet-beta program IDs for the venues the design doc names explicitly
// (Graph section: "Jupiter/Raydium/pump.fun swaps in the execution
// wallet"). Jupiter's aggregator has had multiple program versions over
// time; production deployment should track Jupiter's current v6 (or
// latest) router address, updated here as venues evolve -- this list is
// not meant to be exhaustive on day one, just real.
pub const JUPITER_V6_PROGRAM_ID: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
pub const RAYDIUM_AMM_V4_PROGRAM_ID: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
pub const RAYDIUM_CLMM_PROGRAM_ID: &str = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
pub const PUMPFUN_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/// Anchor's instruction discriminator scheme: first 8 bytes of
/// sha256("global:<snake_case_instruction_name>"). Computed here rather
/// than hand-copied, so this file stays correct if an instruction is ever
/// renamed in the Anchor program -- the exact same rule Anchor's own
/// `#[program]` macro uses to generate each instruction's discriminator.
pub fn sighash(instruction_name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let preimage = format!("global:{instruction_name}");
    let hash = Sha256::digest(preimage.as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash[..8]);
    out
}
