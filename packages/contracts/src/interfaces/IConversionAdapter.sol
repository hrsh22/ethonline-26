// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../AttributeRegistry.sol";

/// @notice Sealed boundary for one Reward Track conversion route.
interface IConversionAdapter {
    function configuredTrack() external view returns (AttributeRegistry.RewardTrack);
    function converter() external view returns (address);
    function weth() external view returns (address);
    function stockToken() external view returns (address);
    function rewardLedger() external view returns (address);

    function convert(
        AttributeRegistry.RewardTrack track,
        uint256 exactWethInput,
        uint256 minimumStockOutput,
        uint256 deadline
    ) external returns (uint256 measuredStockOutput);
}
