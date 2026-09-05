//! Shield behavioural-memory Substreams (Solana).
//!
//! Module graph (see substreams.yaml):
//!
//!   map_shield_instructions  Block -> ShieldInstructions   typed decode of every Shield ix
//!   map_shield_events        Block -> ShieldEvents         typed decode of every Shield event
//!   store_vault_registry     set    ata:<token acct> -> vault, exec:<vault>:<owner> -> 1|0
//!   store_vault_wallets      append wallets:<vault> -> owner;owner;...
//!   map_vault_flows          Block + events + registry -> VaultFlows (boundary crossings)
//!   store_flow_totals        add    running totals per vault / per execution wallet
//!   map_behavioral_profiles  deltas -> BehavioralProfiles (one per vault touched)
//!
//! Everything downstream of `map_vault_flows` is what the Shield monitor
//! and app reason over: "you sent $4,100 to this venue, $2,810 came back".

use substreams::errors::Error;
use substreams::prelude::*;
use substreams::store::{DeltaInt64, Deltas};
use substreams_solana::b58;
use substreams_solana::pb::sf::solana::r#type::v1::Block;

mod pb {
    pub mod shield {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/shield.v1.rs"));
        }
    }
}
use pb::shield::v1::*;

// ---------------------------------------------------------------------
// Program ids and discriminators
// ---------------------------------------------------------------------

/// Shield vault program (programs/shield-vault/src/lib.rs `declare_id!`).
const SHIELD_PROGRAM: [u8; 32] = b58!("4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx");
const SPL_TOKEN: [u8; 32] = b58!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// sha256("global:<ix>")[..8]
const IX_INITIALIZE_VAULT: [u8; 8] = [48, 191, 163, 44, 71, 129, 63, 164];
const IX_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
const IX_REGISTER_OWNER: [u8; 8] = [207, 189, 74, 108, 245, 244, 166, 237];
const IX_REMOVE_REGISTRATION: [u8; 8] = [65, 50, 199, 198, 14, 117, 85, 244];
const IX_TIGHTEN: [u8; 8] = [123, 119, 90, 10, 140, 44, 191, 123];
const IX_PROPOSE_LOOSEN: [u8; 8] = [5, 18, 203, 86, 196, 77, 242, 168];
const IX_EXECUTE_RULE_CHANGE: [u8; 8] = [84, 93, 44, 13, 64, 43, 176, 238];
const IX_EXECUTE_RULE_CHANGE_WITH_REGISTRATION: [u8; 8] = [64, 76, 77, 8, 244, 55, 250, 26];
const IX_CANCEL_PROPOSAL: [u8; 8] = [106, 74, 128, 146, 19, 65, 39, 23];
const IX_INSTANT_TOP_UP: [u8; 8] = [110, 190, 68, 110, 182, 148, 114, 48];
const IX_PROPOSE_TOP_UP: [u8; 8] = [36, 172, 145, 55, 169, 165, 135, 42];
const IX_EXECUTE_TOP_UP: [u8; 8] = [130, 69, 167, 45, 78, 226, 140, 255];
const IX_APPLY_RISK_VERDICT: [u8; 8] = [20, 69, 164, 148, 125, 21, 46, 246];
const IX_INSTANT_COLD_TRANSFER: [u8; 8] = [208, 245, 185, 111, 8, 243, 90, 149];
const IX_PROPOSE_COLD_TRANSFER_ABOVE_CAP: [u8; 8] = [127, 234, 81, 142, 216, 230, 90, 18];
const IX_PROPOSE_UNINSTALL_VAULT: [u8; 8] = [90, 173, 117, 110, 219, 76, 79, 245];
const IX_EXECUTE_FULL_EXIT: [u8; 8] = [65, 156, 184, 136, 155, 193, 149, 117];

// sha256("event:<Name>")[..8]
const EV_VAULT_INITIALIZED: [u8; 8] = [180, 43, 207, 2, 18, 71, 3, 75];
const EV_DEPOSITED: [u8; 8] = [111, 141, 26, 45, 161, 35, 100, 57];
const EV_REGISTRATION_CHANGED: [u8; 8] = [66, 51, 186, 101, 54, 160, 96, 196];
const EV_POLICY_TIGHTENED: [u8; 8] = [211, 162, 127, 107, 69, 41, 128, 211];
const EV_LOOSEN_PROPOSED: [u8; 8] = [191, 183, 243, 232, 161, 76, 111, 224];
const EV_LOOSEN_EXECUTED: [u8; 8] = [150, 175, 153, 116, 33, 30, 235, 58];
const EV_PROPOSAL_CANCELLED: [u8; 8] = [253, 59, 104, 46, 129, 78, 9, 14];
const EV_TOP_UP_EXECUTED: [u8; 8] = [140, 71, 155, 208, 41, 169, 155, 64];
const EV_TOP_UP_PROPOSED: [u8; 8] = [78, 142, 230, 208, 102, 4, 26, 167];
const EV_COLD_TRANSFER_EXECUTED: [u8; 8] = [39, 32, 26, 18, 97, 60, 41, 48];
const EV_FULL_EXIT_PROPOSED: [u8; 8] = [252, 68, 20, 29, 230, 32, 51, 132];
const EV_FULL_EXIT_EXECUTED: [u8; 8] = [31, 191, 220, 78, 201, 55, 52, 151];
const EV_RISK_VERDICT_APPLIED: [u8; 8] = [152, 194, 229, 211, 218, 25, 52, 100];

// SPL Token instruction tags
const SPL_TRANSFER: u8 = 3;
const SPL_TRANSFER_CHECKED: u8 = 12;

// ---------------------------------------------------------------------
// Little-endian Borsh cursor
// ---------------------------------------------------------------------

struct Cur<'a> {
    d: &'a [u8],
    o: usize,
}

impl<'a> Cur<'a> {
    fn new(d: &'a [u8]) -> Self {
        Self { d, o: 0 }
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.d.get(self.o..self.o + n)?;
        self.o += n;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn bool(&mut self) -> Option<bool> {
        Some(self.u8()? != 0)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn pubkey(&mut self) -> Option<String> {
        Some(bs58(self.take(32)?))
    }
    fn hex32(&mut self) -> Option<String> {
        Some(hex::encode(self.take(32)?))
    }
    fn label(&mut self) -> Option<String> {
        let raw = self.take(24)?;
        let end = raw.iter().rposition(|b| *b != 0).map(|i| i + 1).unwrap_or(0);
        Some(String::from_utf8_lossy(&raw[..end]).into_owned())
    }
    fn opt<T>(&mut self, f: impl FnOnce(&mut Self) -> Option<T>) -> Option<Option<T>> {
        match self.u8()? {
            0 => Some(None),
            _ => Some(Some(f(self)?)),
        }
    }
}

fn bs58(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits: Vec<u8> = vec![0];
    for &byte in bytes {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let mut out = String::new();
    for &b in bytes {
        if b == 0 {
            out.push('1');
        } else {
            break;
        }
    }
    for &d in digits.iter().rev() {
        out.push(ALPHABET[d as usize] as char);
    }
    out
}

fn block_time(block: &Block) -> i64 {
    block.block_time.as_ref().map(|t| t.timestamp).unwrap_or(0)
}

// ---------------------------------------------------------------------
// Stage 1a: instructions
// ---------------------------------------------------------------------

#[substreams::handlers::map]
fn map_shield_instructions(block: Block) -> Result<ShieldInstructions, Error> {
    let slot = block.slot;
    let ts = block_time(&block);
    let mut out = ShieldInstructions::default();

    for trx in block.transactions() {
        let sig = trx.id();
        for ix in trx.walk_instructions() {
            if ix.program_id() != SHIELD_PROGRAM {
                continue;
            }
            let data = ix.data();
            if data.len() < 8 {
                continue;
            }
            let accounts: Vec<String> = ix.accounts().iter().map(|a| a.to_string()).collect();
            let acct = |i: usize| accounts.get(i).cloned().unwrap_or_default();
            let mut c = Cur::new(&data[8..]);
            let disc: [u8; 8] = data[..8].try_into().unwrap();

            match disc {
                IX_INITIALIZE_VAULT => {
                    let (Some(risk_verifier), Some(protected_floor), Some(bps), Some(cap), Some(vel), Some(trig), Some(cd)) =
                        (c.pubkey(), c.u64(), c.u16(), c.u64(), c.u64(), c.u64(), c.i64())
                    else {
                        continue;
                    };
                    out.initialize_vaults.push(InitializeVault {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        usdc_mint: acct(2),
                        vault_token_account: acct(3),
                        risk_verifier,
                        protected_floor,
                        top_up_threshold_bps: bps as u32,
                        emergency_cap: cap,
                        velocity_threshold: vel,
                        loss_trigger_usdc: trig,
                        loss_cooldown_secs: cd,
                    });
                }
                IX_DEPOSIT => {
                    let Some(amount) = c.u64() else { continue };
                    out.deposits.push(Deposit {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        depositor: acct(0),
                        vault: acct(1),
                        vault_token_account: acct(2),
                        source_token_account: acct(3),
                        amount,
                    });
                }
                IX_REGISTER_OWNER => {
                    let (Some(owner), Some(kind), Some(label)) = (c.pubkey(), c.u8(), c.label()) else { continue };
                    out.register_owners.push(RegisterOwner {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        owner,
                        kind: kind as u32,
                        label,
                    });
                }
                IX_REMOVE_REGISTRATION => {
                    out.remove_registrations.push(RemoveRegistration {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        registry_entry: acct(2),
                    });
                }
                IX_TIGHTEN => {
                    let (
                        Some(f),
                        Some(bps),
                        Some(cap),
                        Some(vel),
                        Some(trig),
                        Some(lcd),
                        Some(tcd),
                        Some(loosen),
                        Some(exit),
                        Some(pause),
                        Some(verifier),
                    ) = (
                        c.opt(Cur::u64),
                        c.opt(Cur::u16),
                        c.opt(Cur::u64),
                        c.opt(Cur::u64),
                        c.opt(Cur::u64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::pubkey),
                    )
                    else {
                        continue;
                    };
                    out.tightens.push(Tighten {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        new_protected_floor: f,
                        new_top_up_threshold_bps: bps.map(|v| v as u32),
                        new_emergency_cap: cap,
                        new_velocity_threshold: vel,
                        new_loss_trigger_usdc: trig,
                        new_loss_cooldown_secs: lcd,
                        new_top_up_cooldown_secs: tcd,
                        new_loosen_cooldown_secs: loosen,
                        new_full_exit_cooldown_secs: exit,
                        pause_top_ups_until: pause,
                        set_risk_verifier: verifier,
                    });
                }
                IX_PROPOSE_LOOSEN => {
                    let (
                        Some(f),
                        Some(bps),
                        Some(cap),
                        Some(vel),
                        Some(trig),
                        Some(lcd),
                        Some(tcd),
                        Some(loosen),
                        Some(exit),
                        Some(verifier),
                        Some(owner),
                        Some(kind),
                        Some(label),
                    ) = (
                        c.opt(Cur::u64),
                        c.opt(Cur::u16),
                        c.opt(Cur::u64),
                        c.opt(Cur::u64),
                        c.opt(Cur::u64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::i64),
                        c.opt(Cur::pubkey),
                        c.opt(Cur::pubkey),
                        c.u8(),
                        c.label(),
                    )
                    else {
                        continue;
                    };
                    out.propose_loosens.push(ProposeLoosen {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(2),
                        new_protected_floor: f,
                        new_top_up_threshold_bps: bps.map(|v| v as u32),
                        new_emergency_cap: cap,
                        new_velocity_threshold: vel,
                        new_loss_trigger_usdc: trig,
                        new_loss_cooldown_secs: lcd,
                        new_top_up_cooldown_secs: tcd,
                        new_loosen_cooldown_secs: loosen,
                        new_full_exit_cooldown_secs: exit,
                        new_risk_verifier: verifier,
                        register_owner: owner,
                        register_kind: kind as u32,
                        register_label: label,
                    });
                }
                IX_EXECUTE_RULE_CHANGE => {
                    out.execute_rule_changes.push(ExecuteRuleChange {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(2),
                        registered_owner: None,
                    });
                }
                IX_EXECUTE_RULE_CHANGE_WITH_REGISTRATION => {
                    let Some(owner) = c.pubkey() else { continue };
                    out.execute_rule_changes.push(ExecuteRuleChange {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(2),
                        registered_owner: Some(owner),
                    });
                }
                IX_CANCEL_PROPOSAL => {
                    out.cancel_proposals.push(CancelProposal {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(2),
                    });
                }
                IX_INSTANT_TOP_UP => {
                    let Some(amount) = c.u64() else { continue };
                    out.instant_top_ups.push(InstantTopUp {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        vault_token_account: acct(2),
                        registry_entry: acct(3),
                        destination_token_account: acct(4),
                        amount,
                    });
                }
                IX_PROPOSE_TOP_UP => {
                    let (Some(destination_owner), Some(amount)) = (c.pubkey(), c.u64()) else { continue };
                    out.propose_top_ups.push(ProposeTopUp {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(4),
                        destination_owner,
                        amount,
                    });
                }
                IX_EXECUTE_TOP_UP => {
                    out.execute_top_ups.push(ExecuteTopUp {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(3),
                        registry_entry: acct(4),
                        destination_token_account: acct(5),
                    });
                }
                IX_APPLY_RISK_VERDICT => {
                    // RiskVerdict { vault, program_id, nonce, issued_at, expiry, reason_code, realized_loss, evidence_hash, signature }
                    let (Some(_vault), Some(_program), Some(nonce), Some(issued_at), Some(expiry), Some(reason), Some(loss), Some(evidence)) =
                        (c.pubkey(), c.pubkey(), c.u64(), c.i64(), c.i64(), c.u8(), c.u64(), c.hex32())
                    else {
                        continue;
                    };
                    out.apply_risk_verdicts.push(ApplyRiskVerdict {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        relayer: acct(0),
                        vault: acct(1),
                        nonce,
                        issued_at,
                        expiry,
                        reason_code: reason as u32,
                        realized_loss_usdc: loss,
                        evidence_hash: evidence,
                    });
                }
                IX_INSTANT_COLD_TRANSFER => {
                    let Some(amount) = c.u64() else { continue };
                    out.instant_cold_transfers.push(InstantColdTransfer {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        registry_entry: acct(3),
                        destination_token_account: acct(4),
                        amount,
                    });
                }
                IX_PROPOSE_COLD_TRANSFER_ABOVE_CAP => {
                    let (Some(destination_owner), Some(amount)) = (c.pubkey(), c.u64()) else { continue };
                    out.propose_cold_transfers_above_cap.push(ProposeColdTransferAboveCap {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(3),
                        destination_owner,
                        amount,
                    });
                }
                IX_PROPOSE_UNINSTALL_VAULT => {
                    let Some(destination_owner) = c.pubkey() else { continue };
                    out.propose_uninstall_vaults.push(ProposeUninstallVault {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(3),
                        destination_owner,
                    });
                }
                IX_EXECUTE_FULL_EXIT => {
                    out.execute_full_exits.push(ExecuteFullExit {
                        slot,
                        signature: sig.clone(),
                        block_time: ts,
                        authority: acct(0),
                        vault: acct(1),
                        proposal: acct(3),
                        registry_entry: acct(4),
                        destination_token_account: acct(5),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(out)
}

// ---------------------------------------------------------------------
// Stage 1b: events ("Program data: <base64>" emitted by the Shield program)
// ---------------------------------------------------------------------

#[substreams::handlers::map]
fn map_shield_events(block: Block) -> Result<ShieldEvents, Error> {
    use base64::Engine;
    let slot = block.slot;
    let ts = block_time(&block);
    let mut out = ShieldEvents::default();

    for trx in block.transactions() {
        // Only transactions that actually invoked Shield can carry its events.
        if !trx.walk_instructions().any(|ix| ix.program_id() == SHIELD_PROGRAM) {
            continue;
        }
        let sig = trx.id();
        let Some(meta) = trx.meta.as_ref() else { continue };
        for line in &meta.log_messages {
            let Some(b64) = line.strip_prefix("Program data: ") else { continue };
            let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else { continue };
            if bytes.len() < 8 {
                continue;
            }
            let disc: [u8; 8] = bytes[..8].try_into().unwrap();
            let mut c = Cur::new(&bytes[8..]);
            match disc {
                EV_VAULT_INITIALIZED => {
                    if let (Some(vault), Some(authority), Some(usdc_mint), Some(floor), Some(vel)) =
                        (c.pubkey(), c.pubkey(), c.pubkey(), c.u64(), c.u64())
                    {
                        out.vault_initialized.push(VaultInitializedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            authority,
                            usdc_mint,
                            protected_floor: floor,
                            velocity_threshold: vel,
                        });
                    }
                }
                EV_DEPOSITED => {
                    if let (Some(vault), Some(depositor), Some(amount), Some(new_balance)) = (c.pubkey(), c.pubkey(), c.u64(), c.u64()) {
                        out.deposited.push(DepositedEvent { slot, signature: sig.clone(), block_time: ts, vault, depositor, amount, new_balance });
                    }
                }
                EV_REGISTRATION_CHANGED => {
                    if let (Some(vault), Some(owner), Some(kind), Some(active), Some(label)) = (c.pubkey(), c.pubkey(), c.u8(), c.bool(), c.label()) {
                        out.registration_changed.push(RegistrationChangedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            owner,
                            kind: kind as u32,
                            active,
                            label,
                        });
                    }
                }
                EV_POLICY_TIGHTENED => {
                    if let (Some(vault), Some(cv), Some(cd), Some(floor), Some(vel), Some(bps), Some(trig), Some(lcd)) =
                        (c.pubkey(), c.u64(), c.i64(), c.u64(), c.u64(), c.u16(), c.u64(), c.i64())
                    {
                        out.policy_tightened.push(PolicyTightenedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            config_version: cv,
                            cooldown_until: cd,
                            protected_floor: floor,
                            velocity_threshold: vel,
                            top_up_threshold_bps: bps as u32,
                            loss_trigger_usdc: trig,
                            loss_cooldown_secs: lcd,
                        });
                    }
                }
                EV_LOOSEN_PROPOSED => {
                    if let (Some(vault), Some(nonce), Some(execute_after)) = (c.pubkey(), c.u64(), c.i64()) {
                        out.loosen_proposed.push(LoosenProposedEvent { slot, signature: sig.clone(), block_time: ts, vault, nonce, execute_after });
                    }
                }
                EV_LOOSEN_EXECUTED => {
                    if let (Some(vault), Some(nonce)) = (c.pubkey(), c.u64()) {
                        out.loosen_executed.push(LoosenExecutedEvent { slot, signature: sig.clone(), block_time: ts, vault, nonce });
                    }
                }
                EV_PROPOSAL_CANCELLED => {
                    if let (Some(vault), Some(category), Some(nonce)) = (c.pubkey(), c.u8(), c.u64()) {
                        out.proposal_cancelled.push(ProposalCancelledEvent { slot, signature: sig.clone(), block_time: ts, vault, category: category as u32, nonce });
                    }
                }
                EV_TOP_UP_EXECUTED => {
                    if let (Some(vault), Some(dest), Some(amount), Some(instant), Some(nonce), Some(vel), Some(bal)) =
                        (c.pubkey(), c.pubkey(), c.u64(), c.bool(), c.u64(), c.u64(), c.u64())
                    {
                        out.top_up_executed.push(TopUpExecutedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            destination_owner: dest,
                            amount,
                            instant,
                            nonce,
                            velocity_after: vel,
                            balance_after: bal,
                        });
                    }
                }
                EV_TOP_UP_PROPOSED => {
                    if let (Some(vault), Some(dest), Some(amount), Some(nonce), Some(after)) = (c.pubkey(), c.pubkey(), c.u64(), c.u64(), c.i64()) {
                        out.top_up_proposed.push(TopUpProposedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            destination_owner: dest,
                            amount,
                            nonce,
                            execute_after: after,
                        });
                    }
                }
                EV_COLD_TRANSFER_EXECUTED => {
                    if let (Some(vault), Some(dest), Some(amount), Some(instant)) = (c.pubkey(), c.pubkey(), c.u64(), c.bool()) {
                        out.cold_transfer_executed.push(ColdTransferExecutedEvent { slot, signature: sig.clone(), block_time: ts, vault, destination_owner: dest, amount, instant });
                    }
                }
                EV_FULL_EXIT_PROPOSED => {
                    if let (Some(vault), Some(dest), Some(nonce), Some(after), Some(uninstall), Some(amount)) =
                        (c.pubkey(), c.pubkey(), c.u64(), c.i64(), c.bool(), c.u64())
                    {
                        out.full_exit_proposed.push(FullExitProposedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            destination_owner: dest,
                            nonce,
                            execute_after: after,
                            uninstall,
                            amount,
                        });
                    }
                }
                EV_FULL_EXIT_EXECUTED => {
                    if let (Some(vault), Some(dest), Some(amount)) = (c.pubkey(), c.pubkey(), c.u64()) {
                        out.full_exit_executed.push(FullExitExecutedEvent { slot, signature: sig.clone(), block_time: ts, vault, destination_owner: dest, amount });
                    }
                }
                EV_RISK_VERDICT_APPLIED => {
                    if let (Some(vault), Some(nonce), Some(reason), Some(loss), Some(until), Some(extended), Some(evidence)) =
                        (c.pubkey(), c.u64(), c.u8(), c.u64(), c.i64(), c.bool(), c.hex32())
                    {
                        out.risk_verdict_applied.push(RiskVerdictAppliedEvent {
                            slot,
                            signature: sig.clone(),
                            block_time: ts,
                            vault,
                            nonce,
                            reason_code: reason as u32,
                            realized_loss_usdc: loss,
                            cooldown_until: until,
                            extended,
                            evidence_hash: evidence,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    Ok(out)
}

// ---------------------------------------------------------------------
// Stage 2: registry stores
// ---------------------------------------------------------------------

/// `ata:<vault token account>` -> vault; `exec:<vault>:<owner>` -> "1" | "0".
#[substreams::handlers::store]
fn store_vault_registry(ixs: ShieldInstructions, events: ShieldEvents, store: StoreSetString) {
    for v in &ixs.initialize_vaults {
        store.set(0, format!("ata:{}", v.vault_token_account), &v.vault);
    }
    for r in &events.registration_changed {
        if r.kind == 0 {
            store.set(0, format!("exec:{}:{}", r.vault, r.owner), &(if r.active { "1" } else { "0" }).to_string());
        } else {
            store.set(0, format!("cold:{}:{}", r.vault, r.owner), &(if r.active { "1" } else { "0" }).to_string());
        }
    }
}

/// `wallets:<vault>` -> "owner;owner;..." (execution wallets ever registered).
#[substreams::handlers::store]
fn store_vault_wallets(events: ShieldEvents, store: StoreAppend<String>) {
    for r in &events.registration_changed {
        if r.kind == 0 && r.active {
            store.append(0, format!("wallets:{}", r.vault), r.owner.clone());
        }
    }
}

// ---------------------------------------------------------------------
// Stage 3: capital flows across the vault boundary
// ---------------------------------------------------------------------

#[substreams::handlers::map]
fn map_vault_flows(block: Block, events: ShieldEvents, registry: StoreGetString) -> Result<VaultFlows, Error> {
    let slot = block.slot;
    let ts = block_time(&block);
    let mut flows = Vec::new();

    let is_exec = |vault: &str, owner: &str| registry.get_last(format!("exec:{vault}:{owner}")).as_deref() == Some("1");

    // Outflows: authoritative from Shield's own events.
    for e in &events.top_up_executed {
        flows.push(VaultFlow {
            slot,
            signature: e.signature.clone(),
            block_time: ts,
            vault: e.vault.clone(),
            kind: if e.instant { FlowKind::TopUpInstant as i32 } else { FlowKind::TopUpGated as i32 },
            outbound: true,
            counterparty: e.destination_owner.clone(),
            amount: e.amount,
            counterparty_is_execution: true,
        });
    }
    for e in &events.cold_transfer_executed {
        flows.push(VaultFlow {
            slot,
            signature: e.signature.clone(),
            block_time: ts,
            vault: e.vault.clone(),
            kind: FlowKind::ColdTransfer as i32,
            outbound: true,
            counterparty: e.destination_owner.clone(),
            amount: e.amount,
            counterparty_is_execution: false,
        });
    }
    for e in &events.full_exit_executed {
        flows.push(VaultFlow {
            slot,
            signature: e.signature.clone(),
            block_time: ts,
            vault: e.vault.clone(),
            kind: FlowKind::FullExit as i32,
            outbound: true,
            counterparty: e.destination_owner.clone(),
            amount: e.amount,
            counterparty_is_execution: false,
        });
    }

    // Inflows: any SPL Token transfer whose destination is a known vault
    // token account. A trading venue sending money back never calls
    // Shield's `deposit`, so this is the only way to see returns. The
    // transfer's authority is the counterparty owner (delegated transfers
    // are attributed to the delegate, an accepted approximation).
    for trx in block.transactions() {
        let sig = trx.id();
        for ix in trx.walk_instructions() {
            if ix.program_id() != SPL_TOKEN {
                continue;
            }
            let data = ix.data();
            if data.is_empty() {
                continue;
            }
            let accounts: Vec<String> = ix.accounts().iter().map(|a| a.to_string()).collect();
            let (dest_idx, auth_idx, amount) = match data[0] {
                SPL_TRANSFER if data.len() >= 9 => (1usize, 2usize, u64::from_le_bytes(data[1..9].try_into().unwrap())),
                SPL_TRANSFER_CHECKED if data.len() >= 9 => (2usize, 3usize, u64::from_le_bytes(data[1..9].try_into().unwrap())),
                _ => continue,
            };
            let (Some(dest), Some(authority)) = (accounts.get(dest_idx), accounts.get(auth_idx)) else { continue };
            let Some(vault) = registry.get_last(format!("ata:{dest}")) else { continue };
            let from_exec = is_exec(&vault, authority);
            flows.push(VaultFlow {
                slot,
                signature: sig.clone(),
                block_time: ts,
                vault,
                kind: if from_exec { FlowKind::Return as i32 } else { FlowKind::Deposit as i32 },
                outbound: false,
                counterparty: authority.clone(),
                amount,
                counterparty_is_execution: from_exec,
            });
        }
    }

    Ok(VaultFlows { flows })
}

// ---------------------------------------------------------------------
// Stage 4: running totals
// ---------------------------------------------------------------------

#[substreams::handlers::store]
fn store_flow_totals(flows: VaultFlows, store: StoreAddInt64) {
    for f in &flows.flows {
        let amount = f.amount as i64;
        match FlowKind::try_from(f.kind).unwrap_or(FlowKind::Unspecified) {
            FlowKind::TopUpInstant | FlowKind::TopUpGated => {
                store.add(0, format!("sent:{}:{}", f.vault, f.counterparty), amount);
                store.add(0, format!("sent_count:{}:{}", f.vault, f.counterparty), 1);
                store.add(0, format!("sent:{}", f.vault), amount);
            }
            FlowKind::Return => {
                store.add(0, format!("returned:{}:{}", f.vault, f.counterparty), amount);
                store.add(0, format!("returned_count:{}:{}", f.vault, f.counterparty), 1);
                store.add(0, format!("returned:{}", f.vault), amount);
            }
            FlowKind::Deposit => store.add(0, format!("deposited:{}", f.vault), amount),
            FlowKind::ColdTransfer | FlowKind::FullExit => store.add(0, format!("exited:{}", f.vault), amount),
            FlowKind::Unspecified => {}
        }
        store.add(0, format!("last_slot:{}", f.vault), 0); // touch the vault key so deltas name it
    }
}

// ---------------------------------------------------------------------
// Stage 5: per-vault behavioural profile snapshots
// ---------------------------------------------------------------------

#[substreams::handlers::map]
fn map_behavioral_profiles(
    block: Block,
    deltas: Deltas<DeltaInt64>,
    totals: StoreGetInt64,
    wallets: StoreGetString,
) -> Result<BehavioralProfiles, Error> {
    let mut touched: Vec<String> = Vec::new();
    for d in deltas.deltas.iter() {
        // keys: "<metric>:<vault>[:<owner>]"
        let mut parts = d.key.splitn(3, ':');
        let _metric = parts.next();
        if let Some(vault) = parts.next() {
            if !touched.iter().any(|v| v == vault) {
                touched.push(vault.to_string());
            }
        }
    }

    let get = |k: String| totals.get_last(k).unwrap_or(0).max(0) as u64;
    let mut profiles = Vec::new();
    for vault in touched {
        let list = wallets.get_last(format!("wallets:{vault}")).unwrap_or_default();
        let mut owners: Vec<String> = list.split(';').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        owners.sort();
        owners.dedup();
        let execution_wallets = owners
            .iter()
            .map(|owner| {
                let sent = get(format!("sent:{vault}:{owner}"));
                let returned = get(format!("returned:{vault}:{owner}"));
                ExecutionWalletTotals {
                    owner: owner.clone(),
                    sent,
                    returned,
                    net_realized_flow: returned as i64 - sent as i64,
                    top_up_count: get(format!("sent_count:{vault}:{owner}")),
                    return_count: get(format!("returned_count:{vault}:{owner}")),
                }
            })
            .collect();
        let sent = get(format!("sent:{vault}"));
        let returned = get(format!("returned:{vault}"));
        profiles.push(BehavioralProfile {
            vault: vault.clone(),
            total_sent_to_execution: sent,
            total_returned_from_execution: returned,
            net_realized_flow: returned as i64 - sent as i64,
            total_deposited: get(format!("deposited:{vault}")),
            total_exited: get(format!("exited:{vault}")),
            execution_wallets,
            last_updated_slot: block.slot,
            last_updated_at: block_time(&block),
        });
    }
    Ok(BehavioralProfiles { profiles })
}
