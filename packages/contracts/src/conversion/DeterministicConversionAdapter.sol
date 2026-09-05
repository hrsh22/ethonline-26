// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../AttributeRegistry.sol";
import {IConversionAdapter} from "../interfaces/IConversionAdapter.sol";

interface IDeterministicConversionToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address from, address recipient, uint256 amount) external returns (bool);
}

/// @notice Predictable one-to-one Sealed Route for deterministic and failure tests.
contract DeterministicConversionAdapter is IConversionAdapter {
    AttributeRegistry.RewardTrack public immutable override configuredTrack;
    address public immutable override converter;
    address public immutable override weth;
    address public immutable override stockToken;
    address public immutable override rewardLedger;

    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error InvalidConfiguration(address configured);
    error InvalidRewardTrack(AttributeRegistry.RewardTrack track);
    error InvalidTrack(
        AttributeRegistry.RewardTrack expected, AttributeRegistry.RewardTrack actual
    );
    error SlippageExceeded(uint256 minimumOutput, uint256 actualOutput);
    error TokenTransferFailed(address token);
    error Unauthorized(address caller);

    constructor(
        AttributeRegistry.RewardTrack configuredTrack_,
        address converter_,
        address weth_,
        address stockToken_,
        address rewardLedger_
    ) {
        uint8 trackCode = uint8(configuredTrack_);
        if (trackCode == 0 || trackCode > 4) revert InvalidRewardTrack(configuredTrack_);
        if (converter_.code.length == 0) revert InvalidConfiguration(converter_);
        if (weth_.code.length == 0) revert InvalidConfiguration(weth_);
        if (stockToken_.code.length == 0) revert InvalidConfiguration(stockToken_);
        if (rewardLedger_.code.length == 0) revert InvalidConfiguration(rewardLedger_);
        configuredTrack = configuredTrack_;
        converter = converter_;
        weth = weth_;
        stockToken = stockToken_;
        rewardLedger = rewardLedger_;
    }

    function convert(
        AttributeRegistry.RewardTrack track,
        uint256 exactWethInput,
        uint256 minimumStockOutput,
        uint256 deadline
    ) external returns (uint256 measuredStockOutput) {
        if (msg.sender != converter) revert Unauthorized(msg.sender);
        if (track != configuredTrack) revert InvalidTrack(configuredTrack, track);
        // The Keeper-provided route deadline intentionally follows the chain timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        if (!IDeterministicConversionToken(weth)
                .transferFrom(msg.sender, address(this), exactWethInput)) {
            revert TokenTransferFailed(weth);
        }

        uint256 balanceBefore = IDeterministicConversionToken(stockToken).balanceOf(rewardLedger);
        if (!IDeterministicConversionToken(stockToken).transfer(rewardLedger, exactWethInput)) {
            revert TokenTransferFailed(stockToken);
        }
        measuredStockOutput =
            IDeterministicConversionToken(stockToken).balanceOf(rewardLedger) - balanceBefore;
        if (measuredStockOutput < minimumStockOutput) {
            revert SlippageExceeded(minimumStockOutput, measuredStockOutput);
        }
    }
}
