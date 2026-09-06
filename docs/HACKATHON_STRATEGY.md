# Hackathon strategy — ETHGlobal ETHOnline 2026

Researched from the official pages on 2026-09-05 and re-verified verbatim on
2026-09-06 (Cloudflare blocks headless browsers on ethglobal.com; pages were
fetched with a desktop user agent). Everything below is what the pages said;
the "unknowns" section lists what could not be confirmed.

**2026-09-06 change:** the product is Hyperliquid-first (see
`ARCHITECTURE_DECISION.md`). We now select **three** partners: The Graph,
Privy, Chainlink. Hyperliquid itself is not a sponsor of this event (0
matches on the prizes page), which is fine: it is the venue, not a prize.

## Rules that bind us

| Item | Value | Source |
|---|---|---|
| Event window | Sept 4 to Sept 16, 2026, async | https://ethglobal.com/events |
| **Submission deadline** | **Sunday, September 13, 2026, 12:00 pm EDT** (16:00 UTC). "Late submissions won't be accepted" | https://ethglobal.com/events/ethonline2026/info/details |
| Check-ins | #1 due Mon Sept 7 23:59 EDT, #2 due Thu Sept 10 23:59 EDT | event schedule JSON |
| Judging | Round 1 async Sept 13; Round 2 live Sept 14 (top ~20% advance); finale Sept 16. Live format: 7 minutes, 4 demo + 3 Q&A | info/details |
| Track | **Start Fresh (Classic)**. "All work on your project must begin after the hackathon officially starts." Our first commit is 2026-09-04 10:50 UTC, after the 05:00 UTC start; there is no pre-event code. | info/details, `git log` |
| Partner prizes | "You can select up to 3 Partner Prizes." A partner with several tracks counts once. Each needs an explanation of the integration plus feedback. | info/details |
| Video | 2 to 4 minutes, 720p+, no speed-up, no AI voice-over, no phone recording; uploads outside 2–4 min are rejected | info/details |
| AI tooling | Permitted with attribution: document where AI was used; spec-driven workflows must include spec files, prompts and planning artifacts in the repo | info/details; see `docs/AI_USAGE.md` and `docs/planning/` |
| Version control | "Submissions with large single commits or missing histories may be disqualified" | info/details |
| Judging criteria | Technicality, Originality, Practicality, Usability (UI/UX/DX), WOW factor | info/details |

## Selected partner prizes (3 of 3 allowed)

"If a partner has multiple tracks, you can be eligible for all of them while
only counting as 1 Partner Prize" (info/details).

### 1. The Graph — "Best AI Tooling or AI Use Case with The Graph (From Scratch)" ($5,000: 2,500 / 1,500 / 1,000)

Also eligible, and claimed as the secondary Graph track: "Best Use of
Composable or Standardized Graph Products" ($5,000). Requirement quoted
2026-09-06: "Either compose two or more of The Graph's products, or build
meaningfully on a standardized schema"; "Authoring or extending a
Standardized Subgraph, or contributing a reusable composable Substreams
module, is in scope"; "The best submissions show the leverage of standards:
… one pipeline reused across chains." Shield ships the same five-module
pipeline shape on two chains: `substreams/` (Solana devnet, composed on the
standard `sf.solana.type.v1.Block` source) and `substreams-evm/` (HyperEVM,
composed on The Graph's foundational `ethereum-common` package: its
`index_events` block index filters both maps by `evt_addr`). Both count as
one partner selection.

Why it is structural: the loss rule is *"if $X did not come back from your
trading wallet within 24h, pause top-ups"*. The only way to know what came
back is to index the trading wallet's SPL-level inflows to the vault and
classify them against the vault's on-chain registry. That is the Substreams
package. Remove it and Shield degrades to static limits: the loss rule, the
behaviour screen and the monitor stop working.

Requirements checklist (quoted from the prize page):

- [x] "Use The Graph as a load-bearing part of the project… the agent/app uses The Graph (… Substreams) as its source of blockchain data." → `substreams/` (7 modules), consumed by `server/substreams-source.ts`.
- [ ] "Consume live data from a Graph provider, for example… streaming Substreams via The Graph Market. Mocked, local-only, or static datasets do not qualify." → Wired to `devnet.sol.streamingfast.io:443` (The Graph Market's Solana devnet endpoint, verified in the networks registry). **Needs a Graph Market API key** (`HUMAN_ACTIONS.md` #2). Until then the server says `source.mode = "rpc"` in `/api/health` and the UI labels it a fallback.
- [x] "Do meaningful work with the data: reasoning, decisions, automation" → sessions, realised loss, loss streaks, reload-after-loss, a signed verdict, an on-chain cooldown (`server/behaviour.ts`, `server/policy.ts`, `apply_risk_verdict`).
- [x] "Open-source the code with a clear README… submit a public repository plus a short demo video (two to four minutes)." → `substreams/README.md`, this repo; video is a human action.
- [x] "Select the pool that matches how you built" → Start Fresh.
- [~] Featured challenge: "demonstrate deploying a working Substreams pipeline from a single prompt using the Substreams SKILLs." → The package was built with the official `substreams-solana` / `substreams-dev` SKILLs (`docs/substreams-one-prompt.md` records the prompt and the run). Deployment (`substreams run` / hosted sink) needs the same API key.

Evidence judges can inspect: `substreams/substreams.yaml`, `substreams/src/lib.rs`, `substreams info shield-behavioral-memory-v0.2.0.spkg`, the server's `/api/health` (`source.mode: "substreams"` once keyed), the Behaviour screen's source label.

### 2. Privy — "Best financial flow" ($2,500)

Requirements (quoted 2026-09-06 from /prizes/privy): "Integrate Privy as a
core part of the product"; "Create or use at least one Privy wallet";
"Complete at least one functional financial flow using a generally available
Privy feature"; "Eligible flows include transfers, bridging, stablecoin
conversions, swaps, self-service Earn vaults, onramps, or other supported
wallet actions"; "Provide a working demo and access to the project's source
code"; "Clearly explain how Privy improves the user experience"; "Features
requiring commercial or guided onboarding may be mocked, but they do not
count as the required functional Privy integration."

Why it is structural: the user signs in with email or a passkey, gets a
self-custodial embedded EVM wallet on HyperEVM, that wallet is the vault's
sole authority, and it signs the two value-moving actions Hyperliquid
reserves for the master key (the agent approval that makes trading
prompt-free, and the Core→EVM return of capital). The financial flow is
"deposit into the vault → governed top-up straight into the Hyperliquid
account → trade → return", all from one Privy wallet.

Checklist:
- [x] Privy as core: `app/src/lib/privy.tsx` wraps the app in `PrivyProvider` (email / passkey / wallet, embedded wallet created on login, HyperEVM chain), `evm-engine.ts` signs every vault transaction through the embedded wallet's EIP-1193 provider.
- [x] Privy wallet used: the embedded wallet is the vault authority and the Hyperliquid master account.
- [ ] Functional flow demonstrated: needs a Privy app ID (`HUMAN_ACTIONS.md` #1). Without it the app uses a pasted demo key on the same code path.
- [x] Explanation: `docs/SPONSOR_INTEGRATIONS.md`.

Not selected: "Best B2B financial product" (no organisation use case).

### 3. Chainlink — "Best Confidential Workflow" ($2,000: up to 2 × $1,000)

Why it is structural: a commitment device is only credible if the operator
cannot cave. The verdict that pauses top-ups is signed by a key that exists
only inside the enclave (`runtime.getSecret`), over an evaluation the enclave
re-derives from raw flows. Shield's operator cannot forge, soften, or suppress
a verdict for one user. Remove CRE and the monitor becomes "trust Shield's
server"; the vault's floor/limits still hold, but Premise 5 (operator can't
cave) is gone.

Requirements checklist (quoted):

- [x] "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part of the application." → `cre/shield-risk/main.ts` + `evaluate.ts`.
- [x] "The workflow must register and use a confidential TEE handler, such as handlerInTee" → `handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])`.
- [x] "The confidential portion… must process at least one sensitive input, secret, confidential API response, private parameter, or intermediate value inside the enclave." → the Ed25519 signing seed (secret), the user's raw capital flows (sensitive), the derived sessions and the signed verdict (intermediate).
- [x] "meaningfully integrated into the project's core functionality" → the verdict is the only external input the vault accepts; it arms the user's loss cooldown.
- [ ] "Demonstrate a successful execution through either: A Confidential Workflow simulation using the CRE CLI or a live deployment" → the workflow compiles with `cre-compile`; **`cre workflow simulate` requires a Chainlink account/API key** (`HUMAN_ACTIONS.md` #3). The identical function is exercised locally by `cre/shield-risk/dryrun.ts`, which signed and relayed a verdict the vault accepted (see `docs/SPONSOR_INTEGRATIONS.md`).
- [ ] "Provide evidence… demo video, terminal output, execution logs" → capture the simulation output once keyed.

Not selected: "Best Chainlink-Powered Upgrade" is Continuity-only; the
"Automated Liquidation Protection Challenge" is a different product.

## Rejected sponsors, and why

| Sponsor | Fit | Why not |
|---|---|---|
| Ledger (AI Agents × Ledger, $3,500) | 4/5 on paper: "systems that ask for a human before anything irreversible" | Must be "built on the Ledger Agent Stack, in particular… Key Ring CLI". No device in this environment; a hardware signer we cannot run would be theatre. The original design cut it for v1; revisit post-hackathon (Key Ring holding the verifier seed is the natural fit). |
| World ($7,000) | 2/5 | Selfie Check as an abuse signal is peripheral; AgentKit is Continuity-only and World Chain/Base only. |
| Arc (Circle) ($10,000) | 2/5 | Requires an EVM port to Arc; would abandon the Solana-native user (see `ARCHITECTURE_DECISION.md`). |
| Hedera, 1inch, ENS, Uniswap | 1/5 | Different chains and different products (x402 services, Aqua LP strategies, ENSv2, Uniswap stack). |
| Bazantic ($3,000) | 1/5 | Wrapping the behaviour API as a paid gateway is a side quest; the natural prize is Continuity-only. |

## Track decision

Start Fresh (From Scratch), "Finalist and Partner Prizes" option. The design
conversations before code began are inside the event window (Sept 4) and
are included as planning artifacts per the AI-tooling rule.

## Unknowns still to confirm

1. Whether The Graph judges accept `substreams run`/JS streaming against the Market endpoint as "deployed pipeline" for the featured one-prompt challenge, or expect a Hosted Sink deployment. Both are documented; the Hosted Sink needs the same key plus a reachable Postgres.
2. Whether ETHGlobal itself requires a public repo (sponsors do; ETHGlobal says "GitHub Repo, Figma files, or equivalent"). Plan: public.
3. Prize payout mechanics (KYC etc.) were not on any page.
4. Whether a Solana settlement counts as "meaningfully integrated" for Chainlink judges. Nothing on the page restricts the chain; on-chain writes are not required for this prize.

## Sources

- https://ethglobal.com/events/ethonline2026/info/details (rules, deadline, prizes cap, AI policy, judging)
- https://ethglobal.com/events/ethonline2026/prizes and `/prizes/the-graph`, `/prizes/chainlink`, `/prizes/ledger`, `/prizes/privy`, `/prizes/world`, `/prizes/arc`
- https://ethglobal.com/rules
- https://thegraph.market/networks/solana-devnet, https://networks-registry.thegraph.com/TheGraphNetworksRegistry.json
- https://docs.substreams.dev/reference-material/chain-support/chains-and-endpoints.md
- https://github.com/streamingfast/substreams-skills
- https://docs.chain.link/cre/concepts/confidential-workflows, https://docs.chain.link/cre/account/confidential-workflows-access, https://docs.chain.link/cre/capabilities/solana-write
