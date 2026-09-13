# Shield — ETHOnline 2026 submission

This file is the source of the text pasted into the ETHGlobal form. Sections
labelled **PASTE** are written to be copied verbatim; everything above them is
the evidence those blocks rest on. Every address, hash and block number here
was read back from HyperEVM testnet with `cast` before being written down.

---

## What Shield is

Shield is a self-custodial commitment vault on HyperEVM. The contract is
`ShieldVault.sol` v3, deployed at **`0xDaA8B6a85391d54397c3847F006a49A16d0F37b3`**
on **HyperEVM testnet, chain id 998** (deploy tx
`0x70a98bffe313a28fcdc9d0989ea691ca3c3e6dedf0bcc2b454d107292176234b`, block
63634061, deployer `0x05a7a130869a793719BB6B341009ea3B70588DCb`; `VERSION()` reads 3).
v3 adds the **risk ladder**: NORMAL / REDUCED / LOCKED, written while calm; a
verifier verdict can only move a vault down it, to a rung the user pre-wrote;
the threshold that selects REDUCED is private (salted hash on chain, plaintext
only in the Chainlink enclave); moving back up early waits and must be
reconfirmed. v1 and v2 are superseded and stay on chain as history. It has no
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

A trader whose own fill history shows the pattern: a losing session, then
another deposit within the hour. They are not going to lose their money to a
hack; they are going to lose it in the ten minutes after a red session,
sending one more deposit to win it back. Every wallet ever built will sign
that deposit. Nothing in the stack asks whether the person who set out the
week's plan would have. Shield is the thing that asks — not with a modal that a
tilted person clicks through, but with a contract that will not execute the
transfer until tomorrow.

We do not have to argue that this is the pattern, because setup shows the user
their own copy of it. Step 0 asks for the Hyperliquid account they trade from
and reads its public history before proposing a single rule — ledger updates
and fills from Hyperliquid's info API, no credentials (`server/hyperliquid.ts`).
It groups the history into sessions, takes realised PnL from the venue's own
`closedPnl` minus fees, and puts four of the user's own numbers on the screen:
sessions, typical session size (the median of what they deployed), largest
losing session, and how many sessions included a reload made while already
down. Above them is one sentence generated from the same data, of the form
"3 of your 4 largest losing sessions involved another reload." The rules are
then proposed from those numbers rather than from a template
(`app/src/pages/Setup.tsx`): the median session size becomes the suggested
bankroll, and the loss trigger, the daily limit, the pause length and the
large-move threshold follow from it and from what the history actually shows.
The user can change any of them, and an account with no history says so and
starts from defaults.

When a top-up is refused, it is the chain refusing, not the app: the
transaction reverts with `CooldownActive`, `ProtectedFloorBreached` or
`VelocityThresholdExceeded`, and anyone can read that.

## Why this cannot be a venue feature

Any venue or wallet could build this in a week. A sub-account and an
`unlockAfter` timestamp is a sprint of work, and we would not claim otherwise.
None of them can build it credibly, and the reason is not technical.

A venue that holds a customer's money against that customer's stated wish owns
a liability, and therefore has to build an appeals path: a support queue, an
override, an exception for the good customer. Every self-exclusion scheme ever
shipped by an operator also shipped a way to lift it — and an appeals path is
exactly what defeats a commitment device, because the device works only while
the answer is no. Shield's advantage is that there is nobody to ask: no owner,
no admin, no support queue, and no address anywhere that can grant an
exception, including ours. Neither a venue nor a wallet vendor can offer that,
because both of them answer to you.

That is why the rules are enforced in Solidity rather than in any vendor's
policy engine, Privy's included: **calm-you sets policy for tilted-you, and a
policy the vendor can change on request is not a policy tilted-you has to live
with.**

The shape of those rules is not invented either. Instant to tighten, delayed
to loosen, with a positive reconfirmation at the end of the delay, is what
gambling regulators across 30 European countries converged on, and it is
specified almost word for word by UK Gambling Commission RTS 12D. The
literature behind that choice — and the honest caveat that limit-setting has
weak evidence of changing outcomes — is set out with citations in
`docs/JUDGE_QA.md` ("Why these delays, and does any of this work?").

## What the contract actually enforces

Read `contracts/src/ShieldVault.sol`; verified by 64 Foundry tests
(`cd contracts && forge test` → 64 passed; `forge install foundry-rs/forge-std --no-git` first):
41 invariants, 6 regressions in `contracts/test/FixedDefects.t.sol` for the three
v1 defects, 2 in `contracts/test/Isolation.t.sol` for reentrancy and registry
isolation, and 15 in `contracts/test/Ladder.t.sol` for the v3 risk ladder.

- **The risk ladder (v3).** Three rungs the user writes while calm. REDUCED
  lowers the 24h release budget to a pre-written allowance and expires on the
  user's clock; LOCKED is the loss cooldown. A verdict may only descend the
  ladder, only against the committed ladder hash, and never to NORMAL; the user
  can drop a rung instantly and climb back only after the delay with a
  reconfirmation. The drawdown threshold that selects REDUCED is never on chain.
- **Protected floor.** A balance the vault will not release for trading at all.
- **Rolling 24h release limit,** accumulated across six 4-hour buckets
  (`NUM_VELOCITY_BUCKETS = 6`, `BUCKET_LEN_SECS = 4 hours`), so four $500
  releases inside one active window are one $2,000 release. In v1 this limit
  could be exceeded two ways — an idle gap re-zeroed the accumulator on every
  call ($6,000 released in one block against $1,000/24h, measured), and
  cancelling an aged proposal erased unrelated spend. Both are fixed in v2 and
  pinned as regressions; the **protected floor** (a separate check on
  `balance - amount`) was never affected and remains the deeper backstop.
  Full write-up: `docs/THREAT_MODEL.md`, Known gaps 1–3.
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
  Shield uses none of them and is consumer-facing. As set out above, the
  "calm-you sets policy for tilted-you" framing is enforced in Solidity by
  design, not in Privy policy, so claiming this track would be false.
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
cre workflow simulate shield-risk --target evm-dry-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
  -R cre -e cre/.env
```

`evm-dry-settings` is `evm-settings` with `deliver: false`, so the workflow runs
end to end without broadcasting a verdict. Use `evm-settings` to actually relay.

The transcript contains **two runs**. The first prints the TEE placement —
"Trigger requested TEE Execution … AWS Nitro in us-west-2" — evaluates the vault
inside the handler and ends "Simulation complete!". It reports
`realisedLoss24h=0 … triggered=false`, and that is the correct answer: the
enclave reads the venue's own settled PnL as well as the vault's flows, and
Hyperliquid settled this account flat over the window, so there is no loss to
attest and nothing to sign.

The second run is the one that matters for the criterion. It is the identical
command with `SHIELD_EVM_VERIFIER_KEY` set to `0xdeadbeef`, and it fails:

```
✗ workflow execution failed: EVM verifier secret must be a 0x-prefixed 32-byte private key
```

The handler reads that secret as the first statement of `evaluateVault` and
validates it before any HTTP call or any evaluation, so a wrong value stops the
workflow before it can do anything else. That is the difference between a secret
being present and a secret being load-bearing, and it costs nothing to
reproduce.

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
the vault boundary into the totals the Behaviour screen renders and the loss
rule falls back on. The same pipeline shape —
typed decoding, registry store, flows, totals, profiles — is also what the
Solana implementation in `substreams/` exposes (it adds instruction decoding,
seven modules in total), and both packages emit `map_vault_flows`. One config
resolves either stack (`server/substreams-config.ts`), one consumer streams it
(`server/substreams-source.ts`), and `server/behaviour.ts`, `server/policy.ts`
and the CRE workflow read the result without a line of change.

**Live consumption from a Graph provider, and the server reading it.**
`docs/evidence/substreams-live.txt` §1–2: the full stateful pipeline
(`map_vault_flows`) streamed against **two** Graph Market providers,
`sepolia.eth.streamingfast.io:443` and `sepolia.substreams.pinax.network:443`,
with a Graph Market JWT valid to 2027-10-28, returning the same three
classified rows from each — a $10,000 deposit, a $1,500 release to the
registered trading wallet, and $80 returning from that wallet. They come from a
**Sepolia twin of the same `ShieldVault` bytecode**
(`0xf1ef03Ea258EF652939bAC0250d1CDe9B5EF4f6A`, block 11654048) carrying a real
staged history. §6 is the server consuming them: `source.mode: "substreams"`,
connected at live head, `/api/vault/<authority>/flows` served with
`source: "substreams"`, and the vault discovered from the stream by
`store_vault_registry` with no RPC log scan on that chain.

**The limitation, in the same breath.** The package aimed at the *product*
chain streams, authenticates and completes, and returns zero rows: The Graph
indexes HyperEVM mainnet (chain 999) only — there is no HyperEVM testnet entry
in its networks registry — and the product vault is on testnet (chain 998)
(§3). There, Shield reports `source.mode: "rpc"` and serves the identical flow
classification from `server/rpc-source.ts`, and `/api/health` says why in plain
words. Deploying the same immutable contract to HyperEVM mainnet is what turns
those zero rows into data; nothing else about the pipeline changes.

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
cast call 0xDaA8B6a85391d54397c3847F006a49A16d0F37b3 \
  "currentTier(address)(uint8)" 0xaA8cfBd03CD4e043228bCCe42b5adD98866F7D8b --rpc-url $RPC   # 1 = REDUCED
```

Off-chain: `cd contracts && forge test` (64 passed: 41 invariants, 6 fixed-defect regressions, 2 isolation, 15 ladder),
`docs/evidence/cre-simulate.txt`, `docs/evidence/substreams-live.txt`.

Live vaults on chain id 998, all on the one contract:

| Authority | What it is | State |
|---|---|---|
| `0x9872f09D96bcA7f878CEe9c4bDc8bCcA269dB006` | demo vault (v3) | $60 balance, $40 floor, $12 per 24h, $7 loss trigger, 12h; ladder committed (REDUCED budget $5) |
| `0x751D1e26d79FeffE95F8a8662aB7A022780ED023` | the CRE demo vault (v3) | $10, $3 loss trigger; LOCKED today by the public rule after the trading account's real $7.35 loss (`0xd62796c5…`) |
| `0xaA8cfBd03CD4e043228bCCe42b5adD98866F7D8b` | the ladder demo vault (v3) | $5, $4/day; released $2.50 at NORMAL; **REDUCED by the enclave** against its private ladder (tx `0x089727…`), budget now $3 |
| `0x83144b99D89947703714Ee9aA3A3614985041D2B` | the Privy embedded wallet | its v1 vault: $45 balance, $10 floor, $50 deposited, $5 released to HyperCore (txs above). Holds $20 test USDC + 0.3 HYPE for an on-camera deposit on v3 |

---

# PASTE — links

```
Live demo   https://palenque-sigma.vercel.app/start?a=0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea
            (bare form, to analyse any address: https://palenque-sigma.vercel.app/start)
Repository  https://github.com/Oliverknowledge/shielder
Contract    0xDaA8B6a85391d54397c3847F006a49A16d0F37b3 (HyperEVM testnet, chain 998, VERSION() = 3)
```

**Judges: the fastest way to see what this is.** Open the live demo link above.
It needs no clicks — the address is in the URL, and the analysis runs on
arrival. Then press "Replay what happened" and "Show where Shield steps in".
To point it at any Hyperliquid mainnet account, including your own, use
https://palenque-sigma.vercel.app/start or append `?a=0x…`. No wallet, no
signature, no deposit, nothing to install. It reads that account's public
history from Hyperliquid's info API and shows the pattern the product exists
for, replayed from the trader's own fills.

---

# PASTE — one-line description

```
Shield is a self-custodial commitment vault on HyperEVM: calm-you sets the rules for the capital behind your Hyperliquid account, and tilted-you can tighten them instantly but cannot loosen them for 24 hours.
```

# PASTE — short description

```
Traders do not lose their money to hacks. They lose it in the ten minutes after a red session, sending one more deposit to win it back. Every wallet will sign that deposit; nothing asks whether the person who made the week's plan would have.

You can check that claim against a stranger in twenty seconds, before you read another word. Open https://palenque-sigma.vercel.app/start?a=0x92a7bc9b107bdd35e3db97dc171d5a8c1ee33fea — no clicks, the analysis runs on arrival. It is a real Hyperliquid mainnet trader, read live from the venue's own public records: they were down $1,302 when they added another $13,894. Fifty-seven minutes later their realised session loss had grown to $53,485. The session finished at -$117,089. Shield then replays that session as a line, marks the exact moment of the reload, and shows what the rules it would have proposed — from that trader's own numbers, not a template — would have released instead: $3,750, not $13,894, leaving $10,144 protected. It also says, on that same screen, that it could not have undone the loss and cannot know what those trades would have done with less capital. Paste your own address and it does the same to you. No wallet, no signature, no deposit.

Shield does not have to argue that this is the pattern. Setup reads your real Hyperliquid history before it proposes a single rule and shows you your own numbers — how many sessions you have had, your typical session size, your largest losing session, and how many sessions included a reload made while you were already down — with one sentence generated from the same data: "3 of your 4 largest losing sessions involved another reload." Your rules are then proposed from those numbers, not from a template.

Shield is a self-custodial commitment vault deployed at 0xDaA8B6a85391d54397c3847F006a49A16d0F37b3 on HyperEVM testnet (chain id 998), with no owner, no proxy and no upgrade path. It is not a trading venue and does not replace Hyperliquid: you trade on Hyperliquid exactly as you do now, and Shield holds the capital behind the account, releasing it under rules you wrote while calm — a protected floor, a rolling 24-hour release limit, a pause on large moves, and a loss rule that reads the venue's own settled PnL where the venue answers, and what came back from it where it does not.

The asymmetry is the whole product. Moving toward safety is instant: lower a limit, raise the floor, pause yourself, and it takes effect in that block. Expanding risk waits 24 hours and has to be confirmed again afterwards, and any tightening in between cancels it. Leaving Shield entirely waits 7 days. Emergency transfers to your own cold wallet, up to a cap you set yourself, are never blocked by a cooldown or by the risk monitor. That shape is not invented: instant to tighten, delayed to loosen, with a confirmation at the end of the wait, is what gambling regulators across 30 European countries converged on, and is specified almost word for word by UK Gambling Commission RTS 12D.

Any venue or wallet could build this in a week. None of them can build it credibly, because a venue that holds your money against your own stated wish owns a liability, and so has to build an appeals path — and an appeals path is exactly what defeats a commitment device. Shield's advantage is not technical: there is nobody to ask. No owner, no admin, no support queue. Neither a venue nor a wallet vendor can offer that, because both of them answer to you.

You sign in with an email through Privy, and the embedded wallet it creates is the vault's only authority — the contract reverts for every other address. When a top-up is refused it is the chain refusing, not the app: the transaction reverts with CooldownActive or ProtectedFloorBreached, and anyone can read it.
```

# PASTE — how it's made (technical)

```
Contract. ShieldVault.sol v3 at 0xDaA8B6a85391d54397c3847F006a49A16d0F37b3 on HyperEVM testnet, chain id 998 (deploy tx 0x70a98bffe313a28fcdc9d0989ea691ca3c3e6dedf0bcc2b454d107292176234b, block 63634061; VERSION() = 3). v3 adds a risk ladder (NORMAL / REDUCED / LOCKED): the reload budget ratchets down with the session under rules the user wrote while calm; the verifier may only descend it; the selecting threshold is a salted hash on chain and a secret in the enclave. Immutable: no owner, no proxy, no upgrade path. One contract, many vaults, keyed by authority address. Money leaves through five paths only — instant top-up, matured top-up, instant cold transfer under the user's emergency cap, matured cold transfer, matured full exit — each gated by a protected floor, a rolling 24h limit accumulated over six 4-hour buckets, a large-move threshold, and cooldowns. v1 of this contract had three defects our own gauntlet found (an idle gap re-zeroed the 24h accumulator; an aged cancellation erased unrelated spend; self-set delays were unbounded); v2 fixes all three and contracts/test/FixedDefects.t.sol pins them as regressions (docs/THREAT_MODEL.md, Known gaps 1–3). Destinations are registered once with a permanent kind (execution or cold). Tightening applies instantly and bumps configVersion, which marks every pending loosening stale, so tilt cannot pre-load an escape. A permitted release to a HyperCore destination is delivered by the contract into that address's Hyperliquid perps account through Circle's CoreDepositWallet.depositFor in the same transaction. 64 Foundry tests (cd contracts && forge test): 41 invariants, 6 fixed-defect regressions, 2 isolation, 15 risk-ladder.

Privy (Best Financial Flow). The embedded wallet is the vault authority, not a login: ShieldVault._own() reverts for every other address. Created on login with createOnLogin: "users-without-wallets" (app/src/lib/privy.tsx:67); the app signs through its EIP-1193 provider. Wallet 0x83144b99D89947703714Ee9aA3A3614985041D2B, nonce 4 on chain. The financial flow is a $5.00 release from the vault into a Hyperliquid perps account in one transaction: 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be (block 63581864) — USDC approval and transfer from the vault to CoreDepositWallet, on to the HyperCore system address 0x2000...0000, a $5.00 HyperCore credit to the registered account, and TopUpExecuted(amount=$5, instant=true, balanceAfter=$45). Supporting transactions from the same wallet: registerOwner 0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0 (block 63581683) and proposeLoosen 0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85 (block 63581938), the second of which the contract holds for 24 hours. Privy policies, quorums, session signers and Cards are not used and are not claimed.

Chainlink CRE (Best Confidential Workflow). handlerInTee from @chainlink/cre-sdk is registered at cre/shield-risk/main.ts with [{ tee: "nitro", regions: ["us-west-2"] }], and the whole risk evaluation runs inside it. Two sensitive inputs are processed in the enclave, not one. The first is the verifier private key. The second is the thing that makes this a confidential application rather than confidential plumbing: the user's private risk ladder — the trailing session drawdown at which their own reload budget is allowed to shrink, plus its salt — read with runtime.getSecret as LADDER_<vault> (mapped in cre/secrets.yaml, cre/shield-risk/evaluate.ts). The chain never sees that threshold. It holds only keccak256(abi.encode(reducedAtUsdc, reducedVelocityThreshold, tierResetSecs, salt)) as ladderHash, alongside the public REDUCED allowance and duration. Inside the enclave the workflow recomputes that hash, fetches the venue's own fills over the TeeRuntime HTTP overload, measures trailing drawdown against the private threshold, and emits exactly {tier, ladderHash, nonce, expiry} — no threshold, no drawdown figure, no evidence bundle. The user's number is used to decide and then discarded; only the decision leaves. On chain, that verdict moved a live immutable vault down its ladder: tx 0x089727605059be589a27d668386df4c488204e3feea20fda4a79bbb022b5e2ca on v3, RiskTierChanged(tier=1, byVerifier=true) for vault 0xaA8cfBd03CD4e043228bCCe42b5adD98866F7D8b, after which currentTier() reads 1 and effectiveVelocityThreshold() has fallen from 4000000 to 3000000 until 1788873478. The contract constrains the enclave rather than trusting it (ShieldVault.sol): applyRiskVerdict accepts tier 1 or 2 and never NORMAL, so a verifier can only ever descend the ladder; REDUCED additionally requires rv.ladderHash == v.ladderHash, so a verdict is only valid against a rung the user committed to while calm; LOCKED still requires realizedLossUsdc >= the user's own public lossTriggerUsdc; nonces cannot be replayed; the floor, the registry, the emergency cold cap and the full exit are never gated by a verdict at all. Verified by 15 tests in contracts/test/Ladder.t.sol. The verbatim transcript is docs/evidence/cre-simulate.txt, four runs: (1) "AWS Nitro in us-west-2", the in-enclave evaluation, tier=REDUCED signed and relayed, "Simulation complete!"; (2) an already-LOCKED vault, where the enclave reports tierInForce=LOCKED and refuses to descend further; (3) the verifier secret broken, so the workflow dies before it can make a single HTTP call; (4) the ladder secret withheld, where the CLI refuses to run at all. Runs 3 and 4 are negative controls: they are what convert "a secret is present" into "the secret is load-bearing". Not claimed: deployment on the CRE network, which is invite-only beta for confidential workflows; and we do not claim the capital flows themselves are confidential, since those are public on-chain data.

The Graph (Composable / Standardized Products). substreams-evm/ builds two packages from one source tree: five modules (map_shield_events, store_vault_registry, map_vault_flows, store_flow_totals, map_behavioral_profiles) composed on The Graph's foundational ethereum-common@v0.3.3, whose index_events module is the declared blockFilter for both maps, keyed on the vault and the network's USDC. That is the standards leverage, and it is measurable: we never wrote a log scanner or a block index, so the package contains only Shield's own part — typed event decoding, detection of USDC returning from the venue, and flow classification across the vault boundary into the per-vault totals the Behaviour screen renders and the loss rule falls back on when there is no venue API to ask. The same pipeline shape is reused unchanged across two very different chains: substreams/ is the Solana implementation (seven modules, instruction decoding added), and both emit the same map_vault_flows, so one config resolves either stack (server/substreams-config.ts), one consumer streams it (server/substreams-source.ts), and server/behaviour.ts, server/policy.ts and the CRE workflow read the result without knowing which chain it came from. Both packages pass substreams registry verify, and both decode the v3 ladder events (RiskTierChanged, LadderCommitted, LadderChangeProposed, LadderChangeExecuted, and RiskVerdictApplied carrying tier). Live rows, from two independent Graph Market providers, are in docs/evidence/substreams-live.txt §1-2: a Sepolia twin of the same ShieldVault bytecode at 0xf1ef03Ea258EF652939bAC0250d1CDe9B5EF4f6A (Ethereum Sepolia, block 11654048) was given a real capital history, and the pipeline streams it back classified — DEPOSIT $10,000 at block 11654055, TOP_UP_INSTANT $1,500 to the registered execution wallet at 11654056, and DEPOSIT $80 returning from that same wallet at 11654058 — identically from sepolia.eth.streamingfast.io:443 and sepolia.substreams.pinax.network:443. Reproduce it in one command: cd substreams-evm && substreams run shield-evm-behavioral-memory-sepolia-v0.1.0.spkg map_vault_flows -e sepolia.eth.streamingfast.io:443 -s 11654048 -t +12 -o jsonl. And it is not only a CLI run: point the Shield server itself at that chain and it becomes a Graph consumer, with no other change (§6 of the same transcript). /api/health reports source.mode "substreams", connected, at live head 11695115; /api/vault/<authority>/flows serves the three flows out of the server's own store with source "substreams"; and the vault address appears in /api/health's vaults array having been discovered from the stream by store_vault_registry, with no RPC log scan on that chain at all. The classification arrives from the package rather than the server — the $1,500 carries outbound with counterpartyIsExecution true, the $80 is that same wallet paying back in through deposit() — and that is exactly the input server/behaviour.ts turns into the reload-after-loss counts the product is built on. The behavioural memory is read from The Graph. Honest limitation, stated up front rather than discovered: the package aimed at the product chain (network: hyper-evm, filtered on the v3 vault) streams and completes but returns zero rows, because The Graph indexes HyperEVM mainnet (999) only — there is no HyperEVM testnet entry in the networks registry — and the product vault is on testnet (998). §3 of the same transcript shows that run, §4 shows the Solana package streaming on devnet with the same JWT, and §5 is a no-token control returning Unauthenticated. On the product chain the server therefore runs the labelled RPC fallback (server/rpc-source.ts) with identical classification, and /api/health says so rather than hiding it. Deploying the same immutable contract to HyperEVM mainnet turns those zero rows into data; nothing else in the pipeline changes.

First run, and the hosted demo. The product's first screen is not a connect button: it is evidence. app/src/pages/Onboard.tsx takes one or more Hyperliquid addresses, and server/hyperliquid.ts groups that account's public ledger updates and fills into sessions, takes realised PnL from the venue's own closedPnl minus fees, counts the sessions that included a reload made while already down, and picks the most expensive one. app/src/components/Replay.tsx draws that session's realised-PnL line in order with the reload marked, then dims what came after and shows what the proposed ladder would have released instead. Real data only: the counterfactual never redraws history, and the copy says outright that Shield cannot know what those trades would have done with less capital. The same analysis proposes every rule, so the numbers a user is asked to accept are derived from their own history rather than a template. It runs on the hosted URL with no backend at all, because api/hyperliquid/[address].ts is that analyser as a Vercel function and server/hyperliquid.ts has no imports and uses only global fetch — no keys, no chain access, no state, about 1.3s for an arbitrary mainnet address. That is the deliberate order of the funnel: prove the problem on the visitor's own data first, and ask for a wallet only afterwards.

Rest of the stack. Server: Bun — indexer (Substreams or the labelled RPC fallback), behaviour engine (sessions, realised loss, loss streaks, reload-after-loss), policy, EIP-712 verdict relayer, JSON API. Two views feed the loss rule and server/policy.ts says which one decides: where the venue's API answers, Hyperliquid's own settled PnL is the number (venueDecides), because the flow view cannot tell capital that was lost from capital still deployed; the flow view is the fallback for an unreachable API or a destination with no API at all. App: React + Vite — Welcome, Setup, Overview, Top-up (instant / scheduled / blocked, showing the on-chain rejection and a live countdown), Behaviour, Protection, Activity. Setup step 0 reads the user's real Hyperliquid history (server/hyperliquid.ts: ledger updates and fills, no credentials) and proposes every rule from their own numbers — median session size, largest losing session, sessions with a reload while already down. Hyperliquid: read-only info API client (app/src/lib/hyperliquid.ts, server/hyperliquid.ts) for equity, positions, fills and session PnL; Shield has no order entry by design. There is no public explorer for HyperEVM testnet, so every claim above is verified with cast against https://rpc.hyperliquid-testnet.xyz/evm.
```

---

## What this submission does not claim

Stated here so a judge does not have to find it:

- **No AI in the product.** The AI tracks are not entered.
- **No Privy policies, quorums, session signers, Cards or `useFundWallet`.**
  The B2B track is not entered.
- **No Chainlink Continuity claim.** Shield is net-new.
- **The Graph pipeline returns live rows from a Sepolia twin, not from the
  product chain.** The twin is the same ShieldVault bytecode with a real staged
  capital history, and two Graph Market providers stream it (evidence §1–2).
  The HyperEVM package streams and completes with zero rows, because The Graph
  indexes HyperEVM mainnet only and the product vault is on testnet. Stated
  wherever the Graph claim is made.
- **No CRE network deployment.** Confidential Workflows are invite-only beta;
  the evidence is CLI simulation plus the on-chain verdict it produced.
- **No traction.** No users, no revenue, no letters of intent. Built inside the
  hackathon window; first commit 2026-09-04.
- **No block explorer links,** because none of them index HyperEVM testnet.
  Every hash above is verifiable by RPC.
