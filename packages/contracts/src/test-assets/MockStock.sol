// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestMarkedERC20} from "./TestMarkedERC20.sol";

/// @notice Fixed-supply, valueless stock stand-in for conversion tests only.
contract MockStock is TestMarkedERC20 {
    address public immutable operator;
    bool public isPaused;

    mapping(address recipient => bool rejected) public isRecipientRejected;

    error Paused();
    error RecipientRejected(address recipient);
    error Unauthorized(address caller);

    event PauseConfigured(bool paused);
    event RecipientRejectionConfigured(address indexed recipient, bool rejected);

    constructor(string memory name_, string memory symbol_, uint256 fixedSupply, address operator_)
        TestMarkedERC20(name_, symbol_, 18)
    {
        operator = operator_;
        _mint(operator_, fixedSupply);
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized(msg.sender);
        _;
    }

    function setPaused(bool paused) external onlyOperator {
        isPaused = paused;
        emit PauseConfigured(paused);
    }

    function setRecipientRejected(address recipient, bool rejected) external onlyOperator {
        isRecipientRejected[recipient] = rejected;
        emit RecipientRejectionConfigured(recipient, rejected);
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (isPaused) revert Paused();
        if (isRecipientRejected[to]) revert RecipientRejected(to);
        super._transfer(from, to, amount);
    }
}
