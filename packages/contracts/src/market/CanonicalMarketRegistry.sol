// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {TwoStepOwnable} from "../governance/TwoStepOwnable.sol";
import {ICanonicalFeeHook} from "../interfaces/ICanonicalFeeHook.sol";

interface ICanonicalRouterConfiguration {
    function manager() external view returns (IPoolManager);

    function registry() external view returns (CanonicalMarketRegistry);

    function weth() external view returns (address);
}

/// @notice One-way registry for the single supported Liquid Token/WETH v4 market.
contract CanonicalMarketRegistry is TwoStepOwnable {
    uint160 public constant REQUIRED_PERMISSION_BITS = Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    uint160 private constant ALL_PERMISSION_BITS = (1 << 14) - 1;

    IPoolManager public immutable manager;
    address public immutable fuel;
    address public immutable weth;

    address public router;
    address public hook;
    bool public registered;
    bool public isSealed;

    PoolKey private _poolKey;
    PoolId private _poolId;

    error AlreadyRegistered();
    error InvalidConfiguration(address configured);
    error InvalidHookPermissionBits(uint160 actual, uint160 required);
    error InvalidPoolKey();
    error NotRegistered();
    error RegistrySealed();

    event PoolRegistered(PoolId indexed poolId, address indexed hook, address indexed router);
    event MarketRegistrySealed(PoolId indexed poolId);

    constructor(IPoolManager manager_, address fuel_, address weth_, address owner_)
        TwoStepOwnable(owner_)
    {
        if (
            address(manager_).code.length == 0 || fuel_.code.length == 0 || weth_.code.length == 0
                || owner_ == address(0) || fuel_ == weth_
        ) {
            revert InvalidConfiguration(address(0));
        }
        manager = manager_;
        fuel = fuel_;
        weth = weth_;
    }

    function registerPool(PoolKey calldata key, address router_) external onlyOwner {
        if (isSealed) revert RegistrySealed();
        if (registered) revert AlreadyRegistered();
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        bool pairMatches =
            (currency0 == fuel && currency1 == weth) || (currency0 == weth && currency1 == fuel);
        if (
            !pairMatches || currency0 >= currency1 || key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG
                || key.tickSpacing <= 0 || address(key.hooks).code.length == 0
                || router_.code.length == 0
        ) {
            revert InvalidPoolKey();
        }

        uint160 actualPermissionBits = uint160(address(key.hooks)) & ALL_PERMISSION_BITS;
        if (actualPermissionBits != REQUIRED_PERMISSION_BITS) {
            revert InvalidHookPermissionBits(actualPermissionBits, REQUIRED_PERMISSION_BITS);
        }

        ICanonicalFeeHook configuredHook = ICanonicalFeeHook(address(key.hooks));
        ICanonicalRouterConfiguration configuredRouter = ICanonicalRouterConfiguration(router_);
        if (
            configuredHook.manager() != address(manager)
                || configuredHook.registry() != address(this) || configuredHook.weth() != weth
                || address(configuredRouter.manager()) != address(manager)
                || address(configuredRouter.registry()) != address(this)
                || configuredRouter.weth() != weth
        ) {
            revert InvalidConfiguration(address(key.hooks));
        }

        _poolKey = key;
        _poolId = key.toId();
        hook = address(key.hooks);
        router = router_;
        registered = true;
        emit PoolRegistered(_poolId, hook, router_);
    }

    function seal() external onlyOwner {
        if (isSealed) revert RegistrySealed();
        if (!registered) revert NotRegistered();
        isSealed = true;
        emit MarketRegistrySealed(_poolId);
    }

    function poolKey() external view returns (PoolKey memory) {
        if (!registered) revert NotRegistered();
        return _poolKey;
    }

    function poolId() external view returns (PoolId) {
        if (!registered) revert NotRegistered();
        return _poolId;
    }

    function permissionBits() external view returns (uint160) {
        if (!registered) revert NotRegistered();
        return uint160(hook) & ALL_PERMISSION_BITS;
    }

    function isRegisteredPool(PoolKey calldata key) external view returns (bool) {
        return registered && PoolId.unwrap(key.toId()) == PoolId.unwrap(_poolId);
    }

    function isAuthorizedFuelSettlement(address operator, address from, address to)
        external
        view
        returns (bool)
    {
        return isSealed && ICanonicalFeeHook(hook).isAuthorizedFuelSettlement(operator, from, to);
    }
}
