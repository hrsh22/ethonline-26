// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {SepoliaV4ConversionAdapter} from "../src/conversion/SepoliaV4ConversionAdapter.sol";
import {
    BaseSepoliaTestVenueConfiguration as VenueConfig
} from "../src/deployment/BaseSepoliaTestVenueConfiguration.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {IConversionVenue} from "../src/interfaces/IConversionVenue.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockUSDC} from "../src/test-assets/MockUSDC.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {TestConversionVenue} from "../src/test-assets/TestConversionVenue.sol";
import {
    EpochConverterTestBase,
    RewardLedgerHarness,
    RewardPotSourceHarness
} from "./helpers/EpochConverterTestBase.sol";

contract SepoliaV4ConversionAdapterTest is EpochConverterTestBase {
    function testSepoliaAdapterSettlesTheSameQueueThroughRealV4Pools() external {
        PoolManager manager = new PoolManager(address(this));
        TestConversionVenue venue = new TestConversionVenue(manager, address(this));
        MockWETH weth = new MockWETH();
        MockUSDC usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        MockStock[4] memory stocks = _deployStocks(1_000_000_000 ether);
        VM.deal(address(this), 250 ether);
        weth.deposit{value: 200 ether}();
        require(weth.approve(address(venue), type(uint256).max), "WETH venue approval failed");
        require(usdc.approve(address(venue), type(uint256).max), "USDC venue approval failed");
        require(stocks[0].approve(address(venue), type(uint256).max), "stock approval failed");
        venue.initializeWethUsdcPool(
            address(weth), address(usdc), VenueConfig.WETH_USDC_SEED_LIQUIDITY
        );
        venue.initializeUsdcStockPool(
            address(usdc), address(stocks[0]), VenueConfig.USDC_STOCK_SEED_LIQUIDITY
        );

        RewardLedgerHarness ledger = new RewardLedgerHarness(_stockAddresses(stocks));
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.setEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        SepoliaV4ConversionAdapter adapter = new SepoliaV4ConversionAdapter(
            AttributeRegistry.RewardTrack.AAPLc,
            address(converter),
            address(weth),
            address(usdc),
            address(stocks[0]),
            address(ledger),
            IConversionVenue(address(venue))
        );
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));
        converter.configureTrack(
            AttributeRegistry.RewardTrack.AAPLc,
            address(stocks[0]),
            IConversionAdapter(address(adapter))
        );
        _configureDeterministicTracksFrom(converter, weth, stocks, ledger, 1);
        converter.sealConfiguration();

        _fundRewardPot(weth, feeHook, 0.04 ether);
        converter.openRewardEpoch();
        uint256 expectedUsdc = venue.quoteExactInput(address(weth), address(usdc), 0.01 ether);
        uint256 expectedStock =
            venue.quoteExactInput(address(usdc), address(stocks[0]), expectedUsdc);

        uint256 measuredOutput = converter.executeTrack(
            AttributeRegistry.RewardTrack.AAPLc, expectedStock, block.timestamp
        );

        require(measuredOutput == expectedStock, "real-v4 output disagreed with quote");
        require(
            converter.trackQueue(AttributeRegistry.RewardTrack.AAPLc) == 0,
            "real-v4 route did not settle its queue"
        );
        require(
            stocks[0].balanceOf(address(ledger)) == expectedStock, "real-v4 stock missed ledger"
        );
        require(
            ledger.notified(AttributeRegistry.RewardTrack.AAPLc) == expectedStock,
            "real-v4 notification disagreed with measured receipt"
        );
        require(address(adapter.venue()) == address(venue), "sealed v4 venue changed");
    }

    function testSepoliaAdapterRejectsAnInvalidRewardTrackWithTypedError() external {
        try new SepoliaV4ConversionAdapter(
            AttributeRegistry.RewardTrack.None,
            address(this),
            address(this),
            address(this),
            address(this),
            address(this),
            IConversionVenue(address(this))
        ) returns (
            SepoliaV4ConversionAdapter
        ) {
            revert("invalid Reward Track was accepted");
        } catch (bytes memory reason) {
            require(
                _revertSelector(reason) == SepoliaV4ConversionAdapter.InvalidRewardTrack.selector,
                "wrong invalid-track error"
            );
        }
    }
}
