# Substreams SKILLs: from one prompt to a deployed pipeline

The Graph's featured challenge asks for a Substreams pipeline built from a
single natural-language prompt using the official Substreams SKILLs
(https://github.com/streamingfast/substreams-skills). This is the record.

## Setup

```bash
git clone --depth 1 https://github.com/streamingfast/substreams-skills.git ~/.claude/skills/substreams-skills
# CLI + toolchain the skill expects
brew install bufbuild/buf/buf protobuf
curl -sSL https://github.com/streamingfast/substreams/releases/download/v1.22.0/substreams_darwin_arm64.tar.gz | tar -xz -C ~/.local/bin substreams
rustup target add wasm32-unknown-unknown
```

The agent loaded `skills/substreams-solana/SKILL.md` (v1.6.0) and
`skills/substreams-dev/SKILL.md`, then followed their hard rules: decode
instruction data into typed fields, one protobuf message per instruction,
`walk_instructions()` for CPI coverage, `build.rs` + `prost_build`,
matched crate pair (`substreams 0.7` + `substreams-solana 0.15`), and a
manifest with `protobuf:` and `binaries:` sections.

## The prompt

> Build a Substreams package for Solana devnet for the Anchor program
> `4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx` (source in
> `programs/shield-vault/src`). Decode every instruction into its own typed
> protobuf message with args and named accounts, and every Anchor event
> from `Program data:` logs. Then classify capital flows across each vault's
> boundary: outflows from the program's TopUpExecuted / ColdTransferExecuted /
> FullExitExecuted events, and inflows as any SPL Token `Transfer` or
> `TransferChecked` into a vault token account (learned from
> `initialize_vault`), marking the counterparty as a registered execution
> wallet or not. Keep running per-vault and per-execution-wallet totals and
> emit a per-vault behavioural profile. Output: `substreams run` first, a
> custom app sink second (a Bun server streams `map_vault_flows`). Start at
> devnet's first streamable slot.

## What the skill produced (checked in under `substreams/`)

- `proto/shield/v1/shield.proto`: 17 instruction messages, 13 event
  messages, `VaultFlow`/`VaultFlows`, `BehavioralProfile(s)`.
- `src/lib.rs`: `map_shield_instructions`, `map_shield_events`,
  `store_vault_registry`, `store_vault_wallets`, `map_vault_flows`,
  `store_flow_totals`, `map_behavioral_profiles`.
- `substreams.yaml`, `Cargo.toml`, `build.rs`, `README.md`.

```bash
cd substreams && substreams build
# 📦 Package created successfully at shield-behavioral-memory-v0.2.0.spkg
substreams info shield-behavioral-memory-v0.2.0.spkg   # 7 modules, network solana-devnet
```

## Running against The Graph Market (needs an API key)

```bash
substreams auth                         # thegraph.market key -> SUBSTREAMS_API_TOKEN
substreams run shield-behavioral-memory-v0.2.0.spkg map_vault_flows \
  -e devnet.sol.streamingfast.io:443 -s <slot of the vault's first tx> -t +500 -o jsonl
substreams gui shield-behavioral-memory-v0.2.0.spkg map_behavioral_profiles -e devnet.sol.streamingfast.io:443 -s <slot>
```

Shield's server does the same programmatically (`server/substreams-source.ts`
with `@substreams/core`) and exposes the derived behaviour to the app; with
`SUBSTREAMS_API_TOKEN` set, `/api/health` reports `source.mode: "substreams"`.
Without a key the endpoint answers `Unauthenticated: required authorization
token not found`, which is why this run is a human action
(`HUMAN_ACTIONS.md`). Hosted deployment alternative: The Graph Market
Hosted Sinks (`substreams sink postgres` managed for you) pointed at the
published package.

## Honest notes

- The package was built in an agent session driven by the prompt above and
  the SKILL files; iterations were limited to fixing `protoc` availability
  and one type mismatch. No golden-reference `EVAL.md` run was performed.
- The only thing not executed here is the live stream, for lack of a key.
