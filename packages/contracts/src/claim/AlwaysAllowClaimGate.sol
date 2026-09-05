// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IClaimGate} from "../interfaces/IClaimGate.sol";

/// @notice Base Sepolia claim adapter that approves every current owner.
contract AlwaysAllowClaimGate is IClaimGate {
    function isClaimAllowed(address) external pure returns (bool) {
        return true;
    }
}
