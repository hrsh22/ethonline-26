// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployCcaProtocol} from "../script/DeployCcaProtocol.s.sol";
import {CcaLaunchDeployment} from "../script/helpers/CcaLaunchDeployment.sol";
import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {FuelCore} from "../src/FuelCore.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {ConfigurableClaimGate} from "../src/claim/ConfigurableClaimGate.sol";
import {DeterministicConversionAdapter} from "../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {CcaLaunchConfiguration as Config} from "../src/deployment/CcaLaunchConfiguration.sol";
import {DevelopmentRecoveryAuthority} from "../src/deployment/DevelopmentRecoveryAuthority.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {CcaBidEscrow} from "../src/launch/CcaBidEscrow.sol";
import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {
    IAttributeMetadataRegistry,
    PlaceholderMetadataRenderer
} from "../src/metadata/PlaceholderMetadataRenderer.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {CcaFreshLifecycleFixture} from "./helpers/CcaFreshLifecycleFixture.sol";
import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {Test} from "forge-std/Test.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {LBPStrategy} from "liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract CcaDeploymentScriptHarness is DeployCcaProtocol {
    function execute(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        string memory output
    ) external returns (LaunchDeployment memory deployed) {
        vm.startBroadcast(roles.deploymentOwner);
        deployed = _deployCcaLaunch(modules, roles, infra, economics, new bytes32[](0));
        vm.stopBroadcast();
        _writeCompositionManifest(output, modules, roles, infra, economics, deployed);
    }

    function stageWithoutSupplyApproval(
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics
    ) external returns (LaunchDeployment memory deployed, bytes memory distributionConfig) {
        vm.startBroadcast(roles.deploymentOwner);
        (deployed, distributionConfig) =
            _prepareCcaLaunch(modules, roles, infra, economics, new bytes32[](0));
        deployed.funding
            .configure(
                deployed.recoverySeeder,
                deployed.coordinator,
                deployed.auction,
                keccak256(distributionConfig),
                economics.distributionSalt,
                economics.startBlock
            );
        modules.fuel.transferOwnership(address(deployed.funding));
        vm.stopBroadcast();
    }

    function validate(Config.Infrastructure memory infra, Config.Economics memory economics)
        external
        view
    {
        Config.validateInfrastructure(infra);
        Config.validateEconomics(economics);
    }
}

contract CcaLaunchDeploymentTest is Test {
    uint256 private constant Q96 = 1 << 96;
    string private constant OUTPUT = "../../deployments/cca-composition-test.json";
    address private owner = makeAddr("CCA deployment owner");
    address private governance = makeAddr("CCA governance");
    address private bidder = makeAddr("CCA composition bidder");
    MockWETH private weth;
    Config.Modules private modules;
    Config.Infrastructure private infra;
    Config.Roles private roles;
    Config.Economics private economics;
    CcaDeploymentScriptHarness private script;

    function setUp() external {
        vm.chainId(31_337);
        vm.deal(owner, 100 ether);
        weth = new MockWETH();
        CcaFreshLifecycleFixture local = new CcaFreshLifecycleFixture();
        local.deployInfrastructure(address(weth));
        infra = Config.Infrastructure(
            local.poolManager(),
            local.positionManager(),
            Config.PERMIT2,
            address(0),
            address(0),
            address(0)
        );
        roles = Config.Roles(owner, governance, makeAddr("CCA creator"));
        economics = Config.Economics({
            reserveSupply: 444 ether,
            minimumRaise: 1 ether,
            floorPriceQ96: Q96 / 8,
            auctionTickSpacingQ96: Q96 / 128,
            startBlock: uint64(block.number + 200),
            endBlock: uint64(block.number + 210),
            claimBlock: uint64(block.number + 211),
            migrationBlock: uint64(block.number + 211),
            poolTickSpacing: 60,
            auctionSteps: abi.encodePacked(uint24(1_000_000), uint40(10)),
            distributionSalt: keccak256("deployment composition"),
            testnetEconomicsConfirmed: true
        });
        _freshModules();
        script = new CcaDeploymentScriptHarness();
    }

    function _freshModules() private {
        bytes memory canonical = vm.readFileBinary("../config/collection/manifest.bin");
        vm.startPrank(owner);
        AttributeRegistry attributes = new AttributeRegistry(keccak256(canonical));
        AttributeRegistry.AttributeInput[] memory inputs =
            new AttributeRegistry.AttributeInput[](canonical.length / 7);
        for (uint256 i; i < inputs.length; ++i) {
            uint256 at = i * 7;
            inputs[i] = AttributeRegistry.AttributeInput({
                identityId: uint16(uint8(canonical[at])) << 8 | uint16(uint8(canonical[at + 1])),
                track: AttributeRegistry.RewardTrack(uint8(canonical[at + 2])),
                tier: AttributeRegistry.RarityTier(uint8(canonical[at + 3])),
                weight: uint16(uint8(canonical[at + 4])) << 8 | uint16(uint8(canonical[at + 5])),
                collectibleKind: AttributeRegistry.CollectibleKind(uint8(canonical[at + 6]))
            });
        }
        attributes.loadBatch(inputs);
        attributes.seal();
        modules.fuel = new FuelCore(
            "Fresh composition FUEL",
            "FUEL",
            "Fresh Crafts",
            "CRAFT",
            owner,
            new DeterministicDiscoveryAdapter(bytes32(uint256(7))),
            owner,
            new DevelopmentRecoveryAuthority(owner, 2)
        );
        modules.registry = new CanonicalMarketRegistry(
            IPoolManager(infra.poolManager), address(modules.fuel), address(weth), owner
        );
        address[4] memory stocks;
        for (uint256 i; i < 4; ++i) {
            stocks[i] = address(
                new MockStock("Fresh MOCK TEST Stock", "MOCK-FRESH-TEST", 1_000_000 ether, owner)
            );
        }
        modules.ledger = new RewardLedger(
            address(modules.fuel), attributes, stocks, new ConfigurableClaimGate(owner), owner
        );
        modules.converter = new EpochConverter(address(weth), address(modules.ledger), owner, owner);
        modules.protocolLiquidity = new ProtocolLiquidityVault(
            ICanonicalMarketRegistry(address(modules.registry)), owner, owner
        );
        modules.metadata = new PlaceholderMetadataRenderer(
            IAttributeMetadataRegistry(address(attributes)),
            PlaceholderMetadataRenderer.IdentityConfiguration({
                transientCollectible: "Craft",
                permanentCollectible: "Launched Craft",
                basketRelic: "Basket Relic",
                indicatorRelic: "Indicator Relic",
                metadataDescription: "Fresh testnet composition",
                transientImage: "ipfs://fresh/transient",
                permanentImage: "ipfs://fresh/permanent",
                basketRelicImage: "ipfs://fresh/basket",
                indicatorRelicImage: "ipfs://fresh/indicator"
            })
        );
        for (uint256 i; i < 4; ++i) {
            modules.adapters[i] = new DeterministicConversionAdapter(
                AttributeRegistry.RewardTrack(i + 1),
                address(modules.converter),
                address(weth),
                stocks[i],
                address(modules.ledger)
            );
        }
        vm.stopPrank();
    }

    function test_scriptCompositionFundsFreshModulesAndWritesCompleteManifest() external {
        CcaLaunchDeployment.LaunchDeployment memory deployed =
            script.execute(modules, roles, infra, economics, OUTPUT);
        assertEq(modules.fuel.owner(), address(deployed.coordinator));
        assertEq(modules.fuel.balanceOf(owner), 0);
        assertFalse(modules.fuel.isDiscoveryExempt(owner));
        assertEq(modules.fuel.balanceOf(deployed.auction), 4_000 ether);
        assertEq(modules.fuel.balanceOf(deployed.lbpStrategy), 444 ether);
        assertEq(modules.fuel.allowance(owner, Config.PERMIT2), 0);
        assertEq(modules.fuel.allowance(deployed.liquidityLauncher, deployed.lbpStrategy), 0);
        assertTrue(modules.converter.configurationSealed());
        assertTrue(modules.protocolLiquidity.configurationSealed());
        assertEq(modules.ledger.pendingOwner(), governance);
        string memory manifest = vm.readFile(OUTPUT);
        assertEq(vm.parseJsonAddress(manifest, ".contracts.ccaAuction"), deployed.auction);
        assertEq(vm.parseJsonAddress(manifest, ".contracts.rewardLedger"), address(modules.ledger));
        assertEq(
            vm.parseJsonAddress(manifest, ".infrastructure.positionManager"), infra.positionManager
        );
        assertEq(vm.parseJsonUint(manifest, ".auction.reserveSupply"), economics.reserveSupply);
        assertEq(vm.parseJsonBytes32(manifest, ".configurationHash"), deployed.configurationHash);
        assertEq(vm.parseJsonString(manifest, ".ccaVersion"), "2.1.0");
        _completeAuction(deployed);
        vm.removeFile(OUTPUT);
    }

    function _completeAuction(CcaLaunchDeployment.LaunchDeployment memory deployed) private {
        CcaBidEscrow escrow = CcaBidEscrow(deployed.escrowFactory.deployEscrow(bidder));
        vm.deal(bidder, 100 ether);
        vm.startPrank(bidder);
        weth.deposit{value: 100 ether}();
        weth.approve(Config.PERMIT2, 100 ether);
        IAllowanceTransfer(Config.PERMIT2)
            .approve(address(weth), deployed.auction, 100 ether, type(uint48).max);
        vm.roll(economics.startBlock);
        ContinuousClearingAuction auction = ContinuousClearingAuction(payable(deployed.auction));
        uint256 bid = auction.submitBid(Q96, 100 ether, address(escrow), bytes(""));
        vm.stopPrank();
        vm.roll(economics.migrationBlock);
        auction.exitBid(bid);
        auction.claimTokens(bid);
        LBPStrategy(payable(deployed.lbpStrategy)).migrate(ILBPInitializer(deployed.auction));
        deployed.positionRecipient.registerPosition(1);
        deployed.coordinator.activate();
        assertTrue(modules.fuel.launched());
        assertEq(modules.fuel.pendingOwner(), governance);
        assertEq(escrow.withdrawFuel(), 64 ether);
        assertEq(modules.fuel.transientCount(bidder), 64);
    }

    function test_finalFundingFailureRollsOwnershipAndAuctionCreationBackThenRetries() external {
        (CcaLaunchDeployment.LaunchDeployment memory deployed, bytes memory distributionConfig) =
            script.stageWithoutSupplyApproval(modules, roles, infra, economics);
        vm.prank(owner);
        vm.expectRevert();
        deployed.funding.fund(distributionConfig);
        assertFalse(deployed.funding.funded());
        if (block.chainid == 31_337) assertEq(modules.fuel.owner(), owner);
        assertEq(modules.fuel.pendingOwner(), address(deployed.funding));
        assertEq(modules.fuel.balanceOf(owner), 4_444 ether);
        assertEq(deployed.auction.code.length, 0);
        assertEq(address(deployed.recoverySeeder.auction()), address(0));
        vm.startPrank(owner);
        modules.fuel.approve(address(deployed.funding), 4_444 ether);
        deployed.funding.fund(distributionConfig);
        vm.stopPrank();
        assertTrue(deployed.funding.funded());
        assertEq(modules.fuel.owner(), address(deployed.coordinator));
        assertEq(modules.fuel.balanceOf(deployed.auction), 4_000 ether);
        assertEq(modules.fuel.allowance(owner, address(deployed.funding)), 0);
        assertEq(modules.fuel.allowance(address(deployed.funding), Config.PERMIT2), 0);
        assertEq(address(deployed.recoverySeeder.auction()), deployed.auction);
    }

    function test_forkStandaloneUsesOfficialLaunchInfrastructure() external {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, 46_556_160);
        vm.deal(owner, 100 ether);
        infra = Config.Infrastructure(
            Config.BASE_POOL_MANAGER,
            Config.BASE_POSITION_MANAGER,
            Config.PERMIT2,
            Config.BASE_CCA_FACTORY,
            Config.BASE_LIQUIDITY_LAUNCHER,
            Config.BASE_LBP_STRATEGY
        );
        economics.startBlock = uint64(block.number + 500);
        economics.endBlock = uint64(block.number + 510);
        economics.claimBlock = uint64(block.number + 511);
        economics.migrationBlock = uint64(block.number + 511);
        script = new CcaDeploymentScriptHarness();
        string memory previousKey = vm.envOr("DEPLOYER_PRIVATE_KEY", string(""));
        vm.setEnv(
            "DEPLOYER_PRIVATE_KEY", vm.toString(uint256(keccak256(bytes("CCA deployment owner"))))
        );
        test_standaloneScriptParsesExplicitInputAndWritesManifest();
        vm.setEnv("DEPLOYER_PRIVATE_KEY", previousKey);
    }

    function test_standaloneScriptParsesExplicitInputAndWritesManifest() public {
        string memory standaloneOutput = block.chainid == 31_337
            ? "../../deployments/cca-standalone-test.json"
            : "../../deployments/cca-fork-standalone-test.json";
        string memory inputPath = block.chainid == 31_337
            ? "../../deployments/cca-composition-input-test.json"
            : "../../deployments/cca-fork-composition-input-test.json";
        vm.writeJson(_inputJson(), inputPath);
        string memory previousInput = vm.envOr("CCA_DEPLOYMENT_INPUT", string(""));
        string memory previousOutput = vm.envOr("CCA_DEPLOYMENT_OUTPUT", string(""));
        string memory previousOwner = vm.envOr("DEPLOYER_ADDRESS", string(""));
        vm.setEnv("CCA_DEPLOYMENT_INPUT", inputPath);
        vm.setEnv("CCA_DEPLOYMENT_OUTPUT", standaloneOutput);
        vm.setEnv("DEPLOYER_ADDRESS", vm.toString(owner));
        CcaLaunchDeployment.LaunchDeployment memory deployed = script.run();
        assertTrue(deployed.funding.funded());
        if (block.chainid == 84_532) {
            assertEq(deployed.ccaFactory, Config.BASE_CCA_FACTORY);
            assertEq(deployed.liquidityLauncher, Config.BASE_LIQUIDITY_LAUNCHER);
            assertEq(deployed.lbpStrategy, Config.BASE_LBP_STRATEGY);
            assertEq(address(deployed.lbpDeployer), address(0));
        }
        string memory written = vm.readFile(standaloneOutput);
        FuelCore freshFuel = FuelCore(vm.parseJsonAddress(written, ".contracts.liquidToken"));
        assertTrue(address(freshFuel) != address(modules.fuel));
        assertEq(freshFuel.owner(), address(deployed.coordinator));
        assertFalse(freshFuel.launched());
        assertEq(freshFuel.totalSupply(), 4_444 ether);
        if (block.chainid == 31_337) assertEq(modules.fuel.owner(), owner);
        assertTrue(
            vm.parseJsonAddress(written, ".freshInfrastructure.vrfBootstrap").code.length > 0
        );
        assertTrue(
            vm.parseJsonAddress(written, ".freshInfrastructure.testConversionVenue").code.length > 0
        );
        assertEq(
            vm.parseJsonAddress(written, ".contracts.ccaLaunchFunding"), address(deployed.funding)
        );
        assertEq(
            vm.parseJsonString(written, ".auction.floorPriceQ96"),
            vm.toString(economics.floorPriceQ96)
        );
        vm.setEnv("CCA_DEPLOYMENT_INPUT", previousInput);
        vm.setEnv("CCA_DEPLOYMENT_OUTPUT", previousOutput);
        vm.setEnv("DEPLOYER_ADDRESS", previousOwner);
        vm.removeFile(inputPath);
        vm.removeFile(standaloneOutput);
    }

    function _inputJson() private returns (string memory) {
        string memory infraInput = "input-infrastructure";
        vm.serializeAddress(infraInput, "poolManager", infra.poolManager);
        vm.serializeAddress(infraInput, "positionManager", infra.positionManager);
        vm.serializeAddress(infraInput, "permit2", infra.permit2);
        vm.serializeAddress(infraInput, "ccaFactory", infra.ccaFactory);
        vm.serializeAddress(infraInput, "liquidityLauncher", infra.liquidityLauncher);
        string memory infraJson = vm.serializeAddress(infraInput, "lbpStrategy", infra.lbpStrategy);
        string memory r = "input-roles";
        vm.serializeAddress(r, "deploymentOwner", roles.deploymentOwner);
        vm.serializeAddress(r, "governanceOwner", roles.governanceOwner);
        vm.serializeAddress(r, "creator", roles.creator);
        vm.serializeAddress(r, "guardian", owner);
        vm.serializeAddress(r, "keeper", owner);
        vm.serializeAddress(r, "liquidityExecutor", owner);
        string memory roleJson = vm.serializeAddress(r, "recoveryCosigner", bidder);
        string memory identityKey = "input-identity";
        vm.serializeString(identityKey, "liquidTokenName", "FUEL MOCK TEST");
        vm.serializeString(identityKey, "liquidTokenSymbol", "FUEL-TEST");
        vm.serializeString(identityKey, "collectibleTokenName", "Quotrons MOCK TEST");
        vm.serializeString(identityKey, "collectibleTokenSymbol", "QUOTRON-TEST");
        vm.serializeString(identityKey, "transientCollectible", "Transient Quotron");
        vm.serializeString(identityKey, "permanentCollectible", "Permanent Quotron");
        vm.serializeString(identityKey, "basketRelic", "Basket Relic");
        vm.serializeString(identityKey, "indicatorRelic", "Indicator Relic");
        vm.serializeString(identityKey, "metadataDescription", "Valueless deployment test");
        vm.serializeString(identityKey, "transientImage", "ipfs://transient");
        vm.serializeString(identityKey, "permanentImage", "ipfs://permanent");
        vm.serializeString(identityKey, "basketRelicImage", "ipfs://basket");
        string memory identityJson =
            vm.serializeString(identityKey, "indicatorRelicImage", "ipfs://indicator");
        string memory discoveryJson =
            vm.serializeString("input-discovery", "nativeFundingWei", "1000000000000000000");
        string memory a = "input-auction";
        vm.serializeString(a, "reserveSupply", vm.toString(economics.reserveSupply));
        vm.serializeString(a, "minimumRaise", vm.toString(economics.minimumRaise));
        vm.serializeString(a, "floorPriceQ96", vm.toString(economics.floorPriceQ96));
        vm.serializeString(a, "auctionTickSpacingQ96", vm.toString(economics.auctionTickSpacingQ96));
        vm.serializeUint(a, "startBlock", economics.startBlock);
        vm.serializeUint(a, "endBlock", economics.endBlock);
        vm.serializeUint(a, "claimBlock", economics.claimBlock);
        vm.serializeUint(a, "migrationBlock", economics.migrationBlock);
        vm.serializeUint(a, "poolTickSpacing", uint24(economics.poolTickSpacing));
        vm.serializeBytes(a, "auctionSteps", economics.auctionSteps);
        vm.serializeBytes32(a, "distributionSalt", economics.distributionSalt);
        string memory auctionJson = vm.serializeBool(a, "testnetEconomicsConfirmed", true);
        string memory root = "input-root";
        vm.serializeString(root, "identity", identityJson);
        vm.serializeString(root, "discovery", discoveryJson);
        vm.serializeString(root, "infrastructure", infraJson);
        vm.serializeString(root, "roles", roleJson);
        vm.serializeString(root, "auction", auctionJson);
        return vm.serializeBytes32(root, "blockedVenueCodehashes", new bytes32[](0));
    }

    function test_configurationRejectsNonfreshSupplyBeforeDeployingLaunchContracts() external {
        vm.startPrank(owner);
        modules.fuel.setDiscoveryExempt(bidder, true);
        modules.fuel.transfer(bidder, 1 ether);
        vm.stopPrank();
        vm.expectPartialRevert(Config.InvalidModules.selector);
        script.execute(modules, roles, infra, economics, OUTPUT);
    }

    function test_configurationRejectsMalformedAuctionSchedule() external {
        economics.auctionSteps = abi.encodePacked(uint24(1), uint40(10));
        vm.expectRevert(Config.InvalidEconomics.selector);
        script.validate(infra, economics);
    }

    function test_configurationRejectsAmbiguousClaimAndMigrationOrdering() external {
        economics.claimBlock = economics.endBlock;
        vm.expectRevert(Config.InvalidEconomics.selector);
        script.validate(infra, economics);

        economics.claimBlock = economics.endBlock + 1;
        economics.migrationBlock = economics.claimBlock + 1;
        vm.expectRevert(Config.InvalidEconomics.selector);
        script.validate(infra, economics);
    }

    function test_baseSepoliaRequiresExplicitEconomics() external {
        vm.chainId(84_532);
        economics.testnetEconomicsConfirmed = false;
        ConfigEconomicsHarness harness = new ConfigEconomicsHarness();
        vm.expectRevert(Config.ExplicitTestnetEconomicsRequired.selector);
        harness.validate(economics);
    }
}

contract ConfigEconomicsHarness {
    function validate(Config.Economics memory economics) external view {
        Config.validateEconomics(economics);
    }
}
