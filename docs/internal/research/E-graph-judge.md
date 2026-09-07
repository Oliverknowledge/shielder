# Agent E — The Graph judge's review of Shield (ETHOnline 2026)

Reviewer stance: senior DevRel judge for The Graph, scoring against the
verbatim criteria in `docs/internal/gauntlet/CRITERIA.md` and the live prize
page (re-read 2026-09-07; the page's description text is quoted where it adds
to the criteria file). Read-only pass over `substreams-evm/`, `substreams/`,
`server/behaviour.ts`, `server/policy.ts`, `server/hyperliquid.ts`,
`server/substreams-source.ts`, `server/evm-index.ts`, `cre/shield-risk/evaluate.ts`,
`contracts/src/ShieldVault.sol` (events), `docs/evidence/substreams-live.txt`,
`docs/SPONSOR_INTEGRATIONS.md`, `docs/SUBMISSION.md`, `docs/DEMO_SCRIPT.md`,
`docs/substreams-one-prompt.md`, `docs/internal/research/01-capital-ladder-design.md`.

Web checks made: ethglobal.com prize page (The Graph tracks), thegraph.com
`ai-overview`, `supported-networks/hyper-evm` (network id `hyper-evm`,
`eip155:999`, type `mainnet`; no testnet page exists), docs.substreams.dev
(`ethereum-common@v0.3.3` module list, published-package composition syntax,
publish flow, Hosted Sinks, chains-and-endpoints), streamingfast/substreams-skills
(nine SKILLs, `EVAL.md`, 14 case studies). The Substreams-powered-subgraph
docs page 404'd on two paths; statements about `graph_out` below are from the
`substreams-entity-change` convention and are marked as such.

---

## 0. Things a judge finds in the first ten minutes (fix before anything else)

These are not scoring items; they are credibility items. A Graph judge greps.

1. **Two of the "five modules" are consumed by nothing.** Both servers stream
   only `map_vault_flows` (`server/evm-index.ts:526`, `server/index.ts:290`).
   `store_flow_totals` and `map_behavioral_profiles` have no consumer in the
   repository, no test, and no mention in the app. They are the modules the
   pitch calls "behavioural memory". Today the memory is `server/behaviour.ts`
   re-deriving everything from the raw flow list, and the package's own
   derivation is dead weight.
2. **"We never wrote a log scanner" (`docs/SUBMISSION.md:438`) is not true.**
   `substreams-evm/src/lib.rs` iterates `block.logs()` and address-filters in
   WASM in both `map_shield_events` and `map_vault_flows`. `index_events`
   prunes *blocks*; it does not replace the scan. The module that would is
   `ethereum_common:filtered_events` (present in v0.3.3, takes the same
   `evt_addr:`/`evt_sig:` params), and it is not used. Say "the provider skips
   blocks with no matching log" and nothing more, or actually use
   `filtered_events`.
3. **"One shared schema" is true for `Flow` and false for `BehavioralProfile`.**
   EVM: `sent_to_execution / returned_from_execution / net_execution_flow /
   deposited / top_up_count / return_count`. Solana: `total_sent_to_execution /
   total_returned_from_execution / net_realized_flow / total_deposited /
   total_exited / execution_wallets[] / last_updated_slot / last_updated_at`.
   Different names, different shape. Narrow the claim to the flow message.
4. **`ShieldEvent.fields` is `map<string,string>`.** The comment says "so the
   schema is stable across versions". To a Graph judge a stringly-typed map is
   the absence of a schema, and it is the opposite of what the track rewards.
   `map_vault_flows` then re-parses amounts from strings. Typed per-event
   messages (as the Solana package already has: 13 event messages) are the
   norm the SKILLs enforce.
5. **Block counts disagree.** `docs/evidence/substreams-live.txt` §2: "Received
   Blocks: 20". `docs/SUBMISSION.md:347`: "processes 620 blocks". One of them
   is stale.
6. **The negative control proves the JWT, not the data.** §4 is good practice
   and I would keep it, but the composable track's data clause is about rows,
   and there are none. Do not let the negative control stand in for that.

---

## 1. Scores against the verbatim criteria

### Track A — Best Use of Composable or Standardized Graph Products

| Clause (verbatim) | Verdict | Why |
|---|---|---|
| "Either compose two or more of The Graph's products, or build meaningfully on a standardized schema" | **PARTIAL** | One foundational package imported and used only as a `blockFilter`. That is composition in the letter (`substreams info` shows `ethereum_common:index_events` hashed into the graph) and it is the thinnest form of it: every `substreams init` EVM template in 2026 scaffolds exactly this. No standardized schema is used or extended; Shield's schema is its own. The Solana package imports nothing. |
| "Consume live data from a Graph provider, for example Subgraph Studio for Subgraphs or The Graph Market for Substreams" | **PARTIAL, close to FAIL** | The stream authenticates, runs, completes, and delivers zero application rows (§2, §3). The running product consumes RPC (`source.mode: "rpc"`). The AI track's own wording ("mocked or local datasets do not qualify") tells you how judges read "consume live data": data the product acts on. A completed empty stream is proof of plumbing, not consumption. |
| "Simply querying one Subgraph with no composition or standardization does not qualify" | PASS (n/a) | Not a subgraph query. This clause never helps; it only disqualifies. |
| "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope" | **PARTIAL** | Two packages authored and committed, `registry verify` passes, neither published. "Reusable" is not demonstrated: everything is keyed to the ShieldVault ABI. The one genuinely general idea in the code (ERC-20 transfers back into a container from a registered counterparty set, in blocks with no container event) is not factored into a module anyone else could import. |
| "Make the standards leverage clear: show what became easier because a shared schema or composed product was used" | **PARTIAL** | Two claims made. (a) "Did not write a block index" — real but tiny, and undercut by item 0.2. (b) "Downstream written once for two chains" — true for `Flow`, and it is Shield's *own* schema, which is internal consistency, not standards leverage. Nothing outside Shield became easier. |
| "Submit a public repository and a short demo video (two to four minutes)" | **FAIL** | Repo private, no video (`HUMAN_ACTIONS.md` #1, #3). Hard gate. |

**Track A today: 4 / 10.** With the repo public and a video containing the
current zero-row beat: 5 / 10. That is a "qualifies, does not place" score.

What a first-place entry in this track typically shows that Shield does not:

- **Rows on screen from a Graph provider**, either in `substreams gui`, a
  Hosted Sink table, or a Studio playground — the data the product uses,
  not a connectivity check.
- **Real composition**: their package's map takes another package's *map
  output* as input (`map: pkg:module`), not just a block index. Usually one
  foundational package plus one protocol package (e.g. `ethereum_common:
  filtered_events` + an ERC-20/`uniswap_v3` package), or a general module
  they authored and then imported into a second, specific package.
- **A published package on substreams.dev** with a doc, a proto someone else
  could target, and a second consumer (their own app plus a sink, or two
  apps) to prove reuse.
- **A before/after sentence that survives scrutiny**: "we imported X and
  deleted N lines / got Y for free", with the deletion visible in git.
- For the "standardized" half: a subgraph that extends a shared schema and
  one query returning rows across several protocols. Shield has one
  protocol; this half of the track is not available to it and it should not
  pretend otherwise.

### Track B — Best AI Tooling or AI Use Case (From Scratch)

Shield declined this track. Scored anyway, because question 3 asks whether it
should.

| Clause (verbatim) | Verdict | Why |
|---|---|---|
| "Use The Graph as a load-bearing part of the project: either the AI tooling targets The Graph's products or AI Suite …" | **FAIL** | The product runs on the RPC fallback; the CRE reads flows from Shield's server, which read them from RPC. Remove The Graph and nothing in the demo changes. That is the definition of not load-bearing. |
| "Consume live data from a Graph provider" | PARTIAL | As above. |
| "Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface" | PASS on the clause, FAIL on provenance | The CRE verdict and the vault's `applyRiskVerdict` are real decisions and real automation. They are done on RPC data. |
| "Open-source the code with a clear README or SKILL.md so judges can run it" | FAIL | Private. |
| "Select the pool that matches how you built" | PASS | Start Fresh is correct. |
| "For the Substreams one-prompt deployment challenge: demonstrate deploying a working Substreams pipeline from a single prompt using the Substreams SKILLs" | **PARTIAL** | `docs/substreams-one-prompt.md` records the prompt and the artefacts, admits "iterations", "no golden-reference EVAL.md run", and — the word the clause hinges on — nothing was *deployed*: no published package, no Hosted Sink, no rows. |

**Track B today: 2 / 10.** Declining it was the right call *for the product
as framed*. See §3 for the one door that is honestly open.

First-place entries in this track show an agent or app whose decisions
demonstrably come from Graph data (a query or stream visible in the log
next to the decision), or a tool that makes a Graph product usable from an
AI environment with a runnable SKILL.md, or — for the featured challenge — a
prompt, the transcript, the package it produced, and a deployed sink with
rows, all in one repo.

---

## 2. Could a Risk Ladder + Risk Desk make The Graph load-bearing?

Yes, but only under one condition that has nothing to do with the ladder:
**rows must exist**. Every module below yields zero output on HyperEVM
testnet, because The Graph's registry has `hyper-evm` as `eip155:999`,
`mainnet`, and no testnet entry (confirmed on `supported-networks/hyper-evm`
and the chains-and-endpoints list). The ladder changes *what* The Graph
remembers; it does not change *whether* it can see the vault. Do not build
§2.2 before §5 recommendation 1 is done.

### 2.1 What on-chain data can and cannot say (this bounds every candidate)

`server/policy.ts:114-130` already states the limit correctly: the flow view
cannot tell capital that was lost from capital still deployed at the venue.
HyperCore is not on HyperEVM; the Graph sees the vault boundary and USDC, not
fills. So anything named "loss" computed in Substreams is a lie by naming.
The honest on-chain quantity is **net return deficit**: capital that left to
a trusted execution counterparty and has not come back. Name it that.

This is not a weakness to hide; it is the division of labour the brief
already wants: *The Graph remembers capital behaviour (what left, what
returned, how fast, how often, after what); Hyperliquid reports PnL;
Chainlink decides in private; the vault enforces.* A judge will respect a
package whose field names admit what they measure.

Second bound: **refused reloads never touch the chain.** The app asks the
contract first (`eth_call` → `CooldownActive`, `docs/DEMO_SCRIPT.md` 2:56)
so no transaction is sent; and even if one were, `ethereum_common:all_events`
is documented as "events … from successful transactions", so a reverted
`instantTopUp` yields nothing through the composed path. `ReloadBlocked` is
therefore not computable without changing the product to spend gas recording
refusals — which is bounty-bait and bad for the user. The on-chain proxy that
*is* honest is `TopUpProposed` (a reload that had to wait).

Third bound: rolling windows. Substreams stores have no expiry. "Last 24h"
is done with day-bucketed keys the consumer sums, or by indexing the number
the contract already emits (`TopUpExecuted.velocityAfter` is the vault's own
24h rolling sum — index it, do not recompute it).

### 2.2 Candidate by candidate

Legend: **Chain** = computable from on-chain data alone (which events);
**Reuse** = would a risk monitor / treasury / agent wallet / gambling-
protection system want this field unchanged; **Bait** = would a judge read
it as invented to hit a bounty.

**Raw events**

| Candidate | Chain | Reuse | Bait | Verdict |
|---|---|---|---|---|
| CapitalProtected (→ general `Deposit`) | Yes: `Deposited` | High: every container has an inflow | No | Keep; already `FlowKind.DEPOSIT` |
| CapitalReleased (→ `Release`) | Yes: `TopUpExecuted` (+`instant`, `velocityAfter`, `route`), `ColdTransferExecuted` | High | No | Keep; already `TOP_UP_*`/`COLD_TRANSFER`. Carry `velocityAfter` and `route` as typed fields, not strings |
| CapitalReturned (→ `Return`) | Yes: USDC `Transfer(from=registered, to=container)` not in a `Deposited` tx | High: the general "money came back from a trusted counterparty" | No | Keep; this is the best module in the package. Factor it out (§2.3) |
| ReloadAttempted / Allowed | Allowed = `TopUpExecuted`; Attempted = not on chain (see bound 2) | — | Attempted: yes | Drop "Attempted". "Allowed" is `Release` |
| ReloadBlocked | **No** | — | **Yes** | Do not add. Use `TopUpProposed` as `ReleaseDeferred` |
| CooldownTriggered (→ `RestrictionApplied`) | Yes: `RiskVerdictApplied`, and `PolicyTightened` when `cooldownUntil` rises | High for any policy-gated container | No | Add, with `source: SELF \| VERIFIER` and `until` |
| RuleTightened (→ `PolicyTightened`) | Yes: `PolicyTightened` | Medium | No | Add |
| WeakeningRequested (→ `PolicyRelaxationProposed/Executed/Cancelled`) | Yes: `LoosenProposed`, `LoosenExecuted`, `ProposalCancelled` | Medium-high: "asked to weaken, then did/didn't" is the self-exclusion metric regulators care about | No | Add; the *gap* between proposed and executed is the interesting derived number |
| RiskTierChanged | Only after v3 ships the ladder | Medium | Yes, if indexed before the event exists | Add only with the ladder, as `RestrictionApplied{tier}` |

**Derived behaviours**

| Candidate | Chain | Reuse | Bait | Verdict |
|---|---|---|---|---|
| PostLossReloadCount (→ `releases_after_deficit_7d`) | Yes: a `Release` within W of a `Return` that closed a session net-negative. Needs a session store (below). Currently `reloadsAfterLoss7d` in `behaviour.ts:262-266` | **High**: "deposit after a loss" is the chasing metric in gambling-harm literature and any treasury/agent-spend monitor wants it | No, if named `after_deficit` not `after_loss` | **Put in the package** |
| ReloadVelocity (→ `released_24h`) | Yes: index `velocityAfter` from `TopUpExecuted`; plus day-bucket sums for cold transfers | High | No | Put in the package as day buckets + last `velocityAfter` |
| CapitalExpansionRate | Yes-ish: per-day release sums and counts; medians are awkward in stores | Medium | Medium if you compute a "rate" in WASM with Shield's own formula | Emit day buckets only; consumers compute trends |
| RiskExpansionSequence | Computable but the sequence definition is Shield's editorial | Low | **High** | Keep in the consumer |
| SafetyReturnRate (→ `return_ratio`) | Yes: `returned / released` per container and per counterparty (already `net_execution_flow`) | High | No | Put in the package (it is one division on existing totals) |
| SessionCapitalDelta (→ `Session{released, returned, net, opened_at, closed_at}`) | Yes with a state machine store per `container:counterparty`; close rule = "next release after a return" (`buildSessions`) — make the rule a param | High | No, provided the rule is a parameter | **Put in the package**; it is the primitive the two above depend on |
| ProtectionActivationFrequency (→ `restrictions_30d`) | Yes: count of `RestrictionApplied` per day bucket | Medium | Low | Add as a counter; cheap |

Net: the package should own **sessions, deficit-followed-by-release, return
ratio, release velocity, restriction/relaxation counts**. The server should
keep **medians, streaks, sequences, insight text, and anything that mixes in
Hyperliquid PnL**. That split is defensible in front of a judge because each
side computes only what its data can honestly support.

### 2.3 Smallest reusable extension — module names, keys, protos

Two packages, not one. This is what makes "compose two or more" true beyond
argument and what makes "reusable" demonstrable (Shield is the second
consumer of the first package).

**Package 1 — `custody-boundary` (general; publish to substreams.dev)**

Purpose: money crossing the boundary of any address that holds funds on
someone's behalf (a vault, a treasury, an agent wallet's allowance contract,
a self-exclusion escrow), attributed to a counterparty role. No Shield ABI
anywhere in it.

```yaml
imports:
  ethereum_common: ethereum_common@v0.3.3
params:
  map_boundary_transfers: "evt_addr:<token> && evt_sig:0xddf252ad…"   # ERC-20 Transfer
modules:
  - name: map_boundary_transfers        # consumes a foundational MAP, not just the index
    kind: map
    inputs:
      - params: string                  # container addresses (one or many), token
      - map: ethereum_common:filtered_events
    output: { type: proto:custody.boundary.v1.Transfers }
  - name: store_counterparty_roles      # set: role:<container>:<counterparty> -> TRUSTED_EXECUTION|COLD|SELF
    kind: store
    updatePolicy: set
    valueType: string
    inputs:
      - map: map_boundary_transfers     # default role: UNKNOWN; a *consumer package* upgrades roles (see below)
  - name: store_sessions                # set: session:<container>:<cp> -> "opened_at|released|returned|returns"
    kind: store
    updatePolicy: set
    valueType: string
    inputs: [{ map: map_boundary_transfers }]
  - name: map_session_events            # emits SessionOpened/SessionClosed{net} when the state machine transitions
    kind: map
    inputs: [{ map: map_boundary_transfers }, { store: store_sessions, mode: deltas }]
    output: { type: proto:custody.boundary.v1.SessionEvents }
  - name: store_signals                 # add: released:<c>:<day>, returned:<c>:<day>, releases_after_deficit:<c>:<day>,
    kind: store                          #      deficit_sessions:<c>:<day>, restrictions:<c>:<day>
    updatePolicy: add
    valueType: int64
    inputs: [{ map: map_boundary_transfers }, { map: map_session_events }]
  - name: map_signals                   # per-container snapshot on change
    kind: map
    inputs: [{ store: store_signals, mode: deltas }, { store: store_signals, mode: get }]
    output: { type: proto:custody.boundary.v1.Signals }
```

Proto (`custody/boundary/v1/boundary.proto`), chain-agnostic on purpose:

```proto
enum Direction { IN = 0; OUT = 1; }
enum CounterpartyRole { UNKNOWN = 0; TRUSTED_EXECUTION = 1; COLD = 2; SELF = 3; }
enum Kind { DEPOSIT = 0; RELEASE = 1; RELEASE_DEFERRED = 2; RETURN = 3; EXIT = 4; }
message Transfer  { uint64 height = 1; uint64 ts = 2; string ref = 3;   // tx hash or signature
                    string container = 4; string counterparty = 5; CounterpartyRole role = 6;
                    Direction direction = 7; Kind kind = 8; string asset = 9; uint64 amount = 10; }
message Session   { string container = 1; string counterparty = 2; uint64 opened_at = 3; uint64 closed_at = 4;
                    uint64 released = 5; uint64 returned = 6; int64 net = 7; uint32 releases = 8; uint32 returns = 9; }
message Signals   { string container = 1; uint64 as_of = 2;
                    uint64 released_24h = 3; uint64 released_7d = 4; uint64 returned_7d = 5;
                    uint32 releases_after_deficit_7d = 6; uint32 deficit_sessions_7d = 7;
                    int64  open_exposure = 8;            // released - returned in the open session
                    uint32 return_ratio_bps = 9;         // returned*1e4/released, lifetime
                    uint32 restrictions_30d = 10; uint32 relaxations_proposed_30d = 11; uint32 relaxations_executed_30d = 12; }
```

**Package 2 — `shield-vault` (Shield-specific; imports both)**

```yaml
imports:
  ethereum_common: ethereum_common@v0.3.3
  custody: custody-boundary@v0.1.0
modules:
  - name: map_shield_events            # typed per-event messages (drop the map<string,string>)
    inputs: [{ params: string }, { map: ethereum_common:filtered_events }]
  - name: store_vault_registry         # as today
  - name: map_vault_flows              # JOIN: custody:map_boundary_transfers ⨯ map_shield_events ⨯ store_vault_registry
    inputs:                             #  - upgrades role UNKNOWN -> TRUSTED_EXECUTION/COLD from RegistrationChanged
      - map: custody:map_boundary_transfers   #  - tags RELEASE vs RELEASE_DEFERRED from TopUpExecuted.instant / TopUpProposed
      - map: map_shield_events                #  - emits RestrictionApplied / PolicyRelaxation* from vault events
      - store: store_vault_registry
    output: { type: proto:custody.boundary.v1.Transfers }   # same schema out as in
  - name: map_restrictions             # RiskVerdictApplied, PolicyTightened, Loosen* -> custody.boundary.v1.Restrictions
```

The honest limit of Substreams composition: an imported package cannot take
the importer's modules as input, so `custody-boundary`'s own `store_sessions`
only ever sees `UNKNOWN`-role transfers unless roles are supplied by params.
Two ways out, pick one and say which: (a) `custody-boundary` accepts the
trusted-counterparty list as a param (fine for a treasury or agent wallet,
where the list is static; Shield passes its registry as params only for the
demo); (b) Shield's package re-runs the session/signal modules on its
role-upgraded transfers — same Rust crate, same proto, imported as a
library. (b) is the one that stays correct as registrations change; it means
the *schema and code* are reused and the *foundational map* is composed. Do
not claim more than that.

**How the Solana package shares the schema.** Vendor one
`custody/boundary/v1/boundary.proto` at the repo root and point both
manifests' `protobuf.importPaths` at it; both `map_vault_flows` output
`proto:custody.boundary.v1.Transfers`. `height`/`ref` replace the
`slot|block` / `signature|txHash` aliasing in `server/substreams-source.ts:
flowsFromMapOutput`, which then deletes code — a visible "what became
easier". For symmetry compose `solana-common`'s program-id index/filtered
transactions on the Solana side (check the current version on substreams.dev
before claiming it). Sharing the proto by importing a proto-only package is
possible in principle; I have not verified the CLI merges imported
descriptors for `output.type`, so vendor the file.

**Is this artificial?** The general package is exactly what a treasury
monitor, an agent-wallet spend policy, or a self-exclusion escrow would index;
the names contain no Shield vocabulary; and Shield deletes server code by
adopting it. That is the test. `RiskExpansionSequence`, `ReloadBlocked`, and
a pre-emptive `RiskTierChanged` fail it.

### 2.4 Making it load-bearing, not decorative

Load-bearing means: a decision the demo shows was computed from the Graph
stream. Two changes, in order of honesty:

1. `server/behaviour.ts` in `substreams` mode consumes `map_signals` rather
   than re-deriving from raw flows, and a test asserts the two derivations
   agree on a fixture (`server/behaviour.test.ts` has 7 tests; add one
   fixture-parity test). Then `/api/health` says `source.mode: "substreams"`
   *and* `signals.source: "substreams"`.
2. The CRE enclave reads the signals over HTTP from a Graph surface rather
   than from Shield's server: a Substreams-powered subgraph (`graph_out` →
   `sf.substreams.sink.entity.v1.EntityChanges`, queried from Studio's
   GraphQL endpoint with an API key) is the only Graph surface the enclave's
   HTTP capability can reach. Requires an indexer serving `hyper-evm`
   Substreams-powered subgraphs; unverified — if it is not available, a
   Hosted SQL sink plus a thin read-only shim is the fallback, and the shim
   must be described as a shim.

With 1 alone the Graph is load-bearing for the product. With 2 it is
load-bearing for the *verdict*, which is the sentence in the brief.

---

## 3. The AI track, read literally

Question: is a deterministic risk monitor that consumes Substreams output and
makes decisions (CRE verdict, ladder) within "AI Use Case"?

**NO — as a claim for the product.** The qualification list says "Do
meaningful work with the data: reasoning, decisions, automation, or a
natural-language interface" and never says an LLM must do it, and the prize
description literally lists "risk monitors" among "AI agents or apps that use
The Graph as their live source of blockchain data". A deterministic monitor
satisfies every *clause*. It fails the *title*: "AI Tooling or AI Use Case".
A judge reads the title first, asks "where is the AI?", and Shield's own
`docs/JUDGE_QA.md` answers "there is no AI in the shipped product at all".
Entering on the clauses while the repo says that is the misrepresentation
Shield already decided not to make. Adding an LLM to manufacture the word
would be worse: nothing in the product improves and the threat model gets a
new actor.

**YES — for the featured challenge, which is a different thing.** "For the
Substreams one-prompt deployment challenge: demonstrate deploying a working
Substreams pipeline from a single prompt using the Substreams SKILLs." Here
the AI is the developer, not the product, and Shield's `AI_USAGE.md` stance is
consistent with that. `docs/substreams-one-prompt.md` is the right artefact in
the wrong state. For a judge to accept it without theatre, all of these must
be true:

1. **One prompt, one transcript, committed.** The prompt is already in the
   doc. Add the session transcript (or its diff) and the exact SKILL
   versions used. The doc's "iterations were limited to …" must become a
   list of the human edits, in a commit a judge can diff.
2. **Deployed**, in the word's ordinary sense: the produced `.spkg` published
   on substreams.dev *and* running in a Hosted Sink on The Graph Market (the
   `substreams-hosted-sink` and `thegraph-market-api` SKILLs exist for
   exactly this), with rows. "Built and `substreams run` completes" is not
   deployed.
3. **The deployed pipeline is the one the product consumes** (§2.4 item 1).
   Otherwise it is a demo pipeline beside the product and a judge will say
   so.
4. **Optional but persuasive:** run the skills repo's `EVAL.md` procedure on
   the package and report the result, pass or fail.

Enter it as "one-prompt deployment challenge; the product itself contains no
AI, the AI built the pipeline" and it is honest. Whether ETHGlobal lets one
team apply to two tracks of the same sponsor: `docs/SPONSOR_INTEGRATIONS.md`
says "A partner with several tracks counts once", which implies yes; confirm
on the submission form before counting on it.

---

## 4. The 20 seconds a Graph judge cares about

Today's beat (`DEMO_SCRIPT.md` 2:14) shows `Completed successfully` with zero
rows and then explains why. That is the anti-demo: the judge remembers
"empty". Replace it with, in order:

- **0–6 s** `substreams gui shield-vault.spkg map_signals -e
  hyperevm.substreams.pinax.network:443 -s <deploy block>` — a row appears
  for the demo vault: `released_24h`, `returned_7d`, `releases_after_deficit_7d: 1`,
  `open_exposure`. Say: "This is The Graph remembering the vault. Two
  packages: one general, one ours."
- **6–12 s** The manifest's `imports:` block on screen with both packages,
  and the substreams.dev page of `custody-boundary` in a tab. Say: "The
  general one is published; Shield is its second consumer."
- **12–20 s** The CRE log line naming the signal (`signals.source=substreams
  releases_after_deficit_7d=1`) and the pause landing. Say: "The verdict
  read that row."

If rows cannot exist (no mainnet deploy), the honest 20 seconds is the same
`gui` on the **Solana devnet** twin with the v0 program deployed there —
rows from a Graph provider, same proto — followed by "the EVM vault is on a
testnet The Graph does not index; the package is identical". Weaker, still a
row.

Do not show the negative control in the video; it belongs in the evidence
file.

---

## 5. Recommendations, ranked

| # | Do | Effort | Expected delta | Notes |
|---|---|---|---|---|
| 1 | **Get rows.** Deploy v2 to HyperEVM mainnet (`docs/MAINNET_RUNBOOK.md`), run the demo vault's full flow (deposit, register, $5 release, $1 return) from the Privy wallet, set `initialBlock` to the deploy block, re-capture `substreams-live.txt` with rows. Fallback if real USDC is off the table: deploy the Solana v0 program to devnet and stream the Solana package (`devnet.sol.streamingfast.io` is a Graph provider; toolchain quirks in memory notes apply). | 3–4 h + ~$30 real USDC/gas (Solana fallback: 2–4 h, $0) | Track A 4 → 6. **Every other item is 0 without this.** | Also unblocks the "consume live data" clause in both tracks |
| 2 | Public repo + video with §4's beat replacing 2:14. | 1 h + the video | Gate: ineligible → eligible; with #1, → 6.5 | Fix items 0.1–0.5 in the same pass |
| 3 | **Compose a map, not just an index, and split the general package.** Use `ethereum_common:filtered_events` as the input to both decoders (delete the two `block.logs()` loops), author `custody-boundary` per §2.3 with `store_sessions` + `map_signals`, import it from `shield-vault`. Vendor the proto for the Solana package. | 5–7 h | Track A +1 (→ 7.5 with #1, #2) | This is the item that turns "composable" from technically-true into true |
| 4 | **Make the product consume the package's signals** (§2.4 item 1) with a parity test against `deriveProfile`; delete the now-dead `store_flow_totals`/`map_behavioral_profiles` or make them the signals. | 2–3 h | Track A +0.5; Track B "load-bearing" clause FAIL → PASS if ever entered | Without this, #3 is a nicer decoration |
| 5 | Publish both packages to substreams.dev (`substreams publish`) and deploy `map_signals` to a Hosted SQL sink on The Graph Market from the registry ID; link both in the README. | 1–2 h (needs a substreams.dev login) | +0.5: judges can open a URL instead of running a CLI | Registry publish is already `HUMAN_ACTIONS.md` #6 |
| 6 | One-prompt challenge, properly: re-run the prompt against the current SKILLs on a clean branch, commit transcript and human-edit diff, deploy the result per #5, and enter Track B *as the featured challenge only*. | 3–4 h after #1 and #5 | Track B 2 → 5 (placing is unlikely against purpose-built entries; qualifying honestly is worth the entry) | Do not enter Track B on the "risk monitor" reading (§3) |

Total for #1–#5: roughly 13–17 hours plus the video. Realistic ceiling for
Track A with all five done well: 7.5 / 10 — a placing entry, not a lock.
Without #1, the ceiling is 5.

**Explicitly do not:**

- Index `RiskTierChanged` or ship `map_restrictions` with tier fields before
  the v3 ladder exists on chain. A module for a phantom event is the first
  thing a judge notices.
- Add `ReloadBlocked` / `ReloadAttempted`, or change the app to send
  transactions it knows will revert so the chain records refusals.
- Put `RiskExpansionSequence`, medians, streaks, or insight sentences in
  WASM. Editorial belongs in the consumer.
- Claim "standardized schema" or "Standardized Subgraph". Shield has one
  protocol; there is no standard it extends.
- Layer the Subgraph MCP "for cross-protocol analysis" over one subgraph, or
  add any chat surface. No judge is fooled and it dilutes the product's
  strongest line ("no AI controls the money").
- Keep calling the derived quantities "realised loss" in the package. Name
  them `deficit` / `open_exposure`; keep "loss" for the Hyperliquid-sourced
  number in `policy.ts`.
- Keep the zero-row `Completed successfully` beat in the video.
