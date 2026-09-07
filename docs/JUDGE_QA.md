# Judge Q&A

Answers describe what the code does, not what we would like it to do. Where
the answer is a limitation it is written as one. Everything factual here is
in `docs/gauntlet/FACTS.md`, checked against the chain or a command that was
actually run.

The one-line version: `ShieldVault.sol` is deployed and immutable on HyperEVM
testnet (chain 998) at `0xcdB6d631A00857584e70a21d800f51C5776302Fe`. It holds
a user's protected USDC and releases it into their Hyperliquid account under
rules they set while calm. Tightening a rule is instant; loosening waits and
has to be confirmed again afterwards.

## The product

**Why does this need a blockchain? A bank spending limit does the same thing.**
No bank will refuse you your own money. A card limit is raised by calling
support, and support exists to say yes — that is the whole business. What a
commitment device needs is a counterparty with no discretion and no incentive
to grant the exception, and that is exactly what a contract with no owner is.
The second reason is jurisdictional: the money is already USDC and the venue
is a perps exchange that credits a deposit in one block. A bank limit cannot
govern an on-chain transfer at all.

**Why won't the user just bypass it?**
Inside the vault, the paths are closed and tested: there are five ways money
leaves, each to a destination registered in advance and typed permanently;
splitting hits a rolling 24h budget shared by top-ups and cold transfers;
adding a new destination to a funded vault is a delayed change; raising a
limit is a delayed change that any tightening in between invalidates; leaving
is a proposal at the user's own exit delay. 41 Foundry tests run those
attacks against the deployed logic. Outside the vault, of course they can:
money that never entered Shield is not protected. The app says so itself, in
the connected-venue panel on Home, under the button that opens Hyperliquid:
"Money you send here yourself never passes through Shield, and none of your
rules apply to it." (`app/src/pages/Overview.tsx`.) The obvious bypass deserves
to be answered by the product rather than by a document.

One caveat we found while writing the threat model and did not paper over: a
top-up proposal left pending for more than 24 hours, then cancelled, refunds
velocity that has already expired and can clear the day's accumulator. The
practical ceiling is about twice the daily limit in a window, with a day of
setup. It is written up in full in `docs/THREAT_MODEL.md` (Known gaps 1). The
contract is immutable, so it is a disclosed limitation rather than a fix.

**What if they genuinely need the money?**
Two exits, neither of which any cooldown can block. Up to the emergency cap
moves to their own registered cold wallet instantly — subject to the protected
floor and the shared 24h budget, so it is not unconditional. Anything larger,
including everything, is a full exit at the delay they chose (7 days by
default, 1 hour minimum), and a full exit ignores the floor entirely. Nothing
is custodial at any point.

**Can the user trap themselves?**
Yes, if they try hard. `tighten` bounds the loss cooldown and the self-pause
at 30 days each, but places no upper bound on the weakening delay or the exit
delay. Someone hand-crafting a `tighten` call can set both to a value that
puts their own funds out of reach permanently, and there is no admin to
appeal to. The app never offers those values. We would rather tell you than
have you find it.

**How do you know they lost money?**
There are two views of the same 24 hours, and only one of them can tell a loss
from an open position.

The flow view is the one Shield builds itself: USDC released from the vault to
the trading account, USDC that comes back, and the shortfall booked as a loss.
It cannot see the difference between capital that was lost and capital that is
still deployed. A session that sent $100, got $30 back and still held $246 at
the venue reads as a $70 loss while the account is up $5. That is not a
hypothetical — it fired on the live testnet vault and blocked a winning
account, which is the worst thing this product can do. Block someone once
while they are winning and they will never trust the rule again.

So where the venue answers, the venue decides. Hyperliquid settles its own
trades and knows what is closed, so its realised PnL is the number the rule
reads, taken from its public info API and never inferred from HyperEVM. The
flow view is the fallback: for when the venue does not answer, and for a
destination with no API at all, where over-counting exposure as loss is at
least the safe direction to be wrong in. The switch is one line in
`server/policy.ts` — `const venueDecides = !!venue` — and it changes the
wording on the screen too: with the venue answering, a session line reads
"$70 still at the venue", not "$70 lost", because saying "lost" would
contradict the number printed above it.

**What if the data source is wrong?**
Then the worst that happens is a top-up pause of the user's own chosen length,
and only if the attested loss meets the user's own trigger. A wrong verdict
cannot move money, loosen a rule, block a cold transfer, block an exit, or
invalidate the user's own pending proposals. The evidence hash is on-chain, so
a wrong verdict is provably wrong after the fact.

**Why would anyone voluntarily constrain themselves?**
This is the hardest question about the product, and the answer is a screen
rather than an argument. Step 0 of setup asks for the Hyperliquid account the
user trades from and reads its public history before proposing a single rule —
ledger updates and fills from Hyperliquid's info API, no credentials
(`server/hyperliquid.ts`). It groups that history into sessions (activity
separated by six hours of quiet), takes realised PnL from the venue's own
`closedPnl` minus fees, and shows the user four numbers about themselves:
how many sessions they have had, their typical session size (the median of
what they deployed), their largest losing session, and how many sessions
included a reload made while already down.

Above those numbers is one sentence generated from the same data, of the form
"3 of your 4 largest losing sessions involved another reload." Nobody has to
be persuaded that the reload after a loss is their problem; they are shown
their own count of it, before they are asked to commit to anything.

Then the rules are proposed from those numbers rather than from a template
(`app/src/pages/Setup.tsx`): the median session size becomes the suggested
bankroll, and the loss trigger, the daily limit, the pause length and the
large-move threshold are all derived from it and from which patterns the
history actually shows. The user changes any of them. An account with no
history is fine — it says so, and the rules start from defaults.

**Why these delays, and does any of this work?**
The shape is not invented. Asymmetric commitment — instant to tighten, delayed
to loosen — is the near-universal design in gambling regulation, which is the
one field that has run this experiment at national scale. Marionneau, Luoma,
Turowski & Hayer (2025), *Harm Reduction Journal* 22(1):15,
doi:10.1186/s12954-024-01150-3, reviewing 30 European countries: "In all
countries, lowering personal pre-commitment limits took place immediately or
as soon as possible, but raising limits involved waiting times of different
durations, ranging from 24 h to seven days."

The UK specifies Shield's exact mechanism, reconfirmation included. Gambling
Commission RTS 12D requires that a limit increase take effect "only after a
cooling-off period of at least 24 hours has elapsed and only once the customer
has taken positive action at the end of the cooling off period to confirm
their request", while "customer-led reductions to limits must be implemented
immediately". Shield's 24-hour hold plus its "still want to?" reconfirmation
is that, written in Solidity instead of in an operator's terms. Other
jurisdictions chose other lengths: Sweden 72 hours, and not before the current
week or month has expired (Spelförordning 2018:1475, 11 kap.); Australia seven
days (COAG Decision RIS 2018); Ontario 24 hours (AGCO Registrar's Standards
2.24). Shield's defaults — 24 hours to loosen, seven days to leave — sit
inside that range.

The exit cost is time and never money, deliberately. John (2020), *Management
Science* 66(2):503–529, doi:10.1287/mnsc.2018.3236, ran a field experiment in
which people designed their own commitment contracts backed by financial
penalties: "55% of clients default and incur monetary losses". A delay costs an
over-committed user nothing but patience; a forfeit transfers money away from
the person who is already in trouble. Shield has no penalty, no forfeit and no
fee for changing your mind — only a wait. And when the harder option is
offered, people take it: Beshears, Choi, Harris, Laibson, Madrian & Sakong,
NBER w21474 / *Journal of Public Economics* 183:104144, found that when
accounts paid the same interest, "the most illiquid commitment account attracts
more money than any of the other commitment accounts."

The caveat belongs in the same breath, so here it is. Limit-setting has weak
evidence of changing outcomes. Ivanova, Magnusson & Carlbring (2019),
*Frontiers in Psychology* 10:639, doi:10.3389/fpsyg.2019.00639, an RCT with
N=4,328, found that prompting people to set a deposit limit raised take-up
from 6.5% to 45% but "did not affect subsequent net loss". In the same trial,
30–40% of limit-setters later raised or removed their limits, and those who
did lost more. So the honest claim is narrow: Shield's *shape* matches what
regulators converged on and what the commitment-device literature supports.
Nobody has shown that Shield changes anyone's outcome, and the largest trial
of the weaker version of this idea showed no effect on losses. What that trial
does support is where Shield puts its weight — loosening is the behaviour that
preceded the bigger losses, so loosening is the path that should be slow, and
in Shield it is the only path that is.

One more finding shaped the tone rather than the mechanism. Riley, Oakes &
Lawn (2024), *IJERPH* 21(8):998, report that uptake of these tools is low
partly because "users view them as tools for individuals already experiencing
gambling harm as opposed to protective tools for all users." Shield is a
financial control layer for a trader, not a health product and not a
diagnosis; the regulatory parallel above is about mechanism, not category. The
app says the same thing on the screen where it would be easiest to get wrong:
"Nothing here is a diagnosis; it's what you already know about yourself when
you're calm."

**Isn't this gambling-enabling software?**
It is a control layer for people who are already trading, and it adds no
capability to trade with. There is no order
entry, no market list and no leverage control in the app — the primary action
on Home is "Open Hyperliquid". Shield never encourages a trade; it removes the
reload after a loss, which is the specific behaviour that turns a bad day into
a bad year.

## What is actually enforced

**What is enforced on-chain, and what is convention?**
Enforced by `ShieldVault.sol`, with no way around it: the protected floor; the
rolling 24h release budget; the large-amount threshold that pushes a big
top-up onto the delayed path; the cooldown, which blocks every top-up path and
which no function can shorten; the destination registry and its permanent
types; instant tightening; delayed loosening with mandatory reconfirmation;
staleness of any proposal that a tightening has overtaken; the exit delay; and
the exact bound on what a risk verdict may do.

Convention, i.e. the server and the app: which sessions are grouped together,
what counts as a realised loss, when a verdict gets signed at all, every
explanation and every number that is not a rule. If the server dies, none of
the enforcement changes. If the server lies, invariant 9 in
`docs/THREAT_MODEL.md` bounds the damage to a pause.

**What stops Shield stealing the money?**
`ShieldVault.sol` has no owner, no admin, no pauser, no proxy and no upgrade
path. The constructor sets two immutable addresses and an EIP-712 domain
separator; every state-changing function derives its subject from
`msg.sender`. There is no function that sends USDC to an address that is not
a registry entry the user themselves created. The bytecode at the deployed
address is the final bytecode — there is no finalisation step still pending,
because there is nothing to finalise. Shield holds no key that matters. The
one thing Shield influences is whether a verdict gets signed, and a verdict
can only extend a cooldown.

**What happens if Shield disappears?**
The contract keeps working exactly as written, forever, because nobody can
change it. Every path is reachable with `cast send` against the public ABI and
any RPC endpoint — the app is a convenience over the same calldata
(`client/evm.ts`). Honest gap: `client/recovery-cli.ts` is Solana-only; there
is no equivalent one-command EVM tool yet, so recovery today means the ABI and
`cast`.

**What can a risk verdict actually do?**
Extend a cooldown. That is the whole list. The signed struct carries no
duration, no floor, no limit, no amount and no destination — the duration is
the user's own `lossCooldownSecs`, capped at 30 days. The verdict is rejected
unless the attested loss meets the user's own trigger, the nonce strictly
increases, it has not expired, and the signature recovers to the verifier the
user pinned. It never touches `configVersion`, so it cannot invalidate the
user's own pending proposals, and cold transfers and exits never read the
cooldown at all.

One consequence we state rather than hide: a compromised verifier key can
chain verdicts and hold top-ups closed indefinitely, in 30-day increments. It
still cannot move a dollar, and the user can remove the monitor through the
loosening path — which is not cooldown-gated — in as little as an hour.

## The stack

**Why Hyperliquid, and why does the vault sit outside the venue?**
Because that is where the user already trades, and HyperEVM is where a vault
can live and still deliver into the venue in the same transaction: the vault
calls Circle's `CoreDepositWallet.depositFor`, so "add capital to my trading
account" is precisely the action the rules govern, with no bridge and no
withdrawal step in between. The boundary has to sit outside the venue for a
different reason, below.

Verified on chain: the Privy embedded wallet released $5.00 from its vault
straight into a HyperCore perps account in one transaction
(`0x94960d1f…`, block 63581864) — USDC approval and transfer, vault →
CoreDepositWallet → the HyperCore system address, a HyperCore credit, and
`TopUpExecuted(amount=$5, instant=true, route=1)`.

**What stops Hyperliquid, or your wallet, from just building this?**
Nothing. Any venue or wallet could ship it in a week — a sub-account and an
`unlockAfter` timestamp is a sprint of work, and we would not argue otherwise.
The reason none of them can build it *credibly* is not technical.

A venue that holds a customer's money against that customer's stated wish owns
a liability. It therefore has to build an appeals path: a support queue, an
override, an exception for the good customer who is very sure this time. Every
self-exclusion scheme ever shipped by an operator also shipped a way to lift
it. An appeals path is exactly what defeats a commitment device — the device
works only because the answer is no, and an operator that can say yes will
eventually be asked to.

Shield's advantage is that there is nobody to ask. No owner, no admin, no
support queue, no account manager, no relationship to trade on. The contract
is immutable and every path derives its subject from `msg.sender`, so there is
no address anywhere that can grant an exception — including ours. A venue
cannot offer that, and neither can a wallet vendor, because both of them
answer to you. That is also why the rules are in Solidity rather than in a
vendor's policy engine: calm-you sets policy for tilted-you, and a policy a
vendor can change on request is not a policy tilted-you has to live with.

**What does Privy do, and what does it not enforce?**
Privy is sign-in and the key. The embedded wallet is created by Privy on
login and is the vault's authority — the contract gates every path on
`msg.sender`, so that wallet is the only party that can act on the vault. Our
wallet has a nonce of 4 — it signed four transactions itself, among them
`registerOwner`, the $5 release to HyperCore, and a `proposeLoosen`.

Privy enforces nothing about the vault's rules and we do not configure it to
try: no policies, no quorums, no session signers. A user can export the key,
and that changes nothing, because the rules bind the key rather than the app.
Shield deliberately does not co-own keys, so there is no 2-of-2 in which
Shield could hold a user's funds hostage.

**What does the Chainlink enclave do, and what can't it do?**
The whole risk evaluation runs inside a CRE confidential workflow —
`handlerInTee` from `@chainlink/cre-sdk`, registered for AWS Nitro in
`us-west-2`. The sensitive input is the verifier private key, fetched
in-enclave with `runtime.getSecret` and used there to produce the EIP-712
signature. That is the part that is genuinely confidential. The simulation was
run and reproduced; the transcript is in `docs/evidence/cre-simulate.txt`, and
the resulting verdict landed on chain 998 (tx `0x2e411cea…`, block 63584417)
as `RiskVerdictApplied(nonce=1, reasonCode=1, realizedLossUsdc=$3.50,
extended=true)`, leaving that vault in `cooldownReason=2 (RISK_VERDICT)`.

What it cannot do: anything except extend a cooldown, as above. What we will
not claim: that the capital flows are confidential. They are read over plain
HTTP from a local endpoint and they are on-chain facts anyway. And the verdict
today is one enclave signature, not a DON quorum — the native CRE EVM
forwarder is the production upgrade, and it is not built.

**What is The Graph doing, and what is the honest limitation?**
`substreams-evm/` is a five-module Substreams package that decodes
`ShieldVault.sol`'s events and USDC returns into typed flows and running
totals, composed on The Graph's foundational `ethereum-common@v0.3.3` — its
`index_events` module is the declared block filter for both maps, so the
package only touches blocks that contain the vault's logs. The full stateful
pipeline has been run live against a Graph Market provider and completed
successfully; the transcript is `docs/evidence/substreams-live.txt`.

The limitation, which belongs next to the claim every time it is made: that
run returns no rows. The Graph indexes HyperEVM **mainnet** only — there is no
testnet entry in its networks registry — and the vault is on testnet. So the
running server reports `source.mode: "rpc"` and `/api/health` says so in plain
words. The package is correct and streams; it has nothing to stream from until
the contract is on mainnet.

**Where is the money, concretely?**
Protected capital: in `ShieldVault.sol` on HyperEVM, accounted to the user's
own address, no owner and no admin. Bankroll: the user's own Hyperliquid perps
account. Nothing sits with Shield, and nothing sits with Privy.

**Does AI control the user's money?**
No, and there is no AI in the shipped product at all. The verdict is a signed
number that the contract checks against a rule the user set. `docs/AI_USAGE.md`
is about AI writing this repository, which is a different thing entirely, and
we are not claiming an AI track on the strength of it.

## The company

**Is this a feature or a company?**
Honestly, the first version is a feature — a commitment device around one
venue. The company is the layer it generalises into: a self-custodial policy
layer that sits between people and every venue they use, with their own
verified history as the enforcement input. Wallets protect keys; exchanges
protect themselves; nobody protects intent. That layer is chain- and
venue-agnostic by construction, which is why the same rule engine already runs
on two chains and why every screen in the app reads from a chain-agnostic
view.

**What is the business model?**
Consumer: a small subscription, or basis points on protected balances above a
free tier. B2B: venues and bots integrate a "fund from Shield" button, which
is a real reduction in their chargeback and regulatory exposure. Neither is
tested — this is a hackathon build with no users.

**Who is the first user?**
An active Hyperliquid trader whose own fill history shows the pattern: a
losing session, then another deposit within the hour. Setup shows them their
own count of it before it proposes anything. They keep trading exactly as fast
as they like inside the number they choose. The thing they give up is the
ability to refill on tilt.

## What is not built

**What is not built yet?**
- The repository is still private, and all three sponsor tracks require a
  public repo. That is the top blocker, ahead of everything technical.
- No mainnet deployment. It is the single change that turns The Graph's
  indexing limitation from a caveat into a working pipeline.
- No demo video, which every track requires.
- No DON quorum on verdicts — one enclave signature.
- No EVM recovery CLI; recovery is the ABI plus `cast`.
- Two disclosed contract limitations: the velocity refund after a window roll,
  and the unbounded self-imposed delays. Both in `docs/THREAT_MODEL.md`.
- No users, no audit, no mainnet money.

**How can I verify any of this myself?**
There is no public block explorer that indexes HyperEVM testnet — we checked
four and none of them resolve the vault or its transactions, so we link none
of them. The verifiable form is direct:

```
cast tx 0x94960d1f937a3e36e1b16e69922a2579e77b584ed25b2ced044da7991fe889be --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
cast call 0xcdB6d631A00857584e70a21d800f51C5776302Fe "usdc()(address)" --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
cd contracts && forge install foundry-rs/forge-std --no-git && forge test    # 41 passing
```

On HyperEVM mainnet `hyperevmscan.io` works — one more reason the mainnet
deploy matters.
