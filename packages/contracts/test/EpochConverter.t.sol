// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {DeterministicConversionAdapter} from "../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {
    EpochConverterTestBase,
    RewardLedgerHarness,
    RewardPotSourceHarness,
    ShortPayingRewardPotSource
} from "./helpers/EpochConverterTestBase.sol";

contract EpochConverterTest is EpochConverterTestBase {
    function testOpeningRewardEpochSplitsThePulledPotWithDeterministicRemainder() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        uint256 rewardPot = 0.04 ether + 3;
        _fundRewardPot(fixture, rewardPot);

        uint256 openedAmount = fixture.converter.openRewardEpoch();

        require(openedAmount == rewardPot, "wrong opened amount");
        require(fixture.feeHook.rewardPot() == 0, "reward pot was not pulled");
        require(
            fixture.weth.balanceOf(address(fixture.converter)) == rewardPot, "WETH was not received"
        );
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0.01 ether,
            "wrong AAPLc queue"
        );
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.GOOGLc) == 0.01 ether,
            "wrong GOOGLc queue"
        );
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.METAc) == 0.01 ether,
            "wrong METAc queue"
        );
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.NVDAc) == 0.01 ether + 3,
            "epoch remainder was not deterministic"
        );
    }

    function testOpeningMeasuresTheExactWethPulledBeforeCreatingTrackQueues() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        ShortPayingRewardPotSource feeHook =
            new ShortPayingRewardPotSource(weth, address(converter));
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));
        _configureDeterministicTracksFrom(converter, weth, stocks, ledger, 0);
        converter.sealConfiguration();

        VM.deal(address(this), 0.04 ether);
        weth.deposit{value: 0.04 ether}();
        require(weth.approve(address(feeHook), 0.04 ether), "fee hook approval failed");
        feeHook.fund(0.04 ether);

        (bool opened,) = address(converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));

        require(!opened, "short WETH pull created full track queues");
        require(feeHook.rewardPot() == 0.04 ether, "failed pull changed reward pot");
        require(weth.balanceOf(address(converter)) == 0, "failed pull retained WETH");
        require(
            converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "failed pull created a track queue"
        );
    }

    function testOpeningBelowTheMinimumLeavesTheRewardPotUntouched() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        uint256 belowMinimum = 0.04 ether - 1;
        _fundRewardPot(fixture, belowMinimum);

        (bool opened,) =
            address(fixture.converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));

        require(!opened, "below-minimum epoch opened");
        require(fixture.feeHook.rewardPot() == belowMinimum, "failed epoch changed reward pot");
        require(fixture.weth.balanceOf(address(fixture.converter)) == 0, "failed epoch pulled WETH");
    }

    function testOpeningAboveTheMaximumClipsAndLeavesTheRemainderInTheRewardPot() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 40.08 ether);

        uint256 openedAmount = fixture.converter.openRewardEpoch();

        require(openedAmount == 40 ether, "epoch was not clipped");
        require(fixture.feeHook.rewardPot() == 0.08 ether, "clipped remainder did not stay queued");
        require(
            fixture.weth.balanceOf(address(fixture.converter)) == 40 ether,
            "wrong clipped WETH pull"
        );
    }

    function testKeeperWaitsSixtySecondsBetweenRewardEpochs() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 0.04 ether);
        VM.warp(1_000);
        fixture.converter.openRewardEpoch();

        _fundRewardPot(fixture, 0.04 ether);
        VM.warp(1_059);
        (bool openedEarly,) =
            address(fixture.converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));
        require(!openedEarly, "epoch opened before the minimum interval");
        require(fixture.feeHook.rewardPot() == 0.04 ether, "early attempt changed pot");

        VM.warp(1_060);
        require(
            fixture.converter.openRewardEpoch() == 0.04 ether, "epoch did not open at 60 seconds"
        );
    }

    function testOnlyTheAppointedKeeperCanOpenARewardEpoch() external {
        address appointedKeeper = address(0xBEEF);
        DeterministicFixture memory fixture = _deployDeterministicFixture(appointedKeeper);
        _fundRewardPot(fixture, 0.04 ether);

        (bool ownerOpened,) =
            address(fixture.converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));
        require(!ownerOpened, "owner bypassed the appointed keeper");
        require(fixture.feeHook.rewardPot() == 0.04 ether, "unauthorized attempt changed pot");

        VM.prank(appointedKeeper);
        require(
            fixture.converter.openRewardEpoch() == 0.04 ether, "appointed keeper could not open"
        );
    }

    function testOwnerCanReplaceTheKeeperWithoutGivingTheOldKeeperAuthority() external {
        address previousKeeper = address(0xBEEF);
        address replacementKeeper = address(0xCAFE);
        DeterministicFixture memory fixture = _deployDeterministicFixture(previousKeeper);
        _fundRewardPot(fixture, 0.04 ether);
        fixture.converter.setKeeper(replacementKeeper);

        VM.prank(previousKeeper);
        (bool previousOpened,) =
            address(fixture.converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));
        require(!previousOpened, "replaced keeper retained authority");

        VM.prank(replacementKeeper);
        require(
            fixture.converter.openRewardEpoch() == 0.04 ether, "replacement keeper lacked authority"
        );
    }

    function testOwnerPauseStopsRewardEpochsUntilExplicitlyLifted() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 0.04 ether);
        fixture.converter.setPaused(true);

        (bool openedWhilePaused,) =
            address(fixture.converter).call(abi.encodeCall(EpochConverter.openRewardEpoch, ()));
        require(!openedWhilePaused, "paused converter opened an epoch");
        require(fixture.feeHook.rewardPot() == 0.04 ether, "paused attempt changed pot");

        fixture.converter.setPaused(false);
        require(
            fixture.converter.openRewardEpoch() == 0.04 ether, "unpaused converter stayed stopped"
        );
    }

    function testOnlyOwnerCanConfigureOrSealTheRewardEpochModule() external {
        MockWETH weth = new MockWETH();
        EpochConverter converter =
            new EpochConverter(address(weth), address(this), address(this), address(this));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        address outsider = address(0xBAD);

        VM.prank(outsider);
        (bool configured,) = address(converter)
            .call(
                abi.encodeCall(
                    EpochConverter.configureCanonicalFeeHook, (ICanonicalFeeHook(address(feeHook)))
                )
            );
        require(!configured, "outsider configured the fee source");

        VM.prank(outsider);
        (bool sealedByOutsider,) =
            address(converter).call(abi.encodeCall(EpochConverter.sealConfiguration, ()));
        require(!sealedByOutsider, "outsider sealed configuration");
    }

    function testSealedFeeSourceCannotBeRedirected() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        RewardPotSourceHarness replacement =
            new RewardPotSourceHarness(fixture.weth, address(fixture.converter));

        (bool reconfigured,) = address(fixture.converter)
            .call(
                abi.encodeCall(
                    EpochConverter.configureCanonicalFeeHook,
                    (ICanonicalFeeHook(address(replacement)))
                )
            );

        require(!reconfigured, "sealed fee source was redirected");
        require(
            address(fixture.converter.canonicalFeeHook()) == address(fixture.feeHook),
            "sealed fee source changed"
        );
    }

    function testDeterministicTrackExecutionSpendsExactQueueAndNotifiesMeasuredStock() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 0.04 ether);
        require(
            fixture.stocks[0].transfer(address(fixture.adapters[0]), 0.01 ether),
            "adapter stock funding failed"
        );
        fixture.converter.openRewardEpoch();

        uint256 measuredOutput = fixture.converter
            .executeTrack(AttributeRegistry.RewardTrack.AAPLc, 0.01 ether, block.timestamp);

        require(measuredOutput == 0.01 ether, "wrong measured stock output");
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "settled queue was not cleared"
        );
        require(
            fixture.weth.balanceOf(address(fixture.adapters[0])) == 0.01 ether,
            "adapter did not spend exact WETH"
        );
        require(
            fixture.stocks[0].balanceOf(address(fixture.ledger)) == 0.01 ether,
            "stock missed Reward Ledger"
        );
        require(
            fixture.ledger.notified(AttributeRegistry.RewardTrack.AAPLc) == 0.01 ether,
            "notification was not measured output"
        );
    }

    function testTrackExecutionClipsAtTenWethAndPreservesTheDeferredBudget() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 40 ether);
        VM.warp(2_000);
        fixture.converter.openRewardEpoch();
        _fundRewardPot(fixture, 40 ether);
        VM.warp(2_060);
        fixture.converter.openRewardEpoch();
        require(
            fixture.stocks[0].transfer(address(fixture.adapters[0]), 10 ether),
            "adapter stock funding failed"
        );

        uint256 measuredOutput = fixture.converter
            .executeTrack(AttributeRegistry.RewardTrack.AAPLc, 10 ether, block.timestamp);

        require(measuredOutput == 10 ether, "execution exceeded ten-WETH clip");
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 10 ether,
            "Deferred Track Budget was not preserved"
        );
        require(
            fixture.weth.balanceOf(address(fixture.adapters[0])) == 10 ether,
            "wrong clipped WETH spend"
        );
    }

    function testInvalidRewardTrackUsesTheDomainSpecificError() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));

        try fixture.converter.trackQueue(AttributeRegistry.RewardTrack.None) returns (uint256) {
            revert("invalid Reward Track was accepted");
        } catch (bytes memory reason) {
            require(
                _revertSelector(reason) == EpochConverter.InvalidRewardTrack.selector,
                "wrong invalid-track error"
            );
        }

        try new DeterministicConversionAdapter(
            AttributeRegistry.RewardTrack.None,
            address(fixture.converter),
            address(fixture.weth),
            address(fixture.stocks[0]),
            address(fixture.ledger)
        ) returns (
            DeterministicConversionAdapter
        ) {
            revert("invalid adapter Reward Track was accepted");
        } catch (bytes memory reason) {
            require(
                _revertSelector(reason)
                    == DeterministicConversionAdapter.InvalidRewardTrack.selector,
                "wrong adapter invalid-track error"
            );
        }
    }

    function testSealingReportsAnAdapterTrackMismatch() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));
        DeterministicConversionAdapter wrongTrack = new DeterministicConversionAdapter(
            AttributeRegistry.RewardTrack.GOOGLc,
            address(converter),
            address(weth),
            address(stocks[0]),
            address(ledger)
        );
        converter.configureTrack(
            AttributeRegistry.RewardTrack.AAPLc,
            address(stocks[0]),
            IConversionAdapter(address(wrongTrack))
        );
        _configureDeterministicTracksFrom(converter, weth, stocks, ledger, 1);

        try converter.sealConfiguration() {
            revert("mismatched adapter track sealed");
        } catch (bytes memory reason) {
            require(
                _revertSelector(reason) == EpochConverter.AdapterTrackMismatch.selector,
                "wrong adapter mismatch error"
            );
        }
    }

    function testSealingRejectsIncompleteTrackAndLedgerDestinations() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));

        (bool sealedIncomplete,) =
            address(converter).call(abi.encodeCall(EpochConverter.sealConfiguration, ()));

        require(!sealedIncomplete, "incomplete route configuration sealed");
        require(!converter.configurationSealed(), "incomplete seal changed state");
    }
}
