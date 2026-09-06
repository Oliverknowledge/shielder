# Sponsor integrations

Two partner prizes selected (the rules allow three). Each section states
the exact bounty, the requirement checklist, what implements it, what a
judge can inspect, and what a human still has to do.

---

## The Graph

**Bounty:** "Best AI Tooling or AI Use Case with The Graph (From Scratch)"
($5,000), pool: Net-new / Start Fresh. Secondary Graph track claimed under
the same partner selection: "Best Use of Composable or Standardized Graph
Products" ($5,000).

**Qualification requirements (verbatim) and status**

| Requirement | Status | Where |
|---|---|---|
| "Use The Graph as a load-bearing part of the project… the agent/app uses The Graph (Subgraphs, the Subgraph MCP, or Substreams) as its source of blockchain data." | Done | `substreams/` package (7 modules), consumed by `server/substreams-source.ts` via `@substreams/core` |
| "Consume live data from a Graph provider, for example… streaming Substreams via The Graph Market. Mocked, local-only, or static datasets do not qualify." | Wired; needs the user's API key | Endpoint `devnet.sol.streamingfast.io:443` (The Graph Market, Solana devnet). `SUBSTREAMS_API_TOKEN` switches `/api/health` `source.mode` from `rpc` to `substreams`. Human action #2 |
| "Do meaningful work with the data: reasoning, decisions, automation" | Done | `server/behaviour.ts` (sessions, realised loss, streaks, reload-after-loss), `server/policy.ts` (the user's rule → signed verdict), on-chain `apply_risk_verdict` (cooldown) |
| "Open-source the code with a clear README… public repository plus a short demo video (two to four minutes)" | Code done; video is a human action | `substreams/README.md`, `README.md` |
| "Select the pool that matches how you built" | Start Fresh | first commit 2026-09-04 10:50 UTC |
| Featured: "deploying a working Substreams pipeline from a single prompt using the Substreams SKILLs" | Built with the SKILLs; live run needs the key | `docs/substreams-one-prompt.md` |

**Files**

- `substreams/proto/shield/v1/shield.proto`: one typed message per Shield
  instruction (17) and per event (13); `VaultFlow`; `BehavioralProfile`.
- `substreams/src/lib.rs`: `map_shield_instructions`, `map_shield_events`,
  `store_vault_registry`, `store_vault_wallets`, `map_vault_flows`,
  `store_flow_totals`, `map_behavioral_profiles`.
- `substreams/substreams.yaml` (network `solana-devnet`), `Cargo.toml`
  (`substreams 0.7`, `substreams-solana 0.15`), `build.rs`.
- `server/substreams-source.ts`: streams `map_vault_flows` with a resumable
  cursor, undo handling and reconnect/backoff.
- `server/rpc-source.ts`: the labelled fallback with identical classification.

**Package identifier:** `shield_behavioral_memory@v0.2.0`
(`substreams build` → `shield-behavioral-memory-v0.2.0.spkg`, 575 KB;
`substreams info` lists the 7 modules). Publishing to substreams.dev
(`substreams publish`) needs the same account.

**How it is used in the product:** the Behaviour screen ("You sent $1,500 to
Axiom. $80 came back."), the Overview's loss strip and "What happened
recently" feed, the top-up blocked card ("You've realised $1,420 in losses in
the last hour"), and the monitor's verdict all come from flows the pipeline
classifies. Remove it and none of those exist.

**Demo moment:** Behaviour screen after the trading wallet sends back less
than it received: "Sent $1,500 · Came back $80 · Net realised flow −$1,420",
the session bar, the evidence sheet with transaction signatures, and the
source label.

**Evidence a judge can inspect**

```bash
cd substreams && substreams build && substreams info shield-behavioral-memory-v0.2.0.spkg
curl -s localhost:8787/api/health | jq .source        # {"mode":"substreams", ...} once keyed
curl -s localhost:8787/api/vault/<vault>/flows | jq   # the classified flows the app reasons over
```

**Feedback for The Graph** (as the bounty requests): the `substreams-solana`
SKILL was excellent on decoding and manifest hygiene, and the CLI's
`substreams build` "just worked" once `protoc` was present (the SKILL should
list `protobuf` next to `buf`). Two things would have removed our biggest
friction: a Solana devnet endpoint that does not require a key for tiny
ranges (or a sandbox key), and first-class Substreams-powered subgraphs for
Solana on the Network so the queryable layer could be GraphQL rather than a
custom sink. The registry search API and the JS sink reference were
accurate; the `@substreams/core` peer on `@bufbuild/protobuf@1` collides
with newer SDKs that pin v2 (we had to install v1 at the root).

**Remaining human step:** create a free key at https://thegraph.market,
`substreams auth`, set `SUBSTREAMS_API_TOKEN`, restart the server, record
the `source.mode: "substreams"` health output and a `substreams run`.

---

## Chainlink

**Bounty:** "Best Confidential Workflow" ($2,000, up to 2 × $1,000).

**Qualification requirements (verbatim) and status**

| Requirement | Status | Where |
|---|---|---|
| "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part of the application." | Done | `cre/shield-risk/main.ts`, `cre/shield-risk/evaluate.ts` |
| "The workflow must register and use a confidential TEE handler, such as handlerInTee" | Done | `handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])` |
| "The confidential portion… must process at least one sensitive input, secret, confidential API response, private parameter, or intermediate value inside the enclave." | Done | secret: the verifier seed (`runtime.getSecret`); sensitive inputs: the user's raw capital flows and policy fetched with `HTTPClient.sendRequest(teeRuntime, …)`; intermediate: derived sessions and the signed verdict |
| "meaningfully integrated into the project's core functionality" | Done | the verdict is the only external input the vault accepts (`apply_risk_verdict`); it arms the user's loss cooldown |
| "Demonstrate a successful execution through either: A Confidential Workflow simulation using the CRE CLI or a live deployment" | Compiled; simulation needs the user's Chainlink account | `cre workflow simulate` refuses without `CRE_API_KEY`/`cre login`. Human action #3 |
| "Provide evidence… demo video, terminal output, execution logs" | Local dry-run evidence below; CLI evidence after the human step | |

**Files:** `cre/project.yaml`, `cre/secrets.yaml`, `cre/.env.example`,
`cre/shield-risk/{workflow.yaml,config.staging.json,main.ts,evaluate.ts,dryrun.ts}`,
`cre/README.md`, `scripts/print-verifier-seed.ts`. On-chain verifier:
`programs/shield-vault/src/lib.rs` (`apply_risk_verdict`) and
`src/ed25519.rs`.

**Artifact:** `cre/shield-risk/dist/shield-risk.wasm` (2.78 MB) built by
`bunx cre-compile cre/shield-risk/main.ts …` with `@chainlink/cre-sdk`
1.19.1 through the javy toolchain.

**How it is used:** the enclave function is Shield's monitor. Shield's
server runs the same `evaluate()` as a deterministic demo path; the vault
pins one verifier key, so either the enclave or the server is the signer,
never both. In the demo the server signs; the human step swaps the signer
to the CLI simulation.

**Demo moment:** the terminal shows the enclave evaluation and verdict
delivery; the app flips from "Protected" to "Loss cooldown" within a
polling cycle; a top-up is then rejected on-chain with `CooldownActive`.

**Evidence captured in this environment (localnet, server monitor off, so
the enclave function was the only signer)**

```
$ bun run cre/shield-risk/dryrun.ts CMH7osbKjrT67Ye7Zg3Js4gLx2pJjudMFgRLGEvdnAMz
[USER LOG] Enclave evaluation: vault=CMH7… flows=3 realisedLoss24h=1200000000 trigger=1000000000
           lossStreak=1 reloadsAfterLoss=0 triggered=true actionable=true
[USER LOG] Verdict #1 relayed on-chain: 5H17fZbSd9xoETm6nUYUNzDqMw5LXEBeX7Jc6VdjXpDySxBBbYCf8MNF5uQHCM4opjtYDCAnnA5MngY4fCFLiL6h
{ "triggered": true, "actionable": true, "realisedLossUsdc": "1200000000", "nonce": "1",
  "verifier": "GL3TVjiPCyF6ZyeUxXYrXZKcr6JFdwQovGrpVakhXHXy", "relayed": true, … }
$ bun run client/demo.ts scoreboard | grep Cooldown
  Cooldown               ACTIVE (loss rule) until 9/6/2026, 5:25:40 PM — 17h 59m left
$ bun run client/demo.ts top-up 100
❌ instant top-up rejected on-chain: CooldownActive
```

`dryrun.ts` runs the same `evaluateVault()` the TEE handler runs, with
`fetch` and `cre/.env` standing in for the enclave HTTP capability and the
Vault DON. It is not a CRE simulation; it demonstrates the logic and the
on-chain effect while the CLI evidence is pending.

**Feedback for Chainlink:** the TS SDK's `handlerInTee` + `TeeRuntime`
overloads were clear and the compile toolchain was painless. Friction: the
simulator requires an account even for local runs (a no-auth simulate for
workflows with no chain writes would help hackathon teams); `CreSerializable`
rejecting `null` is surprising (an error message naming the offending field
would help); zod `.default()` breaks the `configSchema` typing; QuickJS
lacking `atob`/`btoa` meant hand-rolling base64 for the HTTP body. A native
Ed25519 report signer, or a Solana `on_report` receiver example for Anchor,
would make the Solana path first-class.

**Remaining human step:** `export CRE_API_KEY=…` (or `cre login`), then the
one-line simulate command in `cre/README.md`; capture the terminal output.


---

# 2026-09-06 additions: the Hyperliquid-first stack

The sections above describe the Solana (v0) stack, which still runs unchanged.
This section is what changed for the Hyperliquid-first build; where a claim
is credential-gated it says so.

## Privy — Best financial flow

**Exact track:** Privy, "Best financial flow" ($2,500).

**Files:** `app/src/lib/privy.tsx` (PrivyProvider: email / passkey / wallet
login, embedded Ethereum wallet created on login, HyperEVM as default chain;
a bridge that hands the embedded wallet's EIP-1193 provider to the engine),
`app/src/lib/evm-engine.ts` (every vault transaction is signed by that
wallet: activate, deposit, top-up, tighten, propose, cancel, cold transfer,
exit), `app/src/pages/Welcome.tsx` (sign-in), `app/src/pages/Trade.tsx`
(agent-key trading; the master approval is user-signed by the same wallet).

**Why it matters to the user:** no seed phrase ceremony, one identity across
the vault and the venue, and ordinary trading without prompts once an agent
key is approved. Adding capital is the only thing that ever asks for a
deliberate signature, which is exactly the friction the product wants.

**Why it is load-bearing:** the embedded wallet is the vault's sole authority
and the Hyperliquid master account. Remove it and the user is back to
managing an EOA by hand.

**The financial flow:** deposit USDC into the vault → governed top-up
delivered by the vault into the user's Hyperliquid perps account
(`CoreDepositWallet.depositFor`) → trade via an agent key → withdraw
Core→EVM and return USDC to the vault. All signatures by the Privy wallet.

**Verification:** set `VITE_PRIVY_APP_ID` (HUMAN_ACTIONS.md #1), open the
app, sign in with email, complete the setup wizard, top up, watch the
Hyperliquid account. Without an app ID the identical code path runs with a
pasted demo key (Anvil dev key) and was verified end to end on Anvil.

**Remaining blocker:** a Privy app ID (5 minutes, dashboard.privy.io).

## The Graph — HyperEVM package (composable track evidence)

**Files:** `substreams-evm/` (`substreams.yaml`, `src/lib.rs`, proto). Imports
The Graph's foundational `ethereum-common@v0.3.3` package and uses its
`index_events` block index as the `blockFilter` for both maps (`evt_addr:` of
the vault contract and of native USDC), so blocks with nothing relevant are
skipped before any decoding. Module shape is identical to the Solana package:
typed events → registry store → capital flows (incl. USDC returns) → totals →
profiles. Network: `hyper-evm` (Pinax on The Graph Market:
`hyperevm.substreams.pinax.network:443`).

**Standards leverage:** the same five modules run on Solana devnet and HyperEVM.
The behaviour engine (`server/behaviour.ts`), the policy (`server/policy.ts`)
and the CRE workflow consume `map_vault_flows` from either without change.

**Remaining blocker:** a Graph Market key and a HyperEVM mainnet deployment
of the vault (HUMAN_ACTIONS.md #2–#3). Testnet HyperEVM is not indexed by
The Graph.

## Chainlink CRE — EIP-712 verdicts

**Files:** `cre/shield-risk/evm-verdict.ts` (dependency-light EIP-712 hashing
+ secp256k1 signing that runs in the enclave's JS runtime; verified against
`ShieldVault.hashVerdict` and `ecrecover`), `cre/shield-risk/evaluate.ts`
(`chain: "evm"` path), `cre/shield-risk/config.evm.json`, secret
`SHIELD_EVM_VERIFIER_KEY` in `cre/secrets.yaml`.

**Evidence produced this sprint:** `bun run cre/shield-risk/dryrun.ts --evm
0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` against the Anvil server with the
server monitor disabled: the enclave function derived a $1,420 realised loss,
signed verdict #1, the relayer landed it
(`0x94d38cc9bd0e27468d9857a0db19de2755f24abfb2bb5afd29624db6da9e66ac` on the
local chain) and the vault's cooldown armed (`cooldownReason = 2`).

**Remaining blocker:** `cre workflow simulate` needs a Chainlink account
(HUMAN_ACTIONS.md #4); the dry-run exercises the same function.

## Hyperliquid (venue, not a sponsor)

`server/hyperliquid.ts` reads any account's public history (ledger updates +
fills) from the official info API and derives sessions, reloads after loss,
typical and largest losing sessions, and a single data-backed insight used in
onboarding and on the Behaviour screen. `app/src/lib/hyperliquid.ts` +
`Trade.tsx` show live prices (real on every build) and place orders with an
approved agent key (real Hyperliquid networks only; the local demo says so).
