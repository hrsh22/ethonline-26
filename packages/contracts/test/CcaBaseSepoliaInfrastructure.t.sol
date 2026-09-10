// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CcaLaunchConfiguration as Config} from "../src/deployment/CcaLaunchConfiguration.sol";
import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Read-only fork evidence for the exact external contracts accepted by CCA deployment.
/// Run with BASE_SEPOLIA_RPC_URL. No transaction is broadcast by this test.
contract CcaBaseSepoliaInfrastructureTest is Test {
    using StateLibrary for IPoolManager;
    uint256 private constant VERIFICATION_BLOCK = 46_556_160;

    function test_forkOfficialAddressesCodehashesAndPositionManagerBindings() external {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, VERIFICATION_BLOCK);
        assertEq(block.chainid, 84_532);
        Config.Infrastructure memory infra = Config.Infrastructure(
            Config.BASE_POOL_MANAGER,
            Config.BASE_POSITION_MANAGER,
            Config.PERMIT2,
            Config.BASE_CCA_FACTORY,
            Config.BASE_LIQUIDITY_LAUNCHER,
            Config.BASE_LBP_STRATEGY
        );
        Config.validateInfrastructure(infra);
        assertEq(infra.poolManager.codehash, Config.BASE_POOL_MANAGER_CODEHASH);
        assertEq(infra.positionManager.codehash, Config.BASE_POSITION_MANAGER_CODEHASH);
        assertEq(infra.permit2.codehash, Config.BASE_PERMIT2_CODEHASH);
        assertEq(infra.ccaFactory.codehash, Config.BASE_CCA_FACTORY_CODEHASH);
        assertEq(infra.liquidityLauncher.codehash, Config.BASE_LIQUIDITY_LAUNCHER_CODEHASH);
        assertEq(infra.lbpStrategy.codehash, Config.BASE_LBP_STRATEGY_CODEHASH);
        // ORBIT's pinned StateLibrary can read the deployed PoolManager's storage through its ABI.
        (uint160 sqrtPrice,,,) = IPoolManager(infra.poolManager)
            .getSlot0(PoolId.wrap(keccak256("uninitialized cca deployment probe")));
        assertEq(sqrtPrice, 0);
    }
}
