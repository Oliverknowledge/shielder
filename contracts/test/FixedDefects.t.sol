// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {MockUSDC, MockCoreDepositWallet} from "./Mocks.sol";

/**
 * Three defects our own gauntlet found in v1 of ShieldVault.sol (HyperEVM
 * testnet, 0xcdB6d631…), fixed in v2 and pinned here as regressions.
 *
 * The v1 file asserted the WRONG behaviour on purpose so the defects could not
 * change unnoticed; each test below now asserts the right behaviour, and the
 * comment above each one keeps the original failure so the reader can see
 * exactly what v1 did. `docs/THREAT_MODEL.md` carries the disclosure history.
 *
 * None of the three could move money to an unregistered destination, breach
 * the protected floor, or defeat the loss cooldown. All three were bounded.
 */
contract FixedDefectsTest is Test {
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
     * DEFECT 1 (v1) — the 24h limit could be spent twice in one window.
     *
     * Proposing a top-up reserves against the velocity bucket current at that
     * moment, and cancellation refunded that same stored index. After a full
     * lap of the six buckets the index was current again, so the refund landed
     * on, and erased, unrelated spend made since: $3,000 released against a
     * $1,600 limit in one window.
     *
     * v2: `cancelProposal` rolls the buckets first and refunds only if the
     * reserved bucket still represents the 4h window the reservation was made
     * in (`_reservationStillCurrent`). An aged reservation is simply dropped.
     */
    function test_cancellingAnAgedProposalDoesNotEraseUnrelatedSpend() public {
        vm.startPrank(alex);
        vault.proposeTopUp(venue, 1_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD, "reserved at proposal time");

        vm.warp(GENESIS + 24 hours + 1); // a full lap of the six buckets
        vault.instantTopUp(venue, 1_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD, "a new window, spent legitimately");

        vault.cancelProposal(1);
        assertEq(vault.velocityNow(alex), 1_500 * USD, "today's spend survives the cancellation");

        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(venue, 1_500 * USD);
        vm.stopPrank();
    }

    /** The refund still works when the proposal is cancelled inside its own window. */
    function test_cancellingAFreshProposalStillRefunds() public {
        vm.startPrank(alex);
        vault.proposeTopUp(venue, 1_500 * USD);
        vm.warp(GENESIS + 3 hours);
        vault.cancelProposal(1);
        assertEq(vault.velocityNow(alex), 0, "refunded");
        vault.instantTopUp(venue, 1_500 * USD);
        vm.stopPrank();
    }

    /** Partial lap: the reserved bucket has rolled out but the window has not fully lapped. */
    function test_cancellingAfterTheReservedBucketRolledOutDoesNotRefund() public {
        vm.startPrank(alex);
        vault.proposeTopUp(venue, 1_000 * USD);
        vm.warp(GENESIS + 5 hours); // bucket 0 -> bucket 1; the reservation stays in bucket 0 and still counts
        vault.instantTopUp(venue, 500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD);
        vm.warp(GENESIS + 21 hours); // bucket 5; reservation still inside the 24h window
        vault.cancelProposal(1);
        assertEq(vault.velocityNow(alex), 500 * USD, "refunded while still inside the window");
        vm.stopPrank();
    }

    /**
     * DEFECT 2 (v1) — a user could lock themselves out of their own exit.
     *
     * `tighten` bounded the loss cooldown and the self-pause but placed no upper
     * bound on `loosenCooldownSecs` or `fullExitCooldownSecs`, so one instant
     * call could set an exit delay beyond any human timescale, with the loosen
     * path that would undo it delayed by the value just set.
     *
     * v2: all three self-set delays are capped at 30 days
     * (MAX_TOP_UP/LOOSEN/FULL_EXIT_COOLDOWN_SECS); anything above reverts.
     */
    function test_exitDelayIsBounded() public {
        uint64 forever = type(uint64).max / 2;
        ShieldVault.TightenParams memory p;
        p.hasFullExitCooldownSecs = true;
        p.fullExitCooldownSecs = forever;
        vm.prank(alex);
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.tighten(p);

        ShieldVault.TightenParams memory q;
        q.hasLoosenCooldownSecs = true;
        q.loosenCooldownSecs = 31 days;
        vm.prank(alex);
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.tighten(q);

        ShieldVault.TightenParams memory r;
        r.hasTopUpCooldownSecs = true;
        r.topUpCooldownSecs = 31 days;
        vm.prank(alex);
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.tighten(r);

        // The bound itself is reachable.
        ShieldVault.TightenParams memory ok;
        ok.hasFullExitCooldownSecs = true;
        ok.fullExitCooldownSecs = 30 days;
        ok.hasLoosenCooldownSecs = true;
        ok.loosenCooldownSecs = 30 days;
        vm.prank(alex);
        vault.tighten(ok);
        ShieldVault.Vault memory v = vault.getVault(alex);
        assertEq(v.fullExitCooldownSecs, 30 days);
        assertEq(v.loosenCooldownSecs, 30 days);
    }

    /**
     * DEFECT 3 (v1) — an idle gap refunded the whole 24h limit, in a single block.
     *
     * `_rollBuckets` clamped `elapsed` to the ring size before advancing
     * `bucketStart`, so after N idle days the window start caught up only 24h
     * per call, every call re-entered the long-idle branch and zeroed all six
     * buckets again with no time passing: $6,000 released in one block against
     * a stated $1,000 per 24 hours.
     *
     * v2: the window start and the ring pointer advance by the real elapsed
     * count, so a gap is consumed exactly once.
     */
    function test_anIdleGapRefundsTheDailyLimitExactlyOnce() public {
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
        vault.instantTopUp(venue, 1_000 * USD); // the fresh day's limit, once
        assertEq(vault.velocityNow(bob), 1_000 * USD, "the gap was consumed once");
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(venue, 1 * USD);

        // And the window keeps rolling correctly afterwards.
        vm.warp(GENESIS + 7 days + 24 hours);
        vault.instantTopUp(venue, 1_000 * USD);
        assertEq(vault.velocityNow(bob), 1_000 * USD);
        vm.stopPrank();
    }

    /** The clock lands mid-ring after a long gap: the pointer must still be right. */
    function test_ringPointerSurvivesAnOddGap() public {
        vm.startPrank(alex);
        vault.instantTopUp(venue, 400 * USD);
        vm.warp(GENESIS + 7 days + 9 hours); // 44 buckets: pointer should be at 44 % 6 = 2
        vault.instantTopUp(venue, 400 * USD);
        vm.warp(GENESIS + 7 days + 9 hours + 20 hours); // 5 buckets later: the 400 is still inside the window
        assertEq(vault.velocityNow(alex), 400 * USD);
        vm.warp(GENESIS + 7 days + 9 hours + 24 hours); // 6 buckets later: rolled out
        assertEq(vault.velocityNow(alex), 0);
        vault.instantTopUp(venue, DAILY);
        vm.stopPrank();
    }
}
