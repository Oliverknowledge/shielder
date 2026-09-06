# Mission

You are taking ownership of the next major product sprint for Shield.

Do not merely plan it.

Research the current hackathon and technical ecosystem, inspect the existing repository, preserve the pieces that are already strong, make the necessary architecture/product decisions, then actually BUILD as much of the finished product as possible.

This is an ETHOnline 2026 hackathon project.

The objective hierarchy is:

1. MAXIMISE probability of winning meaningful sponsor prizes, especially The Graph.
2. MAXIMISE probability of becoming an ETHGlobal finalist.
3. Make Shield feel like an exceptional real consumer product rather than a hackathon prototype.
4. Preserve genuine technical/security depth.
5. Build a product that could plausibly continue into a startup after the hackathon.

The product must ALWAYS be considered from the USER'S perspective first.

Do not build features because they are technically interesting.
Do not integrate sponsors because they have bounties.
Do not expose infrastructure just because we built it.

For every significant feature ask:

"What does this allow the user to do better, faster, more safely, with less effort, less stress, or more confidence?"

If there is no good answer, challenge the feature.

I have substantial Fable 5.1 usage available for this run.

USE IT.

However, do not waste tokens through endless architectural reconsideration, duplicate repo scans, or committees of agents repeating one another.

Use subagents selectively when parallel work genuinely helps.
Maximum 3 concurrent subagents.
You own synthesis and implementation.

Do not stop after producing plans.
Actually modify the repository and build the product.

--------------------------------------------------
PREVIOUS SHIELD CONTEXT
--------------------------------------------------

[PASTE THE FULL PREVIOUS SHIELDER / CONDUCTOR CHAT HERE]

--------------------------------------------------
END PREVIOUS CONTEXT
--------------------------------------------------


# THE PRODUCT THESIS

The core insight is:

CRYPTO GIVES YOU FREEDOM.

But the version of you making the decision changes while the permissions your wallet gives you do not.

Calm-you understands your limits.

Tilted-you wants one more trade.

Tilted-you thinks:

"I'll make it back."

"Just one more."

"If I put another £1,500 in I can break even."

"This will recover."

"Send it now."

"The opportunity disappears in two minutes."

That same unrestricted authority creates multiple failure modes:

- chasing losses
- revenge trading
- repeated reloads/top-ups
- FOMO
- increasing risk after losses
- touching capital the user previously decided was off-limits
- rushed transfers
- urgency-driven scams
- impulsive changes to risk limits

Shield exists because:

Crypto solved the problem of other people controlling your money.

It did not solve the problem of you losing control of yourself.

The key product sentence is:

"Calm you sets the limits. Tilted you can't instantly undo them."

Another useful framing:

"Shield separates the money you want to trade from the money you'll want to trade after you start losing."

Do not turn this into a moralistic anti-crypto or anti-trading product.

The user WANTS to trade.

They may enjoy aggressive crypto trading.

Shield's promise is:

"Trade freely. Protect the money you didn't mean to risk."

The product is NOT trying to tell users whether a particular trade is intelligent.

It creates a financial control layer between the user's protected capital and their high-risk activity.


# THE USER

Design everything around a concrete user.

Imagine:

19 years old.
Crypto-native.
Comfortable taking risk.
Uses products like Hyperliquid.
Enjoys trading.
Wants fast interactions.
Hates paternalistic financial products.
Hates unnecessary confirmations.
Values autonomy.
Understands in calm moments that he sometimes gets emotional.

His failure loop looks something like:

CALM

"I have £10,000.
I'm okay risking £1,500 tonight.
The other £8,500 is not trading money."

↓

TRADE

He has freedom inside the £1,500.

↓

WIN / EXCITEMENT

"This is working."

↓

LOSS

His reference point changes.

↓

CHASE

"I need to make it back."

↓

BANKROLL FALLS

£1,500 → £1,100 → £650 → £420

↓

RELOAD DESIRE

"£420 isn't enough to recover.
Give me another £1,500."

↓

SHIELD

Past-him already decided not to do this.

↓

BARGAINING

"Fine, disable the limit."

↓

DELAY

"Of course. Review this tomorrow."

↓

CALM AGAIN

The user gets to decide again once the immediate hot state has passed.

This human loop should drive the architecture, information hierarchy, interactions, animation, copy and demo.


# THE CENTRAL UX PHILOSOPHY

Every meaningful financial action should be classified into one of THREE categories.


## CATEGORY A — MOVING TOWARD SAFETY

These actions should be extremely easy and usually immediate.

Examples:

- close a position
- reduce a position
- lower leverage
- move idle trading capital back into protection
- reduce trading bankroll
- increase cooldown
- reduce reload allowance
- freeze further top-ups
- revoke permissions
- move money to a previously approved safe destination
- activate "Get me safe"

Principle:

NEVER TRAP SOMEONE IN RISK.


## CATEGORY B — WITHIN MY MANDATE

These actions should be extremely fast.

If calm-you allocated £1,500 of risk capital, Shield should not nag the user every time they trade with it.

Within his mandate:

- buy
- sell
- open supported positions
- close positions
- swap
- trade repeatedly
- change market
- use his available bankroll

Shield should largely disappear.

Status might quietly say:

"Within your plan"

but there should not be warning spam.

Principle:

FREEDOM INSIDE THE BOUNDARY.


## CATEGORY C — EXPANDS MY RISK

This is where Shield becomes strict.

Examples:

- add more capital after losses
- increase the bankroll
- lower protected floor
- dramatically raise an existing transfer limit
- remove a loss cooldown
- increase risk limits
- disable protection
- transfer a large amount to a first-time unknown address
- export/replace a protected execution authority if that undermines the mandate
- perform any operation specifically identified beforehand as a dangerous escalation

Principle:

FRICTION WHEN EXPANDING THE BOUNDARY.


# ASYMMETRIC CONTROL

This is one of the central product innovations:

TIGHTEN FAST.
LOOSEN SLOWLY.

A safer change:
apply immediately.

A weaker change:
24-hour cooling period by default.

CRITICALLY:

When the 24 hours end, the weaker rule must NOT automatically activate.

The user must positively reconfirm the change once the waiting period has elapsed.

Example:

22:13 while tilted:

"Disable loss cooldown."

Shield:

"Of course. Review this tomorrow."

24 hours later:

"Yesterday you asked to remove your loss protection.
Do you still want to?"

[Keep protection]

[Remove protection]

This makes calm-you the final decision-maker.

A rage-request must never silently weaken protection the following day.


# IMPORTANT: DO NOT BUILD AN ESCAPE GAME

We previously considered making the user complete a difficult game/puzzle/high score to unlock limits.

DO NOT make that the security mechanism.

That turns the challenge into another reward loop:

"Beat the game → get more money → make it back."

The protection must remain hard.

However, build a thoughtful optional 90-second RESET experience for someone who has been blocked and still desperately wants another trade.

It is NOT an unlock.

The protected capital remains inaccessible.

The purpose is to interrupt the immediate urge and provide safe next actions.

Potential flow:

"I still really want to trade."

↓

90-second Reset

"The trade will still exist in 90 seconds."

Show calm, factual personalised information:

- current bankroll
- session loss
- number of reload attempts
- additional amount they just tried to access
- amount remaining protected

Use a beautiful, tactile, non-patronising interaction.

Potentially a subtle hold/breathe/visual interaction, but NOT wellness-app cringe.

At the end:

"What do you want to do?"

[Keep trading with my existing £420]

[Move £420 back to safety]

[Stop for tonight]

There is still NO:

"Unlock £1,500"

option.


# THE PRODUCT EVOLUTION

Shield is no longer merely a vault dashboard.

The intended product is:

THE FINANCIAL CONTROL LAYER UNDERNEATH YOUR TRADING APPS.

Potential long-term model:

One Shield account.

Connected trading environments:
- Hyperliquid
- later Jupiter
- later other venues

Shield translates human mandates into platform-specific enforcement.

The user should eventually be able to say something universal like:

"Don't let me add another £1,000 when I'm already down £750."

without caring which chain/platform is underneath.

For THIS hackathon:

HYPERLIQUID is the primary demo trading environment.

Do not attempt broad multi-platform support unless it is nearly free.

Jupiter is a future adapter, not a priority for this run.


# HYPERLIQUID-FIRST DIRECTION

Research current Hyperliquid and Privy documentation FIRST.

Privy currently has first-party Hyperliquid material covering areas such as:

- Privy-managed EVM wallets
- Hyperliquid trading
- funding
- order execution
- agent/API wallets
- subaccounts
- policies
- sensitive User Signed Actions
- account/subaccount transfers

The Graph currently documents HyperEVM as a supported network.

VERIFY all of this against current official documentation before relying on it.

Do not assume an architecture just because this prompt suggests it.

The user has explicitly chosen:

HYPERLIQUID as the primary trading integration.

Your task is therefore to determine the strongest implementation of:

PROTECTED CAPITAL
↓
SHIELD CONTROL LAYER
↓
HYPERLIQUID RISK / TRADING ACCOUNT

Possible primitives may include:

- Privy embedded/master wallet
- Hyperliquid subaccounts for isolated trading bankroll/PnL
- Hyperliquid agent/API wallet for fast trading
- Privy policies around sensitive operations
- owned policies / authorization requirements
- custom Shield smart contract/vault on the most appropriate EVM environment
- HyperEVM
- Arbitrum funding path
- delayed weakening logic
- user + guardian/quorum models where safe
- Chainlink CRE for confidential behavioural risk
- The Graph for live behavioural memory

BUT:

do not blindly implement every layer.

Find the minimal architecture that provides the strongest user promise.


# NON-NEGOTIABLE SECURITY CLAIM

We cannot claim:

"tilted-you cannot undo this"

if tilted-you can simply:

- export the wallet key
- delete the Privy policy
- swap owners
- create another unrestricted signer
- bypass Shield through the master wallet
- move protected assets via another route
- immediately withdraw from the protected pool
- use a different exposed permission

Threat-model this carefully.

The current repository contains a substantial working Solana/Anchor implementation from earlier work.

DO NOT destroy working code before understanding what exists.

Before architectural changes:

1. inspect git status/history
2. run current tests/build
3. make a safe checkpoint/commit if appropriate
4. document what currently works

Then evaluate the cleanest Hyperliquid-first architecture.

Because this is a hackathon, do not spend the whole run performing a multi-chain rewrite if it does not improve the actual demo.

Use a strict architecture gate.

Research + prototype the critical Hyperliquid/Privy enforcement path early.

If a full migration is technically viable and materially improves:
- user experience
- sponsor probability
- practicality
- demo
- product thesis

then commit to it.

If a particular enforcement mechanism is not sound, do NOT fake it.

Preserve the strongest existing hard-enforcement primitive and adapt the user experience around reality.

Never claim stronger self-custody or enforcement guarantees than the implementation actually provides.


# USER-FACING RULE ENGINE

Launch with a FOCUSED rule set.

Must include:

1. TRADING BANKROLL
   "I'm willing to risk £1,500."

2. PROTECTED FLOOR
   "Keep at least £8,000 outside trading risk."

3. MAX RELOAD / ADDITIONAL CAPITAL
   Example:
   "Maximum £300 additional capital every 24h."

4. LOSS-TRIGGERED COOLDOWN
   Example:
   "After £750 of losses, block new funding for 12 hours."

5. FIRST-TIME / UNKNOWN LARGE TRANSFER HOLD
   Example:
   "First-time transfers above £500 wait 30 minutes."

Strong candidate:

6. SECOND RELOAD AFTER LOSS
   Example:
   "After my second reload in a losing session, pause new funding."

Research and implement additional rules ONLY if they are clearly valuable to the USER.

Potential examples to evaluate:

- late-night risk expansion delay
- unusual session-size rule
- leverage ceiling
- increasing position size after loss
- repeated reload velocity
- rapid first-time destination transfer
- unusually large change vs personal baseline

Do not build twenty toggles.

Prioritise:
few rules
strong semantics
great UX
real enforcement.


# PERSONALISATION IS CORE

Shield should feel like:

"This thing remembers how I behave."

NOT:

"This is a generic crypto limit app."

Use LIVE blockchain/trading data wherever technically possible.

The Graph should become Shield's behavioural memory.

Potential personalised features:

- typical session size
- typical session duration
- funds deployed
- funds returned
- net session flow
- reload count
- time between reloads
- reloads after losses
- biggest losing sessions
- unusual session size
- venue usage
- time-of-day patterns if defensible
- escalation after first loss
- increasing deposits after losses

Examples of excellent product insight:

"Your normal session uses £620.
Tonight you've deployed £1,500 in 47 minutes."

"3 of your 4 largest losing sessions involved another reload."

"You normally stop after one reload.
Tonight you've attempted three."

"You've sent £4,100 into trading tonight.
£2,810 has returned."

Only show claims the data ACTUALLY supports.

Never invent psychological conclusions like:

"You are 87% tilted."

Shield should not decide whether the user is emotional.

It should observe factual behaviour and make the user's previous decisions persist.


# AI ROLE

AI should help with:

- explaining current behaviour
- translating live activity into understandable patterns
- answering "Why am I blocked?"
- recommending safer rules
- summarising historical patterns
- helping calm-you configure protection

AI must NOT have unilateral authority to:

- release protected capital
- loosen a rule
- shorten cooldown
- remove protections
- bypass deterministic enforcement

AI may be permitted to recommend or trigger a TIGHTEN/EXTEND signal only if the architecture authenticates it safely.

Good:

"You've added funds three times in 47 minutes after a £900 net loss."

Bad:

"AI risk score 92."

Evidence > magic scores.


# SHIELD SHOULD LEARN DURING ONBOARDING

Aim for VERY personalised onboarding.

The target experience:

1. User signs in extremely easily.
2. User connects/imports the relevant trading account/history.
3. Shield analyses real history.
4. Shield surfaces ONE compelling behavioural insight.
5. User tells Shield what normally gets them into trouble.
6. User defines how much capital they are genuinely comfortable risking.
7. Shield proposes a personalised mandate.
8. User edits if necessary.
9. Shield explains:

   "Stricter changes are instant.
    Weaker changes take 24 hours."

10. User activates.

Possible onboarding question:

"What usually gets you into trouble?"

Options:

CHASING LOSSES
"I add more money when I'm down."

GOING ALL-IN
"I risk more than I planned."

REPEATED TOP-UPS
"Once I've started, I keep adding more."

LATE-NIGHT TRADING
"My worst decisions happen when I'm tired."

RUSHED TRANSFERS
"I don't always stop to check where money is going."

TOUCHING SAVINGS
"I move money I previously said I wouldn't use."

Do not make onboarding feel like a clinical questionnaire.

Fast.
Human.
Personal.
Beautiful.


# OPTIONAL POWERFUL FEATURE: MESSAGE FROM CALM-YOU

Evaluate implementing this if it improves the product without distracting from P0.

During setup:

"When you hit your limit, what do you normally tell yourself?"

Maybe:

"I'll make it back."

Then:

"What should Shield remind you when that happens?"

User writes something like:

"If you're seeing this, you've already lost what you agreed to lose.
Don't add another two grand."

When blocked, Shield can show:

"You left yourself this:"

[past-you message]

This is potentially more emotionally powerful than an AI warning because the product is not lecturing the user.

Past-you is.


# CORE APP INFORMATION ARCHITECTURE

Keep the primary logged-in product to FOUR main areas:

HOME
BEHAVIOUR
PROTECTION
ACTIVITY

plus contextual trading/blocked/reset flows.

Do not create navigation soup.


# SCREEN 1 — HOME

The strongest mental model is:

ONE ACCOUNT
TWO ZONES
SHIELD IN THE MIDDLE.

Example:

£10,000 total

£8,500 PROTECTED
      🛡️
£1,500 AVAILABLE TO TRADE

The home screen should immediately answer:

- how much money do I have?
- how much is protected?
- how much can I currently trade?
- am I within my plan?
- can I add more money?
- is any cooldown active?
- is any weakening change pending?

Do not use six equal cards.

Create a dominant visual hierarchy.

Primary actions:

TRADE
ADD FUNDS
GET ME SAFE

Status examples:

🟢 Within your plan

🟡 Approaching your limit

🛡️ Loss cooldown active

Below this:
ONE strong personalised behavioural insight.

Not analytics overload.


# SCREEN 2 — START TRADING

Primary platform:
HYPERLIQUID.

User should be able to move from Home → trading in seconds.

Potential flow:

[Trade]

↓

Hyperliquid

↓

TONIGHT'S SESSION

£1,500 available

Shield active:
- protected floor £8,000
- loss cooldown after £750
- max extra capital £300

[Start trading]

Use the safest appropriate session/agent/subaccount architecture so the user does not need to approve every ordinary operation.

One of the core product principles is:

FRICTION WHEN CALM.
SPEED INSIDE THE PLAN.
FRICTION AGAIN WHEN EXPANDING THE PLAN.

Once a trading session is authorised:

normal activity within the mandate should feel incredibly fast.


# SCREEN 3 — TRADING

This does NOT need to reproduce the entire Hyperliquid professional terminal.

Build enough actual Hyperliquid functionality to make Shield credible and demo real trading.

Focus on whatever gives the strongest complete financial flow.

Possible:

- selected market
- buy/sell
- order size
- leverage where appropriate
- position
- PnL
- available bankroll
- close/reduce position
- market data
- order confirmation/activity

Shield status is subtle:

"🟢 Within plan · £940 available"

When approaching a boundary:

"🟡 £220 until your reload protection"

DO NOT interrupt normal trading with paternalistic warnings.

If real integration allows opening/closing testnet positions, use it.

Do not build fake trading interactions that look real.


# SCREEN 4 — BLOCKED / TILTED MODE

This is the signature product moment.

Make it exceptional.

User is down heavily.

They press:

ADD £1,500

Shield blocks it.

Not a toast.

Not:

"Transaction rejected."

Make the UI emotionally and visually memorable.

Possible copy:

NOT TONIGHT.

You decided this before you started trading.

Started with
£1,500

Remaining
£420

Net session flow
−£1,080

Your rule:
After £750 of losses,
pause new funding for 12 hours.

£8,500 IS STILL PROTECTED.

Available again in:

10h 42m

Primary actions:

END MY SESSION

SEE WHAT HAPPENED

PROTECT ME MORE

Secondary:

I STILL REALLY WANT TO TRADE

There must be NO immediate override.


# SEE WHAT HAPPENED

Show an understandable event narrative.

Example:

20:12
Added £1,500

20:41
First meaningful loss

21:07
Reload attempt

21:46
Loss threshold crossed

21:49
£1,500 top-up blocked

Then:

"This is your third session where a reload followed a loss."

Potential personalised recommendation:

"Pause after the second losing-session reload?"

[Add this protection]

Use real Graph-derived evidence wherever possible.


# PROTECT ME MORE

Safer actions should be immediate.

Potential actions:

FREEZE NEW FUNDING UNTIL TOMORROW

REDUCE TRADING BANKROLL
£1,500 → £750

INCREASE COOLDOWN
12h → 24h

SWEEP IDLE CAPITAL BACK TO SHIELD

STOP TRADING FOR TONIGHT

These should feel safe, satisfying and fast.


# GET ME SAFE

This should become a flagship feature.

Accessible from Home and tilted mode.

Tap:

GET ME SAFE

Explain exactly what will happen.

For supported actions:

- prevent additional risk capital
- sweep idle trading funds back toward protection
- freeze further reloads until tomorrow
- close/reduce supported positions where technically safe and user-authorised
- preserve already-protected capital

Then a deliberate tactile confirmation:

HOLD TO GET SAFE

2 seconds.

Then:

YOU'RE SAFE FOR TONIGHT.

£8,920 protected.

New funding locked until tomorrow.

Do not make "Get me safe" dependent on an LLM.


# 90-SECOND RESET

Build this as a polished optional experience.

User taps:

"I still really want to trade."

The screen becomes much calmer.

"The trade will still exist in 90 seconds."

Show factual personalised context.

Potentially create a subtle interactive visual.

At the end offer only:

KEEP TRADING WITH MY EXISTING BANKROLL

MOVE MY REMAINING BANKROLL BACK TO SAFETY

STOP FOR TONIGHT

Never unlock additional protected capital.


# PROTECTION SCREEN

This is:

MY SHIELD / MY MANDATE

Use HUMAN language.

For example:

"After I lose more than £750,
block new funding for 12 hours."

NOT:

loss_threshold_bps
cooldown_secs

Organise around understandable problems rather than backend primitives.

Potential sections:

MY CAPITAL

CHASING LOSSES

REPEATED TOP-UPS

RUSHED TRANSFERS

OPTIONAL PERSONAL RULES

Clearly communicate:

SAFER CHANGE
Effective immediately.

WEAKER CHANGE
Review after 24h.

If user tries:

Daily additional capital
£300 → £2,000

Show:

CHANGE REQUESTED

Your current £300 limit remains active.

Review in:

23:59:42

After the timer ends:

do NOT automatically change it.

Require reconfirmation.


# BEHAVIOUR SCREEN

This is NOT an analytics dashboard.

The purpose is:

"Understand how I actually behave."

Top:

YOUR PATTERN

Example:

"Your biggest losses happen after you add more money."

Then only high-value personalised evidence:

Typical session
£620 deployed

Largest losing session
£2,850

Average reload after first loss
31m

Sessions with 2+ reloads
4

Then narrative insights.

Example:

"3 of your 4 worst sessions involved a second reload."

Potential rule suggestion:

"Pause new funding after the second reload in a losing session."

[Add protection]

Every graph should answer a clear question.

Do not add charts merely because fintech apps have charts.


# ACTIVITY SCREEN

This is the proof/trust layer.

Human-friendly first.

Examples:

£300 top-up allowed

£1,500 top-up blocked

Loss protection activated

Protection increased

Weaker rule change requested

Funds swept to safety

Risk verdict received

Trade opened/closed

Tap any event to reveal technical evidence:

- transaction
- platform action
- Graph evidence
- policy version
- CRE verdict if applicable
- explorer links

Consumer UX first.
Technical verifiability underneath.


# MORNING-AFTER EXPERIENCE

This is important enough to build.

When the user returns after a blocked session:

LAST NIGHT

£1,500 starting bankroll
−£1,080 net session flow
£1,500 additional capital blocked
£8,500 remained protected

Then:

"At 22:13 you asked to disable your loss cooldown."

"Still want to?"

[KEEP MY PROTECTION]

[CHANGE IT]

This is the delayed weakening mechanic paying off.

Potential follow-up:

"This was your third session where losses were followed by another reload attempt."

[Add stronger protection]

Shield should help calm-you learn from tilted-you.


# SPONSOR STRATEGY

Sponsor priority is:

1. THE GRAPH
2. PRIVY
3. CHAINLINK

These are the ONLY sponsor ecosystems to prioritise unless current live research reveals that one of them is impossible or ineligible.

Do not bounty-stuff.


# THE GRAPH — HIGHEST PRIORITY

The Graph should be extraordinarily strong.

We want a Graph judge to think:

"This product fundamentally depends on our data."

There are currently two potentially relevant From Scratch prize directions:

A. Best AI Tooling or AI Use Case with The Graph

B. Best Use of Composable or Standardized Graph Products

VERIFY the current ETHOnline prize page and exact qualification requirements.

Do not assume prize stacking is allowed.

## Graph AI use case

This should be extremely natural.

The Graph supplies the LIVE behavioural memory used to:

- reconstruct trading behaviour
- detect session activity
- derive behavioural features
- answer "Why am I blocked?"
- generate personalised insights
- inform rule recommendations
- potentially contribute to an authenticated tighten/extend decision

Pipeline concept:

LIVE GRAPH DATA
↓
BEHAVIOURAL FEATURES
↓
REASONING / PERSONALISATION
↓
USER DECISION / SAFETY ACTION
↓
ONCHAIN/POLICY ENFORCEMENT

This must use live data from an eligible Graph provider.

No mocked/local-only/static data for qualification.


## Graph composable/standardized opportunity

Investigate whether we can build something genuinely reusable such as:

WALLET / TRADING BEHAVIOUR PRIMITIVES

Potential output events:

CapitalDeployed
CapitalReturned
TradingSessionStarted
TradingSessionEnded
ReloadAfterLoss
NetSessionFlow
LossVelocity
RiskExpansionAttempt

Potential architecture:

existing standardized/composable primitive
↓
our reusable behavioural module
↓
Shield-specific risk/personalisation pipeline

The goal is NOT to rename our app-specific code "standardized."

It must legitimately meet current Graph requirements.

Investigate:
- current standardized schemas
- composable Substreams packages
- HyperEVM support
- reusable EVM transfer/swap primitives
- Subgraph MCP
- combining two or more Graph products if useful
- publishing a reusable Substreams module if appropriate

If qualifying strongly for BOTH Graph categories requires a modest amount of high-quality reusable work:
DO IT.

If it would distort the product or only superficially qualify:
prioritise the AI Use Case.


# PRIVY — PRODUCT UX + REAL FINANCIAL FLOW

Privy should transform the user experience.

It must NOT be:

"We use Privy for login."

Use Privy as a core piece of the actual trading/control experience.

Potential responsibilities:

- frictionless authentication
- embedded wallet
- Hyperliquid integration
- funding
- actual trade execution
- subaccounts
- agent/API wallet
- scoped signers
- wallet policies
- owner-controlled policies
- policy mutation controls
- quorum/shared authorization where appropriate
- transaction abstraction

Research current generally available features.

The target Privy sponsor story:

User opens Shield
→ signs in without seed phrase ceremony
→ gets secure wallet/account
→ allocates risk capital
→ starts a Hyperliquid session
→ executes a real trade
→ Shield controls sensitive risk-expanding actions

Privy should make this dramatically easier than a normal crypto trading setup.

We are targeting:

BEST FINANCIAL FLOW

unless current live bounty criteria indicate another track is stronger.

Ensure at least one clearly qualifying real Privy financial flow works end to end.


# PRIVY + HYPERLIQUID CONTROL RESEARCH

Research specifically:

- master wallet
- Hyperliquid subaccounts
- agent wallets
- User Signed Actions vs L1 actions
- account transfers
- withdrawals
- agent approvals
- leverage actions
- policies on sensitive operations
- policy ownership
- policy updates
- key export restrictions
- quorum ownership
- stateful policies/aggregations if relevant

Answer:

How can we create:

FAST ORDINARY TRADING

but

STRONG CONTROL OVER RISK-EXPANDING CAPITAL MOVEMENTS?

This is one of the most important architecture questions.


# CHAINLINK — PRIVATE GUARDIAN

Chainlink is lower priority than Graph + Privy but the repository already contains substantial CRE work.

Complete it cleanly.

The product argument:

The user may not want a company publicly building a detailed behavioural/risk profile.

Potential architecture:

The Graph:
supplies live behavioural evidence

↓

Chainlink CRE Confidential Workflow:
evaluates private user thresholds / private behavioural features / private model or API interaction

↓

outputs only:
minimal authenticated safety verdict

↓

Shield:
can TIGHTEN or EXTEND protection

Potential output:

COOLDOWN_UNTIL
reason code
evidence hash
nonce/config version

Sensitive:
- private thresholds if appropriate
- personal profile
- intermediate reasoning
- credentials
- model response if used

Never let Chainlink/AI:

- release protected capital
- loosen a rule
- shorten cooldown
- become a single point of liveness for safe exits

Verify the current Confidential Workflow requirements.

Perform the required successful CRE simulation/deployment and capture evidence if credentials permit.


# HACKATHON JUDGING

Research the current official ETHOnline judging criteria.

Recent ETHGlobal events judge around:

- TECHNICALITY
- ORIGINALITY
- PRACTICALITY
- USABILITY / UI / UX / DX
- WOW FACTOR

Do NOT blindly assume wording if ETHOnline differs.
Verify.

Use these criteria as continuous acceptance tests.


## TECHNICALITY

Judges should be able to see genuine complexity:

- hard commitment semantics
- asymmetric policy changes
- Privy/Hyperliquid permissions
- Graph live behavioural pipeline
- personalised risk state
- CRE confidentiality
- threat modelling
- bypass resistance
- platform adaptation

But technical complexity should not leak into consumer UI.


## ORIGINALITY

Our original insight must remain obvious:

Crypto wallets protect your keys.

Shield protects the decisions you made before your emotional state changed.

The key mechanism:

CALM-YOU SETS THE MANDATE.
TILTED-YOU CANNOT INSTANTLY EXPAND IT.

Do not let the project collapse into:

"wallet spending limits."


## PRACTICALITY

A real user should plausibly use the product.

Real login.
Real wallet.
Real testnet trade.
Real data.
Real policy.
Real block.
Real delayed weakening.

Avoid demo theatre.


## USABILITY

This should be one of our biggest advantages.

Complex infrastructure should disappear.

Beautiful flows.
Minimal jargon.
Fast normal trading.
Personalised interactions.
Mobile-quality UX.


## WOW FACTOR

Design several moments people remember:

1. Landing-page visual story.
2. Shield learning something eerily accurate from the user's own history.
3. Real Hyperliquid trade.
4. Rage top-up.
5. "NOT TONIGHT."
6. Protected £8,500 remains.
7. User attempts to disable rule.
8. "Of course. Tomorrow."
9. GET ME SAFE.
10. Morning-after review.


# LANDING PAGE

Build a completely polished animated landing page in this run.

The attached Hyperliquid website screenshot is a QUALITY REFERENCE, not something to copy.

Study its qualities:

- full-bleed visual environment
- almost cinematic hero
- dark, premium atmosphere
- unusual organic forms
- restrained navigation
- large editorial typography
- high visual confidence
- minimal clutter
- smooth transitions
- sophisticated modern fintech/crypto aesthetic

Shield must have its OWN identity.

Aim for:

FUTURISTIC
CALM
PREMIUM
EMOTIONAL
TRUSTWORTHY
SLIGHTLY REBELLIOUS

Not:
hospital
bank compliance software
gambling intervention leaflet
generic Web3 dashboard
purple-gradient startup template


# LANDING-PAGE STORY

Create a scroll-driven narrative.

Opening:

CRYPTO GIVES YOU FREEDOM.

Scroll.

SOMETIMES TOO MUCH.

Visual:

£10,000 capital.

Calm user allocates:

£8,500
PROTECTED

£1,500
TRADING

Then:

"Calm you knows your limits."

The £1,500 moves into a trading environment.

The emotional/story animation evolves.

Possible sequence:

£1,500
↓
£1,830

subtle confidence / excitement

↓

£1,250

↓

£820

↓

£420

Messages emerge organically:

"I can make it back."

"One more."

"Just add another £1,500."

Emotion becomes visually more chaotic.

Use tasteful expressive character/icon moments, not childish emoji spam.

The user reaches for another £1,500 of protected capital.

Money physically starts travelling across the screen.

Then:

CLUNK.

It hits Shield.

BLOCKED.

Everything calms.

Protected £8,500 remains untouched.

Copy:

CALM YOU SETS THE LIMITS.

TILTED YOU CAN'T INSTANTLY UNDO THEM.

Then explain:

Freedom inside your plan.
Friction when expanding it.

Further scroll sections may demonstrate:

REVENGE TRADING

REPEATED TOP-UPS

RUSHED TRANSFERS

SCAM URGENCY

but always as manifestations of ONE thesis:

"The version of you making the decision changed.
Your wallet's permissions didn't."

Then show product.

Then real behaviour/personalisation.

Then final CTA.


# LANDING PAGE MOTION

Use high-quality scroll choreography.

Potential techniques:
- pinned sections
- scroll-linked capital movement
- organic liquid backgrounds
- soft depth
- money tokens/particles used sparingly
- animated balance transitions
- shield barrier interaction
- gradual shift from calm → chaotic → calm
- subtle physics
- text reveals
- tactile blocked impact
- motion responding to scrolling
- tasteful cursor effects if appropriate

Do NOT:
- use random 3D because it looks impressive
- make the page heavy/unusable
- copy Hyperliquid assets
- overuse glass cards
- create neon Web3 sludge
- put paragraphs everywhere
- animate everything simultaneously

Performance matters.
Mobile fallback matters.
prefers-reduced-motion matters.


# VISUAL SYSTEM

You are allowed to substantially rebuild the frontend.

Preserve backend functionality where appropriate.

Create a coherent design system.

Consider:

- strong typography pairing
- potentially editorial serif for large statements + exceptional sans for product UI
- restrained dark palette
- one distinctive Shield accent
- very clear risk/safety states
- excellent spacing
- large meaningful numbers
- minimal chrome
- low card count
- subtle borders
- purposeful rounded geometry
- tactile interactions
- premium data visualisation

Avoid default shadcn aesthetics.

The logged-in app can be calmer/more functional than the landing page while clearly belonging to the same brand.


# MICROCOPY

Write like a human.

Excellent:

"Not tonight."

"You decided this before you started trading."

"£8,500 is still protected."

"Within your plan."

"Of course. Review this tomorrow."

"You normally stop after one reload."

"You left yourself this."

"Get me safe."

Poor:

"Risk threshold violation."

"Execution blocked due to policy."

"AI identified emotional distress."

"Behavioral risk score 82."

"Onchain protection transaction successful."


# USER PSYCHOLOGY PRINCIPLE

Do not create generic warning spam.

When the user is calm:
give them control and analysis.

When trading normally:
GET OUT OF THE WAY.

When behaviour becomes unusual:
increase awareness quietly.

When their own mandate is reached:
ENFORCE.

When tilted:
offer time, separation and safe actions.

When calm again:
return authority through positive reconfirmation.

This state-based UX should be visible throughout the implementation.


# DEMO

Design implementation around a deterministic killer 2–4 minute demo.

Potential final story:

0:00
Animated landing page:

"Crypto gives you freedom.
Sometimes too much."

0:15
Sign in with Privy.

0:25
Shield analyses wallet/trading history.

"3 of your 4 largest losing sessions involved another reload."

0:40
User creates:

£1,500 risk bankroll
£8,500 protected
£750 loss → 12h no reload
24h delayed weakening

0:55
Start Hyperliquid session.

1:05
Place REAL testnet trade(s).

1:20
Demo precondition creates/loads meaningful loss state.

1:30
The Graph updates behavioural state.

1:40
User presses:

Add £1,500.

1:43

NOT TONIGHT.

Started: £1,500
Remaining: £420
Net session flow: −£1,080
£8,500 protected.

1:55
"Why?"

Personalised Graph-grounded explanation.

2:05
User tries:

Disable cooldown.

Shield:

"Of course. Review this tomorrow."

2:15
User taps:

GET ME SAFE.

2:25
Show activity proof / Graph / Privy / CRE evidence.

2:40
Close:

"Calm you sets the limits.
Tilted you can't instantly undo them."

Improve this if you discover a better sequence.

The entire demo must remain understandable to someone who knows NOTHING about:
- HyperEVM
- CRE
- Substreams
- Privy policies

The sponsors are visible through capability, not exposition.


# BUILD PRIORITIES

If time/usage becomes constrained:

P0 — ABSOLUTELY PROTECT

1. user-first product model
2. Hyperliquid primary trading flow
3. Privy login/wallet/real financial flow
4. protected vs trading capital
5. hard risk-expansion enforcement
6. 24h delayed weakening + reconfirmation
7. real Graph live behavioural data
8. highly personalised onboarding/insights
9. killer blocked-top-up experience
10. Get Me Safe
11. professional app UI
12. real tests/build
13. demo reliability
14. sponsor qualification evidence

P1

15. reusable Graph behavioural primitive / composable track
16. 90-second Reset
17. morning-after experience
18. calm-you message
19. Chainlink confidential risk polish
20. beautiful activity proof layer
21. mobile polish

P2

22. additional rule types
23. additional trading platforms
24. excessive charts
25. extra AI features
26. unnecessary settings

CUT P2 before weakening P0.


# RESEARCH PROCESS

Work autonomously in this order.


## PHASE 1 — BASELINE

1. Read all previous context.
2. Inspect the full repo.
3. Inspect git status/history.
4. Run current app.
5. Run tests.
6. Run production build.
7. Understand the current Solana/Anchor/Graph/CRE implementation.
8. Create a safe checkpoint if appropriate.

Do not destroy known-working functionality blindly.


## PHASE 2 — CURRENT OFFICIAL RESEARCH

Research current primary-source docs for:

- ETHOnline rules
- current judging criteria
- current prize structure
- maximum partner selections
- The Graph prizes
- Graph HyperEVM support
- Graph live provider requirements
- Graph composable/standardized requirements
- Substreams packages/registry
- Privy financial-flow bounty
- Privy Hyperliquid integration
- Privy wallet ownership/policies/quorums/export constraints
- Privy stateful policies
- Hyperliquid testnet
- Hyperliquid master/subaccount architecture
- Hyperliquid agent wallets
- Hyperliquid sensitive vs normal trading actions
- HyperEVM
- Chainlink Confidential Workflow
- exact current CRE simulation/deployment requirement

Create/update:

docs/HACKATHON_STRATEGY.md

Do not trust stale copied bounty amounts.


## PHASE 3 — ARCHITECTURE GATE

Threat-model the intended Hyperliquid control layer.

Answer concretely:

A. Where is protected capital?

B. Who can move it?

C. How does money become trading bankroll?

D. What exactly does Hyperliquid hold?

E. Is a subaccount useful?

F. What can an agent wallet do?

G. What can't it do?

H. Where do Privy policies add actual enforcement?

I. Who owns/modifies those policies?

J. Can the user export/bypass the wallet?

K. How does tighten-fast / loosen-slow work?

L. How does the user recover if Shield disappears?

M. How do we avoid stranding funds?

N. Which actions can be instant safely?

O. Which actions must be delayed?

P. Where does Graph data come from?

Q. Where does CRE sit?

R. What guarantees are genuinely onchain vs wallet-infrastructure-level?

Write/update:

docs/ARCHITECTURE_DECISION.md
docs/THREAT_MODEL.md

Then COMMIT.

Do not repeatedly revisit unless implementation disproves the decision.


## PHASE 4 — BUILD THE PRODUCT CORE

Implement the actual control layer.

Get a minimal real Hyperliquid flow working early.

Prove:

1. create/connect Privy wallet
2. create/use Hyperliquid account/subaccount as chosen
3. fund appropriately on testnet
4. execute trade
5. read position/PnL
6. control additional capital movement
7. block at least one genuinely forbidden risk-expansion path
8. make safer change immediate
9. make weaker change delayed
10. require positive reconfirmation after delay


## PHASE 5 — GRAPH MEMORY

Build the strongest live Graph pipeline.

Use current official SKILLs if useful.

Prefer existing composable packages when appropriate.

Deploy/consume from a valid live Graph provider.

Derive real behavioural state.

Expose a clean internal representation like:

Session
CapitalDeployed
CapitalReturned
NetSessionFlow
ReloadAttempt
ReloadAfterLoss
SessionDuration
LossVelocity
PersonalBaseline

Do not overclaim metrics.


## PHASE 6 — PERSONALISATION

Make onboarding and Behaviour use those data.

Build useful recommendations.

Every insight should be:
- specific
- factual
- understandable
- actionable


## PHASE 7 — PRIVY DEPTH

Implement the strongest generally-available Privy controls that improve the product.

Do not stop at login.

Prove the financial flow.

Prove Privy is helping make ordinary trading fast while securing sensitive actions.


## PHASE 8 — CHAINLINK

Complete the existing CRE Confidential Workflow if still compatible with the chosen architecture.

Run the actual required simulation/deployment when credentials permit.

Make private judgement affect a genuine tighten/extend action if architecturally appropriate.


## PHASE 9 — APP REBUILD

Implement the full screen architecture.

Desktop AND mobile.

Use real integrations/data wherever possible.

No fake buttons.


## PHASE 10 — LANDING PAGE

Build the polished narrative marketing site.

Use the provided Hyperliquid screenshot as a quality reference.

Do not copy it.

Create Shield's own memorable visual identity.


## PHASE 11 — PRODUCT GAUNTLET

Run at least THREE serious audits.

LOOP 1 — USER

Be the 19-year-old trader.

Ask:

Would I actually use this?

Is normal trading fast?

Does anything annoy me?

Does Shield understand me?

Do I know why I was blocked?

Can I safely get out?

Does it feel judgemental?

Can tilted-me trivially bypass this?


LOOP 2 — SPONSOR JUDGE

For Graph:
Is Graph unmistakably load-bearing?
Is data live?
Is meaningful processing happening?
Do we strongly qualify?
Could reusable primitives legitimately qualify for composable?

For Privy:
Is there a real financial flow?
Does Privy transform UX?
Are controls/signers/policies meaningful?

For Chainlink:
Is confidential computation core?
Is execution evidence present?


LOOP 3 — ETHGLOBAL FINALIST JUDGE

Score brutally:

Technicality / 10
Originality / 10
Practicality / 10
Usability / 10
WOW / 10

For every score below 9:
identify the highest-leverage fix and implement it if feasible.


## PHASE 12 — DEMO GAUNTLET

Run the final demo repeatedly.

Fix:
- awkward loading
- slow data
- missing state
- confusing copy
- bad transitions
- unreliable network dependence
- visual weakness

Build deterministic fallback mechanisms WITHOUT faking the underlying sponsor integrations.


## PHASE 13 — FINAL QUALITY

Run:

- contract tests
- application tests
- behaviour engine tests
- typecheck
- lint
- production build
- security/bypass tests
- responsive inspection

Fix failures.


## PHASE 14 — SUBMISSION PACKAGE

Update/create:

README.md
docs/HACKATHON_STRATEGY.md
docs/ARCHITECTURE_DECISION.md
docs/THREAT_MODEL.md
docs/SPONSOR_INTEGRATIONS.md
docs/DEMO_SCRIPT.md
docs/SUBMISSION.md
docs/JUDGE_QA.md
docs/AI_USAGE.md
HUMAN_ACTIONS.md

For each sponsor document:

- exact track
- exact requirements
- files implementing it
- why it matters to the user
- why it is load-bearing
- deployed IDs/addresses/endpoints
- exact demo moment
- verification instructions
- evidence
- remaining blocker if any


# STOP CONDITIONS

Do NOT stop because:

- you wrote a plan
- you researched Hyperliquid
- you built a landing page
- login works
- one trade works
- the old app already looked reasonable
- Graph package compiles
- CRE compiles
- usage is non-trivial
- a dependency fails once

Use:

RESEARCH
→ IMPLEMENT
→ RUN
→ INSPECT
→ FIX
→ RETEST

Do not endlessly retry impossible credential-gated work.

If credentials are missing:

finish everything around it,
write the exact human action,
then continue elsewhere.

Before stopping, either complete or explicitly prove blocked:

- product architecture locked
- current hackathon rules verified
- Hyperliquid real integration exists
- Privy real wallet exists
- real financial flow exists
- normal trading is fast
- protected/risk capital split exists
- risk-expansion path genuinely blocked
- safer changes immediate
- weaker changes delayed 24h
- post-delay reconfirmation required
- live Graph provider used
- personalised behaviour exists
- Graph AI use case strongly qualifies
- Graph composable opportunity assessed/implemented if worthwhile
- CRE successfully simulated/deployed if credentials available
- landing page exceptional
- Home exceptional
- blocked state exceptional
- Get Me Safe works
- 90s Reset works if feasible
- Behaviour is personalised
- Protection is human-readable
- Activity provides evidence
- mobile works
- demo works
- build passes
- tests pass
- sponsor evidence prepared
- submission prepared

If a visible feature is fake:
make it real or remove it.

If a feature does not improve the user's experience:
challenge whether it belongs.


# FINAL DELIVERABLE

DO THE WORK FIRST.

At the very end give me a concise report with ONLY:


## 1. PRODUCT

What Shield is now.

Final user journey.

Strongest UX moments.


## 2. WHAT YOU BUILT

Major implementation completed.

Hyperliquid.

Privy.

The Graph.

Chainlink.

Frontend.

Landing page.


## 3. ARCHITECTURE

Where money lives.

How trading works.

What actually enforces limits.

How bypass resistance works.

What "tighten fast / loosen slowly" means technically.


## 4. SPONSOR STATUS

THE GRAPH
- exact track(s)
- qualification status
- why this could win
- missing requirements

PRIVY
- exact track
- qualification status
- why this could win
- missing requirements

CHAINLINK
- exact track
- qualification status
- why this could win
- missing requirements


## 5. ETHGLOBAL SCORE

Brutally score final implementation:

Technicality /10
Originality /10
Practicality /10
Usability /10
WOW /10

Explain weaknesses only.


## 6. DEMO

Final 2–4 minute flow.


## 7. TEST STATUS

Tests.
Typecheck.
Build.
Deployment.
Live endpoints.


## 8. HUMAN ACTIONS

Only unavoidable actions requiring me.

Exact commands/credentials/URLs where appropriate.


## 9. NEXT FIVE ACTIONS

Maximum five.

Only highest-leverage actions before submission.


Do not finish with a long speculative product essay.

Ship the product.