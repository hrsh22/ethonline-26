// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestERC20} from "./TestERC20.sol";

/// @notice Six-decimal, valueless USDC stand-in for deterministic local tests only.
contract MockUSDC is TestERC20 {
    constructor(uint256 initialSupply, address recipient)
        TestERC20("USDC MOCK TEST", "MOCK-USDC-TEST", 6)
    {
        _mint(recipient, initialSupply);
    }
}
