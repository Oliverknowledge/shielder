# F. Chainlink judge pass: Best Confidential Workflow, read ungenerously

Agent F, 2026-09-07. Persona: Chainlink senior DevRel judging ETHOnline 2026
"Best Confidential Workflow" (up to 2 x $1,000). Only authority for
qualification: `docs/internal/gauntlet/CRITERIA.md`. Every code claim below
was checked against the file named; every CRE claim against the docs fetched
today (URLs inline). Nothing was deployed; the repo has no `CRE_API_KEY`.

Read in full: `cre/shield-risk/main.ts`, `evaluate.ts`, `evm-verdict.ts`,
`cre/secrets.yaml`, `cre/project.yaml`, `cre/shield-risk/workflow.yaml`,
`cre/shield-risk/config.*.json`, `cre/README.md`, `server/policy.ts`,
`server/evm-index.ts` (`/api/verdicts`, `relayVerdict`),
`contracts/src/ShieldVault.sol` (`RiskVerdict`, `applyRiskVerdict`,
`proposeLoosen`, `executeRuleChange`), `contracts/test/ShieldVault.t.sol`
(verdict tests), `docs/SPONSOR_INTEGRATIONS.md`, `docs/evidence/cre-simulate.txt`,
`docs/THREAT_MODEL.md`, `docs/JUDGE_QA.md`, `docs/DEMO_SCRIPT.md`,
`docs/internal/research/01-capital-ladder-design.md`, `D-trader-behaviour.md`.

---

## 1. Score against the verbatim clauses

| Clause (verbatim) | Verdict | Why, specifically |
|---|---|---|
| "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part" | **Pass** | `evaluateVault` (fetch, derive, assess, sign) runs only under `handlerInTee` (`main.ts:84-89`). Nothing runs outside the enclave. |
| "must register and use a confidential TEE handler, such as handlerInTee in TypeScript" | **Pass** | `handlerInTee(trigger, onEvaluate, [{ tee: "nitro", regions: ["us-west-2"] }])` at `main.ts:88`. Matches the only registered TEE/region per the SDK reference. |
| "The confidential portion must process at least one sensitive input, secret, confidential API response, private parameter" | **Partial** | Letter: yes, `runtime.getSecret({ id: SHIELD_EVM_VERIFIER_KEY })` (`evaluate.ts:89`), load-bearing (run 3 of the transcript). Spirit: no. Every *input to the decision* is public: vault policy from a public chain (`lossTriggerUsdc` is in `getVault()` and in the `PolicyTightened` event), flows from public logs, Hyperliquid's unauthenticated `userFillsByTime`. The enclave computes a public function of public data and signs it. And the intermediate values do not stay inside: `evaluate.ts:198` POSTs the full `EvidenceBundle` (sessions with wallets and signatures, reload counts, venue account, loss figure, headline lines) to an unauthenticated `/api/verdicts`, and the `RiskVerdictApplied` event publishes `realizedLossUsdc` on chain. The docs' own protected list is "Vault DON secrets, sensitive HTTP response payloads, and intermediate values that are not explicitly shared outside the enclave" (https://docs.chain.link/cre/concepts/confidential-workflows). Shield shares all the intermediate values outside the enclave on purpose. This is confidential *signing*, not confidential *computation*. |
| "must be meaningfully integrated into the project's core functionality" | **Partial** | The vault does accept nothing but a signed verdict (`applyRiskVerdict`). But `server/evm-index.ts` runs the identical `assess()` and signs with the *same* key under `SHIELD_MONITOR=1` (`docs/DEMO_SCRIPT.md:66-81` tells the filmer to choose which one is on). From the contract's view CRE and Shield's server are interchangeable signers; the enclave is one of two equivalent producers, not a dependency. A judge who reads `cre/README.md` "Trust model" will see this stated honestly, and will also see the CRE-native delivery path (report + forwarder) is "not built". |
| "Demonstrate successful execution through simulation using the CRE CLI or live deployment" | **Pass** | `docs/evidence/cre-simulate.txt`: three runs, CLI v1.32.0, TEE banner, `[USER LOG]` from inside the handler, relayed tx `0xa02e2fcb...` block 63626813 with `cooldownReason = 2`. Negative control included. This is better evidence than most entries will bring. |
| "Provide evidence of successful simulation or deployment in the submission, such as demo video or execution logs" | **Partial** | Logs: yes, verbatim. Video: does not exist (`HUMAN_ACTIONS.md` #3). Repo is private. Both are hard blockers on submission day, not on merit. |

Deductions a Chainlink judge will actually make, in order of weight:

1. **The motivating use case is the one Shield declines to build.** The concept page's opening problem statement is "applying risk thresholds, a rebalancing policy, or a proprietary scoring model to live inputs can expose that policy just as much as leaking a credential would", and the use-case list has "Automated risk management: Running the thresholds and parameters that define when action is taken inside the enclave is designed to prevent them from being reverse-engineered or gamed." Shield is that use case with the thresholds deliberately public. A judge scoring against the track's intent will place it below any entry whose *policy* is inside the enclave.
2. **`authorizedKeys` is empty** (`main.ts:86`, `trigger({})`). The docs: "An empty configuration object {} is only valid for simulation and testing, deployed workflows will reject HTTP triggers without authorization keys" (https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/configuration). A comment says "in production, restrict". A judge reads that as "not production-shaped".
3. **In-enclave logging of the sensitive figures** (`evaluate.ts:131-134` logs loss, streak, reloads). Both the concept page and the guide say "Don't log in production Confidential Workflows". Fine for the simulator transcript, but it is exactly the data the pitch says should not leak, and it is not gated.
4. **The output path bypasses CRE.** No `usingTheDons()`, no `report`, no `writeReport`, no forwarder. The verdict is a single ECDSA signature relayed by Shield's own key. The docs make the DON crossover the canonical delivery ("Cross back to the DON for anything that needs consensus"). A judge will notice the workflow never touches the half of CRE that provides consensus and attestation-verified completion.
5. `project.yaml` lists Sepolia RPCs the workflow never uses; `config.production.json` still points at a Solana program id. Cosmetic, but it reads as scaffolding.

**Overall: 6/10.** Technically correct, unusually honest, well evidenced; thin on the one thing the track is named for. Against a field where at least one team will put a private threshold or a credentialed API response in the enclave and deliver through `writeReport`, this is a plausible second and a likely third. Second place is a real risk, as the brief says; so is missing entirely if two such entries show up.

**What a first-place entry shows that this does not:**

- A **private parameter that never touches chain**: the user's thresholds live in the Vault DON or arrive encrypted, and the chain holds a commitment. Shield's thresholds are in a public event.
- A **confidential API response**: an authenticated call whose response is protected by being made in-enclave (the concept page names "sensitive HTTP response payloads" as protected). Shield's two upstream calls are to unauthenticated public endpoints.
- **Minimal on-chain output**: tier + validity + commitment. Shield's event publishes the dollar loss.
- **`authorizedKeys` set** and the trigger caller (Shield's relayer) signing the JWT with that key.
- **`usingTheDons()` + `report()` + `writeReport` to a consumer contract via the forwarder**, so the verdict carries DON signatures and the docs' "successfully complete execution only after DON consensus verifies attestations from the enclave" sentence applies to the delivered result, not just the log line.
- Ideally **deployment on the CRE network**; see section 5 for why that is probably not reachable this week, and why simulation is still the documented path.

---

## 2. The honest confidential Risk Ladder

Facts from today's docs that constrain every option:

- Trigger payloads are **not** confidential: "Workflow triggers, chain reads, and chain writes, these always execute on Workflow DON nodes, never inside the enclave" (https://docs.chain.link/cre/concepts/confidential-workflows). Supplying plaintext thresholds via the HTTP trigger payload puts them on every Workflow DON node. Option (a)'s "supplied privately via the HTTP trigger payload" variant is dead on arrival.
- What **is** protected: Vault DON secrets released into the enclave; HTTP responses fetched with the `TeeRuntime` overload of `HTTPClient.sendRequest`; intermediate values not explicitly exported; enclave memory. Not protected: source, binary, config, anything logged or posted out.
- Secrets are **per workflow owner**, namespace `main`, created with `cre secrets create` (https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-deployed). Quotas: 100 secrets per owner, 2 KB per secret, 27 KB total per workflow, 5 fetch calls and 5 concurrent per execution (https://docs.chain.link/cre/service-quotas). No per-end-user secret primitive exists. `getSecret({ id })` takes a dynamic id at runtime with no upfront declaration (SDK reference), so `LADDER_<vault>` ids are legal.
- `ConfidentialHTTPClient` has **no `TeeRuntime` overload** and "isn't built to be called from inside a Confidential Workflow handler" (https://docs.chain.link/cre/reference/sdk/confidential-workflows-client). Inside `handlerInTee`, plain `HTTPClient.sendRequest(runtime, ...)` is the confidential path. Confidential HTTP's `encryptOutput` is a different product (enclave-executed single request, response AES-GCM encrypted to *your backend*) and is not the tool here.
- Nitro / `us-west-2` is the only TEE and region. Multiple workflows share an enclave, isolated by Wasmtime; side channels are named as a known limitation.
- HTTP trigger rate quota: 1 per 60 s per workflow. Fine for a ladder that re-evaluates on session events.

### The three options, concretely

**(c) Public thresholds (the ladder design as drafted, `01-capital-ladder-design.md`).**
`Tier[3] ladder` on chain with `triggerUsdc`, per-tier limits, `pauseSecs`.
Private from: nobody. Contract verifies: everything (`rv.realizedLossUsdc >= ladder[tier].triggerUsdc`, `rv.tier > activeTier`, strict tightening on set). Added trust: none beyond today. Worst case with a rogue key: STOP tier's pre-written limits + pause, all public and pre-authorised. Honest to call confidential: **no**. The enclave's only secret is again the key. This is the strongest *contract* and the weakest *Chainlink entry*.

**(b) Thresholds only in enclave secrets; contract trusts the signed tier.**
Ladder JSON per user as a Vault DON secret; verdict carries `tier`; contract checks signer, nonce, expiry, `tier > activeTier`, and applies the public per-tier *limits*.
Private from: chain observers (yes), Chainlink node operators (yes, per the protected list), Shield's server at evaluation time (yes), Shield the company (no: whoever ran `cre secrets create` had the plaintext). Contract verifies: that a pinned key selected a rung, nothing about *why*. The user has no on-chain proof that the ladder evaluated was the one they wrote. Added trust: the enclave key becomes the sole authority for CAUTION/DEFENSIVE. Worst case with a rogue key: same as (c) plus the user cannot show a verdict was unjustified from chain data alone. Honest to call confidential: **yes for thresholds**, with the sentence "Shield's operators uploaded the secret". Weakest verifiability.

**(a) On-chain commitment, plaintext held privately, enclave evaluates and signs `tier` (recommended).**
User writes the ladder in the app while calm. App computes `ladderHash = keccak256(abi.encode(tiers, salt32))` and the user stores it on chain via `tighten`/`proposeLoosen` (see rules below). Plaintext + salt reach the enclave one of two ways:

- **A1 (hackathon, hours):** as a Vault DON secret `LADDER_<vault>` created by Shield's CLI from the app's export. Fits quotas for a demo (100 secrets, 2 KB each is plenty for 3 tiers + salt).
- **A2 (honest product, ~2 days):** the app encrypts `tiers||salt` client-side to an enclave-held key (a Vault DON secret `SHIELD_LADDER_KEY`, AES-256-GCM or ECIES to the verifier's secp256k1 pubkey), Shield's server stores only ciphertext, the enclave fetches ciphertext over the `TeeRuntime` HTTP overload and decrypts inside. Shield's server never sees plaintext; Shield the company can only if it retained the enclave key at creation, which must be stated.

The verdict becomes `RiskVerdict{vault, nonce, issuedAt, expiry, tier, ladderHash, reasonCommitment}` where `reasonCommitment = keccak256(evidenceBundle)` (the bundle stays in the enclave or is returned to the user encrypted, not POSTed in plaintext to `/api/verdicts`). No `realizedLossUsdc` for CAUTION/DEFENSIVE.

What the contract can still verify in (a): signer is the pinned verifier; nonce fresh; expiry/skew; `rv.ladderHash == v.ladderHash` (the enclave attests it evaluated *this* ladder, so a stale or swapped ladder is rejected on chain); `rv.tier > v.activeTier` (monotone down); tier limits are the user's pre-written, public, on-chain values; **STOP additionally keeps today's public floor** `realizedLossUsdc >= lossTriggerUsdc`, so the deepest rung remains checkable against a public number and the worst case stays bounded exactly as v2 is.

What it cannot verify: that the threshold comparison for CAUTION/DEFENSIVE was done honestly. That is the trust you buy the privacy with, and it is confined to the two rungs whose consequences are pre-authorised limit reductions, not a pause.

Ladder-change rules for (a): a hash cannot be compared for strictness on chain. So: setting `ladderHash` for the first time or from `bytes32(0)` is a tightening (instant); **any change** of an existing hash goes through `proposeLoosen` (delay + reconfirm), because the contract cannot tell tighter from looser. Additionally the enclave refuses to evaluate a ladder whose hash does not match chain. This preserves tighten-fast/loosen-slow at the cost of making "make my ladder stricter" wait an hour; acceptable, and the user can always `tighten({tier: STOP})` instantly in the meantime (design rule 3).

Privacy claim, exactly as it should be written: *"Your tier thresholds, reload sensitivity and loss-velocity settings are never on chain and never in Shield's server process. The chain holds a salted hash of them and the tier you are on; the enclave holds the plaintext while it evaluates; Chainlink node operators cannot read it during execution. What is public: which tier you are on and when it changed, and the limits each tier applies. Shield's operators can read the ladder if they kept the enclave's key; the simulator is not a real enclave."*

Replay/griefing for (a): identical to v2 for nonce/expiry (both retained). New: a rogue key can move any user to STOP instantly. Bounded by the user's own STOP limits, the 30-day pause cap, the untouched floor/cold/exit paths, and the loosen path to remove the verifier (1 h minimum, `MIN_LOOSEN_COOLDOWN_SECS`). The one genuinely new soft harm: with private thresholds, a false CAUTION is indistinguishable on chain from a true one; the user knows, but cannot prove it to anyone else. The encrypted evidence bundle returned to the user (A2) is the remedy: the user can decrypt and publish it if they choose to dispute.

Which is honest to call confidential: (a) and (b) yes, with the Shield-holds-the-key caveat stated; (c) no. Choose **(a)**, A1 for the week, A2 documented as the product path and built only if the week allows.

Realistic in a hackathon week: A1 plus the contract change is 1.5 to 2 days including tests and a v3 deploy; A2 adds ~1 day (client-side AES-GCM in the app, ciphertext endpoint, in-enclave decrypt with `@noble/ciphers`, QuickJS-safe). The `report`/`writeReport` path is a separate day and is independent of the ladder.

---

## 3. Least privilege, verified in the contract and the workflow

`applyRiskVerdict` (`ShieldVault.sol:562-584`) checks, in order: vault exists; verifier pinned; `now <= expiry`; `issuedAt <= now + 5 min`; `nonce > lastVerdictNonce`; `realizedLossUsdc >= lossTriggerUsdc`; recovered signer == `riskVerifier` (65-byte sig, low-s enforced, `ecrecover != 0`). Effect: `lastVerdictNonce`, `lastVerdictReason`, `lastVerdictEvidence` written; `cooldownUntil = max(cooldownUntil, now + lossCooldownSecs)`. `lossCooldownSecs` is user-set and capped at `MAX_LOSS_COOLDOWN_SECS = 30 days` at init and tighten (lines 318, 376). No balance, floor, velocity, threshold, registry, proposal or `configVersion` write. `test_verdictCannotShortenCooldownAndDoesNotBumpConfig` (`t.sol:253`) proves the no-shorten and no-supersede properties; `instantColdTransfer`, `executeFullExit` and the whole proposal path have no cooldown check (`611`, `636`, `450`). The workflow side (`evaluate.ts`) can only produce this struct; it carries no field the contract would use to loosen. **Confirmed: CRE can only tighten, never release, loosen or shorten.**

Ways a compromised verifier key harms the user beyond one unwanted pause:

1. **Indefinite chained pause** (already in `THREAT_MODEL.md` invariant 9): re-arm every window with a fresh nonce. Bounded per verdict by the user's own `lossCooldownSecs`; unbounded in aggregate until the user removes the verifier through `proposeLoosen({hasRiskVerifier, riskVerifier: 0})` + `executeRuleChange` after `loosenCooldownSecs` (minimum 1 h, default 24 h). Top-ups are closed for that whole interval; cold transfers and exit are not.
2. **Nonce exhaustion, permanent (new finding).** `nonce` is `uint64` and only required to exceed `lastVerdictNonce`. A rogue key signs one verdict with `nonce = 2^64-1` (it must also assert `realizedLossUsdc >= lossTriggerUsdc`, which it simply does). After that, no verdict from *any* key can ever be applied to that vault, and `executeRuleChange` (`450-472`) replaces `riskVerifier` **without resetting `lastVerdictNonce`**. The honest enclave will then compute `lastVerdictNonce + 1`, overflow `uint64` in the EIP-712 encoding and be rejected forever. Vaults are keyed by authority, so the only recovery is a new authority address and a full exit. This does not touch funds; it permanently disables the protection feature for that vault. Fix is one line: reset `lastVerdictNonce = 0` when `riskVerifier` changes, or bind the nonce to the verifier (`mapping(verifier => nonce)`). Add a test.
3. **Reputational/behavioural leak, not theft:** a rogue key can spam `RiskVerdictApplied` events with fabricated `realizedLossUsdc` values on a public chain, attaching a false loss history to the user's address. Evidence hashes are "informational storage", so nothing on chain refutes it. The ladder design that drops the dollar figure from the event (section 2) also closes this.
4. **With the ladder:** a rogue key can push to STOP at will. Bounded by the user's own pre-written STOP limits (never below the floor, never touching cold/exit), the 30-day pause cap, and the loosen path. Because rule 4 of the ladder design has no automatic reset, every rogue STOP costs the user a `loosenCooldownSecs` wait plus a reconfirmation to climb back; agent D's recommendation (auto-expire CAUTION/DEFENSIVE at session end + 6 h or 24 h) halves that cost and should be adopted for the lower rungs. Item 2 applies unchanged to the ladder verdict and matters more there, since the ladder is the whole feature.
5. **Relay is permissionless** (`applyRiskVerdict` has no `msg.sender` check). Good for liveness; it also means a valid-but-stale verdict (within its 15-minute expiry) can be landed by anyone at the least convenient moment. Not a new harm, but worth stating in the ladder version where a CAUTION lands limit reductions.

---

## 4. Is "moving between tiers" a materially stronger use case than "extend a cooldown"?

As drafted in `01-capital-ladder-design.md` (public thresholds): **no.** A judge sees the same computation with more fields: `tier` replaces a boolean, the enclave still evaluates public inputs against public thresholds and signs. It is a better *product* and a better *contract*; it is not more *confidential*.

With option (a): **yes, and it is the difference between the two placements.** The enclave now computes over a private parameter (the ladder) that the chain only knows by commitment, produces a minimal output (tier, hash, nonce), and the intermediate analysis stays inside. That is the docs' "Automated risk management" use case verbatim, with a twist the docs do not have: the private policy protects its *author* from *themselves*, and the enclave is bound to a user-committed hash so it cannot substitute a policy. "Your financial weaknesses can protect you without becoming public data" is only true under (a); under (c) the weaknesses are in a `PolicyTightened` event.

One caution: a judge will ask why the thresholds are secret if the tier changes are public. The answer must be ready: the *rule* is what a counterparty or a future-you would game (set D1 loose, time reloads under the bar); the *rung* is what the vault needs to enforce. Public consequence, private trigger.

---

## 5. Deployment on the CRE network: what it takes today

From https://docs.chain.link/cre/account/deploy-access, https://docs.chain.link/cre/account/confidential-workflows-access, https://docs.chain.link/cre/guides/operations/deploying-workflows:

- A Chainlink account (`cre login`; the repo has none configured, `CRE_API_KEY` is commented out in `cre/.env`).
- **Deploy access**: "Deploying workflows to a Chainlink DON requires approval." Request via `cre account access`; review "via email shortly", no SLA. Only gates `cre workflow deploy`; simulation is explicitly the path while waiting.
- **Confidential Workflows access is separate and stricter**: "currently in private beta and is invite-only, separate from the deploy access required for regular CRE workflows." Enrolment goes through a form / "your Chainlink account team". "Do not wait for early access. Simulate confidential workflows in minutes."
- Registry: private registry (login session, no gas, 3 workflows per org) or on-chain registry (linked key via `cre account link-key`, ETH on Ethereum mainnet for the Workflow Registry, 1 linked key per org). Then `cre workflow deploy`, then activate. HTTP triggers must have `authorizedKeys` set or the deploy is rejected; the caller signs a JWT (EVM ECDSA, `KEY_TYPE_ECDSA_EVM`) to the gateway (https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows).
- Production secrets via `cre secrets create ... --target production-settings` into the Vault DON.

Would a testnet deployment move the score? A **regular** (non-TEE) deployment would prove nothing about this track and would remove the `handlerInTee` registration to do it; do not. A **confidential** deployment needs the invite-only beta, which cannot be assumed inside the week (deadline 2026-09-13). The criterion's own wording ("simulation using the CRE CLI **or** live deployment") makes simulation sufficient. Expected delta from deployment if it somehow happened: +1, mostly because it would force `authorizedKeys`, real Vault DON secrets and a real attested run. Expected delta from *requesting* access and saying so with the ticket in the submission: +0, but it costs five minutes and answers a judge's first question. Do it.

---

## 6. What makes a Chainlink judge care in 20 seconds of video

One continuous shot, no cuts:

1. The app, calm-mode screen: the user types three thresholds. Overlay: "these never go on chain." (3 s)
2. `cast call getVault` in a terminal: the `ladderHash` field is a hash, nothing else. (3 s)
3. `cre workflow simulate ...`: the TEE banner ("Trigger requested TEE Execution ... AWS Nitro"), then a single `[USER LOG]` that prints **only** `tier=DEFENSIVE ladderHash=0x... nonce=2` and nothing about dollars. (7 s)
4. `cast tx <hash>`: `RiskVerdictApplied(tier=2, ladderHash=0x..., nonce=2)`; the app flips to DEFENSIVE with the reduced daily limit. Overlay: "the chain learned the rung, not the rule." (5 s)
5. One sentence: "The vault accepts nothing else from Chainlink, and nothing from Chainlink can loosen it." (2 s)

If the ladder does not ship, the 20 seconds are today's beat (banner, `[USER LOG]`, `cast tx`, `CooldownActive()` revert) and the honest line "the confidential input is the signing key". That is a second-place video.

---

## 7. Ranked recommendations

| # | Recommendation | Effort | Honest delta | Notes |
|---|---|---|---|---|
| 1 | **Ladder option (a), variant A1**: `ladderHash` + `activeTier` + public per-tier limits in the contract; `LADDER_<vault>` Vault DON secret; verdict = `{tier, ladderHash, nonce, expiry, reasonCommitment}`; STOP keeps the public `lossTriggerUsdc` floor; hash change only via the loosen path; ladder plaintext excluded from anything POSTed out of the enclave. v3 deploy + tests + `evm-verdict.ts` typehash. | 14-18 h | +2.0 | This is the difference between "confidential signing" and "confidential policy". Oliver wants to write the Solidity; write the interface and tests first. |
| 2 | **Fix nonce exhaustion**: reset `lastVerdictNonce` on verifier change (or key it by verifier). One line + one test. Ship with the v3 deploy, not as a fourth deploy. | 1 h | +0.3 | Also worth a line in `THREAT_MODEL.md` known gaps; judges reward finding your own bugs. |
| 3 | **Set `authorizedKeys`** to Shield's relayer address in `main.ts` (`KEY_TYPE_ECDSA_EVM`), keep `{}` only under a `simulate` config flag; gate the in-enclave `io.log` of loss/streak/reload behind the same flag so production logs print only tier and hash. | 2 h | +0.5 | Removes the two most visible "not production-shaped" marks. Simulation still works with the flag. |
| 4 | **Deliver through CRE**: after signing, `runtime.usingTheDons().report({...})` and `EVMClient.writeReport` to a small `ShieldVerdictReceiver` that verifies the forwarder and calls `applyRiskVerdict`; keep the direct relay as fallback. | 8-10 h | +1.0 | Turns "one enclave signature" into a DON-signed report and uses the half of CRE the entry currently ignores. Needs a forwarder on HyperEVM testnet; check https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory first and, if 998 is not listed, do it on Sepolia as a documented parallel path rather than not at all. |
| 5 | **Request Confidential Workflows access and deploy access now**, cite the ticket in `SPONSOR_INTEGRATIONS.md`, and add `--limits` to the simulate command so the transcript proves the run is inside production quotas. | 0.5 h | +0.2 | Zero-risk, answers the "why not deployed" question before it is asked. |
| 6 | **Variant A2** (client-side encrypted ladder, enclave-held key, encrypted evidence returned to the user). | 8 h | +0.5 | Only after 1-4. Makes "private from Shield's server" true rather than aspirational. |

Ordering rationale: 1 changes the category the entry competes in; 3 and 2 are cheap and remove visible flaws; 4 is the best Chainlink-native upgrade but is worth less than 1 per hour; 5 is free; 6 is polish.

**What NOT to do:**

- Do not describe the capital flows, the Hyperliquid fills, or the vault policy as confidential. They are public; the current docs say so correctly; keep saying so.
- Do not move public data into a secret to manufacture a "sensitive input". A judge will open `secrets.yaml`.
- Do not pass the ladder through the HTTP trigger payload and call it private. Triggers run on DON nodes.
- Do not use `ConfidentialHTTPClient` inside `handlerInTee`; it has no `TeeRuntime` overload and the docs say it is not built for that.
- Do not deploy a non-confidential version to claim "deployed on the CRE network"; it would drop `handlerInTee` and fail the second clause.
- Do not claim an attested enclave ran. The banner says the simulator is not a TEE; the current docs quote it. Keep quoting it.
- Do not add the on-chain dollar loss to the ladder verdict for the lower rungs. Minimal output is the point.
- Do not spend the week on the Solana path; delete or clearly park `config.staging.json` / `production.json` so the submitted workflow has one target.
