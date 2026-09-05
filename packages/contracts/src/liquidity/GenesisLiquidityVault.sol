// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {ICanonicalMarketRegistry} from "../interfaces/ICanonicalMarketRegistry.sol";

interface IGenesisLiquidToken is IERC20Minimal {
    function totalSupply() external view returns (uint256);

    function permanentCount() external view returns (uint16);

    function availableIdentityCount() external view returns (uint16);

    function totalTransientCount() external view returns (uint16);

    function totalPendingDiscoveryCount() external view returns (uint256);

    function launched() external view returns (bool);

    function isDiscoveryExempt(address account) external view returns (bool);
}

/// @notice Initializes and permanently owns the one-sided Genesis Liquidity position.
contract GenesisLiquidityVault is IUnlockCallback {
    using SafeCast for int128;
    using SafeCast for uint256;
    using StateLibrary for IPoolManager;

    uint256 public constant GENESIS_SUPPLY = 4_444 ether;
    /// @dev FullMath floors liquidity and v4 rounds the owed token delta up, leaving two wei.
    uint256 public constant MAX_ROUNDING_DUST = 2;
    int24 public constant TICK_SPACING = 60;
    int24 public constant OPENING_ABSOLUTE_TICK = 51_600;
    bytes32 public constant POSITION_SALT = bytes32(0);

    ICanonicalMarketRegistry public immutable registry;
    IPoolManager public immutable manager;
    IGenesisLiquidToken public immutable liquidToken;
    address public immutable weth;
    address public immutable operator;
    bool public immutable liquidTokenIsCurrency0;
    int24 public immutable openingTick;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint160 public immutable openingSqrtPriceX96;
    uint128 public immutable targetLiquidity;

    bool public seeded;
    uint128 public seededLiquidity;
    uint256 public seededLiquidTokenAmount;
    uint256 public roundingDust;
    uint256 public managerLiquidTokenBalanceBefore;

    bool private _unlocking;

    error AlreadySeeded();
    error CallbackNotPoolManager(address caller);
    error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error EconomicUnitsMismatch(uint256 actual, uint256 expected);
    error ERC20TransferFailed(address token);
    error GenesisAllowanceInsufficient(uint256 actual, uint256 required);
    error GenesisLiquidTokenBalanceMismatch(uint256 actual, uint256 expected);
    error GenesisDiscoveryStateChanged();
    error InvalidConfiguration(address configured);
    error InvalidPoolKey();
    error InvalidSeedDelta(int128 liquidTokenDelta, int128 wethDelta);
    error LiquidityMismatch(uint128 actual, uint128 expected);
    error NotExempt(address account);
    error NotOperator(address caller);
    error PoolAlreadyInitialized(PoolId poolId);
    error PostconditionFailed();
    error RoundingDustExceeded(uint256 actual, uint256 maximum);
    error TradingAlreadyLaunched();
    error UnauthorizedCallback();
    error UnexpectedVaultLiquidTokenBalance(uint256 actual);

    event GenesisLiquiditySeeded(
        PoolId indexed poolId,
        uint128 liquidity,
        uint256 liquidTokenAmount,
        uint256 roundingDust,
        int24 tickLower,
        int24 tickUpper
    );

    constructor(ICanonicalMarketRegistry registry_, address operator_) {
        if (address(registry_).code.length == 0 || operator_ == address(0)) {
            revert InvalidConfiguration(address(registry_));
        }
        if (!registry_.isSealed()) revert InvalidConfiguration(address(registry_));

        IPoolManager manager_ = registry_.manager();
        address liquidToken_ = registry_.fuel();
        address weth_ = registry_.weth();
        PoolKey memory key = registry_.poolKey();
        bool liquidTokenIsCurrency0_ = Currency.unwrap(key.currency0) == liquidToken_;
        bool pairMatches = liquidTokenIsCurrency0_
            ? Currency.unwrap(key.currency1) == weth_
            : Currency.unwrap(key.currency0) == weth_
                && Currency.unwrap(key.currency1) == liquidToken_;
        if (
            address(manager_).code.length == 0 || liquidToken_.code.length == 0
                || weth_.code.length == 0 || !registry_.isRegisteredPool(key)
                || key.tickSpacing != TICK_SPACING || !pairMatches
        ) {
            revert InvalidPoolKey();
        }

        int24 openingTick_ =
            liquidTokenIsCurrency0_ ? -OPENING_ABSOLUTE_TICK : OPENING_ABSOLUTE_TICK;
        int24 tickLower_ =
            liquidTokenIsCurrency0_ ? openingTick_ : TickMath.minUsableTick(TICK_SPACING);
        int24 tickUpper_ =
            liquidTokenIsCurrency0_ ? TickMath.maxUsableTick(TICK_SPACING) : openingTick_;
        uint160 openingSqrtPriceX96_ = TickMath.getSqrtPriceAtTick(openingTick_);

        registry = registry_;
        manager = manager_;
        liquidToken = IGenesisLiquidToken(liquidToken_);
        weth = weth_;
        operator = operator_;
        liquidTokenIsCurrency0 = liquidTokenIsCurrency0_;
        openingTick = openingTick_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
        openingSqrtPriceX96 = openingSqrtPriceX96_;
        targetLiquidity = _liquidityForLiquidToken(
            liquidTokenIsCurrency0_,
            TickMath.getSqrtPriceAtTick(tickLower_),
            TickMath.getSqrtPriceAtTick(tickUpper_),
            GENESIS_SUPPLY
        );
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    function initializeAndSeed(uint256 deadline) external onlyOperator {
        // A bounded deployment transaction intentionally uses the current block timestamp.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert DeadlineExpired(deadline, block.timestamp);
        _validatePreflight();

        PoolKey memory key = registry.poolKey();
        PoolId poolId = key.toId();
        if (!liquidToken.transferFrom(operator, address(this), GENESIS_SUPPLY)) {
            revert ERC20TransferFailed(address(liquidToken));
        }
        uint256 fundedBalance = liquidToken.balanceOf(address(this));
        if (fundedBalance != GENESIS_SUPPLY) {
            revert GenesisLiquidTokenBalanceMismatch(fundedBalance, GENESIS_SUPPLY);
        }
        uint256 managerLiquidTokenBefore = liquidToken.balanceOf(address(manager));

        manager.initialize(key, openingSqrtPriceX96);
        _unlocking = true;
        (uint256 liquidTokenAmount, uint128 liquidity) =
            abi.decode(manager.unlock(bytes("")), (uint256, uint128));
        _unlocking = false;

        uint256 dust = liquidToken.balanceOf(address(this));
        seededLiquidTokenAmount = liquidTokenAmount;
        seededLiquidity = liquidity;
        roundingDust = dust;
        managerLiquidTokenBalanceBefore = managerLiquidTokenBefore;
        seeded = true;
        _validateSeededPostconditions();
        emit GenesisLiquiditySeeded(
            poolId, liquidity, liquidTokenAmount, dust, tickLower, tickUpper
        );
    }

    function validatePreflight() external view {
        _validatePreflight();
    }

    function validateSeededPostconditions() external view {
        _validateSeededPostconditions();
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallbackNotPoolManager(msg.sender);
        if (!_unlocking || seeded) revert UnauthorizedCallback();

        PoolKey memory key = registry.poolKey();
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(targetLiquidity)),
                salt: POSITION_SALT
            }),
            bytes("")
        );
        int128 liquidTokenDelta = liquidTokenIsCurrency0 ? delta.amount0() : delta.amount1();
        int128 wethDelta = liquidTokenIsCurrency0 ? delta.amount1() : delta.amount0();
        if (liquidTokenDelta >= 0 || liquidTokenDelta == type(int128).min || wethDelta != 0) {
            revert InvalidSeedDelta(liquidTokenDelta, wethDelta);
        }

        uint256 liquidTokenAmount = (-liquidTokenDelta).toUint128();
        manager.sync(liquidTokenIsCurrency0 ? key.currency0 : key.currency1);
        if (!liquidToken.transfer(address(manager), liquidTokenAmount)) {
            revert ERC20TransferFailed(address(liquidToken));
        }
        manager.settle();
        return abi.encode(liquidTokenAmount, targetLiquidity);
    }

    function _validatePreflight() private view {
        if (seeded || _unlocking) revert AlreadySeeded();
        if (liquidToken.launched()) revert TradingAlreadyLaunched();
        if (!liquidToken.isDiscoveryExempt(address(this))) revert NotExempt(address(this));
        if (!liquidToken.isDiscoveryExempt(address(manager))) revert NotExempt(address(manager));
        PoolKey memory key = registry.poolKey();
        if (!registry.isSealed() || !registry.isRegisteredPool(key)) revert InvalidPoolKey();
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(poolId);
        if (sqrtPriceX96 != 0) revert PoolAlreadyInitialized(poolId);
        uint256 vaultLiquidTokenBalance = liquidToken.balanceOf(address(this));
        if (vaultLiquidTokenBalance != 0) {
            revert UnexpectedVaultLiquidTokenBalance(vaultLiquidTokenBalance);
        }
        uint256 operatorBalance = liquidToken.balanceOf(operator);
        if (operatorBalance != GENESIS_SUPPLY) {
            revert GenesisLiquidTokenBalanceMismatch(operatorBalance, GENESIS_SUPPLY);
        }
        uint256 allowance_ = liquidToken.allowance(operator, address(this));
        if (allowance_ < GENESIS_SUPPLY) {
            revert GenesisAllowanceInsufficient(allowance_, GENESIS_SUPPLY);
        }
        _validateGenesisState();
    }

    function _validateSeededPostconditions() private view {
        if (!seeded || _unlocking) revert PostconditionFailed();
        PoolKey memory key = registry.poolKey();
        if (!registry.isSealed() || !registry.isRegisteredPool(key)) revert InvalidPoolKey();
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);
        if (sqrtPriceX96 != openingSqrtPriceX96 || currentTick != openingTick) {
            revert PostconditionFailed();
        }
        (uint128 positionLiquidity,,) =
            manager.getPositionInfo(poolId, address(this), tickLower, tickUpper, POSITION_SALT);
        if (seededLiquidity != targetLiquidity || positionLiquidity != targetLiquidity) {
            revert LiquidityMismatch(positionLiquidity, targetLiquidity);
        }
        if (roundingDust > MAX_ROUNDING_DUST) {
            revert RoundingDustExceeded(roundingDust, MAX_ROUNDING_DUST);
        }
        if (
            seededLiquidTokenAmount + roundingDust != GENESIS_SUPPLY
                || liquidToken.balanceOf(address(this)) != roundingDust
                || liquidToken.balanceOf(address(manager))
                    != managerLiquidTokenBalanceBefore + seededLiquidTokenAmount
        ) {
            revert PostconditionFailed();
        }
        _validateGenesisState();
    }

    function _validateGenesisState() private view {
        uint256 economicUnits =
            liquidToken.totalSupply() + uint256(liquidToken.permanentCount()) * 1 ether;
        if (economicUnits != GENESIS_SUPPLY) {
            revert EconomicUnitsMismatch(economicUnits, GENESIS_SUPPLY);
        }
        if (
            liquidToken.availableIdentityCount() != 4_444 || liquidToken.totalTransientCount() != 0
                || liquidToken.totalPendingDiscoveryCount() != 0
        ) {
            revert GenesisDiscoveryStateChanged();
        }
    }

    function _liquidityForLiquidToken(
        bool liquidTokenIsCurrency0_,
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount
    ) private pure returns (uint128 liquidity) {
        uint256 rawLiquidity;
        if (liquidTokenIsCurrency0_) {
            uint256 intermediate = FullMath.mulDiv(sqrtPriceAX96, sqrtPriceBX96, FixedPoint96.Q96);
            rawLiquidity = FullMath.mulDiv(amount, intermediate, sqrtPriceBX96 - sqrtPriceAX96);
        } else {
            rawLiquidity = FullMath.mulDiv(amount, FixedPoint96.Q96, sqrtPriceBX96 - sqrtPriceAX96);
        }
        if (rawLiquidity == 0 || rawLiquidity > uint256(uint128(type(int128).max))) {
            revert InvalidConfiguration(address(0));
        }
        liquidity = rawLiquidity.toUint128();
    }
}
