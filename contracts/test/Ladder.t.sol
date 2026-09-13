// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {MockUSDC, MockCoreDepositWallet} from "./Mocks.sol";

/**
 * v3 risk ladder: NORMAL / REDUCED / LOCKED.
 *
 * The thresholds that select a rung are private (a salted commitment on chain,
 * plaintext in the enclave). The chain enforces: a verdict may only select a
 * rung the user pre-wrote, only downward, only against the committed ladder;
 * REDUCED lowers the 24h release budget to the pre-written allowance and
 * expires on the user's own clock; LOCKED is the cooldown and keeps the public
 * loss-trigger floor; moving back up early waits and must be reconfirmed.
 */
contract LadderTest is Test {
    ShieldVault vault;
    MockUSDC usdc;
    MockCoreDepositWallet core;

    address alex = address(0xA1E7);
    address venue = address(0xA710);
    uint256 verifierKey = 0xBEEF;
    uint256 rogueKey = 0xDEAD;
    address verifier;
    uint64 constant USD = 1_000_000;
    uint64 constant GENESIS = 1_800_000_000;
    bytes32 constant LADDER = keccak256("D1=150,D3=300,salt");

    function setUp() public {
        vm.warp(GENESIS);
        verifier = vm.addr(verifierKey);
        usdc = new MockUSDC();
        core = new MockCoreDepositWallet(usdc);
        vault = new ShieldVault(address(usdc), address(core));
        usdc.mint(alex, 100_000 * USD);
        vm.startPrank(alex);
        vault.initializeVault(ShieldVault.InitParams({ riskVerifier: verifier, protectedFloor: 1_000 * USD, topUpThresholdBps: 10_000, emergencyCap: 200 * USD, velocityThreshold: 1_000 * USD, lossTriggerUsdc: 300 * USD, lossCooldownSecs: 12 hours }));
        vault.registerOwner(venue, 0, 1, bytes24("Venue"));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(alex, 10_000 * USD);
        vm.stopPrank();
    }

    // ---------------- committing the ladder ----------------

    function test_firstCommitIsInstantAndTightens() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 0);
        ShieldVault.Vault memory v = vault.getVault(alex);
        assertEq(v.ladderHash, LADDER);
        assertEq(v.reducedVelocityThreshold, 400 * USD);
        assertEq(v.tierResetSecs, vault.DEFAULT_TIER_RESET_SECS(), "0 means the default");
        assertEq(v.configVersion, 2, "a tightening strands pending loosenings");
        assertEq(vault.currentTier(alex), 0);
    }

    function test_reCommitMayOnlyTighten() public {
        vm.startPrank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        vault.commitLadder(LADDER, 300 * USD, 48 hours); // stricter allowance, longer REDUCED: instant
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.commitLadder(LADDER, 350 * USD, 48 hours); // wider allowance
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.commitLadder(keccak256("other"), 300 * USD, 48 hours); // the chain cannot rank two commitments
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.commitLadder(LADDER, 300 * USD, 30 minutes); // below MIN_TIER_RESET_SECS
        vm.stopPrank();
    }

    // ---------------- the verdict descends the ladder ----------------

    function test_reducedVerdictLowersTheBudgetProportionally() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        vm.prank(alex);
        vault.instantTopUp(venue, 500 * USD); // NORMAL: $1,000/24h
        assertEq(vault.effectiveVelocityThreshold(alex), 1_000 * USD);

        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        assertEq(vault.currentTier(alex), 1, "REDUCED");
        assertEq(vault.effectiveVelocityThreshold(alex), 400 * USD, "the pre-written allowance");
        assertEq(vault.getVault(alex).cooldownUntil, 0, "REDUCED is not a pause");

        vm.prank(alex);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(venue, 500 * USD); // the same release now refused: $500 spent of a $400 budget
    }

    function test_reducedThenSmallerReleaseStillFits() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        vm.startPrank(alex);
        vault.instantTopUp(venue, 200 * USD);
        vault.instantTopUp(venue, 200 * USD);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(venue, 1 * USD);
        vm.stopPrank();
    }

    function test_reducedExpiresOnTheCalmUsersClock() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 6 hours);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        vm.warp(GENESIS + 6 hours - 1);
        assertEq(vault.currentTier(alex), 1);
        vm.warp(GENESIS + 6 hours);
        assertEq(vault.currentTier(alex), 0, "back to NORMAL when the clock the user set runs out");
        assertEq(vault.effectiveVelocityThreshold(alex), 1_000 * USD);
    }

    function test_reducedVerdictNeedsTheCommittedLadder() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, verifierKey);
        vm.expectRevert(ShieldVault.NoLadder.selector);
        vault.applyRiskVerdict(rv, sig);

        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        (ShieldVault.RiskVerdict memory wrong, bytes memory ws) = _verdict(1, 1, keccak256("stale ladder"), 0, verifierKey);
        vm.expectRevert(ShieldVault.LadderMismatch.selector);
        vault.applyRiskVerdict(wrong, ws);
    }

    function test_verdictCanNeverSelectNormalOrClimb() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        (ShieldVault.RiskVerdict memory normal, bytes memory ns) = _verdict(1, 0, LADDER, 0, verifierKey);
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.applyRiskVerdict(normal, ns);

        (ShieldVault.RiskVerdict memory locked, bytes memory ls) = _verdict(1, 2, bytes32(0), 300 * USD, verifierKey);
        vault.applyRiskVerdict(locked, ls);
        assertEq(vault.currentTier(alex), 2);
        (ShieldVault.RiskVerdict memory reduced, bytes memory rs) = _verdict(2, 1, LADDER, 0, verifierKey);
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.applyRiskVerdict(reduced, rs); // LOCKED -> REDUCED would be a climb
    }

    function test_lockedKeepsThePublicFloorAndArmsTheCooldown() public {
        (ShieldVault.RiskVerdict memory low, bytes memory lows) = _verdict(1, 2, bytes32(0), 299 * USD, verifierKey);
        vm.expectRevert(ShieldVault.VerdictBelowLossTrigger.selector);
        vault.applyRiskVerdict(low, lows);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 2, bytes32(0), 300 * USD, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        assertEq(vault.getVault(alex).cooldownUntil, GENESIS + 12 hours);
        assertEq(vault.currentTier(alex), 2);
        vm.warp(GENESIS + 12 hours);
        assertEq(vault.currentTier(alex), 0, "LOCKED clears with the cooldown");
    }

    // ---------------- gated top-ups re-check the rung in force ----------------

    function test_gatedTopUpProposedAtNormalIsRefusedAtReduced() public {
        vm.startPrank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        vault.proposeTopUp(venue, 800 * USD); // fits $1,000 at NORMAL, reserved
        vm.stopPrank();
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        vm.warp(GENESIS + 31 minutes);
        vm.prank(alex);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.executeTopUp(); // v1/v2 would have released $800 against a $400 budget
    }

    // ---------------- the user descends instantly, ascends slowly ----------------

    function test_userCanDropToReducedInstantly() public {
        vm.startPrank(alex);
        vm.expectRevert(ShieldVault.NoLadder.selector);
        vault.setReducedTier();
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        vault.setReducedTier();
        assertEq(vault.currentTier(alex), 1);
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.setReducedTier();
        vm.stopPrank();
    }

    function test_leavingReducedEarlyWaitsAndMustBeReconfirmed() public {
        vm.startPrank(alex);
        vault.commitLadder(LADDER, 400 * USD, 48 hours);
        vault.setReducedTier();
        vault.proposeLadderChange(bytes32(0), 0, 0, true);
        vm.expectRevert(ShieldVault.ProposalNotMatured.selector);
        vault.executeLadderChange();
        vm.warp(GENESIS + 24 hours); // the loosen delay
        assertEq(vault.currentTier(alex), 1, "nothing applied by itself");
        vault.executeLadderChange();
        assertEq(vault.currentTier(alex), 0);
        vm.stopPrank();
    }

    function test_replacingTheLadderWaitsAndAnyTighteningStrandsIt() public {
        vm.startPrank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        vault.proposeLadderChange(keccak256("looser"), 900 * USD, 1 hours, false);
        vm.warp(GENESIS + 1 hours);
        vault.setReducedTier(); // a tightening in between
        vm.warp(GENESIS + 24 hours);
        vm.expectRevert(ShieldVault.ProposalStale.selector);
        vault.executeLadderChange();
        vault.cancelLadderChange();
        vm.stopPrank();
        assertEq(vault.getVault(alex).ladderHash, LADDER, "the old ladder still stands");
    }

    function test_tierResetNeverShortensALockedCooldown() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 2, bytes32(0), 300 * USD, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        vm.startPrank(alex);
        vault.proposeLadderChange(bytes32(0), 0, 0, true);
        vm.warp(GENESIS + 24 hours); // cooldown was 12h, so LOCKED already cleared by itself; a longer one would not
        vault.executeLadderChange();
        vm.stopPrank();
        assertEq(vault.getVault(alex).cooldownUntil, GENESIS + 12 hours, "cooldownUntil untouched");
    }

    // ---------------- verifier swap resets the nonce sequence ----------------

    function test_rogueNonceExhaustionIsRecoverableByChangingTheVerifier() public {
        // A compromised key burns the top of the nonce range.
        (ShieldVault.RiskVerdict memory burn, bytes memory bs) = _verdict(type(uint64).max, 2, bytes32(0), 300 * USD, verifierKey);
        vault.applyRiskVerdict(burn, bs);
        assertEq(vault.getVault(alex).lastVerdictNonce, type(uint64).max);

        // The user removes the verifier and pins a new one through the loosen path.
        uint256 newKey = 0xCAFE;
        ShieldVault.LoosenParams memory p;
        p.hasRiskVerifier = true;
        p.riskVerifier = vm.addr(newKey);
        vm.prank(alex);
        vault.proposeLoosen(p);
        vm.warp(GENESIS + 24 hours);
        vm.prank(alex);
        vault.executeRuleChange();
        assertEq(vault.getVault(alex).lastVerdictNonce, 0, "v3: a new verifier starts at zero");

        vm.warp(GENESIS + 48 hours);
        (ShieldVault.RiskVerdict memory fresh, bytes memory fs) = _verdict(1, 2, bytes32(0), 300 * USD, newKey);
        vault.applyRiskVerdict(fresh, fs);
        assertEq(vault.getVault(alex).lastVerdictNonce, 1);
        (ShieldVault.RiskVerdict memory old, bytes memory os) = _verdict(2, 2, bytes32(0), 300 * USD, verifierKey);
        vm.expectRevert(ShieldVault.InvalidVerifier.selector);
        vault.applyRiskVerdict(old, os); // the burned key is out
    }

    function test_rogueKeyCannotLoosenAnythingThroughTheLadder() public {
        vm.prank(alex);
        vault.commitLadder(LADDER, 400 * USD, 24 hours);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1, LADDER, 0, rogueKey);
        vm.expectRevert(ShieldVault.InvalidVerifier.selector);
        vault.applyRiskVerdict(rv, sig);
    }

    // ---------------- helpers ----------------
    function _verdict(uint64 nonce, uint8 tier, bytes32 ladderHash, uint64 loss, uint256 key) internal view returns (ShieldVault.RiskVerdict memory rv, bytes memory sig) {
        // vm.getBlockTimestamp(): under via_ir the optimizer treats block.timestamp as constant within one test transaction, so a warp between two verdicts would be ignored.
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        rv = ShieldVault.RiskVerdict(alex, nonce, nowTs, nowTs + 15 minutes, tier, ladderHash, loss, keccak256("evidence"));
        bytes32 structHash = keccak256(abi.encode(vault.VERDICT_TYPEHASH(), rv.vault, rv.nonce, rv.issuedAt, rv.expiry, rv.tier, rv.ladderHash, rv.realizedLossUsdc, rv.evidenceHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, digest);
        sig = abi.encodePacked(r, s, vv);
    }
}
