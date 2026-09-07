# Verified facts — the only things docs may assert
Every line below was checked against the running system, the chain, or a command
that was actually executed during the Pass 1 gauntlet on 2026-09-07.
If a claim is not in this file, do not put it in a judge-facing document.

## Deployment
- Contract: `ShieldVault.sol` at **0xcdB6d631A00857584e70a21d800f51C5776302Fe**
- Chain: **HyperEVM testnet, chain id 998**, RPC `https://rpc.hyperliquid-testnet.xyz/evm`
- Deploy tx `0x67ffb653…`, block **63561837**; deployer `0x05a7a130869a793719BB6B341009ea3B70588DCb`
- USDC (Circle test): `0x2B3370eE501B4a559b57D449569354196457D8Ab`
- CoreDepositWallet: `0x0B80659a…C206`; `usdc()` and `coreDeposit()` both verified on chain
- The contract is immutable: no proxy, no owner, no upgrade path.
- One contract, many vaults, keyed by authority address. Four exist today.

## Vaults (all live on 998)
| Authority | Role | State |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | the demo vault | $600 balance, floor $500, $100/24h, $700 deposited, $100 released, verdict #1 applied |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | **the Privy embedded wallet** | $45 balance, floor $10, $50 deposited, $5 released to HyperCore |
| `0x751D1e26d79FeffE95F8a8662aB7A022780ED023` | the CRE demo vault | $21 balance, $3 loss trigger, 12h cooldown, verdict #1 applied |
| `0x05a7a130869a793719BB6B341009ea3B70588DCb` | deployer's own | $0, floor $6,000 — unusable, do not point anyone at it |

## Privy — Best Financial Flow
- Embedded wallet **created by Privy**, `createOnLogin: "users-without-wallets"` (`app/src/lib/privy.tsx:67`).
- Wallet `0x83144b99D89947703714Ee9aA3A3614985041D2B`, **nonce 4** — it signed four transactions itself.
- `registerOwner` — `0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0`, block 63581683
- **$5.00 release → HyperCore** — `0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be`, block 63581864.
  Logs in that one transaction: USDC Approval + Transfer vault → CoreDepositWallet → HyperCore system
  address `0x2000…0000`, a HyperCore credit to `0x05a7a130…` of $5.00, and
  `TopUpExecuted(amount=$5, instant=true, balanceAfter=$45, route=1)`.
- `proposeLoosen` — `0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85`, block 63581938
- Privy is the vault's **authority**: the contract gates every path on `msg.sender`.
- NOT used and must NOT be claimed: Privy policies, quorums, session signers, Cards, `useFundWallet`.
- The B2B track is **not claimable** — it needs Privy control primitives Shield does not implement.

## Chainlink — Best Confidential Workflow
- `handlerInTee` imported from `@chainlink/cre-sdk` and registered at `cre/shield-risk/main.ts:88`,
  with `[{ tee: "nitro", regions: ["us-west-2"] }]`. The whole evaluation runs inside it.
- Sensitive input: the verifier private key, read in-enclave via `runtime.getSecret({ id })`
  (`cre/shield-risk/evaluate.ts:89`), mapped in `cre/secrets.yaml`, and used to produce the EIP-712
  signature. That is the clause that passes. Do **not** claim the capital flows are confidential —
  they are read over plain HTTP from an unauthenticated local endpoint and are on-chain anyway.
- Simulation **run and reproduced**. Verbatim transcript: `docs/evidence/cre-simulate.txt`.
  TEE banner: "Trigger requested TEE Execution … AWS Nitro in us-west-2". Ends "Simulation complete!".
- The command that works, **from the repository root**:
  `cre workflow simulate shield-risk --target evm-settings --non-interactive --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' -R cre -e cre/.env`
  (`--target staging-settings` is the Solana config and demands a Solana keypair; `-R cre` makes the
  workflow path `shield-risk`, not `cre/shield-risk`.)
- On-chain result — **verified log by log**: tx
  `0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35`, block 63584417, status 1,
  `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=3500000, cooldownUntil=1788776770,
  extended=true, evidenceHash=0x4c7946…918b)`. Vault state after: `cooldownReason=2 (RISK_VERDICT)`,
  `lastVerdictNonce=1`.
- Safety invariant **verified in Solidity** (`ShieldVault.sol:536-558`): a verdict carries no duration,
  floor, limit or destination; `cooldownUntil` only ever moves forward; the user's own `lossTriggerUsdc`
  is the floor below which a verdict is rejected; cold transfers and full exit are never gated by it.
  Worst case is bounded by `MAX_LOSS_COOLDOWN_SECS = 30 days`. Tested at `ShieldVault.t.sol:259-261`.
- The Continuity track ($500) is **not claimable** — Shield is net-new, so there is no existing
  project for the integration to improve. The repo already declines it; keep declining it.

## The Graph
- Package `substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg`, **committed**, five modules,
  composed on The Graph's foundational `ethereum-common@v0.3.3`: its `index_events` module is the
  declared `blockFilter` for both maps. `substreams info` prints the populated filter query.
- **Live stream proven.** `docs/evidence/substreams-live.txt`: the full stateful pipeline
  (`map_vault_flows`) run against `hyperevm.substreams.pinax.network:443` — a Graph Market provider —
  ending "Completed successfully". The Graph Market JWT in `.env` is valid to 2027-10-28.
- **The honest limitation, which must be stated wherever the claim is made:** the run emits no rows.
  The Graph indexes HyperEVM **mainnet (999)** only — there is no HyperEVM testnet entry in its
  networks registry — and the vault is on testnet (998). The running server therefore reports
  `source.mode: "rpc"`, and `/api/health` says so in plain words.
- Pool: **Start Fresh**. First commit 2026-09-04, after the event opened.
- There is **no AI in the shipped product**. Do not claim the AI track on the basis of
  `docs/AI_USAGE.md`, which is about AI writing the repo — a different thing entirely.

## Tests and toolchain
- `cd contracts && forge test` → **44 passed** (41 invariants in ShieldVault.t.sol, 3 pinned defects in KnownDefects.t.sol). Needs `forge install foundry-rs/forge-std --no-git` first.
- `bun test tests/ server/` → **66 passed** after `bun run build:program`. Without the Solana program
  built the suite **skips rather than fails**: 20 pass, 46 skip, with a printed reason. That program is
  v0; the shipped product is contracts/ShieldVault.sol.
- `bun run typecheck` → clean. `bun run build:app` → clean.
- `substreams build` needs the `substreams` CLI, `protoc` and the Rust `wasm32-unknown-unknown` target.
  None are listed in the README prerequisites today.
- The Anvil hero sequence reproduces cold, end to end, and is the most reliable thing in the repo.
  It arms a **12h** cooldown, not the 18h the README claims.

## Explorers — important
There is **no public block explorer that indexes HyperEVM testnet**. Verified:
`explore-testnet.hyperpc.app` returns "unable to locate this transaction hash" and shows the vault as
an EOA with 0 transactions; `app.hyperliquid-testnet.xyz/explorer/tx/<hash>` renders blank;
`testnet.purrsec.com` 404s; `testnet.hyperevmscan.io` does not resolve.
Do not link any of them. The verifiable form is:
`cast tx <hash> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm`
On HyperEVM **mainnet**, `hyperevmscan.io` works — one more reason the mainnet deploy matters.

## Contract defects, found by this gauntlet and pinned in contracts/test/KnownDefects.t.sol
1. Cancelling a top-up proposal parked past 24h refunds into a bucket that is current again after a
   full lap, erasing unrelated spend. Verified: $3,000 released against a $1,600 limit in one window.
2. `tighten` places no upper bound on `loosenCooldownSecs` or `fullExitCooldownSecs`, so a user can
   lock themselves out of their own exit. The app now caps what it will submit; a direct call cannot be.
3. `_rollBuckets` clamps `elapsed` before advancing `bucketStart` and never advances
   `currentBucketIndex`, so an idle gap refunds the whole daily limit once per idle day, in a single
   block. Verified: **$6,000 released in one block against a stated $1,000 per 24 hours**, with
   `velocityNow` reporting zero. The protected floor still bounds the total drain.

Separately, and not a contract bug so much as a hazard: `deposit()` is the only path that credits a
vault, so USDC sent to the contract by a raw transfer belongs to no vault and cannot be recovered.
Measured on chain 998: contract holds $696.50, the four vaults account for $666.00, $30.50 stranded.
The demo and the indexer now both use `deposit()`.

## Still open — human decisions, not doc claims
1. The repository is **private**. All three sponsors require a public repo. Nothing else matters until this is done.
2. HyperEVM **mainnet deploy** is the one change that turns The Graph's hardest clause from FAIL to
   PASS. Deployer holds 0.0000564 HYPE on mainnet EVM (not enough for gas) and 4.8 USDC on HyperCore.
3. The 2–4 minute demo video is required by every track and does not exist.
