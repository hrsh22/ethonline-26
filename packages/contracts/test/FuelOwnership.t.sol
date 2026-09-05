// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICollectibleMetadata} from "../src/interfaces/ICollectibleMetadata.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

contract ThresholdRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract FuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }

    function transferLiquidFrom(FuelCore core, address from, address to, uint256 amount) external {
        require(core.transferFrom(from, to, amount), "delegated liquid transfer failed");
    }

    function approveCollectible(FuelMirror mirror, address operator, uint256 identityId) external {
        mirror.approve(operator, identityId);
    }

    function transferCollectible(FuelMirror mirror, address from, address to, uint256 identityId)
        external
    {
        mirror.transferFrom(from, to, identityId);
    }

    function commitIdentity(FuelCore core, uint16 identityId) external {
        core.commit(identityId);
    }
}

contract MetadataRendererHarness is ICollectibleMetadata {
    function tokenURI(uint16, bool permanent) external pure returns (string memory) {
        return permanent ? "metadata://permanent" : "metadata://transient";
    }
}

contract FuelOwnershipTest {
    function testDeploysCappedLiquidSupplyAndImmutableMirror() external {
        DeterministicDiscoveryAdapter adapter =
            new DeterministicDiscoveryAdapter(bytes32(uint256(100)));
        ThresholdRecoveryHarness recovery = new ThresholdRecoveryHarness();
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
        FuelMirror mirror = core.mirror();

        require(core.totalSupply() == 4_444 ether, "wrong total supply");
        require(core.balanceOf(address(this)) == 4_444 ether, "wrong initial balance");
        require(core.permanentCount() == 0, "unexpected permanent identity");
        require(core.isDiscoveryExempt(address(this)), "recipient must start exempt");
        require(address(mirror).code.length != 0, "mirror not deployed");
        require(mirror.core() == address(core), "mirror authority is mutable or wrong");
        require(mirror.supportsInterface(0x01ffc9a7), "ERC-165 interface missing");
        require(mirror.supportsInterface(0x80ac58cd), "ERC-721 interface missing");
        require(!mirror.supportsInterface(0xffffffff), "unknown interface reported");
    }

    function testWholeLiquidTransferDiscoversOneTransientIdentity() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        address recipient = address(0xA11CE);
        core.launch();

        require(core.transfer(recipient, 1 ether), "liquid transfer failed");

        require(core.balanceOf(recipient) == 1 ether, "wrong recipient balance");
        require(core.transientCount(recipient) == 1, "missing transient identity");
        require(core.pendingDiscoveryCount(recipient) == 0, "unexpected pending discovery");
        require(mirror.balanceOf(recipient) == 1, "wrong mirror balance");
        require(mirror.ownerOf(101) == recipient, "deterministic identity not assigned");
        require(
            core.identityState(101) == FuelCore.IdentityState.Transient, "identity is not transient"
        );
        require(core.availableIdentityCount() == 4_443, "available pool not reduced");
    }

    function testLosingWholeUnitDissolvesLatestTransientIdentity() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        FuelActor holder = new FuelActor();
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");

        holder.transferLiquid(core, address(this), 1 ether);

        require(core.transientCount(address(holder)) == 1, "wrong transient count");
        require(core.transientIdentityAt(address(holder), 0) == 101, "wrong identity remained");
        require(
            core.identityState(102) == FuelCore.IdentityState.Available,
            "latest identity did not return"
        );
        require(core.identityOwner(102) == address(0), "dissolved identity kept owner");
        require(core.availableIdentityCount() == 4_443, "identity did not return to pool");
        (bool ownerReadSucceeded,) = address(mirror).call(abi.encodeCall(FuelMirror.ownerOf, (102)));
        require(!ownerReadSucceeded, "dissolved identity still has ERC-721 owner");
    }

    function testErc20AllowanceTransferUsesTheSameDiscoveryStateMachine() external {
        (FuelCore core,) = _deploy();
        FuelActor spender = new FuelActor();
        address recipient = address(0xCAFE);
        core.launch();
        require(core.approve(address(spender), 2 ether), "approval failed");

        spender.transferLiquidFrom(core, address(this), recipient, 2 ether);

        require(core.allowance(address(this), address(spender)) == 0, "allowance not spent");
        require(core.balanceOf(recipient) == 2 ether, "wrong recipient balance");
        require(core.transientCount(recipient) == 2, "delegated transfer skipped discovery");
    }

    function testTransientMirrorTransferMovesExactlyOneLiquidUnitAndSelectedIdentity() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        FuelActor holder = new FuelActor();
        FuelActor operator = new FuelActor();
        address recipient = address(0xCAFE);
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");
        holder.approveCollectible(mirror, address(operator), 101);

        operator.transferCollectible(mirror, address(holder), recipient, 101);

        require(core.balanceOf(address(holder)) == 0, "sender kept liquid backing");
        require(core.balanceOf(recipient) == 1 ether, "recipient missed liquid backing");
        require(core.transientCount(address(holder)) == 0, "sender kept transient identity");
        require(core.transientCount(recipient) == 1, "recipient missed transient identity");
        require(mirror.ownerOf(101) == recipient, "selected identity did not move");
        require(mirror.getApproved(101) == address(0), "approval was not cleared");
        (bool staleTransferSucceeded,) = address(operator)
            .call(
                abi.encodeCall(
                    FuelActor.transferCollectible,
                    (mirror, recipient, address(0xD00D), uint256(101))
                )
            );
        require(!staleTransferSucceeded, "stale operator moved transient identity");
        require(mirror.ownerOf(101) == recipient, "stale attempt changed transient owner");
    }

    function testCommitmentBurnsBackingAndMakesSelectedIdentityPermanent() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        FuelActor holder = new FuelActor();
        FuelActor operator = new FuelActor();
        core.launch();
        require(core.transfer(address(holder), 2 ether), "liquid transfer failed");
        holder.approveCollectible(mirror, address(operator), 101);

        holder.commitIdentity(core, 101);

        require(core.balanceOf(address(holder)) == 1 ether, "Commitment did not burn backing");
        require(core.totalSupply() == 4_443 ether, "Commitment did not reduce supply");
        require(core.permanentCount() == 1, "permanent count not updated");
        require(
            core.identityState(101) == FuelCore.IdentityState.Permanent,
            "selected identity is not permanent"
        );
        require(core.transientCount(address(holder)) == 1, "wrong transient count");
        require(core.transientIdentityAt(address(holder), 0) == 102, "wrong identity remained");
        require(mirror.ownerOf(101) == address(holder), "permanent identity changed owner");
        require(mirror.getApproved(101) == address(0), "Commitment kept stale approval");
        (bool staleTransferSucceeded,) = address(operator)
            .call(
                abi.encodeCall(
                    FuelActor.transferCollectible,
                    (mirror, address(holder), address(0xCAFE), uint256(101))
                )
            );
        require(!staleTransferSucceeded, "stale operator moved committed identity");
        require(
            core.totalSupply() + uint256(core.permanentCount()) * 1 ether
                == core.MAX_LIQUID_SUPPLY(),
            "supply invariant broken"
        );

        holder.transferLiquid(core, address(this), 1 ether);
        require(mirror.ownerOf(101) == address(holder), "permanent identity dissolved");
        require(
            core.identityState(101) == FuelCore.IdentityState.Permanent, "permanent state changed"
        );
    }

    function testCommitmentRequiresConfiguredRewardLedger() external {
        DeterministicDiscoveryAdapter adapter =
            new DeterministicDiscoveryAdapter(bytes32(uint256(100)));
        ThresholdRecoveryHarness recovery = new ThresholdRecoveryHarness();
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
        _configureCanonicalMarket(core);
        FuelActor holder = new FuelActor();
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");

        (bool committed,) =
            address(holder).call(abi.encodeCall(FuelActor.commitIdentity, (core, uint16(101))));

        require(!committed, "Commitment skipped reward activation");
        require(core.totalSupply() == 4_444 ether, "failed Commitment burned backing");
        require(
            core.identityState(101) == FuelCore.IdentityState.Transient,
            "failed Commitment changed identity state"
        );
    }

    function testPermanentMirrorTransferMovesOnlyCollectibleAndClearsApproval() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        FuelActor holder = new FuelActor();
        FuelActor operator = new FuelActor();
        address recipient = address(0xCAFE);
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");
        holder.commitIdentity(core, 101);
        holder.approveCollectible(mirror, address(operator), 101);

        operator.transferCollectible(mirror, address(holder), recipient, 101);

        require(core.balanceOf(address(holder)) == 0, "permanent transfer changed sender liquid");
        require(core.balanceOf(recipient) == 0, "permanent transfer created recipient liquid");
        require(mirror.ownerOf(101) == recipient, "permanent identity did not move");
        require(mirror.balanceOf(address(holder)) == 0, "sender kept collectible balance");
        require(mirror.balanceOf(recipient) == 1, "recipient missed collectible balance");
        require(mirror.getApproved(101) == address(0), "permanent transfer kept approval");
        (bool staleTransferSucceeded,) = address(operator)
            .call(
                abi.encodeCall(
                    FuelActor.transferCollectible,
                    (mirror, recipient, address(0xD00D), uint256(101))
                )
            );
        require(!staleTransferSucceeded, "stale operator moved permanent identity");
        require(mirror.ownerOf(101) == recipient, "stale attempt changed permanent owner");
        require(
            core.identityState(101) == FuelCore.IdentityState.Permanent,
            "permanent transfer changed state"
        );
    }

    function testDirectTransientTransferToExemptAccountIsRejected() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        FuelActor holder = new FuelActor();
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");

        (bool succeeded,) = address(holder)
            .call(
                abi.encodeCall(
                    FuelActor.transferCollectible, (mirror, address(holder), address(this), 101)
                )
            );

        require(!succeeded, "transient collectible entered exempt account");
        require(mirror.ownerOf(101) == address(holder), "failed transfer changed owner");
        require(core.balanceOf(address(holder)) == 1 ether, "failed transfer changed backing");
    }

    function testCommitmentRejectsMissingForeignAndAlreadyPermanentIdentity() external {
        (FuelCore core,) = _deploy();
        FuelActor holder = new FuelActor();
        FuelActor stranger = new FuelActor();
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");

        (bool missingSucceeded,) =
            address(holder).call(abi.encodeCall(FuelActor.commitIdentity, (core, uint16(4_444))));
        (bool foreignSucceeded,) =
            address(stranger).call(abi.encodeCall(FuelActor.commitIdentity, (core, uint16(101))));
        holder.commitIdentity(core, 101);
        (bool repeatedSucceeded,) =
            address(holder).call(abi.encodeCall(FuelActor.commitIdentity, (core, uint16(101))));

        require(!missingSucceeded, "missing identity was committed");
        require(!foreignSucceeded, "foreign identity was committed");
        require(!repeatedSucceeded, "permanent identity was recommitted");
        require(core.permanentCount() == 1, "failed Commitment changed permanent count");
    }

    function testDissolvedIdentityCannotCarryApprovalIntoNewOwnershipEpoch() external {
        DeterministicDiscoveryAdapter adapter =
            new DeterministicDiscoveryAdapter(bytes32(uint256(4_442)));
        ThresholdRecoveryHarness recovery = new ThresholdRecoveryHarness();
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
        _configureCanonicalMarket(core);
        FuelMirror mirror = core.mirror();
        FuelActor firstOwner = new FuelActor();
        FuelActor staleOperator = new FuelActor();
        FuelActor newOwner = new FuelActor();
        core.launch();
        require(core.transfer(address(firstOwner), 1 ether), "first discovery failed");
        require(mirror.ownerOf(4_443) == address(firstOwner), "unexpected first identity");
        firstOwner.approveCollectible(mirror, address(staleOperator), 4_443);

        firstOwner.transferLiquid(core, address(this), 1 ether);
        require(core.transfer(address(newOwner), 1 ether), "second discovery failed");

        require(mirror.ownerOf(4_443) == address(newOwner), "identity was not rematerialized");
        require(mirror.getApproved(4_443) == address(0), "stale approval survived recycle");
        (bool staleTransferSucceeded,) = address(staleOperator)
            .call(
                abi.encodeCall(
                    FuelActor.transferCollectible,
                    (mirror, address(newOwner), address(0xCAFE), uint256(4_443))
                )
            );
        require(!staleTransferSucceeded, "stale operator moved new owner's identity");
        require(mirror.ownerOf(4_443) == address(newOwner), "stale attempt changed owner");
    }

    function testMirrorForwardsStateAwareMetadataAndFreezesRendererAtLaunch() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        MetadataRendererHarness renderer = new MetadataRendererHarness();
        FuelActor holder = new FuelActor();
        core.setMetadataRenderer(renderer);
        core.launch();
        require(core.transfer(address(holder), 1 ether), "liquid transfer failed");

        require(
            keccak256(bytes(mirror.tokenURI(101))) == keccak256(bytes("metadata://transient")),
            "transient metadata not forwarded"
        );
        holder.commitIdentity(core, 101);
        require(
            keccak256(bytes(mirror.tokenURI(101))) == keccak256(bytes("metadata://permanent")),
            "permanent metadata not forwarded"
        );
        require(mirror.supportsInterface(0x5b5e139f), "ERC-721 metadata interface missing");

        (bool rendererChanged,) = address(core)
            .call(abi.encodeCall(FuelCore.setMetadataRenderer, (ICollectibleMetadata(renderer))));
        require(!rendererChanged, "post-launch metadata renderer changed");
    }

    function _deploy() internal returns (FuelCore core, FuelMirror mirror) {
        DeterministicDiscoveryAdapter adapter =
            new DeterministicDiscoveryAdapter(bytes32(uint256(100)));
        ThresholdRecoveryHarness recovery = new ThresholdRecoveryHarness();
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
        _configureCanonicalMarket(core);
        core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(core))))
        );
        mirror = core.mirror();
    }

    function _configureCanonicalMarket(FuelCore core) private {
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
    }
}
