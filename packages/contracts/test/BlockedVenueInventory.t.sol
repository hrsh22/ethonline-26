// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

contract InventoryRecovery is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract InventoryGuardian {}

/// @dev Stands in for a third-party AMM: it moves the liquid token on someone
///      else's behalf, which is the shape every blocked venue has.
contract InventoryVenue {
    uint256 public immutable variant;

    constructor(uint256 variant_) {
        variant = variant_;
    }

    function pull(FuelCore core, address from, address to, uint256 amount) external {
        require(core.transferFrom(from, to, amount), "venue transfer failed");
    }
}

contract InventoryHolder {
    function approveLiquid(FuelCore core, address spender, uint256 amount) external {
        require(core.approve(spender, amount), "approval failed");
    }

    function sendLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "transfer failed");
    }
}

contract BlockedVenueInventoryTest is Test {
    FuelCore private core;

    function setUp() public {
        core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(new InventoryGuardian()),
            new InventoryRecovery()
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(core))))
        );
    }

    /// @dev An inventory is a list, not one entry. Configuring several and
    ///      checking only the first would pass while the rest went unapplied.
    function test_everyConfiguredCodehashBlocksItsVenue() public {
        InventoryVenue[] memory venues = new InventoryVenue[](3);
        for (uint256 index; index < venues.length; ++index) {
            venues[index] = new InventoryVenue(index);
            core.setBlockedVenueCodehash(address(venues[index]).codehash, true);
        }
        core.launch();

        InventoryHolder holder = new InventoryHolder();
        core.transfer(address(holder), 3 ether);

        for (uint256 index; index < venues.length; ++index) {
            assertTrue(core.isBlockedVenueCodehash(address(venues[index]).codehash));
            vm.expectRevert();
            holder.approveLiquid(core, address(venues[index]), 1 ether);
        }
    }

    /// @dev Two contracts built from the same source share one codehash, which
    ///      is the whole reason a codehash is the unit: one entry covers every
    ///      instance. If it did not, an inventory would be useless against a
    ///      venue that simply redeploys.
    function test_oneEntryCoversEveryInstanceOfThatImplementation() public {
        InventoryVenue configured = new InventoryVenue(0);
        InventoryVenue laterInstance = new InventoryVenue(0);
        assertEq(address(configured).codehash, address(laterInstance).codehash);

        core.setBlockedVenueCodehash(address(configured).codehash, true);
        core.launch();

        InventoryHolder holder = new InventoryHolder();
        core.transfer(address(holder), 1 ether);
        vm.expectRevert();
        holder.approveLiquid(core, address(laterInstance), 1 ether);
    }

    /// @dev Constructor arguments stored as immutables land in runtime code, so
    ///      the same source at different arguments is a different codehash.
    ///      This is why a Uniswap V3 pool cannot be blocked by implementation:
    ///      each pool bakes in its own token pair and fee. Documented in ADR 0002.
    function test_differentImmutablesAreADifferentCodehashAndAreNotCovered() public {
        InventoryVenue configured = new InventoryVenue(0);
        InventoryVenue variant = new InventoryVenue(1);
        assertTrue(address(configured).codehash != address(variant).codehash);

        core.setBlockedVenueCodehash(address(configured).codehash, true);
        core.launch();

        InventoryHolder holder = new InventoryHolder();
        core.transfer(address(holder), 1 ether);
        // Not a defect: a codehash blocklist genuinely cannot reach it, which
        // is exactly the limit the ADR records rather than papers over.
        holder.approveLiquid(core, address(variant), 1 ether);
    }

    function test_repeatedConfigurationIsIdempotent() public {
        InventoryVenue venue = new InventoryVenue(0);
        core.setBlockedVenueCodehash(address(venue).codehash, true);
        core.setBlockedVenueCodehash(address(venue).codehash, true);
        assertTrue(core.isBlockedVenueCodehash(address(venue).codehash));
    }

    /// @dev A codehash nothing was ever deployed at blocks nothing, so a typo
    ///      in an inventory fails open rather than bricking transfers.
    function test_anEntryWithNoDeployedCodeBlocksNothing() public {
        core.setBlockedVenueCodehash(keccak256("nothing was deployed here"), true);
        core.launch();

        InventoryHolder holder = new InventoryHolder();
        core.transfer(address(holder), 1 ether);
        holder.sendLiquid(core, address(0xBEEF), 1 ether);
        assertEq(core.balanceOf(address(0xBEEF)), 1 ether);
    }

    function test_ordinaryWalletTransfersRemainAvailable() public {
        InventoryVenue venue = new InventoryVenue(0);
        core.setBlockedVenueCodehash(address(venue).codehash, true);
        core.launch();

        InventoryHolder holder = new InventoryHolder();
        core.transfer(address(holder), 2 ether);
        holder.sendLiquid(core, address(0xA11CE), 1 ether);
        assertEq(core.balanceOf(address(0xA11CE)), 1 ether);
    }

    /// @dev The inventory is final at launch. This is why it has to be right in
    ///      the deployment inputs: there is no repair path afterwards.
    function test_theInventoryIsFrozenAtLaunch() public {
        core.launch();
        InventoryVenue missed = new InventoryVenue(0);
        vm.expectRevert(FuelCore.TradingLocked.selector);
        core.setBlockedVenueCodehash(address(missed).codehash, true);
    }

    function test_theZeroCodehashIsRejected() public {
        vm.expectRevert(abi.encodeWithSelector(FuelCore.InvalidConfiguration.selector, address(0)));
        core.setBlockedVenueCodehash(bytes32(0), true);
    }
}
