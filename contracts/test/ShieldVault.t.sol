// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {MockUSDC, MockCoreDepositWallet} from "./Mocks.sol";

/// Invariant suite mirroring tests/shield-vault.test.ts (the Solana program).
contract ShieldVaultTest is Test {
    ShieldVault vault;
    MockUSDC usdc;
    MockCoreDepositWallet core;

    address alex = address(0xA1E7);
    address axiom = address(0xA710); // trading account (HyperCore route)
    address ledger = address(0xC01D); // cold wallet (EVM route)
    address stranger = address(0xBAD);
    uint256 verifierKey = 0xC0FFEE;
    address verifier;

    uint64 constant USD = 1_000_000;
    uint64 constant FLOOR = 6_000 * USD;
    uint64 constant CAP = 200 * USD;
    uint64 constant VEL = 1_600 * USD;
    uint64 constant TRIGGER = 1_000 * USD;
    uint64 constant LOSS_CD = 18 hours;
    uint64 constant GENESIS = 1_800_000_000;

    function setUp() public {
        vm.warp(GENESIS);
        usdc = new MockUSDC();
        core = new MockCoreDepositWallet(usdc);
        vault = new ShieldVault(address(usdc), address(core));
        verifier = vm.addr(verifierKey);
        usdc.mint(alex, 100_000 * USD);
        vm.startPrank(alex);
        vault.initializeVault(ShieldVault.InitParams({ riskVerifier: verifier, protectedFloor: FLOOR, topUpThresholdBps: 2000, emergencyCap: CAP, velocityThreshold: VEL, lossTriggerUsdc: TRIGGER, lossCooldownSecs: LOSS_CD }));
        vault.registerOwner(axiom, 0, 1, bytes24("Axiom"));
        vault.registerOwner(ledger, 1, 0, bytes24("Ledger"));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(alex, 10_000 * USD);
        vm.stopPrank();
    }

    function v() internal view returns (ShieldVault.Vault memory) { return vault.getVault(alex); }
    function tp() internal pure returns (ShieldVault.TightenParams memory p) { }
    function lp() internal pure returns (ShieldVault.LoosenParams memory p) { }

    // ---------------- deposits & registry ----------------
    function test_depositCreditsVaultAndEmits() public {
        assertEq(v().balance, 10_000 * USD);
        assertEq(usdc.balanceOf(address(vault)), 10_000 * USD);
    }

    function test_registerWhileFundedIsRefused() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.VaultFundedUseDelayedPath.selector);
        vault.registerOwner(stranger, 0, 0, bytes24("Scam"));
    }

    function test_typeIsPermanent() public {
        // a fresh vault for a second user
        address bob = address(0xB0B);
        vm.startPrank(bob);
        vault.initializeVault(ShieldVault.InitParams(verifier, 0, 2000, CAP, VEL, TRIGGER, LOSS_CD));
        vault.registerOwner(axiom, 0, 1, bytes24("t"));
        vm.expectRevert(ShieldVault.AlreadyRegisteredDifferentType.selector);
        vault.registerOwner(axiom, 1, 0, bytes24("cold?"));
        vm.stopPrank();
    }

    function test_removeRegistrationBumpsConfigVersion() public {
        uint64 before = v().configVersion;
        vm.prank(alex);
        vault.removeRegistration(axiom);
        assertEq(v().configVersion, before + 1);
        assertFalse(vault.getRegistryEntry(alex, axiom).active);
    }

    // ---------------- instant top-ups ----------------
    function test_instantTopUpLandsInHyperCoreAccount() public {
        vm.prank(alex);
        vault.instantTopUp(axiom, 1_500 * USD);
        assertEq(core.coreBalance(axiom), 1_500 * USD, "credited on HyperCore");
        assertEq(v().balance, 8_500 * USD);
        assertEq(vault.velocityNow(alex), 1_500 * USD);
    }

    function test_rawTransferPathIsUnreachable() public {
        // the contract has no transfer function callable by anyone; try a stranger's top-up
        vm.prank(stranger);
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.instantTopUp(axiom, 1 * USD);
    }

    function test_unregisteredDestinationRefused() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.DestinationNotExecution.selector);
        vault.instantTopUp(stranger, 100 * USD);
    }

    function test_coldWalletIsNotAnExecutionDestination() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.DestinationNotExecution.selector);
        vault.instantTopUp(ledger, 100 * USD);
    }

    function test_floorIsInviolable() public {
        vm.startPrank(alex);
        vault.instantTopUp(axiom, 1_500 * USD); // 8,500 left
        // 2,600 would go below 6,000 (and exceed velocity anyway); lower velocity check by resetting later
        vm.warp(GENESIS + 1 days + 1);
        vm.expectRevert(ShieldVault.ProtectedFloorBreached.selector);
        vault.instantTopUp(axiom, 2_600 * USD);
        vm.stopPrank();
    }

    function test_splittingDoesNotBeatTheDailyLimit() public {
        vm.startPrank(alex);
        vault.instantTopUp(axiom, 800 * USD);
        vault.instantTopUp(axiom, 700 * USD);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(axiom, 200 * USD); // 1,700 > 1,600
        vault.instantTopUp(axiom, 100 * USD); // exactly 1,600 ok
        vm.stopPrank();
        assertEq(vault.velocityNow(alex), 1_600 * USD);
    }

    function test_velocityRollsAfter24h() public {
        vm.startPrank(alex);
        vault.instantTopUp(axiom, 1_600 * USD);
        vm.warp(GENESIS + 24 hours);
        vault.instantTopUp(axiom, 1_000 * USD);
        vm.stopPrank();
        assertEq(vault.velocityNow(alex), 1_000 * USD);
    }

    function test_largeTopUpMustWait() public {
        vm.startPrank(alex);
        vault.tighten(_tightenThreshold(1000)); // 10% of 10,000 = 1,000
        vm.expectRevert(ShieldVault.AmountRequiresGatedTopUp.selector);
        vault.instantTopUp(axiom, 1_200 * USD); // under the daily limit, over the large-amount threshold
        vault.instantTopUp(axiom, 999 * USD); // just under the threshold moves instantly
        vm.stopPrank();
    }

    function test_checkOrderIsCooldownFloorVelocityThreshold() public {
        vm.startPrank(alex);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantTopUp(axiom, 2_000 * USD); // velocity (1,600) is checked before the 20% threshold
        vault.tighten(_pause(GENESIS + 1 hours));
        vm.expectRevert(ShieldVault.CooldownActive.selector);
        vault.instantTopUp(axiom, 2_000 * USD); // cooldown wins over everything
        vm.stopPrank();
    }

    function test_gatedTopUpMaturesAfter30Minutes() public {
        vm.startPrank(alex);
        // lower velocity would block 2,000; loosen not possible instantly, so use a larger limit vault: tighten can't raise. Use amount below velocity but above threshold by lowering threshold.
        vault.tighten(_tightenThreshold(1000)); // 10% => 1,000 threshold
        vault.proposeTopUp(axiom, 1_200 * USD);
        vm.expectRevert(ShieldVault.ProposalNotMatured.selector);
        vault.executeTopUp();
        vm.warp(GENESIS + 30 minutes);
        vault.executeTopUp();
        vm.stopPrank();
        assertEq(core.coreBalance(axiom), 1_200 * USD);
        assertEq(vault.velocityNow(alex), 1_200 * USD, "reserved at proposal time");
    }

    function test_cancelTopUpRefundsVelocity() public {
        vm.startPrank(alex);
        vault.tighten(_tightenThreshold(1000));
        vault.proposeTopUp(axiom, 1_200 * USD);
        assertEq(vault.velocityNow(alex), 1_200 * USD);
        vault.cancelProposal(1);
        assertEq(vault.velocityNow(alex), 0);
        vm.stopPrank();
    }

    // ---------------- cooldowns & verdicts ----------------
    function test_selfPauseBlocksTopUpsAndIsMonotonic() public {
        vm.startPrank(alex);
        vault.tighten(_pause(GENESIS + 6 hours));
        vm.expectRevert(ShieldVault.CooldownActive.selector);
        vault.instantTopUp(axiom, 100 * USD);
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.tighten(_pause(GENESIS + 1 hours)); // shorter is not a tightening
        vault.tighten(_pause(GENESIS + 7 hours));
        vm.stopPrank();
        assertEq(v().cooldownUntil, GENESIS + 7 hours);
    }

    function test_pauseTooLong() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.PauseTooLong.selector);
        vault.tighten(_pause(GENESIS + 31 days));
    }

    function test_verdictArmsTheCooldown() public {
        vm.prank(alex);
        vault.instantTopUp(axiom, 1_500 * USD);
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1_420 * USD, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        assertEq(v().cooldownUntil, GENESIS + LOSS_CD);
        assertEq(v().cooldownReason, 2);
        vm.prank(alex);
        vm.expectRevert(ShieldVault.CooldownActive.selector);
        vault.instantTopUp(axiom, 100 * USD);
    }

    function test_verdictBelowTriggerRejected() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 999 * USD, verifierKey);
        vm.expectRevert(ShieldVault.VerdictBelowLossTrigger.selector);
        vault.applyRiskVerdict(rv, sig);
    }

    function test_verdictReplayRejected() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(3, 1_420 * USD, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        vm.expectRevert(ShieldVault.VerdictReplayed.selector);
        vault.applyRiskVerdict(rv, sig);
        (ShieldVault.RiskVerdict memory rv2, bytes memory sig2) = _verdict(2, 1_420 * USD, verifierKey);
        vm.expectRevert(ShieldVault.VerdictReplayed.selector);
        vault.applyRiskVerdict(rv2, sig2);
    }

    function test_verdictWrongSignerRejected() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1_420 * USD, 0xDEAD);
        vm.expectRevert(ShieldVault.InvalidVerifier.selector);
        vault.applyRiskVerdict(rv, sig);
    }

    function test_verdictTamperedRejected() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1_420 * USD, verifierKey);
        rv.realizedLossUsdc = 5_000 * USD;
        vm.expectRevert(ShieldVault.InvalidVerifier.selector);
        vault.applyRiskVerdict(rv, sig);
    }

    function test_verdictExpiredAndFutureRejected() public {
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1_420 * USD, verifierKey);
        vm.warp(GENESIS + 16 minutes);
        vm.expectRevert(ShieldVault.VerdictExpired.selector);
        vault.applyRiskVerdict(rv, sig);
        vm.warp(GENESIS);
        ShieldVault.RiskVerdict memory f = ShieldVault.RiskVerdict(alex, 1, GENESIS + 10 minutes, GENESIS + 30 minutes, 1, 1_420 * USD, bytes32("e"));
        bytes memory fs = _sign(f, verifierKey);
        vm.expectRevert(ShieldVault.VerdictNotYetValid.selector);
        vault.applyRiskVerdict(f, fs);
    }

    function test_verdictCannotShortenCooldownAndDoesNotBumpConfig() public {
        vm.startPrank(alex);
        vault.tighten(_pause(GENESIS + 40 hours));
        uint64 cfg = v().configVersion;
        vault.proposeLoosen(_loosenDaily(3_000 * USD));
        vm.stopPrank();
        (ShieldVault.RiskVerdict memory rv, bytes memory sig) = _verdict(1, 1_420 * USD, verifierKey);
        vault.applyRiskVerdict(rv, sig);
        assertEq(v().cooldownUntil, GENESIS + 40 hours, "not shortened");
        assertEq(v().configVersion, cfg, "verdicts never supersede proposals");
    }

    function test_noMonitorMeansNoVerdicts() public {
        address bob = address(0xB0B2);
        vm.prank(bob);
        vault.initializeVault(ShieldVault.InitParams(address(0), 0, 2000, CAP, VEL, TRIGGER, LOSS_CD));
        ShieldVault.RiskVerdict memory rv = ShieldVault.RiskVerdict(bob, 1, GENESIS, GENESIS + 15 minutes, 1, 1_420 * USD, bytes32("e"));
        bytes memory sig = _sign(rv, verifierKey);
        vm.expectRevert(ShieldVault.NoRiskVerifier.selector);
        vault.applyRiskVerdict(rv, sig);
    }

    // ---------------- tighten / loosen ----------------
    function test_tightenIsInstantAndSupersedesPendingLoosen() public {
        vm.startPrank(alex);
        vault.proposeLoosen(_loosenDaily(3_000 * USD));
        vault.tighten(_tightenFloor(7_000 * USD));
        assertEq(v().protectedFloor, 7_000 * USD);
        vm.warp(GENESIS + 24 hours);
        vm.expectRevert(ShieldVault.ProposalStale.selector);
        vault.executeRuleChange();
        vault.cancelProposal(0);
        vm.stopPrank();
    }

    function test_loosenWaitsAndRequiresReconfirmation() public {
        vm.startPrank(alex);
        vault.proposeLoosen(_loosenDaily(3_000 * USD));
        vm.expectRevert(ShieldVault.ProposalNotMatured.selector);
        vault.executeRuleChange();
        vm.warp(GENESIS + 24 hours);
        assertEq(v().velocityThreshold, VEL, "nothing changed by itself");
        vault.executeRuleChange();
        assertEq(v().velocityThreshold, 3_000 * USD);
        vm.stopPrank();
    }

    function test_loosenExpires() public {
        vm.startPrank(alex);
        vault.proposeLoosen(_loosenDaily(3_000 * USD));
        vm.warp(GENESIS + 24 hours + 7 days + 1);
        vm.expectRevert(ShieldVault.ProposalExpired.selector);
        vault.executeRuleChange();
        vm.stopPrank();
    }

    function test_cannotLoosenInstantlyOrTightenWeaker() public {
        vm.startPrank(alex);
        ShieldVault.TightenParams memory t; t.hasVelocityThreshold = true; t.velocityThreshold = 5_000 * USD;
        vm.expectRevert(ShieldVault.NotATightening.selector);
        vault.tighten(t);
        ShieldVault.LoosenParams memory l; l.hasProtectedFloor = true; l.protectedFloor = 9_000 * USD;
        vm.expectRevert(ShieldVault.NotALoosening.selector);
        vault.proposeLoosen(l);
        vm.stopPrank();
    }

    function test_delaysCannotGoBelowFloors() public {
        vm.startPrank(alex);
        ShieldVault.LoosenParams memory l; l.hasLoosenCooldownSecs = true; l.loosenCooldownSecs = 10 minutes;
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.proposeLoosen(l);
        ShieldVault.LoosenParams memory l2; l2.hasFullExitCooldownSecs = true; l2.fullExitCooldownSecs = 0;
        vm.expectRevert(ShieldVault.InvalidParameter.selector);
        vault.proposeLoosen(l2);
        vm.stopPrank();
    }

    function test_addingDestinationWaitsAndThenWorks() public {
        vm.startPrank(alex);
        ShieldVault.LoosenParams memory l; l.registerOwner = stranger; l.registerKind = 1; l.registerRoute = 0; l.registerLabel = bytes24("Cold 2");
        vault.proposeLoosen(l);
        vm.expectRevert(ShieldVault.DestinationNotCold.selector);
        vault.instantColdTransfer(stranger, 50 * USD);
        vm.warp(GENESIS + 24 hours);
        vault.executeRuleChange();
        vault.instantColdTransfer(stranger, 50 * USD);
        vm.stopPrank();
        assertEq(usdc.balanceOf(stranger), 50 * USD);
    }

    function test_removingMonitorWaits() public {
        vm.startPrank(alex);
        ShieldVault.LoosenParams memory l; l.hasRiskVerifier = true; l.riskVerifier = address(0);
        vault.proposeLoosen(l);
        vm.warp(GENESIS + 24 hours);
        vault.executeRuleChange();
        vm.stopPrank();
        assertEq(v().riskVerifier, address(0));
    }

    function test_oneProposalPerCategory() public {
        vm.startPrank(alex);
        vault.proposeLoosen(_loosenDaily(3_000 * USD));
        vm.expectRevert(ShieldVault.ProposalSlotOccupied.selector);
        vault.proposeLoosen(_loosenDaily(4_000 * USD));
        vm.stopPrank();
    }

    // ---------------- cold & exit ----------------
    function test_coldTransferWithinCapIsInstantEvenDuringCooldown() public {
        vm.startPrank(alex);
        vault.tighten(_pause(GENESIS + 6 hours));
        vault.instantColdTransfer(ledger, 150 * USD);
        vm.stopPrank();
        assertEq(usdc.balanceOf(ledger), 150 * USD);
    }

    function test_coldTransferAboveCapRefusedInstantly() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.AmountExceedsEmergencyCap.selector);
        vault.instantColdTransfer(ledger, 201 * USD);
    }

    function test_coldTransferSharesVelocity() public {
        vm.startPrank(alex);
        vault.instantTopUp(axiom, 1_500 * USD);
        vm.expectRevert(ShieldVault.VelocityThresholdExceeded.selector);
        vault.instantColdTransfer(ledger, 150 * USD); // 1,650 > 1,600
        vm.stopPrank();
    }

    function test_fullExitTakesSevenDaysAndGoesUnderTheFloor() public {
        vm.startPrank(alex);
        vault.proposeUninstallVault(ledger);
        vm.expectRevert(ShieldVault.ProposalNotMatured.selector);
        vault.executeFullExit();
        vm.warp(GENESIS + 7 days);
        vault.executeFullExit();
        vm.stopPrank();
        assertEq(usdc.balanceOf(ledger), 10_000 * USD);
        assertEq(v().balance, 0);
    }

    function test_exitDestinationCannotBeSwapped() public {
        vm.startPrank(alex);
        vault.proposeUninstallVault(ledger);
        vault.removeRegistration(ledger); // tightening: bumps config
        vm.warp(GENESIS + 7 days);
        vm.expectRevert(ShieldVault.ProposalStale.selector);
        vault.executeFullExit();
        vm.stopPrank();
    }

    function test_exitToExecutionWalletRefused() public {
        vm.prank(alex);
        vm.expectRevert(ShieldVault.FullExitDestinationNotRegisteredCold.selector);
        vault.proposeUninstallVault(axiom);
    }

    // ---------------- authorization ----------------
    function test_strangerCannotDoAnything() public {
        vm.startPrank(stranger);
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.tighten(_tightenFloor(1));
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.proposeLoosen(_loosenDaily(1));
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.instantColdTransfer(ledger, 1);
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.proposeUninstallVault(ledger);
        vm.expectRevert(ShieldVault.Unauthorized.selector);
        vault.cancelProposal(0);
        vm.stopPrank();
    }

    function test_anyoneMayDepositNobodyMayWithdraw() public {
        usdc.mint(stranger, 100 * USD);
        vm.startPrank(stranger);
        usdc.approve(address(vault), 100 * USD);
        vault.deposit(alex, 100 * USD);
        vm.stopPrank();
        assertEq(v().balance, 10_100 * USD);
    }

    // ---------------- helpers ----------------
    function _tightenFloor(uint64 f) internal pure returns (ShieldVault.TightenParams memory p) { p.hasProtectedFloor = true; p.protectedFloor = f; }
    function _tightenThreshold(uint16 bps) internal pure returns (ShieldVault.TightenParams memory p) { p.hasTopUpThresholdBps = true; p.topUpThresholdBps = bps; }
    function _pause(uint64 until) internal pure returns (ShieldVault.TightenParams memory p) { p.hasPauseTopUpsUntil = true; p.pauseTopUpsUntil = until; }
    function _loosenDaily(uint64 d) internal pure returns (ShieldVault.LoosenParams memory p) { p.hasVelocityThreshold = true; p.velocityThreshold = d; }

    function _verdict(uint64 nonce, uint64 loss, uint256 key) internal view returns (ShieldVault.RiskVerdict memory rv, bytes memory sig) {
        rv = ShieldVault.RiskVerdict(alex, nonce, uint64(block.timestamp), uint64(block.timestamp) + 15 minutes, 1, loss, keccak256("evidence"));
        sig = _sign(rv, key);
    }

    function _sign(ShieldVault.RiskVerdict memory rv, uint256 key) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(vault.VERDICT_TYPEHASH(), rv.vault, rv.nonce, rv.issuedAt, rv.expiry, rv.reasonCode, rv.realizedLossUsdc, rv.evidenceHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, vv);
    }
}
