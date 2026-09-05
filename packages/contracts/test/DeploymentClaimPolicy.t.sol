// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeploymentClaimPolicy} from "../src/deployment/DeploymentClaimPolicy.sol";
import {IClaimGate} from "../src/interfaces/IClaimGate.sol";

contract DeploymentClaimPolicyHarness {
    function deploy() external returns (address) {
        return DeploymentClaimPolicy.deploy();
    }

    function implementationCodehash() external pure returns (bytes32) {
        return DeploymentClaimPolicy.implementationCodehash();
    }
}

contract DeploymentClaimPolicyTest {
    function testDeploymentPolicyNeedsNoAdministratorOrPerWalletApproval() external {
        DeploymentClaimPolicyHarness harness = new DeploymentClaimPolicyHarness();
        address deployed = harness.deploy();
        IClaimGate gate = IClaimGate(deployed);

        require(gate.isClaimAllowed(address(0xA11CE)), "first owner was denied");
        require(gate.isClaimAllowed(address(0xB0B)), "second owner was denied");
        require(
            deployed.codehash == harness.implementationCodehash(),
            "deployment policy codehash drifted"
        );
    }
}
