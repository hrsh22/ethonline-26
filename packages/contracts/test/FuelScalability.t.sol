// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {DeferredTestDiscoveryAdapter} from "../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {IDiscoveryAdapter} from "../src/interfaces/IDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

interface FuelGasSnapshotVm {
    function snapshotGasLastCall(string calldata group, string calldata name)
        external
        returns (uint256 gasUsed);
}

contract ScalabilityRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract ScalabilityFuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }

    function transferCollectible(FuelMirror mirror, address to, uint16 identityId) external {
        mirror.transferFrom(address(this), to, identityId);
    }
}

contract FuelScalabilityTest {
    FuelGasSnapshotVm private constant _VM =
        FuelGasSnapshotVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant _MAX_DISCOVERY_MUTATIONS = 64;
    uint256 private constant _MAX_SINGLE_IDENTITY_MUTATION_GAS = 350_000;

    function testRejectsAUserTransferThatWouldMaterializeMoreThanTheBoundedBatch() external {
        (FuelCore core,) = _deployImmediate();
        ScalabilityFuelActor holder = new ScalabilityFuelActor();

        (bool transferred,) = address(core)
            .call(
                abi.encodeCall(
                    FuelCore.transfer, (address(holder), (_MAX_DISCOVERY_MUTATIONS + 1) * 1 ether)
                )
            );

        require(!transferred, "unbounded discovery batch succeeded");
        require(core.balanceOf(address(holder)) == 0, "failed batch changed recipient balance");
        require(core.totalTransientCount() == 0, "failed batch materialized identities");
    }

    function testHighIndexTransientTransferHasBoundedGas() external {
        (FuelCore core, FuelMirror mirror) = _deployImmediate();
        ScalabilityFuelActor holder = new ScalabilityFuelActor();
        ScalabilityFuelActor recipient = new ScalabilityFuelActor();
        _fundInBoundedBatches(core, address(holder), 256);
        uint16 highIndexIdentity = core.transientIdentityAt(address(holder), 255);

        uint256 gasBefore = gasleft();
        holder.transferCollectible(mirror, address(recipient), highIndexIdentity);
        uint256 gasUsed = gasBefore - gasleft();
        _VM.snapshotGasLastCall("ownership", "high_index_transient_transfer");

        require(
            gasUsed < _MAX_SINGLE_IDENTITY_MUTATION_GAS,
            "transient transfer gas grows with wallet collection size"
        );
        require(mirror.ownerOf(highIndexIdentity) == address(recipient), "identity did not move");
    }

    function testHighIndexPendingFulfillmentHasBoundedGas() external {
        DeferredTestDiscoveryAdapter adapter = new DeferredTestDiscoveryAdapter();
        FuelCore core = _deploy(adapter);
        ScalabilityFuelActor holder = new ScalabilityFuelActor();
        _fundInBoundedBatches(core, address(holder), 256);
        bytes32 highIndexRequest = core.pendingDiscoveryAt(address(holder), 255);

        uint256 gasBefore = gasleft();
        require(adapter.fulfill(highIndexRequest, bytes32(uint256(999))), "fulfillment failed");
        uint256 gasUsed = gasBefore - gasleft();
        _VM.snapshotGasLastCall("ownership", "high_index_pending_fulfillment");

        require(
            gasUsed < _MAX_SINGLE_IDENTITY_MUTATION_GAS,
            "pending fulfillment gas grows with wallet discovery count"
        );
        require(core.pendingDiscoveryCount(address(holder)) == 255, "wrong pending count");
        require(core.transientCount(address(holder)) == 1, "identity was not materialized");
    }

    function testGasMaximumBoundedDiscoveryBatch() external {
        (FuelCore core,) = _deployImmediate();
        ScalabilityFuelActor holder = new ScalabilityFuelActor();

        require(
            core.transfer(address(holder), _MAX_DISCOVERY_MUTATIONS * 1 ether),
            "maximum bounded discovery batch failed"
        );
        _VM.snapshotGasLastCall("ownership", "maximum_64_identity_discovery_batch");

        require(core.transientCount(address(holder)) == 64, "maximum batch count drifted");
    }

    function testIndexedRemovalPreservesMostRecentTransientDissolutionOrder() external {
        (FuelCore core, FuelMirror mirror) = _deployImmediate();
        ScalabilityFuelActor holder = new ScalabilityFuelActor();
        ScalabilityFuelActor recipient = new ScalabilityFuelActor();
        require(core.transfer(address(holder), 3 ether), "holder funding failed");

        holder.transferCollectible(mirror, address(recipient), 101);
        holder.transferLiquid(core, address(this), 1 ether);

        require(mirror.ownerOf(101) == address(recipient), "selected identity did not move");
        require(mirror.ownerOf(102) == address(holder), "older remaining identity dissolved");
        require(
            core.identityState(103) == FuelCore.IdentityState.Available,
            "latest remaining identity did not dissolve"
        );
    }

    function testIndexedRemovalPreservesMostRecentPendingCancellationOrder() external {
        DeferredTestDiscoveryAdapter adapter = new DeferredTestDiscoveryAdapter();
        FuelCore core = _deploy(adapter);
        ScalabilityFuelActor holder = new ScalabilityFuelActor();
        require(core.transfer(address(holder), 3 ether), "holder funding failed");
        bytes32 first = core.pendingDiscoveryAt(address(holder), 0);
        bytes32 second = core.pendingDiscoveryAt(address(holder), 1);
        bytes32 latest = core.pendingDiscoveryAt(address(holder), 2);

        require(adapter.fulfill(first, bytes32(uint256(100))), "older fulfillment failed");
        holder.transferLiquid(core, address(this), 1 ether);

        require(core.pendingDiscoveryCount(address(holder)) == 1, "wrong pending remainder");
        require(
            core.pendingDiscoveryAt(address(holder), 0) == second,
            "most recent pending request was not cancelled"
        );
        require(
            !adapter.fulfill(latest, bytes32(uint256(200))), "cancelled latest request fulfilled"
        );
    }

    function _deployImmediate() private returns (FuelCore core, FuelMirror mirror) {
        core = _deploy(new DeterministicDiscoveryAdapter(bytes32(uint256(100))));
        mirror = core.mirror();
    }

    function _deploy(DeferredTestDiscoveryAdapter adapter) private returns (FuelCore core) {
        core = _deployAdapter(address(adapter));
    }

    function _deploy(DeterministicDiscoveryAdapter adapter) private returns (FuelCore core) {
        core = _deployAdapter(address(adapter));
    }

    function _deployAdapter(address adapter) private returns (FuelCore core) {
        core = new FuelCore(
            "Scalability Liquid Token",
            "SCALE",
            "Scalability Collectible",
            "SC",
            address(this),
            IDiscoveryAdapter(adapter),
            address(0xBEEF),
            new ScalabilityRecoveryHarness()
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(core))))
        );
        core.launch();
    }

    function _fundInBoundedBatches(FuelCore core, address recipient, uint256 wholeUnits) private {
        uint256 remaining = wholeUnits;
        while (remaining != 0) {
            uint256 batch =
                remaining > _MAX_DISCOVERY_MUTATIONS ? _MAX_DISCOVERY_MUTATIONS : remaining;
            require(core.transfer(recipient, batch * 1 ether), "bounded funding failed");
            remaining -= batch;
        }
    }
}
