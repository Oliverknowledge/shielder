# Shield

Shield is a self-custodial commitment vault for people who trade. While calm
you decide how much money is trading money and how much is not. The trading
money goes to your Hyperliquid account; the rest stays in a vault only you
control. Tightening a rule is instant; weakening one waits 24 hours and needs
your yes again tomorrow. Adding capital after a loss is the one thing Shield
is strict about.

**Live on HyperEVM testnet, chain id 998.** `ShieldVault.sol` is deployed at
`0xcdB6d631A00857584e70a21d800f51C5776302Fe` in tx
`0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc`
(block 63561837). It is immutable — no owner, no proxy, no upgrade path. Its
USDC balance today is 696.5 test USDC:

```bash
cast call 0x2B3370eE501B4a559b57D449569354196457D8Ab "balanceOf(address)(uint256)" \
  0xcdB6d631A00857584e70a21d800f51C5776302Fe --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
```

Four vaults exist on it, holding $600, $45, $21 and $0. That is $666, not
$696.50: `deposit` is the only path that credits a vault
(`ShieldVault.sol:333`), so USDC sent to the contract address directly belongs
to no vault and can never be released.

No public block explorer indexes HyperEVM testnet, so every hash in this file
is checked with `cast tx <hash> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm`.

> Calm you sets the limits. Tilted you can't instantly undo them.

**Shield is not a trading venue.** There is no order entry, no market list and
no leverage control in the app; `/trade` redirects to Home. The user trades on
Hyperliquid and the primary action on Home is "Open Hyperliquid". Shield is
the control layer around the capital they decided to keep out of that account:
it holds the protected balance, releases bankroll under rules set while calm,
and shows the venue's own account data next to it (read from Hyperliquid's
info API, never inferred from HyperEVM).

**The rules come from the user's own numbers.** Setup step 0 asks for the
Hyperliquid account they trade from and reads its public history before
proposing anything — ledger updates and fills from the info API, no
credentials (`server/hyperliquid.ts`). It groups that into sessions, takes
realised PnL from the venue's own `closedPnl` minus fees, and shows four
figures about the person looking at the screen: sessions, typical session size
(the median of what they deployed), largest losing session, and how many
sessions included a reload made while already down. Above them sits one
sentence generated from the same data, of the form "3 of your 4 largest losing
sessions involved another reload." The median session size becomes the
suggested bankroll, and the daily limit, loss trigger, pause length and
large-move threshold follow from it rather than from a template
(`app/src/pages/Setup.tsx`); the user changes any of them, and an account with
no history says so and starts from defaults.

**Why this is not a venue feature.** Any venue or wallet could build it in a
week. None of them can build it credibly: a venue that holds a customer's
money against that customer's stated wish owns a liability, so it has to build
an appeals path, and an appeals path is exactly what defeats a commitment
device. Shield's advantage is not technical — there is nobody to ask. No
owner, no admin, no support queue. The rules are enforced in Solidity for the
same reason they are not enforced in any vendor's policy engine: calm-you sets
policy for tilted-you, and a policy the vendor can change on request is not a
policy tilted-you has to live with. The asymmetric shape — instant to tighten,
delayed to loosen, confirm again at the end of the wait — is the design
gambling regulators converged on; the citations and the honest caveat are in
`docs/JUDGE_QA.md`.

Built for ETHGlobal ETHOnline 2026, Start Fresh pool. Sponsors: **Chainlink
CRE** (a confidential workflow that signs loss verdicts inside a TEE),
**Privy** (the embedded wallet that is a vault's authority), **The Graph**
(a Substreams package composed on `ethereum-common` as the behavioural memory).

---

## Run it yourself: the Anvil sequence

This is the path that reproduces end to end from a cold clone, in about five
minutes, with no accounts and no credentials.

### Prerequisites

| Tool | Install |
|---|---|
| Bun ≥ 1.2 | `curl -fsSL https://bun.sh/install \| bash` |
| Foundry (`forge`, `anvil`, `cast`) | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

That is all this section needs. Three later sections need more, and each says
so where it appears: the full test suite needs the Solana toolchain,
`substreams build` needs the `substreams` CLI, and `cre workflow simulate`
needs the `cre` CLI.

### Bring the stack up

```bash
bun install
cd contracts && forge install foundry-rs/forge-std --no-git && forge test && cd ..
anvil --chain-id 31337 &
bun run bootstrap:evm
bun run server:evm:anvil &        # binds :8799
bun run dev:app:evm               # http://localhost:5175
```

What each step should print:

- `forge test` → `44 tests passed, 0 failed, 0 skipped (44 total tests)` —
  41 invariants in `ShieldVault.t.sol` and 3 pinned defects in
  `KnownDefects.t.sol`, which assert what the contract *does*, not what it
  should do. See "Known gaps" in `docs/THREAT_MODEL.md`.
- `bootstrap:evm` deploys MockUSDC, a mock CoreDepositWallet and
  `ShieldVault`, then initializes one vault — $6,000 floor, $2,000 per 24h,
  large top-ups over 20% of balance wait 30 minutes, $750 of realised loss
  pauses new capital for 12 hours — and ends
  `vault 0x9fe4… · balance 8500 USDC`.
- `server:evm:anvil` → `Shield EVM server on http://localhost:8799 (anvil via
  http://127.0.0.1:8545)`. Use this script, not `server:evm`: it scopes the
  environment to Anvil, so a `.env` pointing at chain 998 cannot leak in, and it
  binds a different port so it cannot take :8788 from a testnet server you have
  running.
- The app opens on http://localhost:5175. Welcome → "Continue with a demo key"
  → Anvil account 0's key
  `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
  (a public dev key).

### The sequence

From a second terminal:

```bash
bun run demo:evm top-up 1500          # instant release into the venue account
bun run demo:evm loss 1420            # DEMO, Anvil only: the venue settles a loss
bun run demo:evm return 80            # DEMO, Anvil only: $80 comes back Core → EVM
                                      #   → a $1,420 realised loss
bun run demo:evm top-up 500           # rejected on-chain: CooldownActive
bun run demo:evm loosen daily=3000    # weakening: review in 24h, nothing changes by itself
bun run demo:evm scoreboard
```

Between the third and fourth commands the server's monitor derives the loss
from indexed logs, signs an EIP-712 verdict with the monitor key and relays
it. Within one poll (4s on Anvil) the server logs
`verdict #1 relayed for 0xf39Fd6: 0x…` and the next top-up is refused by the
contract, not by the UI:

```
Top-up $500 to 0x7099…: expected path = blocked (CooldownActive)
❌ instant top-up → HyperCore: rejected by the vault (CooldownActive)
```

`scoreboard` then prints the state the app is showing:

```
Shield vault 0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0 (Anvil) · authority 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Protected balance      $7,000  (floor $6,000)
  Daily top-up limit     $2,000 / 24h · used $1,500
  Large top-up pause     >= 20% of balance waits 30 min
  Loss rule              >= $750 realised in 24h -> pause 12h
  Cooldown               ACTIVE (loss rule) until 9/7/2026, 1:47:40 PM
  Config version         1   verdicts applied 1
  Venue account          $1,500 (mock CoreDepositWallet)
    execution 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 "Hyperliquid" route=hypercore
    cold      0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC "Safe wallet" route=evm
  Pending rule change #1: executes 9/8/2026, 1:48:06 AM — {"kind":"loosen","params":{"newVelocityThreshold":"3000000000"}}
```

Balance is $7,000, not $7,080: on Anvil the `return` command hands the money
back with a plain ERC-20 transfer, which the contract never credits to a vault
(see "Returned capital" in `docs/THREAT_MODEL.md`). $1,500 of the day's $2,000
limit is used because the $500 top-up above was refused. Timestamps and the
cooldown deadline depend on when you run it.

The cooldown is 12 hours because that is the rule the vault was initialized
with; a verdict carries no duration of its own.

---

## Run against the live testnet deployment

```bash
cp .env.example .env      # already points at chain 998 and the deployed contract
bun run server:evm &      # :8788
bun run dev:app:hyperevm  # http://localhost:5174
```

One contract holds many vaults, keyed by authority address. Four exist today.
Reading any of them needs no key:

```bash
curl -s localhost:8788/api/vault/0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006
curl -s localhost:8788/api/health
```

The demo vault, authority `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006`: $600
protected, $500 floor, $100 per 24h, loss rule $50 → 12h, presently in a loss
cooldown from an applied risk verdict. Acting on a vault needs its authority's
private key, which is not in this repository; the app's read paths and the
server API do not.

`/api/health` reports `source.mode: "rpc"` and says in plain words why: The
Graph indexes HyperEVM mainnet only, so on testnet the server falls back to
RPC log indexing. See the Substreams row below.

Redeploying needs two HyperEVM specifics, both handled by the scripts: the
~5.4M-gas deployment does not fit in a small block, so
`bun run hyperevm:big-blocks on|off` toggles the deploy key's block type; and
the public RPC caps `eth_getLogs` at 50 blocks and meters requests, so the
indexer paces itself there. `bun run bootstrap:hyperevm` initializes a vault
and its destinations against the already-deployed contract.

---

## What is verified, and what is not

Every row is either backed by a transaction hash or a committed file, or says
plainly that it is not done.

| Claim | Status |
|---|---|
| `ShieldVault.sol` enforces the rules in `docs/THREAT_MODEL.md`; no owner, admin or upgrade path | **Verified, with three disclosed defects.** 44 Foundry tests (41 invariants, 3 pinning known defects); deployed and immutable on chain 998; `usdc()`, `coreDeposit()` and the EIP-712 domain separator read back correctly |
| The vault funds a Hyperliquid Core account directly | **Verified on chain 998.** tx `0x94960d1f…f889be`, block 63581864: one transaction carrying USDC approval, vault → CoreDepositWallet → HyperCore system address `0x2000…0000`, a HyperCore credit of $5.00, and `TopUpExecuted(amount=$5, instant=true, balanceAfter=$45, route=1)` |
| **Privy**: an embedded wallet is a vault's authority and completed a financial flow | **Verified.** Privy created the wallet on login (`createOnLogin: "users-without-wallets"`, `app/src/lib/privy.tsx:67`). Wallet `0x83144b99…1D2B`, nonce 4 — it signed four transactions itself: `registerOwner` (`0x80c2a48a…f8f0`), the $5 release above, `proposeLoosen` (`0xeeea692a…4b85`). The contract gates every path on `msg.sender`, so Privy *is* the authority |
| **Chainlink CRE**: the confidential handler is load-bearing, and its verdict changes chain state | **Verified.** `handlerInTee` from `@chainlink/cre-sdk` registered at `cre/shield-risk/main.ts:88` with `[{ tee: "nitro", regions: ["us-west-2"] }]`; the verifier key is read in-enclave via `runtime.getSecret` (`cre/shield-risk/evaluate.ts:89`) and used to produce the EIP-712 signature. On-chain result: tx `0x2e411cea…6bb35`, block 63584417, `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=3500000, extended=true)` |
| `cre workflow simulate` runs and reports TEE placement | **Verified and reproduced.** Transcript: `docs/evidence/cre-simulate.txt` |
| **The Graph**: a five-module Substreams package composed on `ethereum-common@v0.3.3` | **Verified.** `substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg` is committed; `ethereum-common`'s `index_events` is the declared `blockFilter` for both maps, so the provider only ships blocks carrying a vault or USDC log |
| The package consumes live data from a Graph provider | **Verified and reproduced.** Full stateful pipeline (`map_vault_flows`) run against `hyperevm.substreams.pinax.network:443`, ending `Completed successfully`. Transcript: `docs/evidence/substreams-live.txt` |
| …but it returns rows for Shield's vault | **No.** The Graph indexes HyperEVM **mainnet (999)** only; there is no testnet entry in its networks registry, and the vault is on 998. The live run is real and empty. The running server therefore reports `source.mode: "rpc"` and indexes logs itself |
| The EVM server indexes logs, derives behaviour, signs and relays EIP-712 verdicts | **Verified on Anvil** (verdict relayed, cooldown armed, next top-up refused by the contract) and **on chain 998** (the CRE verdict above was relayed by this server) |
| A monitor verdict can only ever hurt a little | **Verified in Solidity** (`ShieldVault.sol:536-558`, tested at `ShieldVault.t.sol:259-261`): a verdict carries no duration, floor, limit or destination; `cooldownUntil` only moves forward; the user's own `lossTriggerUsdc` is the floor below which a verdict is rejected; cold transfers and full exit are never gated by it; the worst case is bounded by `MAX_LOSS_COOLDOWN_SECS = 30 days` |
| Live Hyperliquid account data | Equity, positions, fills and session PnL are read from Hyperliquid's own info API for the registered account. Shield has no order entry |
| The loss rule reads the venue's settled PnL where the venue answers | **Verified in `server/policy.ts`.** `venueDecides` selects Hyperliquid's realised PnL over the indexed flow view, because the flow view cannot tell capital that was lost from capital still deployed — it once booked a $70 loss on an account that was up $5. The flow view is the fallback for an unreachable API or a destination with no API |
| Setup proposes rules from the user's own Hyperliquid history | **Verified in `server/hyperliquid.ts` and `app/src/pages/Setup.tsx`.** Sessions, median session size, largest losing session and reload-after-loss counts are read from the public info API with no credentials, shown to the user, and used to derive the proposed bankroll, daily limit, loss trigger, pause length and large-move threshold |
| AI is part of the shipped product | **No.** There is none. `docs/AI_USAGE.md` is about AI writing this repository, which is a different thing |
| Privy policies, quorums, session signers, Cards, `useFundWallet` | **Not used.** The B2B track is not claimed |
| Chainlink Continuity track | **Not claimed.** Shield is net-new, so there is no existing project to improve |

Three things are genuinely open. They are decisions, not code:

1. **The repository is private.** All three sponsors require a public repo.
2. **No HyperEVM mainnet deploy.** That is what would give The Graph package
   real rows, and it is the only reason the row above says "empty". The
   deployer holds 0.0000564 HYPE on mainnet EVM, not enough for gas.
3. **The 2–4 minute demo video does not exist.** Every track requires one.

---

## Evidence

- `docs/evidence/cre-simulate.txt` — verbatim `cre workflow simulate` output,
  including the TEE placement banner ("AWS Nitro in us-west-2") and
  "Simulation complete!". Reproduce it from the repository root with:

  ```bash
  cre workflow simulate shield-risk --target evm-settings --non-interactive \
    --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
    -R cre -e cre/.env
  ```

  Use `--target evm-settings`; `staging-settings` is the Solana config and
  demands a Solana keypair. `-R cre` makes the workflow path `shield-risk`.
  Needs the `cre` CLI, the chain-998 server running on :8788 (the workflow
  fetches flows from it), and secrets in `cre/.env` — copy `cre/.env.example`;
  the real file is gitignored.

- `docs/evidence/substreams-live.txt` — package composition as built, then a
  live run at mainnet head. Reproduce with `bun run substreams:hyperevm`
  (needs the `substreams` CLI and a Graph Market JWT in `SUBSTREAMS_API_TOKEN`;
  the script never prints the token).

- `docs/SPONSOR_INTEGRATIONS.md`, `docs/JUDGE_QA.md`, `docs/THREAT_MODEL.md`,
  `docs/DEMO_SCRIPT.md`.

---

## Verify everything

```bash
cd contracts && forge test && cd ..    # 44: 41 invariants + 3 pinned defects
                                       #     (after forge install, above)
bun run build:program && bun test tests/ server/
                                       # 66: 46 program invariants (LiteSVM), 20 server
bun run typecheck                      # app, server (both chains), clients, CRE workflow, tests
bun run build:app                      # production bundle
```

`bun run build:program` compiles the v0 Anchor program to
`target/deploy/shield_vault.so`, which the LiteSVM harness loads. Without it the
program suite **skips rather than fails**: `20 pass, 46 skip, 0 fail`, with a
line saying why. So the 20 server tests run on a bare checkout. Building it
needs Rust and the Solana CLI, which ships `cargo-build-sbf`:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # solana + cargo-build-sbf
```

Two more checks need their own tools:

```bash
# needs: the substreams CLI, protoc, and rustup target add wasm32-unknown-unknown
cd substreams-evm && substreams build && cd ..
cd substreams && substreams build && cd ..

# needs: the cre CLI
bun run build:cre
```

Both `substreams build` calls rewrite the committed `.spkg` in place, so
expect a git diff afterwards; the content is the same package.

The confidential evaluation also runs locally, outside any enclave, against
whichever stack you bootstrapped — Anvil first, then chain 998. It reads the
same secret and produces the same signed verdict:

```bash
bun run cre/shield-risk/dryrun.ts --evm --no-deliver   # drop the flag to relay it
```

---

## How it fits together

```
 Privy embedded wallet ──► the vault's authority ──► ShieldVault.sol (HyperEVM 998)
                                                floor · 24h limit · large-move pause ·
                                                cooldown · destination registry · delays
                                                      │ instantTopUp → CoreDepositWallet.depositFor(user)
                                                      ▼
                                             the user's Hyperliquid account ◄── they trade here
                                                      │ returns: Core → EVM, then deposit() back into the vault
                                                      ▼
   The Graph Substreams (HyperEVM mainnet) ─flows─► Shield server: sessions → realised loss
                                                    → verdict → relay
                                                      ▲ raw flows + policy
                                             Chainlink CRE confidential workflow (handlerInTee)
                                             same evaluate(), signs EIP-712 inside the enclave
```

- The app reads every number that governs money from the chain. The server
  only adds behaviour and explanations; if it dies, every rule and every exit
  still works.
- The monitor — server or enclave — can only extend a cooldown, for the length
  the user set, when the loss it attests meets the user's own trigger.
- The loss it attests has two possible sources, and `server/policy.ts` decides
  between them: where Hyperliquid's API answers, its settled PnL is the number,
  because the indexed flow view cannot separate money lost from money still
  deployed. The flow view is the fallback where there is no venue to ask.

---

## The rules, as the vault enforces them

| Rule | Tighten (instant) | Loosen (waits `loosenCooldown`, ≥1h, default 24h; then confirm again) |
|---|---|---|
| Protected floor | raise | lower |
| Daily top-up limit (24h rolling, includes capped cold transfers) | lower | raise |
| Large top-up threshold (% of balance) and its 30-min pause | lower % / longer pause | raise % / shorter pause |
| Loss trigger and pause length | lower trigger / longer pause | raise trigger / shorter pause |
| Emergency cold cap | lower | raise |
| Weakening delay, exit delay | longer | shorter (floor: 1h) |
| Destinations | remove | add |
| Monitor | add (none → some) | change / remove |
| Pause funding (self) | extend, up to 30 days | — (expires by time) |
| Leave Shield | — | whole balance to a cold wallet after `fullExitCooldown` (default 7d) |

Any tightening bumps `configVersion`; weakening proposals created earlier go
stale and cannot execute. Monitor verdicts never bump it.

---

## Repository

```
contracts/               ShieldVault.sol, mocks, 44 Foundry tests
                         (ShieldVault.t.sol invariants + KnownDefects.t.sol)
server/                  evm-index.ts (chain 998/Anvil), index.ts (Solana v0),
                         behaviour.ts, policy.ts, hyperliquid.ts, substreams-source.ts
client/                  views.ts (chain-agnostic), evm.ts, solana-adapter.ts, demo CLIs
app/                     React + Vite. pages/: Landing, Welcome, Setup, Overview, TopUp,
                         Protection, Behaviour, Activity. No trading screen
cre/                     Chainlink CRE confidential workflow (handlerInTee, EIP-712 + Ed25519)
substreams-evm/          The Graph package for ShieldVault.sol (ethereum-common composition)
substreams/              The Graph package for the Solana program (v0)
programs/shield-vault/   Anchor program (v0)
scripts/                 anvil-demo.ts, hyperevm-bootstrap.ts, hyperevm-big-blocks.ts,
                         substreams-live.sh, deploy.sh, bootstrap-demo.ts
tests/                   LiteSVM harness for the v0 program
docs/                    threat model, sponsor integrations, judge Q&A, demo script,
                         submission, mainnet runbook, evidence/, internal/ (working
                         notes: the build briefs and the review passes)
HUMAN_ACTIONS.md         the steps only a human can do
```

### The Solana program is v0 history

Shield started on Solana and the Anchor program under `programs/shield-vault`
is kept as the zero-credential reference implementation of the same rule
engine — 46 LiteSVM tests, its own Substreams package, an Ed25519 verdict
path. It is not the live product. The product runs on HyperEVM and
Hyperliquid; the app is chain-agnostic (`client/views.ts`,
`app/src/lib/engine.ts`) and every screen runs on both, which is why the v0
stack still works:

```bash
scripts/deploy.sh local && SHIELD_RPC_URL=http://127.0.0.1:8899 bun run scripts/bootstrap-demo.ts
bun run server & bun run dev:app          # http://localhost:5173
bun run client/demo.ts top-up 1500 && bun run client/demo.ts return 80
```

## License

MIT.
