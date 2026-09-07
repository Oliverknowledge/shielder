# Verified facts — the only things docs may assert
Every line below was checked against the running system, the chain, or a command that was actually
executed. Last full pass: 2026-09-07 (v3 + risk ladder spike). If a claim is not in this file, do not put
it in a judge-facing document.

## Deployment — v3 (current)
- Contract: `ShieldVault.sol` **v3** at **0xDaA8B6a85391d54397c3847F006a49A16d0F37b3**, HyperEVM testnet
  (chain 998), deploy tx `0x70a98bffe313a28fcdc9d0989ea691ca3c3e6dedf0bcc2b454d107292176234b`, block
  **63634061**, deployer `0x05a7a130869a793719BB6B341009ea3B70588DCb`. `VERSION()` → 3.
- Same constructor args as v1/v2: USDC `0x2B3370eE501B4a559b57D449569354196457D8Ab`, CoreDepositWallet
  `0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206`. Immutable: no proxy, owner or upgrade path.
- Built with `via_ir = true`, `optimizer_runs = 1`: runtime 21,404 bytes (3,172 under EIP-170).
- v3 adds: the risk ladder (`commitLadder`, `setReducedTier`, `proposeLadderChange`,
  `executeLadderChange`, `cancelLadderChange`, `currentTier`, `effectiveVelocityThreshold`), a
  `RiskVerdict` with `tier` and `ladderHash` (typehash changed; `reasonCode` dropped), `lastVerdictNonce`
  reset when the verifier changes (fixes the nonce-exhaustion finding), and a budget re-check in
  `executeTopUp` (a gated top-up proposed at NORMAL cannot execute past a REDUCED budget).
- **Sepolia twin (for The Graph):** same bytecode at **0xf1ef03Ea258EF652939bAC0250d1CDe9B5EF4f6A**,
  Ethereum Sepolia (11155111), block 11654048, ROUTE_EVM only (CoreDepositWallet = 0), MockUSDC
  `0xb0Cbbeb2783E3965036Db1740911be45ad389837`. Staged: $10,000 deposit, $1,500 release, $80 return.
  An earlier v2 twin at `0xcdB6d631…` (same address as v1 on 998, same deployer nonce) is superseded.
- Superseded on 998: v2 `0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006` (block 63626253), v1 `0xcdB6d631…`
  (block 63561837). Both still hold their vaults; nothing points at them.

## Vaults on v3 (live on 998)
| Authority | Role | State |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | demo vault | $60 balance, floor $40, $12/24h, threshold 25%, $7 loss trigger, 12h; ladder committed (`0x85b2d24a…`; REDUCED budget $5, resets 24h; private threshold $3 in `.shield/ladders/`); **LOCKED** by the public rule today (server-monitor verdict `0xd36d069a…`, the trading account's real $7.35 loss) |
| `0x751D1e26d79FeffE95F8a8662aB7A022780ED023` | CRE demo vault | $10, floor $4, $5/24h, $3 trigger, 12h; ladder committed (`0x79de3837…`); **LOCKED** today (`0xd62796c5…`) |
| `0xaA8cfBd03CD4e043228bCCe42b5adD98866F7D8b` | ladder demo vault | $5, floor $2, $4/24h, $20 trigger; ladder `0x5d21c2bc…` (REDUCED budget $3); released $2.50 at NORMAL (`0x7f4ed584…`); **REDUCED by the enclave**: verdict `0x089727605059be589a27d668386df4c488204e3feea20fda4a79bbb022b5e2ca`, `currentTier()`=1, `effectiveVelocityThreshold()`=3000000 (was 4000000), until 1788873478 |
| `0x2946947fe968da1dbb758D03c44255A08990310C` | spare ladder vault | $8, its own trading account `0x662148b0…` which has no HyperCore account (a $2.50 CoreDeposit credit to it is unrecoverable: first deposits need $5). Do not point anyone at it |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | the Privy embedded wallet | no vault on v3; holds $20 test USDC + 0.3 HYPE for the on-camera onboarding. Its v1 vault ($45) and v1 txs remain the Privy evidence |
- Trading account shared by the first three vaults: `0xE7c2Adb44064e705A2e955770440C527373967A1` (`.shield/hyperevm-keys.json` → `execution`). Monitor `0x4A41Fa3d…`, relayer `0x697c781A…`.
- Test USDC is exhausted: deployer holds ~0.5 on EVM and ~2 on HyperCore spot; the trading account ~2 in perps. A trader-sized re-shoot needs the Hyperliquid testnet drip (HUMAN_ACTIONS).

## The risk ladder (v3) — what is enforced, what is private
- Rungs: NORMAL (0) / REDUCED (1) / LOCKED (2). `currentTier(authority)` derives the rung in force from
  two clocks: REDUCED lasts `tierResetSecs` (user-set, 1h–7d, default 24h); LOCKED is the cooldown.
- `applyRiskVerdict` accepts only `tier` 1 or 2 (never NORMAL); REDUCED requires
  `rv.ladderHash == v.ladderHash` (a committed ladder) and a current rung below REDUCED; LOCKED keeps
  the public floor `realizedLossUsdc >= lossTriggerUsdc`. Verified by 15 tests in `contracts/test/Ladder.t.sol`.
- REDUCED sets `_effectiveVelocity = min(velocityThreshold, reducedVelocityThreshold)` for every release
  path; floor, registry, cold cap and exit are untouched.
- Private: `reducedAtUsdc` (the trailing realised session drawdown that selects REDUCED) and the salt,
  as `keccak256(abi.encode(uint64 reducedAtUsdc, uint64 reducedVelocityThreshold, uint64 tierResetSecs,
  bytes32 salt))` = `ladderHash` (`client/ladder.ts`, 4 unit tests). Public: the hash, the REDUCED
  budget, the duration, the rung, and when it changed.
- The enclave (`cre/shield-risk/evaluate.ts`) reads the ladder as secret `LADDER_<vault>`, recomputes
  the hash, measures trailing drawdown from the venue's own fills (`trailingDrawdownUsdc`), and signs
  tier 1 with no dollar figure and no evidence bundle posted. Shield's server monitor signs only the
  public LOCKED rule; it never holds a ladder.
- Ascending: `proposeLadderChange(resetTier=true)` waits `loosenCooldownSecs` and needs
  `executeLadderChange()`; any tightening in between strands it. Replacing the commitment is always the
  delayed path (the chain cannot rank two hashes); shrinking the REDUCED budget is instant.

## Dynamic Trading Authority Ratchet — RED at the venue (documented, not built)
- Hyperliquid L1 actions are signed as `Agent{source, connectionId}` with the whole action hashed into
  `connectionId`; Privy typed-data policies see one opaque bytes32 and Privy has no Hyperliquid decoder.
  Reduce-only, leverage, size and asset-class restrictions on a signer are impossible (research A).
- Hyperliquid has no per-agent scoping; an agent can do every trading action; `valid_until` expiry was
  observed to lag by minutes; the master key always retains everything; bypass ≈ 1 s (research B,
  testnet-verified).
- The only hard version is a Privy 2-of-2 quorum with Shield co-signing every order: co-custody and a
  liveness dependency, not self-custody. Not built, not claimed. The hard guarantee is the capital vault.

## Privy — Best Financial Flow (unchanged evidence, on v1)
- Wallet `0x83144b99D89947703714Ee9aA3A3614985041D2B`, created by Privy, nonce 4: `registerOwner`
  `0x80c2a48a…`, **$5.00 release → HyperCore** `0x94960d1f…` (block 63581864), `proposeLoosen`
  `0xeeea692a…`. Not used and not claimed: policies, quorums, session signers, Cards, `useFundWallet`.
  Session signers were evaluated and declined on purpose (a Shield session has 0–2 vault signatures).

## Chainlink — Best Confidential Workflow (on v3)
- `handlerInTee` at `cre/shield-risk/main.ts`, `[{ tee: "nitro", regions: ["us-west-2"] }]`.
- Sensitive inputs processed in-enclave: the verifier key **and the user's private ladder** (secret
  `LADDER_<vault>`, mapped in `cre/secrets.yaml`), plus the venue's fills fetched over the TeeRuntime
  HTTP overload. Output: `{tier, ladderHash, nonce, expiry}`; no threshold, no drawdown, no bundle.
- Evidence `docs/evidence/cre-simulate.txt`: run 1 REDUCED verdict signed and relayed on v3
  (`0x089727…`); run 2 a LOCKED vault refused further descent; run 3 broken verifier secret → fails
  before HTTP; run 4 ladder secret withheld → the CLI refuses to run.
- The CRE CLI's login token expired once mid-session ("Credential validation failed… try again in a
  few minutes") and recovered; `cre/shield-risk/dryrun.ts` reproduces the same evaluation without it.
- Still not done: deployment on the CRE network (confidential workflows are invite-only beta).

## The Graph
- **Real rows from two Graph Market providers** (`docs/evidence/substreams-live.txt` §1–2): the
  Sepolia twin's three flows (DEPOSIT $10,000, TOP_UP_INSTANT $1,500, DEPOSIT $80) from
  `sepolia.eth.streamingfast.io:443` and `sepolia.substreams.pinax.network:443`. Reproduce:
  `cd substreams-evm && substreams run shield-evm-behavioral-memory-sepolia-v0.1.0.spkg map_vault_flows -e sepolia.eth.streamingfast.io:443 -s 11654048 -t +12 -o jsonl`.
- The product-chain package (`network: hyper-evm`, filters on the v3 vault) still streams zero rows
  from Pinax: The Graph indexes HyperEVM mainnet only. Solana devnet streams with the same JWT (zero
  rows). The no-token control returns Unauthenticated.
- Both packages decode the v3 events (`RiskTierChanged`, `LadderCommitted`, `LadderChangeProposed`,
  `LadderChangeExecuted`, `RiskVerdictApplied` with `tier`). Both pass `substreams registry verify`.
- Not done: the general `custody-boundary` package split and a `map_signals` module the server consumes
  (research E's second lever). The server still derives behaviour in `server/behaviour.ts`.
- Analyser fix: `server/hyperliquid.ts` now counts `accountClassTransfer` (spot→perps) and `send`
  ledger entries as capital flows, so spot-funded reloads are visible.

## Onboarding (first-use flow, 2026-09-07)
- `app/src/pages/Onboard.tsx` + `app/src/components/Replay.tsx`. Data: `GET /api/hyperliquid/:address?network=mainnet|testnet`
  (`server/hyperliquid.ts`): sessions rebuilt from ledger updates + fills; each session now carries a `timeline`
  (closes as closedPnl−fee, capital in/out with `afterLoss`), `replay` = the reload-while-down followed by the most
  further realised loss, `recommendation` = daily allowance ≈ typical session size, REDUCED ≈ 15% of it, private
  threshold ≈ min(median losing session, 35%), LOCKED ≈ 75%; `counterfactual` = reload split into available/protected.
- The counterfactual only says what Shield would have kept out of the session; the app never states a different outcome.
- Example account `0xfcc9cf78a1494f61d41cf895102a81785a2fe27d` (public, mainnet): 273 sessions, 19 reloads while down,
  replay session opened Thu 5 Feb 12:29, reload $300 at −$43, finished −$848. Verified through the running server.
- Full flow verified on Anvil in the headless browser (entry → analysing → reveal → replay → counterfactual →
  recommendation → local-key sign-in → $250 → vault + ladder commit + faucet + deposit → active → Home). Phone (375)
  and tablet (820) widths: no horizontal overflow on any step.
- Third loop (2026-09-07 evening), all verified in the headless browser on Anvil: "+ Add trading wallet" sheet adds a
  second address and the analysis merges wallets (`/api/hyperliquid/0x…,0x…` → `analyseHyperliquidMany`; example +
  `0x3b8e31fc…` = 408 sessions, 32 reloads while down, worst reload $201 at −$725, finished −$2,172); the analyser caches
  sessions per address for 10 minutes (warm reveal in ~6 s); a no-history address (`0x662148b0…` on mainnet) lands on the
  two-decision baseline ("How much do you usually put into a session?" / "In a bad session, how much should still be
  addable per day?" → Build my baseline); with the history service down the entry screen says "Couldn't reach Shield's
  history service…"; the LOCKED Home reads "Shield stepped in · $0 available until … · You paused new capital yourself."
  Activation registers every added wallet as an execution destination.
- Home was rebuilt around one hierarchy (state, amount available today, one action, session + protection facts,
  details folded); REDUCED renders as "Shield stepped in · $250 ↓ $140"; an over-limit release says "Can't release
  $200. Your current Shield limit is $140 …" with a one-tap "Release $140 instead".

## Tests and toolchain
- `cd contracts && forge test` → **64 passed** (41 invariants, 6 fixed-defect regressions, 2 isolation,
  15 ladder). Compiles with `via_ir`; test helpers use `vm.getBlockTimestamp()` because via_ir treats
  `block.timestamp` as constant within one test transaction.
- `bun test tests/ server/` → **70 passed** (66 + 4 ladder). `bun run typecheck` clean. `bun run build:app` clean.
- Browser flow verified on 998 with the ladder demo vault: Home "Reduced by your plan · release budget
  is $3 until …", Protection "Your bad-session plan" with REDUCED · now, Activity "Moved to REDUCED —
  by your monitor, against the plan you wrote".

## Still open — human decisions
1. Repository is **private**; branch `office-hours` is far ahead of `main`.
2. HyperEVM **mainnet** deploy of v3 (rows on the product chain).
3. Demo video, with the REDUCED beat on a trader-sized vault (needs the testnet drip).
4. `substreams registry publish` both packages; CRE network deploy access.
