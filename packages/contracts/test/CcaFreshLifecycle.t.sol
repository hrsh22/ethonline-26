// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {FuelCore} from "../src/FuelCore.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CcaBidEscrow} from "../src/launch/CcaBidEscrow.sol";
import {CcaBidEscrowFactory} from "../src/launch/CcaBidEscrowFactory.sol";
import {CcaBidValidationHook} from "../src/launch/CcaBidValidationHook.sol";
import {CcaCanonicalLaunchReadiness} from "../src/launch/CcaCanonicalLaunchReadiness.sol";
import {
    CcaLaunchCoordinator,
    ICcaLaunchFuel,
    ICcaLaunchReadiness
} from "../src/launch/CcaLaunchCoordinator.sol";
import {CcaRecoverySeeder} from "../src/launch/CcaRecoverySeeder.sol";
import {PermanentPositionRecipient} from "../src/launch/PermanentPositionRecipient.sol";
import {CanonicalFeeHook} from "../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {CanonicalHookMining} from "./helpers/CanonicalHookMining.sol";
import {CcaFreshLifecycleFixture} from "./helpers/CcaFreshLifecycleFixture.sol";
import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

contract FreshRecoveryAuthority is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract CcaFreshLifecycleTest is Test, CanonicalHookMining {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    uint256 private constant Q96 = 1 << 96;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private alice = makeAddr("fresh alice");
    address private bob = makeAddr("fresh bob");
    CcaFreshLifecycleFixture private upstream;
    FuelCore private fuel;
    MockWETH private weth;
    IPoolManager private manager;
    CanonicalMarketRegistry private registry;
    CanonicalFeeHook private hook;
    CanonicalRouter private router;
    PoolKey private key;
    PermanentPositionRecipient private positions;
    CcaLaunchCoordinator private coordinator;
    CcaCanonicalLaunchReadiness private readiness;
    CcaBidEscrowFactory private escrows;
    ContinuousClearingAuction private auction;
    CcaRecoverySeeder private recovery;
    CcaBidEscrow private aliceEscrow;
    CcaBidEscrow private bobEscrow;

    function _deploy(uint128 minimumRaise) private {
        weth = new MockWETH();
        upstream = new CcaFreshLifecycleFixture();
        upstream.deployInfrastructure(address(weth));
        manager = IPoolManager(upstream.poolManager());
        fuel = new FuelCore(
            "Fresh FUEL",
            "FUEL",
            "Fresh Craft",
            "CRAFT",
            address(upstream),
            new DeterministicDiscoveryAdapter(keccak256("fresh")),
            address(this),
            new FreshRecoveryAuthority()
        );
        registry = new CanonicalMarketRegistry(manager, address(fuel), address(weth), address(this));
        hook = _deployMinedHook(
            new CanonicalHookDeployer(),
            manager,
            registry,
            address(weth),
            address(0xF001),
            address(0xF002),
            address(0xF003)
        );
        hook.configureInitializer(upstream.strategy());
        router = new CanonicalRouter(manager, registry, address(weth));
        bool fuelFirst = address(fuel) < address(weth);
        key = PoolKey({
            currency0: Currency.wrap(fuelFirst ? address(fuel) : address(weth)),
            currency1: Currency.wrap(fuelFirst ? address(weth) : address(fuel)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        registry.registerPool(key, address(router));
        positions = new PermanentPositionRecipient(upstream.positionManager(), key.toId());
        recovery = new CcaRecoverySeeder(
            ICanonicalMarketRegistry(address(registry)),
            upstream.strategy(),
            positions,
            address(this)
        );
        hook.configureRecoveryInitializer(address(recovery));
        registry.seal();
        readiness = new CcaCanonicalLaunchReadiness(
            ICanonicalMarketRegistry(address(registry)),
            ICanonicalFeeHook(address(hook)),
            upstream.strategy(),
            positions
        );
        coordinator = new CcaLaunchCoordinator(
            ICcaLaunchFuel(address(fuel)),
            ICcaLaunchReadiness(address(readiness)),
            address(this),
            address(this)
        );
        escrows = new CcaBidEscrowFactory(address(fuel), address(weth), address(coordinator));
        coordinator.configureEscrowFactory(address(escrows));
        coordinator.sealConfiguration();
        address validationAddress =
            vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address auctionAddress = upstream.prepare(
            address(fuel),
            address(weth),
            address(hook),
            validationAddress,
            address(positions),
            address(recovery),
            minimumRaise
        );
        CcaBidValidationHook validation = new CcaBidValidationHook(auctionAddress, escrows);
        assertEq(address(validation), validationAddress);
        auction = ContinuousClearingAuction(payable(auctionAddress));
        _custody(address(upstream));
        _custody(upstream.strategy());
        _custody(upstream.launcher());
        _custody(upstream.poolManager());
        _custody(upstream.positionManager());
        _custody(auctionAddress);
        _custody(address(recovery));
        _custody(address(positions));
        fuel.setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(registry)));
        fuel.transferOwnership(address(coordinator));
        coordinator.acceptFuelOwnership();
        aliceEscrow = CcaBidEscrow(escrows.deployEscrow(alice));
        bobEscrow = CcaBidEscrow(escrows.deployEscrow(bob));
        assertTrue(fuel.isDiscoveryExempt(address(aliceEscrow)));
        assertTrue(fuel.isProtectedAccount(address(aliceEscrow)));
        assertTrue(fuel.isDiscoveryExempt(address(bobEscrow)));
        assertTrue(fuel.isProtectedAccount(address(bobEscrow)));
        upstream.fund(address(fuel));
        recovery.configureAuction(auctionAddress);
        assertEq(fuel.balanceOf(upstream.launcher()), 0);
        assertEq(fuel.allowance(upstream.launcher(), upstream.strategy()), 0);
        assertEq(fuel.allowance(address(upstream), PERMIT2), 0);
        assertEq(fuel.balanceOf(auctionAddress), 4_000 ether);
        assertEq(fuel.balanceOf(upstream.strategy()), 444 ether);
        assertEq(fuel.discoveryNonce(), 0);
        _fundBidder(alice);
        _fundBidder(bob);
        vm.roll(auction.startBlock());
    }

    function _custody(address account) private {
        fuel.setDiscoveryExempt(account, true);
        fuel.setProtectedAccount(account, true);
    }

    function _fundBidder(address bidder) private {
        vm.deal(bidder, 1_000 ether);
        vm.startPrank(bidder);
        weth.deposit{value: 1_000 ether}();
        weth.approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2)
            .approve(address(weth), address(auction), type(uint160).max, type(uint48).max);
        vm.stopPrank();
    }

    function _bid(address bidder, address escrow, uint128 amount, uint256 price)
        private
        returns (uint256 id)
    {
        vm.prank(bidder);
        id = auction.submitBid(price, amount, escrow, bytes(""));
    }

    function test_freshAuctionSeedsOfficialPoolActivatesAndDeliversLargeAllocation() external {
        _deploy(1 ether);
        vm.expectRevert(CcaLaunchCoordinator.LaunchNotReady.selector);
        coordinator.activate();
        vm.expectRevert();
        manager.initialize(key, uint160(Q96));
        vm.expectRevert();
        upstream.migrate();
        assertEq(fuel.balanceOf(upstream.strategy()), 444 ether);
        uint256 aliceBid = _bid(alice, address(aliceEscrow), 100 ether, Q96);
        uint256 bobBid = _bid(bob, address(bobEscrow), 50 ether, 2 * Q96);
        vm.roll(auction.startBlock() + 3);
        uint256 aliceFractionalBid = _bid(alice, address(aliceEscrow), 0.05 ether, 3 * Q96);
        vm.roll(auction.endBlock() + 1);
        auction.exitBid(aliceBid);
        auction.exitBid(bobBid);
        auction.exitBid(aliceFractionalBid);
        assertTrue(auction.isGraduated());
        assertEq(2_000 ether - weth.balanceOf(alice) - weth.balanceOf(bob), 150.05 ether);
        assertEq(
            weth.balanceOf(address(auction)) + weth.balanceOf(address(aliceEscrow))
                + weth.balanceOf(address(bobEscrow)),
            150.05 ether
        );
        uint256 aliceAllocation =
            auction.bids(aliceBid).tokensFilled + auction.bids(aliceFractionalBid).tokensFilled;
        uint256 bobAllocation = auction.bids(bobBid).tokensFilled;
        assertGt(aliceAllocation, 64 ether);
        assertGt(aliceAllocation % 1 ether, 0);
        assertEq(auction.bids(aliceBid).owner, address(aliceEscrow));
        uint256[] memory aliceBids = new uint256[](2);
        aliceBids[0] = aliceBid;
        aliceBids[1] = aliceFractionalBid;
        auction.claimTokensBatch(address(aliceEscrow), aliceBids);
        auction.claimTokens(bobBid);
        assertEq(fuel.balanceOf(address(aliceEscrow)), aliceAllocation);
        assertEq(fuel.balanceOf(address(bobEscrow)), bobAllocation);
        assertEq(fuel.discoveryNonce(), 0);
        vm.expectRevert(CcaBidEscrow.FuelNotLaunched.selector);
        aliceEscrow.withdrawFuel();
        vm.expectRevert(CcaLaunchCoordinator.LaunchNotReady.selector);
        coordinator.activate();
        upstream.migrate();
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertGt(price, 0);
        assertEq(auction.clearingPrice(), Q96 / 8);
        uint256 expectedPriceX192 =
            address(weth) < address(fuel) ? (uint256(1) << 192) * 8 : (uint256(1) << 192) / 8;
        assertApproxEqAbs(uint256(price) * price, expectedPriceX192, uint256(price) * 2);
        positions.registerPosition(1);
        assertTrue(positions.hasCanonicalPosition());
        assertTrue(readiness.isReady());
        coordinator.activate();
        assertTrue(fuel.launched());
        fuel.acceptOwnership();
        _deliver(aliceEscrow, alice, aliceAllocation);
        _deliver(bobEscrow, bob, bobAllocation);
        recovery.sweepUnsoldTokens();
        assertLe(fuel.balanceOf(address(auction)), 3, "only bounded auction rounding dust remains");
        assertEq(fuel.balanceOf(upstream.strategy()), 0);
        assertEq(fuel.balanceOf(upstream.positionManager()), 0);
        assertEq(
            fuel.balanceOf(alice) + fuel.balanceOf(bob) + fuel.balanceOf(address(manager))
                + fuel.balanceOf(address(recovery)) + fuel.balanceOf(address(auction)),
            4_444 ether
        );
        assertEq(fuel.transientCount(address(manager)), 0);
        assertEq(fuel.transientCount(address(recovery)), 0);
        _assertUniqueIdentities();
        aliceEscrow.withdrawCurrency();
        bobEscrow.withdrawCurrency();
        _assertCurrencyConservation();
        _canonicalBuyAndSell();
        _assertCurrencyConservation();
        vm.expectRevert(CcaRecoverySeeder.RecoveryNotReady.selector);
        recovery.recoverAndSeed();
        vm.expectRevert();
        upstream.migrate();
        vm.expectRevert(CcaLaunchCoordinator.AlreadyActivated.selector);
        coordinator.activate();
    }

    function _deliver(CcaBidEscrow escrow, address beneficiary, uint256 allocation) private {
        uint256 delivered;
        while (fuel.balanceOf(address(escrow)) != 0) {
            uint256 tranche = escrow.withdrawFuel();
            assertLe(tranche, 64 ether);
            delivered += tranche;
            assertEq(fuel.transientCount(beneficiary), fuel.balanceOf(beneficiary) / 1 ether);
        }
        assertEq(delivered, allocation);
        assertEq(escrow.withdrawFuel(), 0);
        assertEq(fuel.transientCount(address(escrow)), 0);
    }

    function _assertCurrencyConservation() private view {
        uint256 accounted = weth.balanceOf(alice) + weth.balanceOf(bob)
            + weth.balanceOf(address(aliceEscrow)) + weth.balanceOf(address(bobEscrow))
            + weth.balanceOf(address(auction)) + weth.balanceOf(upstream.strategy())
            + weth.balanceOf(upstream.positionManager()) + weth.balanceOf(address(manager))
            + weth.balanceOf(address(recovery)) + weth.balanceOf(address(hook));
        assertEq(accounted, 2_000 ether);
    }

    function _assertUniqueIdentities() private view {
        bool[] memory seen = new bool[](4_445);
        uint256 count;
        address[2] memory beneficiaries = [alice, bob];
        for (uint256 who; who < 2; ++who) {
            address beneficiary = beneficiaries[who];
            uint256 owned = fuel.transientCount(beneficiary);
            count += owned;
            for (uint256 i; i < owned; ++i) {
                uint16 identity = fuel.transientIdentityAt(beneficiary, i);
                assertFalse(seen[identity], "duplicate collectible identity");
                seen[identity] = true;
                assertEq(fuel.mirror().ownerOf(identity), beneficiary);
            }
        }
        assertEq(fuel.totalTransientCount(), count);
        assertEq(uint256(fuel.availableIdentityCount()) + count, 4_444);
        assertEq(fuel.totalPendingDiscoveryCount(), 0);
    }

    function _canonicalBuyAndSell() private {
        vm.startPrank(alice);
        weth.approve(address(router), type(uint256).max);
        fuel.approve(address(router), type(uint256).max);
        uint256 bought = router.swapExactInput(
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp,
                useNative: false
            })
        );
        assertGt(bought, 0);
        assertEq(hook.rewardPot(), 0.02 ether);
        assertEq(hook.liquidityPot(), 0.0085 ether);
        assertEq(hook.creatorPot(), 0.0015 ether);
        uint256 sold = router.swapExactInput(
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp,
                useNative: false
            })
        );
        assertGt(sold, 0);
        assertGt(hook.rewardPot(), 0.02 ether);
        vm.stopPrank();
    }

    function test_failedMinimumRaiseRefundsThroughEscrowWithoutLaunching() external {
        _deploy(500 ether);
        uint256 bid = _bid(alice, address(aliceEscrow), 100 ether, Q96);
        vm.roll(auction.endBlock() + 1);
        auction.exitBid(bid);
        assertFalse(auction.isGraduated());
        assertEq(weth.balanceOf(address(aliceEscrow)), 100 ether);
        assertEq(aliceEscrow.withdrawCurrency(), 100 ether);
        assertEq(weth.balanceOf(alice), 1_000 ether);
        assertEq(aliceEscrow.withdrawCurrency(), 0);
        assertEq(auction.bids(bid).tokensFilled, 0);
        vm.expectRevert(CcaLaunchCoordinator.LaunchNotReady.selector);
        coordinator.activate();
        assertFalse(fuel.launched());
        assertEq(fuel.discoveryNonce(), 0);
        upstream.migrate();
        recovery.sweepUnsoldTokens();
        assertEq(fuel.balanceOf(address(recovery)), 4_444 ether);
        assertEq(fuel.balanceOf(upstream.strategy()), 0);
        assertEq(fuel.balanceOf(address(auction)), 0);
        vm.expectRevert();
        recovery.recoverAndSeed();
        assertFalse(readiness.isReady());
    }

    function test_caughtTerminalMigrationFailureRecoversAtomicallyAndUnlocksClaims() external {
        _deploy(1 ether);
        vm.prank(bob);
        vm.expectRevert(CcaRecoverySeeder.Unauthorized.selector);
        recovery.configureAuction(address(auction));
        vm.expectRevert(CcaRecoverySeeder.InvalidConfiguration.selector);
        recovery.configureAuction(address(auction));
        vm.expectRevert(CcaRecoverySeeder.RecoveryNotReady.selector);
        recovery.recoverAndSeed();
        uint256 bid = _bid(alice, address(aliceEscrow), 100 ether, Q96);
        vm.roll(auction.endBlock() + 1);
        auction.exitBid(bid);
        uint256 allocation = auction.bids(bid).tokensFilled;
        auction.claimTokens(bid);
        vm.expectRevert(CcaRecoverySeeder.RecoveryNotReady.selector);
        recovery.recoverAndSeed();

        // Anyone can invoke the permissionless migration inside a PoolManager unlock.
        // PositionManager's nested unlock then really reverts AlreadyUnlocked; stock LBP
        // catches it and consumes its one-shot migration without creating the pool.
        vm.recordLogs();
        manager.unlock(abi.encode(false));
        _assertTerminalFailureEvent(vm.getRecordedLogs());
        assertEq(fuel.balanceOf(address(recovery)), 444 ether);
        assertEq(weth.balanceOf(address(recovery)), auction.currencyRaised());
        assertFalse(readiness.isReady());
        assertEq(positions.receivedPositionCount(), 0);
        vm.expectRevert(CcaLaunchCoordinator.LaunchNotReady.selector);
        coordinator.activate();
        vm.expectRevert();
        upstream.migrate();
        vm.expectRevert();
        manager.unlock(abi.encode(true));
        assertFalse(recovery.seeded());
        (uint160 failedPrice,,,) = manager.getSlot0(key.toId());
        assertEq(failedPrice, 0, "failed recovery rolls initialization back");
        assertEq(fuel.balanceOf(address(recovery)), 444 ether);
        recovery.recoverAndSeed();
        assertTrue(recovery.seeded());
        assertTrue(positions.hasCanonicalPosition());
        assertTrue(readiness.isReady());
        coordinator.activate();
        _deliver(aliceEscrow, alice, allocation);
        _canonicalBuyAndSell();
        vm.expectRevert(CcaRecoverySeeder.AlreadySeeded.selector);
        recovery.recoverAndSeed();
    }

    function _assertTerminalFailureEvent(Vm.Log[] memory logs) private view {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == upstream.strategy()
                    && logs[i].topics[0] == keccak256("MigrationFailed(address,bytes)")
            ) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(auction));
                assertEq(
                    abi.decode(logs[i].data, (bytes)),
                    abi.encodeWithSelector(IPoolManager.AlreadyUnlocked.selector)
                );
                found = true;
            }
        }
        assertTrue(found, "successful receipt must expose terminal migration failure");
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "unexpected unlock callback");
        if (abi.decode(data, (bool))) recovery.recoverAndSeed();
        else upstream.migrate();
        return bytes("");
    }

    function test_validationRejectsDirectClaimOwnerAndWrongPayer() external {
        _deploy(1 ether);
        vm.expectRevert();
        _bid(alice, alice, 100 ether, Q96);
        vm.expectRevert();
        _bid(bob, address(aliceEscrow), 100 ether, Q96);
        assertEq(weth.balanceOf(alice), 1_000 ether);
        assertEq(weth.balanceOf(bob), 1_000 ether);
        assertEq(auction.nextBidId(), 0);
    }
}
