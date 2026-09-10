// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../AttributeRegistry.sol";
import {FuelCore} from "../FuelCore.sol";
import {RewardLedger} from "../RewardLedger.sol";
import {EpochConverter} from "../conversion/EpochConverter.sol";
import {IConversionAdapter} from "../interfaces/IConversionAdapter.sol";
import {ProtocolLiquidityVault} from "../liquidity/ProtocolLiquidityVault.sol";
import {CanonicalMarketRegistry} from "../market/CanonicalMarketRegistry.sol";
import {PlaceholderMetadataRenderer} from "../metadata/PlaceholderMetadataRenderer.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

interface ICcaPositionManagerInfrastructure {
    function poolManager() external view returns (address);
    function permit2() external view returns (address);
}

interface ICcaFactoryInfrastructure {
    function protocolFeeController() external view returns (address);
}

interface ICcaLauncherInfrastructure {
    function permit2() external view returns (address);
}

interface ICcaLbpInfrastructure {
    function poolManager() external view returns (address);
    function positionManager() external view returns (address);
    function initializerFactory() external view returns (address);
}

interface ICcaFreshDiscovery {
    function fuelCore() external view returns (address);
    function requestSequenceCount() external view returns (uint256);
}

/// @notice Fail-closed input boundary for fresh CCA deployment composition.
library CcaLaunchConfiguration {
    uint256 internal constant TOTAL_SUPPLY = 4_444 ether;
    address internal constant BASE_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant BASE_POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Observed on Base Sepolia at block 46,556,160; code addresses match Uniswap's official feed.
    bytes32 internal constant BASE_POOL_MANAGER_CODEHASH =
        0x03c45db6d09b14da7c1f7239a5a49697f976d395277e6d2acb6fbed3f9e0249f;
    bytes32 internal constant BASE_POSITION_MANAGER_CODEHASH =
        0xe8329b35b8b34290b6cf03affc0836f7b23205229cc96ffdc66544b93112c076;
    bytes32 internal constant BASE_PERMIT2_CODEHASH =
        0xdcde65555316946c298e4c60c6213eb5c3aeab4354d1f3fac5427236bcbb9ebe;

    address internal constant BASE_CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address internal constant BASE_LIQUIDITY_LAUNCHER = 0x00004c4ccc709Ef590F7C81102C0689F0263D4e9;
    address internal constant BASE_LBP_STRATEGY = 0xB06428b62c259eE982cE3D9BED47391dC9A5E000;
    bytes32 internal constant BASE_CCA_FACTORY_CODEHASH =
        0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa;
    bytes32 internal constant BASE_LIQUIDITY_LAUNCHER_CODEHASH =
        0x672007315147b9202d825c5a4f5fed556179de55a89d8052f64d1c49ef366ed6;
    bytes32 internal constant BASE_LBP_STRATEGY_CODEHASH =
        0x866c535b076c67e4508bb64b0785bd5167d6ad9884af3f610e469877c6dcc00b;

    struct Infrastructure {
        address poolManager;
        address positionManager;
        address permit2;
        address ccaFactory;
        address liquidityLauncher;
        address lbpStrategy;
    }

    struct Modules {
        FuelCore fuel;
        CanonicalMarketRegistry registry;
        RewardLedger ledger;
        EpochConverter converter;
        ProtocolLiquidityVault protocolLiquidity;
        PlaceholderMetadataRenderer metadata;
        IConversionAdapter[4] adapters;
    }

    struct Roles {
        address deploymentOwner;
        address governanceOwner;
        address creator;
    }

    /// @dev Supplied values select economics within the fixed policy: all raised WETH goes to
    /// full-range LP, no project auction fee, and unsold/dust assets stay in permanent custody.
    /// No public-network price, duration, reserve, minimum raise, or schedule defaults are selected.
    struct Economics {
        uint128 reserveSupply;
        uint128 minimumRaise;
        uint256 floorPriceQ96;
        uint256 auctionTickSpacingQ96;
        uint64 startBlock;
        uint64 endBlock;
        uint64 claimBlock;
        uint64 migrationBlock;
        int24 poolTickSpacing;
        bytes auctionSteps;
        bytes32 distributionSalt;
        bool testnetEconomicsConfirmed;
    }

    error InvalidInfrastructure(address account);
    error InvalidModules(address account);
    error InvalidEconomics();
    error UnsupportedChain(uint256 chainId);
    error ExplicitTestnetEconomicsRequired();

    function validateInfrastructure(Infrastructure memory infra) internal view {
        if (block.chainid != 31_337 && block.chainid != 84_532) {
            revert UnsupportedChain(block.chainid);
        }
        if (
            block.chainid == 84_532
                && (infra.poolManager != BASE_POOL_MANAGER
                    || infra.positionManager != BASE_POSITION_MANAGER)
        ) revert InvalidInfrastructure(address(0));
        if (
            infra.permit2 != PERMIT2 || infra.poolManager.code.length == 0
                || infra.positionManager.code.length == 0 || infra.permit2.code.length == 0
        ) revert InvalidInfrastructure(address(0));
        if (
            block.chainid == 84_532
                && (infra.poolManager.codehash != BASE_POOL_MANAGER_CODEHASH
                    || infra.positionManager.codehash != BASE_POSITION_MANAGER_CODEHASH
                    || infra.permit2.codehash != BASE_PERMIT2_CODEHASH)
        ) revert InvalidInfrastructure(address(0));
        if (block.chainid == 84_532) {
            if (
                infra.ccaFactory != BASE_CCA_FACTORY
                    || infra.liquidityLauncher != BASE_LIQUIDITY_LAUNCHER
                    || infra.lbpStrategy != BASE_LBP_STRATEGY
                    || infra.ccaFactory.codehash != BASE_CCA_FACTORY_CODEHASH
                    || infra.liquidityLauncher.codehash != BASE_LIQUIDITY_LAUNCHER_CODEHASH
                    || infra.lbpStrategy.codehash != BASE_LBP_STRATEGY_CODEHASH
            ) revert InvalidInfrastructure(address(0));
            if (ICcaFactoryInfrastructure(infra.ccaFactory).protocolFeeController() != address(0)) {
                revert InvalidInfrastructure(infra.ccaFactory);
            }
            ICcaLbpInfrastructure strategy = ICcaLbpInfrastructure(infra.lbpStrategy);
            if (
                strategy.poolManager() != infra.poolManager
                    || strategy.positionManager() != infra.positionManager
                    || strategy.initializerFactory() != infra.ccaFactory
                    || ICcaLauncherInfrastructure(infra.liquidityLauncher).permit2()
                        != infra.permit2
            ) revert InvalidInfrastructure(infra.lbpStrategy);
        } else if (
            infra.ccaFactory != address(0) || infra.liquidityLauncher != address(0)
                || infra.lbpStrategy != address(0)
        ) {
            revert InvalidInfrastructure(address(0));
        }
        ICcaPositionManagerInfrastructure manager =
            ICcaPositionManagerInfrastructure(infra.positionManager);
        if (manager.poolManager() != infra.poolManager || manager.permit2() != infra.permit2) {
            revert InvalidInfrastructure(infra.positionManager);
        }
    }

    function validateEconomics(Economics memory economics) internal view {
        if (block.chainid == 84_532 && !economics.testnetEconomicsConfirmed) {
            revert ExplicitTestnetEconomicsRequired();
        }
        uint256 lead = block.chainid == 84_532 ? 128 : 1;
        if (
            economics.reserveSupply == 0 || economics.reserveSupply >= TOTAL_SUPPLY
                || economics.minimumRaise == 0 || economics.floorPriceQ96 == 0
                || economics.auctionTickSpacingQ96 == 0
                || economics.floorPriceQ96 % economics.auctionTickSpacingQ96 != 0
                || economics.startBlock < block.number + lead
                || economics.endBlock <= economics.startBlock
                || economics.claimBlock <= economics.endBlock
                || economics.migrationBlock <= economics.endBlock
                || economics.migrationBlock > economics.claimBlock || economics.poolTickSpacing <= 0
                || economics.poolTickSpacing > 32767 || economics.auctionSteps.length == 0
                || economics.auctionSteps.length % 8 != 0
        ) revert InvalidEconomics();
        bytes memory steps = economics.auctionSteps;
        uint256 duration;
        uint256 totalMps;
        for (uint256 offset; offset < steps.length; offset += 8) {
            uint256 packed;
            assembly ("memory-safe") { packed := mload(add(add(steps, 32), offset)) }
            uint24 rate = uint24(packed >> 232);
            uint40 blocks = uint40(packed >> 192);
            if (blocks == 0) revert InvalidEconomics();
            duration += blocks;
            totalMps += uint256(rate) * blocks;
        }
        if (duration != economics.endBlock - economics.startBlock || totalMps != 10_000_000) {
            revert InvalidEconomics();
        }
    }

    function validateModules(
        Modules memory modules,
        Roles memory roles,
        Infrastructure memory infra
    ) internal view {
        FuelCore fuel = modules.fuel;
        if (
            roles.deploymentOwner == address(0) || roles.governanceOwner == address(0)
                || roles.creator == address(0) || address(fuel).code.length == 0
                || address(modules.registry).code.length == 0
                || address(modules.ledger).code.length == 0
                || address(modules.converter).code.length == 0
                || address(modules.protocolLiquidity).code.length == 0
                || address(modules.metadata).code.length == 0
        ) revert InvalidModules(address(0));
        if (
            fuel.owner() != roles.deploymentOwner || fuel.pendingOwner() != address(0)
                || fuel.launched() || fuel.paused() || fuel.totalSupply() != TOTAL_SUPPLY
                || fuel.balanceOf(roles.deploymentOwner) != TOTAL_SUPPLY
                || fuel.discoveryNonce() != 0 || fuel.totalTransientCount() != 0
                || fuel.totalPendingDiscoveryCount() != 0 || fuel.permanentCount() != 0
                || fuel.availableIdentityCount() != 4_444
                || address(fuel.canonicalMarketRegistry()) != address(0)
                || address(fuel.discoveryAdapter()).code.length == 0
                || address(fuel.recoveryAuthority()).code.length == 0
                || fuel.recoveryAuthority().getThreshold() < 2
        ) revert InvalidModules(address(fuel));
        CanonicalMarketRegistry registry = modules.registry;
        if (
            registry.owner() != roles.deploymentOwner || registry.pendingOwner() != address(0)
                || registry.registered() || registry.isSealed() || registry.fuel() != address(fuel)
                || address(registry.manager()) != infra.poolManager
                || registry.weth().code.length == 0
        ) revert InvalidModules(address(registry));
        if (
            modules.ledger.owner() != roles.deploymentOwner
                || modules.ledger.pendingOwner() != address(0)
                || modules.ledger.rewardNotificationsPaused()
                || modules.ledger.fuelCore() != address(fuel)
                || modules.ledger.epochConverter() != address(0)
                || !modules.ledger.attributeRegistry().isSealed()
                || address(modules.metadata.attributeRegistry())
                    != address(modules.ledger.attributeRegistry())
        ) revert InvalidModules(address(modules.ledger));
        if (
            modules.converter.owner() != roles.deploymentOwner
                || modules.converter.pendingOwner() != address(0) || modules.converter.paused()
                || IERC20Minimal(registry.weth()).balanceOf(address(modules.converter)) != 0
                || modules.converter.rewardLedger() != address(modules.ledger)
                || modules.converter.weth() != registry.weth()
                || modules.converter.configurationSealed()
                || address(modules.converter.canonicalFeeHook()) != address(0)
                || modules.converter.rewardEpochCount() != 0
        ) revert InvalidModules(address(modules.converter));
        if (
            modules.protocolLiquidity.owner() != roles.deploymentOwner
                || modules.protocolLiquidity.pendingOwner() != address(0)
                || modules.protocolLiquidity.paused()
                || IERC20Minimal(registry.weth()).balanceOf(address(modules.protocolLiquidity)) != 0
                || address(modules.protocolLiquidity.registry()) != address(registry)
                || modules.protocolLiquidity.configurationSealed()
                || address(modules.protocolLiquidity.canonicalFeeHook()) != address(0)
                || modules.protocolLiquidity.queuedWeth() != 0
                || modules.protocolLiquidity.liquidityCycleCount() != 0
        ) revert InvalidModules(address(modules.protocolLiquidity));
        for (uint256 i; i < 4; ++i) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(i + 1);
            IConversionAdapter adapter = modules.adapters[i];
            if (
                address(adapter).code.length == 0 || adapter.configuredTrack() != track
                    || adapter.converter() != address(modules.converter)
                    || adapter.weth() != registry.weth()
                    || adapter.rewardLedger() != address(modules.ledger)
                    || adapter.stockToken() != modules.ledger.rewardToken(track)
                    || IERC20Minimal(adapter.stockToken()).balanceOf(address(modules.ledger)) != 0
                    || modules.ledger.totalLiability(track) != 0
                    || modules.ledger.totalActiveWeight(track) != 0
                    || modules.ledger.unclaimedTrackPot(track) != 0
            ) revert InvalidModules(address(adapter));
        }
        if (block.chainid == 84_532) {
            ICcaFreshDiscovery discovery = ICcaFreshDiscovery(address(fuel.discoveryAdapter()));
            if (discovery.fuelCore() != address(fuel) || discovery.requestSequenceCount() != 0) {
                revert InvalidModules(address(discovery));
            }
        }
    }
}
