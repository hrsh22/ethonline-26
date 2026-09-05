// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockUSDC} from "../src/test-assets/MockUSDC.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";

interface LocalAssetVm {
    function deal(address account, uint256 newBalance) external;
}

contract LocalSettlementAndConversionAssetsTest {
    LocalAssetVm internal constant VM =
        LocalAssetVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testProvidesDeterministicMockUsdcSupplyAndWrappedEtherLifecycle() external {
        uint256 usdcSupply = 1_000_000_000 * 1e6;
        MockUSDC usdc = new MockUSDC(usdcSupply, address(this));
        MockWETH weth = new MockWETH();

        require(keccak256(bytes(usdc.name())) == keccak256("USDC MOCK TEST"), "wrong USDC name");
        require(keccak256(bytes(usdc.symbol())) == keccak256("MOCK-USDC-TEST"), "wrong USDC symbol");
        require(usdc.decimals() == 6, "wrong USDC decimals");
        require(usdc.totalSupply() == usdcSupply, "wrong USDC supply");
        require(usdc.balanceOf(address(this)) == usdcSupply, "missing USDC fixture balance");

        VM.deal(address(this), 3 ether);
        weth.deposit{value: 2 ether}();
        require(keccak256(bytes(weth.name())) == keccak256("WETH MOCK TEST"), "wrong WETH name");
        require(keccak256(bytes(weth.symbol())) == keccak256("MOCK-WETH-TEST"), "wrong WETH symbol");
        require(weth.balanceOf(address(this)) == 2 ether, "deposit was not wrapped");
        require(weth.totalSupply() == 2 ether, "deposit did not mint");

        uint256 etherBefore = address(this).balance;
        weth.withdraw(0.5 ether);
        require(weth.balanceOf(address(this)) == 1.5 ether, "withdraw did not burn");
        require(weth.totalSupply() == 1.5 ether, "withdraw changed supply incorrectly");
        require(address(this).balance == etherBefore + 0.5 ether, "withdraw did not return ether");
    }
}
