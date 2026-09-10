// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CcaUpstreamFixture} from "./helpers/CcaUpstreamFixture.sol";
import {Test} from "forge-std/Test.sol";

contract CcaUpstreamTokenMock {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 approved = allowance[owner][msg.sender];
        if (approved != type(uint256).max) allowance[owner][msg.sender] = approved - amount;
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract CcaUpstreamSmokeTest is Test {
    uint128 private constant TOTAL_SUPPLY = 1_000 ether;

    function test_realUpstreamLbpCreatesAndFundsCcaAuction() external {
        CcaUpstreamFixture fixture = new CcaUpstreamFixture();
        CcaUpstreamTokenMock token = new CcaUpstreamTokenMock();
        token.mint(address(fixture), TOTAL_SUPPLY);

        CcaUpstreamFixture.Deployment memory deployment =
            fixture.deployAuction(address(token), TOTAL_SUPPLY);

        assertTrue(deployment.factory.code.length > 0);
        assertTrue(deployment.strategy.code.length > 0);
        assertTrue(deployment.auction.code.length > 0);
        assertEq(token.balanceOf(deployment.auction), deployment.auctionSupply);
        assertEq(token.balanceOf(deployment.strategy), deployment.reserveSupply);
        assertEq(deployment.auctionSupply + deployment.reserveSupply, TOTAL_SUPPLY);

        (
            address auctionToken,
            uint128 auctionSupply,
            address tokensRecipient,
            address fundsRecipient,
            uint64 startBlock,
            uint64 endBlock,
            uint64 claimBlock
        ) = fixture.auctionState(deployment.auction);
        assertEq(auctionToken, address(token));
        assertEq(auctionSupply, deployment.auctionSupply);
        assertEq(tokensRecipient, address(fixture));
        assertEq(fundsRecipient, deployment.strategy);
        assertEq(endBlock, startBlock + 10);
        assertEq(claimBlock, endBlock + 1);

        (
            address initializerFactory,
            address poolManager,
            address positionManager,
            uint64 migrationBlock,
            uint128 reserveSupply,
            address migrationToken
        ) = fixture.strategyState(deployment.strategy, deployment.auction);
        assertEq(initializerFactory, deployment.factory);
        assertEq(poolManager, deployment.poolManager);
        assertEq(positionManager, address(0xBEEF));
        assertEq(migrationBlock, endBlock + 1);
        assertEq(reserveSupply, deployment.reserveSupply);
        assertEq(migrationToken, address(token));
    }
}
