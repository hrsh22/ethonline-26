// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {AttributeRegistry} from "../AttributeRegistry.sol";
import {IConversionAdapter} from "../interfaces/IConversionAdapter.sol";
import {IConversionVenue} from "../interfaces/IConversionVenue.sol";

interface ISepoliaConversionToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address recipient, uint256 amount) external returns (bool);
}

/// @notice Sealed Base Sepolia route from WETH through USDC into one MockStock Reward Track.
contract SepoliaV4ConversionAdapter is IConversionAdapter {
    AttributeRegistry.RewardTrack public immutable override configuredTrack;
    address public immutable override converter;
    address public immutable override weth;
    address public immutable usdc;
    address public immutable override stockToken;
    address public immutable override rewardLedger;
    IConversionVenue public immutable venue;
    PoolId public immutable wethUsdcPoolId;
    PoolId public immutable usdcStockPoolId;

    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error EmptyConversionOutput(address token);
    error InvalidConfiguration(address configured);
    error InvalidRewardTrack(AttributeRegistry.RewardTrack track);
    error InvalidTrack(
        AttributeRegistry.RewardTrack expected, AttributeRegistry.RewardTrack actual
    );
    error RouteChanged(PoolId expected, PoolId actual);
    error SlippageExceeded(uint256 minimumOutput, uint256 actualOutput);
    error TokenApprovalFailed(address token, address spender, uint256 amount);
    error TokenTransferFailed(address token);
    error Unauthorized(address caller);

    constructor(
        AttributeRegistry.RewardTrack configuredTrack_,
        address converter_,
        address weth_,
        address usdc_,
        address stockToken_,
        address rewardLedger_,
        IConversionVenue venue_
    ) {
        uint8 trackCode = uint8(configuredTrack_);
        if (trackCode == 0 || trackCode > 4) revert InvalidRewardTrack(configuredTrack_);
        if (converter_.code.length == 0) revert InvalidConfiguration(converter_);
        if (weth_.code.length == 0) revert InvalidConfiguration(weth_);
        if (usdc_.code.length == 0) revert InvalidConfiguration(usdc_);
        if (stockToken_.code.length == 0) revert InvalidConfiguration(stockToken_);
        if (rewardLedger_.code.length == 0) revert InvalidConfiguration(rewardLedger_);
        if (address(venue_).code.length == 0) {
            revert InvalidConfiguration(address(venue_));
        }
        if (weth_ == usdc_ || weth_ == stockToken_ || usdc_ == stockToken_) {
            revert InvalidConfiguration(address(0));
        }
        configuredTrack = configuredTrack_;
        converter = converter_;
        weth = weth_;
        usdc = usdc_;
        stockToken = stockToken_;
        rewardLedger = rewardLedger_;
        venue = venue_;
        wethUsdcPoolId = venue_.poolKey(weth_, usdc_).toId();
        usdcStockPoolId = venue_.poolKey(usdc_, stockToken_).toId();
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
        _verifySealedPool(weth, usdc, wethUsdcPoolId);
        _verifySealedPool(usdc, stockToken, usdcStockPoolId);

        if (!ISepoliaConversionToken(weth).transferFrom(msg.sender, address(this), exactWethInput))
        {
            revert TokenTransferFailed(weth);
        }
        _approveExact(weth, address(venue), exactWethInput);

        uint256 usdcBalanceBefore = ISepoliaConversionToken(usdc).balanceOf(address(this));
        uint256 quotedUsdcOutput = venue.quoteExactInput(weth, usdc, exactWethInput);
        venue.swapExactInput(weth, usdc, exactWethInput, quotedUsdcOutput, address(this));
        uint256 measuredUsdcOutput =
            ISepoliaConversionToken(usdc).balanceOf(address(this)) - usdcBalanceBefore;
        if (measuredUsdcOutput == 0) revert EmptyConversionOutput(usdc);
        _approveExact(usdc, address(venue), measuredUsdcOutput);

        uint256 stockBalanceBefore = ISepoliaConversionToken(stockToken).balanceOf(rewardLedger);
        venue.swapExactInput(usdc, stockToken, measuredUsdcOutput, minimumStockOutput, rewardLedger);
        measuredStockOutput =
            ISepoliaConversionToken(stockToken).balanceOf(rewardLedger) - stockBalanceBefore;
        if (measuredStockOutput == 0) revert EmptyConversionOutput(stockToken);
        if (measuredStockOutput < minimumStockOutput) {
            revert SlippageExceeded(minimumStockOutput, measuredStockOutput);
        }
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        if (!ISepoliaConversionToken(token).approve(spender, 0)) {
            revert TokenApprovalFailed(token, spender, 0);
        }
        if (!ISepoliaConversionToken(token).approve(spender, amount)) {
            revert TokenApprovalFailed(token, spender, amount);
        }
    }

    function _verifySealedPool(address tokenA, address tokenB, PoolId expected) private view {
        PoolId actual = venue.poolKey(tokenA, tokenB).toId();
        if (PoolId.unwrap(actual) != PoolId.unwrap(expected)) {
            revert RouteChanged(expected, actual);
        }
    }
}
