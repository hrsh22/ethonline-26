// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolManager} from "../lib/liquidity-launcher/lib/v4-core/src/PoolManager.sol";
import {IPoolManager} from "../lib/liquidity-launcher/lib/v4-core/src/interfaces/IPoolManager.sol";
import {PositionManager} from "../lib/liquidity-launcher/lib/v4-periphery/src/PositionManager.sol";
import {
    IPositionDescriptor
} from "../lib/liquidity-launcher/lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {
    IWETH9
} from "../lib/liquidity-launcher/lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Local equivalents for the external infrastructure used by the Base Sepolia CCA path.
/// @dev The local wrapper installs the pinned Permit2 runtime at its canonical address first.
contract DeployLocalCcaInfrastructure is Script {
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        require(block.chainid == 31_337, "local infrastructure only");
        require(PERMIT2.code.length != 0, "local Permit2 runtime missing");
        address owner = vm.envAddress("DEPLOYER_ADDRESS");
        vm.startBroadcast(owner);
        PoolManager manager = new PoolManager(owner);
        MockWETH positionManagerWrappedNative = new MockWETH();
        PositionManager positions = new PositionManager(
            IPoolManager(address(manager)),
            IAllowanceTransfer(PERMIT2),
            0,
            IPositionDescriptor(address(0)),
            IWETH9(address(positionManagerWrappedNative))
        );
        vm.stopBroadcast();
        string memory key = "local-cca-infrastructure";
        vm.serializeAddress(key, "poolManager", address(manager));
        vm.serializeAddress(key, "positionManager", address(positions));
        string memory json = vm.serializeAddress(key, "permit2", PERMIT2);
        vm.writeJson(json, vm.envString("CCA_LOCAL_INFRA_OUTPUT"));
    }
}
