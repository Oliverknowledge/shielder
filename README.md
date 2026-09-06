# Shield

**Crypto gives you freedom. Sometimes too much.**

Shield is a financial control layer for people who trade. Calm-you decides how
much is trading money and how much is not; Shield makes that decision hold
when tilted-you wants to reload. Trade as fast as you like inside the plan.
Adding capital after losses is where Shield gets strict: rules you set while
calm are enforced by a vault you alone control, tightening is instant,
weakening waits 24 hours and needs your yes again tomorrow.

> Calm you sets the limits. Tilted you can't instantly undo them.

Built for ETHGlobal ETHOnline 2026 (Start Fresh). Sponsors: **The Graph**
(Substreams as the behavioural memory, on Solana devnet and HyperEVM),
**Privy** (sign-in and the embedded wallet that funds and trades on
Hyperliquid), **Chainlink CRE** (a confidential workflow that signs the loss
verdicts). Strategy and evidence: `docs/`.

## What is here

Two implementations of one rule engine, one app:

| | Hyperliquid-first (this sprint) | Solana (v0, kept as the zero-credential reference) |
|---|---|---|
| Protected capital | `contracts/src/ShieldVault.sol` on HyperEVM (any EVM); 41 Foundry tests | `programs/shield-vault` (Anchor); 46 LiteSVM tests |
| Bankroll delivery | `CoreDepositWallet.depositFor` → the user's Hyperliquid perps account, same block | registered Solana trading wallet |
| Memory | `substreams-evm/` (composed on The Graph's `ethereum-common` index) | `substreams/` (Solana devnet, The Graph Market) |
| Judgment | `cre/shield-risk` confidential workflow, EIP-712 verdict | same workflow, Ed25519 verdict |
| Server | `server/evm-index.ts` | `server/index.ts` |
| App | `app/` with `VITE_SHIELD_CHAIN=evm` | `app/` with `VITE_SHIELD_CHAIN=solana` |

The app is chain-agnostic (`client/views.ts`, `app/src/lib/engine.ts`);
every screen, including the landing page, the "Not tonight" block, Get me
safe, the 90-second reset and the morning-after reconfirmation, runs on both.

**Shield is not a trading venue.** There is no order entry, no market list and
no leverage control anywhere in the app: the user trades on Hyperliquid, and
the primary action on Home is "Open Hyperliquid ↗". Shield is the control layer
around the capital they decided to keep out of that account — it holds the
protected balance, releases bankroll under rules they set while calm, and shows
the venue's own account data next to it (read from Hyperliquid's info API,
never inferred from HyperEVM).

## Run the Hyperliquid-first stack locally (3 minutes)

Prerequisites: Bun ≥ 1.2, Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
bun install
cd contracts && forge install foundry-rs/forge-std --no-git && forge test && cd ..   # 41 invariant tests
anvil --chain-id 31337 &                     # local EVM
bun run bootstrap:evm                        # deploys MockUSDC, a mock CoreDepositWallet, ShieldVault; Alex's $10,000 vault
SHIELD_PORT=8788 bun run server:evm &        # indexer + monitor + relayer + API on :8788
bun run dev:app:evm                          # http://localhost:5174
```

In the app: Welcome → "Continue with a demo key" → paste Anvil account 0's
key (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`,
a public dev key). Then the hero sequence from a second terminal:

```bash
bun run demo:evm top-up 1500   # instant: released into the venue account (mock CoreDepositWallet on Anvil)
bun run demo:evm loss 1420     # DEMO (Anvil only): the venue settles a loss against that account
bun run demo:evm return 80     # DEMO (Anvil only): $80 comes back Core→EVM: a $1,420 realised loss
                               # …within one poll the monitor signs an EIP-712 verdict and the vault arms an 18h cooldown
bun run demo:evm top-up 500    # ❌ rejected on-chain: CooldownActive → the app shows NOT TONIGHT
bun run demo:evm loosen daily=3000   # weakening change: review in 24h, nothing changes by itself
bun run demo:evm scoreboard
```

## Run against the live HyperEVM testnet deployment

`ShieldVault.sol` is deployed on HyperEVM testnet (chain 998) at
[`0xcdB6d631A00857584e70a21d800f51C5776302Fe`](https://rpc.hyperliquid-testnet.xyz/evm),
deploy tx `0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc`
(block 63561837), constructed over Circle's test USDC
`0x2B3370eE501B4a559b57D449569354196457D8Ab` and CoreDepositWallet
`0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206`. `.env.example` carries the
matching config.

```bash
cp .env.example .env                    # already points at chain 998
SHIELD_PORT=8788 bun run server:evm &   # indexer + monitor + relayer + API on :8788
bun run dev:app:hyperevm                # http://localhost:5174
```

Welcome → "Continue with a demo key (hyperevm-testnet)" → paste the vault
authority's key. Overview reads the live contract: floor $6,000, daily limit
$2,000, loss rule $1,000 → 18h, the Hyperliquid account (HyperCore route)
and a safe wallet registered. The vault holds $0 until someone drips testnet USDC into it, which
needs a Hyperliquid-mainnet-active address (`HUMAN_ACTIONS.md` #2b).

Redeploying needs two HyperEVM specifics, both handled by the scripts: the
~5.4M-gas deployment does not fit in a small block, so `bun run
hyperevm:big-blocks on|off` toggles the deploy key's block type, and the public
RPC caps `eth_getLogs` at 50 blocks and meters requests, so the indexer paces
itself there. `bun run bootstrap:hyperevm` initializes a vault and its
destinations against an already-deployed contract.

With a Privy app ID the same app runs with real sign-in and a real embedded
wallet: `HUMAN_ACTIONS.md` #1.

## Run the Solana stack locally

```bash
scripts/deploy.sh local && SHIELD_RPC_URL=http://127.0.0.1:8899 bun run scripts/bootstrap-demo.ts
bun run server & bun run dev:app             # http://localhost:5173 · demo key: ~/.config/solana/id.json
bun run client/demo.ts top-up 1500 && bun run client/demo.ts return 80 && bun run client/demo.ts top-up 100
```

## Verify

```bash
bun test                      # 53: 46 program invariants (LiteSVM), 7 behaviour engine
bun run test:contracts        # 41 Solidity invariants (Foundry)
bun run typecheck             # app, server (both chains), clients, CRE workflow, tests
bun run build:app             # production bundle
cd substreams && substreams build && cd ../substreams-evm && substreams build
bunx cre-compile cre/shield-risk/main.ts cre/shield-risk/dist/shield-risk.wasm
bun run cre/shield-risk/dryrun.ts --evm <authority>   # the enclave function, locally, against the Anvil server
```

## What is verified, and what isn't

| Claim | Status |
|---|---|
| ShieldVault.sol enforces every rule in `docs/THREAT_MODEL.md`; no owner/admin/upgrade | Verified: 41 Foundry tests + the live Anvil sequence above. Deployed to HyperEVM testnet; bytecode, `usdc()`, `coreDeposit()` and the EIP-712 domain separator read back correctly on chain 998 |
| The vault funds the user's Hyperliquid account directly (`depositFor`) | Verified against a mock of Circle's CoreDepositWallet on Anvil. On HyperEVM testnet the deployed vault holds Circle's real CoreDepositWallet, confirmed by reading `coreDeposit()` back; moving money through it needs testnet USDC (`HUMAN_ACTIONS.md` #2b) |
| App: landing, onboarding (real Hyperliquid history insight), Home, NOT TONIGHT, See what happened, 90-second reset, Get me safe, Protection, Behaviour, Activity, mobile | Verified in a headless browser on both builds at 320–1280 px; production build passes |
| EVM server indexes logs, derives behaviour, signs and relays EIP-712 verdicts | Verified live on Anvil (verdict #1 relayed, cooldown armed, next top-up rejected). Against the HyperEVM testnet deployment the same server indexes the real vault's events and serves them to the app; relaying a verdict there waits on funded flows (#2b) |
| CRE confidential workflow signs EVM verdicts the vault accepts | Verified via `dryrun.ts --evm` (source `cre`, relayed on-chain). `cre workflow simulate` needs a Chainlink account (#4) |
| The Graph: Solana package builds and streams from The Graph Market; EVM package composes `ethereum-common` | Builds verified. Live streaming needs a Graph Market key (#3); HyperEVM indexing is mainnet-only |
| Privy sign-in + embedded wallet | Code paths built and typechecked; needs a Privy app ID (#1) to run. Privy governs the Shield wallet and its signers only: it makes no claim over an external Hyperliquid account |
| Live Hyperliquid account data | Equity, positions, fills and session PnL are read from Hyperliquid's own info API for the registered account, on every build. Shield has no order entry: trading happens on Hyperliquid |

## How it fits together

```
 Privy (email/passkey) ──► user's EVM key ──► ShieldVault.sol (HyperEVM)
                                               floor · 24h limit · large-move pause · cooldown · registry · delays
                                                      │ instantTopUp → CoreDepositWallet.depositFor(user)
                                                      ▼
                                             user's Hyperliquid account ◄── the user trades here, on Hyperliquid
                                                      │ returns: Core→EVM, USDC transfer back to the vault
                                                      ▼
   The Graph Substreams (HyperEVM) ──flows──► Shield server: sessions → realised loss → verdict → relay
                                                      ▲ raw flows + policy
                                             Chainlink CRE confidential workflow (handlerInTee)
                                             same evaluate(), signs EIP-712 in the enclave
```

- The app reads every number that governs money from the chain. The server
  only adds behaviour and explanations; if it dies, every rule and every exit
  still works.
- The monitor (server or enclave) can only ever extend a cooldown, for the
  length the user set, when the loss it attests meets the user's trigger.

## Repository

```
contracts/               ShieldVault.sol, mocks, Foundry tests
programs/shield-vault/   Anchor program (v0)
client/                  views.ts (chain-agnostic), evm.ts, solana-adapter.ts, shield-client.ts, demo CLIs
server/                  evm-index.ts, index.ts (Solana), behaviour.ts, policy.ts, hyperliquid.ts (history analyser)
substreams-evm/          The Graph package for ShieldVault.sol (ethereum-common composition)
substreams/              The Graph package for the Solana program
cre/                     Chainlink CRE confidential workflow (Ed25519 + EIP-712 signing)
app/                     React + Vite: landing, onboarding, Home, Trade, Top up, Behaviour, Protection, Activity
scripts/                 anvil-demo.ts, bootstrap-demo.ts, deploy.sh
docs/                    strategy, architecture decision, threat model, sponsor integrations, demo script, submission, judge Q&A, AI usage
HUMAN_ACTIONS.md         the steps only you can do
```

## The rules, as the vault enforces them

| Rule | Tighten (instant) | Loosen (waits `loosenCooldown`, ≥1h, default 24h; then you must confirm again) |
|---|---|---|
| Protected floor | raise | lower |
| Daily top-up limit (24h rolling, includes capped cold transfers) | lower | raise |
| Large top-up threshold (% of balance) and its 30-min pause | lower % / longer pause | raise % / shorter pause |
| Loss trigger and pause length | lower trigger / longer pause | raise trigger / shorter pause |
| Emergency cold cap | lower | raise |
| Weakening delay, exit delay | longer | shorter (floors: 1h) |
| Destinations | remove | add (once the vault is funded) |
| Monitor | add (none → some) | change / remove |
| Pause funding (self) | extend, up to 30 days | — (expires by time) |
| Leave Shield | — | whole balance to a cold wallet after `fullExitCooldown` (default 7d) |

Any tightening bumps `configVersion`; pending weakening proposals created
earlier become stale and cannot execute. Monitor verdicts never bump it.

## License

MIT for the hackathon submission.
