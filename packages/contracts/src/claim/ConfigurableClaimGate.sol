// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TwoStepOwnable} from "../governance/TwoStepOwnable.sol";
import {IClaimGate} from "../interfaces/IClaimGate.sol";

/// @notice Claim adapter whose policy administrator can reproduce rejection and
///         later approval, so the denied-eligibility path is exercisable.
/// @dev This is a proof-of-concept policy, not a production credential system.
///      Production signed, expiring, revocable credentials remain separate
///      legal and security work; nothing here expires or can be revoked
///      cryptographically. The administrator is a plain owner, transferable
///      through the same two-step handover as every other module.
contract ConfigurableClaimGate is IClaimGate, TwoStepOwnable {
    mapping(address account => bool allowed) public isAllowed;

    error InvalidAccount();

    event ClaimPermissionSet(address indexed account, bool allowed);

    constructor(address policyAdministrator) TwoStepOwnable(policyAdministrator) {}

    /// @notice Approves or revokes one account. Revoking preserves accrued
    ///         rewards and liabilities; it only prevents claiming.
    function setClaimAllowed(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAccount();
        isAllowed[account] = allowed;
        emit ClaimPermissionSet(account, allowed);
    }

    function isClaimAllowed(address currentOwner) external view returns (bool) {
        return isAllowed[currentOwner];
    }
}
