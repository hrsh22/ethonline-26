// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    VRFCoordinatorV2_5Mock
} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

import {VrfSubscriptionBootstrap} from "../src/deployment/VrfSubscriptionBootstrap.sol";
import {QuotronDiscoveryAdapter} from "../src/discovery/QuotronDiscoveryAdapter.sol";

contract BootstrapFuelCoreStub {}

contract VrfSubscriptionBootstrapTest {
    receive() external payable {}

    function testAtomicallyCreatesFundsAndWiresTheBlockDerivedSubscription() external {
        VRFCoordinatorV2_5Mock coordinator = new VRFCoordinatorV2_5Mock(0, 0, 1 ether);
        VrfSubscriptionBootstrap bootstrap = new VrfSubscriptionBootstrap{value: 1 ether}(
            coordinator, bytes32(uint256(1)), 3, 200_000, address(this)
        );
        QuotronDiscoveryAdapter adapter = bootstrap.discovery();

        (uint96 linkBalance, uint96 nativeBalance,, address owner, address[] memory consumers) =
            coordinator.getSubscription(bootstrap.subscriptionId());
        require(linkBalance == 0, "unexpected LINK funding");
        require(nativeBalance == 1 ether, "native subscription funding missing");
        require(owner == address(bootstrap), "subscription escaped its atomic bootstrap");
        require(
            consumers.length == 1 && consumers[0] == address(adapter),
            "discovery adapter was not the sole consumer"
        );

        BootstrapFuelCoreStub fuelCore = new BootstrapFuelCoreStub();
        bootstrap.finalizeFuelCore(address(fuelCore));
        adapter.acceptOwnership();

        require(adapter.fuelCore() == address(fuelCore), "FuelCore wiring missing");
        require(adapter.owner() == address(this), "adapter ownership handoff missing");
    }
}
