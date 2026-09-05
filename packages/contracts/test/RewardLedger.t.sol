// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {ConfigurableClaimGate} from "../src/claim/ConfigurableClaimGate.sol";
import {DeferredTestDiscoveryAdapter} from "../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";

interface RewardLedgerVm {
    function readFileBinary(string calldata path) external view returns (bytes memory data);

    function snapshotGasLastCall(string calldata group, string calldata name)
        external
        returns (uint256 gasUsed);
}

contract RewardLedgerRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract RewardHolder {
    function commit(FuelCore core, uint16 identityId) external {
        core.commit(identityId);
    }

    function transferCollectible(FuelMirror mirror, address from, address to, uint16 identityId)
        external
    {
        mirror.transferFrom(from, to, identityId);
    }

    function claim(RewardLedger ledger, uint16[] calldata identityIds) external {
        ledger.claim(identityIds);
    }
}

contract RewardLedgerOutsider {
    function activate(RewardLedger ledger, uint16 identityId) external {
        ledger.activate(identityId);
    }

    function checkpointBeforeTransfer(RewardLedger ledger, uint16 identityId) external {
        ledger.checkpointBeforeTransfer(identityId);
    }

    function checkpointAfterTransfer(RewardLedger ledger, uint16 identityId) external {
        ledger.checkpointAfterTransfer(identityId);
    }

    function notifyReward(
        RewardLedger ledger,
        AttributeRegistry.RewardTrack track,
        address token,
        uint256 amount
    ) external {
        ledger.notifyReward(track, token, amount);
    }
}

contract RewardLedgerTest {
    RewardLedgerVm internal constant VM =
        RewardLedgerVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 internal constant MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;
    uint256 internal constant NOTIFICATION = 120_000;

    AttributeRegistry internal registry;
    ConfigurableClaimGate internal claimGate;
    DeferredTestDiscoveryAdapter internal discoveryAdapter;
    FuelCore internal core;
    FuelMirror internal mirror;
    MockStock[4] internal stocks;
    RewardLedger internal ledger;

    function setUp() external {
        registry = _deployRegistry();
        claimGate = new ConfigurableClaimGate(address(this));
        discoveryAdapter = new DeferredTestDiscoveryAdapter();
        RewardLedgerRecoveryHarness recovery = new RewardLedgerRecoveryHarness();
        core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            discoveryAdapter,
            address(0xBEEF),
            recovery
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        mirror = core.mirror();

        stocks[0] = new MockStock(
            "AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", 1_000_000_000 ether, address(this)
        );
        stocks[1] = new MockStock(
            "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", 1_000_000_000 ether, address(this)
        );
        stocks[2] = new MockStock(
            "METAc MOCK TEST Stock", "MOCK-METAc-TEST", 1_000_000_000 ether, address(this)
        );
        stocks[3] = new MockStock(
            "NVDAc MOCK TEST Stock", "MOCK-NVDAc-TEST", 1_000_000_000 ether, address(this)
        );
        address[4] memory rewardTokens =
            [address(stocks[0]), address(stocks[1]), address(stocks[2]), address(stocks[3])];
        ledger = new RewardLedger(address(core), registry, rewardTokens, claimGate, address(this));
        ledger.sealEpochConverter(address(this));
        core.setRewardLedger(IRewardLedgerCallbacks(address(ledger)));
        core.launch();
    }

    function testFirstOrdinaryCommitmentReceivesUnclaimedTrackPotExactlyOnce() external {
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, NOTIFICATION);
        require(
            ledger.unclaimedTrackPot(AttributeRegistry.RewardTrack.AAPLc) == 99_000,
            "ordinary allocation did not enter the track pot"
        );

        uint16 firstIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 0
        );
        uint16 secondIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 1
        );
        RewardHolder firstHolder = new RewardHolder();
        _discoverAndCommit(firstHolder, _singleIdentity(firstIdentity));

        require(
            ledger.pending(firstIdentity, AttributeRegistry.RewardTrack.AAPLc) == 99_000,
            "first identity missed the track pot"
        );
        require(
            ledger.unclaimedTrackPot(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "credited track pot was not cleared"
        );

        RewardHolder secondHolder = new RewardHolder();
        _discoverAndCommit(secondHolder, _singleIdentity(secondIdentity));

        require(
            ledger.pending(firstIdentity, AttributeRegistry.RewardTrack.AAPLc) == 99_000,
            "first identity's one-time credit changed"
        );
        require(
            ledger.pending(secondIdentity, AttributeRegistry.RewardTrack.AAPLc) == 0,
            "second identity received the prior track pot"
        );
    }

    function testActivationBetweenNotificationsNeverOverCreditsFractionalEntryDebt() external {
        uint16 tierOneIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 0
        );
        uint16 firstTierTwoIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.II, 0
        );
        uint16 secondTierTwoIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.II, 1
        );
        RewardHolder firstHolder = new RewardHolder();
        RewardHolder laterHolder = new RewardHolder();
        _discoverAndCommit(firstHolder, _singleIdentity(tierOneIdentity));
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 2);

        uint16[] memory laterIdentities = new uint16[](2);
        laterIdentities[0] = firstTierTwoIdentity;
        laterIdentities[1] = secondTierTwoIdentity;
        _discoverAndCommit(laterHolder, laterIdentities);
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 5);

        uint256 totalOrdinaryPending = ledger.pending(
            tierOneIdentity, AttributeRegistry.RewardTrack.AAPLc
        ) + ledger.pending(firstTierTwoIdentity, AttributeRegistry.RewardTrack.AAPLc)
        + ledger.pending(secondTierTwoIdentity, AttributeRegistry.RewardTrack.AAPLc);
        require(totalOrdinaryPending <= 5, "fractional entry debt over-credited rewards");
        require(
            totalOrdinaryPending + ledger.pending(4_441, AttributeRegistry.RewardTrack.AAPLc)
                    + ledger.pending(4_442, AttributeRegistry.RewardTrack.AAPLc)
                    + ledger.pending(4_443, AttributeRegistry.RewardTrack.AAPLc)
                    + ledger.pending(4_444, AttributeRegistry.RewardTrack.AAPLc)
                <= ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc),
            "claimable rewards exceeded the funded liability"
        );

        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 5);
        totalOrdinaryPending = ledger.pending(tierOneIdentity, AttributeRegistry.RewardTrack.AAPLc)
            + ledger.pending(firstTierTwoIdentity, AttributeRegistry.RewardTrack.AAPLc)
            + ledger.pending(secondTierTwoIdentity, AttributeRegistry.RewardTrack.AAPLc);
        require(totalOrdinaryPending == 9, "carried fractional rewards were lost");
    }

    function testOrdinaryAllocationAssignsEveryIndivisibleUnitDeterministically() external {
        uint16 firstIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 0
        );
        uint16 secondIdentity = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 1
        );
        uint16[] memory identityIds = new uint16[](2);
        identityIds[0] = firstIdentity;
        identityIds[1] = secondIdentity;
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, identityIds);

        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 200);

        require(
            ledger.pending(firstIdentity, AttributeRegistry.RewardTrack.AAPLc) == 83,
            "first active identity did not receive the deterministic remainder"
        );
        require(
            ledger.pending(secondIdentity, AttributeRegistry.RewardTrack.AAPLc) == 82,
            "equal-weight identity received the wrong base allocation"
        );

        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, identityIds);
        require(stocks[0].balanceOf(address(holder)) == 165, "ordinary remainder was not claimable");
    }

    function testBasketRelicRemaindersRotateAcrossNotifications() external {
        for (uint256 index = 0; index < 3; ++index) {
            _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 8);
        }

        require(
            ledger.pending(4_441, AttributeRegistry.RewardTrack.AAPLc) == 1,
            "first Basket Relic missed its rotating remainder"
        );
        require(
            ledger.pending(4_442, AttributeRegistry.RewardTrack.AAPLc) == 1,
            "second Basket Relic missed its rotating remainder"
        );
        require(
            ledger.pending(4_443, AttributeRegistry.RewardTrack.AAPLc) == 1,
            "third Basket Relic missed its rotating remainder"
        );
    }

    function testAllocatesExactValuesAcrossEveryTierTrackAndRelicKind() external {
        uint16[] memory ordinaryIdentities = new uint16[](16);
        uint256 identityIndex;
        for (uint8 trackCode = 1; trackCode <= 4; ++trackCode) {
            for (uint8 tierCode = 1; tierCode <= 4; ++tierCode) {
                ordinaryIdentities[identityIndex++] = _ordinaryIdentity(
                    AttributeRegistry.RewardTrack(trackCode),
                    AttributeRegistry.RarityTier(tierCode),
                    0
                );
            }
        }
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, ordinaryIdentities);

        uint256[4] memory expectedTierRewards =
            [uint256(9_900), uint256(14_850), uint256(24_750), uint256(49_500)];
        identityIndex = 0;
        for (uint8 trackCode = 1; trackCode <= 4; ++trackCode) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackCode);
            _notify(track, trackCode - 1, NOTIFICATION);

            require(ledger.totalActiveWeight(track) == 1_000, "wrong live tier weight");
            for (uint8 tierIndex = 0; tierIndex < 4; ++tierIndex) {
                require(
                    ledger.pending(ordinaryIdentities[identityIndex++], track)
                        == expectedTierRewards[tierIndex],
                    "wrong tier allocation"
                );
            }
            require(ledger.pending(4_441, track) == 5_000, "first Basket Relic allocation wrong");
            require(ledger.pending(4_442, track) == 5_000, "second Basket Relic allocation wrong");
            require(ledger.pending(4_443, track) == 5_000, "third Basket Relic allocation wrong");
            require(ledger.pending(4_444, track) == 6_000, "Indicator Relic allocation wrong");
            require(ledger.totalLiability(track) == NOTIFICATION, "track liability drifted");
            require(
                stocks[trackCode - 1].balanceOf(address(ledger)) == NOTIFICATION,
                "track token balance drifted"
            );
        }
    }

    function testPendingRewardsFollowIdentityAndOnlyCurrentOwnerCanClaimAfterTransfers() external {
        uint16 identityId = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.GOOGLc, AttributeRegistry.RarityTier.I, 0
        );
        RewardHolder firstOwner = new RewardHolder();
        RewardHolder secondOwner = new RewardHolder();
        RewardHolder currentOwner = new RewardHolder();
        _discoverAndCommit(firstOwner, _singleIdentity(identityId));
        _notify(AttributeRegistry.RewardTrack.GOOGLc, 1, NOTIFICATION);

        firstOwner.transferCollectible(
            mirror, address(firstOwner), address(secondOwner), identityId
        );
        secondOwner.transferCollectible(
            mirror, address(secondOwner), address(currentOwner), identityId
        );

        require(mirror.ownerOf(identityId) == address(currentOwner), "identity owner did not move");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.GOOGLc) == 99_000,
            "pending reward did not follow identity"
        );

        uint16[] memory identityIds = _singleIdentity(identityId);
        claimGate.setClaimAllowed(address(firstOwner), true);
        (bool previousOwnerClaimed,) =
            address(firstOwner).call(abi.encodeCall(RewardHolder.claim, (ledger, identityIds)));
        require(!previousOwnerClaimed, "previous owner claimed transferred rewards");

        claimGate.setClaimAllowed(address(currentOwner), true);
        currentOwner.claim(ledger, identityIds);

        require(stocks[1].balanceOf(address(currentOwner)) == 99_000, "current owner was not paid");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.GOOGLc) == 0,
            "claimed reward remained pending"
        );
        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.GOOGLc) == 21_000,
            "claim reduced the wrong liability"
        );
    }

    function testDeniedClaimChangesNoDebtOrBalancesAndSucceedsAfterApproval() external {
        uint16 identityId = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.METAc, AttributeRegistry.RarityTier.III, 0
        );
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, _singleIdentity(identityId));
        _notify(AttributeRegistry.RewardTrack.METAc, 2, NOTIFICATION);

        uint16[] memory identityIds = _singleIdentity(identityId);
        uint256 debtBefore = ledger.ordinaryRewardDebt(identityId);
        uint256 pendingBefore = ledger.pending(identityId, AttributeRegistry.RewardTrack.METAc);
        uint256 liabilityBefore = ledger.totalLiability(AttributeRegistry.RewardTrack.METAc);
        uint256 ledgerBalanceBefore = stocks[2].balanceOf(address(ledger));
        (bool denied,) =
            address(holder).call(abi.encodeCall(RewardHolder.claim, (ledger, identityIds)));

        require(!denied, "denied owner claimed");
        require(ledger.ordinaryRewardDebt(identityId) == debtBefore, "denial changed reward debt");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.METAc) == pendingBefore,
            "denial changed pending rewards"
        );
        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.METAc) == liabilityBefore,
            "denial changed liabilities"
        );
        require(
            stocks[2].balanceOf(address(ledger)) == ledgerBalanceBefore,
            "denial changed ledger token balance"
        );
        require(stocks[2].balanceOf(address(holder)) == 0, "denial paid the owner");

        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, identityIds);

        require(stocks[2].balanceOf(address(holder)) == pendingBefore, "approved retry failed");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.METAc) == 0,
            "approved retry left rewards pending"
        );
    }

    function testRelicPotsAccruedBeforeCommitmentBecomeClaimableOnlyAfterCommitment() external {
        _notify(AttributeRegistry.RewardTrack.NVDAc, 3, NOTIFICATION);

        require(
            ledger.pending(4_441, AttributeRegistry.RewardTrack.NVDAc) == 5_000,
            "first Basket Relic pot missing"
        );
        require(
            ledger.pending(4_442, AttributeRegistry.RewardTrack.NVDAc) == 5_000,
            "second Basket Relic pot missing"
        );
        require(
            ledger.pending(4_443, AttributeRegistry.RewardTrack.NVDAc) == 5_000,
            "third Basket Relic pot missing"
        );
        require(
            ledger.pending(4_444, AttributeRegistry.RewardTrack.NVDAc) == 6_000,
            "Indicator Relic pot missing"
        );

        RewardHolder holder = new RewardHolder();
        uint16[] memory relicIds = new uint16[](4);
        relicIds[0] = 4_444;
        relicIds[1] = 4_443;
        relicIds[2] = 4_442;
        relicIds[3] = 4_441;
        claimGate.setClaimAllowed(address(holder), true);
        (bool preCommitClaimed,) =
            address(holder).call(abi.encodeCall(RewardHolder.claim, (ledger, relicIds)));
        require(!preCommitClaimed, "uncommitted Relics were claimable");

        _discoverAndCommit(holder, relicIds);
        holder.claim(ledger, relicIds);

        require(stocks[3].balanceOf(address(holder)) == 21_000, "Relic owner received wrong total");
        for (uint256 index = 0; index < relicIds.length; ++index) {
            require(
                ledger.pending(relicIds[index], AttributeRegistry.RewardTrack.NVDAc) == 0,
                "claimed Relic pot remained pending"
            );
        }
    }

    function testPausingNewNotificationsDoesNotPauseClaims() external {
        uint16 identityId = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.II, 0
        );
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, _singleIdentity(identityId));
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, NOTIFICATION);
        ledger.setRewardNotificationsPaused(true);

        (bool notificationSucceeded,) = address(ledger)
            .call(
                abi.encodeCall(
                    RewardLedger.notifyReward,
                    (AttributeRegistry.RewardTrack.AAPLc, address(stocks[0]), uint256(1))
                )
            );
        require(!notificationSucceeded, "paused ledger accepted a notification");

        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, _singleIdentity(identityId));

        require(stocks[0].balanceOf(address(holder)) == 99_000, "pause blocked an existing claim");
    }

    function testPrivilegedCallbacksRejectEveryUnauthorizedCaller() external {
        RewardLedgerOutsider outsider = new RewardLedgerOutsider();

        (bool activationSucceeded,) =
            address(outsider).call(abi.encodeCall(RewardLedgerOutsider.activate, (ledger, 1)));
        (bool beforeCheckpointSucceeded,) = address(outsider)
            .call(abi.encodeCall(RewardLedgerOutsider.checkpointBeforeTransfer, (ledger, 1)));
        (bool afterCheckpointSucceeded,) = address(outsider)
            .call(abi.encodeCall(RewardLedgerOutsider.checkpointAfterTransfer, (ledger, 1)));
        (bool notificationSucceeded,) = address(outsider)
            .call(
                abi.encodeCall(
                    RewardLedgerOutsider.notifyReward,
                    (ledger, AttributeRegistry.RewardTrack.AAPLc, address(stocks[0]), uint256(1))
                )
            );

        require(!activationSucceeded, "non-FuelCore caller activated an identity");
        require(!beforeCheckpointSucceeded, "non-FuelCore caller checkpointed before transfer");
        require(!afterCheckpointSucceeded, "non-FuelCore caller checkpointed after transfer");
        require(!notificationSucceeded, "non-converter caller notified a reward");
    }

    function testNotificationsRequireConfiguredTrackTokenAndReceivedBalance() external {
        (bool wrongTokenSucceeded,) = address(ledger)
            .call(
                abi.encodeCall(
                    RewardLedger.notifyReward,
                    (AttributeRegistry.RewardTrack.AAPLc, address(stocks[1]), uint256(1))
                )
            );
        (bool unfundedSucceeded,) = address(ledger)
            .call(
                abi.encodeCall(
                    RewardLedger.notifyReward,
                    (AttributeRegistry.RewardTrack.AAPLc, address(stocks[0]), uint256(1))
                )
            );

        require(!wrongTokenSucceeded, "track accepted another track's token");
        require(!unfundedSucceeded, "converter notified tokens the ledger did not receive");
        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "failed notification changed AAPLc liability"
        );
        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.GOOGLc) == 0,
            "failed notification contaminated GOOGLc liability"
        );
    }

    function testEpochConverterAndFuelCoreBindingAreSealed() external {
        RewardLedgerOutsider replacement = new RewardLedgerOutsider();
        (bool converterChanged,) = address(ledger)
            .call(abi.encodeCall(RewardLedger.sealEpochConverter, (address(replacement))));
        (bool ledgerChanged,) = address(core)
            .call(
                abi.encodeCall(FuelCore.setRewardLedger, (IRewardLedgerCallbacks(address(ledger))))
            );

        require(!converterChanged, "sealed EpochConverter changed");
        require(!ledgerChanged, "post-launch RewardLedger binding changed");
        require(ledger.epochConverter() == address(this), "EpochConverter binding drifted");
        require(address(core.rewardLedger()) == address(ledger), "FuelCore binding drifted");
    }

    function testRejectsAClaimBatchThatCouldLoopOverTheFullPermanentCollection() external {
        RewardHolder holder = new RewardHolder();
        uint16[] memory firstBatch = new uint16[](64);
        for (uint16 identityId = 1; identityId <= 64; ++identityId) {
            firstBatch[identityId - 1] = identityId;
        }
        _discoverAndCommit(holder, firstBatch);
        _discoverAndCommit(holder, _singleIdentity(65));

        uint16[] memory oversizedClaim = new uint16[](65);
        for (uint16 identityId = 1; identityId <= 65; ++identityId) {
            oversizedClaim[identityId - 1] = identityId;
        }
        claimGate.setClaimAllowed(address(holder), true);

        (bool claimed,) =
            address(holder).call(abi.encodeCall(RewardHolder.claim, (ledger, oversizedClaim)));

        require(!claimed, "unbounded permanent-identity claim batch succeeded");
    }

    function testGasMaximumBoundedPermanentIdentityClaim() external {
        RewardHolder holder = new RewardHolder();
        uint16[] memory identityIds = new uint16[](64);
        for (uint16 identityId = 1; identityId <= 64; ++identityId) {
            identityIds[identityId - 1] = identityId;
        }
        _discoverAndCommit(holder, identityIds);
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 1 ether);
        claimGate.setClaimAllowed(address(holder), true);

        holder.claim(ledger, identityIds);
        VM.snapshotGasLastCall("rewards", "maximum_64_identity_claim");

        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc)
                <= stocks[0].balanceOf(address(ledger)),
            "bounded claim left an unfunded liability"
        );
    }

    function testFuzzRoundingNeverCreatesLiabilitiesAboveTokenBalance(
        uint96 firstNotificationSeed,
        uint96 secondNotificationSeed
    ) external {
        uint16[] memory identityIds = new uint16[](4);
        for (uint8 tierCode = 1; tierCode <= 4; ++tierCode) {
            identityIds[tierCode - 1] = _ordinaryIdentity(
                AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier(tierCode), 0
            );
        }
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, identityIds);

        uint256 firstAmount = uint256(firstNotificationSeed) % 1e24 + 1;
        uint256 secondAmount = uint256(secondNotificationSeed) % 1e24 + 1;
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, firstAmount);
        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, secondAmount);

        uint256 liability = ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc);
        uint256 tokenBalance = stocks[0].balanceOf(address(ledger));
        require(liability == firstAmount + secondAmount, "notification liability was not exact");
        require(liability <= tokenBalance, "rounding created an unfunded liability");

        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, identityIds);

        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc)
                <= stocks[0].balanceOf(address(ledger)),
            "claim rounding created an unfunded liability"
        );
    }

    function _notify(AttributeRegistry.RewardTrack track, uint256 stockIndex, uint256 amount)
        internal
    {
        require(stocks[stockIndex].transfer(address(ledger), amount), "reward funding failed");
        ledger.notifyReward(track, address(stocks[stockIndex]), amount);
    }

    function _discoverAndCommit(RewardHolder holder, uint16[] memory identityIds) internal {
        require(
            core.transfer(address(holder), identityIds.length * 1 ether), "liquid transfer failed"
        );
        for (uint256 index = 0; index < identityIds.length; ++index) {
            bytes32 requestId = core.pendingDiscoveryAt(address(holder), 0);
            require(
                discoveryAdapter.fulfill(requestId, bytes32(uint256(identityIds[index] - 1))),
                "discovery fulfillment failed"
            );
        }
        for (uint256 index = 0; index < identityIds.length; ++index) {
            holder.commit(core, identityIds[index]);
        }
    }

    function _singleIdentity(uint16 identityId)
        internal
        pure
        returns (uint16[] memory identityIds)
    {
        identityIds = new uint16[](1);
        identityIds[0] = identityId;
    }

    function _ordinaryIdentity(
        AttributeRegistry.RewardTrack track,
        AttributeRegistry.RarityTier tier,
        uint256 occurrence
    ) internal view returns (uint16 identityId) {
        bytes memory canonical = VM.readFileBinary("../config/collection/manifest.bin");
        uint256 seen;
        for (uint16 candidate = 1; candidate <= 4_440; ++candidate) {
            uint256 offset = uint256(candidate - 1) * 7;
            if (
                uint8(canonical[offset + 2]) == uint8(track)
                    && uint8(canonical[offset + 3]) == uint8(tier)
            ) {
                if (seen == occurrence) return candidate;
                ++seen;
            }
        }
        revert("matching ordinary identity missing");
    }

    function _deployRegistry() internal returns (AttributeRegistry deployed) {
        bytes memory canonical = VM.readFileBinary("../config/collection/manifest.bin");
        require(keccak256(canonical) == MANIFEST_HASH, "manifest hash changed");
        deployed = new AttributeRegistry(MANIFEST_HASH);

        uint256 offset;
        uint256 inputCount = canonical.length / 7;
        while (offset < inputCount) {
            uint256 remaining = inputCount - offset;
            uint256 batchSize = remaining > 200 ? 200 : remaining;
            AttributeRegistry.AttributeInput[] memory batch =
                new AttributeRegistry.AttributeInput[](batchSize);
            for (uint256 index = 0; index < batchSize; ++index) {
                batch[index] = _attributeInput(canonical, offset + index);
            }
            deployed.loadBatch(batch);
            offset += batchSize;
        }
        deployed.seal();
    }

    function _attributeInput(bytes memory canonical, uint256 index)
        internal
        pure
        returns (AttributeRegistry.AttributeInput memory input)
    {
        uint256 offset = index * 7;
        input = AttributeRegistry.AttributeInput({
            identityId: (uint16(uint8(canonical[offset])) << 8)
                | uint16(uint8(canonical[offset + 1])),
            track: AttributeRegistry.RewardTrack(uint8(canonical[offset + 2])),
            tier: AttributeRegistry.RarityTier(uint8(canonical[offset + 3])),
            weight: (uint16(uint8(canonical[offset + 4])) << 8)
                | uint16(uint8(canonical[offset + 5])),
            collectibleKind: AttributeRegistry.CollectibleKind(uint8(canonical[offset + 6]))
        });
    }

    /// @dev The end-to-end claim-policy path a browser wallet must be able to
    ///      exercise: denied, entitlement preserved, then approved and claimed.
    function testDeniedClaimPreservesEntitlementThenApprovalAllowsIt() external {
        uint16 identityId = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 0
        );
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, _singleIdentity(identityId));

        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 1_000);
        uint256 pendingBefore = ledger.pending(identityId, AttributeRegistry.RewardTrack.AAPLc);
        require(pendingBefore > 0, "reward did not accrue");
        uint256 potBefore = ledger.unclaimedTrackPot(AttributeRegistry.RewardTrack.AAPLc);
        uint256 stockBefore = stocks[0].balanceOf(address(holder));

        require(!claimGate.isClaimAllowed(address(holder)), "wallet should start denied");
        uint16[] memory identityIds = _singleIdentity(identityId);
        (bool denied,) =
            address(holder).call(abi.encodeCall(RewardHolder.claim, (ledger, identityIds)));
        require(!denied, "denied wallet claimed rewards");

        // The denial changed nothing observable.
        require(stocks[0].balanceOf(address(holder)) == stockBefore, "denied claim moved a balance");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.AAPLc) == pendingBefore,
            "denied claim consumed the pending reward"
        );
        require(
            ledger.unclaimedTrackPot(AttributeRegistry.RewardTrack.AAPLc) == potBefore,
            "denied claim changed the track accounting"
        );

        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, identityIds);

        require(
            stocks[0].balanceOf(address(holder)) == stockBefore + pendingBefore,
            "approved claim did not transfer the preserved entitlement"
        );
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.AAPLc) == 0,
            "claim did not clear the pending reward"
        );
    }

    /// @dev Revoking prevents future claims without clawing anything back.
    function testRevocationPreservesClaimedBalanceAndLaterAccrual() external {
        uint16 identityId = _ordinaryIdentity(
            AttributeRegistry.RewardTrack.AAPLc, AttributeRegistry.RarityTier.I, 0
        );
        RewardHolder holder = new RewardHolder();
        _discoverAndCommit(holder, _singleIdentity(identityId));
        uint16[] memory identityIds = _singleIdentity(identityId);

        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 1_000);
        claimGate.setClaimAllowed(address(holder), true);
        holder.claim(ledger, identityIds);
        uint256 claimed = stocks[0].balanceOf(address(holder));
        require(claimed > 0, "nothing was claimed");

        claimGate.setClaimAllowed(address(holder), false);
        require(
            stocks[0].balanceOf(address(holder)) == claimed,
            "revocation clawed back a claimed balance"
        );

        _notify(AttributeRegistry.RewardTrack.AAPLc, 0, 500);
        (bool denied,) =
            address(holder).call(abi.encodeCall(RewardHolder.claim, (ledger, identityIds)));
        require(!denied, "revoked wallet claimed rewards");
        require(
            ledger.pending(identityId, AttributeRegistry.RewardTrack.AAPLc) > 0,
            "revoked wallet lost its newly accrued reward"
        );
    }
}
