# Judge Q&A

Answers describe what the code does, not what we'd like it to do.

**Isn't this just a spending limit?**
A spending limit is a number your future self can raise. Shield's limit
can only be raised after a 24-hour wait that you can cancel, only lowered
instantly, and it is one of four gates: a floor, a rolling 24h cap that
sees through splitting, a 30-minute pause on large moves, and a loss rule
fed by your real trading history. The last one is the new part: your own
losses become enforcement state.

**Why can't I build this in a normal wallet?**
A wallet asks "did you authorise this?" and signs whatever you ask. The
promise here is that a signature from you is *not enough* for some
transfers, for a period you chose earlier. That has to live somewhere your
key cannot override: a program-owned account with rules, on a chain that
doesn't take instructions from the wallet vendor either.

**Can't the user bypass their own protection?**
Inside the vault, no: we tried. Direct program calls hit the same checks;
raw SPL transfers fail because the PDA owns the account; splitting hits the
24h accumulator; cold wallets are capped and share the accumulator; new
destinations wait 24h; stale proposals die when you tighten; exit waits 7
days; execution paths re-check cooldowns. 46 tests run those attacks
against the real program. Outside the vault, of course: money that never
entered Shield is not protected, and we say so in the app.

**Why would someone voluntarily lock themselves?**
Because they already do, badly: people give their seed phrase to a friend,
use time-locked savings accounts, or just lose. The wedge user is a young
active trader who knows their loss pattern is the reload after a loss. They
keep trading freely; they only give up the ability to *refill on tilt*.

**What if they genuinely need the money?**
Up to the emergency cap moves to their own cold wallet instantly, any time,
even during a cooldown. Larger amounts take the exit delay. The delays are
theirs to set (floors: 1 hour for weakening, 1 hour for exit). Cancelling
is always instant. Nothing is ever custodial.

**How do you know they lost money?**
We don't guess P&L. We measure what the chain shows: USDC sent from the
vault to the trading wallet, and USDC that came back. A session that
returns less than it received is a realised loss of the difference. Money
still in the venue is shown as exposure, not loss. Narrow, auditable, true.

**What if your data source is wrong?**
Then the only thing that can happen is a top-up pause of the user's chosen
length, and only if the attested loss meets the user's trigger. A wrong
source can't move money, loosen anything, or block exits. The evidence
bundle behind each verdict (transaction signatures) is hashed on-chain, so a
wrong verdict is provably wrong.

**Why The Graph?**
The loss rule needs the trading wallet's inflows to the vault at the SPL
level, classified against the vault's own registry, continuously. That is
an indexing problem, and Substreams gives us typed decoding of both our
program and the token program with a resumable cursor from The Graph Market.
The alternative, polling RPC, is our labelled fallback, not the product.

**Why Chainlink?**
A commitment device is worthless if the operator can cave. The verdict is
signed by a key that only exists inside a CRE confidential workflow, over an
evaluation the enclave re-derives itself. Shield's server cannot forge or
soften one user's verdict. We're honest that the current verdict is one
enclave signature, not DON consensus; the native forwarder path is the
upgrade.

**Why this chain?**
The user is on Solana (Axiom, Telegram bots). Both sponsors support Solana
devnet today. Moving chains to fit a sponsor would have meant building for
nobody.

**What happens if Shield disappears?**
`client/recovery-cli.ts` plus any RPC URL: status, cancel, cold transfer,
propose exit, execute matured proposals. The program is immutable after
finalisation, so the rules keep working exactly as written forever.

**Who holds the funds?**
A program-derived account that only the program can sign for, and the
program only moves funds to addresses the user registered, under the
user's rules. The user's key is the only authority; there is no admin key.

**Can the company steal funds?**
No. There is no instruction that sends to an unregistered address, no
authority change, no delegate. After `deploy.sh finalize` there is no
upgrade authority either. Until that runs on the judged deployment, the
honest answer is "the upgrade authority could", which is why it's a listed
blocker.

**Does AI control the user's money?**
No. AI/monitor output is a signed number. The vault checks that number
against the user's rule and applies the user's duration. It can only
tighten one thing (top-ups), never loosen, never move, never block exits.

**What prevents AI from maliciously locking users?**
The pause length is the user's; the trigger is the user's; the monitor can
be removed via the 24h path; cold transfers and exits are untouched; a
verdict cannot invalidate the user's own pending proposals; every verdict is
nonce-bound so it can't be replayed.

**Isn't this gambling-enabling software?**
It is harm-reduction for people who are already trading. It never
encourages a trade; it removes the reload. The behaviour screen is the
first honest scoreboard many users will have seen.

**What's the business model?**
Consumer: a small monthly fee or a basis-point fee on protected balances
above a free tier. B2B: venues and bots integrate a "fund from Shield"
button and reduce chargebacks/regulatory exposure. Later: the behavioural
data product for the user themselves (never sold).

**Who is the first user?**
An 18–25 active Solana trader with $5–20k who funds Axiom or a Telegram
bot several times a week and knows the reload is the problem.

**What becomes a venture-scale company here?**
A self-custodial "policy layer" between people and venues: commitment
devices, limits, cooling-off, verified exits, across chains and off-chain
venues, with the user's own history as the enforcement input. Wallets
protect keys; nobody protects intent.
