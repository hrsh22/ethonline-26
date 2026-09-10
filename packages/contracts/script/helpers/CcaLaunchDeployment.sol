// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {AttributeRegistry} from "../../src/AttributeRegistry.sol";
import {FuelCore} from "../../src/FuelCore.sol";
import {CcaCreate2Deployer} from "../../src/deployment/CcaCreate2Deployer.sol";
import {CcaLaunchConfiguration as Config} from "../../src/deployment/CcaLaunchConfiguration.sol";
import {CcaLaunchFunding} from "../../src/deployment/CcaLaunchFunding.sol";
import {ICanonicalFeeHook} from "../../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../../src/interfaces/ICanonicalMarketRegistry.sol";
import {ICollectibleMetadata} from "../../src/interfaces/ICollectibleMetadata.sol";
import {CcaBidEscrowFactory} from "../../src/launch/CcaBidEscrowFactory.sol";
import {CcaBidValidationHook} from "../../src/launch/CcaBidValidationHook.sol";
import {CcaCanonicalLaunchReadiness} from "../../src/launch/CcaCanonicalLaunchReadiness.sol";
import {
    CcaLaunchCoordinator,
    ICcaLaunchFuel,
    ICcaLaunchReadiness
} from "../../src/launch/CcaLaunchCoordinator.sol";
import {CcaRecoverySeeder} from "../../src/launch/CcaRecoverySeeder.sol";
import {PermanentPositionRecipient} from "../../src/launch/PermanentPositionRecipient.sol";
import {CanonicalFeeHook} from "../../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../../src/market/CanonicalHookDeployer.sol";
import {CanonicalRouter} from "../../src/market/CanonicalRouter.sol";
import {
    ContinuousClearingAuctionFactory
} from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
import {
    AuctionParameters
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {Script} from "forge-std/Script.sol";
import {LiquidityLauncher} from "liquidity-launcher/src/LiquidityLauncher.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {LBPStrategy} from "liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import {Distribution} from "liquidity-launcher/src/types/Distribution.sol";
import {PositionDefinition} from "liquidity-launcher/src/types/PositionPlannerTypes.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Reusable broadcast composition for a fresh full-protocol deployment.
/// @dev Script helper, deliberately not an onchain mega-factory. The caller starts broadcasting as
/// roles.deploymentOwner, creates the fresh base modules, then calls _deployCcaLaunch before bidding.
abstract contract CcaLaunchDeployment is Script {
    using PoolIdLibrary for PoolKey;

    string internal constant CCA_SOURCE_COMMIT = "a56d42231e7bf048136d9d88fa61e8518c10c5ff";
    string internal constant LBP_SOURCE_COMMIT = "873cbb23c5019a795193c5ad561edff2f78ba5a3";

    struct LaunchDeployment {
        address ccaFactory;
        address liquidityLauncher;
        address lbpStrategy;
        CcaCreate2Deployer lbpDeployer;
        CcaLaunchFunding funding;
        CanonicalHookDeployer hookDeployer;
        CanonicalFeeHook hook;
        CanonicalRouter router;
        PermanentPositionRecipient positionRecipient;
        CcaRecoverySeeder recoverySeeder;
        CcaCanonicalLaunchReadiness readiness;
        CcaLaunchCoordinator coordinator;
        CcaBidEscrowFactory escrowFactory;
        CcaBidValidationHook validationHook;
        address auction;
        PoolKey poolKey;
        uint256 deploymentBlock;
        bytes32 configurationHash;
    }

    event CcaDeploymentConfigured(
        bytes32 indexed configurationHash,
        address indexed fuel,
        address indexed auction,
        bytes manifestFields
    );

    function _deployCcaLaunch(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        bytes32[] memory blockedVenueCodehashes
    ) internal returns (LaunchDeployment memory deployed) {
        bytes memory distributionConfig;
        (deployed, distributionConfig) =
            _prepareCcaLaunch(modules, roles, infra, economics, blockedVenueCodehashes);
        _fundAndHandOff(modules, roles, economics, distributionConfig, deployed);
        _verifyDeployment(modules, roles, infra, economics, deployed);
        emit CcaDeploymentConfigured(
            deployed.configurationHash,
            address(modules.fuel),
            deployed.auction,
            abi.encode(modules, roles, infra, economics, deployed)
        );
    }

    function _prepareCcaLaunch(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        bytes32[] memory blockedVenueCodehashes
    ) internal returns (LaunchDeployment memory deployed, bytes memory distributionConfig) {
        Config.validateInfrastructure(infra);
        Config.validateEconomics(economics);
        Config.validateModules(modules, roles, infra);
        if (block.chainid == 84_532) {
            require(blockedVenueCodehashes.length != 0, "explicit blocked venue inventory required");
        }
        deployed.deploymentBlock = block.number;
        deployed.configurationHash = keccak256(
            abi.encode(block.chainid, modules, roles, infra, economics, blockedVenueCodehashes)
        );
        if (block.chainid == 31_337) {
            deployed.ccaFactory = address(new ContinuousClearingAuctionFactory(address(0)));
            deployed.liquidityLauncher =
                address(new LiquidityLauncher(IAllowanceTransfer(infra.permit2)));
            deployed.lbpDeployer = new CcaCreate2Deployer(roles.deploymentOwner);
            deployed.lbpStrategy = _deployLbp(deployed.lbpDeployer, deployed.ccaFactory, infra);
        } else {
            deployed.ccaFactory = infra.ccaFactory;
            deployed.liquidityLauncher = infra.liquidityLauncher;
            deployed.lbpStrategy = infra.lbpStrategy;
        }
        deployed.funding = new CcaLaunchFunding(
            modules.fuel,
            LiquidityLauncher(deployed.liquidityLauncher),
            deployed.lbpStrategy,
            infra.permit2,
            roles.deploymentOwner
        );
        _deployMarket(modules, roles, infra, economics, deployed);
        _deployCustody(modules, roles, deployed);
        distributionConfig = _prepareAuction(modules, roles, economics, deployed);
        _configureModules(modules, infra, blockedVenueCodehashes, deployed);
    }

    function _deployLbp(
        CcaCreate2Deployer deployer,
        address factory,
        Config.Infrastructure memory infra
    ) private returns (address strategy) {
        bytes memory initCode = abi.encodePacked(
            type(LBPStrategy).creationCode,
            abi.encode(infra.positionManager, infra.poolManager, factory)
        );
        bytes32 hash = keccak256(initCode);
        for (uint256 nonce; nonce < 1_000_000; ++nonce) {
            bytes32 salt = bytes32(nonce);
            address predicted = vm.computeCreate2Address(salt, hash, address(deployer));
            if (uint160(predicted) & ((1 << 14) - 1) != 1 << 13) continue;
            // Address-only constructor boundary preserves each pinned v4 source identity.
            strategy = deployer.deploy(salt, initCode);
            require(
                strategy == predicted && strategy.code.length != 0,
                "strategy CREATE2 deployment mismatch"
            );
            return strategy;
        }
        revert("LBP hook salt unavailable");
    }

    function _deployMarket(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        LaunchDeployment memory deployed
    ) private {
        deployed.hookDeployer = new CanonicalHookDeployer();
        bytes32 initHash = deployed.hookDeployer
            .hookInitCodeHash(
                IPoolManager(infra.poolManager),
                modules.registry,
                modules.registry.weth(),
                address(modules.converter),
                address(modules.protocolLiquidity),
                roles.creator
            );
        for (uint256 nonce; nonce < 1_000_000; ++nonce) {
            bytes32 salt = bytes32(nonce);
            address predicted = deployed.hookDeployer.computeAddress(salt, initHash);
            if (uint160(predicted) & ((1 << 14) - 1) != modules.registry.REQUIRED_PERMISSION_BITS())
            {
                continue;
            }
            deployed.hook = deployed.hookDeployer
                .deploy(
                    salt,
                    IPoolManager(infra.poolManager),
                    modules.registry,
                    modules.registry.weth(),
                    address(modules.converter),
                    address(modules.protocolLiquidity),
                    roles.creator
                );
            break;
        }
        require(address(deployed.hook).code.length != 0, "canonical hook salt unavailable");
        deployed.hook.configureInitializer(deployed.lbpStrategy);
        deployed.router = new CanonicalRouter(
            IPoolManager(infra.poolManager), modules.registry, modules.registry.weth()
        );
        bool fuelFirst = address(modules.fuel) < modules.registry.weth();
        deployed.poolKey = PoolKey({
            currency0: Currency.wrap(fuelFirst ? address(modules.fuel) : modules.registry.weth()),
            currency1: Currency.wrap(fuelFirst ? modules.registry.weth() : address(modules.fuel)),
            fee: 0x800000,
            tickSpacing: economics.poolTickSpacing,
            hooks: IHooks(address(deployed.hook))
        });
        modules.registry.registerPool(deployed.poolKey, address(deployed.router));
    }

    function _deployCustody(
        Config.Modules memory modules,
        Config.Roles memory roles,
        LaunchDeployment memory deployed
    ) private {
        deployed.positionRecipient = new PermanentPositionRecipient(
            address(LBPStrategy(payable(deployed.lbpStrategy)).positionManager()),
            deployed.poolKey.toId()
        );
        deployed.recoverySeeder = new CcaRecoverySeeder(
            ICanonicalMarketRegistry(address(modules.registry)),
            deployed.lbpStrategy,
            deployed.positionRecipient,
            address(deployed.funding)
        );
        deployed.hook.configureRecoveryInitializer(address(deployed.recoverySeeder));
        modules.registry.seal();
        deployed.readiness = new CcaCanonicalLaunchReadiness(
            ICanonicalMarketRegistry(address(modules.registry)),
            ICanonicalFeeHook(address(deployed.hook)),
            deployed.lbpStrategy,
            deployed.positionRecipient
        );
        deployed.coordinator = new CcaLaunchCoordinator(
            ICcaLaunchFuel(address(modules.fuel)),
            ICcaLaunchReadiness(address(deployed.readiness)),
            roles.deploymentOwner,
            roles.governanceOwner
        );
        deployed.escrowFactory = new CcaBidEscrowFactory(
            address(modules.fuel), modules.registry.weth(), address(deployed.coordinator)
        );
        deployed.coordinator.configureEscrowFactory(address(deployed.escrowFactory));
        deployed.coordinator.sealConfiguration();
    }

    function _prepareAuction(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Economics memory economics,
        LaunchDeployment memory deployed
    ) private returns (bytes memory distributionConfig) {
        // This is the next CREATE by the broadcaster. No deployment may be inserted before the hook.
        address validationAddress =
            vm.computeCreateAddress(roles.deploymentOwner, vm.getNonce(roles.deploymentOwner));
        PositionDefinition[] memory positions = new PositionDefinition[](0);
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: 10_000_000});
        MigratorParameters memory migration = MigratorParameters({
            token: address(modules.fuel),
            currency: modules.registry.weth(),
            migrationBlock: economics.migrationBlock,
            reservedTokenAmountForLP: economics.reserveSupply,
            recipient: address(deployed.recoverySeeder),
            positionRecipient: address(deployed.positionRecipient),
            poolParameters: PoolParameters({
                fee: deployed.poolKey.fee,
                tickSpacing: economics.poolTickSpacing,
                hook: address(deployed.hook)
            }),
            positionDefinitions: abi.encode(positions),
            lpAllocationSchedule: abi.encode(brackets)
        });
        AuctionParameters memory auctionParams = AuctionParameters({
            currency: modules.registry.weth(),
            tokensRecipient: address(deployed.recoverySeeder),
            fundsRecipient: deployed.lbpStrategy,
            startBlock: economics.startBlock,
            endBlock: economics.endBlock,
            claimBlock: economics.claimBlock,
            tickSpacing: economics.auctionTickSpacingQ96,
            validationHook: validationAddress,
            floorPrice: economics.floorPriceQ96,
            requiredCurrencyRaised: economics.minimumRaise,
            auctionStepsData: economics.auctionSteps
        });
        bytes memory auctionConfig = abi.encode(auctionParams);
        bytes32 initializerSalt = keccak256(
            abi.encode(
                keccak256(abi.encode(address(deployed.funding), economics.distributionSalt)),
                migration
            )
        );
        deployed.auction = address(
            ContinuousClearingAuctionFactory(deployed.ccaFactory)
                .getAddress(
                    address(modules.fuel),
                    uint128(Config.TOTAL_SUPPLY) - economics.reserveSupply,
                    auctionConfig,
                    initializerSalt,
                    deployed.lbpStrategy
                )
        );
        deployed.validationHook = new CcaBidValidationHook(deployed.auction, deployed.escrowFactory);
        require(
            address(deployed.validationHook) == validationAddress,
            "validation hook CREATE order changed"
        );
        distributionConfig = abi.encode(migration, auctionConfig);
    }

    function _configureModules(
        Config.Modules memory modules,
        Config.Infrastructure memory infra,
        bytes32[] memory blockedVenueCodehashes,
        LaunchDeployment memory deployed
    ) private {
        modules.ledger.sealEpochConverter(address(modules.converter));
        modules.converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(deployed.hook)));
        for (uint256 i; i < 4; ++i) {
            modules.converter
                .configureTrack(
                    AttributeRegistry.RewardTrack(i + 1),
                    modules.adapters[i].stockToken(),
                    modules.adapters[i]
                );
        }
        modules.converter.sealConfiguration();
        modules.protocolLiquidity
            .configureCanonicalFeeHook(ICanonicalFeeHook(address(deployed.hook)));
        modules.protocolLiquidity.sealConfiguration();
        modules.fuel.setMetadataRenderer(ICollectibleMetadata(address(modules.metadata)));
        modules.fuel.setRewardLedger(modules.ledger);
        modules.fuel.setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(modules.registry)));
        for (uint256 i; i < blockedVenueCodehashes.length; ++i) {
            require(blockedVenueCodehashes[i] != bytes32(0), "empty blocked codehash");
            modules.fuel.setBlockedVenueCodehash(blockedVenueCodehashes[i], true);
        }
        address[14] memory custody = [
            address(deployed.funding),
            infra.poolManager,
            infra.positionManager,
            deployed.liquidityLauncher,
            deployed.lbpStrategy,
            deployed.auction,
            address(deployed.positionRecipient),
            address(deployed.recoverySeeder),
            address(deployed.hook),
            address(deployed.router),
            address(modules.ledger),
            address(modules.converter),
            address(modules.protocolLiquidity),
            address(deployed.coordinator)
        ];
        for (uint256 i; i < custody.length; ++i) {
            modules.fuel.setDiscoveryExempt(custody[i], true);
            modules.fuel.setProtectedAccount(custody[i], true);
        }
    }

    function _fundAndHandOff(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Economics memory economics,
        bytes memory distributionConfig,
        LaunchDeployment memory deployed
    ) private {
        deployed.funding
            .configure(
                deployed.recoverySeeder,
                deployed.coordinator,
                deployed.auction,
                keccak256(distributionConfig),
                economics.distributionSalt,
                economics.startBlock
            );
        modules.fuel.approve(address(deployed.funding), Config.TOTAL_SUPPLY);
        modules.fuel.transferOwnership(address(deployed.funding));
        deployed.funding.fund(distributionConfig);
        if (roles.governanceOwner != roles.deploymentOwner) {
            modules.ledger.transferOwnership(roles.governanceOwner);
            modules.converter.transferOwnership(roles.governanceOwner);
            modules.protocolLiquidity.transferOwnership(roles.governanceOwner);
            modules.registry.transferOwnership(roles.governanceOwner);
        }
    }

    function _verifyDeployment(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        LaunchDeployment memory deployed
    ) private view {
        require(block.number < economics.startBlock, "auction began before setup completed");
        require(!modules.fuel.launched() && !deployed.readiness.isReady(), "premature launch");
        require(
            modules.fuel.owner() == address(deployed.coordinator), "coordinator ownership missing"
        );
        require(
            modules.fuel.balanceOf(roles.deploymentOwner) == 0
                && !modules.fuel.isDiscoveryExempt(roles.deploymentOwner),
            "initial supply holder not cleared"
        );
        require(
            modules.fuel.balanceOf(deployed.auction)
                    == Config.TOTAL_SUPPLY - economics.reserveSupply
                && modules.fuel.balanceOf(deployed.lbpStrategy) == economics.reserveSupply,
            "auction funding mismatch"
        );
        require(
            modules.fuel.balanceOf(deployed.liquidityLauncher) == 0
                && modules.fuel.allowance(deployed.liquidityLauncher, deployed.lbpStrategy) == 0
                && modules.fuel.allowance(roles.deploymentOwner, address(deployed.funding)) == 0
                && modules.fuel.allowance(address(deployed.funding), infra.permit2) == 0,
            "launcher funding residue"
        );
        require(
            modules.fuel.discoveryNonce() == 0 && modules.fuel.totalPendingDiscoveryCount() == 0
                && modules.fuel.totalTransientCount() == 0,
            "nonempty discovery state"
        );
        require(
            deployed.hook.authorized() == deployed.lbpStrategy
                && deployed.hook.recoveryInitializer() == address(deployed.recoverySeeder),
            "initializer mismatch"
        );
    }
}
