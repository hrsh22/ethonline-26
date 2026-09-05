// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MintableTestToken} from "./MintableTestToken.sol";

/// @notice Visibly valueless, operator-mintable wrapped Ether for Base Sepolia testing.
/// @dev Operator minting keeps the self-funded venue independent of faucets. Only tokens minted
///      through `deposit` are Ether-backed, so this contract must never be treated as production
///      WETH or as carrying value.
contract MintableTestWETH is MintableTestToken {
    error EtherTransferFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address operator_
    ) MintableTestToken(name_, symbol_, 18, initialSupply_, operator_) {}

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

    function isWrappedNativeTestAsset() external pure returns (bool) {
        return true;
    }
}
