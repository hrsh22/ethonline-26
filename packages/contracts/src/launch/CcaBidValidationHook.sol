// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IValidationHook
} from "../../lib/continuous-clearing-auction/src/interfaces/IValidationHook.sol";
import {CcaBidEscrowFactory} from "./CcaBidEscrowFactory.sol";

/// @notice Restricts one CCA to bids owned by the payer's registered delivery escrow.
contract CcaBidValidationHook is IValidationHook {
    address public immutable auction;
    CcaBidEscrowFactory public immutable factory;

    error InvalidConfiguration(address account);
    error PayerMismatch(address owner, address beneficiary, address sender);
    error UnauthorizedAuction(address caller);
    error UnregisteredEscrow(address owner);

    constructor(address auction_, CcaBidEscrowFactory factory_) {
        // The auction may be a deterministic address whose code is deployed after this hook.
        if (auction_ == address(0)) revert InvalidConfiguration(auction_);
        if (address(factory_) == address(0) || address(factory_).code.length == 0) {
            revert InvalidConfiguration(address(factory_));
        }
        auction = auction_;
        factory = factory_;
    }

    /// @inheritdoc IValidationHook
    function validate(uint256, uint128, address owner, address sender, bytes calldata)
        external
        view
    {
        if (msg.sender != auction) revert UnauthorizedAuction(msg.sender);
        if (!factory.isEscrow(owner)) revert UnregisteredEscrow(owner);

        address beneficiary = factory.beneficiaryOf(owner);
        if (beneficiary != sender) revert PayerMismatch(owner, beneficiary, sender);
    }
}
