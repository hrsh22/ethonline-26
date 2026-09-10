// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "../../lib/liquidity-launcher/lib/permit2/test/utils/DeployPermit2.sol";
import {PoolManager} from "../../lib/liquidity-launcher/lib/v4-core/src/PoolManager.sol";
import {
    IPoolManager
} from "../../lib/liquidity-launcher/lib/v4-core/src/interfaces/IPoolManager.sol";
import {
    PositionManager
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/PositionManager.sol";
import {
    IPositionDescriptor
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {
    IPositionManager
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/interfaces/IPositionManager.sol";
import {
    IWETH9
} from "../../lib/liquidity-launcher/lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {
    ContinuousClearingAuctionFactory
} from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
import {
    AuctionParameters
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {LiquidityLauncher} from "liquidity-launcher/src/LiquidityLauncher.sol";
import {IDistributorFactory} from "liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {LBPStrategy} from "liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import {Distribution} from "liquidity-launcher/src/types/Distribution.sol";
import {PositionDefinition} from "liquidity-launcher/src/types/PositionPlannerTypes.sol";

interface IFreshFixtureToken {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev Upstream v4 source identities stay entirely behind an address/ABI boundary.
/// The application uses its existing v4-core revision against these real upstream deployments.
contract CcaFreshLifecycleFixture is DeployPermit2 {
    uint128 public constant TOTAL_SUPPLY = 4_444 ether;
    uint128 public constant RESERVE_SUPPLY = 444 ether;
    uint256 public constant Q96 = 1 << 96;
    address public launcher;
    address public poolManager;
    address public positionManager;
    address public strategy;
    address public factory;
    address public auction;
    uint64 public endBlock;
    bytes private _config;
    bytes32 private constant SALT = keccak256("fresh-cca-lifecycle");

    function deployInfrastructure(address weth) external {
        deployPermit2();
        launcher = address(new LiquidityLauncher(IAllowanceTransfer(PERMIT2_ADDRESS)));
        poolManager = address(new PoolManager(address(this)));
        positionManager = address(
            new PositionManager(
                IPoolManager(poolManager),
                IAllowanceTransfer(PERMIT2_ADDRESS),
                0,
                IPositionDescriptor(address(0)),
                IWETH9(weth)
            )
        );
        factory = address(new ContinuousClearingAuctionFactory(address(0)));
        bytes memory initCode = abi.encodePacked(
            type(LBPStrategy).creationCode, abi.encode(positionManager, poolManager, factory)
        );
        bytes32 initHash = keccak256(initCode);
        for (uint256 i; i < 200_000; ++i) {
            bytes32 salt = bytes32(i);
            address predicted = address(
                uint160(
                    uint256(
                        keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash))
                    )
                )
            );
            if (uint160(predicted) & ((1 << 14) - 1) != 1 << 13) continue;
            strategy = address(
                new LBPStrategy{salt: salt}(
                    IPositionManager(positionManager),
                    IPoolManager(poolManager),
                    IDistributorFactory(factory)
                )
            );
            return;
        }
        revert("strategy salt not found");
    }

    function prepare(
        address token,
        address weth,
        address hook,
        address validation,
        address positionRecipient,
        address recoveryRecipient,
        uint128 minimumRaise
    ) external returns (address) {
        uint64 start = uint64(block.number) + 2;
        endBlock = start + 10;
        PositionDefinition[] memory definitions = new PositionDefinition[](0);
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: 10_000_000});
        MigratorParameters memory migration = MigratorParameters({
            token: token,
            currency: weth,
            migrationBlock: endBlock + 1,
            reservedTokenAmountForLP: RESERVE_SUPPLY,
            recipient: recoveryRecipient,
            positionRecipient: positionRecipient,
            poolParameters: PoolParameters({fee: 0x800000, tickSpacing: 60, hook: hook}),
            positionDefinitions: abi.encode(definitions),
            lpAllocationSchedule: abi.encode(brackets)
        });
        AuctionParameters memory parameters = AuctionParameters({
            currency: weth,
            tokensRecipient: recoveryRecipient,
            fundsRecipient: strategy,
            startBlock: start,
            endBlock: endBlock,
            claimBlock: endBlock + 1,
            tickSpacing: Q96 / 128,
            validationHook: validation,
            floorPrice: Q96 / 8,
            requiredCurrencyRaised: minimumRaise,
            auctionStepsData: abi.encodePacked(uint24(1_000_000), uint40(10))
        });
        bytes memory auctionConfig = abi.encode(parameters);
        _config = abi.encode(migration, auctionConfig);
        auction = address(
            ContinuousClearingAuctionFactory(factory)
                .getAddress(
                    token,
                    TOTAL_SUPPLY - RESERVE_SUPPLY,
                    auctionConfig,
                    keccak256(abi.encode(keccak256(abi.encode(address(this), SALT)), migration)),
                    strategy
                )
        );
        return auction;
    }

    function fund(address token) external {
        require(IFreshFixtureToken(token).approve(PERMIT2_ADDRESS, TOTAL_SUPPLY));
        IAllowanceTransfer(PERMIT2_ADDRESS).approve(token, launcher, TOTAL_SUPPLY, type(uint48).max);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(LiquidityLauncher.depositToken, (token, uint160(TOTAL_SUPPLY)));
        calls[1] = abi.encodeCall(
            LiquidityLauncher.distributeToken,
            (
                token,
                Distribution({strategy: strategy, amount: TOTAL_SUPPLY, configData: _config}),
                SALT
            )
        );
        LiquidityLauncher(launcher).multicall(calls);
        require(auction.code.length != 0, "predicted auction missing");
    }

    function migrate() external {
        LBPStrategy(payable(strategy)).migrate(ILBPInitializer(auction));
    }
}
