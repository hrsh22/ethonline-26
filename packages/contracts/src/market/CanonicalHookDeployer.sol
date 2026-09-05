// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {CanonicalFeeHook} from "./CanonicalFeeHook.sol";
import {CanonicalMarketRegistry} from "./CanonicalMarketRegistry.sol";

/// @notice CREATE2 deployment boundary for a hook address mined to the required permission bits.
contract CanonicalHookDeployer {
    uint160 private constant ALL_PERMISSION_BITS = (1 << 14) - 1;

    error HookAddressNotPermissioned(address predicted, uint160 actual, uint160 required);

    event HookDeployed(address indexed hook, bytes32 indexed salt);

    function deploy(
        bytes32 salt,
        IPoolManager manager,
        CanonicalMarketRegistry registry,
        address weth,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) external returns (CanonicalFeeHook hook) {
        address predicted = computeAddress(
            salt,
            manager,
            registry,
            weth,
            rewardDestination,
            liquidityDestination,
            creatorDestination
        );
        uint160 required = registry.REQUIRED_PERMISSION_BITS();
        uint160 actual = uint160(predicted) & ALL_PERMISSION_BITS;
        if (actual != required) {
            revert HookAddressNotPermissioned(predicted, actual, required);
        }
        hook = new CanonicalFeeHook{salt: salt}(
            manager, registry, weth, rewardDestination, liquidityDestination, creatorDestination
        );
        emit HookDeployed(address(hook), salt);
    }

    function computeAddress(
        bytes32 salt,
        IPoolManager manager,
        CanonicalMarketRegistry registry,
        address weth,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) public view returns (address) {
        return computeAddress(
            salt,
            hookInitCodeHash(
                manager, registry, weth, rewardDestination, liquidityDestination, creatorDestination
            )
        );
    }

    function hookInitCodeHash(
        IPoolManager manager,
        CanonicalMarketRegistry registry,
        address weth,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(CanonicalFeeHook).creationCode,
                abi.encode(
                    manager,
                    registry,
                    weth,
                    rewardDestination,
                    liquidityDestination,
                    creatorDestination
                )
            )
        );
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) public view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
