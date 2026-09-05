// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface ICanonicalMarketRegistry {
    function manager() external view returns (IPoolManager);

    function fuel() external view returns (address);

    function weth() external view returns (address);

    function router() external view returns (address);

    function hook() external view returns (address);

    function isSealed() external view returns (bool);

    function poolId() external view returns (PoolId);

    function poolKey() external view returns (PoolKey memory);

    function isRegisteredPool(PoolKey calldata key) external view returns (bool);

    function isAuthorizedFuelSettlement(address operator, address from, address to)
        external
        view
        returns (bool);
}
