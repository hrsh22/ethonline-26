// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IVRFCoordinatorV2Plus
} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {
    VRFCoordinatorV2_5Mock
} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {Script} from "forge-std/Script.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {SepoliaV4ConversionAdapter} from "../src/conversion/SepoliaV4ConversionAdapter.sol";
import {BaseSepoliaInfrastructure} from "../src/deployment/BaseSepoliaInfrastructure.sol";
import {
    BaseSepoliaTestVenueConfiguration as VenueConfig
} from "../src/deployment/BaseSepoliaTestVenueConfiguration.sol";
import {
    BaseSepoliaTestVenueValidation as VenueValidation
} from "../src/deployment/BaseSepoliaTestVenueValidation.sol";
import {DeploymentClaimPolicy} from "../src/deployment/DeploymentClaimPolicy.sol";
import {DevelopmentRecoveryAuthority} from "../src/deployment/DevelopmentRecoveryAuthority.sol";
import {
    TestnetThresholdRecoveryAuthority
} from "../src/deployment/TestnetThresholdRecoveryAuthority.sol";
import {VrfSubscriptionBootstrap} from "../src/deployment/VrfSubscriptionBootstrap.sol";
import {QuotronDiscoveryAdapter} from "../src/discovery/QuotronDiscoveryAdapter.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {IClaimGate} from "../src/interfaces/IClaimGate.sol";
import {ICollectibleMetadata} from "../src/interfaces/ICollectibleMetadata.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {IConversionVenue} from "../src/interfaces/IConversionVenue.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {GenesisLiquidityVault} from "../src/liquidity/GenesisLiquidityVault.sol";
import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalFeeHook} from "../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {
    IAttributeMetadataRegistry,
    PlaceholderMetadataRenderer
} from "../src/metadata/PlaceholderMetadataRenderer.sol";
import {MintableTestToken} from "../src/test-assets/MintableTestToken.sol";
import {MintableTestWETH} from "../src/test-assets/MintableTestWETH.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockUSDC} from "../src/test-assets/MockUSDC.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {TestConversionVenue} from "../src/test-assets/TestConversionVenue.sol";

/// @notice Deploys, wires, seals, seeds, launches, and re-verifies the complete POC.
/// @dev Use scripts/deploy-protocol.ts so transaction hashes are finalized in the manifest.
contract DeployProtocol is Script {
    bytes32 internal constant IDENTITY_MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;
    uint160 private constant ALL_HOOK_BITS = (1 << 14) - 1;
    uint256 private constant LOCAL_CHAIN_ID = 31_337;
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant ATTRIBUTE_BATCH_SIZE = 256;
    uint256 private constant LOCAL_WETH_SEED = 40 ether;
    address private constant BASE_SEPOLIA_VRF_COORDINATOR =
        0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
    bytes32 private constant BASE_SEPOLIA_VRF_KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;
    uint16 private constant VRF_REQUEST_CONFIRMATIONS = 3;
    uint32 private constant VRF_CALLBACK_GAS_LIMIT = 200_000;
    uint256 private constant DEFAULT_VRF_NATIVE_FUNDING = 0.03 ether;

    struct Roles {
        address owner;
        /// @dev Owns the mutable modules. A Safe or other multisig belongs here
        ///      so governance is separate from the hot keeper and executor keys.
        ///      Defaults to `owner` when a deployment has no separate signer.
        address governanceOwner;
        address guardian;
        address recoveryAuthority;
        address keeper;
        address liquidityExecutor;
        address creator;
    }

    /// @dev Each mutable module's expected ownership. Checking every module
    ///      against one nominal `roles.owner` cannot describe a deployment
    ///      whose governance handover has been accepted: after the multisig
    ///      accepts, `owner()` is the multisig on four modules and the deployer
    ///      on `FuelCore`, and a single expected address is wrong for one set
    ///      or the other. A rerun would then fail forever with no way to
    ///      re-record its way out, which is the same defect the manifest's
    ///      `moduleOwners` already fixed for health.
    struct ModuleOwnership {
        address owner;
        address pendingOwner;
    }

    struct ModuleOwnerships {
        ModuleOwnership liquidToken;
        ModuleOwnership rewardLedger;
        ModuleOwnership epochConverter;
        ModuleOwnership marketRegistry;
        ModuleOwnership protocolLiquidity;
    }

    /// @dev Returns the configured address, or the fallback when the key is
    ///      absent, so an existing deployment input stays valid.
    function _optionalRoleAddress(string memory json, string memory key, address fallbackAddress)
        private
        view
        returns (address)
    {
        if (!vm.keyExistsJson(json, key)) return fallbackAddress;
        address configured = vm.parseJsonAddress(json, key);
        return configured == address(0) ? fallbackAddress : configured;
    }

    /// @dev What an existing deployment recorded. Falling back to `roles.owner`
    ///      keeps a manifest written before module ownership was recorded valid,
    ///      and a manifest written after an accepted handover verifies against
    ///      the owners it actually names.
    function _recordedModuleOwnerships(string memory json, Roles memory roles)
        private
        view
        returns (ModuleOwnerships memory ownerships)
    {
        ownerships.liquidToken = _recordedModuleOwnership(json, "liquidToken", roles);
        ownerships.rewardLedger = _recordedModuleOwnership(json, "rewardLedger", roles);
        ownerships.epochConverter = _recordedModuleOwnership(json, "epochConverter", roles);
        ownerships.marketRegistry = _recordedModuleOwnership(json, "marketRegistry", roles);
        ownerships.protocolLiquidity =
            _recordedModuleOwnership(json, "protocolLiquidityVault", roles);
    }

    function _recordedModuleOwnership(string memory json, string memory module, Roles memory roles)
        private
        view
        returns (ModuleOwnership memory)
    {
        address owner =
            _optionalRoleAddress(json, string.concat(".moduleOwners.", module), roles.owner);
        // The pending key defaults to the offer this configuration would make,
        // so a manifest predating the field still describes a governed
        // deployment correctly. `FuelCore` is never offered.
        address defaultPending =
            _sameString(module, "liquidToken") ? address(0) : _expectedPendingOwner(roles);
        string memory pendingKey = string.concat(".modulePendingOwners.", module);
        address pending = vm.keyExistsJson(json, pendingKey)
            ? vm.parseJsonAddress(json, pendingKey)
            : defaultPending;
        return ModuleOwnership(owner, pending);
    }

    struct VenueDeployment {
        IPoolManager manager;
        address weth;
        address usdc;
        MockStock[4] stocks;
        TestConversionVenue venue;
    }

    struct ProtocolDeployment {
        AttributeRegistry attributes;
        IVRFCoordinatorV2Plus vrfCoordinator;
        uint256 vrfSubscriptionId;
        QuotronDiscoveryAdapter discovery;
        FuelCore fuel;
        FuelMirror mirror;
        IClaimGate claimGate;
        RewardLedger ledger;
        EpochConverter converter;
        CanonicalMarketRegistry marketRegistry;
        ProtocolLiquidityVault protocolLiquidity;
        CanonicalHookDeployer hookDeployer;
        CanonicalFeeHook hook;
        CanonicalRouter router;
        GenesisLiquidityVault genesisLiquidity;
        PlaceholderMetadataRenderer metadataRenderer;
        SepoliaV4ConversionAdapter[4] adapters;
    }

    struct MetadataLocations {
        string transientImage;
        string permanentImage;
        string basketRelicImage;
        string indicatorRelicImage;
    }

    struct ProductIdentity {
        string key;
        string liquidTokenName;
        string liquidTokenSymbol;
        string collectibleTokenName;
        string collectibleTokenSymbol;
        string transientCollectible;
        string permanentCollectible;
        string basketRelic;
        string indicatorRelic;
        string metadataDescription;
        MetadataLocations metadata;
    }

    error ExistingDeploymentMismatch(string field);
    error MissingCode(address account);
    error UnsupportedChain(uint256 chainId);

    function run() external {
        _requireSupportedChain();
        string memory manifestPath = _manifestPath();
        ProductIdentity memory identity = _productIdentity();
        bool forceDeployment = vm.envOr("FORCE_PROTOCOL_DEPLOY", false);
        if (!forceDeployment && _isCompletedManifest(manifestPath)) {
            _verifyManifest(manifestPath, identity);
            return;
        }

        (address deployer, uint256 privateKey) = _deployer();
        Roles memory roles = _roles(deployer);
        if (block.chainid == LOCAL_CHAIN_ID) {
            vm.startBroadcast(deployer);
        } else {
            vm.startBroadcast(privateKey);
        }

        VenueDeployment memory venue = _deployVenue(deployer, manifestPath);
        (ProtocolDeployment memory protocol, address recoveryAuthority) =
            _deployProtocol(venue, roles, identity);
        roles.recoveryAuthority = recoveryAuthority;
        _configureAndLaunch(venue, protocol, roles);
        vm.stopBroadcast();

        _verify(venue, protocol, roles, _deployedModuleOwnerships(roles), identity, true);
        _writeManifest(manifestPath, venue, protocol, roles, identity);
    }

    function _deployVenue(address deployer, string memory manifestPath)
        private
        returns (VenueDeployment memory deployment)
    {
        if (block.chainid == LOCAL_CHAIN_ID) {
            deployment.manager = new PoolManager(deployer);
            MockWETH localWeth = new MockWETH();
            deployment.weth = address(localWeth);
            deployment.usdc = address(new MockUSDC(1_000_000_000 * 1e6, deployer));
            localWeth.deposit{value: LOCAL_WETH_SEED}();
        } else {
            if (vm.envOr("SELF_FUNDED_TEST_ASSETS", false)) {
                return _loadSelfFundedVenue(deployer, manifestPath);
            }
            BaseSepoliaInfrastructure.validateDeployedOfficialInfrastructure();
            deployment.manager = IPoolManager(BaseSepoliaInfrastructure.POOL_MANAGER);
            deployment.weth = BaseSepoliaInfrastructure.WETH;
            deployment.usdc = BaseSepoliaInfrastructure.USDC;
        }

        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            deployment.stocks[index] =
                new MockStock(stock.name, stock.symbol, VenueConfig.STOCK_FIXED_SUPPLY, deployer);
        }
        deployment.venue = new TestConversionVenue(deployment.manager, deployer);
        _approveMax(deployment.weth, address(deployment.venue));
        _approveMax(deployment.usdc, address(deployment.venue));
        for (uint256 index; index < 4; ++index) {
            _approveMax(address(deployment.stocks[index]), address(deployment.venue));
        }
        deployment.venue
            .initializeWethUsdcPool(
                deployment.weth, deployment.usdc, VenueConfig.WETH_USDC_SEED_LIQUIDITY
            );
        for (uint256 index; index < 4; ++index) {
            deployment.venue
                .initializeUsdcStockPool(
                    deployment.usdc,
                    address(deployment.stocks[index]),
                    VenueConfig.USDC_STOCK_SEED_LIQUIDITY
                );
        }
    }

    function _loadSelfFundedVenue(address deployer, string memory manifestPath)
        private
        view
        returns (VenueDeployment memory deployment)
    {
        BaseSepoliaInfrastructure.validateDeployedPoolManager();
        string memory json = vm.readFile(manifestPath);
        uint256 schemaVersion = vm.parseJsonUint(json, ".schemaVersion");
        require(schemaVersion == 1 || schemaVersion == 2, "expected venue or protocol manifest");
        require(vm.parseJsonUint(json, ".chainId") == BASE_SEPOLIA_CHAIN_ID, "wrong venue chain");
        require(
            _sameString(vm.parseJsonString(json, ".network"), "base-sepolia"), "wrong venue network"
        );

        deployment.manager =
            IPoolManager(vm.parseJsonAddress(json, ".contracts.uniswapV4PoolManager"));
        require(
            address(deployment.manager) == BaseSepoliaInfrastructure.POOL_MANAGER,
            "wrong venue PoolManager"
        );
        deployment.weth = vm.parseJsonAddress(
            json, schemaVersion == 1 ? ".contracts.selfFundedTestWeth" : ".contracts.weth"
        );
        deployment.usdc = vm.parseJsonAddress(
            json, schemaVersion == 1 ? ".contracts.selfFundedTestUsdc" : ".contracts.usdc"
        );
        deployment.venue =
            TestConversionVenue(vm.parseJsonAddress(json, ".contracts.testConversionVenue"));
        for (uint256 index; index < VenueConfig.STOCK_COUNT; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            deployment.stocks[index] = MockStock(
                vm.parseJsonAddress(json, string.concat(".contracts.", stock.contractManifestKey))
            );
        }

        _verifySelfFundedVenueAssets(deployment, deployer);
        _verifyVenue(deployment, deployer);
    }

    function _verifySelfFundedVenueAssets(VenueDeployment memory venue, address operator)
        private
        view
    {
        require(
            MintableTestWETH(payable(venue.weth)).isWrappedNativeTestAsset(),
            "self-funded WETH cannot wrap native Ether"
        );
        _verifySelfFundedAsset(
            MintableTestToken(venue.weth),
            VenueConfig.SELF_FUNDED_WETH_NAME,
            VenueConfig.SELF_FUNDED_WETH_SYMBOL,
            VenueConfig.SELF_FUNDED_WETH_DECIMALS,
            VenueConfig.SELF_FUNDED_WETH_INITIAL_SUPPLY,
            operator
        );
        _verifySelfFundedAsset(
            MintableTestToken(venue.usdc),
            VenueConfig.SELF_FUNDED_USDC_NAME,
            VenueConfig.SELF_FUNDED_USDC_SYMBOL,
            VenueConfig.SELF_FUNDED_USDC_DECIMALS,
            VenueConfig.SELF_FUNDED_USDC_INITIAL_SUPPLY,
            operator
        );
        for (uint256 index; index < VenueConfig.STOCK_COUNT; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            require(_sameString(venue.stocks[index].name(), stock.name), "wrong mock stock name");
            require(
                _sameString(venue.stocks[index].symbol(), stock.symbol), "wrong mock stock symbol"
            );
            require(
                venue.stocks[index].totalSupply() == VenueConfig.STOCK_FIXED_SUPPLY,
                "wrong mock stock supply"
            );
        }
    }

    /// @dev The supply floor is `>=`, not `==`. These two assets are
    ///      `MintableTestToken`: the venue operator mints them on demand and the
    ///      testnet funding service does exactly that, so their supply grows
    ///      with ordinary use. There is no burn path, so the initial supply is a
    ///      floor that can never be crossed downward, and a token that failed to
    ///      mint its initial supply still fails here. Requiring equality instead
    ///      made every Base Sepolia redeployment fail once a single faucet
    ///      request had been served. The fixed-supply mock stocks are checked
    ///      with `==` above, because `MockStock` has no mint function at all.
    function _verifySelfFundedAsset(
        MintableTestToken token,
        string memory expectedName,
        string memory expectedSymbol,
        uint8 expectedDecimals,
        uint256 minimumSupply,
        address expectedOperator
    ) private view {
        require(address(token).code.length != 0, "missing self-funded asset");
        require(_sameString(token.name(), expectedName), "wrong self-funded asset name");
        require(_sameString(token.symbol(), expectedSymbol), "wrong self-funded asset symbol");
        require(token.decimals() == expectedDecimals, "wrong self-funded asset decimals");
        require(token.totalSupply() >= minimumSupply, "self-funded asset below initial supply");
        require(token.operator() == expectedOperator, "wrong self-funded asset operator");
    }

    function _deployProtocol(
        VenueDeployment memory venue,
        Roles memory roles,
        ProductIdentity memory identity
    ) private returns (ProtocolDeployment memory protocol, address recoveryAuthority) {
        protocol.attributes = new AttributeRegistry(IDENTITY_MANIFEST_HASH);
        _loadAndSealAttributes(protocol.attributes);
        VrfSubscriptionBootstrap vrfBootstrap = _createVrfSubscription(roles.owner);
        protocol.vrfCoordinator = vrfBootstrap.coordinator();
        protocol.vrfSubscriptionId = vrfBootstrap.subscriptionId();
        protocol.discovery = vrfBootstrap.discovery();

        IThresholdRecovery recovery;
        if (block.chainid == LOCAL_CHAIN_ID) {
            recovery = new DevelopmentRecoveryAuthority(roles.owner, 2);
        } else {
            if (roles.recoveryAuthority == address(0)) {
                recovery = new TestnetThresholdRecoveryAuthority(
                    roles.owner, vm.envAddress("RECOVERY_COSIGNER_ADDRESS")
                );
            } else {
                recovery = IThresholdRecovery(roles.recoveryAuthority);
            }
            if (address(recovery).code.length == 0) revert MissingCode(address(recovery));
            require(recovery.getThreshold() >= 2, "recovery threshold below two");
        }
        recoveryAuthority = address(recovery);

        protocol.fuel = new FuelCore(
            identity.liquidTokenName,
            identity.liquidTokenSymbol,
            identity.collectibleTokenName,
            identity.collectibleTokenSymbol,
            roles.owner,
            protocol.discovery,
            roles.guardian,
            recovery
        );
        vrfBootstrap.finalizeFuelCore(address(protocol.fuel));
        protocol.discovery.acceptOwnership();
        protocol.mirror = protocol.fuel.mirror();
        protocol.claimGate = IClaimGate(_deployClaimGate());
        address[4] memory rewardTokens;
        for (uint256 index; index < 4; ++index) {
            rewardTokens[index] = address(venue.stocks[index]);
        }
        protocol.ledger = new RewardLedger(
            address(protocol.fuel),
            protocol.attributes,
            rewardTokens,
            protocol.claimGate,
            roles.owner
        );
        protocol.converter =
            new EpochConverter(venue.weth, address(protocol.ledger), roles.keeper, roles.owner);
        protocol.marketRegistry = new CanonicalMarketRegistry(
            venue.manager, address(protocol.fuel), venue.weth, roles.owner
        );
        protocol.protocolLiquidity = new ProtocolLiquidityVault(
            ICanonicalMarketRegistry(address(protocol.marketRegistry)),
            roles.owner,
            roles.liquidityExecutor
        );
        protocol.hookDeployer = new CanonicalHookDeployer();
        bytes32 hookSalt = _mineHookSalt(
            protocol.hookDeployer,
            venue.manager,
            protocol.marketRegistry,
            venue.weth,
            address(protocol.converter),
            address(protocol.protocolLiquidity),
            roles.creator
        );
        protocol.hook = protocol.hookDeployer
            .deploy(
                hookSalt,
                venue.manager,
                protocol.marketRegistry,
                venue.weth,
                address(protocol.converter),
                address(protocol.protocolLiquidity),
                roles.creator
            );
        protocol.router = new CanonicalRouter(venue.manager, protocol.marketRegistry, venue.weth);
        protocol.marketRegistry
            .registerPool(
                _canonicalPoolKey(address(protocol.fuel), venue.weth, protocol.hook),
                address(protocol.router)
            );
        protocol.marketRegistry.seal();
        protocol.genesisLiquidity = new GenesisLiquidityVault(
            ICanonicalMarketRegistry(address(protocol.marketRegistry)), roles.owner
        );
        protocol.hook.configureInitializer(address(protocol.genesisLiquidity));
        protocol.metadataRenderer = new PlaceholderMetadataRenderer(
            IAttributeMetadataRegistry(address(protocol.attributes)),
            PlaceholderMetadataRenderer.IdentityConfiguration({
                transientCollectible: identity.transientCollectible,
                permanentCollectible: identity.permanentCollectible,
                basketRelic: identity.basketRelic,
                indicatorRelic: identity.indicatorRelic,
                metadataDescription: identity.metadataDescription,
                transientImage: identity.metadata.transientImage,
                permanentImage: identity.metadata.permanentImage,
                basketRelicImage: identity.metadata.basketRelicImage,
                indicatorRelicImage: identity.metadata.indicatorRelicImage
            })
        );
        for (uint8 index; index < 4; ++index) {
            protocol.adapters[index] = new SepoliaV4ConversionAdapter(
                AttributeRegistry.RewardTrack(index + 1),
                address(protocol.converter),
                venue.weth,
                venue.usdc,
                address(venue.stocks[index]),
                address(protocol.ledger),
                IConversionVenue(address(venue.venue))
            );
        }
    }

    function _createVrfSubscription(address deploymentOwner)
        private
        returns (VrfSubscriptionBootstrap bootstrap)
    {
        IVRFCoordinatorV2Plus coordinator;
        if (block.chainid == LOCAL_CHAIN_ID) {
            coordinator = IVRFCoordinatorV2Plus(address(new VRFCoordinatorV2_5Mock(0, 0, 1 ether)));
            // Foundry simulates an entire local deployment against Anvil's
            // genesis block before broadcasting. Chainlink's official mock
            // derives subscription IDs from block.number - 1, while the
            // broadcast itself necessarily lands after genesis.
            if (block.number == 0) vm.roll(1);
        } else {
            coordinator = IVRFCoordinatorV2Plus(BASE_SEPOLIA_VRF_COORDINATOR);
            if (address(coordinator).code.length == 0) revert MissingCode(address(coordinator));
        }
        uint256 funding = block.chainid == LOCAL_CHAIN_ID
            ? 1 ether
            : vm.envOr("VRF_NATIVE_FUNDING_WEI", DEFAULT_VRF_NATIVE_FUNDING);
        bootstrap = new VrfSubscriptionBootstrap{value: funding}(
            coordinator,
            block.chainid == BASE_SEPOLIA_CHAIN_ID
                ? BASE_SEPOLIA_VRF_KEY_HASH
                : bytes32(uint256(1)),
            VRF_REQUEST_CONFIRMATIONS,
            VRF_CALLBACK_GAS_LIMIT,
            deploymentOwner
        );
    }

    function _configureAndLaunch(
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol,
        Roles memory roles
    ) private {
        protocol.ledger.sealEpochConverter(address(protocol.converter));
        protocol.converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(protocol.hook)));
        for (uint8 index; index < 4; ++index) {
            protocol.converter
                .configureTrack(
                    AttributeRegistry.RewardTrack(index + 1),
                    address(venue.stocks[index]),
                    protocol.adapters[index]
                );
        }
        protocol.converter.sealConfiguration();
        protocol.protocolLiquidity
            .configureCanonicalFeeHook(ICanonicalFeeHook(address(protocol.hook)));
        protocol.protocolLiquidity.sealConfiguration();

        protocol.fuel.setMetadataRenderer(ICollectibleMetadata(address(protocol.metadataRenderer)));
        protocol.fuel.setRewardLedger(protocol.ledger);
        protocol.fuel
            .setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(protocol.marketRegistry)));
        // The blocklist is frozen once the token launches, so the whole
        // configured inventory must be written here. Anything omitted can never
        // be added to this deployment.
        protocol.fuel.setBlockedVenueCodehash(address(venue.venue).codehash, true);
        _configureBlockedVenueInventory(protocol);
        _configureProtocolAccounts(venue, protocol);

        protocol.fuel.approve(address(protocol.genesisLiquidity), type(uint256).max);
        protocol.genesisLiquidity.initializeAndSeed(block.timestamp + 15 minutes);
        protocol.fuel.setDiscoveryExempt(roles.owner, false);
        // Offering ownership does not surrender it, so this runs before the
        // launch and keeps the launch the deployment's final transaction, which
        // the manifest writer relies on to identify it.
        _handOverModuleGovernance(protocol, roles);
        protocol.fuel.launch();
    }

    /// @dev Offers each mutable module to the governance owner. Ownership is
    ///      two-step by design, so a deployment cannot push it onto an address
    ///      that has not accepted: the deployer stays owner until the
    ///      governance address calls `acceptOwnership`. That is also why the
    ///      modules are constructed deployer-owned — every configuration and
    ///      sealing call above is `onlyOwner`, so constructing them
    ///      governance-owned made the deployment revert outright.
    function _handOverModuleGovernance(ProtocolDeployment memory protocol, Roles memory roles)
        private
    {
        if (roles.governanceOwner == roles.owner) return;
        protocol.ledger.transferOwnership(roles.governanceOwner);
        protocol.converter.transferOwnership(roles.governanceOwner);
        protocol.marketRegistry.transferOwnership(roles.governanceOwner);
        protocol.protocolLiquidity.transferOwnership(roles.governanceOwner);
    }

    /// @dev The handover target still awaiting acceptance, or the zero address
    ///      when the deployment configured no separate governance owner.
    function _expectedPendingOwner(Roles memory roles) private pure returns (address) {
        return roles.governanceOwner == roles.owner ? address(0) : roles.governanceOwner;
    }

    /// @dev What this run just produced: the deployer owns everything and the
    ///      four mutable modules carry an outstanding offer. `FuelCore` is never
    ///      offered, so it carries none.
    function _deployedModuleOwnerships(Roles memory roles)
        private
        pure
        returns (ModuleOwnerships memory ownerships)
    {
        address pending = _expectedPendingOwner(roles);
        ownerships.liquidToken = ModuleOwnership(roles.owner, address(0));
        ownerships.rewardLedger = ModuleOwnership(roles.owner, pending);
        ownerships.epochConverter = ModuleOwnership(roles.owner, pending);
        ownerships.marketRegistry = ModuleOwnership(roles.owner, pending);
        ownerships.protocolLiquidity = ModuleOwnership(roles.owner, pending);
    }

    /// @dev Every current Permanent Collectible owner is eligible to claim.
    ///      The zero administrator is part of the manifest evidence: no wallet
    ///      can be inserted into the ordinary claim path as an approver.
    function _claimPolicyJson() private pure returns (string memory) {
        return string.concat(
            '{"mode":"always-allow","implementationCodehash":"',
            vm.toString(DeploymentClaimPolicy.implementationCodehash()),
            '","administrator":"',
            vm.toString(address(0)),
            '"}'
        );
    }

    function _deployClaimGate() private returns (address) {
        return DeploymentClaimPolicy.deploy();
    }

    /// @dev The deployment-specific inventory of known alternative-venue
    ///      implementation codehashes, read from deployment inputs. ADR 0002
    ///      promises this inventory; an empty one narrows the claim to the
    ///      single verified test venue, which the manifest then records.
    function _configureBlockedVenueInventory(ProtocolDeployment memory protocol) private {
        bytes32[] memory inventory = _blockedVenueInventory();
        for (uint256 index; index < inventory.length; ++index) {
            protocol.fuel.setBlockedVenueCodehash(inventory[index], true);
        }
    }

    /// @dev Each inventory entry carries its provenance -- the address it was
    ///      observed at, where the address came from, and why blocking it is
    ///      the right unit. Codehashes and labels are read from the same array
    ///      by index so the two cannot drift apart.
    ///
    ///      Entries are counted and read one index at a time rather than with a
    ///      `.entries[*].codehash` wildcard: a wildcard that matches exactly
    ///      one element does not decode as a one-element array, so an inventory
    ///      with a single entry would revert the whole deployment.
    function _blockedVenueInventory() private view returns (bytes32[] memory inventory) {
        string memory json = _blockedVenueInventoryFile();
        uint256 count = _blockedVenueEntryCount(json);
        inventory = new bytes32[](count);
        for (uint256 index; index < count; ++index) {
            inventory[index] = vm.parseJsonBytes32(json, _blockedVenueEntryKey(index, "codehash"));
        }
    }

    function _blockedVenueLabels() private view returns (string[] memory labels) {
        string memory json = _blockedVenueInventoryFile();
        uint256 count = _blockedVenueEntryCount(json);
        labels = new string[](count);
        for (uint256 index; index < count; ++index) {
            labels[index] = vm.parseJsonString(json, _blockedVenueEntryKey(index, "label"));
        }
    }

    function _blockedVenueEntryCount(string memory json) private view returns (uint256 count) {
        if (bytes(json).length == 0) return 0;
        while (vm.keyExistsJson(json, string.concat(".entries[", vm.toString(count), "]"))) {
            ++count;
        }
    }

    function _blockedVenueEntryKey(uint256 index, string memory field)
        private
        pure
        returns (string memory)
    {
        return string.concat(".entries[", vm.toString(index), "].", field);
    }

    function _blockedVenueInventoryFile() private view returns (string memory) {
        string memory path = vm.envOr("BLOCKED_VENUE_INVENTORY_PATH", string(""));
        if (bytes(path).length == 0) return "";
        return vm.readFile(path);
    }

    function _configureProtocolAccounts(
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol
    ) private {
        address[] memory accounts = _protocolAccounts(venue, protocol);
        for (uint256 index; index < accounts.length; ++index) {
            protocol.fuel.setDiscoveryExempt(accounts[index], true);
            protocol.fuel.setProtectedAccount(accounts[index], true);
        }
    }

    function _protocolAccounts(VenueDeployment memory venue, ProtocolDeployment memory protocol)
        private
        pure
        returns (address[] memory accounts)
    {
        accounts = new address[](19);
        accounts[0] = address(venue.manager);
        accounts[1] = address(venue.venue);
        accounts[2] = address(protocol.attributes);
        accounts[3] = address(protocol.discovery);
        accounts[4] = address(protocol.mirror);
        accounts[5] = address(protocol.claimGate);
        accounts[6] = address(protocol.ledger);
        accounts[7] = address(protocol.converter);
        accounts[8] = address(protocol.marketRegistry);
        accounts[9] = address(protocol.protocolLiquidity);
        accounts[10] = address(protocol.hookDeployer);
        accounts[11] = address(protocol.hook);
        accounts[12] = address(protocol.router);
        accounts[13] = address(protocol.genesisLiquidity);
        accounts[14] = address(protocol.metadataRenderer);
        for (uint256 index; index < 4; ++index) {
            accounts[15 + index] = address(protocol.adapters[index]);
        }
    }

    function _loadAndSealAttributes(AttributeRegistry registry) private {
        bytes memory canonical = vm.readFileBinary("../config/collection/manifest.bin");
        require(canonical.length == 4_444 * 7, "invalid identity manifest length");
        uint256 cursor;
        while (cursor < 4_444) {
            uint256 remaining = 4_444 - cursor;
            uint256 batchSize = remaining < ATTRIBUTE_BATCH_SIZE ? remaining : ATTRIBUTE_BATCH_SIZE;
            AttributeRegistry.AttributeInput[] memory batch =
                new AttributeRegistry.AttributeInput[](batchSize);
            for (uint256 index; index < batchSize; ++index) {
                uint256 offset = (cursor + index) * 7;
                batch[index] = AttributeRegistry.AttributeInput({
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
            cursor += batchSize;
        }
        registry.seal();
    }

    function _mineHookSalt(
        CanonicalHookDeployer deployer,
        IPoolManager manager,
        CanonicalMarketRegistry registry,
        address weth,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) private view returns (bytes32) {
        bytes32 initCodeHash = deployer.hookInitCodeHash(
            manager, registry, weth, rewardDestination, liquidityDestination, creatorDestination
        );
        uint160 required = registry.REQUIRED_PERMISSION_BITS();
        for (uint256 nonce; nonce < type(uint256).max; ++nonce) {
            bytes32 salt = bytes32(nonce);
            if ((uint160(deployer.computeAddress(salt, initCodeHash)) & ALL_HOOK_BITS) == required)
            {
                return salt;
            }
        }
        revert("permissioned hook salt not found");
    }

    function _canonicalPoolKey(address fuel, address weth, CanonicalFeeHook hook)
        private
        pure
        returns (PoolKey memory key)
    {
        (Currency currency0, Currency currency1) = fuel < weth
            ? (Currency.wrap(fuel), Currency.wrap(weth))
            : (Currency.wrap(weth), Currency.wrap(fuel));
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    function _approveMax(address token, address spender) private {
        require(IERC20Minimal(token).approve(spender, type(uint256).max), "approval failed");
    }

    function _requireSupportedChain() private view {
        if (block.chainid != LOCAL_CHAIN_ID && block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
    }

    function _deployer() private view returns (address deployer, uint256 privateKey) {
        if (block.chainid == LOCAL_CHAIN_ID) {
            deployer = vm.envAddress("DEPLOYER_ADDRESS");
        } else {
            privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
            deployer = vm.addr(privateKey);
        }
        require(deployer != address(0), "zero deployer");
    }

    function _roles(address deployer) private view returns (Roles memory roles) {
        roles.owner = deployer;
        // Owns the mutable modules. A multisig belongs here for a value-bearing
        // deployment; it defaults to the deployer so an existing deployment
        // reproduces unchanged.
        roles.governanceOwner = vm.envOr("GOVERNANCE_OWNER_ADDRESS", deployer);
        if (block.chainid == LOCAL_CHAIN_ID) {
            roles.guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);
            roles.keeper = vm.envOr("KEEPER_ADDRESS", deployer);
            roles.liquidityExecutor = vm.envOr("LIQUIDITY_EXECUTOR_ADDRESS", deployer);
            roles.creator = vm.envOr("CREATOR_ADDRESS", deployer);
            roles.recoveryAuthority = address(0);
        } else {
            roles.guardian = vm.envAddress("GUARDIAN_ADDRESS");
            roles.keeper = vm.envAddress("KEEPER_ADDRESS");
            roles.liquidityExecutor = vm.envAddress("LIQUIDITY_EXECUTOR_ADDRESS");
            roles.creator = vm.envAddress("CREATOR_ADDRESS");
            roles.recoveryAuthority = vm.envOr("RECOVERY_AUTHORITY_ADDRESS", address(0));
        }
        require(
            roles.guardian != address(0) && roles.keeper != address(0)
                && roles.liquidityExecutor != address(0) && roles.creator != address(0)
                && roles.governanceOwner != address(0),
            "zero role"
        );
    }

    function _productIdentity() private view returns (ProductIdentity memory identity) {
        identity.key = vm.envString("PRODUCT_IDENTITY_KEY");
        identity.liquidTokenName = vm.envString("LIQUID_TOKEN_NAME");
        identity.liquidTokenSymbol = vm.envString("LIQUID_TOKEN_SYMBOL");
        identity.collectibleTokenName = vm.envString("COLLECTIBLE_TOKEN_NAME");
        identity.collectibleTokenSymbol = vm.envString("COLLECTIBLE_TOKEN_SYMBOL");
        identity.transientCollectible = vm.envString("TRANSIENT_COLLECTIBLE_TERM");
        identity.permanentCollectible = vm.envString("PERMANENT_COLLECTIBLE_TERM");
        identity.basketRelic = vm.envString("BASKET_RELIC_TERM");
        identity.indicatorRelic = vm.envString("INDICATOR_RELIC_TERM");
        identity.metadataDescription = vm.envString("METADATA_DESCRIPTION");
        identity.metadata.transientImage = vm.envString("TRANSIENT_METADATA_LOCATION");
        identity.metadata.permanentImage = vm.envString("PERMANENT_METADATA_LOCATION");
        identity.metadata.basketRelicImage = vm.envString("BASKET_RELIC_METADATA_LOCATION");
        identity.metadata.indicatorRelicImage = vm.envString("INDICATOR_RELIC_METADATA_LOCATION");
    }

    function _manifestPath() private view returns (string memory) {
        string memory defaultPath = string.concat(
            vm.projectRoot(), "/../../deployments/", vm.toString(block.chainid), ".json"
        );
        return vm.envOr("DEPLOYMENT_MANIFEST_PATH", defaultPath);
    }

    function _isCompletedManifest(string memory path) private returns (bool) {
        if (!vm.exists(path)) return false;
        string memory json = vm.readFile(path);
        try vm.parseJsonUint(json, ".schemaVersion") returns (uint256 version) {
            return version == 2;
        } catch {
            return false;
        }
    }

    // Verification and manifest rendering are deliberately kept in this script so reruns use
    // independent onchain reads rather than trusting addresses emitted by the deployment branch.
    function _verify(
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol,
        Roles memory roles,
        ModuleOwnerships memory ownerships,
        ProductIdentity memory identity,
        bool verifyLaunchState
    ) private view {
        require(address(venue.manager).code.length != 0, "missing PoolManager");
        require(venue.weth.code.length != 0 && venue.usdc.code.length != 0, "missing venue asset");
        require(protocol.attributes.isSealed(), "attributes are not sealed");
        require(
            protocol.attributes.manifestCommitment() == IDENTITY_MANIFEST_HASH, "wrong manifest"
        );
        require(address(protocol.discovery).code.length != 0, "missing discovery adapter");
        require(
            address(protocol.discovery.s_vrfCoordinator()) == address(protocol.vrfCoordinator)
                && address(protocol.vrfCoordinator).code.length != 0,
            "wrong VRF coordinator"
        );
        require(
            protocol.discovery.subscriptionId() == protocol.vrfSubscriptionId
                && protocol.vrfSubscriptionId != 0,
            "wrong VRF subscription"
        );
        require(
            protocol.discovery.keyHash()
                    == (block.chainid == BASE_SEPOLIA_CHAIN_ID
                            ? BASE_SEPOLIA_VRF_KEY_HASH
                            : bytes32(uint256(1)))
                && protocol.discovery.requestConfirmations() == VRF_REQUEST_CONFIRMATIONS
                && protocol.discovery.callbackGasLimit() == VRF_CALLBACK_GAS_LIMIT
                && protocol.discovery.MAX_DISCOVERIES_PER_REQUEST() == 64
                && protocol.discovery.MAX_FINALIZATION_MUTATIONS() == 8
                && protocol.discovery.DELAY_THRESHOLD() == 15 minutes,
            "wrong VRF request configuration"
        );
        require(
            protocol.discovery.fuelCore() == address(protocol.fuel)
                && protocol.discovery.owner() == roles.owner,
            "wrong discovery adapter authority"
        );
        require(
            address(protocol.claimGate).codehash == DeploymentClaimPolicy.implementationCodehash(),
            "wrong claim gate code"
        );
        require(
            address(protocol.hookDeployer).codehash
                == keccak256(type(CanonicalHookDeployer).runtimeCode),
            "wrong hook deployer code"
        );
        require(
            protocol.fuel.owner() == ownerships.liquidToken.owner && protocol.fuel.launched(),
            "Fuel not launched"
        );
        // FuelCore is never nominated: it keeps the launch, pause, discovery,
        // and blocklist authority the deployment itself needs. An outstanding
        // nomination here would mean someone can take that authority by
        // accepting, so the deployment refuses to finish with one.
        require(
            protocol.fuel.pendingOwner() == ownerships.liquidToken.pendingOwner,
            "Fuel handover pending"
        );
        require(_sameString(protocol.fuel.name(), identity.liquidTokenName), "wrong liquid name");
        require(
            _sameString(protocol.fuel.symbol(), identity.liquidTokenSymbol), "wrong liquid symbol"
        );
        require(address(protocol.fuel.mirror()) == address(protocol.mirror), "wrong Fuel Mirror");
        require(
            _sameString(protocol.mirror.name(), identity.collectibleTokenName),
            "wrong collectible name"
        );
        require(
            _sameString(protocol.mirror.symbol(), identity.collectibleTokenSymbol),
            "wrong collectible symbol"
        );
        require(protocol.fuel.guardian() == roles.guardian, "wrong guardian");
        require(
            address(protocol.fuel.recoveryAuthority()) == roles.recoveryAuthority,
            "wrong recovery authority"
        );
        require(
            protocol.fuel.recoveryAuthority().getThreshold() >= 2, "recovery threshold below two"
        );
        require(address(protocol.fuel.rewardLedger()) == address(protocol.ledger), "wrong ledger");
        require(
            address(protocol.fuel.discoveryAdapter()) == address(protocol.discovery),
            "wrong discovery adapter"
        );
        require(
            address(protocol.fuel.canonicalMarketRegistry()) == address(protocol.marketRegistry),
            "wrong market registry"
        );
        require(
            address(protocol.fuel.mirror().metadataRenderer())
                == address(protocol.metadataRenderer),
            "wrong metadata renderer"
        );
        require(protocol.marketRegistry.isSealed(), "market registry is not sealed");
        require(
            protocol.marketRegistry.owner() == ownerships.marketRegistry.owner,
            "wrong registry owner"
        );
        require(
            protocol.marketRegistry.pendingOwner() == ownerships.marketRegistry.pendingOwner,
            "wrong registry pending owner"
        );
        require(protocol.marketRegistry.hook() == address(protocol.hook), "wrong hook");
        require(protocol.marketRegistry.router() == address(protocol.router), "wrong router");
        require(protocol.ledger.owner() == ownerships.rewardLedger.owner, "wrong ledger owner");
        require(
            protocol.ledger.pendingOwner() == ownerships.rewardLedger.pendingOwner,
            "wrong ledger pending owner"
        );
        require(protocol.ledger.fuelCore() == address(protocol.fuel), "wrong ledger Fuel");
        require(
            address(protocol.ledger.attributeRegistry()) == address(protocol.attributes),
            "wrong ledger attributes"
        );
        require(
            address(protocol.ledger.claimGate()) == address(protocol.claimGate), "wrong claim gate"
        );
        require(protocol.ledger.epochConverter() == address(protocol.converter), "wrong converter");
        require(
            protocol.converter.owner() == ownerships.epochConverter.owner, "wrong converter owner"
        );
        require(
            protocol.converter.pendingOwner() == ownerships.epochConverter.pendingOwner,
            "wrong converter pending owner"
        );
        require(protocol.converter.weth() == venue.weth, "wrong converter WETH");
        require(
            protocol.converter.rewardLedger() == address(protocol.ledger), "wrong converter ledger"
        );
        require(
            address(protocol.converter.canonicalFeeHook()) == address(protocol.hook),
            "wrong converter hook"
        );
        require(protocol.converter.keeper() == roles.keeper, "wrong keeper");
        require(protocol.converter.configurationSealed(), "routes are not sealed");
        require(
            protocol.protocolLiquidity.owner() == ownerships.protocolLiquidity.owner,
            "wrong liquidity owner"
        );
        require(
            protocol.protocolLiquidity.pendingOwner() == ownerships.protocolLiquidity.pendingOwner,
            "wrong liquidity vault pending owner"
        );
        require(
            protocol.protocolLiquidity.executor() == roles.liquidityExecutor,
            "wrong liquidity executor"
        );
        require(protocol.protocolLiquidity.configurationSealed(), "liquidity is not sealed");
        require(
            protocol.hook.rewardDestination() == address(protocol.converter),
            "wrong reward destination"
        );
        require(
            protocol.hook.liquidityDestination() == address(protocol.protocolLiquidity),
            "wrong liquidity destination"
        );
        require(protocol.hook.creatorDestination() == roles.creator, "wrong creator destination");
        require(
            protocol.fuel.isBlockedVenueCodehash(address(venue.venue).codehash),
            "conversion venue is not blocked"
        );
        require(protocol.genesisLiquidity.seeded(), "Genesis Liquidity is not seeded");
        if (verifyLaunchState) {
            protocol.genesisLiquidity.validateSeededPostconditions();
            require(protocol.fuel.balanceOf(roles.owner) == 0, "owner retained Fuel");
        }
        require(!protocol.fuel.isDiscoveryExempt(roles.owner), "owner remained exempt");
        require(
            _sameString(
                protocol.metadataRenderer.transientImageLocation(), identity.metadata.transientImage
            ),
            "wrong transient metadata"
        );
        require(
            _sameString(
                protocol.metadataRenderer.permanentImageLocation(), identity.metadata.permanentImage
            ),
            "wrong permanent metadata"
        );
        require(
            _sameString(
                protocol.metadataRenderer.basketRelicImageLocation(),
                identity.metadata.basketRelicImage
            ),
            "wrong Basket Relic metadata"
        );
        require(
            _sameString(
                protocol.metadataRenderer.indicatorRelicImageLocation(),
                identity.metadata.indicatorRelicImage
            ),
            "wrong Indicator Relic metadata"
        );
        require(
            _sameString(
                protocol.metadataRenderer.transientCollectible(), identity.transientCollectible
            )
            && _sameString(
                protocol.metadataRenderer.permanentCollectible(), identity.permanentCollectible
            ) && _sameString(protocol.metadataRenderer.basketRelic(), identity.basketRelic)
            && _sameString(protocol.metadataRenderer.indicatorRelic(), identity.indicatorRelic)
            && _sameString(
                protocol.metadataRenderer.metadataDescription(), identity.metadataDescription
            ),
            "wrong metadata identity"
        );
        for (uint8 index; index < 4; ++index) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(index + 1);
            (address stock, IConversionAdapter adapter) =
                protocol.converter.trackConfiguration(track);
            require(stock == address(venue.stocks[index]), "wrong track token");
            require(address(adapter) == address(protocol.adapters[index]), "wrong route adapter");
            require(
                protocol.adapters[index].converter() == address(protocol.converter),
                "wrong adapter converter"
            );
            require(protocol.adapters[index].weth() == venue.weth, "wrong adapter WETH");
            require(protocol.adapters[index].usdc() == venue.usdc, "wrong adapter USDC");
            require(
                protocol.adapters[index].stockToken() == address(venue.stocks[index]),
                "wrong adapter stock"
            );
            require(
                protocol.adapters[index].rewardLedger() == address(protocol.ledger),
                "wrong adapter ledger"
            );
            require(
                address(protocol.adapters[index].venue()) == address(venue.venue),
                "wrong adapter venue"
            );
            PoolId expectedWethUsdc = venue.venue.poolKey(venue.weth, venue.usdc).toId();
            PoolId expectedUsdcStock =
                venue.venue.poolKey(venue.usdc, address(venue.stocks[index])).toId();
            require(
                PoolId.unwrap(protocol.adapters[index].wethUsdcPoolId())
                    == PoolId.unwrap(expectedWethUsdc),
                "wrong WETH/USDC route"
            );
            require(
                PoolId.unwrap(protocol.adapters[index].usdcStockPoolId())
                    == PoolId.unwrap(expectedUsdcStock),
                "wrong USDC/Stock route"
            );
        }
        address[] memory accounts = _protocolAccounts(venue, protocol);
        for (uint256 index; index < accounts.length; ++index) {
            require(protocol.fuel.isDiscoveryExempt(accounts[index]), "protocol account not exempt");
            require(
                protocol.fuel.isProtectedAccount(accounts[index]), "protocol account not protected"
            );
        }
        _verifyVenue(venue, roles.owner);
    }

    function _sameString(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }

    function _verifyVenue(VenueDeployment memory venue, address owner) private view {
        require(venue.venue.operator() == owner, "wrong venue operator");
        VenueValidation.verifyPool(
            venue.venue,
            venue.weth,
            venue.usdc,
            VenueConfig.WETH_USDC_SEED_LIQUIDITY,
            VenueValidation.wethUsdcSeedPrice(venue.weth, venue.usdc)
        );
        for (uint256 index; index < 4; ++index) {
            require(venue.stocks[index].operator() == owner, "wrong MockStock operator");
            VenueValidation.verifyPool(
                venue.venue,
                venue.usdc,
                address(venue.stocks[index]),
                VenueConfig.USDC_STOCK_SEED_LIQUIDITY,
                VenueValidation.usdcStockSeedPrice(venue.usdc, address(venue.stocks[index]))
            );
        }
    }

    function _verifyManifest(string memory path, ProductIdentity memory identity) private view {
        string memory json = vm.readFile(path);
        if (vm.parseJsonUint(json, ".chainId") != block.chainid) {
            revert ExistingDeploymentMismatch("chainId");
        }
        VenueDeployment memory venue;
        venue.manager = IPoolManager(vm.parseJsonAddress(json, ".contracts.uniswapV4PoolManager"));
        venue.weth = vm.parseJsonAddress(json, ".contracts.weth");
        venue.usdc = vm.parseJsonAddress(json, ".contracts.usdc");
        venue.venue =
            TestConversionVenue(vm.parseJsonAddress(json, ".contracts.testConversionVenue"));
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            venue.stocks[index] = MockStock(
                vm.parseJsonAddress(json, string.concat(".contracts.", stock.contractManifestKey))
            );
        }
        ProtocolDeployment memory protocol;
        protocol.attributes =
            AttributeRegistry(vm.parseJsonAddress(json, ".contracts.attributeRegistry"));
        protocol.discovery =
            QuotronDiscoveryAdapter(vm.parseJsonAddress(json, ".contracts.discoveryAdapter"));
        protocol.vrfCoordinator = protocol.discovery.s_vrfCoordinator();
        protocol.vrfSubscriptionId = protocol.discovery.subscriptionId();
        protocol.fuel = FuelCore(vm.parseJsonAddress(json, ".contracts.fuelCore"));
        protocol.mirror = FuelMirror(vm.parseJsonAddress(json, ".contracts.fuelMirror"));
        protocol.claimGate = IClaimGate(vm.parseJsonAddress(json, ".contracts.claimGate"));
        protocol.ledger = RewardLedger(vm.parseJsonAddress(json, ".contracts.rewardLedger"));
        protocol.converter = EpochConverter(vm.parseJsonAddress(json, ".contracts.epochConverter"));
        protocol.marketRegistry = CanonicalMarketRegistry(
            vm.parseJsonAddress(json, ".contracts.canonicalMarketRegistry")
        );
        protocol.protocolLiquidity =
            ProtocolLiquidityVault(vm.parseJsonAddress(json, ".contracts.protocolLiquidityVault"));
        protocol.hookDeployer =
            CanonicalHookDeployer(vm.parseJsonAddress(json, ".contracts.canonicalHookDeployer"));
        protocol.hook = CanonicalFeeHook(vm.parseJsonAddress(json, ".contracts.canonicalFeeHook"));
        protocol.router =
            CanonicalRouter(payable(vm.parseJsonAddress(json, ".contracts.canonicalRouter")));
        protocol.genesisLiquidity =
            GenesisLiquidityVault(vm.parseJsonAddress(json, ".contracts.genesisLiquidityVault"));
        protocol.metadataRenderer =
            PlaceholderMetadataRenderer(vm.parseJsonAddress(json, ".contracts.metadataRenderer"));
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            protocol.adapters[index] = SepoliaV4ConversionAdapter(
                vm.parseJsonAddress(
                    json, string.concat(".contracts.", stock.poolManifestKey, "ConversionAdapter")
                )
            );
        }
        Roles memory roles = Roles({
            owner: vm.parseJsonAddress(json, ".roles.owner"),
            governanceOwner: _optionalRoleAddress(
                json, ".roles.governanceOwner", vm.parseJsonAddress(json, ".roles.owner")
            ),
            guardian: vm.parseJsonAddress(json, ".roles.guardian"),
            recoveryAuthority: vm.parseJsonAddress(json, ".roles.recoveryAuthority"),
            keeper: vm.parseJsonAddress(json, ".roles.keeper"),
            liquidityExecutor: vm.parseJsonAddress(json, ".roles.liquidityExecutor"),
            creator: vm.parseJsonAddress(json, ".roles.creator")
        });
        _verifyManifestExpectations(json, venue, protocol, identity);
        // The exact opening price, PoolManager balance, and owner Fuel balance are launch-time
        // postconditions. They are intentionally not reasserted after normal trading begins.
        _verify(venue, protocol, roles, _recordedModuleOwnerships(json, roles), identity, false);
    }

    function _verifyManifestExpectations(
        string memory json,
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol,
        ProductIdentity memory identity
    ) private view {
        if (keccak256(bytes(vm.parseJsonString(json, ".phase"))) != keccak256(bytes("launched"))) revert ExistingDeploymentMismatch("phase");
        string memory expectedNetwork = block.chainid == LOCAL_CHAIN_ID ? "anvil" : "base-sepolia";
        if (
            keccak256(bytes(vm.parseJsonString(json, ".network")))
                != keccak256(bytes(expectedNetwork))
        ) {
            revert ExistingDeploymentMismatch("network");
        }
        if (vm.parseJsonBytes32(json, ".identity.manifestHash") != IDENTITY_MANIFEST_HASH) {
            revert ExistingDeploymentMismatch("identity.manifestHash");
        }
        if (!_sameString(vm.parseJsonString(json, ".identity.key"), identity.key)) {
            revert ExistingDeploymentMismatch("identity.key");
        }
        if (
            vm.parseJsonAddress(json, ".identity.metadataRenderer")
                != address(protocol.metadataRenderer)
        ) {
            revert ExistingDeploymentMismatch("identity.metadataRenderer");
        }
        if (
            vm.parseJsonAddress(json, ".contracts.recoveryAuthority")
                != address(protocol.fuel.recoveryAuthority())
        ) {
            revert ExistingDeploymentMismatch("contracts.recoveryAuthority");
        }
        string[4] memory metadataKeys =
            [string("transient"), "permanent", "basketRelic", "indicatorRelic"];
        string[4] memory expectedLocations = [
            identity.metadata.transientImage,
            identity.metadata.permanentImage,
            identity.metadata.basketRelicImage,
            identity.metadata.indicatorRelicImage
        ];
        for (uint256 index; index < metadataKeys.length; ++index) {
            if (!_sameString(
                    vm.parseJsonString(
                        json, string.concat(".identity.metadataLocations.", metadataKeys[index])
                    ),
                    expectedLocations[index]
                )) {
                revert ExistingDeploymentMismatch(string.concat(
                        "identity.metadataLocations.", metadataKeys[index]
                    ));
            }
        }
        string[6] memory sealKeys = [
            string("attributes"),
            "canonicalMarket",
            "conversionRoutes",
            "feeDestinations",
            "discoveryExemptions",
            "metadata"
        ];
        for (uint256 index; index < sealKeys.length; ++index) {
            if (!vm.parseJsonBool(json, string.concat(".seals.", sealKeys[index]))) {
                revert ExistingDeploymentMismatch(string.concat("seals.", sealKeys[index]));
            }
        }
        _assertPoolManifest(
            json,
            ".canonicalPool",
            protocol.marketRegistry.poolId(),
            protocol.marketRegistry.poolKey(),
            protocol.genesisLiquidity.openingSqrtPriceX96(),
            protocol.genesisLiquidity.seededLiquidity()
        );
        (PoolId poolId_, PoolKey memory key, uint160 price, uint128 liquidity) =
            venue.venue.verifiedPoolConfiguration(venue.weth, venue.usdc);
        _assertPoolManifest(json, ".conversionPools.wethUsdc", poolId_, key, price, liquidity);
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            (poolId_, key, price, liquidity) =
                venue.venue.verifiedPoolConfiguration(venue.usdc, address(venue.stocks[index]));
            _assertPoolManifest(
                json,
                string.concat(".conversionPools.", stock.poolManifestKey),
                poolId_,
                key,
                price,
                liquidity
            );
        }
    }

    function _assertPoolManifest(
        string memory json,
        string memory path,
        PoolId poolId_,
        PoolKey memory key,
        uint160 price,
        uint128 liquidity
    ) private pure {
        if (vm.parseJsonBytes32(json, string.concat(path, ".poolId")) != PoolId.unwrap(poolId_)) {
            revert ExistingDeploymentMismatch(string.concat(path, ".poolId"));
        }
        if (
            vm.parseJsonAddress(json, string.concat(path, ".currency0"))
                != Currency.unwrap(key.currency0)
        ) {
            revert ExistingDeploymentMismatch(string.concat(path, ".currency0"));
        }
        if (
            vm.parseJsonAddress(json, string.concat(path, ".currency1"))
                != Currency.unwrap(key.currency1)
        ) {
            revert ExistingDeploymentMismatch(string.concat(path, ".currency1"));
        }
        if (vm.parseJsonUint(json, string.concat(path, ".fee")) != key.fee) {
            revert ExistingDeploymentMismatch(string.concat(path, ".fee"));
        }
        if (vm.parseJsonInt(json, string.concat(path, ".tickSpacing")) != key.tickSpacing) {
            revert ExistingDeploymentMismatch(string.concat(path, ".tickSpacing"));
        }
        if (vm.parseJsonAddress(json, string.concat(path, ".hooks")) != address(key.hooks)) {
            revert ExistingDeploymentMismatch(string.concat(path, ".hooks"));
        }
        if (
            keccak256(bytes(vm.parseJsonString(json, string.concat(path, ".seedSqrtPriceX96"))))
                != keccak256(bytes(vm.toString(uint256(price))))
        ) revert ExistingDeploymentMismatch(string.concat(path, ".seedSqrtPriceX96"));
        if (
            keccak256(bytes(vm.parseJsonString(json, string.concat(path, ".activeLiquidity"))))
                != keccak256(bytes(vm.toString(uint256(liquidity))))
        ) revert ExistingDeploymentMismatch(string.concat(path, ".activeLiquidity"));
    }

    function _writeManifest(
        string memory path,
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol,
        Roles memory roles,
        ProductIdentity memory identity
    ) private {
        // Split in two so the manifest writer stays within the EVM stack.
        string memory head = string.concat(
            '{"$schema":"./schema.json","schemaVersion":2,"chainId":',
            vm.toString(block.chainid),
            ',"network":"',
            block.chainid == LOCAL_CHAIN_ID ? "anvil" : "base-sepolia",
            '","phase":"launched","contracts":',
            _contractsJson(venue, protocol, roles),
            ',"roles":',
            _rolesJson(roles),
            ',"moduleOwners":',
            _moduleOwnersJson(protocol),
            ',"modulePendingOwners":',
            _modulePendingOwnersJson(protocol),
            ',"blockedVenues":',
            _blockedVenueInventoryJson(venue),
            ',"claimPolicy":',
            _claimPolicyJson()
        );
        string memory tail = string.concat(
            ',"identity":',
            _identityJson(protocol.metadataRenderer, identity),
            ',"conversionPools":',
            _conversionPoolsJson(venue),
            ',"canonicalPool":',
            _canonicalPoolJson(protocol),
            ',"seals":{"attributes":true,"canonicalMarket":true,"conversionRoutes":true,"feeDestinations":true,"discoveryExemptions":true,"metadata":true},',
            '"launch":{"blockNumber":"0","transactionHash":"',
            vm.toString(bytes32(0)),
            '"},"transactions":{"pending":"',
            vm.toString(bytes32(0)),
            '"}}'
        );
        string memory manifest = string.concat(head, tail);
        vm.writeJson(manifest, path);
    }

    function _contractsJson(
        VenueDeployment memory venue,
        ProtocolDeployment memory protocol,
        Roles memory roles
    ) private returns (string memory json) {
        json = vm.serializeAddress(
            "protocol-contracts", "uniswapV4PoolManager", address(venue.manager)
        );
        json = vm.serializeAddress("protocol-contracts", "weth", venue.weth);
        json = vm.serializeAddress("protocol-contracts", "usdc", venue.usdc);
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            json = vm.serializeAddress(
                "protocol-contracts", stock.contractManifestKey, address(venue.stocks[index])
            );
        }
        json =
            vm.serializeAddress("protocol-contracts", "testConversionVenue", address(venue.venue));
        json = vm.serializeAddress(
            "protocol-contracts", "attributeRegistry", address(protocol.attributes)
        );
        json =
            vm.serializeAddress("protocol-contracts", "recoveryAuthority", roles.recoveryAuthority);
        json = vm.serializeAddress(
            "protocol-contracts", "discoveryAdapter", address(protocol.discovery)
        );
        json = vm.serializeAddress("protocol-contracts", "fuelCore", address(protocol.fuel));
        json = vm.serializeAddress(
            "protocol-contracts", "fuelMirror", address(protocol.fuel.mirror())
        );
        json = vm.serializeAddress("protocol-contracts", "claimGate", address(protocol.claimGate));
        json = vm.serializeAddress("protocol-contracts", "rewardLedger", address(protocol.ledger));
        json = vm.serializeAddress(
            "protocol-contracts", "epochConverter", address(protocol.converter)
        );
        json = vm.serializeAddress(
            "protocol-contracts", "canonicalMarketRegistry", address(protocol.marketRegistry)
        );
        json = vm.serializeAddress(
            "protocol-contracts", "protocolLiquidityVault", address(protocol.protocolLiquidity)
        );
        json = vm.serializeAddress(
            "protocol-contracts", "canonicalHookDeployer", address(protocol.hookDeployer)
        );
        json = vm.serializeAddress("protocol-contracts", "canonicalFeeHook", address(protocol.hook));
        json =
            vm.serializeAddress("protocol-contracts", "canonicalRouter", address(protocol.router));
        json = vm.serializeAddress(
            "protocol-contracts", "genesisLiquidityVault", address(protocol.genesisLiquidity)
        );
        json = vm.serializeAddress(
            "protocol-contracts", "metadataRenderer", address(protocol.metadataRenderer)
        );
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            json = vm.serializeAddress(
                "protocol-contracts",
                string.concat(stock.poolManifestKey, "ConversionAdapter"),
                address(protocol.adapters[index])
            );
        }
    }

    /// @dev The exact inventory this deployment blocked, with the sealed-route
    ///      test venue first because the deployment always blocks it. Each
    ///      entry keeps the label from the deployment inputs, so health can
    ///      fail on a runtime mismatch and name which venue is wrong instead of
    ///      printing a bare hash.
    function _blockedVenueInventoryJson(VenueDeployment memory venue)
        private
        view
        returns (string memory)
    {
        bytes32[] memory inventory = _blockedVenueInventory();
        string[] memory labels = _blockedVenueLabels();
        require(labels.length == inventory.length, "inventory label mismatch");
        string memory json = string.concat(
            '[{"label":"orbit-sealed-route-test-venue","codehash":"',
            vm.toString(address(venue.venue).codehash),
            '"}'
        );
        for (uint256 index; index < inventory.length; ++index) {
            json = string.concat(
                json,
                ',{"label":"',
                labels[index],
                '","codehash":"',
                vm.toString(inventory[index]),
                '"}'
            );
        }
        return string.concat(json, "]");
    }

    /// @dev Every mutable module's owner is recorded separately. A single
    ///      nominal owner in the manifest hid that they are independent, so
    ///      health, diagnostics, and runbooks could not verify them.
    function _moduleOwnersJson(ProtocolDeployment memory protocol)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '{"liquidToken":"',
            vm.toString(protocol.fuel.owner()),
            '","rewardLedger":"',
            vm.toString(protocol.ledger.owner()),
            '","epochConverter":"',
            vm.toString(protocol.converter.owner()),
            '","marketRegistry":"',
            vm.toString(protocol.marketRegistry.owner()),
            '","protocolLiquidityVault":"',
            vm.toString(protocol.protocolLiquidity.owner()),
            '"}'
        );
    }

    /// @dev Ownership is two-step, so `owner()` cannot show a handover that was
    ///      offered. Whoever holds a nomination can take the module by
    ///      accepting, which makes the pending set governance state that health
    ///      has to be able to check. Zero means no nomination is outstanding.
    function _modulePendingOwnersJson(ProtocolDeployment memory protocol)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '{"liquidToken":"',
            vm.toString(protocol.fuel.pendingOwner()),
            '","rewardLedger":"',
            vm.toString(protocol.ledger.pendingOwner()),
            '","epochConverter":"',
            vm.toString(protocol.converter.pendingOwner()),
            '","marketRegistry":"',
            vm.toString(protocol.marketRegistry.pendingOwner()),
            '","protocolLiquidityVault":"',
            vm.toString(protocol.protocolLiquidity.pendingOwner()),
            '"}'
        );
    }

    function _rolesJson(Roles memory roles) private pure returns (string memory) {
        return string.concat(
            '{"owner":"',
            vm.toString(roles.owner),
            '","governanceOwner":"',
            vm.toString(roles.governanceOwner),
            '","guardian":"',
            vm.toString(roles.guardian),
            '","recoveryAuthority":"',
            vm.toString(roles.recoveryAuthority),
            '","keeper":"',
            vm.toString(roles.keeper),
            '","liquidityExecutor":"',
            vm.toString(roles.liquidityExecutor),
            '","creator":"',
            vm.toString(roles.creator),
            '"}'
        );
    }

    function _identityJson(PlaceholderMetadataRenderer renderer, ProductIdentity memory identity)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '{"key":"',
            identity.key,
            '","manifestHash":"',
            vm.toString(IDENTITY_MANIFEST_HASH),
            '","metadataRenderer":"',
            vm.toString(address(renderer)),
            '","metadataLocations":{"transient":"',
            identity.metadata.transientImage,
            '","permanent":"',
            identity.metadata.permanentImage,
            '","basketRelic":"',
            identity.metadata.basketRelicImage,
            '","indicatorRelic":"',
            identity.metadata.indicatorRelicImage,
            '"}}'
        );
    }

    function _conversionPoolsJson(VenueDeployment memory venue)
        private
        view
        returns (string memory json)
    {
        json = string.concat("{\"wethUsdc\":", _venuePoolJson(venue, venue.weth, venue.usdc));
        for (uint256 index; index < 4; ++index) {
            VenueConfig.StockConfiguration memory stock = VenueConfig.stockConfiguration(index);
            json = string.concat(
                json,
                ',"',
                stock.poolManifestKey,
                '":',
                _venuePoolJson(venue, venue.usdc, address(venue.stocks[index]))
            );
        }
        return string.concat(json, "}");
    }

    function _venuePoolJson(VenueDeployment memory venue, address tokenA, address tokenB)
        private
        view
        returns (string memory)
    {
        (PoolId poolId_, PoolKey memory key, uint160 price, uint128 liquidity) =
            venue.venue.verifiedPoolConfiguration(tokenA, tokenB);
        return _poolJson(poolId_, key, price, liquidity);
    }

    function _canonicalPoolJson(ProtocolDeployment memory protocol)
        private
        view
        returns (string memory)
    {
        PoolKey memory key = protocol.marketRegistry.poolKey();
        return _poolJson(
            protocol.marketRegistry.poolId(),
            key,
            protocol.genesisLiquidity.openingSqrtPriceX96(),
            protocol.genesisLiquidity.seededLiquidity()
        );
    }

    function _poolJson(PoolId poolId_, PoolKey memory key, uint160 price, uint128 liquidity)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '{"poolId":"',
            vm.toString(PoolId.unwrap(poolId_)),
            '","currency0":"',
            vm.toString(Currency.unwrap(key.currency0)),
            '","currency1":"',
            vm.toString(Currency.unwrap(key.currency1)),
            '","fee":',
            vm.toString(uint256(key.fee)),
            ',"tickSpacing":',
            vm.toString(int256(key.tickSpacing)),
            ',"hooks":"',
            vm.toString(address(key.hooks)),
            '","seedSqrtPriceX96":"',
            vm.toString(uint256(price)),
            '","activeLiquidity":"',
            vm.toString(uint256(liquidity)),
            '"}'
        );
    }
}
