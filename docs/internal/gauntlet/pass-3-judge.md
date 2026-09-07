# Pass 3 — hostile judge gauntlet

Six judges: a general ETHGlobal judge with sixty seconds and fifty demos behind
them, a sceptical founder attacking the business logic, a technical sceptic
cold-reading the contract, a reviewer who actually cloned the repo and followed
the README, a demo director stress-testing the shot list, and a fact-checker
ruling on every claim in the repo.

## What they agreed on

The engineering is better than the documentation, and the documentation is the
part being judged. Every judge independently reached some version of the same
sentence: the failure mode here is not dishonesty, it is **stale truth** — a
claim that was correct when written and was invalidated by a later change nobody
re-checked. Four examples they found: "the server does not have the key" (it
does), "the venue decides" (only in the disabled path), "41 tests" (43 by then,
44 now), and a returns indexer never revisited after the contract became
multi-tenant.

The technical sceptic's closing line is the one worth keeping: *"I trust this
repository's substance considerably more than I trust its prose."*

## The three defects, and where they came from

Pass 3 found a **third** defect in the deployed contract, and it is worse than
the two already disclosed. `_rollBuckets` clamps `elapsed` to six buckets before
using it to advance `bucketStart`, and never advances `currentBucketIndex` in
that branch — so after an idle gap every call re-enters the branch, zeroes all
six buckets, and moves the window on only 24 hours. Reproduced: **$6,000
released in a single block against a stated $1,000 per 24 hours**, with
`velocityNow` reporting the limit untouched.

It needs no setup and no patience, which makes it worse than the disclosed
refund bug, and it invalidated that bug's stated bound because the two compose.
The protected floor still holds and bounds the total drain — the first attempt
at the reproduction failed on `ProtectedFloorBreached`, which is worth knowing.

All three are pinned in `contracts/test/KnownDefects.t.sol` as tests that assert
what the contract *does*, so they cannot drift and cannot be discovered by
someone else first.

## Fixed in this pass

- **Returns were credited to every vault that had registered the sender.** One
  $30.50 return was booked three times. Worse: `registerOwner` needs no consent
  from the address being registered, so anyone could name a heavy trader's
  deposit address as their execution destination and have that trader's returns
  cancel their own realised losses, permanently and for free. A return is now
  credited only against capital this vault actually has outstanding to that
  wallet.
- **`/api/verdicts` stored attacker-supplied evidence under an attacker-supplied
  hash**, before validating anything, and nothing ever recomputed it — while the
  UI told the user the chain vouched for it. It does now.
- **Capital returned by a raw transfer was permanently stranded**: `deposit()` is
  the only path that credits a vault, the contract is immutable, there is no
  sweep. The demo told real-network users to do exactly that, and the local demo
  destroyed $80 on every run. Both now use `deposit()`, and the indexer books a
  deposit from a registered trading wallet as a return — so the safe path is also
  the one the loss rule can see.
- **The enclave never read the venue.** The server had started deferring to
  Hyperliquid's settled PnL; the confidential workflow had not, and on a real
  network the enclave is the only signer. The fix existed solely in the disabled
  path. The enclave now reads the venue itself, over its own HTTP capability.
- Toasts rendered `<a href="">View</a>` on a network with no explorer.
- A cold clone failed 45 tests because the Solana v0 suite ran unconditionally.
  It skips with an explanation now: 20 pass, 46 skip, 0 fail.
- `docs/JUDGE_QA.md` claimed the app told users that money which never entered
  Shield is unprotected. It did not; a judge grepped for it. It does now.
- The landing page's "Source" link pointed at a misspelled repository and 404'd,
  and the same typo was baked into a committed `.spkg`.

## The strongest thing the fact-checker found

Nobody had claimed it: the **deployed bytecode matches the source in this repo**.
284 differing bytes, every one inside an immutable slot, and the EIP-712 domain
separator recomputed independently and matched. "No owner, no proxy, no upgrade
path" is true of the deployed code, not merely of the source — and the docs were
not saying so.

## Judged and declined

- **Rebuilding the Home hero, merging Behaviour into Activity, halving the
  landing page's scroll.** All well argued. All structural, six days out, on a
  product that works.
- **`query: params: true` on the Substreams block filter** to make the package
  third-party reusable. Direct evidence against it: the Graph Market endpoint
  rejected that form earlier in the project with "unsupported query type". Left
  alone and recorded here rather than churned.
