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
money that never entered Shield is not protected, and the app says so on the
screen where it matters.

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
We do not guess P&L. We measure the closed cycle: USDC released from the vault
to the trading account, and USDC that comes back. A session that returns less
than it received is a realised loss of the difference. Money still in the
venue is shown as exposure, not loss. Narrow and true beats universal and
guessed.

**What if the data source is wrong?**
Then the worst that happens is a top-up pause of the user's own chosen length,
and only if the attested loss meets the user's own trigger. A wrong verdict
cannot move money, loosen a rule, block a cold transfer, block an exit, or
invalidate the user's own pending proposals. The evidence hash is on-chain, so
a wrong verdict is provably wrong after the fact.

**Isn't this gambling-enabling software?**
It is harm reduction for people who are already trading. There is no order
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

**Why Hyperliquid, and why can't Hyperliquid do this itself?**
Because that is where the user trades, and because the venue structurally
cannot offer it. Hyperliquid's agent (API) wallets can only sign orders; every
value-moving action needs the master key, and a user cannot bind their own
master key. So the boundary has to sit outside the venue, in a vault the
master key controls but cannot override. HyperEVM is where that vault can live
and still deliver into the venue in the same transaction: the vault calls
Circle's `CoreDepositWallet.depositFor`, so "add capital to my trading
account" is precisely the action the rules govern, with no bridge and no
withdrawal step in between.

Verified on chain: the Privy embedded wallet released $5.00 from its vault
straight into a HyperCore perps account in one transaction
(`0x94960d1f…`, block 63581864) — USDC approval and transfer, vault →
CoreDepositWallet → the HyperCore system address, a HyperCore credit, and
`TopUpExecuted(amount=$5, instant=true, route=1)`.

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
An active Hyperliquid trader who already knows their loss pattern is the
reload after a losing session, and who has a number in mind for how much of
their capital should never be in the venue. They keep trading exactly as fast
as they like inside that number. The thing they give up is the ability to
refill on tilt.

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
