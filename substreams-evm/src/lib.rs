//! Shield behavioural-memory Substreams (EVM: HyperEVM, Anvil, any EVM).
//!
//! Module graph (see substreams.yaml):
//!
//!   map_shield_events        Block ⨯ index_events(params) -> ShieldEvents   typed decode of ShieldVault.sol events
//!   store_vault_registry     set    exec:<vault>:<owner> -> 1|0
//!   map_vault_flows          Block ⨯ events ⨯ registry -> VaultFlows      boundary crossings incl. USDC returns
//!   store_flow_totals        add    running totals per vault
//!   map_behavioral_profiles  deltas -> BehavioralProfiles
//!
//! The Solana package (../substreams) has the same shape; the app and the
//! Chainlink CRE workflow consume `map_vault_flows` from either.

use std::collections::HashMap;
use substreams::errors::Error;
use substreams::prelude::*;
use substreams::store::{DeltaInt64, Deltas, StoreGet, StoreGetString, StoreSetString};
use substreams::Hex;
use substreams_ethereum::pb::eth::v2::Block;
use substreams_ethereum::Event;

mod pb {
    pub mod shield {
        pub mod evm {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/shield.evm.v1.rs"));
            }
        }
    }
}
#[allow(dead_code, clippy::all)]
mod abi_shield_vault;
use abi_shield_vault::events as ev;
use pb::shield::evm::v1::*;

const TRANSFER_TOPIC: [u8; 32] = hex_literal(b"ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");

const fn hex_literal(s: &[u8; 64]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (nib(s[i * 2]) << 4) | nib(s[i * 2 + 1]);
        i += 1;
    }
    out
}
const fn nib(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    }
}

fn addr(a: &[u8]) -> String {
    format!("0x{}", Hex(a))
}

fn parse_addrs(params: &str) -> Vec<Vec<u8>> {
    params
        .split("||")
        .filter_map(|p| p.trim().strip_prefix("evt_addr:"))
        .filter_map(|h| hex::decode(h.trim().trim_start_matches("0x")).ok())
        .collect()
}

fn u64_of(v: substreams::scalar::BigInt) -> u64 {
    v.to_u64()
}

#[substreams::handlers::map]
fn map_shield_events(params: String, block: Block) -> Result<ShieldEvents, Error> {
    let vault_addrs = parse_addrs(&params);
    let block_time = block.timestamp_seconds();
    let mut events = Vec::new();
    for log in block.logs() {
        if !vault_addrs.iter().any(|a| a == &log.address()) {
            continue;
        }
        let base = |name: &str, vault: &[u8], fields: HashMap<String, String>| ShieldEvent {
            block: block.number,
            block_time,
            tx_hash: addr(&log.receipt.transaction.hash),
            log_index: log.index(),
            vault: addr(vault),
            name: name.to_string(),
            fields,
        };
        let f = |pairs: &[(&str, String)]| pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect::<HashMap<_, _>>();
        if let Some(e) = ev::VaultInitialized::match_and_decode(log) {
            events.push(base("VaultInitialized", &e.vault, f(&[("authority", addr(&e.authority)), ("protectedFloor", e.protected_floor.to_string()), ("velocityThreshold", e.velocity_threshold.to_string())])));
        } else if let Some(e) = ev::Deposited::match_and_decode(log) {
            events.push(base("Deposited", &e.vault, f(&[("depositor", addr(&e.depositor)), ("amount", e.amount.to_string()), ("newBalance", e.new_balance.to_string())])));
        } else if let Some(e) = ev::RegistrationChanged::match_and_decode(log) {
            events.push(base("RegistrationChanged", &e.vault, f(&[("owner", addr(&e.owner)), ("kind", e.kind.to_string()), ("route", e.route.to_string()), ("active", e.active.to_string()), ("label", String::from_utf8_lossy(&e.label).trim_end_matches('\0').to_string())])));
        } else if let Some(e) = ev::PolicyTightened::match_and_decode(log) {
            events.push(base("PolicyTightened", &e.vault, f(&[("configVersion", e.config_version.to_string()), ("cooldownUntil", e.cooldown_until.to_string()), ("protectedFloor", e.protected_floor.to_string()), ("velocityThreshold", e.velocity_threshold.to_string()), ("topUpThresholdBps", e.top_up_threshold_bps.to_string()), ("lossTriggerUsdc", e.loss_trigger_usdc.to_string()), ("lossCooldownSecs", e.loss_cooldown_secs.to_string())])));
        } else if let Some(e) = ev::LoosenProposed::match_and_decode(log) {
            events.push(base("LoosenProposed", &e.vault, f(&[("nonce", e.nonce.to_string()), ("executeAfter", e.execute_after.to_string())])));
        } else if let Some(e) = ev::LoosenExecuted::match_and_decode(log) {
            events.push(base("LoosenExecuted", &e.vault, f(&[("nonce", e.nonce.to_string())])));
        } else if let Some(e) = ev::ProposalCancelled::match_and_decode(log) {
            events.push(base("ProposalCancelled", &e.vault, f(&[("category", e.category.to_string()), ("nonce", e.nonce.to_string())])));
        } else if let Some(e) = ev::TopUpExecuted::match_and_decode(log) {
            events.push(base("TopUpExecuted", &e.vault, f(&[("destinationOwner", addr(&e.destination_owner)), ("amount", e.amount.to_string()), ("instant", e.instant.to_string()), ("nonce", e.nonce.to_string()), ("velocityAfter", e.velocity_after.to_string()), ("balanceAfter", e.balance_after.to_string()), ("route", e.route.to_string())])));
        } else if let Some(e) = ev::TopUpProposed::match_and_decode(log) {
            events.push(base("TopUpProposed", &e.vault, f(&[("destinationOwner", addr(&e.destination_owner)), ("amount", e.amount.to_string()), ("nonce", e.nonce.to_string()), ("executeAfter", e.execute_after.to_string())])));
        } else if let Some(e) = ev::ColdTransferExecuted::match_and_decode(log) {
            events.push(base("ColdTransferExecuted", &e.vault, f(&[("destinationOwner", addr(&e.destination_owner)), ("amount", e.amount.to_string()), ("instant", e.instant.to_string())])));
        } else if let Some(e) = ev::FullExitProposed::match_and_decode(log) {
            events.push(base("FullExitProposed", &e.vault, f(&[("destinationOwner", addr(&e.destination_owner)), ("nonce", e.nonce.to_string()), ("executeAfter", e.execute_after.to_string()), ("uninstall", e.uninstall.to_string()), ("amount", e.amount.to_string())])));
        } else if let Some(e) = ev::FullExitExecuted::match_and_decode(log) {
            events.push(base("FullExitExecuted", &e.vault, f(&[("destinationOwner", addr(&e.destination_owner)), ("amount", e.amount.to_string())])));
        } else if let Some(e) = ev::RiskVerdictApplied::match_and_decode(log) {
            events.push(base("RiskVerdictApplied", &e.vault, f(&[("nonce", e.nonce.to_string()), ("reasonCode", e.reason_code.to_string()), ("realizedLossUsdc", e.realized_loss_usdc.to_string()), ("cooldownUntil", e.cooldown_until.to_string()), ("extended", e.extended.to_string()), ("evidenceHash", addr(&e.evidence_hash))])));
        }
    }
    Ok(ShieldEvents { events })
}

/// Forward key `exec:<vault>:<owner>` answers "is this owner a trading wallet of
/// that vault", and reverse key `owner:<owner>` answers "which vault is this
/// owner a trading wallet of". The reverse one is what makes returns detectable:
/// a venue sends USDC back in its own transaction, in a block that carries no
/// ShieldVault event at all, so there is nothing there to enumerate vaults from.
///
/// One owner registered by two vaults resolves to the most recent registration.
/// A trading wallet belongs to one person in practice, and the forward key still
/// gates the attribution, so the failure mode is a missed return rather than one
/// credited to a stranger.
#[substreams::handlers::store]
fn store_vault_registry(events: ShieldEvents, store: StoreSetString) {
    for e in events.events {
        if e.name != "RegistrationChanged" {
            continue;
        }
        let kind = e.fields.get("kind").cloned().unwrap_or_default();
        let active = e.fields.get("active").map(|a| a == "true").unwrap_or(false);
        let owner = e.fields.get("owner").cloned().unwrap_or_default();
        let is_exec = kind == "0" && active;
        store.set(0, &format!("exec:{}:{}", e.vault, owner), &(if is_exec { "1" } else { "0" }).to_string());
        store.set(0, &format!("owner:{}", owner), &(if is_exec { e.vault.clone() } else { String::new() }));
    }
}

#[substreams::handlers::map]
fn map_vault_flows(params: String, block: Block, events: ShieldEvents, registry: StoreGetString) -> Result<VaultFlows, Error> {
    let addrs = parse_addrs(&params);
    let vault_contract = addrs.first().cloned().unwrap_or_default();
    // params is "evt_addr:<vault> || evt_addr:<usdc>". Without the second address
    // every inbound ERC-20 transfer counted as a USDC return.
    let usdc_contract = addrs.get(1).cloned();
    let block_time = block.timestamp_seconds();
    let mut flows = Vec::new();
    let mut deposit_txs: Vec<String> = Vec::new();

    for e in &events.events {
        let base = |kind: FlowKind, outbound: bool, counterparty: String, amount: u64, is_exec: bool| Flow {
            block: e.block,
            block_time,
            tx_hash: e.tx_hash.clone(),
            vault: e.vault.clone(),
            kind: kind as i32,
            outbound,
            counterparty,
            amount,
            counterparty_is_execution: is_exec,
        };
        let amt = e.fields.get("amount").and_then(|a| a.parse::<u64>().ok()).unwrap_or(0);
        match e.name.as_str() {
            "Deposited" => {
                deposit_txs.push(e.tx_hash.clone());
                flows.push(base(FlowKind::Deposit, false, e.fields.get("depositor").cloned().unwrap_or_default(), amt, false));
            }
            "TopUpExecuted" => {
                let instant = e.fields.get("instant").map(|v| v == "true").unwrap_or(true);
                flows.push(base(if instant { FlowKind::TopUpInstant } else { FlowKind::TopUpGated }, true, e.fields.get("destinationOwner").cloned().unwrap_or_default(), amt, true));
            }
            "ColdTransferExecuted" => flows.push(base(FlowKind::ColdTransfer, true, e.fields.get("destinationOwner").cloned().unwrap_or_default(), amt, false)),
            "FullExitExecuted" => flows.push(base(FlowKind::FullExit, true, e.fields.get("destinationOwner").cloned().unwrap_or_default(), amt, false)),
            _ => {}
        }
    }

    // A USDC Transfer(from = a registered trading wallet, to = the vault contract)
    // that is not part of a deposit is a RETURN: money the user sent out to trade
    // coming back. This is the measurement the whole product rests on, so it has
    // to survive the ordinary case, which is the venue returning funds in its own
    // transaction — a block containing no ShieldVault event whatsoever.
    for log in block.logs() {
        if Some(log.address()) != usdc_contract.as_deref() || log.topics().len() != 3 || log.topics()[0].as_slice() != TRANSFER_TOPIC {
            continue;
        }
        if &log.topics()[2][12..] != vault_contract.as_slice() {
            continue;
        }
        let tx = addr(&log.receipt.transaction.hash);
        if deposit_txs.contains(&tx) {
            continue;
        }
        let from = addr(&log.topics()[1][12..]);
        // Resolve the owning vault from the reverse index rather than from this
        // block's events, then confirm against the forward key.
        let Some(vault) = registry.get_last(format!("owner:{}", from)).filter(|v| !v.is_empty()) else {
            continue;
        };
        if registry.get_last(format!("exec:{}:{}", vault, from)).as_deref() != Some("1") {
            continue;
        }
        let amount = substreams::scalar::BigInt::from_unsigned_bytes_be(log.data()).to_u64();
        flows.push(Flow { block: block.number, block_time, tx_hash: tx, vault, kind: FlowKind::Return as i32, outbound: false, counterparty: from, amount, counterparty_is_execution: true });
    }
    let _ = u64_of;
    Ok(VaultFlows { flows })
}

#[substreams::handlers::store]
fn store_flow_totals(flows: VaultFlows, store: StoreAddInt64) {
    for f in flows.flows {
        let k = |name: &str| format!("{}:{}", name, f.vault);
        match FlowKind::try_from(f.kind).unwrap_or(FlowKind::Unspecified) {
            FlowKind::TopUpInstant | FlowKind::TopUpGated => {
                store.add(0, k("sent"), f.amount as i64);
                store.add(0, k("topups"), 1);
            }
            FlowKind::Return => {
                store.add(0, k("returned"), f.amount as i64);
                store.add(0, k("returns"), 1);
            }
            FlowKind::Deposit => store.add(0, k("deposited"), f.amount as i64),
            _ => {}
        }
    }
}

#[substreams::handlers::map]
fn map_behavioral_profiles(deltas: Deltas<DeltaInt64>) -> Result<BehavioralProfiles, Error> {
    let mut by_vault: HashMap<String, BehavioralProfile> = HashMap::new();
    for d in deltas.deltas {
        let (name, vault) = match d.key.split_once(':') {
            Some(x) => x,
            None => continue,
        };
        let p = by_vault.entry(vault.to_string()).or_insert_with(|| BehavioralProfile { vault: vault.to_string(), ..Default::default() });
        let v = d.new_value;
        match name {
            "sent" => p.sent_to_execution = v as u64,
            "returned" => p.returned_from_execution = v as u64,
            "deposited" => p.deposited = v as u64,
            "topups" => p.top_up_count = v as u64,
            "returns" => p.return_count = v as u64,
            _ => {}
        }
        p.net_execution_flow = p.returned_from_execution as i64 - p.sent_to_execution as i64;
    }
    Ok(BehavioralProfiles { profiles: by_vault.into_values().collect() })
}
