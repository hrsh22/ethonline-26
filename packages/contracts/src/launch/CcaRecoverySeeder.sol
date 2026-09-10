// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ActionConstants
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/libraries/ActionConstants.sol";
import {Actions} from "../../lib/liquidity-launcher/lib/v4-periphery/src/libraries/Actions.sol";
import {
    LiquidityAmounts
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {ICanonicalMarketRegistry} from "../interfaces/ICanonicalMarketRegistry.sol";
import {PermanentPositionRecipient} from "./PermanentPositionRecipient.sol";
import {MigratorParameters} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {TokenPricing} from "liquidity-launcher/src/libraries/TokenPricing.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface ICcaRecoveryStrategy {
    function initializers(address auction) external view returns (MigratorParameters memory);
    function registeredPoolIds(PoolId poolId) external view returns (address);
    function poolManager() external view returns (address);
    function positionManager() external view returns (address);
}

interface ICcaRecoveryAuction {
    function token() external view returns (address);
    function currency() external view returns (address);
    function fundsRecipient() external view returns (address);
    function tokensRecipient() external view returns (address);
    function endBlock() external view returns (uint64);
    function startBlock() external view returns (uint64);
    function lbpInitializationParams()
        external
        view
        returns (uint256 price, uint256 tokensSold, uint256 currencyRaised);
    function sweepUnsoldTokens() external;
}

interface ICcaRecoveryPositionManager {
    function nextTokenId() external view returns (uint256);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

/// @notice Fixed recovery custody and a retryable full-range seed after stock LBP migration fails.
/// @dev No owner withdrawal, arbitrary call, LP approval, or alternate asset/position recipient exists.
/// The only budget spent is the failed auction's recorded reserve and raised WETH. Unsold tokens,
/// excess balances, and rounding dust stay permanently in this custody contract.
contract CcaRecoverySeeder {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    ICanonicalMarketRegistry public immutable registry;
    ICcaRecoveryStrategy public immutable strategy;
    PermanentPositionRecipient public immutable positionRecipient;
    address public immutable configurationAuthority;
    ICcaRecoveryAuction public auction;
    uint128 public reserveSupply;
    uint64 public migrationBlock;
    bool public seeded;
    bool private _entered;

    error InvalidConfiguration();
    error Unauthorized();
    error RecoveryNotReady();
    error AlreadySeeded();
    error TransferFailed();
    event AuctionConfigured(address indexed auction);
    event RecoverySeeded(uint256 indexed tokenId, uint160 sqrtPriceX96, uint128 liquidity);

    constructor(
        ICanonicalMarketRegistry registry_,
        address strategy_,
        PermanentPositionRecipient recipient_,
        address authority_
    ) {
        if (
            address(registry_).code.length == 0 || strategy_.code.length == 0
                || address(recipient_).code.length == 0 || authority_ == address(0)
        ) revert InvalidConfiguration();
        registry = registry_;
        strategy = ICcaRecoveryStrategy(strategy_);
        positionRecipient = recipient_;
        configurationAuthority = authority_;
        if (
            strategy.poolManager() != address(registry_.manager())
                || strategy.positionManager() != recipient_.positionManager()
                || PoolId.unwrap(recipient_.expectedPoolId())
                    != PoolId.unwrap(registry_.poolKey().toId())
        ) revert InvalidConfiguration();
    }

    /// @notice Bind once, after the official strategy has registered this fresh auction and before bidding.
    function configureAuction(address auction_) external {
        if (msg.sender != configurationAuthority) revert Unauthorized();
        if (address(auction) != address(0) || auction_.code.length == 0) {
            revert InvalidConfiguration();
        }
        ICcaRecoveryAuction candidate = ICcaRecoveryAuction(auction_);
        MigratorParameters memory params = strategy.initializers(auction_);
        PoolKey memory key = registry.poolKey();
        if (
            block.number >= candidate.startBlock()
                || strategy.registeredPoolIds(key.toId()) != auction_
                || params.recipient != address(this)
                || params.positionRecipient != address(positionRecipient)
                || params.token != registry.fuel() || params.currency != registry.weth()
                || params.poolParameters.hook != address(key.hooks)
                || params.poolParameters.fee != key.fee
                || params.poolParameters.tickSpacing != key.tickSpacing
                || params.migrationBlock <= candidate.endBlock()
                || params.reservedTokenAmountForLP == 0 || candidate.token() != registry.fuel()
                || candidate.currency() != registry.weth()
                || candidate.fundsRecipient() != address(strategy)
                || candidate.tokensRecipient() != address(this)
        ) revert InvalidConfiguration();
        auction = candidate;
        reserveSupply = params.reservedTokenAmountForLP;
        migrationBlock = params.migrationBlock;
        emit AuctionConfigured(auction_);
    }

    function sweepUnsoldTokens() external {
        if (address(auction) == address(0)) revert RecoveryNotReady();
        auction.sweepUnsoldTokens();
    }

    /// @notice Anyone can retry this atomic operation after the failed dependency is restored.
    function recoverAndSeed() external {
        if (seeded) revert AlreadySeeded();
        if (_entered || address(auction) == address(0) || block.number < migrationBlock) {
            revert RecoveryNotReady();
        }
        _entered = true;
        PoolKey memory key = registry.poolKey();
        (uint160 existingPrice,,,) = registry.manager().getSlot0(key.toId());
        if (
            !registry.isSealed() || existingPrice != 0
                || strategy.registeredPoolIds(key.toId()) != address(0)
        ) {
            revert RecoveryNotReady();
        }
        (uint256 finalPrice,, uint256 raised) = auction.lbpInitializationParams();
        if (
            raised == 0 || raised > uint128(type(int128).max)
                || IERC20Minimal(registry.fuel()).balanceOf(address(this)) < reserveSupply
                || IERC20Minimal(registry.weth()).balanceOf(address(this)) < raised
        ) revert RecoveryNotReady();
        uint160 sqrtPrice = TokenPricing.convertToSqrtPriceX96(
            TokenPricing.convertToPriceX192(
                finalPrice, Currency.unwrap(key.currency0) == registry.weth()
            )
        );
        registry.manager().initialize(key, sqrtPrice);
        (uint128 liquidity, bytes memory plan) = _plan(key, sqrtPrice, uint128(raised));
        address positionManager = positionRecipient.positionManager();
        uint256 tokenId = ICcaRecoveryPositionManager(positionManager).nextTokenId();
        _transfer(registry.fuel(), positionManager, reserveSupply);
        _transfer(registry.weth(), positionManager, raised);
        ICcaRecoveryPositionManager(positionManager).modifyLiquidities(plan, block.timestamp);
        positionRecipient.registerPosition(tokenId);
        seeded = true;
        _entered = false;
        emit RecoverySeeded(tokenId, sqrtPrice, liquidity);
    }

    function _plan(PoolKey memory key, uint160 sqrtPrice, uint128 raised)
        private
        view
        returns (uint128 liquidity, bytes memory plan)
    {
        int24 lower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 upper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        bool fuelFirst = Currency.unwrap(key.currency0) == registry.fuel();
        uint128 amount0 = fuelFirst ? reserveSupply : raised;
        uint128 amount1 = fuelFirst ? raised : reserveSupply;
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPrice,
            TickMath.getSqrtPriceAtTick(lower),
            TickMath.getSqrtPriceAtTick(upper),
            amount0,
            amount1
        );
        if (liquidity == 0) revert RecoveryNotReady();
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            key,
            lower,
            upper,
            uint256(liquidity),
            amount0,
            amount1,
            address(positionRecipient),
            bytes("")
        );
        params[1] = abi.encode(key.currency0, ActionConstants.CONTRACT_BALANCE, false);
        params[2] = abi.encode(key.currency1, ActionConstants.CONTRACT_BALANCE, false);
        params[3] = abi.encode(key.currency0, key.currency1, address(this));
        plan = abi.encode(
            abi.encodePacked(
                uint8(Actions.MINT_POSITION),
                uint8(Actions.SETTLE),
                uint8(Actions.SETTLE),
                uint8(Actions.TAKE_PAIR)
            ),
            params
        );
    }

    function _transfer(address token, address recipient, uint256 amount) private {
        if (!IERC20Minimal(token).transfer(recipient, amount)) revert TransferFailed();
    }
}
