// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IInitializerHook} from "../interfaces/IInitializerHook.sol";

import {CanonicalMarketRegistry} from "./CanonicalMarketRegistry.sol";

interface IFuelCanonicalPolicy {
    function validateCanonicalTrader(address trader) external view;
}

/// @notice Applies the permanent 3% Canonical Market fee entirely against its WETH leg.
contract CanonicalFeeHook is IHooks, IInitializerHook {
    using SafeCast for uint256;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant TOTAL_FEE_BPS = 300;
    uint256 public constant REWARD_FEE_BPS = 200;
    uint256 public constant LIQUIDITY_FEE_BPS = 85;

    IPoolManager private immutable _manager;
    CanonicalMarketRegistry private immutable _registry;
    address private immutable _weth;
    address public immutable rewardDestination;
    address public immutable liquidityDestination;
    address public immutable creatorDestination;

    uint256 public rewardPot;
    uint256 public liquidityPot;
    uint256 public creatorPot;
    uint256 public currentFeeAmount;
    uint256 public currentWethVolume;

    address public authorized;
    address public recoveryInitializer;

    bool private _active;
    bool private _feeCollected;
    bool private _withdrawing;
    address private _activeTrader;
    address private _activeRecipient;

    error ActiveSwap();
    error CallbackNotPoolManager(address caller);
    error ERC20TransferFailed(address token);
    error HookNotImplemented();
    error InactiveSwap();
    error FeeNotCollected();
    error InvalidConfiguration(address configured);
    error InvalidPool();
    error InvalidSwapContext();
    error Reentrancy();
    error UnauthorizedDestination(address caller);
    error UnauthorizedRouter(address caller);
    error UnauthorizedConfiguration(address caller);
    error UnauthorizedInitializer(address caller);
    error InitializerAlreadyConfigured(address initializer);
    error RecoveryInitializerAlreadyConfigured(address initializer);
    error RegistryAlreadySealed();

    event FeeAccrued(
        address indexed trader,
        uint256 wethVolume,
        uint256 totalFee,
        uint256 rewardAmount,
        uint256 liquidityAmount,
        uint256 creatorAmount
    );
    event PotPulled(address indexed destination, uint256 amount);
    event InitializerConfigured(address indexed initializer);
    event RecoveryInitializerConfigured(address indexed initializer);

    constructor(
        IPoolManager manager_,
        CanonicalMarketRegistry registry_,
        address weth_,
        address rewardDestination_,
        address liquidityDestination_,
        address creatorDestination_
    ) {
        if (
            address(manager_).code.length == 0 || address(registry_).code.length == 0
                || weth_.code.length == 0 || rewardDestination_ == address(0)
                || liquidityDestination_ == address(0) || creatorDestination_ == address(0)
        ) {
            revert InvalidConfiguration(address(0));
        }
        _manager = manager_;
        _registry = registry_;
        _weth = weth_;
        rewardDestination = rewardDestination_;
        liquidityDestination = liquidityDestination_;
        creatorDestination = creatorDestination_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(_manager)) revert CallbackNotPoolManager(msg.sender);
        _;
    }

    function manager() external view returns (address) {
        return address(_manager);
    }

    function registry() external view returns (address) {
        return address(_registry);
    }

    function weth() external view returns (address) {
        return _weth;
    }

    /// @notice Binds the one strategy allowed to initialize the canonical pool.
    /// @dev Configuration is one-time. An unconfigured hook rejects every initialization.
    function configureInitializer(address initializer) external {
        if (msg.sender != _registry.owner()) revert UnauthorizedConfiguration(msg.sender);
        if (authorized != address(0)) revert InitializerAlreadyConfigured(authorized);
        if (initializer.code.length == 0) revert InvalidConfiguration(initializer);
        authorized = initializer;
        emit InitializerConfigured(initializer);
    }

    /// @notice Binds the sole fallback initializer used after a terminal CCA migration failure.
    /// @dev The fallback must be fixed before the canonical registry is sealed. Its own entrypoint
    ///      is responsible for proving the committed migration failed before it calls PoolManager.
    function configureRecoveryInitializer(address initializer) external {
        if (msg.sender != _registry.owner()) revert UnauthorizedConfiguration(msg.sender);
        if (_registry.isSealed()) revert RegistryAlreadySealed();
        if (recoveryInitializer != address(0)) {
            revert RecoveryInitializerAlreadyConfigured(recoveryInitializer);
        }
        if (initializer.code.length == 0 || initializer == authorized) {
            revert InvalidConfiguration(initializer);
        }
        recoveryInitializer = initializer;
        emit RecoveryInitializerConfigured(initializer);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IInitializerHook).interfaceId || interfaceId == 0x01ffc9a7;
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        if (!_registry.isSealed() || !_registry.isRegisteredPool(key)) revert InvalidPool();
        if (sender != _registry.router()) revert UnauthorizedRouter(sender);
        if (_active) revert ActiveSwap();
        (address trader, address recipient) = abi.decode(hookData, (address, address));
        if (trader == address(0) || recipient == address(0)) revert InvalidSwapContext();
        IFuelCanonicalPolicy(_registry.fuel()).validateCanonicalTrader(trader);

        _active = true;
        _activeTrader = trader;
        _activeRecipient = recipient;
        currentFeeAmount = 0;
        currentWethVolume = 0;
        _feeCollected = false;

        bool specifiedTokenIs0 = (params.amountSpecified < 0 == params.zeroForOne);
        Currency specifiedCurrency = specifiedTokenIs0 ? key.currency0 : key.currency1;
        int128 specifiedFeeDelta;
        if (Currency.unwrap(specifiedCurrency) == _weth) {
            uint256 specifiedAmount = _absolute(params.amountSpecified);
            uint256 wethVolume =
                params.amountSpecified < 0 ? specifiedAmount : grossWethVolume(specifiedAmount);
            uint256 feeAmount = _accrue(wethVolume);
            specifiedFeeDelta = feeAmount.toInt128();
        }

        return (
            IHooks.beforeSwap.selector,
            toBeforeSwapDelta(specifiedFeeDelta, 0),
            LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        if (!_active || sender != _registry.router()) revert InactiveSwap();
        (address trader, address recipient) = abi.decode(hookData, (address, address));
        if (trader != _activeTrader || recipient != _activeRecipient) {
            revert InvalidSwapContext();
        }

        bool specifiedTokenIs0 = (params.amountSpecified < 0 == params.zeroForOne);
        Currency unspecifiedCurrency = specifiedTokenIs0 ? key.currency1 : key.currency0;
        int128 unspecifiedFeeDelta;
        if (Currency.unwrap(unspecifiedCurrency) == _weth) {
            int128 wethDelta = specifiedTokenIs0 ? delta.amount1() : delta.amount0();
            uint256 unspecifiedAmount = _absolute(wethDelta);
            uint256 wethVolume =
                params.amountSpecified < 0 ? unspecifiedAmount : grossWethVolume(unspecifiedAmount);
            uint256 feeAmount = _accrue(wethVolume);
            unspecifiedFeeDelta = feeAmount.toInt128();
        }
        return (IHooks.afterSwap.selector, unspecifiedFeeDelta);
    }

    function collectAccruedFee() external {
        if (msg.sender != _registry.router()) revert UnauthorizedRouter(msg.sender);
        if (!_active || _feeCollected) revert InactiveSwap();
        _feeCollected = true;
        uint256 feeAmount = currentFeeAmount;
        if (feeAmount != 0) {
            _manager.take(Currency.wrap(_weth), address(this), feeAmount);
        }
    }

    function closeSettlement(address trader) external {
        if (msg.sender != _registry.router()) revert UnauthorizedRouter(msg.sender);
        if (!_active || trader != _activeTrader) revert InactiveSwap();
        if (!_feeCollected) revert FeeNotCollected();
        _active = false;
        delete _activeTrader;
        delete _activeRecipient;
        delete currentFeeAmount;
        delete currentWethVolume;
    }

    function isAuthorizedFuelSettlement(address operator, address from, address to)
        external
        view
        returns (bool)
    {
        if (!_active) return false;
        address poolManager = address(_manager);
        address canonicalRouter = _registry.router();
        bool inputSettlement =
            operator == canonicalRouter && from == _activeTrader && to == poolManager;
        bool outputSettlement =
            operator == poolManager && from == poolManager && to == _activeRecipient;
        return inputSettlement || outputSettlement;
    }

    function feeAmounts(uint256 wethVolume)
        public
        pure
        returns (
            uint256 totalFee,
            uint256 rewardAmount,
            uint256 liquidityAmount,
            uint256 creatorAmount
        )
    {
        totalFee = wethVolume * TOTAL_FEE_BPS / FEE_DENOMINATOR;
        rewardAmount = wethVolume * REWARD_FEE_BPS / FEE_DENOMINATOR;
        liquidityAmount = wethVolume * LIQUIDITY_FEE_BPS / FEE_DENOMINATOR;
        creatorAmount = totalFee - rewardAmount - liquidityAmount;
    }

    /// @notice Returns the gross WETH leg whose post-fee remainder equals `netWeth`.
    function grossWethVolume(uint256 netWeth) public pure returns (uint256) {
        return netWeth * FEE_DENOMINATOR / (FEE_DENOMINATOR - TOTAL_FEE_BPS);
    }

    function pullRewardPot(uint256 amount) external {
        if (msg.sender != rewardDestination) revert UnauthorizedDestination(msg.sender);
        rewardPot -= amount;
        _transferPot(rewardDestination, amount);
    }

    function pullLiquidityPot(uint256 amount) external {
        if (msg.sender != liquidityDestination) revert UnauthorizedDestination(msg.sender);
        liquidityPot -= amount;
        _transferPot(liquidityDestination, amount);
    }

    function pullCreatorPot(uint256 amount) external {
        if (msg.sender != creatorDestination) revert UnauthorizedDestination(msg.sender);
        creatorPot -= amount;
        _transferPot(creatorDestination, amount);
    }

    function _accrue(uint256 wethVolume) private returns (uint256 totalFee) {
        uint256 rewardAmount;
        uint256 liquidityAmount;
        uint256 creatorAmount;
        (totalFee, rewardAmount, liquidityAmount, creatorAmount) = feeAmounts(wethVolume);
        currentFeeAmount = totalFee;
        currentWethVolume = wethVolume;
        if (totalFee != 0) {
            rewardPot += rewardAmount;
            liquidityPot += liquidityAmount;
            creatorPot += creatorAmount;
        }
        emit FeeAccrued(
            _activeTrader, wethVolume, totalFee, rewardAmount, liquidityAmount, creatorAmount
        );
    }

    function _transferPot(address destination, uint256 amount) private {
        if (_active || _withdrawing) revert Reentrancy();
        _withdrawing = true;
        if (!IERC20Minimal(_weth).transfer(destination, amount)) {
            revert ERC20TransferFailed(_weth);
        }
        _withdrawing = false;
        emit PotPulled(destination, amount);
    }

    function _absolute(int256 amount) private pure returns (uint256) {
        return uint256(amount < 0 ? -amount : amount);
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != authorized && sender != recoveryInitializer) {
            revert UnauthorizedInitializer(sender);
        }
        if (!_registry.isSealed() || !_registry.isRegisteredPool(key)) revert InvalidPool();
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
