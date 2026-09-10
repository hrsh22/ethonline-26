// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {
    ContinuousClearingAuctionFactory
} from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
import {
    AuctionParameters
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {LBPStrategy} from "liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import {PositionDefinition} from "liquidity-launcher/src/types/PositionPlannerTypes.sol";

interface ICcaFixtureToken {
    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

contract CcaUpstreamPoolManagerStub {
    function extsload(bytes32) external pure returns (bytes32 value) {
        return value;
    }
}

/// @dev Keeps the launcher's v4 types behind an address-only boundary. They are a different
/// source identity from the application's existing v4-core checkout.
contract CcaUpstreamFixture {
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint24 private constant MPS = 10_000_000;
    uint24 private constant STEP_MPS = 1_000_000;
    uint64 private constant AUCTION_DURATION = 10;
    uint40 private constant STEP_DURATION = 10;
    uint256 private constant Q96 = 1 << 96;

    error LbpSaltNotFound();
    error LbpStrategyDeploymentFailed();

    struct Deployment {
        address factory;
        address strategy;
        address auction;
        address poolManager;
        uint128 auctionSupply;
        uint128 reserveSupply;
    }

    function deployAuction(address token, uint128 totalSupply)
        external
        returns (Deployment memory deployment)
    {
        require(totalSupply > 1, "total supply too small");

        deployment.factory = address(new ContinuousClearingAuctionFactory(address(0)));
        deployment.poolManager = address(new CcaUpstreamPoolManagerStub());
        deployment.strategy =
            _deployLbpStrategy(deployment.factory, deployment.poolManager, address(0xBEEF));
        deployment.reserveSupply = totalSupply / 10;
        deployment.auctionSupply = totalSupply - deployment.reserveSupply;

        uint64 startBlock = uint64(block.number);
        uint64 endBlock = startBlock + AUCTION_DURATION;
        MigratorParameters memory migrationParams =
            _migrationParams(token, deployment.strategy, deployment.reserveSupply, endBlock + 1);
        bytes memory auctionConfig = _auctionConfig(deployment.strategy, startBlock, endBlock);
        bytes32 distributionSalt = keccak256("cca-upstream-smoke");
        bytes32 initializerSalt = keccak256(abi.encode(distributionSalt, migrationParams));

        deployment.auction = address(
            ContinuousClearingAuctionFactory(deployment.factory)
                .getAddress(
                    token,
                    deployment.auctionSupply,
                    auctionConfig,
                    initializerSalt,
                    deployment.strategy
                )
        );

        require(ICcaFixtureToken(token).approve(deployment.strategy, totalSupply), "approve failed");
        LBPStrategy(payable(deployment.strategy))
            .initializeDistribution(
                token, totalSupply, abi.encode(migrationParams, auctionConfig), distributionSalt
            );
    }

    function auctionState(address auction)
        external
        view
        returns (
            address token,
            uint128 totalSupply,
            address tokensRecipient,
            address fundsRecipient,
            uint64 startBlock,
            uint64 endBlock,
            uint64 claimBlock
        )
    {
        ContinuousClearingAuction cca = ContinuousClearingAuction(payable(auction));
        return (
            cca.token(),
            cca.totalSupply(),
            cca.tokensRecipient(),
            cca.fundsRecipient(),
            cca.startBlock(),
            cca.endBlock(),
            cca.claimBlock()
        );
    }

    function strategyState(address strategy, address auction)
        external
        view
        returns (
            address initializerFactory,
            address poolManager,
            address positionManager,
            uint64 migrationBlock,
            uint128 reserveSupply,
            address token
        )
    {
        LBPStrategy lbp = LBPStrategy(payable(strategy));
        MigratorParameters memory migrationParams = lbp.initializers(ILBPInitializer(auction));
        return (
            address(lbp.initializerFactory()),
            address(lbp.poolManager()),
            address(lbp.positionManager()),
            migrationParams.migrationBlock,
            migrationParams.reservedTokenAmountForLP,
            migrationParams.token
        );
    }

    function _deployLbpStrategy(address factory, address poolManager, address positionManager)
        private
        returns (address strategy)
    {
        bytes memory initCode = abi.encodePacked(
            type(LBPStrategy).creationCode, abi.encode(positionManager, poolManager, factory)
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        bool found;

        for (uint256 i; i < 100_000; ++i) {
            salt = bytes32(i);
            address predicted = address(
                uint160(
                    uint256(
                        keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                    )
                )
            );
            if (uint160(predicted) & ALL_HOOK_MASK == BEFORE_INITIALIZE_FLAG) {
                found = true;
                break;
            }
        }
        if (!found) revert LbpSaltNotFound();

        assembly ("memory-safe") {
            strategy := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (strategy == address(0)) revert LbpStrategyDeploymentFailed();
    }

    function _migrationParams(
        address token,
        address strategy,
        uint128 reserveSupply,
        uint64 migrationBlock
    ) private view returns (MigratorParameters memory params) {
        PositionDefinition[] memory positions = new PositionDefinition[](0);
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: MPS});

        params = MigratorParameters({
            token: token,
            currency: address(0),
            migrationBlock: migrationBlock,
            reservedTokenAmountForLP: reserveSupply,
            recipient: address(this),
            positionRecipient: address(0xCAFE),
            poolParameters: PoolParameters({fee: 3_000, tickSpacing: 60, hook: address(0)}),
            positionDefinitions: abi.encode(positions),
            lpAllocationSchedule: abi.encode(brackets)
        });

        require(strategy != address(this), "invalid strategy");
    }

    function _auctionConfig(address strategy, uint64 startBlock, uint64 endBlock)
        private
        view
        returns (bytes memory)
    {
        AuctionParameters memory params = AuctionParameters({
            currency: address(0),
            tokensRecipient: address(this),
            fundsRecipient: strategy,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock + 1,
            tickSpacing: 100 * Q96,
            validationHook: address(0),
            floorPrice: 1_000 * Q96,
            requiredCurrencyRaised: 0,
            auctionStepsData: abi.encodePacked(STEP_MPS, STEP_DURATION)
        });
        return abi.encode(params);
    }
}
