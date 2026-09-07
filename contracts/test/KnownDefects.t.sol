// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {MockUSDC, MockCoreDepositWallet} from "./Mocks.sol";

/**
 * Defects found in the deployed contract, pinned so they cannot change unnoticed
 * and cannot be discovered by someone else first.
 *
 * These tests assert what ShieldVault.sol DOES, not what it SHOULD do. Every
 * assertion here is a bug. The contract is deployed and immutable, so the fixes
 * belong to a v2; `docs/THREAT_MODEL.md` carries the disclosure and the
 * app-layer mitigations that are possible in the meantime.
 *
 * Neither defect can move money to an unregistered destination, breach the
 * protected floor, or defeat the loss cooldown. Both are bounded.
 */
contract KnownDefectsTest is Test {
    ShieldVault vault;
    MockUSDC usdc;
    MockCoreDepositWallet core;

    address alex = address(0xA1E7);
    address venue = address(0xA710); // trading account, HyperCore route
    address safe = address(0xC01D); // safe wallet, EVM route

    uint64 constant USD = 1_000_000;
    uint64 constant DAILY = 1_600 * USD;
    uint64 constant GENESIS = 1_800_000_000;

    function setUp() public {
        vm.warp(GENESIS);
        usdc = new MockUSDC();
        core = new MockCoreDepositWallet(usdc);
        vault = new ShieldVault(address(usdc), address(core));
        usdc.mint(alex, 100_000 * USD);
        vm.startPrank(alex);
        vault.initializeVault(
            ShieldVault.InitParams({
                riskVerifier: address(0),
                protectedFloor: 1_000 * USD,
                topUpThresholdBps: 10_000,
                emergencyCap: 200 * USD,
                velocityThreshold: DAILY,
                lossTriggerUsdc: 1_000 * USD,
                lossCooldownSecs: 18 hours
            })
        );
        vault.registerOwner(venue, 0, 1, bytes24("Venue"));
        vault.registerOwner(safe, 1, 0, bytes24("Safe"));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(alex, 10_000 * USD);
        vm.stopPrank();
    }

    /**
     * DEFECT 1 — the 24h limit can be spent twice in one window.
     *
     * Proposing a top-up reserves against the velocity bucket current at that
     * moment, and `_refundVelocity` on cancellation subtracts from that same
     * stored index. The window is six four-hour buckets, and after a full lap
     * `_rollBuckets` zeroes every bucket without advancing `currentBucketIndex`
     * — so the index that was current at proposal time is current again. The
     * refund therefore lands on, and erases, unrelated spend made since.
     *
     * Cost to exploit: park a proposal, wait 24 hours, cancel it. That is the
     * opposite of the impulsive behaviour Shield exists to interrupt, which
     * bounds the practical risk — but it does defeat "splitting doesn't help".
     * The overspend is bounded at roughly twice the daily limit per window.
     */
    function test_defect_cancellingAnAgedProposalErasesUnrelatedSpend() public {
        vm.startPrank(alex);
        vault.proposeTopUp(venue, 1_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD, "reserved at proposal time");

        vm.warp(GENESIS + 24 hours + 1); // a full lap of the six buckets
        vault.instantTopUp(venue, 1_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD, "a new window, spent legitimately");

        vault.cancelProposal(1);
        assertEq(vault.velocityNow(alex), 0, "BUG: the refund erased today's spend");

        // Which frees the whole limit a second time inside the same window.
        vault.instantTopUp(venue, 1_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD);
        vm.stopPrank();
        // $3,000 released against a $1,600 limit, in one 24h window.
    }

    /**
     * DEFECT 2 — a user can lock themselves out of their own exit.
     *
     * `tighten` bounds `lossCooldownSecs` at MAX_LOSS_COOLDOWN_SECS and the
     * self-pause at MAX_SELF_PAUSE_SECS, but places no upper bound on
     * `loosenCooldownSecs` or `fullExitCooldownSecs`. Tightening is instant and
     * has no confirmation step, so one call sets an exit delay beyond any human
     * timescale — and the loosen path that would undo it is delayed by the value
     * just set. "You can always leave" stops being true.
     *
     * The app now refuses to submit either value above a sane bound
     * (`app/src/lib/rules.ts`), which is the only mitigation available against an
     * immutable contract. A direct contract call is still able to do this.
     */
    function test_defect_exitDelayHasNoUpperBound() public {
        uint64 forever = type(uint64).max / 2;
        ShieldVault.TightenParams memory p;
        p.hasFullExitCooldownSecs = true;
        p.fullExitCooldownSecs = forever;
        p.hasLoosenCooldownSecs = true;
        p.loosenCooldownSecs = forever;

        vm.prank(alex);
        vault.tighten(p);

        ShieldVault.Vault memory v = vault.getVault(alex);
        assertEq(v.fullExitCooldownSecs, forever, "BUG: accepted an unreachable exit delay");
        assertEq(v.loosenCooldownSecs, forever, "BUG: and the path back is just as far away");
    }

    /**
     * DEFECT 3 — an idle day refunds the whole 24h limit, in a single block.
     *
     * `_rollBuckets` clamps `elapsed` to NUM_VELOCITY_BUCKETS before using it to
     * advance `bucketStart`, and never advances `currentBucketIndex` in that
     * branch. So after an idle gap of N days, `bucketStart` catches up only 24
     * hours per call, every call re-enters the long-idle branch, and every call
     * zeroes all six buckets again — with no time passing in between.
     *
     * This one costs nothing to reach and needs no setup: it is the user coming
     * back after a quiet week, which is exactly who the product is for. It also
     * makes the disclosed bound on defect 1 ("about twice the daily limit")
     * wrong, because the two compose.
     */
    function test_defect_anIdleGapRefundsTheDailyLimitOncePerDay() public {
        // A vault with room to move, so the protected floor does not mask the
        // limit defect. The floor is the real backstop here and it holds — this
        // defect defeats the 24h limit, not the floor.
        address bob = address(0xB0B);
        usdc.mint(bob, 100_000 * USD);
        vm.startPrank(bob);
        vault.initializeVault(
            ShieldVault.InitParams({
                riskVerifier: address(0),
                protectedFloor: 1_000 * USD,
                topUpThresholdBps: 10_000,
                emergencyCap: 200 * USD,
                velocityThreshold: 1_000 * USD,
                lossTriggerUsdc: 1_000 * USD,
                lossCooldownSecs: 18 hours
            })
        );
        vault.registerOwner(venue, 0, 1, bytes24("Venue"));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(bob, 20_000 * USD);

        vault.instantTopUp(venue, 1_000 * USD); // the day's limit, spent
        assertEq(vault.velocityNow(bob), 1_000 * USD, "spent");

        // Come back after a quiet week. Time does not advance again from here.
        vm.warp(GENESIS + 7 days);
        uint64 released = 0;
        for (uint256 i = 0; i < 6; i++) {
            vault.instantTopUp(venue, 1_000 * USD);
            released += 1_000 * USD;
        }
        vm.stopPrank();

        emit log_named_uint("stated 24h limit, USD", 1_000);
        emit log_named_uint("released in ONE block after the gap, USD", released / USD);
        emit log_named_uint("velocityNow reports, USD", vault.velocityNow(bob) / USD);
        assertGt(released, 2_000 * USD, "BUG: far more than the daily limit, with no waiting");
    }
}
