<!-- The build brief given to the AI coding agent on 2026-09-05, verbatim. Kept per ETHGlobal's AI-tooling rule: prompts and planning artifacts live in the repo. -->

# Mission

You are now the autonomous lead engineer, product designer, security engineer, hackathon strategist and submission owner for my ETHOnline 2026 project, currently called Shield / Shielder.

I want you to push this project as close to a finished, prize-winning hackathon submission as you possibly can in this single session.

DO NOT merely give me a plan.

Actually inspect the repository, research the live hackathon, make the product decisions, write the code, build the UI, implement the integrations, run the tests, debug failures, improve the UX, create the documentation and prepare the submission materials.

Use your context window and compute aggressively. I have significant usage available right now and would rather you do too much than stop early.

I will paste the previous Shielder discussion below. Read all of it carefully first. Treat it as historical product context and previous reasoning, not immutable truth. Preserve decisions that remain strong, but challenge anything that current technical research, bounty requirements, security reasoning or product quality shows is wrong.

--------------------
PREVIOUS SHIELDER CONTEXT
--------------------

[PASTE THE FULL PREVIOUS CONDUCTOR / SHIELDER CHAT HERE]

--------------------
END CONTEXT
--------------------

The current conceptual core is approximately:

"Crypto wallets protect your keys. Shield protects you from your own decisions."

Shield is a self-custodial crypto commitment layer.

The user sets rules while calm that future-them cannot instantly weaken while tilted, FOMOing, revenge trading or chasing losses.

The sharp use case is:

"It doesn't stop me trading. It stops me topping up."

A protected treasury contains most of the user's capital. A smaller execution bankroll remains available for trading. The user can trade freely with that bankroll, but replenishing it is subject to rules chosen beforehand.

Example:

- total capital: $10,000
- protected treasury: $8,000
- execution bankroll: $2,000
- max replenishment: $500/day
- protected balance floor: $6,000
- after $1,000 realised losses: 18-hour top-up cooldown
- behavioural risk may extend/tighten restrictions

The key security/product principle is:

TIGHTEN FAST, LOOSEN SLOWLY.

Safer changes should take effect immediately.
Weakening protection should require a delay.

A user should not be able to rage-click "disable protection" immediately after a loss.

A potentially powerful personalised layer is:

"$4,100 sent to this trading terminal. $2,810 came back."

The user's own realised behaviour becomes a state/input into their self-imposed restrictions.

AI must not become the ultimate authority over the money.

Preferred philosophy:

AI investigates / detects / explains.
Deterministic onchain policy enforces.

An AI/oracle/monitor may be permitted to tighten or extend protection if securely authenticated, but it must NEVER be capable of loosening protections or becoming a liveness dependency for normal withdrawals.

The final product must feel like a real consumer fintech/security product — not a hackathon dashboard.

I care disproportionately about:
- exceptional UI/UX
- polished interactions
- real functionality
- an unforgettable live demo
- real onchain enforcement
- strong product thinking
- technically defensible security
- genuine use of sponsor technology
- a project that looks like it could become a company

The desired visual standard is modern, premium and product-quality. Think exceptional consumer fintech / Linear-level interaction quality / polished Apple-like restraint, NOT generic glassmorphism, neon Web3 gradients, template dashboards, random cards everywhere or AI-generated-looking UI.

The functionality should be ambitious and impressive, but every visible interaction should work.

## Hackathon research comes FIRST

Before making major architectural decisions, browse the current OFFICIAL ETHGlobal ETHOnline 2026 pages and current sponsor documentation.

Determine:

1. Exact ETHOnline rules.
2. From Scratch vs Continuity eligibility.
3. Submission deadline.
4. Judging criteria.
5. Current available partner prizes.
6. Exact qualification requirements for every plausible bounty.
7. Whether there is a maximum number of partner prizes we may select.
8. Which sponsor technologies currently support the chain/architecture you want to use.
9. What judges will actually be able to verify.
10. What work must be real/live rather than mocked.

Prior research suggested The Graph and Chainlink are promising, but DO NOT accept that conclusion blindly.

As of the start of this task, useful hypotheses to verify include:

- The Graph currently has an ETHOnline From Scratch AI / AI Use Case bounty and explicitly accepts risk monitors.
- The Graph requires live data from a Graph provider and meaningful processing/decision-making rather than displaying raw data.
- The Graph supports Solana through Substreams.
- Chainlink CRE has current ETHOnline prizes, potentially including Confidential Workflows.
- Chainlink CRE has recent Solana workflow support.
- Ledger's bounty appears more AI-agent-specific and may NOT fit Shield naturally.
- We should not bounty-stuff.
- Sponsor choice should follow the product, not distort it.

Research EVERY current sponsor enough to identify any surprising better fit.

Choose no more than the permitted number of sponsor prizes and only integrations where you can explain:

"If we removed this sponsor technology, a meaningful part of Shield would stop working."

Create:
docs/HACKATHON_STRATEGY.md

Include:
- exact current rules
- exact selected track/pool
- selected bounties
- why each is structural
- requirements checklist
- implementation/evidence required
- rejected sponsor bounties and why
- source links
- unknowns that still require confirmation

Do not fabricate bounty criteria.

## Architecture challenge

Do NOT preserve Solana merely because previous conversations used Solana.

Evaluate the strongest architecture today.

Compare at least:
- keeping the Solana/Anchor treasury architecture
- an EVM smart-account / vault architecture if materially stronger
- any other obvious architecture exposed by the actual ETHOnline sponsors

Evaluate:
- self-custodial enforcement
- bypass resistance
- sponsor support
- The Graph data availability
- Chainlink support
- wallet UX
- transaction costs
- implementation risk
- hackathon timeframe
- demo quality
- security
- ability for judges to reproduce it

Then pick ONE architecture and commit.

Do not keep multiple half-built chains.

Document the decision in:
docs/ARCHITECTURE_DECISION.md

## Core product that must exist

Build the strongest feasible version of the following.

### 1. Protected capital

There is a genuinely enforced protected treasury/vault.

The user can:
- deposit capital
- designate an execution/trading bankroll
- replenish the bankroll subject to policy
- see protected capital clearly
- eventually recover/exit safely under explicit rules

Do not make the "protected balance" a frontend number.

It must correspond to actual enforceable state.

### 2. Policy engine

Implement a small, coherent set of powerful primitives rather than 30 shallow toggles.

Candidate primitives:

- protected floor
- max replenishment amount per period
- rolling replenishment velocity
- loss-triggered cooldown
- destination/protocol restrictions where genuinely useful
- global freeze
- optional behavioural-risk tightening

Rules must have deterministic semantics.

Write the state transitions down before implementing them.

### 3. Tighten immediately, loosen slowly

This is core IP/product behaviour, not a UI animation.

For every security-sensitive configurable value, classify whether moving it up/down is safer or weaker.

Safer change:
apply immediately.

Weakening change:
create a PendingChange with:
- exact old config
- exact proposed config
- creation timestamp
- activation timestamp
- config version
- unique ID/hash

Weakening changes only become active after the delay.

Make cancellation semantics safe.

Make sure a user cannot create a weakening proposal and then circumvent later stronger changes using the stale proposal.

Use config-version invalidation or another sound design.

### 4. Cooldown state machine

Do not leave "loss triggered cooldown" as a Boolean.

Define the deterministic transition.

Conceptually:

cooldown_until = max(current_cooldown_until, authenticated_new_cooldown_until)

A risk/cooldown signal should never shorten an existing cooldown.

Decide exactly what authenticates/arms the cooldown.

If an external monitor/CRE verdict does this:
- pin the authorized verifier/workflow
- prevent replay
- include expiry / nonce / config version where needed
- make the signal extend-only
- never let external infrastructure weaken protection

### 5. Bypass resistance

Explicitly reason about how a user could bypass Shield.

Threat model at minimum:

- calling the program/contract directly rather than the frontend
- moving money through another instruction/function
- stale weakening proposal
- concurrent replenishment requests
- replayed external verdict
- compromised monitoring backend
- compromised AI
- authority substitution
- allowance/approval path where applicable
- closing/reinitializing accounts
- alternate withdrawal path
- malicious destination
- user intentionally trying to defeat their own earlier commitment

Remember the threat model is unusual:

The user is both the owner AND, temporarily, an adversary to their past intention.

Document:
docs/THREAT_MODEL.md

### 6. Recovery / exit

Do not trap the user's funds.

Design the safest coherent exit mechanism.

A full exit may deliberately take time, but semantics must be explicit.

It must not quietly make every other restriction meaningless.

Explain this exceptionally well in the UI.

## Real behavioural data

This needs to become one of the most impressive parts of the product.

Use REAL onchain data.

If The Graph is selected, it must be load-bearing and meet the exact current bounty requirements.

Prefer The Graph's current supported products and official developer tooling.

Before writing a custom Substreams package, search the current Substreams registry and existing packages for reusable primitives.

If appropriate, use the official Substreams Claude/agent SKILLs to accelerate implementation.

Build a data pipeline capable of producing useful personal behavioural history such as:

- deposits into trading destinations
- transfers back out
- swaps
- estimated realised P&L where defensible
- repeated top-ups
- loss velocity
- time since loss
- destination/protocol exposure
- behavioural streaks
- replenishment after losses

Do NOT invent financially precise P&L if the available data cannot support it.

If exact realised loss is impossible for arbitrary wallets in the timeframe:
choose a narrower environment/protocol where it CAN be computed correctly and make the demo excellent.

A narrower real metric beats a universal fake one.

The desired emotional product insight is something like:

"You've sent $4,100 into this trading venue.
$2,810 has returned.
Your net realised flow is -$1,290."

or whatever metric can actually be defended.

The data should power:
- dashboard
- risk explanations
- policy state
- demo
- sponsor qualification

The frontend should consume live data, not fixtures, except clearly isolated dev/demo fallbacks.

## Risk intelligence / AI

AI is subordinate to deterministic enforcement.

Build AI only where it improves the product.

Potential tasks:
- explain recent behaviour
- summarize why Shield is currently restricting a replenishment
- identify patterns from Graph-derived behavioural features
- suggest safer policy settings
- classify unusual escalation
- convert raw activity into human-readable reasoning

Example:

"You've replenished this wallet three times in 47 minutes after a 31% drawdown. Your 18-hour cooldown is active."

Avoid generic:
"AI says risk score 82."

Evidence and explanation are more compelling than a mysterious number.

If Chainlink CRE is selected and technically feasible, build a REAL workflow rather than sponsor theatre.

Potential architecture:

The Graph / behavioural pipeline
→ bounded structured behavioural features
→ confidential CRE workflow / optional model inference
→ signed/verifiable risk verdict
→ onchain verification
→ can only TIGHTEN / EXTEND protection

The AI verdict must never:
- withdraw funds
- loosen a user policy
- reduce cooldown
- bypass the deterministic contract
- be required for basic product liveness

If the Chainlink integration becomes a fragile science project, CUT IT and protect the core demo.

## User experience

Treat the frontend as a flagship product.

Before coding the final interface, define the information architecture and user journey.

The first-time journey should probably resemble:

1. Welcome / value proposition
2. Connect/create wallet
3. See current capital/behaviour
4. Choose protected amount
5. Configure protection
6. Review rules in plain English
7. Activate Shield
8. Dashboard

The recurring dashboard should immediately answer:

- How much money is protected?
- How much can I currently trade with?
- Can I replenish right now?
- Why / why not?
- What have I lost/won recently?
- What rules are currently protecting me?
- Is any rule change pending?
- What happens next?

Potential main surfaces:

### Overview
- protected balance
- execution bankroll
- current Shield state
- personal performance snapshot
- replenishment availability
- countdown if locked

### Behaviour
- visually excellent timeline
- deposits/top-ups
- trading episodes
- returns
- loss events
- cooldown triggers
- protocol/destination breakdown
- personal scoreboard

### Protection
- current rules
- visually clear rule builder
- explain each rule
- tightening actions
- pending weakening changes
- countdown
- protection presets

### Activity
- real onchain events
- allowed replenishments
- rejected replenishments
- rule changes
- AI/monitor risk events
- transaction/explorer links

### Top-up flow
This is the emotional heart of the product.

When allowed:
make it fast.

When blocked:
do NOT show a generic error.

Show something beautiful and specific:

TOP-UP BLOCKED

You realised $1,420 in losses in the last 3 hours.
Your Shield rule activates an 18-hour cooldown.

$8,000 remains protected.
You can top up again in 14h 37m.

[See what happened]
[Tighten protection]

The blocked experience should make the user feel relieved that past-them protected present-them.

### Weakening protection

If they increase their limit/remove cooldown/lower floor:

Do not say "Saved."

Show:

CHANGE SCHEDULED

Daily top-up limit
£500 → £3,000

Activates in:
23:59:54

Your current protection remains active until then.

Allow safer counter-actions immediately.

### Design language

Build a bespoke design system.

Avoid:
- generic shadcn dashboard look
- excessive cards
- glassmorphism everywhere
- purple/blue Web3 gradient soup
- giant glowing crypto blobs
- excessive copy
- fake metrics
- random charts
- gimmicky 3D

Prefer:
- restrained premium palette
- exceptional typography
- large numbers only when meaningful
- whitespace
- clear hierarchy
- subtle motion
- tactile controls
- excellent responsive layout
- outstanding loading/success/blocked states
- tiny microinteractions
- tasteful data visualization
- real product copy
- coherent iconography
- no text that sounds AI-generated

Use animation to explain:
capital moving from protected treasury → execution wallet,
and visually stop/rebound when Shield rejects a replenishment.

Make mobile excellent.

Every visible button must work.

## Demo-first engineering

The final demo must be deterministic and compelling.

Design the demo FIRST, then ensure implementation supports it.

Ideal story:

0:00
"Crypto wallets protect your keys. They don't protect you from yourself."

Show ~$10k.

0:10
"I protect $8k and leave $2k available to trade."

Create/activate rules with a polished flow.

0:30
Show real Graph-derived behavioural history.

"I've already lost $1,400 in this trading session."

0:45
Attempt a large top-up.

The actual contract rejects it.

The interface instantly transitions into the blocked state.

"This isn't an alert. The money cannot move."

1:05
Try to raise/disable the limit.

Show the weakening-change countdown.

"I can make myself safer immediately. Making myself less safe has to wait."

1:25
Show personalised behavioural evidence / explanation.

1:40
Show real onchain evidence:
- transaction
- policy state
- Graph data
- sponsor integration

1:55
Close:

"Shield turns your own financial history into protection future-you can't rage-click away."

This is illustrative. Improve it if you find a better story.

No demo-critical step should depend on an unreliable LLM response.

Use deterministic seeded conditions if necessary, while keeping the underlying transactions/data/integrations real.

## Testing and security

Write serious tests.

At minimum cover:

- deposit
- permitted replenishment
- protected floor rejection
- period-cap rejection
- active cooldown rejection
- cooldown expiration
- immediate tighten
- delayed loosen
- cannot execute loosen early
- stale proposal invalidation
- monotonic cooldown extension
- concurrent/repeated requests
- full exit semantics
- authorization boundaries
- replay protection
- malformed external verdict
- external monitor cannot loosen
- direct-call bypass attempts

Use property/invariant testing if supported sensibly by the stack.

Run:
- tests
- typecheck
- lint
- production build

Fix failures instead of documenting them as TODOs wherever possible.

## Code quality

Make the repository something judges enjoy opening.

Create a clean structure.

Include:
- README.md
- .env.example
- docs/
- deployment scripts
- test scripts
- demo/seed tooling
- architecture diagram source if practical
- SPONSOR_INTEGRATIONS.md
- THREAT_MODEL.md
- HACKATHON_STRATEGY.md
- DEMO_SCRIPT.md
- SUBMISSION.md
- HUMAN_ACTIONS.md

Never commit:
- private keys
- API secrets
- mnemonics
- paid credentials

Do not destructively overwrite unrelated user work.

Inspect git history before major changes.

Use commits if the environment and existing repo workflow make that appropriate, with meaningful messages. Do not fake historical commits.

## Deployment

Deploy as much of the system as is safely possible using available devnet/testnet infrastructure and credentials already present in the environment.

Do not spend meaningful real funds without asking.

Do not expose secrets.

If deployment requires login/authentication/manual faucet/user approval that you cannot complete:

Do everything else first.

Then put the exact remaining step in HUMAN_ACTIONS.md including:
- why needed
- exact URL if relevant
- exact command
- exact environment variable
- expected result
- how to verify it

Aim for HUMAN_ACTIONS.md to be extremely short.

Do not use "needs deployment" as an excuse to leave deployment scripts unfinished.

## Sponsor implementation

Once you have verified exact live bounty rules, implement the selected integrations completely enough to qualify.

For EACH selected sponsor create a section in:
SPONSOR_INTEGRATIONS.md

Include:

- sponsor
- exact bounty
- exact qualification requirements
- files implementing it
- deployed resource/package/workflow identifiers
- how it is used in the product
- why it is load-bearing
- exact demo moment proving it
- evidence/link judges can inspect
- setup instructions
- feedback required by bounty
- any remaining manual requirement

If The Graph is selected:

The Graph must provide LIVE data from an eligible provider.

Do meaningful behavioural processing.

Do not just query and render balances.

If possible publish reusable Substreams work or related tooling if doing so strengthens the bounty without distracting from Shield.

If Chainlink is selected:

Use a genuinely meaningful CRE workflow.

A simulated workflow is acceptable only if the CURRENT bounty says so.

Make it affect a real state transition if required.

If another sponsor is more compelling after research, use that instead.

Maximum three sponsor selections unless the current official rules say otherwise.

## Submission package

Prepare the entire submission before stopping.

Create SUBMISSION.md with:

### Name
Best final product name. Consider Shield vs Shielder; choose deliberately.

### Tagline
One sentence.

### Problem
Short and visceral.

### Product
Clear explanation with no Web3 jargon in first paragraph.

### How it works
Concise.

### Why blockchain
Explain why deterministic self-custodial commitment cannot simply be a notification/backend feature.

### What's new
Explain the actual mechanism, particularly:
- past-you constraining future-you
- tighten fast / loosen slowly
- behavioural history becoming enforcement state

### Technical architecture
Clear and credible.

### Sponsor integrations
Exact.

### Demo video description

### GitHub description

### ETHGlobal short project description

### ETHGlobal long description

### Future/company
Where this goes next.

### Traction / validation
Do not invent any.

Also create DEMO_SCRIPT.md:
- 30-second pitch
- 2-minute version
- 3–4 minute version
- screen-by-screen actions
- exact spoken copy
- fallback if network call fails
- required pre-demo state

Create JUDGE_QA.md with hostile questions and concise answers.

Questions must include:

- Isn't this just a spending limit?
- Why can't I build this in a normal wallet?
- Can't the user bypass their own protection?
- Why would someone voluntarily lock themselves?
- What if they genuinely need the money?
- How do you know they lost money?
- What if your data source is wrong?
- Why The Graph?
- Why Chainlink / why selected sponsor?
- Why this chain?
- What happens if Shield disappears?
- Who holds the funds?
- Can the company steal funds?
- Does AI control the user's money?
- What prevents AI from maliciously locking users?
- Isn't this gambling-enabling software?
- What's the business model?
- Who is the first user?
- What becomes a venture-scale company here?

Answer accurately from the actual implementation.

## Product polish pass

Once all major functionality works, DO NOT stop.

Run the product locally.

Inspect every route/screen/component.

Perform a final polish pass focused on:

- visual consistency
- typography
- responsive layout
- loading states
- empty states
- error states
- hover/focus/touch
- animation timing
- explanatory copy
- simplifying clutter
- navigation
- transaction feedback
- perceived performance
- accessibility
- judging demo flow

Remove anything that looks unfinished.

A smaller product where everything is exceptional beats a large broken one.

## Priority ordering when time becomes constrained

P0 — NEVER sacrifice:
1. real protected treasury
2. actual enforcement
3. tighten-fast / loosen-slow
4. one real personalised behavioural metric
5. killer blocked-top-up demo
6. beautiful working frontend
7. tests for the key invariants
8. deployment/reproducibility
9. README/submission

P1:
10. full Graph behavioural pipeline
11. rich behaviour dashboard
12. sponsor-specific polish
13. AI explanations

P2:
14. Chainlink CRE if genuinely viable
15. extra protocols
16. advanced analytics
17. unnecessary settings
18. secondary sponsor bounties

CUT P2 rather than leave P0 rough.

# Research Process

Work autonomously in this order:

1. Read all pasted context.
2. Inspect the entire repo and git status/history.
3. Run the existing project and tests before modifying it.
4. Research current ETHOnline rules, prizes, sponsor docs and technical support from official primary sources.
5. Write HACKATHON_STRATEGY.md and ARCHITECTURE_DECISION.md.
6. Define the contract/program state machine and threat model.
7. Implement the core enforcement primitive.
8. Test it aggressively.
9. Build the real Graph/onchain behavioural pipeline.
10. Integrate behavioural state into the product.
11. Build the complete frontend around the actual data/contracts.
12. Implement selected sponsor integrations.
13. Deploy what can safely be deployed.
14. Run the complete product.
15. Walk through the judge demo yourself.
16. Fix every bug you encounter.
17. Run a serious UI/UX polish pass.
18. Run security/bypass tests.
19. Run typecheck/lint/build/tests.
20. Prepare all hackathon documentation and submission copy.
21. Create HUMAN_ACTIONS.md only for things genuinely impossible without me.

When facing an implementation problem:

RESEARCH → ATTEMPT → TEST → DEBUG → RETRY.

Do not immediately downgrade to a mock.

Do not repeatedly ask me minor questions. Make the strongest reasonable decision and document it.

Only stop for me if:
- you require a secret/account credential unavailable in the environment,
- an irreversible action would spend meaningful funds,
- there are two mutually exclusive product decisions with truly comparable evidence where choosing wrong would invalidate substantial work.

Otherwise keep working.

You may use multiple internal subagents if useful, but YOU own synthesis and implementation. Do not generate a giant committee report instead of shipping.

# Stop Conditions

Do NOT stop because:
- you've produced a plan,
- the homepage looks good,
- the contract compiles,
- one integration works,
- token usage is high,
- there are minor bugs,
- a dependency initially fails.

Stop only when you have pushed the project to the practical limit of what can be completed autonomously in this environment.

Before stopping, all of the following should be true or explicitly documented as impossible:

- architecture is locked
- current hackathon/bounty strategy verified
- core treasury works
- policy engine works
- tightening works immediately
- weakening is genuinely delayed
- bypass tests exist
- real behavioural data path exists
- selected sponsor integrations are substantive
- frontend is fully functional
- killer blocked-top-up path works
- mobile UX is polished
- production build passes
- tests pass
- deployment scripts work
- public deployment performed where possible
- README is excellent
- architecture/threat model documented
- sponsor qualification evidence documented
- demo script prepared
- submission copy prepared
- judge Q&A prepared
- HUMAN_ACTIONS.md contains only genuine manual blockers

If a feature does not work:
fix it or remove it from the visible product.

Never fake sponsor usage, transactions, users, traction, risk data or security properties.

# Final Deliverable

Do the work first.

At the VERY END give me one concise report containing:

1. WHAT YOU BUILT
   - final product
   - architecture
   - strongest functionality

2. HACKATHON STRATEGY
   - track/pool
   - selected partner prizes
   - why we can win each
   - exact qualifying integrations

3. DEMO
   - the final 90-second / 2-minute story

4. TECHNICAL STATUS
   - contracts/program
   - Graph/data
   - Chainlink/other sponsor
   - frontend
   - deployments
   - tests

5. SECURITY
   - invariants
   - attacks tested
   - known remaining risks

6. FILES CREATED / CHANGED
   - key locations only

7. COMMANDS RUN
   - tests/build/deploy status

8. HUMAN ACTIONS
   - only unavoidable remaining manual work

9. WHAT I SHOULD DO NEXT
   - maximum 5 highest-leverage actions

Do not give me a speculative essay at the end.

I want a working hackathon product.
Build it.