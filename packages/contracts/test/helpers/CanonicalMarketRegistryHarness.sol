// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {ICanonicalMarketRegistry} from "../../src/interfaces/ICanonicalMarketRegistry.sol";

/// @notice Minimal sealed market boundary for tests outside the Canonical Market suite.
contract CanonicalMarketRegistryHarness is ICanonicalMarketRegistry {
    address public immutable override fuel;

    constructor(address fuel_) {
        fuel = fuel_;
    }

    function manager() external view returns (IPoolManager) {
        return IPoolManager(address(this));
    }

    function weth() external pure returns (address) {
        return address(1);
    }

    function router() external view returns (address) {
        return address(this);
    }

    function hook() external view returns (address) {
        return address(this);
    }

    function isSealed() external pure returns (bool) {
        return true;
    }

    function poolId() external pure returns (PoolId) {
        return PoolId.wrap(bytes32(0));
    }

    function poolKey() external pure returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(address(1));
        key.currency1 = Currency.wrap(address(2));
    }

    function isRegisteredPool(PoolKey calldata) external pure returns (bool) {
        return false;
    }

    function isAuthorizedFuelSettlement(address, address, address) external pure returns (bool) {
        return false;
    }
}
