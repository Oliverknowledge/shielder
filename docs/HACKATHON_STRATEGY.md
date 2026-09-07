# Hackathon strategy — ETHGlobal ETHOnline 2026

Researched from the official pages on 2026-09-05 and re-verified verbatim on
2026-09-06 (Cloudflare blocks headless browsers on ethglobal.com; pages were
fetched with a desktop user agent). The verbatim criteria are pinned in
`docs/internal/gauntlet/CRITERIA.md`; the claims we are allowed to make are pinned in
`docs/internal/gauntlet/FACTS.md`. This file says which tracks we enter, which we decline
and why, and what is still missing.

The product is Hyperliquid-first (see `ARCHITECTURE_DECISION.md`). We select
**three** partners: The Graph, Privy, Chainlink. Hyperliquid itself is not a
sponsor of this event (0 matches on the prizes page), which is fine: it is the
venue, not a prize.

## The two things to lead with

Neither is a sponsor claim; both are what makes the sponsor claims worth
reading.

1. **The rules are proposed from the user's own history, not from a template.**
   Setup step 0 reads the Hyperliquid account they trade from — public ledger
   updates and fills, no credentials (`server/hyperliquid.ts`) — and shows them
   their own sessions, typical session size, largest losing session and count
   of sessions with a reload made while already down, plus one generated
   sentence of the form "3 of your 4 largest losing sessions involved another
   reload." The proposed limits follow from those numbers
   (`app/src/pages/Setup.tsx`). This is the answer to the hardest question
   about the product — why would anyone constrain themselves — and it is a
   screen, not an argument.
2. **Nobody can build this credibly except something with no owner.** Any venue
   or wallet could ship a cooling-off timer in a week. A venue that holds a
   customer's money against that customer's stated wish owns a liability and
   therefore has to build an appeals path, and an appeals path is exactly what
   defeats a commitment device. Shield's advantage is that there is nobody to
   ask. Do not argue this on Hyperliquid's agent-wallet permissions:
   sub-accounts exist and a judge who trades will say so.

## Rules that bind us

| Item | Value | Source |
|---|---|---|
| Event window | Sept 4 to Sept 16, 2026, async | https://ethglobal.com/events |
| **Submission deadline** | **Sunday, September 13, 2026, 12:00 pm EDT** (16:00 UTC). "Late submissions won't be accepted" | https://ethglobal.com/events/ethonline2026/info/details |
| Check-ins | #1 due Mon Sept 7 23:59 EDT, #2 due Thu Sept 10 23:59 EDT | event schedule JSON |
| Judging | Round 1 async Sept 13; Round 2 live Sept 14 (top ~20% advance); finale Sept 16. Live format: 7 minutes, 4 demo + 3 Q&A | info/details |
| Track | **Start Fresh (Classic)**. "All work on your project must begin after the hackathon officially starts." First commit 2026-09-04 10:50 UTC, after the 05:00 UTC start; there is no pre-event code. | info/details, `git log` |
| Partner prizes | "You can select up to 3 Partner Prizes." A partner with several tracks counts once. Each needs an explanation of the integration plus feedback. | info/details |
| Video | 2 to 4 minutes, 720p+, no speed-up, no AI voice-over, no phone recording; uploads outside 2–4 min are rejected | info/details |
| AI tooling | Permitted with attribution: document where AI was used; spec-driven workflows must include spec files, prompts and planning artifacts in the repo | info/details; see `docs/AI_USAGE.md` and `docs/internal/planning/` |
| Version control | "Submissions with large single commits or missing histories may be disqualified" | info/details |
| Judging criteria | Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW factor | info/details |

## Tracks entered and declined

"If a partner has multiple tracks, you can be eligible for all of them while
only counting as 1 Partner Prize" (info/details) — so declining a track costs us
nothing except the claim.

| Track | Prize | Decision | One-line reason |
|---|---|---|---|
| The Graph — Best Use of Composable or Standardized Graph Products | $5,000 | **Entered** | Two authored Substreams packages, one composed on The Graph's `ethereum-common`, streamed live from a Graph Market provider |
| The Graph — Best AI Tooling or AI Use Case (From Scratch) | $5,000 | Declined | There is no AI in the shipped product; `docs/AI_USAGE.md` is about AI writing the repo, which is a different thing |
| The Graph — Best AI Tooling or AI Use Case (Continuity) | $5,000 | Declined | Same, and Shield is net-new so the Continuity pool does not apply |
| Privy — Best Financial Flow | $2,500 | **Entered** | A Privy embedded wallet moved $5 of USDC from the vault to HyperCore on chain |
| Privy — Best B2B Financial Product | $2,500 | Declined | Needs Privy control primitives (policies, quorums, session signers). Shield uses none of them and is B2C |
| Chainlink — Best Confidential Workflow | $2,000 | **Entered** | `handlerInTee` registered and `cre workflow simulate` run; transcript committed |
| Chainlink — Best Chainlink-Powered Upgrade (Continuity) | $500 | Declined | Requires an existing project the integration improves; Shield is net-new |
| Chainlink — Automated Liquidation Protection Challenge | $500 | Declined | A different product: a virtual ETH/USDC position on Sepolia |

Full evidence for each entered track, row by row against the verbatim criteria,
is in `docs/SPONSOR_INTEGRATIONS.md`.

## 1. The Graph — "Best Use of Composable or Standardized Graph Products" ($5,000: 2,500 / 1,500 / 1,000)

Why it is structural: the loss rule needs to know what the user's capital
actually did, and Shield reads that from two independent views. One is the
venue's own settled PnL. The other is the money crossing the vault boundary —
released to a registered trading destination, returned from it — and the only
way to produce that is to index the vault's logs and classify every flow
against the vault's own on-chain registry of destinations. That is the
Substreams package.

Which one decides is explicit in `server/policy.ts`
(`const venueDecides = !!venue; const realizedLossUsdc = venueDecides ?
venueLoss : flowLoss`): where the venue's API answers, the venue's settled PnL
is the number the rule reads, and the flow view is the fallback. Remove the
package and Shield loses the on-chain half of its evidence — every flow, the
Behaviour screen, and the fallback the loss rule uses wherever a destination
has no venue API or the API does not answer — leaving a commitment device that
trusts a single exchange endpoint, which is the opposite of what it claims to
be.

Checklist, quoted from the prize page:

- [x] "Either compose two or more of The Graph's products, or build meaningfully on a standardized schema" → `substreams-evm/` imports The Graph's foundational `ethereum-common@v0.3.3` and declares its `index_events` module as the `blockFilter` for both maps (`substreams-evm/substreams.yaml:51`, `:76`).
- [x] "Consume live data from a Graph provider, for example Subgraph Studio for Subgraphs or The Graph Market for Substreams" → done and committed: `docs/evidence/substreams-live.txt` is a live `map_vault_flows` run against `hyperevm.substreams.pinax.network:443`, ending "Completed successfully". Reproduce with `bun run substreams:hyperevm`. **Caveat that goes wherever this claim goes:** the run returns no rows, because The Graph indexes HyperEVM mainnet (999) and the vault is on testnet (998). The server reports `source.mode: "rpc"` and says why in `/api/health`.
- [x] "Simply querying one Subgraph with no composition or standardization does not qualify" → no Subgraph is queried at all; this is authored Substreams with stateful stores.
- [x] "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope" → two packages, both committed as built `.spkg`: `substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg` (five modules) and `substreams/shield-behavioral-memory-v0.2.0.spkg` (seven — the same five plus `map_shield_instructions` and `store_vault_wallets`, which have no EVM equivalent).
- [x] "Make the standards leverage clear: show what became easier because a shared schema or composed product was used" → the `FlowKind` enum and the flow message have identical variants, numbers and field numbering in both packages, so everything downstream of `map_vault_flows` is written once: `server/behaviour.ts` and `server/policy.ts` are imported unchanged by both servers (`server/index.ts:45-46`, `server/evm-index.ts:17-18`).
- [ ] "Submit a public repository…" → **the repository is still private.** `HUMAN_ACTIONS.md` #1.
- [ ] "…and a short demo video (two to four minutes)" → not recorded. `HUMAN_ACTIONS.md` #3.

The hardest clause is the live-data one, and the single change that turns it
from "authenticated stream, no rows" into "authenticated stream over a real
vault" is the HyperEVM mainnet deploy (`HUMAN_ACTIONS.md` #2). Only the two
`evt_addr` filters and `initialBlock` in `substreams-evm/substreams.yaml` move.

Evidence judges can inspect: `substreams-evm/substreams.yaml`,
`substreams-evm/src/lib.rs`, `docs/evidence/substreams-live.txt`,
`curl localhost:8788/api/health`, the Behaviour screen's source label.

## 2. Privy — "Best Financial Flow" ($2,500)

Why it is structural: the user signs in with email or a passkey, Privy creates a
self-custodial embedded wallet on HyperEVM, and that wallet is the vault's sole
authority — `ShieldVault.sol` gates every path on `msg.sender`. The financial
flow is "deposit into the vault → governed release straight into the Hyperliquid
account", signed by that one wallet.

Checklist:

- [x] "Integrate Privy as a core part of the product" → `app/src/lib/privy.tsx` wraps the app in `PrivyProvider`; its EIP-1193 provider is what `app/src/lib/evm-engine.ts` signs every vault transaction with (`app/src/lib/shield.tsx:132`).
- [x] "Create or use at least one Privy wallet" → created by Privy, not imported (`createOnLogin: "users-without-wallets"`, `app/src/lib/privy.tsx:67`): `0x83144b99D89947703714Ee9aA3A3614985041D2B`, nonce 4.
- [x] "Complete at least one functional financial flow using a generally available Privy feature" → **$5.00 released from the vault to HyperCore**, tx `0x94960d1f…`, block 63581864, signed by that wallet; USDC left through Circle's `CoreDepositWallet` and was credited on HyperCore.
- [x] "Eligible flows include transfers, bridging, stablecoin conversions…" → a stablecoin transfer that bridges HyperEVM → HyperCore in one transaction.
- [x] "Clearly explain how Privy improves the user experience" → `docs/SPONSOR_INTEGRATIONS.md`, plus the feedback the rules ask for.
- [ ] "Provide a working demo and access to the project's source code" → the code runs, but the repository is private (`HUMAN_ACTIONS.md` #1) and the demo video is unrecorded (`HUMAN_ACTIONS.md` #3).

Declined: "Best B2B Financial Product" — it needs Privy policies, signers,
quorums or intents, and Shield implements none of them. The "calm-you sets
policy for tilted-you" framing is enforced by the contract, not by Privy, so
claiming that track would misdescribe what is built.

## 3. Chainlink — "Best Confidential Workflow" ($2,000: up to 2 × $1,000)

Why it is structural: a commitment device is only credible if the operator
cannot cave. The verdict that pauses top-ups is signed by a key that exists only
inside the enclave (`runtime.getSecret`), over an evaluation the enclave
re-derives from raw flows. Shield's operator cannot forge, soften or suppress a
verdict for one user. Remove CRE and the monitor becomes "trust Shield's
server"; the vault's floor and limits still hold, but the operator-can't-cave
premise is gone.

Checklist, quoted from the prize page:

- [x] "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part" → `cre/shield-risk/main.ts:84-89`; the whole evaluation is `evaluateVault` in `cre/shield-risk/evaluate.ts`, called only from inside the handler.
- [x] "The workflow must register and use a confidential TEE handler, such as handlerInTee" → `handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])`, `cre/shield-risk/main.ts:88`.
- [x] "The confidential portion must process at least one sensitive input, secret, confidential API response, private parameter" → the verifier private key, read in-enclave at `cre/shield-risk/evaluate.ts:89` and used to produce the EIP-712 signature. We do **not** claim the capital flows are confidential; they are fetched over plain HTTP and are on-chain anyway.
- [x] "The Confidential Workflow must be meaningfully integrated into the project's core functionality" → the signed verdict is the only external input the vault accepts (`contracts/src/ShieldVault.sol:536`), and it can only ever extend a cooldown.
- [x] "Demonstrate successful execution through simulation using the CRE CLI or live deployment on the CRE network" → **`cre workflow simulate` ran.** Verbatim transcript: `docs/evidence/cre-simulate.txt`, TEE banner and "Simulation complete!" included. The exact command is in that file and in `docs/SPONSOR_INTEGRATIONS.md`.
- [x] "Provide evidence of successful simulation or deployment in the submission, such as demo video or execution logs" → that transcript, plus the on-chain result of the first simulation run: tx `0x2e411cea…`, block 63584417, `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=3500000, extended=true)`. The demo video is still `HUMAN_ACTIONS.md` #3.

Declined: "Best Chainlink-Powered Upgrade" is Continuity-only and Shield is
net-new; the "Automated Liquidation Protection Challenge" is a different
product.

## Rejected sponsors, and why

| Sponsor | Fit | Why not |
|---|---|---|
| Ledger (AI Agents × Ledger, $3,500) | 4/5 on paper: "systems that ask for a human before anything irreversible" | Must be "built on the Ledger Agent Stack, in particular… Key Ring CLI". No device in this environment; a hardware signer we cannot run would be theatre. Revisit post-hackathon (Key Ring holding the verifier key is the natural fit). |
| World ($7,000) | 2/5 | Selfie Check as an abuse signal is peripheral; AgentKit is Continuity-only and World Chain/Base only. |
| Arc (Circle) ($10,000) | 2/5 | Requires a port to Arc; Shield's whole point is being where the user's trading account already is. |
| Hedera, 1inch, ENS, Uniswap | 1/5 | Different chains and different products (x402 services, Aqua LP strategies, ENSv2, Uniswap stack). |
| Bazantic ($3,000) | 1/5 | Wrapping the behaviour API as a paid gateway is a side quest; the natural prize is Continuity-only. |

## Track decision

Start Fresh (From Scratch), "Finalist and Partner Prizes" option. The design
conversations before code began are inside the event window (Sept 4) and are
included as planning artifacts per the AI-tooling rule.

## Unknowns still to confirm

1. Whether Graph judges read "consume live data from a Graph provider" as
   satisfied by an authenticated live stream that returns zero rows because the
   chain the vault is on is not indexed. We assume not, which is why the mainnet
   deploy is `HUMAN_ACTIONS.md` #2 rather than a nice-to-have.
2. Whether Chainlink judges want the simulator transcript, the on-chain verdict
   transaction, or both. We submit both, and say plainly which run produced
   which.
3. Prize payout mechanics (KYC etc.) were not on any page.

## Sources

- https://ethglobal.com/events/ethonline2026/info/details (rules, deadline, prizes cap, AI policy, judging)
- https://ethglobal.com/events/ethonline2026/prizes and `/prizes/the-graph`, `/prizes/chainlink`, `/prizes/ledger`, `/prizes/privy`, `/prizes/world`, `/prizes/arc`
- https://ethglobal.com/rules
- https://networks-registry.thegraph.com/TheGraphNetworksRegistry.json (no HyperEVM testnet entry)
- https://docs.substreams.dev/reference-material/chain-support/chains-and-endpoints.md
- https://github.com/streamingfast/substreams-skills
- https://docs.chain.link/cre/concepts/confidential-workflows, https://docs.chain.link/cre/account/confidential-workflows-access
