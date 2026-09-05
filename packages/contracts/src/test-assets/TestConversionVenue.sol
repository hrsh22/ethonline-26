// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Creates and exercises deterministic, explicitly artificial v4 test pools.
contract TestConversionVenue is IUnlockCallback {
    using SafeCast for int128;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    // A dedicated key keeps this fixture separate from existing public WETH/USDC pools.
    uint24 public constant LP_FEE = 4_444;
    int24 public constant TICK_SPACING = 11;
    int24 public constant USDC_STOCK_ABSOLUTE_TICK = 276_300;
    int24 public constant WETH_USDC_ABSOLUTE_TICK = 230_280;

    IPoolManager public immutable manager;
    address public immutable operator;

    mapping(bytes32 pairHash => PoolKey key) private _poolKeys;
    mapping(bytes32 pairHash => uint128 liquidity) private _verifiedSeedLiquidity;
    mapping(bytes32 pairHash => uint160 sqrtPriceX96) private _verifiedSeedPrice;

    error AlreadyConfigured(address tokenA, address tokenB);
    error CallbackNotPoolManager(address caller);
    error ERC20TransferFailed(address token);
    error InvalidPair(address tokenA, address tokenB);
    error InvalidQuoteAmount(uint256 amountIn);
    error PartialFill(uint256 requestedAmountIn, int128 actualInputDelta);
    error PoolNotConfigured(address tokenA, address tokenB);
    error QuoteResult(uint256 amountOut);
    error SlippageExceeded(uint256 minimumAmountOut, uint256 actualAmountOut);
    error UnexpectedQuoteSuccess();
    error Unauthorized(address caller);
    error VerificationFailed(PoolId poolId);
    error ZeroRecipient();

    event TestPoolConfigured(
        PoolId indexed poolId,
        address indexed currency0,
        address indexed currency1,
        uint160 sqrtPriceX96,
        uint128 liquidity
    );

    struct SeedCallbackData {
        address payer;
        PoolKey key;
        uint128 liquidity;
    }

    struct QuoteCallbackData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
    }

    struct SwapCallbackData {
        address payer;
        address recipient;
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minimumAmountOut;
    }

    enum CallbackAction {
        Seed,
        Quote,
        Swap
    }

    constructor(IPoolManager manager_, address operator_) {
        manager = manager_;
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized(msg.sender);
        _;
    }

    function initializeWethUsdcPool(address weth, address usdc, uint128 liquidity)
        external
        onlyOperator
        returns (PoolId poolId_)
    {
        (PoolKey memory key, bool wethIsCurrency0) = _orderedPoolKey(weth, usdc);
        int24 initialTick = wethIsCurrency0 ? -WETH_USDC_ABSOLUTE_TICK : WETH_USDC_ABSOLUTE_TICK;
        poolId_ = _initializeAndSeed(key, initialTick, liquidity);
    }

    function initializeUsdcStockPool(address usdc, address mockStock, uint128 liquidity)
        external
        onlyOperator
        returns (PoolId poolId_)
    {
        (PoolKey memory key, bool usdcIsCurrency0) = _orderedPoolKey(usdc, mockStock);
        int24 initialTick = usdcIsCurrency0 ? USDC_STOCK_ABSOLUTE_TICK : -USDC_STOCK_ABSOLUTE_TICK;
        poolId_ = _initializeAndSeed(key, initialTick, liquidity);
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        (PoolKey memory key, bool zeroForOne) =
            _exactInputConfiguration(tokenIn, tokenOut, amountIn);
        bytes memory callbackData =
            abi.encode(CallbackAction.Quote, QuoteCallbackData(key, zeroForOne, amountIn));
        try manager.unlock(callbackData) returns (bytes memory) {
            revert UnexpectedQuoteSuccess();
        } catch (bytes memory reason) {
            if (reason.length != 36) _bubbleRevert(reason);
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
            if (selector != QuoteResult.selector) _bubbleRevert(reason);
            assembly ("memory-safe") {
                amountOut := mload(add(reason, 0x24))
            }
        }
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (recipient == address(0)) revert ZeroRecipient();
        (PoolKey memory key, bool zeroForOne) =
            _exactInputConfiguration(tokenIn, tokenOut, amountIn);
        bytes memory result = manager.unlock(
            abi.encode(
                CallbackAction.Swap,
                SwapCallbackData({
                    payer: msg.sender,
                    recipient: recipient,
                    key: key,
                    zeroForOne: zeroForOne,
                    amountIn: amountIn,
                    minimumAmountOut: minimumAmountOut
                })
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function poolKey(address tokenA, address tokenB) external view returns (PoolKey memory key) {
        key = _configuredPoolKey(tokenA, tokenB);
    }

    function verifiedPoolConfiguration(address tokenA, address tokenB)
        external
        view
        returns (
            PoolId poolId_,
            PoolKey memory key,
            uint160 seedSqrtPriceX96,
            uint128 activeLiquidity
        )
    {
        bytes32 pairHash = _pairHash(tokenA, tokenB);
        key = _configuredPoolKey(tokenA, tokenB);
        poolId_ = key.toId();
        seedSqrtPriceX96 = _verifiedSeedPrice[pairHash];
        activeLiquidity = manager.getLiquidity(poolId_);
        if (
            seedSqrtPriceX96 == 0 || activeLiquidity == 0
                || activeLiquidity != _verifiedSeedLiquidity[pairHash]
        ) {
            revert VerificationFailed(poolId_);
        }
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallbackNotPoolManager(msg.sender);
        CallbackAction action = abi.decode(rawData, (CallbackAction));
        if (action == CallbackAction.Quote) {
            (, QuoteCallbackData memory quoteData) =
                abi.decode(rawData, (CallbackAction, QuoteCallbackData));
            BalanceDelta quoteDelta =
                _swapExactInput(quoteData.key, quoteData.zeroForOne, quoteData.amountIn);
            int128 outputDelta = quoteData.zeroForOne ? quoteDelta.amount1() : quoteDelta.amount0();
            revert QuoteResult(outputDelta.toUint128());
        }
        if (action == CallbackAction.Swap) {
            (, SwapCallbackData memory swapData) =
                abi.decode(rawData, (CallbackAction, SwapCallbackData));
            BalanceDelta swapDelta =
                _swapExactInput(swapData.key, swapData.zeroForOne, swapData.amountIn);
            int128 inputDelta = swapData.zeroForOne ? swapDelta.amount0() : swapDelta.amount1();
            int128 outputDelta = swapData.zeroForOne ? swapDelta.amount1() : swapDelta.amount0();
            if (int256(inputDelta) != -swapData.amountIn.toInt256()) {
                revert PartialFill(swapData.amountIn, inputDelta);
            }
            uint256 amountOut = outputDelta.toUint128();
            if (amountOut < swapData.minimumAmountOut) {
                revert SlippageExceeded(swapData.minimumAmountOut, amountOut);
            }

            Currency inputCurrency =
                swapData.zeroForOne ? swapData.key.currency0 : swapData.key.currency1;
            Currency outputCurrency =
                swapData.zeroForOne ? swapData.key.currency1 : swapData.key.currency0;
            _settle(inputCurrency, swapData.payer, swapData.amountIn);
            manager.take(outputCurrency, swapData.recipient, amountOut);
            return abi.encode(amountOut);
        }

        (, SeedCallbackData memory data) = abi.decode(rawData, (CallbackAction, SeedCallbackData));
        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(TICK_SPACING),
            tickUpper: TickMath.maxUsableTick(TICK_SPACING),
            liquidityDelta: int256(uint256(data.liquidity)),
            salt: bytes32(0)
        });
        (BalanceDelta delta,) = manager.modifyLiquidity(data.key, params, bytes(""));

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        if (amount0 < 0) _settle(data.key.currency0, data.payer, (-amount0).toUint128());
        if (amount1 < 0) _settle(data.key.currency1, data.payer, (-amount1).toUint128());
        return abi.encode(delta);
    }

    function _initializeAndSeed(PoolKey memory key, int24 initialTick, uint128 liquidity)
        private
        returns (PoolId poolId_)
    {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        bytes32 pairHash = _pairHash(currency0, currency1);
        if (Currency.unwrap(_poolKeys[pairHash].currency0) != address(0)) {
            revert AlreadyConfigured(currency0, currency1);
        }

        uint160 expectedSqrtPriceX96 = TickMath.getSqrtPriceAtTick(initialTick);
        manager.initialize(key, expectedSqrtPriceX96);
        manager.unlock(
            abi.encode(CallbackAction.Seed, SeedCallbackData(msg.sender, key, liquidity))
        );

        poolId_ = key.toId();
        (uint160 actualSqrtPriceX96,,,) = manager.getSlot0(poolId_);
        uint128 activeLiquidity = manager.getLiquidity(poolId_);
        if (actualSqrtPriceX96 != expectedSqrtPriceX96 || activeLiquidity != liquidity) {
            revert VerificationFailed(poolId_);
        }

        _poolKeys[pairHash] = key;
        _verifiedSeedPrice[pairHash] = actualSqrtPriceX96;
        _verifiedSeedLiquidity[pairHash] = activeLiquidity;
        emit TestPoolConfigured(poolId_, currency0, currency1, actualSqrtPriceX96, activeLiquidity);
    }

    function _orderedPoolKey(address tokenA, address tokenB)
        private
        pure
        returns (PoolKey memory key, bool tokenAIsCurrency0)
    {
        (address currency0, address currency1, bool ordered) = _orderedTokens(tokenA, tokenB);
        tokenAIsCurrency0 = ordered;
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    function _pairHash(address tokenA, address tokenB) private pure returns (bytes32) {
        (address currency0, address currency1,) = _orderedTokens(tokenA, tokenB);
        return keccak256(abi.encodePacked(currency0, currency1));
    }

    function _configuredPoolKey(address tokenA, address tokenB)
        private
        view
        returns (PoolKey memory key)
    {
        key = _poolKeys[_pairHash(tokenA, tokenB)];
        if (Currency.unwrap(key.currency0) == address(0)) {
            revert PoolNotConfigured(tokenA, tokenB);
        }
    }

    function _bubbleRevert(bytes memory reason) private pure {
        assembly ("memory-safe") {
            revert(add(reason, 0x20), mload(reason))
        }
    }

    function _exactInputConfiguration(address tokenIn, address tokenOut, uint256 amountIn)
        private
        view
        returns (PoolKey memory key, bool zeroForOne)
    {
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) {
            revert InvalidQuoteAmount(amountIn);
        }
        key = _configuredPoolKey(tokenIn, tokenOut);
        zeroForOne = tokenIn == Currency.unwrap(key.currency0);
    }

    function _orderedTokens(address tokenA, address tokenB)
        private
        pure
        returns (address currency0, address currency1, bool tokenAIsCurrency0)
    {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) {
            revert InvalidPair(tokenA, tokenB);
        }
        tokenAIsCurrency0 = tokenA < tokenB;
        (currency0, currency1) = tokenAIsCurrency0 ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function _swapExactInput(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        private
        returns (BalanceDelta delta)
    {
        delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amountIn.toInt256(),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            bytes("")
        );
    }

    function _settle(Currency currency, address payer, uint256 amount) private {
        manager.sync(currency);
        address token = Currency.unwrap(currency);
        if (!IERC20Minimal(token).transferFrom(payer, address(manager), amount)) {
            revert ERC20TransferFailed(token);
        }
        manager.settle();
    }
}
