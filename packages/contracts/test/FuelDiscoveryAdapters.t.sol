// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    VRFCoordinatorV2_5Mock
} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {QuotronDiscoveryAdapter} from "../src/discovery/QuotronDiscoveryAdapter.sol";
import {IDiscoveryAdapter} from "../src/interfaces/IDiscoveryAdapter.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";

contract VrfRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract VrfFuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }
}

contract FuelDiscoveryAdaptersTest {
    QuotronDiscoveryAdapter private _expectedAdapter;
    bytes32 private _fulfilledEntropy;
    bytes32 private _fulfilledRequestId;
    uint256 private _fulfillmentCount;
    bool private _rejectFulfillment;

    receive() external payable {}

    function testProductionRequestCannotRevealTheIdentityDuringWalletSimulation() external {
        (QuotronDiscoveryAdapter adapter,) = _configuredAdapter();

        IDiscoveryAdapter.DiscoveryResponse memory response =
            adapter.requestDiscovery(address(0xA11CE), 17, 1);

        require(!response.immediate, "request transaction exposed immediate discovery entropy");
        require(response.entropies.length == 0, "request transaction exposed discovery entropy");
        require(
            response.requestIds.length == 1 && response.requestIds[0] != bytes32(0),
            "deferred request has no opaque identifier"
        );
    }

    function testVerifiedCallbackStoresRandomnessUntilPermissionlessFinalization() external {
        (QuotronDiscoveryAdapter adapter, VRFCoordinatorV2_5Mock coordinator) = _configuredAdapter();
        _expectedAdapter = adapter;
        IDiscoveryAdapter.DiscoveryResponse memory response =
            adapter.requestDiscovery(address(0xA11CE), 17, 1);
        uint256[] memory words = new uint256[](1);
        words[0] = 59;

        coordinator.fulfillRandomWordsWithOverride(1, address(adapter), words);

        require(_fulfillmentCount == 0, "VRF callback performed application work");
        (
            QuotronDiscoveryAdapter.RequestState state,,
            uint256 fulfilledAt,
            uint256 count,
            uint256 finalizedCount,
        ) = adapter.requestStatus(1);
        require(
            state == QuotronDiscoveryAdapter.RequestState.Ready,
            "verified randomness was not made retryable"
        );
        require(fulfilledAt != 0, "fulfillment time was not recorded");
        require(count == 1 && finalizedCount == 0, "wrong ready request progress");

        adapter.finalizeDiscovery(1, 8);

        require(_fulfillmentCount == 1, "finalizer did not perform application work");
        require(_fulfilledRequestId == response.requestIds[0], "callback changed request identity");
        require(
            _fulfilledEntropy == keccak256(abi.encode(uint256(59), response.requestIds[0])),
            "finalizer did not bind derived entropy to the opaque request"
        );
        require(adapter.protocolRequestCount(1) == 0, "fulfilled request remained live");
    }

    function testSixtyFourDiscoveriesUseOneVrfRequestAndBoundedFinalization() external {
        (QuotronDiscoveryAdapter adapter,) = _configuredAdapter();

        IDiscoveryAdapter.DiscoveryResponse memory response =
            adapter.requestDiscovery(address(0xA11CE), 17, 64);

        require(response.requestIds.length == 64, "wrong protocol request count");
        require(adapter.protocolRequestCount(1) == 64, "acquisition was split across VRF requests");
        require(adapter.protocolRequestCount(2) == 0, "created an unnecessary VRF request");
    }

    function testCoordinatorCallbackCannotLoseRandomnessWhenFuelCoreWorkReverts() external {
        (QuotronDiscoveryAdapter adapter, VRFCoordinatorV2_5Mock coordinator) = _configuredAdapter();
        _expectedAdapter = adapter;
        adapter.requestDiscovery(address(0xA11CE), 17, 1);
        uint256[] memory words = new uint256[](1);
        words[0] = 59;
        _rejectFulfillment = true;

        coordinator.fulfillRandomWordsWithOverride(1, address(adapter), words);

        (QuotronDiscoveryAdapter.RequestState state,,,,,) = adapter.requestStatus(1);
        require(
            state == QuotronDiscoveryAdapter.RequestState.Ready,
            "callback lost randomness before retryable work"
        );
        (bool finalized,) =
            address(adapter).call(abi.encodeCall(QuotronDiscoveryAdapter.finalizeDiscovery, (1, 8)));
        require(!finalized, "failing application work unexpectedly finalized");
        (state,,,,,) = adapter.requestStatus(1);
        require(
            state == QuotronDiscoveryAdapter.RequestState.Ready, "failed retry consumed randomness"
        );

        _rejectFulfillment = false;
        adapter.finalizeDiscovery(1, 8);
        (state,,,,,) = adapter.requestStatus(1);
        require(
            state == QuotronDiscoveryAdapter.RequestState.Finalized,
            "recovered application work did not finalize"
        );
    }

    function testReadyRequestsCanOnlyFinalizeInAcquisitionOrder() external {
        (QuotronDiscoveryAdapter adapter, VRFCoordinatorV2_5Mock coordinator) = _configuredAdapter();
        _expectedAdapter = adapter;
        adapter.requestDiscovery(address(0xA11CE), 17, 1);
        adapter.requestDiscovery(address(0xB0B), 18, 1);
        uint256[] memory secondWord = new uint256[](1);
        secondWord[0] = 222;
        coordinator.fulfillRandomWordsWithOverride(2, address(adapter), secondWord);

        (bool outOfOrderFinalized,) =
            address(adapter).call(abi.encodeCall(QuotronDiscoveryAdapter.finalizeDiscovery, (2, 8)));

        require(!outOfOrderFinalized, "later randomness changed the pool before an earlier request");
        require(_fulfillmentCount == 0, "out-of-order request reached FuelCore");

        uint256[] memory firstWord = new uint256[](1);
        firstWord[0] = 111;
        coordinator.fulfillRandomWordsWithOverride(1, address(adapter), firstWord);
        adapter.finalizeDiscovery(1, 8);
        adapter.finalizeDiscovery(2, 8);

        require(_fulfillmentCount == 2, "ordered requests did not both finalize");
        require(adapter.nextFinalizationSequence() == 2, "finalization cursor did not advance");
    }

    function testFullyCancelledHeadCanBeSkippedWithoutRerollingRandomness() external {
        VRFCoordinatorV2_5Mock coordinator = new VRFCoordinatorV2_5Mock(0, 0, 1 ether);
        uint256 subscriptionId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 1 ether}(subscriptionId);
        QuotronDiscoveryAdapter adapter = new QuotronDiscoveryAdapter(
            address(coordinator), bytes32(uint256(1)), subscriptionId, 3, 200_000
        );
        coordinator.addConsumer(subscriptionId, address(adapter));
        FuelCore core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(0xBEEF),
            new VrfRecoveryHarness()
        );
        adapter.setFuelCore(address(core));
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.launch();
        VrfFuelActor firstRecipient = new VrfFuelActor();
        address secondRecipient = address(0xB0B);

        require(core.transfer(address(firstRecipient), 1 ether), "first acquisition failed");
        firstRecipient.transferLiquid(core, address(this), 1 ether);
        require(core.pendingDiscoveryCount(address(firstRecipient)) == 0, "request stayed active");

        adapter.skipCancelledDiscovery(1);

        require(adapter.nextFinalizationSequence() == 1, "cancelled head blocked the queue");
        require(core.transfer(secondRecipient, 1 ether), "second acquisition failed");
        uint256[] memory word = new uint256[](1);
        word[0] = 222;
        coordinator.fulfillRandomWordsWithOverride(2, address(adapter), word);
        adapter.finalizeDiscovery(2, 8);

        require(core.pendingDiscoveryCount(secondRecipient) == 0, "later request stayed pending");
        require(core.transientCount(secondRecipient) == 1, "later request did not materialize");
    }

    function testFifteenFuelAcquisitionUsesOneSeedAndTwoRetryableFinalizations() external {
        VRFCoordinatorV2_5Mock coordinator = new VRFCoordinatorV2_5Mock(0, 0, 1 ether);
        uint256 subscriptionId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 1 ether}(subscriptionId);
        QuotronDiscoveryAdapter adapter = new QuotronDiscoveryAdapter(
            address(coordinator), bytes32(uint256(1)), subscriptionId, 3, 200_000
        );
        coordinator.addConsumer(subscriptionId, address(adapter));
        FuelCore core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(0xBEEF),
            new VrfRecoveryHarness()
        );
        adapter.setFuelCore(address(core));
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.launch();
        address recipient = address(0xA11CE);

        require(core.transfer(recipient, 15 ether), "liquid acquisition failed");

        FuelMirror mirror = core.mirror();
        require(core.pendingDiscoveryCount(recipient) == 15, "requests were not recorded");
        require(core.transientCount(recipient) == 0, "acquisition revealed an identity");
        require(mirror.balanceOf(recipient) == 0, "acquisition transaction minted an NFT");

        uint256[] memory words = new uint256[](1);
        words[0] = 58;
        coordinator.fulfillRandomWordsWithOverride(1, address(adapter), words);

        require(core.pendingDiscoveryCount(recipient) == 15, "callback performed application work");
        require(core.transientCount(recipient) == 0, "callback minted a collectible");

        adapter.finalizeDiscovery(1, 8);

        require(core.pendingDiscoveryCount(recipient) == 7, "first chunk did not process eight");
        require(core.transientCount(recipient) == 8, "first chunk did not mint eight");
        adapter.finalizeDiscovery(1, 8);

        require(core.pendingDiscoveryCount(recipient) == 0, "finalization stayed pending");
        require(core.transientCount(recipient) == 15, "finalization did not assign identities");
        require(mirror.balanceOf(recipient) == 15, "finalization did not mint NFTs");
    }

    function fulfillDiscovery(bytes32 requestId, bytes32 entropy) external returns (bool) {
        require(msg.sender == address(_expectedAdapter), "unexpected discovery adapter");
        if (_rejectFulfillment) revert("receiver unavailable");
        ++_fulfillmentCount;
        _fulfilledRequestId = requestId;
        _fulfilledEntropy = entropy;
        return true;
    }

    function _configuredAdapter()
        private
        returns (QuotronDiscoveryAdapter adapter, VRFCoordinatorV2_5Mock coordinator)
    {
        coordinator = new VRFCoordinatorV2_5Mock(0, 0, 1 ether);
        uint256 subscriptionId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 1 ether}(subscriptionId);
        adapter = new QuotronDiscoveryAdapter(
            address(coordinator), bytes32(uint256(1)), subscriptionId, 3, 200_000
        );
        coordinator.addConsumer(subscriptionId, address(adapter));
        adapter.setFuelCore(address(this));
    }
}
