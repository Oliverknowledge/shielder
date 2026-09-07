# Verified facts — the only things docs may assert
Every line below was checked against the running system, the chain, or a command
that was actually executed. Pass 1 was 2026-09-07 morning; the v2 section was
added the same day after the contract was fixed and redeployed.
If a claim is not in this file, do not put it in a judge-facing document.

## Deployment — v2 (current)
- Contract: `ShieldVault.sol` **v2** at **0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006**
- Chain: **HyperEVM testnet, chain id 998**, RPC `https://rpc.hyperliquid-testnet.xyz/evm`
- Deploy tx `0xab4e5d6af3b6b74649fd522a8255fc8606ac60d1072b3c34ced5896ea53db6a8`, block **63626253**,
  5,376,125 gas, deployer `0x05a7a130869a793719BB6B341009ea3B70588DCb`
- `VERSION()` → 2; `usdc()` → `0x2B3370eE501B4a559b57D449569354196457D8Ab` (Circle test USDC);
  `coreDeposit()` → `0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206`; `MAX_FULL_EXIT_COOLDOWN_SECS()` → 2592000
- Runtime bytecode 24,504 bytes (72 bytes under EIP-170; `optimizer_runs = 1` was needed to fit)
- Immutable: no proxy, no owner, no upgrade path. One contract, many vaults, keyed by authority.

## Deployment — v1 (superseded, kept as history)
- `0xcdB6d631A00857584e70a21d800f51C5776302Fe`, deploy tx `0x67ffb653…`, block 63561837.
- Three defects found by our own gauntlet (below). v1 still holds the four v1 vaults ($600, $45, $21, $0)
  and $30.50 of stranded USDC; nothing on it is used by the app any more.
- The Privy embedded wallet's transactions (below) are on v1. They remain valid evidence of the
  Privy flow; the wallet has not yet transacted on v2.

## Vaults on v2 (live on 998)
| Authority | Role | State |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | the demo vault | $70 balance, floor $50, $10/24h, large-move threshold 20%, $3 loss trigger, 12h pause, $5 instant cap. init `0xf337c954…`, deposit `0x1be31354…` (block 63626301). Nonce 1 unused. |
| `0x751D1e26d79FeffE95F8a8662aB7A022780ED023` | the CRE demo vault | $10 deposited (`0xe4dd35f3…`, block 63626357), $5 released (`0x89314efe…`, block 63626516), $1 returned via `deposit()` from the trading account (`0xaa32bee8…`, block 63626521) → **$6 balance**; floor $4, $5/24h, threshold 60%, $3 trigger, 12h. **Verdict #1 applied** (below); cooldown until 1788818471, reason 2. |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | the Privy embedded wallet | **No vault on v2 yet.** Holds **$20 test USDC** (`0x80d310ef…`) and 0.30 HYPE so the on-camera onboarding can create and fund a vault from the Privy wallet itself. Its v1 vault ($45) is untouched. |
- Registered trading account for both v2 vaults: `0xE7c2Adb44064e705A2e955770440C527373967A1` (`.shield/hyperevm-keys.json` → `execution`), HyperCore route. Safe wallet: `0x811e4b90…55C2` (cold).
- Monitor (risk verifier) `0x4A41Fa3dbc3e7129B1441441522a80bcD0E08F3f`; relayer `0x697c781A56d10E8DCe9904602b3614805C7f437d`.

## The three v1 defects — fixed in v2, pinned as regressions
`contracts/test/FixedDefects.t.sol` (was `KnownDefects.t.sol`). Each test now asserts the correct
behaviour; the comment above each keeps what v1 did.
1. Cancelling an aged top-up proposal refunded into a bucket that had lapped, erasing unrelated spend
   ($3,000 against a $1,600 limit). v2: `cancelProposal` rolls the buckets and refunds only if the
   reserved bucket still represents the reservation's 4h window (`_reservationStillCurrent`).
2. `tighten` had no upper bound on `loosenCooldownSecs` / `fullExitCooldownSecs`. v2: all three self-set
   delays capped at 30 days (`MAX_TOP_UP/LOOSEN/FULL_EXIT_COOLDOWN_SECS`), `InvalidParameter` above.
3. `_rollBuckets` clamped `elapsed` before advancing `bucketStart` and never advanced the ring pointer in
   the long-idle branch ($6,000 in one block against $1,000/24h). v2: both advance by the real elapsed
   count. The same clamp in the Solana v0 program (`programs/shield-vault/src/state.rs`) is fixed too.
- Two invariants previously "checked by reading" now have tests: reentrancy through a hostile
  CoreDepositWallet (`Isolation.t.sol:test_reentrancyThroughAHostileCoreDepositWalletIsRefused`) and
  per-vault registry isolation (`test_registriesAreIsolatedPerVault`).
- The stranded-transfer hazard (raw USDC transfer to the contract credits nobody) is unchanged and still
  disclosed: returns must use `deposit(authority, amount)`.

## Privy — Best Financial Flow (on v1; still true)
- Embedded wallet **created by Privy**, `createOnLogin: "users-without-wallets"` (`app/src/lib/privy.tsx:67`).
- Wallet `0x83144b99D89947703714Ee9aA3A3614985041D2B`, **nonce 4** — it signed four transactions itself.
- `registerOwner` — `0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0`, block 63581683
- **$5.00 release → HyperCore** — `0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be`, block 63581864.
  Logs in that one transaction: USDC Approval + Transfer vault → CoreDepositWallet → HyperCore system
  address `0x2000…0000`, a HyperCore credit to `0x05a7a130…` of $5.00, and
  `TopUpExecuted(amount=$5, instant=true, balanceAfter=$45, route=1)`.
- `proposeLoosen` — `0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85`, block 63581938
- Privy is the vault's **authority**: the contract gates every path on `msg.sender`.
- The v1 vault was funded by a different address. The wallet now holds $20 test USDC on 998 so the
  deposit can be made **from** the Privy wallet on v2 (human action, on camera).
- NOT used and must NOT be claimed: Privy policies, quorums, session signers, Cards, `useFundWallet`.
- The B2B track is **not claimable** — it needs Privy control primitives Shield does not implement.

## Chainlink — Best Confidential Workflow (on v2)
- `handlerInTee` imported from `@chainlink/cre-sdk` and registered at `cre/shield-risk/main.ts:88`,
  with `[{ tee: "nitro", regions: ["us-west-2"] }]`. The whole evaluation runs inside it.
- Sensitive input: the verifier private key, read in-enclave via `runtime.getSecret({ id })`
  (`cre/shield-risk/evaluate.ts`), mapped in `cre/secrets.yaml`, and used to produce the EIP-712
  signature. Do **not** claim the capital flows are confidential — they are on-chain anyway.
- **Simulation run three times on v2**, verbatim in `docs/evidence/cre-simulate.txt`:
  run 1 (dry, no venue loss) → `realisedLoss24h=0 … triggered=false`, no signature;
  run 2 (deliver) after a real $7.12 venue loss → `realisedLoss24h=7119301 … triggered=true`, signed,
  relayed; run 3 (secret replaced by 0xdeadbeef) → fails before any HTTP call.
- The command that works, **from the repository root**, with `bun run server:evm` running:
  `cre workflow simulate shield-risk --target evm-dry-settings --non-interactive --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' -R cre -e cre/.env`
- On-chain result on v2 — **verified log by log**: tx
  `0xa02e2fcbe8770f58cb227dc0627ce32e65ca48ac6dee041b579012302d0bf9e4`, block **63626813**, status 1,
  from the relayer, 91,431 gas, `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=7119301,
  cooldownUntil=1788818471, extended=true, evidenceHash=0xe67a…)`. Vault state after:
  `cooldownReason=2 (RISK_VERDICT)`, `lastVerdictNonce=1`. `eth_call instantTopUp` from the authority
  now reverts with selector `0xaa9a98df` = `CooldownActive()`.
- The venue loss is real: two BTC round trips on Hyperliquid testnet from the registered trading
  account (`scripts/hyperevm-losing-trade.ts`, testnet-only), `closedPnl - fee` = −$7.1193 over 24h, which
  is exactly what `readVenueLoss` sums. The earlier $5 release/$1 return alone was correctly **not** a
  loss (the money was still at the venue).
- The v1 on-chain verdict (`0x2e411cea…`, block 63584417, realizedLossUsdc=3500000) remains true history.
- Safety invariant **verified in Solidity**: a verdict carries no duration, floor, limit or destination;
  `cooldownUntil` only ever moves forward; the user's own `lossTriggerUsdc` is the floor below which a
  verdict is rejected; cold transfers and full exit are never gated by it. Bounded by 30 days.
- Continuity track ($500) **not claimable** — Shield is net-new.

## The Graph
- Package `substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg`, **committed**, five modules,
  composed on The Graph's foundational `ethereum-common@v0.3.3` (`index_events` is the `blockFilter`
  for both maps). Filters name the **v2** vault and Circle's test USDC. `initialBlock` is a recent
  **mainnet** block (45,260,000): The Graph indexes HyperEVM mainnet only, and testnet block numbers
  are higher than mainnet's head, so the testnet deploy block is not a valid mainnet start.
- **Live streams proven, twice, with one JWT** (`docs/evidence/substreams-live.txt`):
  §2 HyperEVM `map_vault_flows` from `hyperevm.substreams.pinax.network:443` → "Completed successfully",
  20 blocks received; §3 the Solana package's decoder from `devnet.sol.streamingfast.io:443` →
  "Completed successfully", 20 blocks; §4 the same HyperEVM request with no token → `Unauthenticated`.
- **Both runs emit zero rows.** HyperEVM: the vault is on testnet, which The Graph does not index.
  Solana: the v0 program is not deployed on devnet. Neither fact is hidden anywhere.
- `substreams registry verify` passes for both packages ("To publish this package, run: substreams
  registry publish"). Publishing needs a substreams.dev login — human action.
- Credentials: one shared `SUBSTREAMS_API_TOKEN` (JWT, valid to 2027-10-28) in `.env`; endpoints
  `SUBSTREAMS_SOLANA_ENDPOINT` / `SUBSTREAMS_HYPEREVM_ENDPOINT`; resolver `server/substreams-config.ts`
  (4 unit tests). `.env` is gitignored as of this pass — it was not before.
- Server on 998 reports `source.mode: "rpc"` and `substreamsAvailable: "no: The Graph indexes HyperEVM
  mainnet only"`; on 999 with the JWT it streams `map_vault_flows` through `@substreams/core`.
- Pool: **Start Fresh**. First commit 2026-09-04.
- There is **no AI in the shipped product**. Do not claim the AI track.

## Tests and toolchain
- `cd contracts && forge test` → **49 passed**: 41 invariants (`ShieldVault.t.sol`), 6 regressions for
  the fixed defects (`FixedDefects.t.sol`), 2 isolation/reentrancy (`Isolation.t.sol`).
- `bun test tests/ server/` → **66 passed** with the rebuilt v0 program (`bun run build:program`).
- `bun run typecheck` → clean. `bun run build:app` → clean.
- `substreams build` needs the `substreams` CLI, `protoc`, `buf` and the Rust `wasm32-unknown-unknown` target.

## Explorers — important
There is **no public block explorer that indexes HyperEVM testnet**. Do not link any. The verifiable
form is `cast tx <hash> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm`. On HyperEVM **mainnet**,
`hyperevmscan.io` works — one more reason the mainnet deploy matters.

## Still open — human decisions, not doc claims
1. The repository is **private**. All three sponsors require a public repo.
2. HyperEVM **mainnet deploy** (of v2) is the one change that turns The Graph's hardest clause from
   FAIL to PASS. Deployer holds 0.0000564 HYPE on mainnet EVM and 4.8 USDC on HyperCore mainnet.
3. The 2–4 minute demo video does not exist.
4. `substreams registry publish` for both packages (needs a substreams.dev login).
