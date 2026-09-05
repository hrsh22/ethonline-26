// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {DeterministicConversionAdapter} from "../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {TestERC20} from "../src/test-assets/TestERC20.sol";
import {
    EmptyConversionAdapter,
    EpochConverterTestBase,
    OverreportingConversionAdapter,
    RewardLedgerHarness,
    RewardPotSourceHarness
} from "./helpers/EpochConverterTestBase.sol";

contract FeeOnTransferStock is TestERC20 {
    constructor(uint256 supply) TestERC20("Fee MOCK TEST Stock", "MOCK-FEE-TEST", 18) {
        _mint(msg.sender, supply);
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = amount / 10;
        super._transfer(from, to, amount - fee);
        if (fee != 0) _burn(from, fee);
    }
}

contract EpochConverterFailuresTest is EpochConverterTestBase {
    function testTrackFailureDefersWhileHealthyTracksSettleAndLaterEpochOpens() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundAdapters(fixture, 1 ether);
        _fundRewardPot(fixture, 0.04 ether);
        VM.warp(3_000);
        fixture.converter.openRewardEpoch();
        fixture.stocks[0].setPaused(true);

        (bool aaplSettled,) = address(fixture.converter)
            .call(
                abi.encodeCall(
                    EpochConverter.executeTrack,
                    (AttributeRegistry.RewardTrack.AAPLc, uint256(0), block.timestamp)
                )
            );
        require(!aaplSettled, "paused track settled");
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0.01 ether,
            "failed track queue changed"
        );

        for (uint8 trackIndex = 1; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            fixture.converter.executeTrack(track, 0, block.timestamp);
            require(fixture.converter.trackQueue(track) == 0, "healthy track stayed queued");
        }

        _fundRewardPot(fixture, 0.04 ether);
        VM.warp(3_060);
        fixture.converter.openRewardEpoch();
        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0.02 ether,
            "failed track did not accumulate Deferred Track Budget"
        );
        fixture.stocks[0].setPaused(false);
        uint256 retryOutput = fixture.converter
            .executeTrack(AttributeRegistry.RewardTrack.AAPLc, 0.02 ether, block.timestamp);
        require(retryOutput == 0.02 ether, "deferred track retry failed");
    }

    function testRouteFailuresPreserveQueueWethAndLedgerNotification() external {
        DeterministicFixture memory fixture = _deployDeterministicFixture(address(this));
        _fundRewardPot(fixture, 0.04 ether);
        VM.warp(4_000);
        fixture.converter.openRewardEpoch();

        require(!_executeAapl(fixture, 0, 3_999), "expired deadline route settled");
        require(!_executeAapl(fixture, 0, block.timestamp), "empty deterministic route settled");
        require(
            fixture.stocks[0].transfer(address(fixture.adapters[0]), 0.01 ether),
            "adapter stock funding failed"
        );
        require(!_executeAapl(fixture, 0.02 ether, block.timestamp), "slippage-bound route settled");
        fixture.stocks[0].setPaused(true);
        require(!_executeAapl(fixture, 0, block.timestamp), "paused stock route settled");
        fixture.stocks[0].setPaused(false);
        fixture.stocks[0].setRecipientRejected(address(fixture.ledger), true);
        require(!_executeAapl(fixture, 0, block.timestamp), "rejected Reward Ledger received stock");

        require(
            fixture.converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0.01 ether,
            "failed route changed Deferred Track Budget"
        );
        require(
            fixture.weth.balanceOf(address(fixture.adapters[0])) == 0, "failed route retained WETH"
        );
        require(
            fixture.stocks[0].balanceOf(address(fixture.ledger)) == 0,
            "failed route funded Reward Ledger"
        );
        require(
            fixture.ledger.notified(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "failed route notified Reward Ledger"
        );
    }

    function testConverterIgnoresAdapterClaimsAndNotifiesOnlyMeasuredReceipt() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        OverreportingConversionAdapter overreporting = new OverreportingConversionAdapter(
            AttributeRegistry.RewardTrack.AAPLc,
            address(converter),
            weth,
            stocks[0],
            address(ledger)
        );
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));
        converter.configureTrack(
            AttributeRegistry.RewardTrack.AAPLc,
            address(stocks[0]),
            IConversionAdapter(address(overreporting))
        );
        _configureDeterministicTracksFrom(converter, weth, stocks, ledger, 1);
        converter.sealConfiguration();

        _fundRewardPot(weth, feeHook, 0.04 ether);
        require(
            stocks[0].transfer(address(overreporting), 0.005 ether),
            "overreporting adapter funding failed"
        );
        converter.openRewardEpoch();

        uint256 measuredOutput =
            converter.executeTrack(AttributeRegistry.RewardTrack.AAPLc, 0, block.timestamp);

        require(measuredOutput == 0.005 ether, "adapter claim replaced measured output");
        require(
            ledger.notified(AttributeRegistry.RewardTrack.AAPLc) == 0.005 ether,
            "ledger notification trusted adapter claim"
        );
    }

    function testFeeOnTransferOutputNotifiesOnlyWhatTheLedgerActuallyReceives() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        FeeOnTransferStock feeStock = new FeeOnTransferStock(1_000_000 ether);
        address[4] memory rewardTokens =
            [address(feeStock), address(stocks[1]), address(stocks[2]), address(stocks[3])];
        RewardLedgerHarness ledger = new RewardLedgerHarness(rewardTokens);
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));

        DeterministicConversionAdapter[4] memory adapters;
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            adapters[trackIndex] = new DeterministicConversionAdapter(
                track, address(converter), address(weth), rewardTokens[trackIndex], address(ledger)
            );
            converter.configureTrack(
                track, rewardTokens[trackIndex], IConversionAdapter(address(adapters[trackIndex]))
            );
        }
        converter.sealConfiguration();
        require(feeStock.transfer(address(adapters[0]), 1 ether), "fee stock funding failed");
        _fundRewardPot(weth, feeHook, 0.04 ether);
        converter.openRewardEpoch();

        uint256 measuredOutput =
            converter.executeTrack(AttributeRegistry.RewardTrack.AAPLc, 0, block.timestamp);

        require(measuredOutput == 0.009 ether, "fee-on-transfer output was not measured");
        require(
            feeStock.balanceOf(address(ledger)) == 0.009 ether,
            "ledger received unexpected fee stock"
        );
        require(
            ledger.notified(AttributeRegistry.RewardTrack.AAPLc) == 0.009 ether,
            "ledger notification used nominal output"
        );
        require(
            converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "measured fee-on-transfer route remained deferred"
        );
    }

    function testEmptyLiquidityOutputCannotConsumeADeferredTrackBudget() external {
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks(1_000_000 ether);
        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        EmptyConversionAdapter empty = new EmptyConversionAdapter(
            AttributeRegistry.RewardTrack.AAPLc,
            address(converter),
            weth,
            address(stocks[0]),
            address(ledger)
        );
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));
        converter.configureTrack(
            AttributeRegistry.RewardTrack.AAPLc,
            address(stocks[0]),
            IConversionAdapter(address(empty))
        );
        _configureDeterministicTracksFrom(converter, weth, stocks, ledger, 1);
        converter.sealConfiguration();

        _fundRewardPot(weth, feeHook, 0.04 ether);
        converter.openRewardEpoch();

        (bool settled,) = address(converter)
            .call(
                abi.encodeCall(
                    EpochConverter.executeTrack,
                    (AttributeRegistry.RewardTrack.AAPLc, uint256(0), block.timestamp)
                )
            );

        require(!settled, "zero-output route consumed WETH");
        require(
            converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0.01 ether,
            "zero-output route changed Deferred Track Budget"
        );
        require(weth.balanceOf(address(empty)) == 0, "failed zero-output route retained WETH");
    }
}
