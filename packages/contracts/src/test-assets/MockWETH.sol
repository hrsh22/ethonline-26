// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestERC20} from "./TestERC20.sol";

/// @notice Wrapped native asset stand-in for deterministic local tests only.
contract MockWETH is TestERC20 {
    error EtherTransferFailed();

    constructor() TestERC20("WETH MOCK TEST", "MOCK-WETH-TEST", 18) {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert EtherTransferFailed();
    }
}
