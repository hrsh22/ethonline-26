// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Exact-input venue surface used by the Base Sepolia conversion adapter.
interface IConversionVenue {
    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut);

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut);

    function poolKey(address tokenA, address tokenB) external view returns (PoolKey memory key);
}
