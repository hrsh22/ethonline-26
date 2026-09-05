// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {ProtocolSystemActor, ProtocolSystemTestBase} from "./helpers/ProtocolSystemTestBase.sol";

contract ProtocolSystemE2ETest is ProtocolSystemTestBase {
    struct Outcome {
        uint256 liquidSupply;
        uint16 permanentCount;
        uint16 availableIdentityCount;
        uint16 transientIdentityCount;
        uint256 pendingDiscoveryCount;
        uint256 actorFuel;
        uint256 actorWeth;
        uint256 actorNative;
        uint256[4] actorStocks;
        uint256[4] trackQueues;
        uint256[4] rewardLiabilities;
        uint256[4] ledgerStockBalances;
        uint256[4] pendingRewards;
        uint256 rewardPot;
        uint256 liquidityPot;
        uint256 creatorPot;
        uint256 hookWeth;
        uint256 converterWeth;
        uint256 vaultWeth;
        uint256 permanentlyLockedWeth;
        uint256 managerFuel;
        uint256 managerWeth;
        uint256 routerFuel;
        uint256 routerWeth;
        uint256 epochCount;
        address identityOwner;
        uint8 identityState;
    }

    function testCompleteLocalScenarioIsDeterministicAndKeepsOneFailedTrackDeferred() external {
        ProtocolSystemFixture memory fixture = _deployProtocolSystem();
        uint256 cleanState = vm.snapshotState();

        Outcome memory first = _runCompleteScenario(fixture);
        require(vm.revertToState(cleanState), "failed to restore clean protocol state");
        Outcome memory repeated = _runCompleteScenario(fixture);

        assertEq(keccak256(abi.encode(first)), keccak256(abi.encode(repeated)), "scenario drifted");
        assertEq(
            first.liquidSupply + uint256(first.permanentCount) * 1 ether,
            fixture.fuel.MAX_LIQUID_SUPPLY(),
            "economic unit invariant changed"
        );
        assertEq(first.trackQueues[2], 0, "recovered track remained deferred");
        assertGt(first.actorStocks[0], 0, "current owner received no AAPLc reward");
        assertGt(first.permanentlyLockedWeth, 0, "POL cycle locked no WETH");
        assertEq(first.epochCount, 2, "later epoch did not continue");
    }

    function _runCompleteScenario(ProtocolSystemFixture memory fixture)
        private
        returns (Outcome memory outcome)
    {
        ProtocolSystemActor actor = new ProtocolSystemActor();
        vm.deal(address(this), address(this).balance + 6 ether);
        fixture.weth.deposit{value: 6 ether}();
        require(fixture.weth.transfer(address(actor), 6 ether), "actor WETH funding failed");
        actor.approveToken(address(fixture.weth), address(fixture.router));
        actor.approveToken(address(fixture.fuel), address(fixture.router));
        fixture.claimGate.setClaimAllowed(address(actor), true);

        _generateFeeVolume(fixture, actor, 20);
        uint16 aaplIdentity = _ordinaryIdentity(fixture, AttributeRegistry.RewardTrack.AAPLc);
        bytes32 requestId = fixture.fuel.pendingDiscoveryAt(address(actor), 0);
        require(
            fixture.discovery.fulfill(requestId, bytes32(uint256(aaplIdentity - 1))),
            "AAPLc identity discovery failed"
        );
        actor.commit(fixture.fuel, aaplIdentity);

        fixture.converter.openRewardEpoch();
        uint256 deferredBefore = fixture.converter.trackQueue(AttributeRegistry.RewardTrack.METAc);
        fixture.stocks[2].setPaused(true);
        _executeTrack(fixture, AttributeRegistry.RewardTrack.AAPLc);
        _executeTrack(fixture, AttributeRegistry.RewardTrack.GOOGLc);
        (bool failedTrackSettled,) = address(fixture.converter)
            .call(
                abi.encodeCall(
                    EpochConverter.executeTrack,
                    (AttributeRegistry.RewardTrack.METAc, uint256(0), block.timestamp)
                )
            );
        require(!failedTrackSettled, "paused METAc track settled");
        assertEq(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.METAc),
            deferredBefore,
            "failed track budget moved"
        );
        _executeTrack(fixture, AttributeRegistry.RewardTrack.NVDAc);
        assertEq(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc),
            0,
            "successful AAPLc track remained queued"
        );
        assertEq(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.GOOGLc),
            0,
            "successful GOOGLc track remained queued"
        );
        assertEq(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.NVDAc),
            0,
            "successful NVDAc track remained queued"
        );

        uint16[] memory claimIds = new uint16[](1);
        claimIds[0] = aaplIdentity;
        actor.claim(fixture.ledger, claimIds);

        _generateFeeVolume(fixture, actor, 20);
        vm.warp(block.timestamp + fixture.converter.MINIMUM_EPOCH_INTERVAL());
        fixture.converter.openRewardEpoch();
        fixture.stocks[2].setPaused(false);
        for (uint8 trackCode = 1; trackCode <= 4; ++trackCode) {
            _executeTrack(fixture, AttributeRegistry.RewardTrack(trackCode));
        }

        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        fixture.protocolLiquidityVault
            .addLiquidityCycle(
                tickLower,
                tickUpper,
                POL_CYCLE_LIQUIDITY,
                fixture.feeHook.liquidityPot(),
                block.timestamp
            );
        assertEq(
            fixture.fuel.balanceOf(address(fixture.protocolLiquidityVault)),
            0,
            "POL cycle consumed Liquid Token"
        );

        outcome = _snapshotOutcome(fixture, actor, aaplIdentity);
    }

    function _generateFeeVolume(
        ProtocolSystemFixture memory fixture,
        ProtocolSystemActor actor,
        uint256 tradeCount
    ) private {
        for (uint256 index = 0; index < tradeCount; ++index) {
            uint256 receivedFuel = actor.buy(fixture.router, 0.1 ether);
            assertGt(receivedFuel, 0, "canonical buy returned no Liquid Token");
        }
    }

    function _executeTrack(
        ProtocolSystemFixture memory fixture,
        AttributeRegistry.RewardTrack track
    ) private {
        uint256 output = fixture.converter.executeTrack(track, 0, block.timestamp);
        assertGt(output, 0, "track produced no reward stock");
    }

    function _snapshotOutcome(
        ProtocolSystemFixture memory fixture,
        ProtocolSystemActor actor,
        uint16 identityId
    ) private view returns (Outcome memory outcome) {
        outcome.liquidSupply = fixture.fuel.totalSupply();
        outcome.permanentCount = fixture.fuel.permanentCount();
        outcome.availableIdentityCount = fixture.fuel.availableIdentityCount();
        outcome.transientIdentityCount = fixture.fuel.totalTransientCount();
        outcome.pendingDiscoveryCount = fixture.fuel.totalPendingDiscoveryCount();
        outcome.actorFuel = fixture.fuel.balanceOf(address(actor));
        outcome.actorWeth = fixture.weth.balanceOf(address(actor));
        outcome.actorNative = address(actor).balance;
        outcome.pendingRewards = fixture.ledger.pendingAll(identityId);
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            outcome.actorStocks[trackIndex] = fixture.stocks[trackIndex].balanceOf(address(actor));
            outcome.trackQueues[trackIndex] = fixture.converter.trackQueue(track);
            outcome.rewardLiabilities[trackIndex] = fixture.ledger.totalLiability(track);
            outcome.ledgerStockBalances[trackIndex] =
                fixture.stocks[trackIndex].balanceOf(address(fixture.ledger));
        }
        outcome.rewardPot = fixture.feeHook.rewardPot();
        outcome.liquidityPot = fixture.feeHook.liquidityPot();
        outcome.creatorPot = fixture.feeHook.creatorPot();
        outcome.hookWeth = fixture.weth.balanceOf(address(fixture.feeHook));
        outcome.converterWeth = fixture.weth.balanceOf(address(fixture.converter));
        outcome.vaultWeth = fixture.weth.balanceOf(address(fixture.protocolLiquidityVault));
        outcome.permanentlyLockedWeth = fixture.protocolLiquidityVault.permanentlyLockedWeth();
        outcome.managerFuel = fixture.fuel.balanceOf(address(fixture.manager));
        outcome.managerWeth = fixture.weth.balanceOf(address(fixture.manager));
        outcome.routerFuel = fixture.fuel.balanceOf(address(fixture.router));
        outcome.routerWeth = fixture.weth.balanceOf(address(fixture.router));
        outcome.epochCount = fixture.converter.rewardEpochCount();
        outcome.identityOwner = fixture.fuel.identityOwner(identityId);
        outcome.identityState = uint8(fixture.fuel.identityState(identityId));
    }
}
