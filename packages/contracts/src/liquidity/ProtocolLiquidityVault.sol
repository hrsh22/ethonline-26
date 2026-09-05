// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {TwoStepOwnable} from "../governance/TwoStepOwnable.sol";
import {ICanonicalFeeHook} from "../interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../interfaces/ICanonicalMarketRegistry.sol";

/// @notice Permanently owns WETH-only Protocol-Owned Liquidity in the Canonical Market.
contract ProtocolLiquidityVault is IUnlockCallback, TwoStepOwnable {
    using SafeCast for int128;
    using StateLibrary for IPoolManager;

    ICanonicalMarketRegistry public immutable registry;
    IPoolManager public immutable manager;
    address public immutable fuel;
    address public immutable weth;
    bool public immutable wethIsCurrency0;

    address public executor;
    ICanonicalFeeHook public canonicalFeeHook;
    bool public configurationSealed;
    bool public paused;
    uint256 public queuedWeth;
    uint256 public permanentlyLockedWeth;
    uint256 public liquidityCycleCount;

    struct ActiveCycle {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 maximumWeth;
        bytes32 positionSalt;
    }

    ActiveCycle private _activeCycle;
    bool private _cycleActive;
    bool private _unlocking;

    error CallbackNotPoolManager(address caller);
    error ConfigurationAlreadySealed();
    error ConfigurationMismatch(address expected, address actual);
    error ConfigurationNotSealed();
    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error ERC20TransferFailed(address token);
    error InvalidConfiguration(address configured);
    error InvalidLiquidityDelta(uint128 liquidity);
    error InvalidTickRange(int24 tickLower, int24 tickUpper, int24 tickSpacing);
    error InvalidWethOnlyDelta(int128 fuelDelta, int128 wethDelta);
    error MaximumWethExceeded(uint256 maximum, uint256 required);
    error Paused();
    error QueuedWethExceeded(uint256 available, uint256 required);
    error Reentrancy();
    error UnauthorizedCallback();
    error UnauthorizedExecutor(address caller);
    error UnauthorizedOwner(address caller);
    error UnexpectedPositionLiquidity(uint128 expected, uint128 actual);
    error UnexpectedWethPull(uint256 expected, uint256 measured);
    error UnexpectedWethSpend(uint256 expected, uint256 measured);

    event CanonicalFeeHookConfigured(address indexed hook);
    event ConfigurationSealedForever(address indexed hook, address indexed liquidityDestination);
    event ExecutorReplaced(address indexed previousExecutor, address indexed replacementExecutor);
    event PausedSet(bool paused);
    event ProtocolLiquidityAdded(
        uint256 indexed cycleNumber,
        bytes32 indexed positionSalt,
        uint256 pulledWeth,
        uint256 consumedWeth,
        uint256 queuedWeth,
        uint256 permanentlyLockedWeth,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );

    constructor(ICanonicalMarketRegistry registry_, address owner_, address executor_)
        TwoStepOwnable(owner_)
    {
        if (address(registry_).code.length == 0) {
            revert InvalidConfiguration(address(registry_));
        }
        // A zero owner is rejected by TwoStepOwnable, whose constructor runs
        // first, so only the executor needs a check here.
        if (executor_ == address(0)) revert InvalidConfiguration(executor_);
        IPoolManager manager_ = registry_.manager();
        address fuel_ = registry_.fuel();
        address weth_ = registry_.weth();
        if (
            address(manager_).code.length == 0 || fuel_.code.length == 0 || weth_.code.length == 0
                || fuel_ == weth_
        ) {
            revert InvalidConfiguration(address(registry_));
        }
        registry = registry_;
        manager = manager_;
        fuel = fuel_;
        weth = weth_;
        executor = executor_;
        wethIsCurrency0 = weth_ < fuel_;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert UnauthorizedExecutor(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    function configureCanonicalFeeHook(ICanonicalFeeHook hook) external onlyOwner {
        if (configurationSealed) revert ConfigurationAlreadySealed();
        canonicalFeeHook = hook;
        emit CanonicalFeeHookConfigured(address(hook));
    }

    function sealConfiguration() external onlyOwner {
        if (configurationSealed) revert ConfigurationAlreadySealed();
        if (!registry.isSealed()) revert InvalidConfiguration(address(registry));
        address hookAddress = address(canonicalFeeHook);
        if (hookAddress.code.length == 0) revert InvalidConfiguration(hookAddress);
        address registeredHook = registry.hook();
        if (hookAddress != registeredHook) {
            revert ConfigurationMismatch(registeredHook, hookAddress);
        }
        address configuredManager = canonicalFeeHook.manager();
        if (configuredManager != address(manager)) {
            revert ConfigurationMismatch(address(manager), configuredManager);
        }
        address configuredRegistry = canonicalFeeHook.registry();
        if (configuredRegistry != address(registry)) {
            revert ConfigurationMismatch(address(registry), configuredRegistry);
        }
        address configuredWeth = canonicalFeeHook.weth();
        if (configuredWeth != weth) {
            revert ConfigurationMismatch(weth, configuredWeth);
        }
        address configuredLiquidityDestination = canonicalFeeHook.liquidityDestination();
        if (configuredLiquidityDestination != address(this)) {
            revert ConfigurationMismatch(address(this), configuredLiquidityDestination);
        }
        configurationSealed = true;
        emit ConfigurationSealedForever(hookAddress, address(this));
    }

    function setExecutor(address replacement) external onlyOwner {
        if (replacement == address(0)) revert InvalidConfiguration(replacement);
        address previousExecutor = executor;
        executor = replacement;
        emit ExecutorReplaced(previousExecutor, replacement);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function availableLiquidityPot() external view returns (uint256) {
        return canonicalFeeHook.liquidityPot();
    }

    function totalVaultWeth() external view returns (uint256) {
        return IERC20Minimal(weth).balanceOf(address(this));
    }

    function cyclePositionSalt(uint256 cycleNumber) public pure returns (bytes32) {
        return bytes32(cycleNumber);
    }

    function addLiquidityCycle(
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 maximumWeth,
        uint256 deadline
    ) external onlyExecutor whenNotPaused returns (uint256 consumedWeth) {
        if (_cycleActive) revert Reentrancy();
        if (!configurationSealed) revert ConfigurationNotSealed();
        // The bounded executor transaction intentionally uses the current block timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert DeadlineExpired(deadline, block.timestamp);

        _validateCycle(tickLower, tickUpper, liquidity);

        _cycleActive = true;
        uint256 cycleNumber = liquidityCycleCount + 1;
        _activeCycle = ActiveCycle({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            maximumWeth: maximumWeth,
            positionSalt: cyclePositionSalt(cycleNumber)
        });
        uint256 pulledWeth = _pullQueuedWeth(maximumWeth);
        consumedWeth = _executeActiveCycle();
        _completeCycle(cycleNumber, pulledWeth, consumedWeth);
    }

    function _completeCycle(uint256 cycleNumber, uint256 pulledWeth, uint256 consumedWeth) private {
        ActiveCycle memory cycle = _activeCycle;
        queuedWeth -= consumedWeth;
        permanentlyLockedWeth += consumedWeth;
        liquidityCycleCount = cycleNumber;
        delete _activeCycle;
        _cycleActive = false;
        emit ProtocolLiquidityAdded(
            cycleNumber,
            cycle.positionSalt,
            pulledWeth,
            consumedWeth,
            queuedWeth,
            permanentlyLockedWeth,
            cycle.tickLower,
            cycle.tickUpper,
            cycle.liquidity
        );
    }

    function _executeActiveCycle() private returns (uint256 consumedWeth) {
        uint256 balanceBeforeUnlock = IERC20Minimal(weth).balanceOf(address(this));
        _unlocking = true;
        consumedWeth = abi.decode(manager.unlock(bytes("")), (uint256));
        _unlocking = false;
        uint256 measuredSpend = balanceBeforeUnlock - IERC20Minimal(weth).balanceOf(address(this));
        if (measuredSpend != consumedWeth) revert UnexpectedWethSpend(consumedWeth, measuredSpend);
    }

    function _pullQueuedWeth(uint256 maximumWeth) private returns (uint256 pulledWeth) {
        uint256 queueBefore = queuedWeth;
        uint256 pullCapacity = maximumWeth > queueBefore ? maximumWeth - queueBefore : 0;
        uint256 availablePot = canonicalFeeHook.liquidityPot();
        pulledWeth = availablePot < pullCapacity ? availablePot : pullCapacity;
        uint256 balanceBeforePull = IERC20Minimal(weth).balanceOf(address(this));
        if (pulledWeth != 0) canonicalFeeHook.pullLiquidityPot(pulledWeth);
        uint256 measuredPull = IERC20Minimal(weth).balanceOf(address(this)) - balanceBeforePull;
        if (measuredPull != pulledWeth) revert UnexpectedWethPull(pulledWeth, measuredPull);
        queuedWeth = queueBefore + pulledWeth;
    }

    function _validateCycle(int24 tickLower, int24 tickUpper, uint128 liquidity) private view {
        int24 tickSpacing = registry.poolKey().tickSpacing;
        if (tickLower >= tickUpper || tickLower % tickSpacing != 0 || tickUpper % tickSpacing != 0)
        {
            revert InvalidTickRange(tickLower, tickUpper, tickSpacing);
        }
        if (liquidity == 0 || liquidity > uint128(type(int128).max)) {
            revert InvalidLiquidityDelta(liquidity);
        }
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallbackNotPoolManager(msg.sender);
        if (!_cycleActive || !_unlocking) revert UnauthorizedCallback();

        ActiveCycle memory cycle = _activeCycle;
        PoolKey memory key = registry.poolKey();
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: cycle.tickLower,
                tickUpper: cycle.tickUpper,
                liquidityDelta: int256(uint256(cycle.liquidity)),
                salt: cycle.positionSalt
            }),
            bytes("")
        );
        int128 wethDelta = wethIsCurrency0 ? delta.amount0() : delta.amount1();
        int128 fuelDelta = wethIsCurrency0 ? delta.amount1() : delta.amount0();
        if (fuelDelta != 0 || wethDelta >= 0 || wethDelta == type(int128).min) {
            revert InvalidWethOnlyDelta(fuelDelta, wethDelta);
        }
        uint256 consumedWeth = (-wethDelta).toUint128();
        if (consumedWeth > cycle.maximumWeth) {
            revert MaximumWethExceeded(cycle.maximumWeth, consumedWeth);
        }
        uint256 availableQueue = queuedWeth;
        if (consumedWeth > availableQueue) {
            revert QueuedWethExceeded(availableQueue, consumedWeth);
        }

        Currency wethCurrency = wethIsCurrency0 ? key.currency0 : key.currency1;
        manager.sync(wethCurrency);
        if (!IERC20Minimal(weth).transfer(address(manager), consumedWeth)) {
            revert ERC20TransferFailed(weth);
        }
        manager.settle();

        PoolId poolId = key.toId();
        (uint128 positionLiquidity,,) = manager.getPositionInfo(
            poolId, address(this), cycle.tickLower, cycle.tickUpper, cycle.positionSalt
        );
        if (positionLiquidity != cycle.liquidity) {
            revert UnexpectedPositionLiquidity(cycle.liquidity, positionLiquidity);
        }
        return abi.encode(consumedWeth);
    }
}
