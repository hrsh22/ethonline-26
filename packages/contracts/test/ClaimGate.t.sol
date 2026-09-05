// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AlwaysAllowClaimGate} from "../src/claim/AlwaysAllowClaimGate.sol";
import {ConfigurableClaimGate} from "../src/claim/ConfigurableClaimGate.sol";

contract ClaimGateOutsider {
    function setClaimAllowed(ConfigurableClaimGate gate, address account, bool allowed) external {
        gate.setClaimAllowed(account, allowed);
    }
}

contract ClaimGateTest {
    function testAlwaysAllowGateApprovesEveryCurrentOwner() external {
        AlwaysAllowClaimGate gate = new AlwaysAllowClaimGate();

        require(gate.isClaimAllowed(address(0xA11CE)), "ordinary owner was rejected");
        require(gate.isClaimAllowed(address(0xB0B)), "second owner was rejected");
    }

    function testConfigurableGateCanDenyThenApproveWithoutDelegatingItsAuthority() external {
        ConfigurableClaimGate gate = new ConfigurableClaimGate(address(this));
        ClaimGateOutsider outsider = new ClaimGateOutsider();
        address claimant = address(0xA11CE);

        require(!gate.isClaimAllowed(claimant), "claimant should start denied");
        (bool unauthorized,) = address(outsider)
            .call(abi.encodeCall(ClaimGateOutsider.setClaimAllowed, (gate, claimant, true)));
        require(!unauthorized, "non-owner configured the gate");

        gate.setClaimAllowed(claimant, true);

        require(gate.isClaimAllowed(claimant), "approved claimant stayed denied");
        require(!gate.isClaimAllowed(address(0xB0B)), "unconfigured claimant was approved");
    }
}
