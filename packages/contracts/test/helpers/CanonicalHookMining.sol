// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {CanonicalFeeHook} from "../../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../../src/market/CanonicalMarketRegistry.sol";

abstract contract CanonicalHookMining {
    uint160 private constant ALL_PERMISSION_BITS = (1 << 14) - 1;

    function _deployMinedHook(
        CanonicalHookDeployer deployer,
        IPoolManager manager,
        CanonicalMarketRegistry registry,
        address weth,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) internal returns (CanonicalFeeHook hook) {
        bytes32 initCodeHash = deployer.hookInitCodeHash(
            manager, registry, weth, rewardDestination, liquidityDestination, creatorDestination
        );
        uint160 required = registry.REQUIRED_PERMISSION_BITS();
        for (uint256 nonce; nonce < type(uint256).max; ++nonce) {
            bytes32 salt = bytes32(nonce);
            address predicted = deployer.computeAddress(salt, initCodeHash);
            if ((uint160(predicted) & ALL_PERMISSION_BITS) == required) {
                hook = deployer.deploy(
                    salt,
                    manager,
                    registry,
                    weth,
                    rewardDestination,
                    liquidityDestination,
                    creatorDestination
                );
                require(address(hook) == predicted, "CREATE2 prediction mismatch");
                return hook;
            }
        }
        revert("permissioned salt not found");
    }
}
