// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {BaseSepoliaInfrastructure} from "../src/deployment/BaseSepoliaInfrastructure.sol";
import {GenesisLiquidityValidation} from "../src/deployment/GenesisLiquidityValidation.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {GenesisLiquidityVault} from "../src/liquidity/GenesisLiquidityVault.sol";

/// @notice Re-verifies confirmed Genesis Liquidity state before the first market swap.
contract VerifyGenesisLiquidity is Script {
    function run() external view {
        BaseSepoliaInfrastructure.validateDeployedPoolManager();
        GenesisLiquidityVault vault =
            GenesisLiquidityVault(vm.envAddress("GENESIS_LIQUIDITY_VAULT_ADDRESS"));
        address expectedOperator = vm.envAddress("DEPLOYER_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", address(0));
        require(address(vault).code.length != 0, "Genesis Liquidity vault is not deployed");

        ICanonicalMarketRegistry registry = vault.registry();
        FuelCore liquidToken = FuelCore(address(vault.liquidToken()));
        require(address(registry).code.length != 0, "Canonical Market registry is not deployed");
        require(vault.operator() == expectedOperator, "wrong Genesis Liquidity operator");
        require(
            registry.fuel() == address(liquidToken), "vault Liquid Token does not match registry"
        );
        require(registry.weth() == vault.weth(), "vault WETH does not match registry");
        require(
            address(registry.manager()) == BaseSepoliaInfrastructure.POOL_MANAGER,
            "vault uses unofficial PoolManager"
        );
        require(vault.weth() == BaseSepoliaInfrastructure.WETH, "vault uses unofficial WETH");

        vault.validateSeededPostconditions();
        GenesisLiquidityValidation.verifyDistribution(
            liquidToken, vault, expectedOperator, treasury
        );
    }
}
