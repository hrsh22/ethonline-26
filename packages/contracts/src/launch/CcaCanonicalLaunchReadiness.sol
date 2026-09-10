// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {ICanonicalFeeHook} from "../interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../interfaces/ICanonicalMarketRegistry.sol";
import {PermanentPositionRecipient} from "./PermanentPositionRecipient.sol";

/// @notice Proves the new auction initialized the exact canonical pool and locked an LP position.
contract CcaCanonicalLaunchReadiness {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    ICanonicalMarketRegistry public immutable registry;
    ICanonicalFeeHook public immutable hook;
    address public immutable strategy;
    PermanentPositionRecipient public immutable positionRecipient;

    error InvalidConfiguration(address configured);

    constructor(
        ICanonicalMarketRegistry registry_,
        ICanonicalFeeHook hook_,
        address strategy_,
        PermanentPositionRecipient positionRecipient_
    ) {
        if (
            address(registry_).code.length == 0 || address(hook_).code.length == 0
                || strategy_.code.length == 0 || address(positionRecipient_).code.length == 0
                || registry_.hook() != address(hook_)
        ) revert InvalidConfiguration(address(0));
        registry = registry_;
        hook = hook_;
        strategy = strategy_;
        positionRecipient = positionRecipient_;
    }

    function isReady() external view returns (bool) {
        if (!registry.isSealed() || hook.authorized() != strategy) return false;
        PoolKey memory key = registry.poolKey();
        (uint160 sqrtPriceX96,,,) = registry.manager().getSlot0(key.toId());
        return sqrtPriceX96 != 0 && positionRecipient.hasCanonicalPosition();
    }
}
