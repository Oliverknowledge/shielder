// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {MockUSDC} from "./Mocks.sol";

/// A CoreDepositWallet that tries to re-enter the vault from inside `depositFor`.
/// Circle's real contract does not do this; the test proves the lock would hold if it did.
contract ReentrantCoreDepositWallet {
    MockUSDC public immutable usdc;
    bool public sawReentrancyRevert;
    bool public sawOtherRevert;
    constructor(MockUSDC usdc_) { usdc = usdc_; }
    function depositFor(address recipient, uint256 amount, uint32) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "pull");
        // The vault is mid-release; any path guarded by nonReentrant must refuse
        // before it even looks at who is calling.
        try ShieldVault(msg.sender).instantTopUp(recipient, 1) {
            revert("re-entry succeeded");
        } catch (bytes memory reason) {
            if (bytes4(reason) == ShieldVault.Reentrancy.selector) sawReentrancyRevert = true;
            else sawOtherRevert = true;
        }
    }
}

/// Invariants 3 and 12 of docs/THREAT_MODEL.md, previously checked by reading only.
contract IsolationTest is Test {
    MockUSDC usdc;
    ReentrantCoreDepositWallet core;
    ShieldVault vault;

    address alex = address(0xA1E7);
    address bob = address(0xB0B);
    address venue = address(0xA710);
    uint64 constant USD = 1_000_000;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        core = new ReentrantCoreDepositWallet(usdc);
        vault = new ShieldVault(address(usdc), address(core));
        usdc.mint(alex, 10_000 * USD);
        usdc.mint(bob, 10_000 * USD);
        _open(alex);
        _open(bob);
    }

    function _open(address who) internal {
        vm.startPrank(who);
        vault.initializeVault(
            ShieldVault.InitParams({ riskVerifier: address(0), protectedFloor: 1_000 * USD, topUpThresholdBps: 10_000, emergencyCap: 200 * USD, velocityThreshold: 2_000 * USD, lossTriggerUsdc: 1_000 * USD, lossCooldownSecs: 12 hours })
        );
        vm.stopPrank();
    }

    /// Invariant 12: the reentrancy lock is held across the external delivery call.
    function test_reentrancyThroughAHostileCoreDepositWalletIsRefused() public {
        vm.startPrank(alex);
        vault.registerOwner(venue, 0, 1, bytes24("Venue"));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(alex, 5_000 * USD);
        vault.instantTopUp(venue, 100 * USD);
        vm.stopPrank();
        assertTrue(core.sawReentrancyRevert(), "the re-entry was refused by the lock, not by the authority check");
        assertFalse(core.sawOtherRevert());
        assertEq(vault.getVault(alex).balance, 4_900 * USD, "exactly one release happened");
        assertEq(usdc.balanceOf(address(core)), 100 * USD);
    }

    /// Invariant 3: registries are per vault. Bob registering a destination does nothing for Alex.
    function test_registriesAreIsolatedPerVault() public {
        vm.prank(bob);
        vault.registerOwner(venue, 0, 1, bytes24("Venue"));
        assertEq(vault.getRegistryOwners(bob).length, 1);
        assertEq(vault.getRegistryOwners(alex).length, 0);

        vm.startPrank(alex);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(alex, 5_000 * USD);
        vm.expectRevert(ShieldVault.DestinationNotExecution.selector);
        vault.instantTopUp(venue, 100 * USD);
        vm.expectRevert(ShieldVault.DestinationNotExecution.selector);
        vault.proposeTopUp(venue, 100 * USD);
        vm.stopPrank();

        // And Bob cannot spend Alex's balance through his own registration.
        vm.prank(bob);
        vm.expectRevert(ShieldVault.ProtectedFloorBreached.selector); // Bob's vault is empty: floor check refuses
        vault.instantTopUp(venue, 100 * USD);
        assertEq(vault.getVault(alex).balance, 5_000 * USD);
    }
}
