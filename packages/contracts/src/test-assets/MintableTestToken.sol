// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestMarkedERC20} from "./TestMarkedERC20.sol";

/// @notice Visibly valueless ERC-20 whose test operator can mint faucet-independent liquidity.
contract MintableTestToken is TestMarkedERC20 {
    address public immutable operator;

    error Unauthorized(address caller);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        address operator_
    ) TestMarkedERC20(name_, symbol_, decimals_) {
        operator = operator_;
        _mint(operator_, initialSupply_);
    }

    function mintForTesting(address recipient, uint256 amount) external {
        if (msg.sender != operator) revert Unauthorized(msg.sender);
        _mint(recipient, amount);
    }
}
