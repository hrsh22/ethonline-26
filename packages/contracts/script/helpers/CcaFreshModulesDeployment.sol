// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../../src/AttributeRegistry.sol";
import {FuelCore} from "../../src/FuelCore.sol";
import {RewardLedger} from "../../src/RewardLedger.sol";
import {EpochConverter} from "../../src/conversion/EpochConverter.sol";
import {SepoliaV4ConversionAdapter} from "../../src/conversion/SepoliaV4ConversionAdapter.sol";
import {
    BaseSepoliaTestVenueConfiguration as VenueConfig
} from "../../src/deployment/BaseSepoliaTestVenueConfiguration.sol";
import {CcaLaunchConfiguration as Config} from "../../src/deployment/CcaLaunchConfiguration.sol";
import {DeploymentClaimPolicy} from "../../src/deployment/DeploymentClaimPolicy.sol";
import {DevelopmentRecoveryAuthority} from "../../src/deployment/DevelopmentRecoveryAuthority.sol";
import {
    TestnetThresholdRecoveryAuthority
} from "../../src/deployment/TestnetThresholdRecoveryAuthority.sol";
import {VrfSubscriptionBootstrap} from "../../src/deployment/VrfSubscriptionBootstrap.sol";
import {ICanonicalMarketRegistry} from "../../src/interfaces/ICanonicalMarketRegistry.sol";
import {IClaimGate} from "../../src/interfaces/IClaimGate.sol";
import {IConversionVenue} from "../../src/interfaces/IConversionVenue.sol";
import {IThresholdRecovery} from "../../src/interfaces/IThresholdRecovery.sol";
import {ProtocolLiquidityVault} from "../../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalMarketRegistry} from "../../src/market/CanonicalMarketRegistry.sol";
import {
    IAttributeMetadataRegistry,
    PlaceholderMetadataRenderer
} from "../../src/metadata/PlaceholderMetadataRenderer.sol";
import {MintableTestToken} from "../../src/test-assets/MintableTestToken.sol";
import {MintableTestWETH} from "../../src/test-assets/MintableTestWETH.sol";
import {MockStock} from "../../src/test-assets/MockStock.sol";
import {TestConversionVenue} from "../../src/test-assets/TestConversionVenue.sol";
import {
    IVRFCoordinatorV2Plus
} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {
    VRFCoordinatorV2_5Mock
} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

/// @notice Fresh, valueless test profile used by the standalone CCA deployment.
/// @dev Every project-owned module is created here; no prior protocol manifest is consumed.
abstract contract CcaFreshModulesDeployment is Script {
    bytes32 internal constant CCA_IDENTITY_MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;
    address private constant BASE_VRF_COORDINATOR = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 private constant BASE_VRF_KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    struct FreshInfrastructure {
        address weth;
        address usdc;
        address[4] stocks;
        TestConversionVenue venue;
        VrfSubscriptionBootstrap vrfBootstrap;
    }

    function _deployFreshCcaModules(
        string memory json,
        Config.Roles memory roles,
        Config.Infrastructure memory infra
    ) internal returns (Config.Modules memory modules, FreshInfrastructure memory fresh) {
        Config.validateInfrastructure(infra);
        address guardian = vm.parseJsonAddress(json, ".roles.guardian");
        address keeper = vm.parseJsonAddress(json, ".roles.keeper");
        address executor = vm.parseJsonAddress(json, ".roles.liquidityExecutor");
        require(
            guardian != address(0) && keeper != address(0) && executor != address(0),
            "zero operational role"
        );
        fresh = _deployFreshVenue(infra.poolManager, roles.deploymentOwner);
        AttributeRegistry attributes = new AttributeRegistry(CCA_IDENTITY_MANIFEST_HASH);
        _loadFreshAttributes(attributes);
        fresh.vrfBootstrap = _deployFreshVrf(json, roles.deploymentOwner);
        IThresholdRecovery recovery = block.chainid == 31_337
            ? IThresholdRecovery(
                address(new DevelopmentRecoveryAuthority(roles.deploymentOwner, 2))
            )
            : IThresholdRecovery(
                    address(
                        new TestnetThresholdRecoveryAuthority(
                            roles.deploymentOwner,
                            vm.parseJsonAddress(json, ".roles.recoveryCosigner")
                        )
                    )
                );
        modules.fuel = new FuelCore(
            vm.parseJsonString(json, ".identity.liquidTokenName"),
            vm.parseJsonString(json, ".identity.liquidTokenSymbol"),
            vm.parseJsonString(json, ".identity.collectibleTokenName"),
            vm.parseJsonString(json, ".identity.collectibleTokenSymbol"),
            roles.deploymentOwner,
            fresh.vrfBootstrap.discovery(),
            guardian,
            recovery
        );
        fresh.vrfBootstrap.finalizeFuelCore(address(modules.fuel));
        fresh.vrfBootstrap.discovery().acceptOwnership();
        modules.ledger = new RewardLedger(
            address(modules.fuel),
            attributes,
            fresh.stocks,
            IClaimGate(DeploymentClaimPolicy.deploy()),
            roles.deploymentOwner
        );
        modules.converter =
            new EpochConverter(fresh.weth, address(modules.ledger), keeper, roles.deploymentOwner);
        modules.registry = new CanonicalMarketRegistry(
            IPoolManager(infra.poolManager),
            address(modules.fuel),
            fresh.weth,
            roles.deploymentOwner
        );
        modules.protocolLiquidity = new ProtocolLiquidityVault(
            ICanonicalMarketRegistry(address(modules.registry)), roles.deploymentOwner, executor
        );
        modules.metadata = new PlaceholderMetadataRenderer(
            IAttributeMetadataRegistry(address(attributes)),
            PlaceholderMetadataRenderer.IdentityConfiguration({
                transientCollectible: vm.parseJsonString(json, ".identity.transientCollectible"),
                permanentCollectible: vm.parseJsonString(json, ".identity.permanentCollectible"),
                basketRelic: vm.parseJsonString(json, ".identity.basketRelic"),
                indicatorRelic: vm.parseJsonString(json, ".identity.indicatorRelic"),
                metadataDescription: vm.parseJsonString(json, ".identity.metadataDescription"),
                transientImage: vm.parseJsonString(json, ".identity.transientImage"),
                permanentImage: vm.parseJsonString(json, ".identity.permanentImage"),
                basketRelicImage: vm.parseJsonString(json, ".identity.basketRelicImage"),
                indicatorRelicImage: vm.parseJsonString(json, ".identity.indicatorRelicImage")
            })
        );
        for (uint8 i; i < 4; ++i) {
            modules.adapters[i] = new SepoliaV4ConversionAdapter(
                AttributeRegistry.RewardTrack(i + 1),
                address(modules.converter),
                fresh.weth,
                fresh.usdc,
                fresh.stocks[i],
                address(modules.ledger),
                IConversionVenue(address(fresh.venue))
            );
        }
    }

    function _deployFreshVenue(address manager, address owner)
        private
        returns (FreshInfrastructure memory fresh)
    {
        fresh.weth = address(
            new MintableTestWETH(
                VenueConfig.SELF_FUNDED_WETH_NAME,
                VenueConfig.SELF_FUNDED_WETH_SYMBOL,
                VenueConfig.SELF_FUNDED_WETH_INITIAL_SUPPLY,
                owner
            )
        );
        fresh.usdc = address(
            new MintableTestToken(
                VenueConfig.SELF_FUNDED_USDC_NAME,
                VenueConfig.SELF_FUNDED_USDC_SYMBOL,
                VenueConfig.SELF_FUNDED_USDC_DECIMALS,
                VenueConfig.SELF_FUNDED_USDC_INITIAL_SUPPLY,
                owner
            )
        );
        fresh.venue = new TestConversionVenue(IPoolManager(manager), owner);
        require(IERC20Minimal(fresh.weth).approve(address(fresh.venue), type(uint256).max));
        require(IERC20Minimal(fresh.usdc).approve(address(fresh.venue), type(uint256).max));
        fresh.venue
            .initializeWethUsdcPool(fresh.weth, fresh.usdc, VenueConfig.WETH_USDC_SEED_LIQUIDITY);
        for (uint256 i; i < 4; ++i) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(i);
            fresh.stocks[i] = address(
                new MockStock(stock.name, stock.symbol, VenueConfig.STOCK_FIXED_SUPPLY, owner)
            );
            require(IERC20Minimal(fresh.stocks[i]).approve(address(fresh.venue), type(uint256).max));
            fresh.venue
                .initializeUsdcStockPool(
                    fresh.usdc, fresh.stocks[i], VenueConfig.USDC_STOCK_SEED_LIQUIDITY
                );
            require(IERC20Minimal(fresh.stocks[i]).approve(address(fresh.venue), 0));
        }
        require(IERC20Minimal(fresh.weth).approve(address(fresh.venue), 0));
        require(IERC20Minimal(fresh.usdc).approve(address(fresh.venue), 0));
    }

    function _deployFreshVrf(string memory json, address owner)
        private
        returns (VrfSubscriptionBootstrap bootstrap)
    {
        uint256 funding = vm.parseJsonUint(json, ".discovery.nativeFundingWei");
        require(funding > 0, "explicit VRF funding required");
        IVRFCoordinatorV2Plus coordinator;
        if (block.chainid == 31_337) {
            coordinator = IVRFCoordinatorV2Plus(address(new VRFCoordinatorV2_5Mock(0, 0, 1 ether)));
            if (block.number == 0) vm.roll(1);
        } else {
            coordinator = IVRFCoordinatorV2Plus(BASE_VRF_COORDINATOR);
            require(address(coordinator).code.length != 0, "VRF coordinator unavailable");
        }
        bootstrap = new VrfSubscriptionBootstrap{value: funding}(
            coordinator,
            block.chainid == 31_337 ? bytes32(uint256(1)) : BASE_VRF_KEY_HASH,
            3,
            200_000,
            owner
        );
    }

    function _loadFreshAttributes(AttributeRegistry registry) private {
        bytes memory canonical = vm.readFileBinary("../config/collection/manifest.bin");
        require(
            canonical.length == 4_444 * 7 && keccak256(canonical) == CCA_IDENTITY_MANIFEST_HASH,
            "invalid canonical identity manifest"
        );
        uint256 cursor;
        while (cursor < 4_444) {
            uint256 count = 4_444 - cursor < 256 ? 4_444 - cursor : 256;
            AttributeRegistry.AttributeInput[] memory batch =
                new AttributeRegistry.AttributeInput[](count);
            for (uint256 i; i < count; ++i) {
                uint256 offset = (cursor + i) * 7;
                batch[i] = AttributeRegistry.AttributeInput({
                    identityId: (uint16(uint8(canonical[offset])) << 8)
                        | uint16(uint8(canonical[offset + 1])),
                    track: AttributeRegistry.RewardTrack(uint8(canonical[offset + 2])),
                    tier: AttributeRegistry.RarityTier(uint8(canonical[offset + 3])),
                    weight: (uint16(uint8(canonical[offset + 4])) << 8)
                        | uint16(uint8(canonical[offset + 5])),
                    collectibleKind: AttributeRegistry.CollectibleKind(uint8(canonical[offset + 6]))
                });
            }
            registry.loadBatch(batch);
            cursor += count;
        }
        registry.seal();
    }

    function _writeFreshInfrastructure(string memory path, FreshInfrastructure memory fresh)
        internal
    {
        string memory key = "cca-fresh-infrastructure";
        vm.serializeAddress(key, "weth", fresh.weth);
        vm.serializeAddress(key, "usdc", fresh.usdc);
        vm.serializeAddress(key, "testConversionVenue", address(fresh.venue));
        vm.serializeBytes32(key, "testConversionVenueCodehash", address(fresh.venue).codehash);
        vm.serializeAddress(key, "vrfBootstrap", address(fresh.vrfBootstrap));
        vm.serializeAddress(key, "vrfCoordinator", address(fresh.vrfBootstrap.coordinator()));
        string memory value = vm.serializeString(
            key, "vrfSubscriptionId", vm.toString(fresh.vrfBootstrap.subscriptionId())
        );
        vm.writeJson(value, path, ".freshInfrastructure");
    }
}
