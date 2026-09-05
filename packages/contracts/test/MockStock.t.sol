// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockStock} from "../src/test-assets/MockStock.sol";
import {TestERC20} from "../src/test-assets/TestERC20.sol";
import {TestMarkedERC20} from "../src/test-assets/TestMarkedERC20.sol";

contract MockStockSpender {
    function move(MockStock stock, address from, address to, uint256 amount) external {
        require(stock.transferFrom(from, to, amount), "delegated transfer failed");
    }

    function setPaused(MockStock stock, bool paused) external {
        stock.setPaused(paused);
    }

    function setRecipientRejected(MockStock stock, address recipient, bool rejected) external {
        stock.setRecipientRejected(recipient, rejected);
    }
}

contract MockStockTest {
    uint256 internal constant FIXED_SUPPLY = 1_000_000_000 ether;

    function testDeploysVisiblyValuelessFixedSupplyForOperator() external {
        MockStock stock =
            new MockStock("AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", FIXED_SUPPLY, address(this));

        require(
            keccak256(bytes(stock.name())) == keccak256("AAPLc MOCK TEST Stock"),
            "name is not visibly a mock"
        );
        require(
            keccak256(bytes(stock.symbol())) == keccak256("MOCK-AAPLc-TEST"),
            "symbol is not visibly a mock"
        );
        require(stock.decimals() == 18, "wrong decimals");
        require(stock.totalSupply() == FIXED_SUPPLY, "wrong fixed supply");
        require(stock.balanceOf(address(this)) == FIXED_SUPPLY, "operator missed supply");
        require(stock.operator() == address(this), "wrong operator");
    }

    function testRejectsProductionLookingMetadata() external {
        try new MockStock("Apple Stock", "AAPLc", FIXED_SUPPLY, address(this)) {
            revert("production-looking metadata was accepted");
        } catch (bytes memory reason) {
            require(reason.length >= 4, "missing revert selector");
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(reason, 0x20))
            }
            require(
                selector == TestMarkedERC20.InvalidTestMetadata.selector, "wrong revert selector"
            );
        }
    }

    function testSupportsStandardTransfersAndAllowancesWithoutChangingSupply() external {
        MockStock stock =
            new MockStock("AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", FIXED_SUPPLY, address(this));
        MockStockSpender spender = new MockStockSpender();
        address recipient = address(0xBEEF);

        require(stock.transfer(recipient, 25 ether), "direct transfer failed");
        require(stock.approve(address(spender), 40 ether), "approval failed");
        spender.move(stock, address(this), recipient, 40 ether);

        require(stock.balanceOf(recipient) == 65 ether, "wrong recipient balance");
        require(stock.balanceOf(address(this)) == FIXED_SUPPLY - 65 ether, "wrong sender balance");
        require(stock.allowance(address(this), address(spender)) == 0, "allowance not spent");
        require(stock.totalSupply() == FIXED_SUPPLY, "supply changed");
    }

    function testOperatorCanIsolatePauseAndRecipientFailureToOneStock() external {
        MockStock aapl =
            new MockStock("AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", FIXED_SUPPLY, address(this));
        MockStock googl = new MockStock(
            "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", FIXED_SUPPLY, address(this)
        );
        MockStockSpender outsider = new MockStockSpender();
        address rewardDestination = address(0x1ED6E2);

        (bool unauthorized,) =
            address(outsider).call(abi.encodeCall(MockStockSpender.setPaused, (aapl, true)));
        require(!unauthorized, "non-operator paused stock");

        aapl.setPaused(true);
        (bool pausedTransfer,) =
            address(aapl).call(abi.encodeCall(TestERC20.transfer, (rewardDestination, 1 ether)));
        require(!pausedTransfer, "paused stock transferred");
        require(googl.transfer(rewardDestination, 1 ether), "unpaused stock route failed");

        aapl.setPaused(false);
        aapl.setRecipientRejected(rewardDestination, true);
        (bool rejectedTransfer,) =
            address(aapl).call(abi.encodeCall(TestERC20.transfer, (rewardDestination, 1 ether)));
        require(!rejectedTransfer, "rejected recipient received stock");
        require(
            googl.transfer(rewardDestination, 1 ether), "unconfigured stock route was contaminated"
        );

        aapl.setRecipientRejected(rewardDestination, false);
        require(aapl.transfer(rewardDestination, 1 ether), "restored route stayed blocked");
    }
}
