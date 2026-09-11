// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {
    AuctionParameters
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {Test} from "forge-std/Test.sol";

contract CcaTestnetDefaultsToken {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }
}

contract CcaTestnetDefaultsTest is Test {
    uint128 private constant AUCTION_SUPPLY = 4_000 ether;
    uint128 private constant MINIMUM_RAISE = 10 ether;
    uint128 private constant GRADUATION_SAFETY_MARGIN = 1 wei;
    uint256 private constant FLOOR_PRICE_Q96 = 396140812571321687967719750;
    uint256 private constant PRICE_TICK_SPACING_Q96 = 79228162514264337593543950;

    function test_overThresholdDemoBidGraduatesAfterFinalCheckpoint() external {
        CcaTestnetDefaultsToken token = new CcaTestnetDefaultsToken();
        uint64 startBlock = uint64(block.number);
        uint64 endBlock = startBlock + 10_800;
        ContinuousClearingAuction auction = new ContinuousClearingAuction(
            address(token),
            AUCTION_SUPPLY,
            AuctionParameters({
                currency: address(0),
                tokensRecipient: address(this),
                fundsRecipient: address(this),
                startBlock: startBlock,
                endBlock: endBlock,
                claimBlock: endBlock + 1,
                tickSpacing: PRICE_TICK_SPACING_Q96,
                validationHook: address(0),
                floorPrice: FLOOR_PRICE_Q96,
                requiredCurrencyRaised: MINIMUM_RAISE,
                auctionStepsData: abi.encodePacked(
                    uint24(926), uint40(10_000), uint24(925), uint40(800)
                )
            }),
            address(0)
        );
        token.mint(address(auction), AUCTION_SUPPLY);
        auction.onTokensReceived();

        uint128 bidAmount = MINIMUM_RAISE + GRADUATION_SAFETY_MARGIN;
        auction.submitBid{value: bidAmount}(
            FLOOR_PRICE_Q96 + PRICE_TICK_SPACING_Q96,
            bidAmount,
            address(this),
            FLOOR_PRICE_Q96,
            bytes("")
        );
        assertFalse(auction.isGraduated());

        vm.roll(endBlock);
        auction.checkpoint();

        assertTrue(auction.isGraduated());
    }
}
