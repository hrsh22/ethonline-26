// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {TestConversionVenue} from "../test-assets/TestConversionVenue.sol";
import {BaseSepoliaTestVenueConfiguration as Config} from "./BaseSepoliaTestVenueConfiguration.sol";

/// @notice Independent expected-value checks shared by deployment and confirmation scripts.
library BaseSepoliaTestVenueValidation {
    error IncorrectActiveLiquidity(uint128 expected, uint128 actual);
    error IncorrectPoolId(PoolId expected, PoolId actual);
    error IncorrectSeedPrice(uint160 expected, uint160 actual);
    error UnexpectedFee(uint24 expected, uint24 actual);
    error UnexpectedHooks(address hooks);
    error UnexpectedTickSpacing(int24 expected, int24 actual);
    error UnsortedPoolKey(address currency0, address currency1);

    function verifyPool(
        TestConversionVenue venue,
        address tokenA,
        address tokenB,
        uint128 expectedLiquidity,
        uint160 expectedSeedPrice
    ) internal view returns (PoolId poolId_, PoolKey memory key) {
        uint160 seedSqrtPriceX96;
        uint128 activeLiquidity;
        (poolId_, key, seedSqrtPriceX96, activeLiquidity) =
            venue.verifiedPoolConfiguration(tokenA, tokenB);

        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (currency0 >= currency1) revert UnsortedPoolKey(currency0, currency1);
        PoolId keyPoolId = key.toId();
        if (PoolId.unwrap(poolId_) != PoolId.unwrap(keyPoolId)) {
            revert IncorrectPoolId(keyPoolId, poolId_);
        }
        if (seedSqrtPriceX96 != expectedSeedPrice) {
            revert IncorrectSeedPrice(expectedSeedPrice, seedSqrtPriceX96);
        }
        if (activeLiquidity != expectedLiquidity) {
            revert IncorrectActiveLiquidity(expectedLiquidity, activeLiquidity);
        }
        if (key.fee != Config.TEST_LP_FEE) revert UnexpectedFee(Config.TEST_LP_FEE, key.fee);
        if (key.tickSpacing != Config.TEST_TICK_SPACING) {
            revert UnexpectedTickSpacing(Config.TEST_TICK_SPACING, key.tickSpacing);
        }
        if (address(key.hooks) != address(0)) revert UnexpectedHooks(address(key.hooks));
    }

    function wethUsdcSeedPrice(address weth, address usdc) internal pure returns (uint160) {
        int24 initialTick =
            weth < usdc ? -Config.WETH_USDC_ABSOLUTE_TICK : Config.WETH_USDC_ABSOLUTE_TICK;
        return TickMath.getSqrtPriceAtTick(initialTick);
    }

    function usdcStockSeedPrice(address usdc, address stock) internal pure returns (uint160) {
        int24 initialTick =
            usdc < stock ? Config.USDC_STOCK_ABSOLUTE_TICK : -Config.USDC_STOCK_ABSOLUTE_TICK;
        return TickMath.getSqrtPriceAtTick(initialTick);
    }
}
