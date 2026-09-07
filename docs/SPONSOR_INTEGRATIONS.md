# Sponsor integrations

Three partner prizes selected — the maximum ETHGlobal allows: **The Graph**,
**Privy**, **Chainlink**. A partner with several tracks counts once, so the
tracks we decline are named below with the reason, rather than left ambiguous.

Every claim here is checkable from a clone without asking us anything. Code is
cited as `file:line`. Chain facts are a transaction hash plus a block. The CRE
simulation and the Graph Market stream each have a verbatim terminal transcript
committed under `docs/evidence/`.

**How to check a transaction.** No public block explorer indexes HyperEVM
testnet. `explore-testnet.hyperpc.app`, `app.hyperliquid-testnet.xyz/explorer`,
`testnet.purrsec.com` and `testnet.hyperevmscan.io` were each tried; none of
them resolves the hashes below. The verifiable form is the RPC:

```bash
cast tx     <hash> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
cast receipt <hash> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
```

The deployment under test is `ShieldVault.sol` at
`0xcdB6d631A00857584e70a21d800f51C5776302Fe`, **HyperEVM testnet, chain id
998**, deploy tx `0x67ffb653…` in block 63561837. It is immutable: no proxy, no
owner, no upgrade path. One contract holds many vaults, keyed by authority
address.

Three things are still open and are stated in each section where they bear on a
criterion: the repository is private, the vault is on testnet rather than
mainnet, and the demo video does not exist yet. See `HUMAN_ACTIONS.md`.

---

## Privy — Best Financial Flow ($2,500)

Proven on HyperEVM testnet on 2026-09-06. Every transaction below was signed by
a Privy embedded wallet created from an email address — no seed phrase, no
extension.

| Requirement (verbatim) | Evidence |
|---|---|
| "Integrate Privy as a core part of the product" | `app/src/lib/privy.tsx` wraps the app in `PrivyProvider` (email / passkey / wallet). `privy.tsx:37` hands the embedded wallet's EIP-1193 provider to `app/src/lib/shield.tsx:132`, which builds the signing engine at `app/src/lib/evm-engine.ts:51`; every vault transaction goes out through it. On chain the wallet *is* the vault's authority — `ShieldVault.sol` gates deposit, release, tighten, loosen and exit on `msg.sender`, so no other address can move the protected capital |
| "Create or use at least one Privy wallet" | Created by Privy, not imported: `createOnLogin: "users-without-wallets"` (`app/src/lib/privy.tsx:67`). Wallet `0x83144b99D89947703714Ee9aA3A3614985041D2B`, **nonce 4** — it signed four transactions itself |
| "Complete at least one functional financial flow using a generally available Privy feature" | **$5.00 released from the vault into a Hyperliquid account.** tx `0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be`, block 63581864, `from` = the Privy wallet. Logs in that single transaction: USDC `Approval`; `Transfer` vault → Circle's `CoreDepositWallet`; on to the HyperCore system address `0x2000…0000`; a HyperCore credit of $5.00 to `0x05a7a130…`; and `TopUpExecuted(amount = $5, instant = true, balanceAfter = $45, route = 1)` |
| "Eligible flows include transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps" | A stablecoin transfer that also bridges HyperEVM → HyperCore, in one transaction, through Circle's real deposit wallet |
| "Provide a working demo and access to the project's source code" | Source: this repository — **it is still private**, `HUMAN_ACTIONS.md` #1. Video: `HUMAN_ACTIONS.md` #3, script in `docs/DEMO_SCRIPT.md` |
| "Clearly explain how Privy improves the user experience" | Without Privy the only way into a self-custodial vault is pasting a raw private key. With it: type an email, get a code, and the wallet that guards your protected capital exists. Shield's whole premise is that future-you cannot get at the money on impulse; a seed-phrase ceremony at the front door would lose the user before the premise is ever tested |

Supporting transactions, same wallet, same session:

- `registerOwner` — the Hyperliquid account registered as a release destination:
  `0x80c2a48aeeb2825fc427c2eb6b90821bc5c75fe8db38eddb3db745f55426f8f0`, block 63581683.
- `proposeLoosen` — a weakening the contract holds for 24 hours before it takes
  effect: `0xeeea692a9a7c25ada3918ceff2992c3465fff356b560b6c80a5e191cf2224b85`, block 63581938.

Vault state for that authority today: **$45 balance, floor $10, $50 deposited,
$5 released.**

**Not claimed.** Privy policies, quorums, session signers, Cards and
`useFundWallet` are not used anywhere in the repository. **Best B2B Financial
Product ($2,500) is declined** for exactly that reason: it needs those control
primitives, and Shield is a B2C product.

**Weaknesses, stated rather than hidden.** The vault was funded by a different
address — `deposit(authority, amount)` pulls from `msg.sender` — so the money
never passed through the Privy wallet; only the *authority* over it did. The
financial flow is a single $5 release: real chain, real Circle contract, small
number. There is no hosted deployment, so a judge runs the app locally.

**Feedback for Privy.** Two things cost us time. First, `PrivyProvider` took a
hand-written chain object, and because it had no explorer entry and no testnet
flag the confirmation modal offered no way to inspect the transaction it was
asking you to sign — on a product whose pitch is that you can check everything
yourself. We now build Privy's chain from the same `viemChain` the engine signs
with so the two cannot drift; a `viem` `Chain` accepted directly would have
removed the class of bug. Second, when `wallet` is an enabled login method a
user can connect an external wallet through Privy, and the account state reads
the same as an embedded one; distinguishing "Privy created this key" from
"Privy is brokering someone else's" needed more digging than it should have.

---

## Chainlink — Best Confidential Workflow ($2,000, up to 2 × $1,000)

| Requirement (verbatim) | Evidence |
|---|---|
| "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part" | `cre/shield-risk/main.ts:84-89` registers the workflow; the entire evaluation — fetching the vault view and its flows, deriving sessions and realised loss, applying the user's rule, signing the verdict — is `evaluateVault` in `cre/shield-risk/evaluate.ts`, called only from inside the TEE handler |
| "The workflow must register and use a confidential TEE handler, such as handlerInTee in TypeScript or cre.HandlerInTee" | `handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])` — `cre/shield-risk/main.ts:88`. The CLI confirms the placement it was given: "Trigger requested TEE Execution … AWS Nitro in us-west-2" (`docs/evidence/cre-simulate.txt`) |
| "The confidential portion must process at least one sensitive input, secret, confidential API response, private parameter" | The **verifier private key**, read in-enclave with `runtime.getSecret({ id })` at `cre/shield-risk/evaluate.ts:89`, mapped in `cre/secrets.yaml`, and used to produce the EIP-712 signature (`cre/shield-risk/evm-verdict.ts`). It is the key the vault pins as `riskVerifier`; only signatures leave the enclave. **What is deliberately not claimed:** the capital flows are *not* confidential. They are read over plain HTTP from an unauthenticated local endpoint and they are on-chain anyway |
| "meaningfully integrated into the project's core functionality" | The signed verdict is the only external input `ShieldVault.sol` accepts (`applyRiskVerdict`, `contracts/src/ShieldVault.sol:536`). Remove CRE and the pause becomes "trust Shield's server" |
| "Demonstrate successful execution through simulation using the CRE CLI or live deployment on the CRE network" | **Done — `cre workflow simulate` ran.** Verbatim transcript: `docs/evidence/cre-simulate.txt`, ending "Simulation complete!" |
| "Provide evidence of successful simulation or deployment in the submission, such as demo video or execution logs" | That transcript, plus the on-chain result below. Video: `HUMAN_ACTIONS.md` #3 |

**The command, run from the repository root:**

```bash
cre workflow simulate shield-risk --target evm-settings --non-interactive \
  --trigger-index 0 --http-payload '{"vault":"0x751D1e26d79FeffE95F8a8662aB7A022780ED023"}' \
  -R cre -e cre/.env
```

`--target staging-settings` is the Solana configuration and demands a Solana
keypair the EVM path never uses; `-R cre` is what makes the workflow path
`shield-risk` rather than `cre/shield-risk`.

**On-chain result, verified log by log.** The first CLI simulation signed a
verdict and the deployed contract accepted it: tx
`0x2e411cea49a5c8edff69dddb7376aca1b5c2eee9f92be1fcb12f78733676bb35`, block
63584417, status 1, emitting
`RiskVerdictApplied(nonce = 1, reasonCode = 1, realizedLossUsdc = 3500000,
cooldownUntil = 1788776770, extended = true, evidenceHash = 0x4c7946…918b)`.
Vault state after: `cooldownReason = 2 (RISK_VERDICT)`, `lastVerdictNonce = 1`.

**Read the transcript with that in mind.** The committed transcript is a *later*
reproduction against the same vault, and it holds two runs. The first shows the
TEE banner, the in-enclave evaluation and a clean exit, reporting
`realisedLoss24h=0 … triggered=false` — the correct answer, because the enclave
now reads the venue's own settled PnL alongside the vault's flows and
Hyperliquid settled this account flat over the window, so there is nothing to
attest and nothing to sign. The second run is the identical command with the
verifier secret replaced by `0xdeadbeef`; it fails with
`✗ workflow execution failed: EVM verifier secret must be a 0x-prefixed 32-byte
private key`, before any HTTP call, which is what proves the secret is
load-bearing. The signing path is what the transaction above proves; the
transcript proves the confidential execution and the secret's necessity.

**Why the pause cannot be abused — verified in Solidity**
(`contracts/src/ShieldVault.sol:536-558`, tested at
`contracts/test/ShieldVault.t.sol:259-261`): a verdict carries no duration, no
floor, no limit and no destination. `cooldownUntil` only ever moves forward, so
a verdict can never shorten a pause the user set. The user's own
`lossTriggerUsdc` is the floor below which a verdict is rejected outright. Cold
transfers and full exit are never gated by it — the user can always leave.
Worst case is bounded by `MAX_LOSS_COOLDOWN_SECS = 30 days`.

**Tracks declined.** *Best Chainlink-Powered Upgrade (Continuity, $500)* — it
requires an existing project the integration improves, and Shield is net-new
(first commit 2026-09-04). *Automated Liquidation Protection Challenge ($500)* —
a different product (a virtual ETH/USDC position on Sepolia).

**Weaknesses, stated rather than hidden.** The CRE simulator is not real
hardware; its own banner says so, and no part of this submission claims an
attested enclave ran. There is no deployment on the CRE network — that needs
`cre account access`. And the enclave reaches Shield's server over HTTP with no
authentication, which is fine for a simulation against a local process and would
need `authorizedKeys` restricted in production (`cre/shield-risk/main.ts`).

**Feedback for Chainlink.** The TS SDK's `handlerInTee` and `TeeRuntime`
overloads were clear and the `cre-compile` toolchain was painless. The friction
was all in what only the real CLI could surface: `configSchema` is a zod object
that strips undeclared fields, so two config keys silently never reached the
enclave and every EVM run was interpreted as Solana until we compared the parsed
config to the file; the project's target validates *every* declared chain, so an
EVM-only simulation demanded a funded Solana keypair it never touches (we added
a separate `evm-settings` target); `CreSerializable` rejecting `null` is
surprising and the error does not name the offending field; zod `.default()`
breaks `configSchema` typing; and QuickJS has no `atob`/`btoa`, so base64 had to
be hand-rolled for HTTP bodies. A native Ed25519 report signer, or a Solana
`on_report` receiver example for Anchor, would make the Solana path first-class.

---

## The Graph — Best Use of Composable or Standardized Graph Products ($5,000)

| Requirement (verbatim) | Evidence |
|---|---|
| "Either compose two or more of The Graph's products, or build meaningfully on a standardized schema" | `substreams-evm/substreams.yaml` imports The Graph's foundational `ethereum-common@v0.3.3` and declares its `index_events` module as the `blockFilter` for **both** maps (`substreams-evm/substreams.yaml:51` and `:76`), so the provider skips every block that carries no log from the vault or from USDC. `substreams info` prints the populated filter query — reproduced verbatim in `docs/evidence/substreams-live.txt` §1 |
| "Consume live data from a Graph provider, for example Subgraph Studio for Subgraphs or The Graph Market for Substreams" | **Done, with a limitation that must be read alongside it.** `docs/evidence/substreams-live.txt` §2: the full stateful pipeline (`map_vault_flows`) streamed from `hyperevm.substreams.pinax.network:443`, a Graph Market provider, 20 blocks received / 620 processed, ending "Completed successfully". The Graph Market JWT is valid to 2027-10-28. Reproduce with `bun run substreams:hyperevm` (`scripts/substreams-live.sh`). **The run emits no rows.** The Graph indexes HyperEVM **mainnet (999)** only — there is no HyperEVM testnet entry in its networks registry — and the vault is on testnet (998). The server is honest about this rather than papering over it: `source.mode` is `"rpc"` and `/api/health` returns `substreamsAvailable: "no: The Graph indexes HyperEVM mainnet only"` (`server/evm-index.ts:558`). `HUMAN_ACTIONS.md` #2 is the deploy that fixes it |
| "Simply querying one Subgraph with no composition or standardization does not qualify" | Not applicable: no Subgraph is queried. This is two authored Substreams packages with stateful stores, one of them composed on a foundational Graph package |
| "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope" | Two packages authored, both committed as built `.spkg` so a judge without the Rust wasm toolchain can still inspect them: `substreams-evm/shield-evm-behavioral-memory-v0.1.0.spkg` (**five** modules: `map_shield_events`, `store_vault_registry`, `map_vault_flows`, `store_flow_totals`, `map_behavioral_profiles`) and `substreams/shield-behavioral-memory-v0.2.0.spkg` (**seven** — the same five plus `map_shield_instructions` and `store_vault_wallets`, which exist because Solana carries the vault's own instruction stream and EVM logs do not) |
| "Make the standards leverage clear: show what became easier because a shared schema or composed product was used" | See "What the shared schema actually bought" below |
| "Submit a public repository and a short demo video (two to four minutes)" | **Neither exists yet.** The repository is private (`HUMAN_ACTIONS.md` #1) and the video is unrecorded (`HUMAN_ACTIONS.md` #3). These are the two hard fails on this track today |

**What the shared schema actually bought.** The reuse claim is narrower than
"the same pipeline runs on two chains", and this is the accurate version:

- The flow schema is shared by construction. `FlowKind` has the same seven
  variants with the same numbers in both packages
  (`substreams/proto/shield/v1/shield.proto` and
  `substreams-evm/proto/shield/evm/v1/shield_evm.proto`), and the flow message
  has identical field numbering and semantics — only the chain-native
  identifiers differ (`slot`/`signature` on Solana, `block`/`tx_hash` on EVM).
- Because of that, everything downstream of `map_vault_flows` is written once.
  `server/behaviour.ts` (`Flow`, `deriveProfile`) and `server/policy.ts`
  (`assess`) are imported unchanged by both servers — `server/index.ts:45-46`
  and `server/evm-index.ts:17-18` — and the CRE workflow consumes the same
  shape. Adding the EVM chain meant a new decoder and a new manifest; the
  behaviour engine, the loss rule and the verdict path did not change.
- Composing `ethereum-common`'s `index_events` meant not writing a block index.
  The manifest declares which addresses matter and the provider does the
  filtering upstream; the package's own code never sees an irrelevant block.

**Tracks declined.** *Best AI Tooling or AI Use Case with The Graph* (both the
From Scratch and the Continuity pools) — **there is no AI in the shipped
product.** `docs/AI_USAGE.md` documents AI being used to write the repository,
which is a different thing entirely, and claiming the track on that basis would
be a misrepresentation. Pool for the track we do enter: **Start Fresh** — first
commit 2026-09-04, after the event opened.

**Weaknesses, stated rather than hidden.** The pipeline has never produced a
single flow row from a real vault, because the only chain The Graph can see does
not yet hold one. Everything else — the composition, the authentication, the
five-module graph, the store construction — runs live against a Graph Market
provider today. The fix is one deployment: `substreams-evm/substreams.yaml`'s
two `evt_addr` filters and its `initialBlock` move to the mainnet vault, and
nothing else about the package changes. Until then the app runs on
`server/rpc-source.ts`, a labelled fallback with identical classification, and
says so in the UI.

**Feedback for The Graph.** The `substreams-ethereum` and `substreams-solana`
SKILLs were genuinely good on decoding and manifest hygiene, and `substreams
build` worked first time once `protoc` was installed (worth naming `protobuf`
next to `buf` in the prerequisites). Three things cost us real time. The
networks registry has no HyperEVM testnet entry, and nothing in the tooling says
so — a package that is correct in every other way simply returns nothing, and it
took a while to be sure that was the reason rather than our filters; a "this
network is mainnet-only" signal from the CLI would have saved an hour. A
Solana devnet endpoint that serves small ranges without a key (or a sandbox key)
would let a team prove a package works before signing up. And `@substreams/core`
still pins `@bufbuild/protobuf@1`, which collides with newer SDKs that pin v2 —
we had to install v1 at the repository root.

---

## Hyperliquid — the venue, not a sponsor

Hyperliquid is not a sponsor of this event; it is where the money goes. Shield
reads it and never trades on it.

`server/hyperliquid.ts` reads any account's public history — ledger updates and
fills — from the official info API and derives sessions, reloads after loss,
typical and largest losing sessions, and one data-backed insight used in
onboarding and on the Behaviour screen. `app/src/lib/hyperliquid.ts`, through
`app/src/lib/venue.ts`, reads the registered account's equity, positions and
recent PnL for the Setup and Behaviour screens.

**Shield has no order entry.** There is no trade ticket, no order form and no
signing of exchange actions anywhere in the app. The only value-moving action
Shield performs is a release from the vault to a destination the vault already
has registered.
