// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {CcaLaunchConfiguration as Config} from "../src/deployment/CcaLaunchConfiguration.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {PlaceholderMetadataRenderer} from "../src/metadata/PlaceholderMetadataRenderer.sol";
import {CcaFreshModulesDeployment} from "./helpers/CcaFreshModulesDeployment.sol";
import {CcaLaunchDeployment} from "./helpers/CcaLaunchDeployment.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Deploys every fresh project module and composes a CCA launch from explicit inputs.
/// @dev Inputs and output paths must be inside deployments/ under the repository's Foundry policy.
/// Default forge script execution simulates; broadcasting requires the caller's explicit --broadcast.
/// This script stops before bidding. Permissionless migrate, position registration, and coordinator
/// activation occur only after auction settlement, through the separately tested launch contracts.
contract DeployCcaProtocol is CcaLaunchDeployment, CcaFreshModulesDeployment {
    using PoolIdLibrary for PoolKey;

    function run() external returns (LaunchDeployment memory deployed) {
        string memory json = vm.readFile(vm.envString("CCA_DEPLOYMENT_INPUT"));
        Config.Infrastructure memory infra = Config.Infrastructure({
            poolManager: vm.parseJsonAddress(json, ".infrastructure.poolManager"),
            positionManager: vm.parseJsonAddress(json, ".infrastructure.positionManager"),
            permit2: vm.parseJsonAddress(json, ".infrastructure.permit2"),
            ccaFactory: block.chainid == 31_337
                ? address(0)
                : vm.parseJsonAddress(json, ".infrastructure.ccaFactory"),
            liquidityLauncher: block.chainid == 31_337
                ? address(0)
                : vm.parseJsonAddress(json, ".infrastructure.liquidityLauncher"),
            lbpStrategy: block.chainid == 31_337
                ? address(0)
                : vm.parseJsonAddress(json, ".infrastructure.lbpStrategy")
        });
        Config.Roles memory roles = Config.Roles({
            deploymentOwner: vm.parseJsonAddress(json, ".roles.deploymentOwner"),
            governanceOwner: vm.parseJsonAddress(json, ".roles.governanceOwner"),
            creator: vm.parseJsonAddress(json, ".roles.creator")
        });
        Config.Economics memory economics = _economics(json);
        bytes32[] memory blocked = vm.parseJsonBytes32Array(json, ".blockedVenueCodehashes");
        if (block.chainid == 31_337) {
            require(vm.envAddress("DEPLOYER_ADDRESS") == roles.deploymentOwner, "deployer mismatch");
            vm.startBroadcast(roles.deploymentOwner);
        } else {
            uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
            require(vm.addr(privateKey) == roles.deploymentOwner, "deployer mismatch");
            vm.startBroadcast(privateKey);
        }
        Config.validateEconomics(economics);
        (Config.Modules memory modules, FreshInfrastructure memory fresh) =
            _deployFreshCcaModules(json, roles, infra);
        bytes32[] memory allBlocked = new bytes32[](blocked.length + 1);
        allBlocked[0] = address(fresh.venue).codehash;
        for (uint256 i; i < blocked.length; ++i) {
            allBlocked[i + 1] = blocked[i];
        }
        deployed = _deployCcaLaunch(modules, roles, infra, economics, allBlocked);
        if (roles.governanceOwner != roles.deploymentOwner) {
            fresh.vrfBootstrap.discovery().transferOwnership(roles.governanceOwner);
        }
        vm.stopBroadcast();
        _writeCompositionManifest(
            vm.envString("CCA_DEPLOYMENT_OUTPUT"), modules, roles, infra, economics, deployed
        );
        _writeFreshInfrastructure(vm.envString("CCA_DEPLOYMENT_OUTPUT"), fresh);
    }

    function _economics(string memory json)
        private
        pure
        returns (Config.Economics memory economics)
    {
        economics.reserveSupply = uint128(
            _boundedUint(json, ".auction.reserveSupply", type(uint128).max)
        );
        economics.minimumRaise =
            uint128(_boundedUint(json, ".auction.minimumRaise", type(uint128).max));
        economics.floorPriceQ96 = vm.parseJsonUint(json, ".auction.floorPriceQ96");
        economics.auctionTickSpacingQ96 = vm.parseJsonUint(json, ".auction.auctionTickSpacingQ96");
        economics.startBlock = uint64(_boundedUint(json, ".auction.startBlock", type(uint64).max));
        economics.endBlock = uint64(_boundedUint(json, ".auction.endBlock", type(uint64).max));
        economics.claimBlock = uint64(_boundedUint(json, ".auction.claimBlock", type(uint64).max));
        economics.migrationBlock =
            uint64(_boundedUint(json, ".auction.migrationBlock", type(uint64).max));
        economics.poolTickSpacing =
            int24(int256(_boundedUint(json, ".auction.poolTickSpacing", 32_767)));
        economics.auctionSteps = vm.parseJsonBytes(json, ".auction.auctionSteps");
        economics.distributionSalt = vm.parseJsonBytes32(json, ".auction.distributionSalt");
        economics.testnetEconomicsConfirmed =
            vm.parseJsonBool(json, ".auction.testnetEconomicsConfirmed");
    }

    function _boundedUint(string memory json, string memory field, uint256 maximum)
        private
        pure
        returns (uint256 value)
    {
        value = vm.parseJsonUint(json, field);
        require(value <= maximum, "numeric input exceeds field width");
    }

    function _writeCompositionManifest(
        string memory path,
        Config.Modules memory modules,
        Config.Roles memory roles,
        Config.Infrastructure memory infra,
        Config.Economics memory economics,
        LaunchDeployment memory deployed
    ) internal {
        string memory contractsKey = "cca-contracts";
        vm.serializeAddress(contractsKey, "liquidToken", address(modules.fuel));
        vm.serializeAddress(contractsKey, "collectible", address(modules.fuel.mirror()));
        vm.serializeAddress(
            contractsKey, "attributeRegistry", address(modules.ledger.attributeRegistry())
        );
        vm.serializeAddress(
            contractsKey, "discoveryAdapter", address(modules.fuel.discoveryAdapter())
        );
        vm.serializeAddress(
            contractsKey, "recoveryAuthority", address(modules.fuel.recoveryAuthority())
        );
        vm.serializeAddress(contractsKey, "metadataRenderer", address(modules.metadata));
        vm.serializeAddress(contractsKey, "rewardLedger", address(modules.ledger));
        vm.serializeAddress(contractsKey, "claimPolicy", address(modules.ledger.claimGate()));
        vm.serializeAddress(contractsKey, "epochConverter", address(modules.converter));
        vm.serializeAddress(
            contractsKey, "protocolLiquidityVault", address(modules.protocolLiquidity)
        );
        vm.serializeAddress(contractsKey, "marketRegistry", address(modules.registry));
        vm.serializeAddress(contractsKey, "canonicalFeeHook", address(deployed.hook));
        vm.serializeAddress(contractsKey, "canonicalHookDeployer", address(deployed.hookDeployer));
        vm.serializeAddress(contractsKey, "canonicalRouter", address(deployed.router));
        vm.serializeAddress(contractsKey, "ccaFactory", deployed.ccaFactory);
        vm.serializeAddress(contractsKey, "liquidityLauncher", deployed.liquidityLauncher);
        vm.serializeAddress(contractsKey, "lbpStrategy", deployed.lbpStrategy);
        if (address(deployed.lbpDeployer) != address(0)) {
            vm.serializeAddress(contractsKey, "ccaCreate2Deployer", address(deployed.lbpDeployer));
        }
        vm.serializeAddress(contractsKey, "ccaLaunchFunding", address(deployed.funding));
        vm.serializeAddress(contractsKey, "ccaAuction", deployed.auction);
        vm.serializeAddress(contractsKey, "ccaValidationHook", address(deployed.validationHook));
        vm.serializeAddress(contractsKey, "ccaEscrowFactory", address(deployed.escrowFactory));
        vm.serializeAddress(contractsKey, "ccaLaunchCoordinator", address(deployed.coordinator));
        vm.serializeAddress(contractsKey, "ccaReadiness", address(deployed.readiness));
        vm.serializeAddress(contractsKey, "ccaRecoverySeeder", address(deployed.recoverySeeder));
        string memory contractsJson = vm.serializeAddress(
            contractsKey, "permanentPositionRecipient", address(deployed.positionRecipient)
        );
        string memory externalKey = "cca-infrastructure";
        vm.serializeAddress(externalKey, "poolManager", infra.poolManager);
        vm.serializeAddress(externalKey, "positionManager", infra.positionManager);
        vm.serializeAddress(externalKey, "permit2", infra.permit2);
        vm.serializeAddress(externalKey, "weth", modules.registry.weth());
        vm.serializeBytes32(externalKey, "ccaFactoryCodehash", deployed.ccaFactory.codehash);
        vm.serializeBytes32(
            externalKey, "liquidityLauncherCodehash", deployed.liquidityLauncher.codehash
        );
        vm.serializeBytes32(externalKey, "lbpStrategyCodehash", deployed.lbpStrategy.codehash);
        vm.serializeBytes32(externalKey, "poolManagerCodehash", infra.poolManager.codehash);
        vm.serializeBytes32(externalKey, "positionManagerCodehash", infra.positionManager.codehash);
        string memory infraJson =
            vm.serializeBytes32(externalKey, "permit2Codehash", infra.permit2.codehash);
        string memory auctionKey = "cca-economics";
        vm.serializeString(auctionKey, "totalSupply", vm.toString(Config.TOTAL_SUPPLY));
        vm.serializeString(auctionKey, "reserveSupply", vm.toString(economics.reserveSupply));
        vm.serializeString(
            auctionKey, "auctionSupply", vm.toString(Config.TOTAL_SUPPLY - economics.reserveSupply)
        );
        vm.serializeString(auctionKey, "minimumRaise", vm.toString(economics.minimumRaise));
        vm.serializeString(auctionKey, "floorPriceQ96", vm.toString(economics.floorPriceQ96));
        vm.serializeString(
            auctionKey, "auctionTickSpacingQ96", vm.toString(economics.auctionTickSpacingQ96)
        );
        vm.serializeUint(auctionKey, "startBlock", economics.startBlock);
        vm.serializeUint(auctionKey, "endBlock", economics.endBlock);
        vm.serializeUint(auctionKey, "claimBlock", economics.claimBlock);
        vm.serializeUint(auctionKey, "migrationBlock", economics.migrationBlock);
        vm.serializeUint(auctionKey, "poolTickSpacing", uint24(economics.poolTickSpacing));
        vm.serializeBytes(auctionKey, "auctionSteps", economics.auctionSteps);
        vm.serializeBytes32(auctionKey, "distributionSalt", economics.distributionSalt);
        vm.serializeBytes32(auctionKey, "poolId", PoolId.unwrap(deployed.poolKey.toId()));
        vm.serializeAddress(auctionKey, "currency0", Currency.unwrap(deployed.poolKey.currency0));
        vm.serializeAddress(auctionKey, "currency1", Currency.unwrap(deployed.poolKey.currency1));
        vm.serializeUint(auctionKey, "poolFee", deployed.poolKey.fee);
        vm.serializeUint(auctionKey, "lpAllocationMps", 10_000_000);
        vm.serializeString(auctionKey, "liquidityPolicy", "full-range-at-final-auction-price");
        vm.serializeString(auctionKey, "unsoldAndDustPolicy", "permanent-recovery-custody");
        vm.serializeString(
            auctionKey, "recoveryLiquidityPolicy", "full-range-at-final-auction-price"
        );
        string memory auctionJson = vm.serializeBool(
            auctionKey, "testnetEconomicsConfirmed", economics.testnetEconomicsConfirmed
        );
        string memory root = "cca-deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", deployed.deploymentBlock);
        vm.serializeBytes32(root, "configurationHash", deployed.configurationHash);
        vm.serializeBytes32(
            root,
            "deploymentIdentity",
            keccak256(abi.encode(block.chainid, address(modules.fuel), deployed.auction))
        );
        vm.serializeString(root, "phase", "auction-pending");
        vm.serializeString(root, "ccaVersion", "2.1.0");
        vm.serializeString(root, "lbpStrategyVersion", "3.1.0");
        vm.serializeString(root, "ccaSourceCommit", CCA_SOURCE_COMMIT);
        vm.serializeString(root, "liquidityLauncherSourceCommit", LBP_SOURCE_COMMIT);
        vm.serializeAddress(root, "deploymentOwner", roles.deploymentOwner);
        vm.serializeAddress(root, "governanceOwner", roles.governanceOwner);
        vm.serializeAddress(root, "creator", roles.creator);
        address[] memory adapters = new address[](4);
        address[] memory stocks = new address[](4);
        for (uint256 i; i < 4; ++i) {
            adapters[i] = address(modules.adapters[i]);
            stocks[i] = modules.adapters[i].stockToken();
        }
        vm.serializeAddress(root, "conversionAdapters", adapters);
        vm.serializeAddress(root, "stockTokens", stocks);
        vm.serializeString(root, "contracts", contractsJson);
        vm.serializeString(root, "infrastructure", infraJson);
        string memory manifest = vm.serializeString(root, "auction", auctionJson);
        vm.writeJson(manifest, path);
    }
}
