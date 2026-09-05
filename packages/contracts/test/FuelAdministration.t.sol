// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {IDiscoveryAdapter} from "../src/interfaces/IDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

contract RecoveryAuthorityHarness is IThresholdRecovery {
    uint256 private immutable _threshold;

    constructor(uint256 threshold_) {
        _threshold = threshold_;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function setFrozen(FuelCore core, address account, bool frozen) external {
        core.setFrozen(account, frozen);
    }

    function recoverLiquid(FuelCore core, address from, address to, uint256 amount) external {
        core.recoverLiquid(from, to, amount);
    }

    function recoverCollectible(FuelCore core, address from, address to, uint16 identityId)
        external
    {
        core.recoverCollectible(from, to, identityId);
    }
}

contract GuardianHarness {
    function freeze(FuelCore core, address account) external {
        core.guardianFreeze(account);
    }
}

contract AdminFuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }

    function transferLiquidFrom(FuelCore core, address from, address to, uint256 amount) external {
        require(core.transferFrom(from, to, amount), "delegated liquid transfer failed");
    }

    function approveLiquid(FuelCore core, address spender, uint256 amount) external {
        require(core.approve(spender, amount), "liquid approval failed");
    }

    function approveCollectible(FuelMirror mirror, address spender, uint256 identityId) external {
        mirror.approve(spender, identityId);
    }

    function setCollectibleApprovalForAll(FuelMirror mirror, address operator, bool approved)
        external
    {
        mirror.setApprovalForAll(operator, approved);
    }

    function transferCollectible(FuelMirror mirror, address from, address to, uint256 identityId)
        external
    {
        mirror.transferFrom(from, to, identityId);
    }

    function commitIdentity(FuelCore core, uint16 identityId) external {
        core.commit(identityId);
    }

    function setPaused(FuelCore core, bool paused) external {
        core.setPaused(paused);
    }

    function acceptOwnership(FuelCore core) external {
        core.acceptOwnership();
    }
}

contract VenueHarness {
    function moveLiquid(FuelCore core, address from, address to, uint256 amount) external {
        require(core.transferFrom(from, to, amount), "venue transfer failed");
    }

    function approveCollectible(FuelMirror mirror, address operator, uint256 identityId) external {
        mirror.approve(operator, identityId);
    }
}

contract FuelAdministrationTest {
    function testSetupConfigurationFreezesAtLaunchAndRequiresThresholdRecovery() external {
        (FuelCore core,,,) = _deploy(2);
        address setupAccount = address(0x5151);
        DeterministicDiscoveryAdapter replacement =
            new DeterministicDiscoveryAdapter(bytes32(uint256(200)));
        core.setDiscoveryExempt(setupAccount, true);
        core.setProtectedAccount(setupAccount, true);
        core.setBlockedVenueCodehash(bytes32(uint256(1)), true);
        core.setDiscoveryAdapter(replacement);
        core.launch();

        require(core.isDiscoveryExempt(setupAccount), "setup exemption missing");
        require(core.isProtectedAccount(setupAccount), "protected account missing");
        require(address(core.discoveryAdapter()) == address(replacement), "adapter not configured");
        (bool exemptionChanged,) =
            address(core).call(abi.encodeCall(FuelCore.setDiscoveryExempt, (setupAccount, false)));
        (bool protectionChanged,) =
            address(core).call(abi.encodeCall(FuelCore.setProtectedAccount, (setupAccount, false)));
        (bool adapterChanged,) = address(core)
            .call(
                abi.encodeCall(
                    FuelCore.setDiscoveryAdapter,
                    (IDiscoveryAdapter(new DeterministicDiscoveryAdapter(bytes32(uint256(300)))))
                )
            );
        (bool venueConfigurationChanged,) = address(core)
            .call(abi.encodeCall(FuelCore.setBlockedVenueCodehash, (bytes32(uint256(2)), true)));
        require(!exemptionChanged, "post-launch exemption changed");
        require(!protectionChanged, "post-launch protection changed");
        require(!adapterChanged, "post-launch adapter changed");
        require(!venueConfigurationChanged, "post-launch venue configuration changed");

        (FuelCore weakCore,,,) = _deploy(1);
        (bool weakLaunchSucceeded,) = address(weakCore).call(abi.encodeCall(FuelCore.launch, ()));
        require(!weakLaunchSucceeded, "threshold-one recovery launched");
    }

    function testOwnerPauseGuardianFreezeAndRecoveryUnfreeze() external {
        (FuelCore core,, RecoveryAuthorityHarness recovery, GuardianHarness guardian) = _deploy(2);
        AdminFuelActor holder = new AdminFuelActor();
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");

        core.setPaused(true);
        (bool pausedTransferSucceeded,) = address(holder)
            .call(abi.encodeCall(AdminFuelActor.transferLiquid, (core, address(this), 1 ether)));
        require(!pausedTransferSucceeded, "paused transfer succeeded");
        core.setPaused(false);

        guardian.freeze(core, address(holder));
        (bool frozenTransferSucceeded,) = address(holder)
            .call(abi.encodeCall(AdminFuelActor.transferLiquid, (core, address(this), 1 ether)));
        require(!frozenTransferSucceeded, "frozen transfer succeeded");
        recovery.setFrozen(core, address(holder), false);
        holder.transferLiquid(core, address(this), 1 ether);
    }

    function testRecoveryMovesLiquidAndBothCollectibleModesWithoutStaleApprovals() external {
        (FuelCore core, FuelMirror mirror, RecoveryAuthorityHarness recovery,) = _deploy(2);
        AdminFuelActor holder = new AdminFuelActor();
        AdminFuelActor staleOperator = new AdminFuelActor();
        address transientRecipient = address(0xCAFE);
        address permanentRecipient = address(0xB0B);
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");

        holder.approveCollectible(mirror, address(staleOperator), 101);
        recovery.recoverCollectible(core, address(holder), transientRecipient, 101);
        require(core.balanceOf(transientRecipient) == 1 ether, "recovery missed backing");
        require(mirror.ownerOf(101) == transientRecipient, "transient recovery missed identity");
        require(mirror.getApproved(101) == address(0), "transient recovery kept approval");
        (bool staleTransientTransferSucceeded,) = address(staleOperator)
            .call(
                abi.encodeCall(
                    AdminFuelActor.transferCollectible,
                    (mirror, transientRecipient, address(0xD00D), uint256(101))
                )
            );
        require(!staleTransientTransferSucceeded, "stale operator moved recovered transient");

        holder.commitIdentity(core, 102);
        holder.approveCollectible(mirror, address(staleOperator), 102);
        recovery.recoverCollectible(core, address(holder), permanentRecipient, 102);
        require(core.balanceOf(permanentRecipient) == 0, "permanent recovery moved liquid");
        require(mirror.ownerOf(102) == permanentRecipient, "permanent recovery missed identity");
        require(mirror.getApproved(102) == address(0), "permanent recovery kept approval");
        (bool stalePermanentTransferSucceeded,) = address(staleOperator)
            .call(
                abi.encodeCall(
                    AdminFuelActor.transferCollectible,
                    (mirror, permanentRecipient, address(0xD00D), uint256(102))
                )
            );
        require(!stalePermanentTransferSucceeded, "stale operator moved recovered permanent");

        recovery.recoverLiquid(core, transientRecipient, address(holder), 1 ether);
        require(core.balanceOf(address(holder)) == 1 ether, "liquid recovery failed");
        require(core.transientCount(address(holder)) == 1, "liquid recovery missed discovery");
    }

    function testProtectedRecoveryEndpointsAndBlockedVenueCodehashAreRejected() external {
        (FuelCore core,, RecoveryAuthorityHarness recovery,) = _deploy(2);
        AdminFuelActor holder = new AdminFuelActor();
        AdminFuelActor ordinaryOperator = new AdminFuelActor();
        VenueHarness venue = new VenueHarness();
        address protectedAccount = address(0x5151);
        address recipient = address(0xCAFE);
        core.setProtectedAccount(protectedAccount, true);
        holder.approveLiquid(core, address(venue), 1 ether);
        core.setBlockedVenueCodehash(address(venue).codehash, true);
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");

        (bool protectedRecoverySucceeded,) = address(recovery)
            .call(
                abi.encodeCall(
                    RecoveryAuthorityHarness.recoverLiquid,
                    (core, address(holder), protectedAccount, 1 ether)
                )
            );
        require(!protectedRecoverySucceeded, "recovery used protected endpoint");

        (bool venueSucceeded,) = address(venue)
            .call(
                abi.encodeCall(VenueHarness.moveLiquid, (core, address(holder), recipient, 1 ether))
            );
        require(!venueSucceeded, "blocked venue moved liquid");

        holder.approveLiquid(core, address(ordinaryOperator), 1 ether);
        ordinaryOperator.transferLiquidFrom(core, address(holder), recipient, 1 ether);
        require(core.balanceOf(recipient) == 1 ether, "ordinary wallet transfer was blocked");
    }

    function testOwnershipTransferHandsOffOwnerControls() external {
        (FuelCore core,,,) = _deploy(2);
        AdminFuelActor nextOwner = new AdminFuelActor();
        core.transferOwnership(address(nextOwner));

        // Nomination alone moves nothing. FuelCore holds launch, pause,
        // discovery, and blocklist authority, so a single-step transfer to a
        // mistyped address would forfeit all of it irrecoverably.
        require(core.owner() == address(this), "nomination moved ownership");
        require(core.pendingOwner() == address(nextOwner), "nomination was not recorded");
        (bool nomineeSucceeded,) =
            address(nextOwner).call(abi.encodeCall(AdminFuelActor.setPaused, (core, true)));
        require(!nomineeSucceeded, "nominee acted before accepting");

        nextOwner.acceptOwnership(core);
        require(core.owner() == address(nextOwner), "acceptance did not move ownership");
        require(core.pendingOwner() == address(0), "acceptance left a nomination pending");

        (bool oldOwnerSucceeded,) = address(core).call(abi.encodeCall(FuelCore.setPaused, (true)));
        require(!oldOwnerSucceeded, "old owner retained control");
        nextOwner.setPaused(core, true);
        require(core.paused(), "new owner did not receive control");
    }

    function testFrozenAndBlockedOperatorsCannotDelegateCollectibleApproval() external {
        (
            FuelCore core,
            FuelMirror mirror,
            RecoveryAuthorityHarness recovery,
            GuardianHarness guardian
        ) = _deploy(2);
        AdminFuelActor holder = new AdminFuelActor();
        AdminFuelActor frozenOperator = new AdminFuelActor();
        AdminFuelActor cleanOperator = new AdminFuelActor();
        VenueHarness blockedOperator = new VenueHarness();
        holder.setCollectibleApprovalForAll(mirror, address(frozenOperator), true);
        holder.setCollectibleApprovalForAll(mirror, address(blockedOperator), true);
        core.setBlockedVenueCodehash(address(blockedOperator).codehash, true);
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");

        guardian.freeze(core, address(frozenOperator));
        (bool frozenDelegationSucceeded,) = address(frozenOperator)
            .call(
                abi.encodeCall(
                    AdminFuelActor.approveCollectible,
                    (mirror, address(cleanOperator), uint256(101))
                )
            );
        require(!frozenDelegationSucceeded, "frozen operator delegated approval");
        require(mirror.getApproved(101) == address(0), "frozen delegation changed approval");

        (bool blockedDelegationSucceeded,) = address(blockedOperator)
            .call(
                abi.encodeCall(
                    VenueHarness.approveCollectible, (mirror, address(cleanOperator), uint256(102))
                )
            );
        require(!blockedDelegationSucceeded, "blocked operator delegated approval");
        require(mirror.getApproved(102) == address(0), "blocked delegation changed approval");

        recovery.setFrozen(core, address(frozenOperator), false);
    }

    function _deploy(uint256 threshold)
        internal
        returns (
            FuelCore core,
            FuelMirror mirror,
            RecoveryAuthorityHarness recovery,
            GuardianHarness guardian
        )
    {
        DeterministicDiscoveryAdapter adapter = new DeterministicDiscoveryAdapter(
            bytes32(uint256(100))
        );
        recovery = new RecoveryAuthorityHarness(threshold);
        guardian = new GuardianHarness();
        core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(guardian),
            recovery
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(core))))
        );
        mirror = core.mirror();
    }
}
