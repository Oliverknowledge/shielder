# Submission

## Name

**Shield.** ("Shielder" reads as a person, and the product is the thing
between you and the reload, not the person holding it.)

## Tagline

Wallets protect your keys. Shield protects you from your own decisions.

## Problem

Young active traders don't lose their money to hacks. They lose it in the
five angry minutes after a loss, refilling the trading wallet to win it
back. Every wallet will sign that refill. Nothing asks whether calm-you
would.

## Product

Shield is the financial control layer underneath your trading app. Calm-you
decides how much is trading money and how much is not. That decision lives
in a vault only you control; the vault funds your Hyperliquid account
directly, under rules you set while calm: a protected floor, a daily limit
that can't be gamed by splitting, a pause on large moves, and a loss rule
that reads what actually came back from the venue and pauses funding after
a real loss. Inside the plan, Shield disappears: trade as fast as you like
with an approved agent key. Making a rule stricter is instant. Making it
weaker waits 24 hours and needs your yes again tomorrow. Leaving entirely
waits 7 days. Small emergency withdrawals to your cold wallet are always
instant. When a reload is blocked the money doesn't move, and the screen
says "Not tonight", shows exactly why, shows what you left yourself, and
offers the safe things you can still do: get me safe, protect me more, or
ninety calm seconds.

Onboarding reads your real Hyperliquid history and surfaces one insight
("3 of your 4 largest losing sessions involved another reload") before
proposing your rules. Sign-in is email or a passkey through Privy; the
embedded wallet is the only authority over the vault.

## How it works

1. You sign in with Privy and get an embedded EVM wallet; it creates your
   vault in `ShieldVault.sol` on HyperEVM (no owner, no admin, no upgrade),
   registers your Hyperliquid account and a cold wallet, sets your rules,
   deposits USDC.
2. Top-ups go through the contract: floor, 24h limit, large-move pause,
   cooldown. An allowed top-up is delivered by the contract into your
   Hyperliquid perps account in the same block (Circle's
   `CoreDepositWallet.depositFor`). Rejections are the contract's, not the
   app's, and they are on-chain.
3. A Substreams pipeline on The Graph (the same five modules on Solana devnet
   and HyperEVM, composed on the foundational `ethereum-common` index)
   indexes every flow across the vault boundary, including the USDC that
   comes back from the venue. Shield derives sessions and realised loss.
4. When your loss trigger is met, a monitor (a Chainlink CRE confidential
   workflow, or Shield's server running the same code) signs an EIP-712
   verdict. The vault checks the signature against the key you pinned and
   the attested loss against your trigger, then arms a pause of your chosen
   length. The monitor never chooses the duration and can only ever extend
   a pause.
5. The v0 Solana implementation of the same rule engine is kept in the repo
   as the zero-credential local reference.

## Why blockchain

The promise is "a signature from me is not enough for this transfer, for a
period I chose earlier." A backend can't make that promise: whoever runs it
can be pressured, hacked, or asked nicely by the user. A wallet can't: it
signs what the key says. Hyperliquid can't: its agent wallets can trade but
the master key can always move funds. A contract with no owner and immutable
rules can, and anyone can verify it did. The delays are enforced by the
chain's clock, the rejection is a transaction anyone can read, and recovery
works with nothing but an RPC URL if the company disappears.

## What's new

- **Past-you constraining future-you, with a floor of physics:** every
  weakening waits, every tightening is instant, and a later tightening
  invalidates any pending weakening (config-version invalidation), so tilt
  can't pre-load an escape.
- **Tighten fast, loosen slowly** as a program-level monotonicity rule on
  every parameter, not a UI convention.
- **Behavioural history as enforcement state:** the realised loss the
  chain can prove becomes the input to an on-chain rule the user wrote,
  through a signed, nonce-bound, replay-safe verdict that can only tighten.
- **AI/monitor that cannot become the authority:** it supplies a number and
  evidence; the vault applies the user's rule and duration.

## Technical architecture

- **Program:** Anchor (Rust) on Solana; PDA-owned USDC account; registry of
  permanent-type destinations; six 4-hour velocity buckets; proposal PDAs
  (one slot per category) with maturity, expiry, config-version snapshot;
  Ed25519 precompile introspection for verdicts; Anchor events for every
  transition. 46 LiteSVM tests with a warpable clock.
- **The Graph:** Substreams package (`substreams-solana 0.15`) with typed
  instruction and event decoding, SPL inflow detection, flow classification,
  running totals; streamed from The Graph Market's Solana devnet endpoint
  by the server via `@substreams/core`.
- **Chainlink CRE:** `handlerInTee` workflow that re-derives the behaviour
  from raw flows inside the enclave, signs with a `getSecret` seed, and
  delivers the verdict to the relayer. Compiles with `cre-compile`.
- **Server (Bun):** indexer (Substreams or RPC fallback), behaviour engine,
  policy, relayer, JSON API, demo helpers.
- **App (React/Vite):** wallet-standard connect, onboarding wizard,
  Overview, Top-up (instant / scheduled / blocked states with the capital
  animation), Behaviour, Protection (tighten/loosen editors, pause,
  destinations, monitor, exit), Activity; mobile tab bar.
- **Recovery CLI:** RPC-only.

## Sponsor integrations

- **The Graph:** Best AI Use Case (From Scratch); also Composable products.
  Substreams package + Market endpoint + behavioural derivation. See
  `docs/SPONSOR_INTEGRATIONS.md`.
- **Chainlink:** Best Confidential Workflow. `handlerInTee` monitor signing
  the vault's only external input. See `docs/SPONSOR_INTEGRATIONS.md`.

## Demo video description

Two minutes: $10,000 protected; a $1,500 top-up moves instantly; the
trading wallet returns $80; the Graph pipeline sees the −$1,420 session and
the monitor's verdict lands on-chain; a $500 top-up is rejected by the
program with a live countdown; the Behaviour screen shows the evidence; a
daily-limit raise is scheduled for 24 hours; the exit is scheduled for 7
days; a $150 emergency transfer to the cold wallet goes through instantly;
the Activity feed shows every transaction.

## GitHub description

Shield: a self-custodial commitment vault on Solana. Trade freely from a
bankroll; refill it only by rules you set while calm. Tighten instantly,
loosen after 24h, and let your real on-chain losses (indexed by The Graph,
judged in a Chainlink CRE enclave) pause the reload.

## ETHGlobal short description

Shield keeps most of your capital in a treasury future-you can't rage-click
open. A Solana program enforces a protected floor, a split-proof daily
limit, and a loss rule fed by your real trading history via The Graph
Substreams and a Chainlink CRE confidential monitor. Safer changes are
instant; weaker ones wait 24 hours.

## ETHGlobal long description

Young active traders rarely lose to exploits; they lose to the reload after
a loss. Shield is a self-custodial vault that separates a protected
treasury from a trading bankroll and governs only the refill.

The vault is an Anchor program. Funds sit in a program-owned account that
can only be sent to destinations the user registered, each with a permanent
type: trading or cold. Top-ups pass four gates: a protected floor, a rolling
24-hour limit enforced by an on-chain accumulator (four $500 top-ups are one
$2,000), a 30-minute pause on large moves, and a cooldown. Every parameter
is classified: moving it stricter is instant; moving it weaker creates a
proposal that waits 24 hours, can be cancelled, and is invalidated by any
later tightening. Leaving entirely waits 7 days. Emergency transfers to the
user's own cold wallet up to a cap are always instant. Every execute path
re-verifies destinations and cooldowns. Forty-six tests run the real
program against a warpable clock, including structuring, stale proposals,
replayed verdicts, forged monitors, substitution and direct-call bypasses.

The loss rule is where the sponsors are load-bearing. A Substreams package
built with The Graph's official SKILLs decodes every Shield instruction and
event and every SPL transfer into a vault account, classifies flows across
the vault boundary, and keeps per-vault totals; the server streams it from
The Graph Market's Solana devnet endpoint and derives sessions, realised
loss, loss streaks and reload-after-loss. A Chainlink CRE confidential
workflow re-derives the same numbers inside a TEE and signs a verdict with a
key that only exists in the enclave. The vault checks the signature against
the key the user pinned, the nonce, the expiry, and that the attested loss
meets the user's own trigger, then arms a pause of the user's own length.
The monitor never chooses the duration and can never do anything but pause
top-ups.

The app is built like a consumer fintech product: a plain-English rule
review, a top-up screen whose blocked state shows the on-chain rejection
and a live countdown, a behaviour screen that says "sent $1,500, $80 came
back" with the transactions behind it, and a protection screen where
tightening applies now and loosening shows "Change scheduled 23:59:54". A
recovery CLI works against any RPC URL with nothing Shield operates.

## Future / company

Shield becomes the policy layer between people and venues: commitment
devices, limits, cooling-off and verified exits across chains and off-chain
venues, with the user's own history as the input. Next: mainnet execution
wallets with per-swap P&L via Token API, the native CRE Solana forwarder
path (DON-signed verdicts), Ledger Key Ring for the verifier seed, and
venue integrations ("fund from Shield").

## Traction / validation

None claimed. Built in the hackathon window; no users, no revenue, no
letters of intent.
