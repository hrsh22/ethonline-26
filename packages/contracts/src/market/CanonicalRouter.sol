// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {CanonicalMarketRegistry} from "./CanonicalMarketRegistry.sol";

interface IWrappedEther {
    function deposit() external payable;

    function withdraw(uint256 amount) external;
}

interface ICanonicalFeeRuntime {
    function currentFeeAmount() external view returns (uint256);

    function collectAccruedFee() external;

    function closeSettlement(address trader) external;
}

/// @notice Dedicated swap interface for the sealed Canonical Market.
contract CanonicalRouter is IUnlockCallback {
    using SafeCast for int128;
    using SafeCast for uint256;

    struct ExactInputParams {
        bool fuelForWeth;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
        bool useNative;
    }

    struct ExactOutputParams {
        bool fuelForWeth;
        uint256 amountOut;
        uint256 amountInMaximum;
        address recipient;
        uint256 deadline;
        bool useNative;
    }

    enum CallbackAction {
        QuoteExactInput,
        QuoteExactOutput,
        SwapExactInput,
        SwapExactOutput
    }

    struct CallbackData {
        CallbackAction action;
        address trader;
        address recipient;
        bool fuelForWeth;
        uint256 amount;
        uint256 bound;
        bool useNative;
    }

    IPoolManager public immutable manager;
    CanonicalMarketRegistry public immutable registry;
    address public immutable weth;

    bool private _entered;

    error CallbackNotPoolManager(address caller);
    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error EtherTransferFailed(address recipient);
    error ERC20TransferFailed(address token);
    error InvalidAmount(uint256 amount);
    error InvalidConfiguration(address configured);
    error InvalidNativeValue(uint256 supplied, uint256 expected);
    error InvalidQuoteResult();
    error InvalidSwapDelta(int128 inputDelta, int128 outputDelta);
    error PartialFill(uint256 requested, uint256 actual);
    error QuoteResult(uint256 amountIn, uint256 amountOut, uint256 feeAmount);
    error Reentrancy();
    error SlippageExceeded(uint256 bound, uint256 actual);
    error UnauthorizedEtherSender(address sender);
    error ZeroRecipient();

    constructor(IPoolManager manager_, CanonicalMarketRegistry registry_, address weth_) {
        if (
            address(manager_).code.length == 0 || address(registry_).code.length == 0
                || weth_.code.length == 0
        ) {
            revert InvalidConfiguration(address(0));
        }
        manager = manager_;
        registry = registry_;
        weth = weth_;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    receive() external payable {
        if (msg.sender != weth) revert UnauthorizedEtherSender(msg.sender);
    }

    function quoteExactInput(bool fuelForWeth, uint256 amountIn)
        external
        nonReentrant
        returns (uint256 amountOut, uint256 feeAmount)
    {
        _validateAmount(amountIn);
        (uint256 quotedInput, uint256 quotedOutput, uint256 quotedFee) = _quote(
            CallbackData({
                action: CallbackAction.QuoteExactInput,
                trader: msg.sender,
                recipient: msg.sender,
                fuelForWeth: fuelForWeth,
                amount: amountIn,
                bound: 0,
                useNative: false
            })
        );
        if (quotedInput != amountIn) revert PartialFill(amountIn, quotedInput);
        return (quotedOutput, quotedFee);
    }

    function quoteExactOutput(bool fuelForWeth, uint256 amountOut)
        external
        nonReentrant
        returns (uint256 amountIn, uint256 feeAmount)
    {
        _validateAmount(amountOut);
        (uint256 quotedInput, uint256 quotedOutput, uint256 quotedFee) = _quote(
            CallbackData({
                action: CallbackAction.QuoteExactOutput,
                trader: msg.sender,
                recipient: msg.sender,
                fuelForWeth: fuelForWeth,
                amount: amountOut,
                bound: type(uint256).max,
                useNative: false
            })
        );
        if (quotedOutput != amountOut) revert PartialFill(amountOut, quotedOutput);
        return (quotedInput, quotedFee);
    }

    function swapExactInput(ExactInputParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        _validateSwap(params.amountIn, params.recipient, params.deadline);
        uint256 nativeBudget =
            _prepareNative(params.fuelForWeth, params.useNative, params.amountIn, msg.value);
        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData({
                    action: CallbackAction.SwapExactInput,
                    trader: msg.sender,
                    recipient: params.recipient,
                    fuelForWeth: params.fuelForWeth,
                    amount: params.amountIn,
                    bound: params.amountOutMinimum,
                    useNative: params.useNative
                })
            )
        );
        uint256 amountIn;
        (amountIn, amountOut) = abi.decode(result, (uint256, uint256));
        ICanonicalFeeRuntime(registry.hook()).closeSettlement(msg.sender);
        _finishNative(
            params.fuelForWeth,
            params.useNative,
            nativeBudget,
            amountIn,
            amountOut,
            params.recipient,
            msg.sender
        );
    }

    function swapExactOutput(ExactOutputParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 amountIn)
    {
        _validateSwap(params.amountOut, params.recipient, params.deadline);
        if (params.amountInMaximum == 0) revert InvalidAmount(params.amountInMaximum);
        uint256 nativeBudget =
            _prepareNative(params.fuelForWeth, params.useNative, params.amountInMaximum, msg.value);
        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData({
                    action: CallbackAction.SwapExactOutput,
                    trader: msg.sender,
                    recipient: params.recipient,
                    fuelForWeth: params.fuelForWeth,
                    amount: params.amountOut,
                    bound: params.amountInMaximum,
                    useNative: params.useNative
                })
            )
        );
        uint256 amountOut;
        (amountIn, amountOut) = abi.decode(result, (uint256, uint256));
        ICanonicalFeeRuntime(registry.hook()).closeSettlement(msg.sender);
        _finishNative(
            params.fuelForWeth,
            params.useNative,
            nativeBudget,
            amountIn,
            amountOut,
            params.recipient,
            msg.sender
        );
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallbackNotPoolManager(msg.sender);
        CallbackData memory data = abi.decode(rawData, (CallbackData));
        PoolKey memory key = registry.poolKey();
        bool fuelIsCurrency0 = Currency.unwrap(key.currency0) == registry.fuel();
        bool zeroForOne = data.fuelForWeth ? fuelIsCurrency0 : !fuelIsCurrency0;
        bool exactInput = data.action == CallbackAction.QuoteExactInput
            || data.action == CallbackAction.SwapExactInput;
        BalanceDelta delta = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactInput ? -data.amount.toInt256() : data.amount.toInt256(),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(data.trader, data.recipient)
        );
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || inputDelta == type(int128).min || outputDelta < 0) {
            revert InvalidSwapDelta(inputDelta, outputDelta);
        }
        uint256 amountIn = (-inputDelta).toUint128();
        uint256 amountOut = outputDelta.toUint128();
        uint256 feeAmount = ICanonicalFeeRuntime(registry.hook()).currentFeeAmount();

        if (
            data.action == CallbackAction.QuoteExactInput
                || data.action == CallbackAction.QuoteExactOutput
        ) {
            revert QuoteResult(amountIn, amountOut, feeAmount);
        }
        if (exactInput) {
            if (amountIn != data.amount) revert PartialFill(data.amount, amountIn);
            if (amountOut < data.bound) revert SlippageExceeded(data.bound, amountOut);
        } else {
            if (amountOut != data.amount) revert PartialFill(data.amount, amountOut);
            if (amountIn > data.bound) revert SlippageExceeded(data.bound, amountIn);
        }

        _settleSwap(data, key, zeroForOne, amountIn, amountOut);
        return abi.encode(amountIn, amountOut);
    }

    function _settleSwap(
        CallbackData memory data,
        PoolKey memory key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    ) private {
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        address payer =
            data.useNative && Currency.unwrap(inputCurrency) == weth ? address(this) : data.trader;
        _settle(inputCurrency, payer, amountIn);
        ICanonicalFeeRuntime(registry.hook()).collectAccruedFee();

        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        address outputRecipient = data.useNative && Currency.unwrap(outputCurrency) == weth
            ? address(this)
            : data.recipient;
        manager.take(outputCurrency, outputRecipient, amountOut);
    }

    function _quote(CallbackData memory data)
        private
        returns (uint256 amountIn, uint256 amountOut, uint256 feeAmount)
    {
        if (!registry.isSealed()) revert InvalidConfiguration(address(registry));
        try manager.unlock(abi.encode(data)) returns (bytes memory) {
            revert InvalidQuoteResult();
        } catch (bytes memory reason) {
            if (reason.length != 100) _bubbleRevert(reason);
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
            if (selector != QuoteResult.selector) _bubbleRevert(reason);
            assembly ("memory-safe") {
                amountIn := mload(add(reason, 0x24))
                amountOut := mload(add(reason, 0x44))
                feeAmount := mload(add(reason, 0x64))
            }
        }
    }

    function _prepareNative(
        bool fuelForWeth,
        bool useNative,
        uint256 wethBudget,
        uint256 suppliedValue
    ) private returns (uint256 nativeBudget) {
        if (!useNative) {
            if (suppliedValue != 0) {
                revert InvalidNativeValue(suppliedValue, 0);
            }
            return 0;
        }
        if (fuelForWeth) {
            if (suppliedValue != 0) revert InvalidNativeValue(suppliedValue, 0);
            return 0;
        }
        if (suppliedValue != wethBudget) {
            revert InvalidNativeValue(suppliedValue, wethBudget);
        }
        IWrappedEther(weth).deposit{value: wethBudget}();
        return wethBudget;
    }

    function _finishNative(
        bool fuelForWeth,
        bool useNative,
        uint256 nativeBudget,
        uint256 amountIn,
        uint256 amountOut,
        address recipient,
        address refundRecipient
    ) private {
        if (!useNative) return;
        if (fuelForWeth) {
            IWrappedEther(weth).withdraw(amountOut);
            _sendEther(recipient, amountOut);
            return;
        }
        uint256 refund = nativeBudget - amountIn;
        if (refund != 0) {
            IWrappedEther(weth).withdraw(refund);
            _sendEther(refundRecipient, refund);
        }
    }

    function _settle(Currency currency, address payer, uint256 amount) private {
        manager.sync(currency);
        address token = Currency.unwrap(currency);
        bool transferred = payer == address(this)
            ? IERC20Minimal(token).transfer(address(manager), amount)
            : IERC20Minimal(token).transferFrom(payer, address(manager), amount);
        if (!transferred) revert ERC20TransferFailed(token);
        manager.settle();
    }

    function _validateSwap(uint256 amount, address recipient, uint256 deadline) private view {
        _validateAmount(amount);
        if (recipient == address(0)) revert ZeroRecipient();
        // A user-supplied timestamp is the intended expiry model; small validator skew is harmless.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        if (!registry.isSealed()) revert InvalidConfiguration(address(registry));
    }

    function _validateAmount(uint256 amount) private pure {
        if (amount == 0 || amount > uint256(type(int256).max)) revert InvalidAmount(amount);
    }

    function _sendEther(address recipient, uint256 amount) private {
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert EtherTransferFailed(recipient);
    }

    function _bubbleRevert(bytes memory reason) private pure {
        assembly ("memory-safe") {
            revert(add(reason, 0x20), mload(reason))
        }
    }
}
