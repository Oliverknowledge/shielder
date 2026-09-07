# Threat model

The unusual part: the owner of the funds is also, for minutes at a time, the
adversary. Alex sets rules while calm; five minutes after a loss, Alex is the
attacker trying to get around them. Everything else — scammers, a compromised
Shield server, a malicious monitor — is secondary and easier.

The spec below is `contracts/src/ShieldVault.sol`, deployed and immutable on
HyperEVM testnet (chain 998) at `0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006` (v2, `VERSION() = 2`).
Each invariant is stated as a property, then where the contract enforces it
(`ShieldVault.sol:line`), then the test that pins it
(`contracts/test/ShieldVault.t.sol`). `cd contracts && forge test` runs 44
tests: those 41 invariants plus 6 regressions in `contracts/test/FixedDefects.t.sol` and 2 in `contracts/test/Isolation.t.sol`, which
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
and test-pinned in `Isolation.t.sol` (v2); see Known gaps 4.

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
- The delay is bounded at 30 days (v2). See Known gaps 2.

### 12. Effects before interactions, with a reentrancy lock

`nonReentrant` (`254-259`) guards `deposit`, `instantTopUp`, `executeTopUp`,
`instantColdTransfer` and `executeFullExit`. Balances are decremented and
proposals deleted before any external call (`481-482`, `527-529`, `596-597`,
`621-623`). The USDC and CoreDepositWallet addresses are immutable (`208-209`),
so no external callee can be swapped after deployment.

Pinned by `Isolation.t.sol:test_reentrancyThroughAHostileCoreDepositWalletIsRefused` (v2).

## Known gaps — properties the contract does not have

Gaps 1–3 below were found by our own gauntlet in **v1**
(`0xcdB6d631…`, deployed 2026-09-06) and are **fixed in v2**
(`0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006`, deployed 2026-09-07, `VERSION() = 2`),
which is what the app, the server, the Substreams filters and the CRE
workflow now point at. Each is pinned as a regression test in
`contracts/test/FixedDefects.t.sol`, whose comments keep the original v1
behaviour so the reader can see exactly what changed. v1 is immutable and
still holds its four vaults; nothing uses it any more.

### 1. (v1) Cancelling an aged proposal could reset the 24h budget — fixed

In v1 `_refundVelocity` subtracted the cancelled amount from
`pr.reservedBucketIndex`, the bucket that was current when the proposal was
created. If the six buckets had lapped since, that index held *unrelated,
recent* spend, and the refund deleted it: $3,000 released inside one
24-hour window against a $1,600 limit.

**v2:** `cancelProposal` rolls the buckets first and refunds only if the
reserved bucket still represents the 4-hour window the reservation was made
in (`_reservationStillCurrent`, which compares `pr.createdAt` with that
bucket's current window start). An aged reservation is simply dropped.
Regressions: `test_cancellingAnAgedProposalDoesNotEraseUnrelatedSpend`,
`test_cancellingAFreshProposalStillRefunds`,
`test_cancellingAfterTheReservedBucketRolledOutDoesNotRefund`.

### 2. (v1) A user could tighten themselves into a permanent lock — fixed

v1 `tighten` bounded `lossCooldownSecs` and the self-pause at 30 days but
placed no upper bound on `loosenCooldownSecs`, `fullExitCooldownSecs` or
`topUpCooldownSecs`; it accepted `type(uint64).max / 2`, after which a full
exit matured roughly 292 billion years out.

**v2:** `MAX_TOP_UP_COOLDOWN_SECS`, `MAX_LOOSEN_COOLDOWN_SECS` and
`MAX_FULL_EXIT_COOLDOWN_SECS` are all 30 days; anything above reverts
`InvalidParameter`. "A user can always weaken or leave" is now true without
qualification: the longest wait a user can impose on themselves is 30 days.
Regression: `test_exitDelayIsBounded`. The app's own caps
(`app/src/lib/rules.ts`) are tighter still and unchanged.

### 3. (v1) An idle gap refunded the whole 24h limit, once per idle day, in one block — fixed

The worst of the three. v1 `_rollBuckets` clamped `elapsed` to six before
advancing `bucketStart` and never advanced `currentBucketIndex` in that
branch, so after an idle gap of N days every call re-entered the long-idle
branch and re-zeroed the accumulator with no time passing: **$6,000
released in one block against a stated $1,000 per 24 hours**, with
`velocityNow` reporting zero throughout.

**v2:** `bucketStart` and `currentBucketIndex` always advance by the real
elapsed bucket count, so a gap is consumed exactly once and the ring pointer
is right afterwards. Regressions:
`test_anIdleGapRefundsTheDailyLimitExactlyOnce`,
`test_ringPointerSurvivesAnOddGap`. The same clamp in the Solana v0 program
(`programs/shield-vault/src/state.rs`) is fixed in the same way; the 66
LiteSVM tests still pass against the rebuilt program.

What was always true, and is still the deeper backstop: the **protected
floor** is a separate check on `balance - amount`, the registry limits where
money can go, and a live loss cooldown blocks every top-up path regardless
of the accumulator.

### 4. Invariants without tests

Two invariants that the v1 gauntlet had only checked by reading now have
tests in `contracts/test/Isolation.t.sol`: reentrancy through a hostile
`CoreDepositWallet` (invariant 12 — the re-entry is refused by the lock
before the authority check runs) and per-vault registry isolation
(invariant 3). What remains untested by construction is the
stranded-transfer hole in Known gaps 7, which is an absence of code rather
than a behaviour a test can assert.

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
usdc.balanceOf(0xcdB6d631A00857584e70a21d800f51C5776302Fe)   $696.50   (v1, measured 2026-09-07)
sum of the four vaults' getVault(...).balance                $666.00
                                                             -------
stranded, unrecoverable                                       $30.50
```

($600.00 + $45.00 + $21.00 + $0.00 across the four v1 authorities.) On v2
every return so far has gone through `deposit()`, so nothing is stranded there
yet; the hazard is unchanged, which is why the demo script and the indexer
both insist on `deposit()`. The same thing is visible on the local Anvil
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
| Park a top-up proposal for a day, then cancel it to clear the accumulator | Worked in v1. **Refused in v2:** an aged reservation is dropped, not refunded. | Known gaps 1 · `test_cancellingAnAgedProposalDoesNotEraseUnrelatedSpend` |
| Come back after a quiet week and top up repeatedly in one block | Worked in v1 ($6,000 against $1,000/24h, measured). **Refused in v2:** the second call reverts `VelocityThresholdExceeded`. | Known gaps 3 · `test_anIdleGapRefundsTheDailyLimitExactlyOnce` |
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
`0xba1Bb356e546AD2d036f4cAA8D25fbba4F5C1006` is the final bytecode. Shield
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
| 6 | One 24h accumulator across top-ups and capped cold transfers. | 6 (the `_rollBuckets` clamp of Known gaps 3 was fixed in `programs/shield-vault/src/state.rs` alongside v2) |
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
