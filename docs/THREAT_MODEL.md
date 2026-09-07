# Threat model

The unusual part: the owner of the funds is also, for minutes at a time, the
adversary. Alex sets rules while calm; five minutes after a loss, Alex is the
attacker trying to get around them. Everything else — scammers, a compromised
Shield server, a malicious monitor — is secondary and easier.

The spec below is `contracts/src/ShieldVault.sol`, deployed and immutable on
HyperEVM testnet (chain 998) at `0xcdB6d631A00857584e70a21d800f51C5776302Fe`.
Each invariant is stated as a property, then where the contract enforces it
(`ShieldVault.sol:line`), then the test that pins it
(`contracts/test/ShieldVault.t.sol`). `cd contracts && forge test` runs 44
tests: those 41 invariants plus 3 in `contracts/test/KnownDefects.t.sol`, which
assert what the contract *does* and are therefore all bugs — each one is
written up under "Known gaps" below.

Every line here was re-derived from the Solidity for this revision. Where a
property the earlier version of this document claimed turns out **not** to
hold, it is written up in "Known gaps" rather than removed — that section is
the most important part of the file.

The Solana program that came first is a superseded appendix at the end.

## Invariants — ShieldVault.sol

### 1. There is no privileged party

No owner, no admin, no pauser, no proxy, no upgrade path, no `selfdestruct`.
The constructor writes two immutables and an EIP-712 domain separator and
nothing else (`ShieldVault.sol:240-252`). Every state-changing function
derives its subject from `msg.sender` through `_own()`
(`ShieldVault.sol:630-633`), which reverts `Unauthorized` if the caller has no
vault. Two exceptions, both deliberate: anyone may `deposit` into anyone's
vault (`ShieldVault.sol:328-335`), and anyone may relay a verdict signature
the vault then checks itself (`ShieldVault.sol:536-558`). Neither can take
money out.

Tests: `test_strangerCannotDoAnything`, `test_rawTransferPathIsUnreachable`,
`test_anyoneMayDepositNobodyMayWithdraw`.

One contract holds many vaults keyed by authority address
(`ShieldVault.sol:211`), so "the deployer" is not a role — the deployer's own
vault is just another entry in the same mapping.

### 2. Money leaves through exactly five paths, each to a destination of the right kind

`instantTopUp` (`468-484`), `executeTopUp` (`515-531`), `instantColdTransfer`
(`585-599`), and `executeFullExit` (`610-625`) serving both the matured
above-cap cold transfer and the full uninstall. There is no function that
takes a free-form recipient: `_deliver` (`635-642`) and the two direct
`usdc.transfer` calls (`597`, `623`) can only pay `destinationOwner`, which is
read from the registry entry the call already validated. Top-up paths require
`e.active && e.kind == KIND_EXECUTION` (`472`, `522`); cold and exit paths
require `e.active && e.kind == KIND_COLD` (`589`, `616`, `666`).

Tests: `test_unregisteredDestinationRefused`,
`test_coldWalletIsNotAnExecutionDestination`,
`test_exitToExecutionWalletRefused`, `test_rawTransferPathIsUnreachable`.

### 3. Destination types are permanent, and adding one to a funded vault waits

`registerOwner` is instant only while the vault is empty; once funded it
reverts `VaultFundedUseDelayedPath` (`340`). After that the only way in is
`proposeLoosen` with a `registerOwner` field (`409`) applied by
`executeRuleChange` (`436-438`) after the weakening delay. A registered owner
keeps its kind forever: re-registering with a different kind reverts
`AlreadyRegisteredDifferentType` (`648`).

Tests: `test_registerWhileFundedIsRefused`, `test_typeIsPermanent`,
`test_addingDestinationWaitsAndThenWorks`.

Registries are namespaced per authority (`registry` is
`mapping(address => mapping(address => RegistryEntry))`, `212`), so a second
vault cannot borrow the first vault's destinations. This one is structural
rather than test-pinned; see Known gaps 3.

### 4. Tightening is instant; loosening waits and must be positively reconfirmed

`tighten` (`357-391`) rejects every field that does not move in the stricter
direction with `NotATightening` (`361-373`) and writes immediately.
`proposeLoosen` (`396-427`) rejects every field that does not move in the
weaker direction with `NotALoosening` (`399-407`) and writes **nothing** to
the vault — it only records a proposal maturing at
`now + loosenCooldownSecs` (`416`). `executeRuleChange` (`430-452`) is the
only code path that assigns a loosened value (`439-448`). Nothing applies
when the timer ends; the user has to come back and say yes again, inside a
7-day grace window (`423`, `PROPOSAL_EXECUTION_GRACE_SECS`).

Delay floors are enforced on the way down: `loosenCooldownSecs` ≥ 1 hour
(`406`), `fullExitCooldownSecs` ≥ 1 hour (`407`), `lossCooldownSecs` ≤ 30 days
(`310`, `368`).

The monitor follows the same asymmetry: `tighten` can only *add* a risk
verifier where none exists (`383-387`); replacing or removing one is a
loosening (`408`, `448`).

Tests: `test_cannotLoosenInstantlyOrTightenWeaker`,
`test_loosenWaitsAndRequiresReconfirmation`, `test_loosenExpires`,
`test_delaysCannotGoBelowFloors`, `test_removingMonitorWaits`,
`test_oneProposalPerCategory`.

### 5. Any tightening kills every pending proposal

`tighten` and `removeRegistration` bump `configVersion` (`389`, `350`).
Proposals record the version they were created under (`424`, `679`) and
`_checkMaturityAndStaleness` (`685-690`) reverts `ProposalStale` if it has
moved. So "propose the raise calmly, tighten later, execute the stale raise"
does not work, and an exit proposal cannot outlive the removal of its own
destination.

Tests: `test_tightenIsInstantAndSupersedesPendingLoosen`,
`test_removeRegistrationBumpsConfigVersion`,
`test_exitDestinationCannotBeSwapped`.

### 6. One rolling 24h budget covers instant top-ups, gated top-ups and capped cold transfers

Six 4-hour buckets (`35-36`) rolled forward on use (`_rollBuckets`,
`697-717`), summed and checked before every instant release (`_checkVelocity`,
`723-725`) and reserved atomically with it (`_reserveVelocity`, `727-729`).
`proposeTopUp` reserves at proposal time (`497`) so a pending gated top-up
cannot be double-counted against a fresh instant one. `instantColdTransfer`
draws on the same budget (`594-595`).

Tests: `test_splittingDoesNotBeatTheDailyLimit`, `test_velocityRollsAfter24h`,
`test_coldTransferSharesVelocity`, `test_gatedTopUpMaturesAfter30Minutes`.

**This invariant has two holes, and they compose.** Known gap 1: cancelling a
proposal older than the window refunds velocity that has already expired, which
can zero genuine recent spend. Known gap 3: after any idle gap longer than the
window, `_rollBuckets` zeroes the whole accumulator on *every* call, so the
daily limit can be spent over and over in a single block. Read both before
relying on this invariant.

### 7. The protected floor is checked on every release except a full exit

`_checkFloor` (`692-695`) reverts unless `balance - amount >= protectedFloor`,
and is called from `instantTopUp` (`475`), `proposeTopUp` (`494`),
`executeTopUp` (`526`) and `instantColdTransfer` (`592`). `executeFullExit`
deliberately omits it and checks only the live balance (`617-619`) — leaving
entirely is allowed to go below the floor, because the floor exists to stop
reloading, not to trap.

The consequence to state plainly: **the emergency cold path is bounded by the
floor as well as by the cap.** A vault sitting at its floor cannot make an
instant cold transfer at all. The unconditional way out is the exit path, at
the delay the user chose.

Tests: `test_floorIsInviolable`,
`test_fullExitTakesSevenDaysAndGoesUnderTheFloor`, and
`test_coldTransferAboveCapRefusedInstantly` for the cap. The floor's effect on
the cold path specifically is not pinned by a test; it was verified by
executing a cold transfer against a vault sitting at its floor, which reverts
`ProtectedFloorBreached`.

### 8. `cooldownUntil` only ever moves forward, and blocks top-ups only

Exactly two writers. Self-pause in `tighten` (`374-382`) requires the new time
to be in the future *and* later than the current cooldown, and caps it at
`now + MAX_SELF_PAUSE_SECS` (30 days, `44`). Verdicts (`550-556`) write only
when `now + lossCooldownSecs` exceeds the current value. No function anywhere
decreases it: `executeRuleChange` does not touch it (`439-448`), nor does
`cancelProposal`, nor `removeRegistration`. Loosening `lossCooldownSecs` after
a cooldown is armed changes future verdicts, not the armed one.

It is read in exactly two places, both top-up paths (`474`, `520`). A gated
top-up proposed before a cooldown arrives cannot slip through: `executeTopUp`
re-reads it (`520`), and `proposeTopUp` already sets `executeAfter` to the
later of the static delay and the cooldown (`500`).

Because both writers are bounded to `now + 30 days` at the moment they write,
`cooldownUntil <= now + 30 days` holds at all times.

Tests: `test_selfPauseBlocksTopUpsAndIsMonotonic`, `test_pauseTooLong`,
`test_verdictArmsTheCooldown`,
`test_verdictCannotShortenCooldownAndDoesNotBumpConfig`,
`test_checkOrderIsCooldownFloorVelocityThreshold`.

### 9. A risk verdict can extend a cooldown and do nothing else

This is the invariant the whole Chainlink integration rests on, so it is
stated field by field.

The `RiskVerdict` struct (`198-206`) carries a vault, a nonce, `issuedAt`,
`expiry`, an informational reason code, an attested realised loss and an
evidence hash. **It carries no duration, no floor, no limit, no destination
and no amount.** There is no field a verdict could use to loosen anything,
and `applyRiskVerdict` (`536-558`) writes only five slots:
`lastVerdictNonce`, `lastVerdictReason`, `lastVerdictEvidence`, and — only if
it moves forward — `cooldownUntil` and `cooldownReason`/`cooldownSetAt`.

Every gate on the way in:

- the vault must exist and must have pinned a verifier (`538-539`);
- the verdict must not have expired, and must not be dated more than
  `VERDICT_CLOCK_SKEW_SECS` (5 minutes, `45`) in the future (`541-542`);
- the nonce must strictly exceed the last one applied (`543`) — replays and
  out-of-order verdicts are rejected;
- the attested loss must be at or above **the user's own** `lossTriggerUsdc`
  (`544`);
- the signature must recover to the pinned verifier (`545`), through
  `_recoverVerdictSigner` (`565-580`), which requires exactly 65 bytes,
  rejects `v ∉ {27,28}`, rejects high-`s` malleable signatures and rejects a
  zero recovery;
- the EIP-712 domain (`243-251`) pins name, version, chain id and contract
  address, and the struct pins the vault, so a verdict cannot be moved to
  another vault, another contract or another chain.

The duration is never in the verdict. It is `v.lossCooldownSecs` (`550`), a
value only the user can set — upward instantly (`366-370`), downward only
through the delayed path (`404`). It is bounded by `MAX_LOSS_COOLDOWN_SECS`
(30 days, `43`) at both entry points (`310`, `368`).

`applyRiskVerdict` never touches `configVersion`, so a verdict cannot
invalidate the user's own pending proposals.

**The worst case a single verdict can impose is: top-ups blocked until
`now + lossCooldownSecs`, capped at 30 days.** Nothing else moves.

Tests: `test_verdictArmsTheCooldown`, `test_verdictBelowTriggerRejected`,
`test_verdictReplayRejected`, `test_verdictWrongSignerRejected`,
`test_verdictTamperedRejected`, `test_verdictExpiredAndFutureRejected`,
`test_noMonitorMeansNoVerdicts`,
`test_verdictCannotShortenCooldownAndDoesNotBumpConfig`.

Two honest consequences of the design:

- **Relay is permissionless.** `applyRiskVerdict` does not check
  `msg.sender`; the signature is the authorisation. That is a liveness
  feature — no relayer of Shield's has to be alive for a verdict to land —
  and it is also the reason the signature checks above have to be exact.
- **A rogue verifier can chain verdicts.** Each fresh nonce re-arms
  `cooldownUntil` at `now + lossCooldownSecs`, so a compromised verifier key
  can hold top-ups closed indefinitely, in 30-day-maximum increments. It
  still cannot move money, loosen a rule, block a cold transfer or block an
  exit, and the user can remove it through the loosening path (≥ 1 hour, 24
  hours by default), which is not cooldown-gated. Verified: chained verdicts
  hold the cooldown; `instantColdTransfer` and `executeRuleChange` both
  succeed underneath one.

### 10. Cold transfers and full exits are never gated by a cooldown

`instantColdTransfer` (`585-599`), `_proposeFullExit` (`663-683`) and
`executeFullExit` (`610-625`) contain no read of `cooldownUntil`. Neither
does `cancelProposal` (`455-463`) or `executeRuleChange` (`430-452`). So no
cooldown — self-imposed or verdict-imposed — can trap a user in risk or stop
them dismantling the thing that imposed it.

Tests: `test_coldTransferWithinCapIsInstantEvenDuringCooldown`.
Verified additionally against a live 30-day self-pause plus an armed verdict
cooldown: the full exit still executes at maturity, below the floor.

### 11. Leaving is always available at the delay the user set

`proposeUninstallVault` (`606-608`) and `proposeColdTransferAboveCap`
(`601-604`) both require a registered cold destination (`666`) and mature at
`now + fullExitCooldownSecs` (`671`, default 7 days, floor 1 hour).
`executeFullExit` moves the balance out with no cap, no velocity check and no
floor check.

Test: `test_fullExitTakesSevenDaysAndGoesUnderTheFloor`.

Three precise caveats, all verified:

- The destination is locked at proposal time; removing it makes the proposal
  stale (`test_exitDestinationCannotBeSwapped`).
- For `ACTION_UNINSTALL` the **amount is the live balance at execution**
  (`617`), not the balance at proposal time — deposits made while the exit is
  pending leave with it. Only `ACTION_COLD_ABOVE_CAP` locks an amount.
- The delay itself is not upper-bounded. See Known gaps 2.

### 12. Effects before interactions, with a reentrancy lock

`nonReentrant` (`254-259`) guards `deposit`, `instantTopUp`, `executeTopUp`,
`instantColdTransfer` and `executeFullExit`. Balances are decremented and
proposals deleted before any external call (`481-482`, `527-529`, `596-597`,
`621-623`). The USDC and CoreDepositWallet addresses are immutable (`208-209`),
so no external callee can be swapped after deployment.

Not pinned by a dedicated test; see Known gaps 3.

## Known gaps — properties the contract does not have

### 1. Cancelling an aged proposal can reset the 24h budget

`_refundVelocity` (`731-735`) subtracts the cancelled amount from
`pr.reservedBucketIndex`, the bucket that was current when the proposal was
created. If the buckets have rolled since, that index now holds *unrelated,
recent* spend, and the refund deletes it.

Reproduced on the deployed logic with a $1,600 daily limit:

1. `proposeTopUp($1,500)` — reserves $1,500 in bucket 0. Nothing moves.
2. Wait 24 hours. The reservation ages out of the window; `velocityNow` is 0.
3. `instantTopUp($1,500)` — a full day's budget, lands in bucket 0.
4. `cancelProposal(TOP_UP)` — refunds $1,500 against bucket 0. `velocityNow`
   is now 0 again.
5. `instantTopUp($1,500)` — succeeds.

$3,000 released inside one 24-hour window against a $1,600 limit, in the same
block as step 3. Pinned by
`KnownDefects.t.sol:test_defect_cancellingAnAgedProposalErasesUnrelatedSpend`.

**The bound this document previously gave — "about twice the daily limit per
window, with a day of setup" — is wrong, and is corrected here.** It was
derived from this defect in isolation: one proposal slot, one refund, capped at
the amount reserved. That reasoning holds for this mechanism on its own, but
Known gap 3 refunds the entire accumulator with no proposal and no waiting, and
the two compose. The only limit on how much can leave in a 24-hour window is
the protected floor. The registry, the cooldown and the exit delay are
unaffected.

This contradicts the previous version of this document, which claimed the
accumulator was "checked and reserved atomically" with no qualification, and
it contradicts "a rolling 24h cap that sees through splitting" as an
unconditional statement. The contract is immutable, so this is a disclosed
limitation, not a fix: the correct repair (store the reserved amount against
`bucketStart` and drop the refund if the window has rolled) belongs to a v2.

### 2. A user can tighten themselves into a permanent lock

`tighten` bounds `lossCooldownSecs` (30 days, `368`) and `pauseTopUpsUntil`
(30 days, `377`), but places **no upper bound** on `loosenCooldownSecs`
(`372`) or `fullExitCooldownSecs` (`373`). Verified: `tighten` accepts
`type(uint64).max / 2` for both, after which a full exit proposal matures
roughly 292 billion years out and the loosening path that would undo it is
just as far away. The funds are unreachable, permanently, with no third party
able to help — there is no admin to ask.

This contradicts the previous accepted limitation "a determined user who waits
24h / 7d can always weaken or leave". The accurate statement is: *a user who
has not tightened their own delays* can always weaken or leave.

The app never offers these values, and both are reached only by hand-crafting
a `tighten` call. It is still a real property of the deployed contract and a
judge is entitled to hear it.

### 3. An idle gap refunds the whole 24h limit, once per idle day, in one block

The worst of the three. It costs nothing, needs no setup and no waiting, and
the person it is waiting for is a user coming back after a quiet week — which
is exactly the user this product is for.

`_rollBuckets` (`697-717`) computes `elapsed` in whole buckets, and when
`elapsed >= NUM_VELOCITY_BUCKETS` it zeroes all six buckets, clamps `elapsed`
to six, and advances `bucketStart` by `elapsed * BUCKET_LEN_SECS` — 24 hours.
That branch never touches `currentBucketIndex`. So after an idle gap of N days,
`bucketStart` catches up only one day per call: the next call re-enters the
same branch and zeroes the accumulator again, with no time having passed
between them.

Reproduced on the deployed logic
(`KnownDefects.t.sol:test_defect_anIdleGapRefundsTheDailyLimitOncePerDay`), with
a $1,000 per 24h limit, $20,000 in the vault and a $1,000 floor:

1. `instantTopUp($1,000)` — the day's limit, spent. `velocityNow` is $1,000.
2. Nothing happens for seven days.
3. `instantTopUp($1,000)` six times, in the same block. All six succeed.

**$6,000 released in one block against a stated $1,000 per 24 hours**, and
`velocityNow` reports zero throughout, so neither the app nor an observer sees
the budget being consumed. Six is not a ceiling of the mechanism, it is how
many idle days the test skipped; a longer gap refunds proportionally more.

What still holds, and bounds it:

- **The protected floor is the real backstop, and it holds.** Re-running the
  same exploit against a vault holding $10,000 behind an $8,000 floor: the
  first post-gap release goes through, and the next one reverts
  `ProtectedFloorBreached` while `velocityNow` still reports zero — so it is
  demonstrably the floor refusing, not the limit. `_checkFloor` is a separate
  check on `balance - amount` and has nothing to do with the buckets. Total
  drain is bounded at `balance - protectedFloor`.
- The registry is unaffected: the money can still only go to a destination the
  user registered, and a new destination still waits 24 hours.
- The loss cooldown is unaffected: while `cooldownUntil` is in the future,
  every top-up path reverts regardless of the accumulator.
- Cold-transfer amounts above the emergency cap, and the exit path, are
  unaffected.

So the honest statement is: **the 24h limit is not a reliable bound, and the
protected floor is.** A user who is relying on the daily limit to pace a
reload, rather than on the floor, is relying on the wrong number. The floor is
the one the setup flow should be treated as configuring.

The correct repair is to advance `currentBucketIndex` in the long-idle branch
(or, better, to store `bucketStart` as the true window origin and derive the
index) and to set `bucketStart = nowTs` rather than adding a clamped delta.
The contract is immutable, so this belongs to a v2.

**The same clamp is in the Solana v0 program**, at
`programs/shield-vault/src/state.rs` (`buckets_elapsed` is `.min()`-ed to
`NUM_VELOCITY_BUCKETS`, and `current_bucket_index` is only updated in the
`else` branch). v0 is not deployed and is not the product, but the appendix
below should be read with this in mind.

### 4. Invariants without tests

The 44 tests do not cover: reentrancy through a hostile `CoreDepositWallet` or
a hostile token (invariant 12); per-vault registry isolation as a direct
assertion (invariant 3); the stranded-transfer hole in Known gaps 7, which is
an absence of code rather than a behaviour a test can assert against the
deployed contract. All three were checked by reading. All three known defects
above *are* covered, by `contracts/test/KnownDefects.t.sol`; those tests assert
the wrong behaviour on purpose, so that it cannot change unnoticed.

### 5. The HyperCore credit cannot be confirmed on-chain

`_deliver` (`636-638`) approves and calls `CoreDepositWallet.depositFor`.
`depositFor` returns nothing, and Circle's testnet rule is that only addresses
that already exist on Hyperliquid mainnet can be credited. If the credit is
silently dropped, the vault has already decremented its balance and parted
with the USDC. The contract has no way to detect it, and no way to claw it
back. If the callee does not spend the allowance, a residual approval is left
outstanding to `coreDeposit`.

### 6. The EIP-712 domain separator is cached at construction

`_DOMAIN_SEPARATOR` is computed once in the constructor (`243-251`) with the
then-current `block.chainid`. On a chain fork, verdicts would be replayable
across both forks. This is the standard trade-off; it is worth knowing rather
than discovering.

### 7. Token assumptions, and USDC sent back by a raw transfer is stranded

`deposit` credits exactly the amount requested (`332-333`) and the contract
pools every vault's USDC in one balance with internal accounting. That is
correct for USDC and wrong for a fee-on-transfer or rebasing token. The token
address is immutable and was set to Circle's test USDC at deployment, so this
part is a fact about the deployment, not an open risk.

The accounting has a sharper edge. **`v.balance` is credited in exactly one
place, `deposit()`.** No function anywhere in the contract reads
`usdc.balanceOf(address(this))`, there is no sweep, no rescue and no admin, and
the contract is immutable. So USDC that arrives at the vault address by a plain
ERC-20 `transfer` — which is the obvious way to send trading capital back from
a venue — belongs to no vault, is invisible to every rule and every screen, and
**can never be withdrawn by anyone**. It is not stolen; it is stranded.

This is not hypothetical. Measured on chain 998 on 2026-09-07:

```
usdc.balanceOf(0xcdB6d631A00857584e70a21d800f51C5776302Fe)   $696.50
sum of the four vaults' getVault(...).balance                $666.00
                                                             -------
stranded, unrecoverable                                       $30.50
```

($600.00 + $45.00 + $21.00 + $0.00 across the four authorities listed in
`docs/internal/gauntlet/FACTS.md`.) The same thing is visible on the local Anvil
stack, where `bun run demo:evm return 80` hands money back with a raw transfer:
the contract holds $7,080 and the vault accounts for $7,000.

Mitigation is documentation only, because the contract cannot be changed:
`client/evm-demo.ts` refuses the demo `return` command on any real network and
tells the user to send capital back with `deposit(authority, amount)` from the
venue wallet, and the indexer treats a deposit from a registered trading wallet
as a return rather than as new capital. Neither can stop a hand-written
transfer. A v2 should either credit on receipt or make the balance derivable
from the token balance.

### 8. There is no EVM recovery CLI

`client/recovery-cli.ts` is Solana-only. On EVM the equivalent is the public
ABI (`client/abi/ShieldVault.ts`, encoders in `client/evm.ts`) plus any RPC
endpoint — `cast send` reaches every path, and the app is a convenience over
the same calls. The claim "recovery needs nothing Shield operates" is still
true; the specific artefact the old document cited does not cover EVM.

## Attacks, by attacker

### Alex, five minutes after a loss

| Attack | What happens | Invariant · test |
|---|---|---|
| Call the contract directly, skip the app | Same functions, same checks. The app has no privileged path; it builds the same calldata. | 1 · `test_rawTransferPathIsUnreachable` |
| Move USDC out of the contract some other way | There is no function that transfers to an address that is not a validated registry entry. | 2 · `test_unregisteredDestinationRefused` |
| Split $1,600 into four $400 top-ups **within one active window** | The accumulator sums them; the fifth dollar reverts `VelocityThresholdExceeded`. | 6 · `test_splittingDoesNotBeatTheDailyLimit` |
| Route the reload through a cold wallet | Cold transfers are capped by `emergencyCap`, share the same 24h budget, and respect the floor. | 6, 7 · `test_coldTransferAboveCapRefusedInstantly`, `test_coldTransferSharesVelocity` |
| Register a fresh "cold" wallet and drain to it | Registration on a funded vault is a delayed weakening; even after it lands, only the cap moves instantly. | 3 · `test_registerWhileFundedIsRefused`, `test_addingDestinationWaitsAndThenWorks` |
| Re-register the trading wallet as cold | `AlreadyRegisteredDifferentType`. | 3 · `test_typeIsPermanent` |
| Raise the daily limit right now | `tighten` reverts `NotATightening`; `proposeLoosen` waits. | 4 · `test_cannotLoosenInstantlyOrTightenWeaker` |
| Propose the raise calmly, tighten later, execute the stale raise | `ProposalStale`. | 5 · `test_tightenIsInstantAndSupersedesPendingLoosen` |
| Set the weakening delay to zero | `InvalidParameter` (1h floor), and the change itself waits the current delay. | 4 · `test_delaysCannotGoBelowFloors` |
| Schedule a large top-up, wait out the 30 minutes, but a loss cooldown lands first | `executeTopUp` re-reads the cooldown: `CooldownActive`. | 8 · `test_checkOrderIsCooldownFloorVelocityThreshold` |
| Un-pause | There is no function that lowers `cooldownUntil`. Pauses expire by time only. | 8 · `test_selfPauseBlocksTopUpsAndIsMonotonic` |
| Use a second vault to reach the first vault's registry | Registry entries are keyed by authority; the other vault has none. | 3 |
| Park a top-up proposal for a day, then cancel it to clear the accumulator | **This works.** The refund lands on unrelated recent spend and erases it. | Known gaps 1 · `test_defect_cancellingAnAgedProposalErasesUnrelatedSpend` |
| Come back after a quiet week and top up repeatedly in one block | **This works, with no setup at all.** Each call zeroes the whole accumulator again. $6,000 released against a $1,000 daily limit, measured. The protected floor is what stops it. | Known gaps 3 · `test_defect_anIdleGapRefundsTheDailyLimitOncePerDay` |
| Send trading capital back to the vault address with a plain ERC-20 transfer | Not an attack, but it destroys the money: nothing credits it and nothing can withdraw it. Use `deposit()`. | Known gaps 7 |
| Deposit somewhere else and trade there | Out of scope by design: Shield governs what leaves the vault, not money that never entered it. | accepted limitation |

### A scammer ("send it to this recovery address")

Adding a destination to a funded vault is a delayed weakening change that
must be reconfirmed after the delay (`340`, `409`, `436-438`); `tighten`
cannot add destinations at all. Once added, only `emergencyCap` moves
instantly and only above the floor; everything larger takes the exit delay.
The pressure window a scammer needs is the one thing the design removes.

### Shield's server, indexer or relayer (compromised or dead)

- **Dead.** The app reads every enforcement number from the chain
  (`client/evm.ts`); the floor, limit, pause, cooldown and every delay keep
  working; `cast` reaches every path. Only behavioural explanation is lost.
- **Compromised.** It can sign verdicts only if it holds the verifier key.
  With the CRE confidential workflow as signer, the key is a runtime secret
  inside the enclave (`cre/shield-risk/evaluate.ts:89`) and the server does
  not have it. Even holding it, invariant 9 bounds the damage to a top-up
  pause of the user's own length, above the user's own trigger.
- **Lying about flows.** The verdict's `evidenceHash` commits to the
  transaction list the evaluation used, so a fabricated verdict is provably
  fabricated after the fact. The contract does not verify it — reason codes
  and evidence hashes are informational storage (`548-549`).

### A malicious or buggy monitor

The vault does not trust the monitor's judgement, only its signature over a
number that the vault then checks against the user's own rule. Worst case is
invariant 9's: top-ups closed, chained indefinitely by a rogue key, in
increments of at most 30 days. Cold transfers, exits, cancellation and the
loosening path that removes the monitor all keep working underneath it —
verified, not assumed.

### Shield the company

There is nothing to say. `ShieldVault.sol` has no owner, no admin, no proxy
and no upgrade path; the deployed bytecode at
`0xcdB6d631A00857584e70a21d800f51C5776302Fe` is the final bytecode. Shield
cannot move a user's funds, change a user's rules, or turn the contract off.
The one thing Shield can influence is whether a verdict gets signed, and
invariant 9 bounds what a verdict can do.

### Privy

Privy's embedded wallet is the vault's authority — it is the key, and the
contract gates every path on `msg.sender`. Privy enforces **nothing** about
the vault's rules and Shield does not configure it to try: no policies, no
quorums, no session signers. A user can export the key; that changes nothing,
because the rules bind the key rather than the app. Shield does not co-own
keys, so there is no 2-of-2 that could hold a user's funds hostage.

### Clock manipulation

Windows are 30 minutes to 30 days, so block-timestamp drift is irrelevant at
this scale. Verdicts carry `issuedAt`/`expiry` with a 5-minute skew tolerance
(`541-542`) and, on HyperEVM, the proposer has no incentive that a few seconds
of drift would serve.

## Accepted limitations (deliberate)

- Shield protects only what is inside the vault. Once money is in the trading
  account, Shield observes but cannot enforce. Money sent back to the vault
  address by a plain ERC-20 transfer is never credited and cannot be recovered
  — return capital with `deposit()` (Known gaps 7).
- A user who has not tightened their own delays can always weaken or leave, at
  their own delay. That is the product: friction against impulses, not
  custody. (A user who *has* tightened them can lock themselves out — Known
  gaps 2.)
- Losing the authority key has no recovery: single-key self-custody.
- "Realised loss" is closed-cycle USDC accounting between the vault and the
  trading account, not per-trade P&L. Narrow and true rather than universal
  and guessed.
- The verdict is one enclave signature, not a DON quorum. The native CRE EVM
  forwarder is the production upgrade (`cre/README.md`).
- Behavioural indexing runs from RPC on HyperEVM testnet, because The Graph
  indexes HyperEVM mainnet only. `/api/health` reports `source.mode: "rpc"` in
  plain words.

---

## Appendix: v0 (Solana) — superseded

`programs/shield-vault` is the Anchor implementation of the same rule engine,
kept as the zero-credential reference. It is **not** the submitted system and
nothing below is a claim about the deployed product. Its 46 LiteSVM tests run
with `bun test tests/ server/` after `bun run build:program`; without the built
program they skip rather than fail.

The v0 invariants, condensed, with the EVM invariant that replaces each:

| v0 | Statement | Replaced by |
|---|---|---|
| 1 | The vault's USDC account is PDA-owned; the only CPI is `spl_token::transfer` to a registered owner's token account. No delegate, no arbitrary CPI, no authority change. | 1, 2 |
| 2 | Every outbound instruction checks the supplied token account's `owner` against the registry entry PDA. | 2 |
| 3 | Registered owners are `Execution` or `Cold` permanently. | 3 |
| 4 | `tighten` instant and monotonic; `propose_loosen` delayed, ≥ 1h. | 4 |
| 5 | Every tighten bumps `config_version`; older proposals cannot execute. | 5 |
| 6 | One 24h accumulator across top-ups and capped cold transfers. | 6 (with the holes in Known gaps 1 and 3 — v0 carries the same `_rollBuckets` clamp, at `programs/shield-vault/src/state.rs`) |
| 7 | `cooldown_until` blocks every top-up path and only extends. | 8 |
| 8 | `apply_risk_verdict` (Ed25519 precompile introspection) can only set `cooldown_until = max(current, now + loss_cooldown_secs)`. | 9 |
| 9 | Proposals are one-shot; destination and amount locked at creation; the account closes on execute or cancel. | 11 (with the uninstall-amount caveat) |
| 10 | Recovery via `client/recovery-cli.ts` and an RPC URL alone. | Known gaps 7 |
| 11 | "The code cannot be swapped" — conditional on `scripts/deploy.sh finalize`. | **Void.** The step was never run on a judged Solana deployment, so v0 never had this property. `ShieldVault.sol` has it unconditionally: no proxy, no owner, no upgrade path. |

Solana-specific edge cases that have no EVM analogue: only the pinned SPL mint
and the classic Token program are accepted (Token-2022 accounts are rejected);
proposal accounts are per-category PDAs so a second concurrent proposal fails
at `init`; rent refunds on close go to the authority; the `Clock` sysvar is
validator-set.
