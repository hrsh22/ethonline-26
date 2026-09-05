// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {BaseSepoliaInfrastructure} from "../src/deployment/BaseSepoliaInfrastructure.sol";
import {GenesisLiquidityValidation} from "../src/deployment/GenesisLiquidityValidation.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {GenesisLiquidityVault} from "../src/liquidity/GenesisLiquidityVault.sol";

/// @notice Deploys, funds, and seeds the add-only Base Sepolia Genesis Liquidity vault.
/// @dev The later composition launch freezes the exemptions configured here.
contract DeployGenesisLiquidity is Script {
    uint256 private constant SEED_DEADLINE_WINDOW = 15 minutes;

    function run() external {
        BaseSepoliaInfrastructure.validateDeployedPoolManager();
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envOr("TREASURY_ADDRESS", address(0));
        address registryAddress = vm.envAddress("CANONICAL_MARKET_REGISTRY_ADDRESS");
        require(registryAddress.code.length != 0, "Canonical Market registry is not deployed");
        ICanonicalMarketRegistry registry = ICanonicalMarketRegistry(registryAddress);
        FuelCore liquidToken = FuelCore(registry.fuel());
        _validateDeploymentInputs(registry, liquidToken, deployer);

        vm.startBroadcast(deployerPrivateKey);
        GenesisLiquidityVault vault = new GenesisLiquidityVault(registry, deployer);
        if (!liquidToken.isDiscoveryExempt(address(registry.manager()))) {
            liquidToken.setDiscoveryExempt(address(registry.manager()), true);
        }
        liquidToken.setDiscoveryExempt(address(vault), true);
        require(
            liquidToken.approve(address(vault), vault.GENESIS_SUPPLY()),
            "Genesis Liquidity approval failed"
        );
        vault.validatePreflight();
        // The deadline bounds the deployment transaction to the intended broadcast window.
        // forge-lint: disable-next-line(block-timestamp)
        vault.initializeAndSeed(block.timestamp + SEED_DEADLINE_WINDOW);
        liquidToken.setDiscoveryExempt(deployer, false);
        vm.stopBroadcast();

        vault.validateSeededPostconditions();
        GenesisLiquidityValidation.verifyDistribution(liquidToken, vault, deployer, treasury);
        _logDeployment(vault);
    }

    function _validateDeploymentInputs(
        ICanonicalMarketRegistry registry,
        FuelCore liquidToken,
        address deployer
    ) private view {
        require(address(registry).code.length != 0, "Canonical Market registry is not deployed");
        require(registry.isSealed(), "Canonical Market registry is not sealed");
        require(
            address(registry.manager()) == BaseSepoliaInfrastructure.POOL_MANAGER,
            "Canonical Market uses unofficial PoolManager"
        );
        require(
            registry.weth() == BaseSepoliaInfrastructure.WETH,
            "Canonical Market uses unofficial WETH"
        );
        require(address(liquidToken).code.length != 0, "Liquid Token is not deployed");
        require(liquidToken.owner() == deployer, "deployer is not FuelCore owner");
        require(!liquidToken.launched(), "Liquid Token already launched");
        require(
            address(liquidToken.canonicalMarketRegistry()) == address(registry),
            "FuelCore uses a different Canonical Market"
        );
        require(
            liquidToken.totalSupply() == liquidToken.MAX_LIQUID_SUPPLY(), "unexpected liquid supply"
        );
        require(
            liquidToken.balanceOf(deployer) == liquidToken.MAX_LIQUID_SUPPLY(),
            "deployer does not hold the entire genesis supply"
        );
        require(liquidToken.permanentCount() == 0, "Permanent Collectibles already exist");
        require(liquidToken.totalTransientCount() == 0, "Transient Collectibles already exist");
        require(liquidToken.totalPendingDiscoveryCount() == 0, "Pending Discovery already exists");
    }

    function _logDeployment(GenesisLiquidityVault vault) private view {
        console2.log("GENESIS_LIQUIDITY_VAULT_ADDRESS", address(vault));
        console2.log("GENESIS_OPENING_TICK", int256(vault.openingTick()));
        console2.log("GENESIS_TICK_LOWER", int256(vault.tickLower()));
        console2.log("GENESIS_TICK_UPPER", int256(vault.tickUpper()));
        console2.log("GENESIS_LIQUIDITY", uint256(vault.seededLiquidity()));
        console2.log("GENESIS_LIQUID_TOKEN_SEEDED", vault.seededLiquidTokenAmount());
        console2.log("GENESIS_ROUNDING_DUST", vault.roundingDust());
        console2.log("Run VerifyGenesisLiquidity against confirmed onchain state next.");
    }
}
