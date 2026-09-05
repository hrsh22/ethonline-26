// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MintableTestToken} from "../src/test-assets/MintableTestToken.sol";
import {TestMarkedERC20} from "../src/test-assets/TestMarkedERC20.sol";

contract MintableTestTokenCaller {
    function mint(MintableTestToken token, address recipient, uint256 amount) external {
        token.mintForTesting(recipient, amount);
    }
}

contract MintableTestTokenTest {
    function testDeploysWithExplicitTestMetadataDecimalsAndOperatorSupply() external {
        MintableTestToken token = new MintableTestToken(
            "USDC MOCK TEST Self-Funded", "MOCK-USDC-TEST", 6, 1_000_000_000 * 1e6, address(this)
        );

        require(token.decimals() == 6, "wrong decimals");
        require(token.operator() == address(this), "wrong operator");
        require(token.totalSupply() == 1_000_000_000 * 1e6, "wrong initial supply");
        require(token.balanceOf(address(this)) == token.totalSupply(), "operator missed supply");
    }

    function testOperatorCanMintAndUnauthorizedCallerCannot() external {
        MintableTestToken token = new MintableTestToken(
            "WETH MOCK TEST Self-Funded", "MOCK-WETH-TEST", 18, 1_000 ether, address(this)
        );
        MintableTestTokenCaller outsider = new MintableTestTokenCaller();
        address recipient = address(0xBEEF);

        token.mintForTesting(recipient, 25 ether);
        require(token.balanceOf(recipient) == 25 ether, "operator mint failed");
        (bool succeeded,) = address(outsider)
            .call(abi.encodeCall(MintableTestTokenCaller.mint, (token, recipient, 1 ether)));
        require(!succeeded, "unauthorized mint succeeded");
    }

    function testRejectsProductionLookingMetadata() external {
        try new MintableTestToken("USD Coin", "USDC", 6, 1_000_000 * 1e6, address(this)) {
            revert("production-looking metadata was accepted");
        } catch (bytes memory reason) {
            require(reason.length >= 4, "missing revert selector");
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
            require(selector == TestMarkedERC20.InvalidTestMetadata.selector, "wrong selector");
        }
    }
}
