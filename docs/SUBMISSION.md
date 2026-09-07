# Shield — ETHOnline 2026 submission

This file is the source of the text pasted into the ETHGlobal form. Sections
labelled **PASTE** are written to be copied verbatim; everything above them is
the evidence those blocks rest on. Every address, hash and block number here
was read back from HyperEVM testnet with `cast` before being written down.

---

## What Shield is

Shield is a self-custodial commitment vault on HyperEVM. The contract is
`ShieldVault.sol`, deployed at **`0xcdB6d631A00857584e70a21d800f51C5776302Fe`**
on **HyperEVM testnet, chain id 998** (deploy tx
`0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc`, block
63561837, deployer `0x05a7a130869a793719BB6B341009ea3B70588DCb`). It has no
owner, no proxy and no upgrade path: once deployed, nobody — including us — can
change the rules or move the money.

**Shield is not a trading venue and does not replace Hyperliquid.** The user
trades on Hyperliquid exactly as they do today. Shield sits behind the trading
account and holds the capital that is not in play, releasing it into the
Hyperliquid perps account only under rules the user wrote while calm. Shield
has no order entry: `app/src/lib/hyperliquid.ts` is a read-only client for
Hyperliquid's public info API, used to show equity, open risk and session
result next to the protected capital.

The asymmetry is the product: **moving toward safety is instant; expanding risk
waits 24 hours.** Lowering a limit, raising the protected floor, or pausing
yourself takes effect in the block it lands in. Raising a limit, lowering the
floor, or leaving Shield entirely becomes a proposal the contract holds — 24
hours for a rule change, 7 days for a full exit — and the user must come back
and positively confirm it afterwards. Any tightening in the meantime bumps
`configVersion` and invalidates every pending loosening (`ShieldVault.sol:689`,
`ProposalStale`), so tilt cannot pre-load an escape hatch during a calm hour.

## Who it is for

A 19-year-old who trades perps on their phone. They are not going to lose their
money to a hack; they are going to lose it in the ten minutes after a red
session, sending one more deposit to win it back. Every wallet ever built will
sign that deposit. Nothing in the stack asks whether the person who set out the
week's plan would have. Shield is the thing that asks — not with a modal that a
tilted person clicks through, but with a contract that will not execute the
transfer until tomorrow.

When a top-up is refused, it is the chain refusing, not the app: the
transaction reverts with `CooldownActive`, `ProtectedFloorBreached` or
`VelocityThresholdExceeded`, and anyone can read that.

## What the contract actually enforces

Read `contracts/src/ShieldVault.sol`; verified by 41 Foundry tests
(`cd contracts && forge test` → 41 passed; `forge install foundry-rs/forge-std --no-git` first).

- **Protected floor.** A balance the vault will not release for trading at all.
- **Rolling 24h release limit,** accumulated across six 4-hour buckets
  (`NUM_VELOCITY_BUCKETS = 6`, `BUCKET_LEN_SECS = 4 hours`), so four $500
  releases are one $2,000 release. Splitting does not defeat it.
- **Large-move pause.** A release at or above a share of the vault balance the
  user chose (`topUpThresholdBps`) cannot be instant: `instantTopUp` reverts
  with `AmountRequiresGatedTopUp` and it must go through `proposeTopUp` /
  `executeTopUp`, which matures after the user's `topUpCooldownSecs`
  (default 30 minutes).
- **Cooldowns.** Self-pause (up to 30 days) and a loss cooldown armed by a
  signed risk verdict.
- **Registered destinations only.** Each destination is registered once with a
  permanent kind — execution (trading) or cold — so a tilted user cannot
  re-point "cold withdrawal" at an exchange.
- **Safety valve that stays open.** Cold-wallet transfers up to the user's own
  emergency cap are never gated by a cooldown or by a risk verdict
  (`instantColdTransfer`, line 585); the protected floor and the 24h limit
  still apply.
- **Delivery into Hyperliquid.** A permitted release to a `ROUTE_HYPERCORE`
  destination is delivered by the contract itself into that address's
  Hyperliquid perps account through Circle's
  `CoreDepositWallet.depositFor` (`0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206`),
  in the same transaction. USDC is `0x2B3370eE501B4a559b57D449569354196457D8Ab`.

## Tracks entered

Shield enters **three** tracks:

1. **Privy — Best Financial Flow ($2,500)**
2. **Chainlink — Best Confidential Workflow ($2,000)**
3. **The Graph — Best Use of Composable or Standardized Graph Products ($5,000)**, pool: **Start Fresh** (first commit 2026-09-04, after the event opened)

Shield does **not** enter:

- **Chainlink — Best Chainlink-Powered Upgrade (Continuity, $500):** that track
  requires improving an existing project. Shield is net-new, so there is
  nothing for the integration to have improved. Not claimable, not claimed.
- **Privy — Best B2B Financial Product ($2,500):** that track needs Privy's
  control primitives (policies, quorums, session signers) and a B2B use case.
  Shield uses none of them and is consumer-facing. The "calm-you sets policy
  for tilted-you" framing is enforced in Solidity, not in Privy policy, so
  claiming this track would be false.
- **The Graph — AI tracks ($5,000 each):** there is no AI in the shipped
  product. `docs/AI_USAGE.md` describes AI writing the repository, which is a
  different thing and not a basis for the track.

---

## Privy — Best Financial Flow

**The criterion:** "Integrate Privy as a core part of the product", "Create or
use at least one Privy wallet", "Complete at least one functional financial
flow using a generally available Privy feature", "Clearly explain how Privy
improves the user experience".

**How Privy is core.** The Privy embedded wallet is not a login for Shield —
it is the vault's **authority**. `ShieldVault._own()` (line 630) reverts for
every address except the authority, so this wallet is the only thing on earth
that can deposit into, release from, tighten, loosen or exit that vault. The
wallet is created by Privy on login with
`embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } }`
(`app/src/lib/privy.tsx:67`); the app takes its EIP-1193 provider
(`app/src/lib/privy.tsx:42`) and signs vault transactions through it
(`app/src/lib/evm-engine.ts:185`).

**The wallet:** `0x83144b99D89947703714Ee9aA3A3614985041D2B` — created from an
email address, no seed phrase, no extension. Its nonce on chain is **4**: it
signed four transactions itself.

**The financial flow (a $5.00 release from the vault into a Hyperliquid perps
account), one transaction:**
`0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be`, block
63581864, status 1, `from` = the Privy wallet, `to` = the vault. Its six logs,
read back from the chain:

1. USDC `Approval`, vault → CoreDepositWallet, 5,000,000 (6 decimals = $5.00)
2. USDC `Transfer`, vault → CoreDepositWallet, $5.00
3. `Transfer`, CoreDepositWallet → HyperCore system address
   `0x2000000000000000000000000000000000000000`
4. HyperCore's own event on `0x3333…3333` carrying the credit
5. A HyperCore credit of $5.00 to the registered Hyperliquid account
   `0x05a7a130869a793719BB6B341009ea3B70588DCb`
6. `TopUpExecuted(amount = $5.00, instant = true, balanceAfter = $45, route = 1)`

That is one signature by a Privy embedded wallet turning into stablecoin
actually landing in a trading account on a venue, with the vault's rules
checked in between.

**Supporting transactions, same wallet, same session, both verified on chain:**

- `registerOwner` — the Hyperliquid account is pinned as the only execution
  destination: `0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0`, block 63581683
- `proposeLoosen` — a weakening (daily release $5 → $100) that the contract
  holds for 24 hours and then re-asks:
  `0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85`, block 63581938

**Why Privy improves the experience.** Shield's premise is that the protected
capital should be hard for future-you to reach. Without Privy, the only way in
is a raw private key or a browser extension — a seed-phrase ceremony that the
exact user we are building for (young, phone-first, already trading) is least
likely to complete and most likely to screenshot. With Privy: type an email,
get a code, and the wallet that guards the money exists. The vault stays
self-custodial and the recovery story stays Privy's, not ours.

**Not claimed:** Privy policies, quorums, session signers, Cards and
`useFundWallet` are not used anywhere in the code and are not claimed.

---

## Chainlink — Best Confidential Workflow

**The criterion:** "The workflow must register and use a confidential TEE
handler, such as handlerInTee", "The confidential portion must process at least
one sensitive input, secret, confidential API response, private parameter",
"meaningfully integrated into the project's core functionality", "Demonstrate
successful execution through simulation using the CRE CLI or live deployment",
"Provide evidence of successful simulation or deployment".

**The handler.** `handlerInTee` is imported from `@chainlink/cre-sdk` and
registered at `cre/shield-risk/main.ts:88` with
`[{ tee: "nitro", regions: ["us-west-2"] }]`. The entire risk evaluation runs
inside it.

**The sensitive input inside the enclave** is the **verifier private key**,
read in-enclave via `runtime.getSecret({ id })` at
`cre/shield-risk/evaluate.ts:89` and mapped in `cre/secrets.yaml`. That key
never leaves the TEE; what leaves is one EIP-712 signature. This is the clause
the track asks for. To be explicit about what is *not* confidential: the
capital-flow inputs are fetched over plain HTTP from Shield's local endpoint
and are on-chain anyway, so we do not claim the flows are private — the secret
and the signing are.

**Simulation, run with the CRE CLI and reproduced.** Verbatim transcript at
`docs/evidence/cre-simulate.txt`. Command, from the repository root:

```
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
  -R cre -e cre/.env
```

The CLI prints the TEE placement — "Trigger requested TEE Execution … AWS Nitro
in us-west-2" — evaluates the vault inside the handler
(`realisedLoss24h=3500000 trigger=3000000 triggered=true`) and ends
"Simulation complete!". That run returned `actionable: false` and an empty
signature for an honest reason we state rather than hide: it ran at
2026-09-06T22:59Z, 33 minutes *after* verdict #1 had already landed on chain
for that vault, and the contract rejects a replayed nonce, so the workflow
correctly declined to sign a second one.

**The on-chain result, verified log by log.** The same evaluation path, run
while verdict #1 was still unused, signed an EIP-712 verdict that the deployed
contract accepted: tx
**`0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35`**, block
63584417, status 1, emitting
`RiskVerdictApplied(vault=0x751D1e26…, nonce=1, reasonCode=1,
realizedLossUsdc=3500000, cooldownUntil=1788776770, extended=true,
evidenceHash=0x4c7946…918b)`. Vault state afterwards: `cooldownReason = 2`
(RISK_VERDICT), `lastVerdictNonce = 1`. `applyRiskVerdict` is permissionless —
anyone may relay the signed verdict; only the signature matters.

**Why the confidential part is bounded, and why that matters more than the
prize.** The monitor is the vault's only external input, and it was written so
that a compromised monitor cannot hurt the user. Verified in Solidity at
`ShieldVault.sol:536-558` and tested at `contracts/test/ShieldVault.t.sol:259-261`:

- A verdict carries **no** duration, floor, limit or destination. The pause
  length is the user's own `lossCooldownSecs`.
- `cooldownUntil` only ever moves **forward**. A verdict can never shorten a
  pause, and never supersedes a pending proposal.
- A verdict below the user's own `lossTriggerUsdc` is rejected
  (`VerdictBelowLossTrigger`), as is a replayed nonce (`VerdictReplayed`) or an
  expired one (`VerdictExpired`).
- Cold-wallet transfers and full exit are never gated by a verdict.
- Worst case is bounded by `MAX_LOSS_COOLDOWN_SECS = 30 days`.

The enclave supplies a number and evidence. The user's own rule supplies the
consequence.

---

## The Graph — Best Use of Composable or Standardized Graph Products

**The criterion:** "Either compose two or more of The Graph's products, or
build meaningfully on a standardized schema", "Consume live data from a Graph
provider, for example … The Graph Market for Substreams", "Simply querying one
Subgraph with no composition or standardization does not qualify",
"contributing a reusable composable Substreams module is in scope", "Make the
standards leverage clear".

**The composition.** `substreams-evm/` builds
`shield-evm-behavioral-memory-v0.1.0.spkg` (committed to the repo), five
modules deep: `map_shield_events` → `store_vault_registry` → `map_vault_flows`
→ `store_flow_totals` → `map_behavioral_profiles`. It **imports The Graph's
foundational `ethereum-common@v0.3.3`** and declares that package's
`index_events` module as the `blockFilter` for both maps, keyed on the vault
address and native USDC (`substreams-evm/substreams.yaml:9,51-52,76-77`). The
provider therefore skips every block that carries no relevant log before any of
our WASM runs. `substreams info` prints the populated filter query.

**What became easier because of the shared standard.** We never wrote a log
scanner. `ethereum-common`'s block index does the address filtering, so our
package only contains the part that is actually Shield's: decoding
`TopUpExecuted` / `RiskVerdictApplied` / policy events into typed protobuf,
detecting USDC coming *back* from the venue, and classifying every flow across
the vault boundary into the totals the loss rule reads. The same pipeline shape —
typed decoding, registry store, flows, totals, profiles — is also what the
Solana implementation in `substreams/` exposes (it adds instruction decoding,
seven modules in total), and both packages emit `map_vault_flows`. One config
resolves either stack (`server/substreams-config.ts`), one consumer streams it
(`server/substreams-source.ts`), and `server/behaviour.ts`, `server/policy.ts`
and the CRE workflow read the result without a line of change.

**Live consumption from a Graph provider, with the limitation stated in the
same breath.** `docs/evidence/substreams-live.txt` is the transcript of the
full stateful pipeline (`map_vault_flows`) streamed against
`hyperevm.substreams.pinax.network:443`, a provider on The Graph Market, with a
Graph Market JWT valid to 2027-10-28; it processes 620 blocks and ends
"Completed successfully". **It returns no rows, and here is why: The Graph
indexes HyperEVM mainnet (chain 999) only — there is no HyperEVM testnet entry
in its networks registry — and the deployed vault is on testnet (chain 998).**
The composition, the authentication and the whole module graph run live; the
addresses have nothing to match. Because of that, the running server reports
`source.mode: "rpc"` and serves the identical flow classification from
`server/rpc-source.ts`, and `/api/health` says so in plain words:
`substreamsAvailable: "no: The Graph indexes HyperEVM mainnet only"`
(`server/evm-index.ts:549`). Deploying the same immutable contract to HyperEVM
mainnet is what turns those zero rows into data; nothing else about the
pipeline changes.

We would rather be marked down for a qualified claim than have a judge
discover this themselves.

---

## How a judge verifies any of this in five minutes

**There is no public block explorer that indexes HyperEVM testnet.** We
checked: `explore-testnet.hyperpc.app` reports "unable to locate this
transaction hash" and shows the vault as an EOA with zero transactions;
`app.hyperliquid-testnet.xyz/explorer` renders blank; `testnet.purrsec.com`
404s; `testnet.hyperevmscan.io` does not resolve. Linking any of them would
make our own evidence look fabricated. The verifiable form is an RPC call:

```bash
RPC=https://rpc.hyperliquid-testnet.xyz/evm

# the deployment, chain id 998 (0x3e6), contract creation, no owner
cast receipt 0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc --rpc-url $RPC

# Privy embedded wallet: 4 transactions signed by it
cast nonce 0x83144b99D89947703714Ee9aA3A3614985041D2B --rpc-url $RPC

# the $5.00 release, Privy wallet -> vault -> CoreDepositWallet -> HyperCore
cast receipt 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be --rpc-url $RPC

# the CRE verdict, RiskVerdictApplied(nonce=1, realizedLossUsdc=3500000)
cast receipt 0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35 --rpc-url $RPC

# live vault state
cast call 0xcdB6d631A00857584e70a21d800f51C5776302Fe \
  "getVault(address)" 0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006 --rpc-url $RPC
```

Off-chain: `cd contracts && forge test` (41 passed),
`docs/evidence/cre-simulate.txt`, `docs/evidence/substreams-live.txt`.

Live vaults on chain id 998, all on the one contract:

| Authority | What it is | State |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | demo vault | $600 balance, $500 floor, $100 per 24h, $700 deposited, $100 released, verdict #1 applied |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | the Privy embedded wallet | $45 balance, $10 floor, $50 deposited, $5 released to HyperCore |
| `0x751D1e26d79FeffE95F8a8662aB7A022780ED023` | the CRE demo vault | $21 balance, $3 loss trigger, 12h cooldown, verdict #1 applied |

---

# PASTE — one-line description

```
Shield is a self-custodial commitment vault on HyperEVM: calm-you sets the rules for the capital behind your Hyperliquid account, and tilted-you can tighten them instantly but cannot loosen them for 24 hours.
```

# PASTE — short description

```
Young traders do not lose their money to hacks. They lose it in the ten minutes after a red session, sending one more deposit to win it back. Every wallet will sign that deposit; nothing asks whether the person who made the week's plan would have.

Shield is a self-custodial commitment vault deployed at 0xcdB6d631A00857584e70a21d800f51C5776302Fe on HyperEVM testnet (chain id 998), with no owner, no proxy and no upgrade path. It is not a trading venue and does not replace Hyperliquid: you trade on Hyperliquid exactly as you do now, and Shield holds the capital behind the account, releasing it under rules you wrote while calm — a protected floor, a rolling 24-hour limit that splitting cannot defeat, a pause on large moves, and a loss rule fed by what actually came back from the venue.

The asymmetry is the whole product. Moving toward safety is instant: lower a limit, raise the floor, pause yourself, and it takes effect in that block. Expanding risk waits 24 hours and has to be confirmed again afterwards, and any tightening in between cancels it. Leaving Shield entirely waits 7 days. Emergency transfers to your own cold wallet, up to a cap you set yourself, are never blocked by a cooldown or by the risk monitor.

You sign in with an email through Privy, and the embedded wallet it creates is the vault's only authority — the contract reverts for every other address. When a top-up is refused it is the chain refusing, not the app: the transaction reverts with CooldownActive or ProtectedFloorBreached, and anyone can read it.
```

# PASTE — how it's made (technical)

```
Contract. ShieldVault.sol at 0xcdB6d631A00857584e70a21d800f51C5776302Fe on HyperEVM testnet, chain id 998 (deploy tx 0x67ffb6531f406758758adb98fb81008f1888e6793b9a39fb79bde9ee6df66ebc, block 63561837). Immutable: no owner, no proxy, no upgrade path. One contract, many vaults, keyed by authority address. Money leaves through five paths only — instant top-up, matured top-up, instant cold transfer under the user's emergency cap, matured cold transfer, matured full exit — each gated by a protected floor, a rolling 24h limit accumulated over six 4-hour buckets, a large-move threshold, and cooldowns. Destinations are registered once with a permanent kind (execution or cold). Tightening applies instantly and bumps configVersion, which marks every pending loosening stale, so tilt cannot pre-load an escape. A permitted release to a HyperCore destination is delivered by the contract into that address's Hyperliquid perps account through Circle's CoreDepositWallet.depositFor in the same transaction. 41 Foundry tests (cd contracts && forge test).

Privy (Best Financial Flow). The embedded wallet is the vault authority, not a login: ShieldVault._own() reverts for every other address. Created on login with createOnLogin: "users-without-wallets" (app/src/lib/privy.tsx:67); the app signs through its EIP-1193 provider. Wallet 0x83144b99D89947703714Ee9aA3A3614985041D2B, nonce 4 on chain. The financial flow is a $5.00 release from the vault into a Hyperliquid perps account in one transaction: 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be (block 63581864) — USDC approval and transfer from the vault to CoreDepositWallet, on to the HyperCore system address 0x2000...0000, a $5.00 HyperCore credit to the registered account, and TopUpExecuted(amount=$5, instant=true, balanceAfter=$45). Supporting transactions from the same wallet: registerOwner 0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0 (block 63581683) and proposeLoosen 0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85 (block 63581938), the second of which the contract holds for 24 hours. Privy policies, quorums, session signers and Cards are not used and are not claimed.

Chainlink CRE (Best Confidential Workflow). handlerInTee from @chainlink/cre-sdk is registered at cre/shield-risk/main.ts:88 with [{ tee: "nitro", regions: ["us-west-2"] }], and the whole risk evaluation runs inside it. The sensitive input is the verifier private key, read in-enclave with runtime.getSecret (cre/shield-risk/evaluate.ts:89, mapped in cre/secrets.yaml) and used to produce an EIP-712 signature; the key never leaves the enclave. We do not claim the capital flows are confidential — they are on-chain data fetched over plain HTTP. Simulated with the CRE CLI and reproduced; the verbatim transcript is docs/evidence/cre-simulate.txt, showing "AWS Nitro in us-west-2", the in-enclave evaluation (realised loss $3.50 against a $3.00 trigger) and "Simulation complete!". On chain, the same evaluation path signed verdict #1 and the deployed contract accepted it: 0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35, block 63584417, RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=3500000, extended=true). The verdict is deliberately weak by design (ShieldVault.sol:536-558): it carries no duration, floor, limit or destination; cooldownUntil only moves forward; a verdict below the user's own lossTriggerUsdc is rejected; nonces cannot be replayed; cold transfers and full exit are never gated by it; worst case is bounded by MAX_LOSS_COOLDOWN_SECS = 30 days. The enclave supplies a number, the user's own rule supplies the consequence.

The Graph (Composable / Standardized Products). substreams-evm/ builds shield-evm-behavioral-memory-v0.1.0.spkg, committed to the repo: five modules (map_shield_events, store_vault_registry, map_vault_flows, store_flow_totals, map_behavioral_profiles) composed on The Graph's foundational ethereum-common@v0.3.3, whose index_events module is the declared blockFilter for both maps, keyed on the vault and native USDC. That is the standards leverage: we never wrote a log scanner, so the package contains only Shield's own part — typed event decoding, detection of USDC returning from the venue, and flow classification across the vault boundary into the totals the loss rule reads. The same pipeline shape is what the Solana implementation in substreams/ exposes (seven modules there, with instruction decoding added), and both packages emit map_vault_flows: one config resolves either stack (server/substreams-config.ts), one consumer streams it (server/substreams-source.ts), and server/behaviour.ts, server/policy.ts and the CRE workflow read the result unchanged. Live consumption is proven in docs/evidence/substreams-live.txt: the full stateful pipeline streamed from hyperevm.substreams.pinax.network:443, a provider on The Graph Market, 620 blocks processed, "Completed successfully". Honest limitation, stated up front: that run emits no rows, because The Graph indexes HyperEVM mainnet (999) only — there is no testnet entry in the networks registry — and the vault is on testnet (998). The server therefore runs on the labelled RPC fallback (server/rpc-source.ts) with identical classification, and /api/health says so: substreamsAvailable: "no: The Graph indexes HyperEVM mainnet only". Deploying the same immutable contract to HyperEVM mainnet turns those zero rows into data; nothing else in the pipeline changes.

Rest of the stack. Server: Bun — indexer (Substreams or the labelled RPC fallback), behaviour engine (sessions, realised loss, loss streaks, reload-after-loss), policy, EIP-712 verdict relayer, JSON API. App: React + Vite — Welcome, Setup, Overview, Top-up (instant / scheduled / blocked, showing the on-chain rejection and a live countdown), Behaviour, Protection, Activity. Hyperliquid: read-only info API client (app/src/lib/hyperliquid.ts, server/hyperliquid.ts) for equity, positions, fills and session PnL; Shield has no order entry by design. There is no public explorer for HyperEVM testnet, so every claim above is verified with cast against https://rpc.hyperliquid-testnet.xyz/evm.
```

---

## What this submission does not claim

Stated here so a judge does not have to find it:

- **No AI in the product.** The AI tracks are not entered.
- **No Privy policies, quorums, session signers, Cards or `useFundWallet`.**
  The B2B track is not entered.
- **No Chainlink Continuity claim.** Shield is net-new.
- **The Graph pipeline returns no rows today** because the vault is on HyperEVM
  testnet and The Graph indexes HyperEVM mainnet only. Stated wherever the
  Graph claim is made.
- **No traction.** No users, no revenue, no letters of intent. Built inside the
  hackathon window; first commit 2026-09-04.
- **No block explorer links,** because none of them index HyperEVM testnet.
  Every hash above is verifiable by RPC.
