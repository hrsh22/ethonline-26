// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {DeferredTestDiscoveryAdapter} from "../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {IDiscoveryAdapter} from "../src/interfaces/IDiscoveryAdapter.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";

contract DeferredRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract DeferredFuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }
}

contract ReusedRequestDiscoveryAdapter is IDiscoveryAdapter {
    bytes32 public constant REQUEST_ID = keccak256("reused-request");

    function requestDiscovery(address, uint256, uint256 count)
        external
        pure
        returns (DiscoveryResponse memory response)
    {
        bytes32[] memory requestIds = new bytes32[](count);
        for (uint256 index; index < count; ++index) {
            requestIds[index] = REQUEST_ID;
        }
        response = DiscoveryResponse({
            immediate: false, entropies: new bytes32[](0), requestIds: requestIds
        });
    }

    function fulfill(FuelCore core, bytes32 entropy) external returns (bool) {
        return core.fulfillDiscovery(REQUEST_ID, entropy);
    }
}

contract FuelDeferredDiscoveryTest {
    function testPendingDiscoveryHasNoCollectibleAndSellingCancelsWithoutRevealing() external {
        (FuelCore core, FuelMirror mirror, DeferredTestDiscoveryAdapter adapter) = _deploy();
        DeferredFuelActor holder = new DeferredFuelActor();
        core.launch();

        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");
        bytes32 requestId = core.pendingDiscoveryAt(address(holder), 0);

        require(core.pendingDiscoveryCount(address(holder)) == 1, "missing pending discovery");
        require(core.transientCount(address(holder)) == 0, "pending discovery minted identity");
        require(mirror.balanceOf(address(holder)) == 0, "pending discovery minted ERC-721");

        holder.transferLiquid(core, address(this), 1 ether);
        require(core.pendingDiscoveryCount(address(holder)) == 0, "pending discovery not cancelled");
        require(core.balanceOf(address(holder)) == 0, "seller kept liquid");

        adapter.fulfill(requestId, bytes32(uint256(100)));
        require(core.availableIdentityCount() == 4_444, "late fulfillment consumed identity");
        require(mirror.balanceOf(address(holder)) == 0, "late fulfillment revealed identity");
    }

    function testActiveDeferredFulfillmentAssignsTransientIdentity() external {
        (FuelCore core, FuelMirror mirror, DeferredTestDiscoveryAdapter adapter) = _deploy();
        address recipient = address(0xA11CE);
        core.launch();
        require(core.transfer(recipient, 1 ether), "liquid transfer failed");
        bytes32 requestId = core.pendingDiscoveryAt(recipient, 0);

        adapter.fulfill(requestId, bytes32(uint256(100)));

        require(core.pendingDiscoveryCount(recipient) == 0, "request remained pending");
        require(core.transientCount(recipient) == 1, "transient identity missing");
        require(mirror.ownerOf(101) == recipient, "wrong identity assigned");
        require(
            core.identityState(101) == FuelCore.IdentityState.Transient,
            "fulfilled identity is not transient"
        );
    }

    function testPendingDiscoveryIsCancelledBeforeARevealedIdentityDissolves() external {
        (FuelCore core, FuelMirror mirror, DeferredTestDiscoveryAdapter adapter) = _deploy();
        DeferredFuelActor holder = new DeferredFuelActor();
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");
        bytes32 firstRequest = core.pendingDiscoveryAt(address(holder), 0);
        bytes32 secondRequest = core.pendingDiscoveryAt(address(holder), 1);

        adapter.fulfill(secondRequest, bytes32(uint256(100)));
        holder.transferLiquid(core, address(this), 1 ether);

        require(core.pendingDiscoveryCount(address(holder)) == 0, "pending request remained");
        require(core.transientCount(address(holder)) == 1, "revealed identity dissolved first");
        require(core.availableIdentityCount() == 4_443, "revealed identity returned early");
        require(mirror.ownerOf(101) == address(holder), "revealed identity changed owner");

        require(!adapter.fulfill(firstRequest, bytes32(uint256(200))), "cancelled result was used");
        require(core.availableIdentityCount() == 4_443, "late result consumed identity");
        require(mirror.ownerOf(101) == address(holder), "late result changed revealed identity");
    }

    function testCancelledRequestIdCanNeverBecomeActiveAgain() external {
        ReusedRequestDiscoveryAdapter adapter = new ReusedRequestDiscoveryAdapter();
        DeferredRecoveryHarness recovery = new DeferredRecoveryHarness();
        FuelCore core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(0xBEEF),
            recovery
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        DeferredFuelActor firstHolder = new DeferredFuelActor();
        address secondHolder = address(0xCAFE);
        core.launch();
        require(core.transfer(address(firstHolder), 1 ether), "first request failed");
        firstHolder.transferLiquid(core, address(this), 1 ether);

        (bool reusedRequestSucceeded,) =
            address(core).call(abi.encodeCall(FuelCore.transfer, (secondHolder, 1 ether)));

        require(!reusedRequestSucceeded, "cancelled request ID became active again");
        require(!adapter.fulfill(core, bytes32(uint256(100))), "late result was accepted");
        require(core.availableIdentityCount() == 4_444, "late result consumed identity");
        require(core.pendingDiscoveryCount(secondHolder) == 0, "reused request stayed pending");
    }

    function _deploy()
        internal
        returns (FuelCore core, FuelMirror mirror, DeferredTestDiscoveryAdapter adapter)
    {
        adapter = new DeferredTestDiscoveryAdapter();
        DeferredRecoveryHarness recovery = new DeferredRecoveryHarness();
        core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(0xBEEF),
            recovery
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        mirror = core.mirror();
    }
}
