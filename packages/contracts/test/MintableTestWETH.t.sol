// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MintableTestWETH} from "../src/test-assets/MintableTestWETH.sol";

interface MintableTestWETHVm {
    function deal(address account, uint256 newBalance) external;
}

contract MintableTestWETHCaller {
    function mint(MintableTestWETH token, address recipient, uint256 amount) external {
        token.mintForTesting(recipient, amount);
    }
}

contract MintableTestWETHTest {
    MintableTestWETHVm private constant VM =
        MintableTestWETHVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testSupportsOperatorMintingAndWrappedEtherLifecycle() external {
        MintableTestWETH token =
            new MintableTestWETH("WETH MOCK TEST", "MOCK-WETH-TEST", 10 ether, address(this));
        require(token.isWrappedNativeTestAsset(), "missing wrapped-native marker");
        require(token.totalSupply() == 10 ether, "missing initial test supply");

        address recipient = address(0xBEEF);
        token.mintForTesting(recipient, 2 ether);
        require(token.balanceOf(recipient) == 2 ether, "operator mint failed");

        VM.deal(address(this), 3 ether);
        token.deposit{value: 2 ether}();
        require(token.balanceOf(address(this)) == 12 ether, "deposit did not mint");
        require(address(token).balance == 2 ether, "deposit did not retain Ether");

        uint256 etherBefore = address(this).balance;
        token.withdraw(0.5 ether);
        require(token.balanceOf(address(this)) == 11.5 ether, "withdraw did not burn");
        require(address(this).balance == etherBefore + 0.5 ether, "withdraw did not return Ether");

        MintableTestWETHCaller outsider = new MintableTestWETHCaller();
        (bool succeeded,) = address(outsider)
            .call(abi.encodeCall(MintableTestWETHCaller.mint, (token, recipient, 1 ether)));
        require(!succeeded, "outsider minted test WETH");
    }
}
