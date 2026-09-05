// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AlwaysAllowClaimGate} from "../claim/AlwaysAllowClaimGate.sol";

/// @notice The claim policy bound by every new protocol deployment.
/// @dev RewardLedger separately proves that every claimed identity is
///      permanent and owned by the caller. This adapter therefore has no
///      administrator and introduces no second per-wallet approval step.
library DeploymentClaimPolicy {
    function deploy() internal returns (address) {
        return address(new AlwaysAllowClaimGate());
    }

    function implementationCodehash() internal pure returns (bytes32) {
        return keccak256(type(AlwaysAllowClaimGate).runtimeCode);
    }
}
