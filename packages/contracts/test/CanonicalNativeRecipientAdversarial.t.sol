// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {ProtocolSystemActor, ProtocolSystemTestBase} from "./helpers/ProtocolSystemTestBase.sol";

contract RevertingNativeSeller {
    receive() external payable {
        revert("native output rejected");
    }

    function approveFuel(FuelCore fuel, CanonicalRouter router) external {
        require(fuel.approve(address(router), type(uint256).max), "Fuel approval failed");
    }

    function sellForNative(CanonicalRouter router, uint256 fuelInput) external {
        router.swapExactInput(
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: fuelInput,
                amountOutMinimum: 0,
                recipient: address(this),
                deadline: block.timestamp,
                useNative: true
            })
        );
    }
}

contract CanonicalNativeRecipientAdversarialTest is ProtocolSystemTestBase {
    function testRevertingNativeRecipientRollsBackPoolFeeAndDiscoveryState() external {
        ProtocolSystemFixture memory fixture = _deployProtocolSystem();
        ProtocolSystemActor buyer = new ProtocolSystemActor();
        RevertingNativeSeller seller = new RevertingNativeSeller();
        vm.deal(address(this), 0.2 ether);
        fixture.weth.deposit{value: 0.2 ether}();
        require(fixture.weth.transfer(address(buyer), 0.2 ether), "buyer funding failed");
        buyer.approveToken(address(fixture.weth), address(fixture.router));
        buyer.buy(fixture.router, 0.1 ether);
        buyer.transferLiquid(fixture.fuel, address(seller), 1 ether);
        seller.approveFuel(fixture.fuel, fixture.router);

        uint256 sellerFuelBefore = fixture.fuel.balanceOf(address(seller));
        uint256 pendingBefore = fixture.fuel.pendingDiscoveryCount(address(seller));
        uint256 rewardPotBefore = fixture.feeHook.rewardPot();
        uint256 liquidityPotBefore = fixture.feeHook.liquidityPot();
        uint256 creatorPotBefore = fixture.feeHook.creatorPot();
        uint256 hookWethBefore = fixture.weth.balanceOf(address(fixture.feeHook));

        (bool sold,) = address(seller)
            .call(abi.encodeCall(RevertingNativeSeller.sellForNative, (fixture.router, 0.5 ether)));

        require(!sold, "reverting native recipient completed sale");
        require(
            fixture.fuel.balanceOf(address(seller)) == sellerFuelBefore,
            "failed native payout moved Fuel"
        );
        require(
            fixture.fuel.pendingDiscoveryCount(address(seller)) == pendingBefore,
            "failed native payout cancelled discovery"
        );
        require(fixture.feeHook.rewardPot() == rewardPotBefore, "failed sale changed reward pot");
        require(
            fixture.feeHook.liquidityPot() == liquidityPotBefore,
            "failed sale changed liquidity pot"
        );
        require(fixture.feeHook.creatorPot() == creatorPotBefore, "failed sale changed creator pot");
        require(
            fixture.weth.balanceOf(address(fixture.feeHook)) == hookWethBefore,
            "failed sale moved hook WETH"
        );
        require(address(seller).balance == 0, "reverting seller received native output");
    }
}
