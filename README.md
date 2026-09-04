# Shield

A treasury vault that gates the reload, not the trade.

Alex is 19, has $10k, and trades on Axiom — a non-custodial, high-speed
Solana execution wallet he holds the recovery phrase to. Shield can't stop
him from making a bad trade there. What it can do is observe his real
onchain history, and gate the one moment that's actually observable and
actually matters: pulling more capital out of his treasury to reload the
bankroll he just lost, in the same five angry minutes he lost it.

Full design rationale, premises, and three rounds of adversarial review
(including a hostile ChatGPT security pass that found and closed a real
vault-drain bug) live in
[`docs/designs/shield-treasury-vault.md`](docs/designs/shield-treasury-vault.md).
This README covers what's built and how to run it.

## What's here

| Component | Path | Sponsor | Status |
|---|---|---|---|
| Shield Vault (Anchor program) | `programs/shield-vault/` | Solana | Compiles to a real deployable `.so` |
| Behavioral memory pipeline | `substreams/` | The Graph (Substreams-for-Solana) | Compiles to a real deployable `.wasm`; core math unit-tested |
| Confidential evaluation workflow | `cre/workflow.ts` | Chainlink CRE | Compiles to a real deployable CRE `.wasm` via `cre-compile` |
| Demo client (CLI) | `client/demo.ts` | — | **Run live end-to-end** against a local validator |
| Web dashboard | `app/` | — | **Run live**; same instruction-building code as the CLI |
| Recovery CLI | `client/recovery-cli.ts` | — | **Run live end-to-end**; proves Invariant 10 |

Every component above was actually compiled in this environment with its
real toolchain against its real dependencies — not just written and hoped
to work. See "Verified vs. not yet run live" below for the exact line
between "compiles" and "deployed and exercised against a live network,"
which this session didn't have the infrastructure (funded devnet wallet,
live Graph endpoint, live CRE DON) to cross.

## The one invariant that matters most

**The vault must be correct with Graph, CRE, the Shield frontend, and the
Shield backend all dead simultaneously.** Every other design decision in
this repo is downstream of that sentence. See `docs/designs/shield-treasury-vault.md`'s
Invariants section for the full list (11 numbered invariants), and
`client/recovery-cli.ts` for the concrete, standalone proof: it imports
nothing Shield operates, only `@solana/web3.js` and a plain RPC URL.

## Repo layout

```
programs/shield-vault/   Anchor program (Rust) — the safety floor
substreams/               Substreams-for-Solana module (Rust → WASM)
cre/                       Chainlink CRE Confidential Workflow (TypeScript)
client/                   Demo client + standalone recovery CLI (TypeScript)
docs/designs/             The design doc, with full review history
```

## Building

### Shield Vault (Anchor program)

```bash
cargo build-sbf --manifest-path programs/shield-vault/Cargo.toml
```

Produces `target/deploy/shield_vault.so` (verified: 421,840 bytes) and
`target/deploy/shield_vault-keypair.json`. The program ID in
`declare_id!()` (`programs/shield-vault/src/lib.rs`) and `Anchor.toml` is
kept in sync with that keypair's pubkey.

**Known toolchain quirk in sandboxed/CI environments:** `anchor build` (and
`anchor --version`, `anchor idl build`, `anchor test`) auto-detect a
missing `solana-install` binary (Agave renamed it `agave-install`) and
silently download+switch to an older Solana release (1.18.17) whose bundled
Rust toolchain (1.75.0) is too old for current crates.io dependency
versions (`crypto-common 0.2.2` needs `edition2024`), causing `anchor build`
to fail with a manifest-parsing error. `cargo build-sbf` — called directly,
bypassing Anchor CLI's toolchain manager — uses whatever `solana-cli`
release is already active and does not have this problem; this is the
verified, reproducible build command for this program. If your environment
doesn't have this quirk, `anchor build` should also work and additionally
generates `target/idl/shield_vault.json`, which this repo's clients don't
currently rely on (see below).

Run the (currently unexecuted, toolchain-blocked) test suite:

```bash
anchor test  # or: your own local-validator harness against tests/shield-vault.ts
```

`tests/shield-vault.ts` exercises the invariants both review rounds pinned
down explicitly — including the exact "four $400 top-ups can't bypass a
$1,600 limit" structuring test and the CRE-verdict extend-only test — but
running it live needs `anchor test`'s bundled local-validator + IDL
generation, which hits the same toolchain quirk above. Next step to close
this gap: either fix the toolchain (point Anchor's manager at the working
Agave release) or hand-write a matching IDL and drive `solana-test-validator`
directly the way `client/demo.ts` does.

### Substreams module

```bash
cd substreams
cargo test --lib behavioral      # pure logic, no substreams runtime needed — 5/5 passing
cargo build --target wasm32-unknown-unknown --release
```

Produces `target/wasm32-unknown-unknown/release/shield_behavioral_memory.wasm`
(verified: 262,033 bytes). The `.proto` file
(`substreams/proto/shield/v1/behavioral.proto`) is the source of truth for
the wire schema; `substreams/src/pb.rs` is a hand-authored equivalent using
`prost::Message`'s derive directly, because this sandbox has no network
path to the real `substreams` CLI's `protogen` step or a `buf` toolchain.
**Keep `.proto` and `pb.rs` in sync by hand** until CI has real protogen
wired in — that's the concrete next step to de-risk this file.

Two things this module does NOT yet do, both flagged explicitly rather than
silently faked:

1. **No live Firehose/Substreams endpoint was queried.** `map_vault_transfers`
   and `map_execution_wallet_activity` are real, compiling Rust against the
   real `substreams-solana` block types, but this session had no
   StreamingFast API key or live Solana Firehose endpoint to run
   `substreams run` against real blocks. The design doc's Open Question #1
   (Axiom's real deposit-address pattern) is still genuinely open.
2. **DEX swap parsing uses balance-delta inference, not per-venue
   instruction decoding.** `swap_from_balance_deltas` derives in/out legs
   from pre/post token balance diffs (venue-agnostic, robust to instruction
   layout changes) rather than parsing Jupiter/Raydium/pump.fun's own
   instruction data byte-for-byte. This is a legitimate simplification, not
   a placeholder, but validate it against real transactions from each venue
   before trusting the numbers.

### Chainlink CRE Confidential Workflow

```bash
cd cre
bunx cre-compile workflow.ts workflow.wasm
```

Produces a real, deployable CRE `.wasm` (verified: 4,055,017 bytes) via the
actual `@chainlink/cre-sdk` (v1.19.1) toolchain, including its `javy`-based
WASM compilation step. The workflow:

- Runs inside a TEE (`handlerInTee`, `{ tee: "nitro" }`) per the design
  doc's confidentiality model — what's protected is the evaluation logic
  and the verifier's signing key, not the public subgraph aggregates it
  reads (see the corrected privacy claim in `docs/designs/shield-treasury-vault.md`).
- Signs verdicts with a key pulled from CRE's secret store inside the
  enclave (`runtime.getSecret`), never exposing it, and produces a raw
  Ed25519 signature over a Borsh-encoded `CreVerdict` that is wire-compatible
  with `programs/shield-vault/src/ed25519.rs`'s onchain verification —
  field-for-field, byte-for-byte.

**Not yet run:** an actual CRE simulation or DON deployment (Open Question
#2 in the design doc's own words: "Validate a minimal CRE CLI simulation on
day 1, with a hard kill deadline"). This session compiled the workflow to a
real artifact but did not have a CRE simulator or testnet DON available to
execute it against. **This is the single highest-priority verification step
before the hackathon demo** — if CRE-for-Solana verdict delivery doesn't
work end-to-end by early in the build window, the design doc's own
documented fallback (a plain signed backend check, still bound by the same
proposal-specific, extend-only rules) is the answer, not a scramble.

Also documented in `cre/workflow.ts`'s header comment: this SDK ships a
real `cre.capabilities.SolanaClient` receiver capability
(`WriteCreReportRequest`) that may be a more "native" verdict-delivery path
than the hand-rolled Ed25519 verifier in `ed25519.rs`, if a CRE-Solana
receiver is deployed for whatever network this targets. Validate that path
first; if it works, `ed25519.rs` becomes deletable.

### Running it live (local validator)

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 1. Deploy the built program to a local validator (immutable by default
#    with --bpf-program -- satisfies Invariant 11 for free in this mode)
solana-test-validator --reset --quiet \
  --bpf-program 4Z46Kz8ygX5Efw22ABbQ2LTf329N3nD2J81Z3CAY5Hyx target/deploy/shield_vault.so &

# 2. Bootstrap a demo vault: creates a test USDC mint, initializes a
#    vault, registers a stand-in "Axiom" execution wallet, funds it with
#    $10,000. State is written to /tmp/shield-demo-state.json.
export SHIELD_RPC_URL="http://127.0.0.1:8899"
solana airdrop 100 --url $SHIELD_RPC_URL
bun install
bun run scripts/bootstrap-local-demo.ts
```

Then either drive it from the CLI:

```bash
bun run client/demo.ts scoreboard <authorityPubkey>
bun run client/demo.ts top-up ~/.config/solana/id.json <axiomWallet> 3800
bun run client/recovery-cli.ts status <authorityPubkey>
```

...or from the web dashboard:

```bash
bun run dev:app   # http://localhost:5173
```

Upload your Solana CLI keypair JSON (e.g. `~/.config/solana/id.json`) in
the dashboard's connect panel, paste in the Axiom wallet pubkey the
bootstrap script printed, and click through the same three demo actions
the CLI exposes. **The dashboard and the CLI call the exact same
instruction-building code** (`client/shield-client.ts`) — this isn't two
separate implementations that could quietly drift apart, it's one client
library with two front ends.

All of the above has actually been run, live, against a deployed program
on a local validator in the course of building this — including catching
and fixing two real bugs (see git history) that only surfaced once real
transactions were sent, not from code review alone.

## Verified vs. not yet run live

Being precise about this line, because "developed" and "deployed and
proven end-to-end" are different claims:

**Verified in this session** (real toolchains, real compiles, real test
runs, all reproducible with the commands above):
- Shield Vault compiles to a real, deployable Solana program binary.
- Every CRITICAL and HIGH finding from three rounds of Claude review and
  two rounds of a hostile ChatGPT security review is implemented in the
  actual program logic, not just described in the design doc — the
  owner-pubkey-based type tag, the vault-global velocity accumulator with
  an explicit block-on-threshold state transition, the single authorized
  behavioral-cooldown-arming path via a bound CRE verdict, the fixed
  single-instruction transfer surface, the tighten/loosen monotonicity
  checks, the stale-proposal invalidation via `config_version`, and more —
  see the code comments in `programs/shield-vault/src/lib.rs`, each tagged
  with which review round it closes.
- The Substreams module's core derivation math (closed-cycle P&L, loss
  streak with recency decay, rolling median, rolling velocity) is unit
  tested and passing, including the exact "four $400s = one $1,600" test.
- The Substreams module compiles to its real wasm32 deployment target.
- The CRE workflow compiles through the actual, official CRE compiler
  toolchain to a real deployable artifact, using the real `@chainlink/cre-sdk`
  API (verified against its shipped `.d.ts` files and one of its own
  standard-test examples, not guessed).
- **The demo client, the web dashboard, and the recovery CLI have all
  been run live** against the deployed program on a local validator — a
  real vault, initialized, funded with $10,000 test USDC, a real $3,800
  top-up rejected on the instant path and correctly queued on the gated
  path, the 30-minute delay proven real by an early-execution attempt
  failing on-chain with `ProposalNotMatured`, a real 24h-delayed limit
  raise, and a real rejection of a full-exit to an unregistered
  destination (the scam-address protection, working end-to-end). This
  live run caught and fixed two real bugs neither review process nor
  static typechecking had found (see git history).

**Not yet run live** (the honest remainder — this is the actual "Next
steps" list, not a vague TODO):
1. Deploy `shield_vault.so` to devnet (only run against a local validator
   so far); confirm the program ID, run `initialize_vault` against a real
   devnet USDC-equivalent mint.
2. Resolve Axiom's real deposit-address pattern (design doc Open Question
   #1) — blocks the Substreams module's `map_vault_transfers` filter from
   being validated against real transaction data.
3. Run a real CRE simulation (`cre-compile`'s companion simulator, or a
   deployed testnet DON) against `cre/workflow.ts` — the single
   highest-priority remaining step, per the design doc's own kill-deadline
   discipline.
4. Wire `client/demo.ts`'s scoreboard command to a live Graph subgraph
   endpoint once the Substreams module is actually indexing (currently
   prints only the vault's own onchain state, which is real but partial).
5. Finalize (burn) the deployed program's upgrade authority before any
   judged deployment — Invariant 11, and a literal submission blocker per
   the design doc's Next Steps.
6. Hand-author (or generate, once the `anchor build` toolchain quirk above
   is fixed) an Anchor IDL and run `anchor test`'s full local-validator
   suite against `tests/shield-vault.ts`.

## License

Hackathon submission for ETHGlobal. No license chosen yet.
