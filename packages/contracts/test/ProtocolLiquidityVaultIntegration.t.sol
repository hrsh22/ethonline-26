// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {
    ProtocolLiquidityTestBase,
    ReentrantLiquidityWeth
} from "./helpers/ProtocolLiquidityTestBase.sol";

contract ProtocolLiquidityVaultIntegrationTest is ProtocolLiquidityTestBase {
    using StateLibrary for IPoolManager;

    function testValidCyclePullsOnlyTheLiquidityPotAndPermanentlyLocksWeth() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        require(fixture.vault.wethIsCurrency0(), "default fixture used wrong ordering");
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        uint256 liquidityPotBefore = fixture.hook.liquidityPot();
        uint256 hookWethBefore = fixture.weth.balanceOf(address(fixture.hook));

        uint256 consumedWeth = fixture.vault
            .addLiquidityCycle(
                tickLower, tickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, block.timestamp
            );

        require(consumedWeth != 0, "cycle consumed no WETH");
        require(consumedWeth <= liquidityPotBefore, "cycle exceeded liquidity pot");
        require(fixture.hook.liquidityPot() == 0, "liquidity pot was not pulled exactly");
        require(
            fixture.weth.balanceOf(address(fixture.hook)) == hookWethBefore - liquidityPotBefore,
            "cycle pulled a non-liquidity pot"
        );
        require(
            fixture.vault.queuedWeth() == liquidityPotBefore - consumedWeth,
            "unused WETH was not queued"
        );
        require(
            fixture.weth.balanceOf(address(fixture.vault)) == fixture.vault.queuedWeth(),
            "vault WETH and queue diverged"
        );
        require(
            fixture.vault.permanentlyLockedWeth() == consumedWeth, "locked WETH accounting diverged"
        );
        require(fixture.fuel.balanceOf(address(fixture.vault)) == 0, "cycle consumed Liquid Token");
        (uint128 positionLiquidity,,) = IPoolManager(address(fixture.manager))
            .getPositionInfo(
                fixture.key.toId(),
                address(fixture.vault),
                tickLower,
                tickUpper,
                bytes32(uint256(1))
            );
        require(positionLiquidity == CYCLE_LIQUIDITY, "locked position liquidity mismatch");
        require(fixture.vault.liquidityCycleCount() == 1, "cycle counter not advanced");
    }

    function testReverseOrderingAlsoLocksOnlyWethAndRejectsFuelRequiredRange() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), false);
        require(!fixture.vault.wethIsCurrency0(), "reverse fixture did not put WETH second");
        _accrueLiquidityPot(fixture, 10 ether);
        uint256 liquidityPotBefore = fixture.hook.liquidityPot();
        uint256 hookWethBefore = fixture.weth.balanceOf(address(fixture.hook));
        (int24 fuelTickLower, int24 fuelTickUpper) = _fuelRequiredRange(fixture);

        bytes4 selector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (fuelTickLower, fuelTickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, block.timestamp)
            )
        );

        require(
            selector == ProtocolLiquidityVault.InvalidWethOnlyDelta.selector,
            "reverse wrong-sided range was accepted"
        );
        require(fixture.hook.liquidityPot() == liquidityPotBefore, "reverse failure changed pot");
        require(
            fixture.weth.balanceOf(address(fixture.hook)) == hookWethBefore,
            "reverse failure moved hook WETH"
        );
        require(fixture.vault.queuedWeth() == 0, "reverse failure changed queue");

        (int24 wethTickLower, int24 wethTickUpper) = _wethOnlyRange(fixture);
        uint256 consumedWeth = fixture.vault
            .addLiquidityCycle(
                wethTickLower, wethTickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, block.timestamp
            );

        require(consumedWeth != 0, "reverse cycle consumed no WETH");
        require(fixture.fuel.balanceOf(address(fixture.vault)) == 0, "reverse cycle used Fuel");
        require(
            fixture.vault.permanentlyLockedWeth() == consumedWeth,
            "reverse locked accounting diverged"
        );
        require(
            fixture.vault.queuedWeth() == fixture.weth.balanceOf(address(fixture.vault)),
            "reverse queue did not reconcile"
        );
        (uint128 positionLiquidity,,) = IPoolManager(address(fixture.manager))
            .getPositionInfo(
                fixture.key.toId(),
                address(fixture.vault),
                wethTickLower,
                wethTickUpper,
                bytes32(uint256(1))
            );
        require(positionLiquidity == CYCLE_LIQUIDITY, "reverse locked position missing");
    }

    function testAnyRangeRequiringLiquidTokenRevertsWithoutChangingPotOrQueue() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _fuelRequiredRange(fixture);
        uint256 liquidityPotBefore = fixture.hook.liquidityPot();
        uint256 hookWethBefore = fixture.weth.balanceOf(address(fixture.hook));

        bytes4 selector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower, tickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, block.timestamp)
            )
        );

        require(
            selector == ProtocolLiquidityVault.InvalidWethOnlyDelta.selector,
            "wrong wrong-sided range error"
        );
        require(fixture.hook.liquidityPot() == liquidityPotBefore, "failed cycle changed pot");
        require(
            fixture.weth.balanceOf(address(fixture.hook)) == hookWethBefore,
            "failed cycle moved hook WETH"
        );
        require(fixture.vault.queuedWeth() == 0, "failed cycle created queue");
        require(fixture.vault.permanentlyLockedWeth() == 0, "failed cycle locked WETH");
        require(fixture.vault.liquidityCycleCount() == 0, "failed cycle advanced counter");
    }

    function testExecutorCannotSpendMoreThanMaximumOrAvailableQueue() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        uint256 liquidityPotBefore = fixture.hook.liquidityPot();

        bytes4 maximumSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower, tickUpper, CYCLE_LIQUIDITY, uint256(1), block.timestamp)
            )
        );
        require(
            maximumSelector == ProtocolLiquidityVault.MaximumWethExceeded.selector,
            "supplied maximum was not enforced"
        );

        bytes4 queueSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower, tickUpper, CYCLE_LIQUIDITY * 10_000, 1 ether, block.timestamp)
            )
        );
        require(
            queueSelector == ProtocolLiquidityVault.QueuedWethExceeded.selector,
            "available queue was not enforced"
        );
        require(fixture.hook.liquidityPot() == liquidityPotBefore, "bounded failures changed pot");
        require(fixture.vault.queuedWeth() == 0, "bounded failures changed queue");
        require(fixture.vault.permanentlyLockedWeth() == 0, "bounded failures locked WETH");
    }

    function testRepeatedCyclesCreateDistinctPositionsWithoutARecoverySurface() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        uint256 firstConsumed = fixture.vault
            .addLiquidityCycle(
                tickLower, tickUpper, CYCLE_LIQUIDITY, fixture.hook.liquidityPot(), block.timestamp
            );
        require(fixture.hook.liquidityPot() == 0, "first cycle left hook pot queued");
        uint256 secondMaximum = fixture.vault.queuedWeth();

        uint256 secondConsumed = fixture.vault
            .addLiquidityCycle(
                tickLower, tickUpper, CYCLE_LIQUIDITY, secondMaximum, block.timestamp
            );

        require(fixture.vault.liquidityCycleCount() == 2, "second cycle not recorded");
        (uint128 firstLiquidity,,) = IPoolManager(address(fixture.manager))
            .getPositionInfo(
                fixture.key.toId(),
                address(fixture.vault),
                tickLower,
                tickUpper,
                bytes32(uint256(1))
            );
        (uint128 secondLiquidity,,) = IPoolManager(address(fixture.manager))
            .getPositionInfo(
                fixture.key.toId(),
                address(fixture.vault),
                tickLower,
                tickUpper,
                bytes32(uint256(2))
            );
        require(firstLiquidity == CYCLE_LIQUIDITY, "first locked position changed");
        require(secondLiquidity == CYCLE_LIQUIDITY, "second locked position missing");
        require(
            !_call(
                address(fixture.vault),
                abi.encodeWithSignature("removeLiquidity(bytes32,uint128)", bytes32(0), uint128(1))
            ),
            "liquidity removal interface exists"
        );
        require(
            !_call(
                address(fixture.vault),
                abi.encodeWithSignature("withdraw(address,uint256)", address(fixture.weth), 1)
            ),
            "WETH withdrawal interface exists"
        );
        require(
            !_call(
                address(fixture.vault),
                abi.encodeWithSignature("rescue(address,uint256)", address(fixture.weth), 1)
            ),
            "rescue interface exists"
        );
        require(
            !_call(
                address(fixture.vault),
                abi.encodeWithSignature("execute(address,bytes)", address(fixture.weth), bytes(""))
            ),
            "arbitrary call interface exists"
        );
        require(
            !_call(address(fixture.vault), abi.encodeWithSignature("collectFees()")),
            "fee collection interface exists"
        );
        require(
            fixture.vault.permanentlyLockedWeth() == firstConsumed + secondConsumed,
            "locked WETH did not reconcile"
        );
        require(
            fixture.vault.queuedWeth() == fixture.weth.balanceOf(address(fixture.vault)),
            "queued WETH did not reconcile"
        );
    }

    function testOwnerCanPauseAndReplaceExecutorWithoutGrantingAssetAuthority() external {
        address previousExecutor = address(0xBEEF);
        address replacementExecutor = address(0xCAFE);
        Fixture memory fixture = _deployLaunchedFixture(previousExecutor, true);
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        uint256 maximumWeth = fixture.hook.liquidityPot();
        fixture.vault.setExecutor(replacementExecutor);
        fixture.vault.setPaused(true);

        VM.prank(previousExecutor);
        require(
            !_callCycle(
                fixture.vault, tickLower, tickUpper, CYCLE_LIQUIDITY, maximumWeth, block.timestamp
            ),
            "replaced executor retained authority"
        );
        VM.prank(replacementExecutor);
        require(
            !_callCycle(
                fixture.vault, tickLower, tickUpper, CYCLE_LIQUIDITY, maximumWeth, block.timestamp
            ),
            "paused executor added liquidity"
        );

        fixture.vault.setPaused(false);
        VM.prank(replacementExecutor);
        require(
            _callCycle(
                fixture.vault, tickLower, tickUpper, CYCLE_LIQUIDITY, maximumWeth, block.timestamp
            ),
            "replacement executor could not add liquidity"
        );
        require(fixture.vault.liquidityCycleCount() == 1, "replacement cycle missing");
        require(fixture.vault.owner() == address(this), "owner authority moved to executor");
    }

    function testDirectCallbackAndSettlementTokenReentryAreRejected() external {
        ReentrantLiquidityWeth adversarialWeth = new ReentrantLiquidityWeth();
        Fixture memory fixture =
            _deployLaunchedFixtureWithWeth(adversarialWeth, address(adversarialWeth));
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        adversarialWeth.setTarget(fixture.vault);

        bytes4 directSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(ProtocolLiquidityVault.unlockCallback, (bytes("")))
        );
        require(
            directSelector == ProtocolLiquidityVault.CallbackNotPoolManager.selector,
            "direct callback used wrong error"
        );
        VM.prank(address(fixture.manager));
        bytes4 inactiveSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(ProtocolLiquidityVault.unlockCallback, (bytes("")))
        );
        require(
            inactiveSelector == ProtocolLiquidityVault.UnauthorizedCallback.selector,
            "inactive PoolManager callback was accepted"
        );

        uint256 consumedWeth = adversarialWeth.executeCycle(
            tickLower, tickUpper, CYCLE_LIQUIDITY, fixture.hook.liquidityPot(), block.timestamp
        );

        require(adversarialWeth.reentryAttempted(), "Settlement Asset did not attempt reentry");
        require(!adversarialWeth.reentrySucceeded(), "Settlement Asset reentry succeeded");
        require(consumedWeth != 0, "outer liquidity cycle did not complete");
        require(fixture.vault.liquidityCycleCount() == 1, "reentry changed cycle count");
    }

    function testExpiredAndMalformedCyclesFailBeforePullingTheLiquidityPot() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        _accrueLiquidityPot(fixture, 10 ether);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        uint256 liquidityPotBefore = fixture.hook.liquidityPot();
        VM.warp(100);

        bytes4 deadlineSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower, tickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, uint256(99))
            )
        );
        require(
            deadlineSelector == ProtocolLiquidityVault.DeadlineExpired.selector,
            "expired cycle used wrong error"
        );
        bytes4 rangeSelector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower + 1, tickUpper, CYCLE_LIQUIDITY, liquidityPotBefore, uint256(100))
            )
        );
        require(
            rangeSelector == ProtocolLiquidityVault.InvalidTickRange.selector,
            "malformed range used wrong error"
        );
        require(fixture.hook.liquidityPot() == liquidityPotBefore, "preflight failure pulled pot");
        require(fixture.vault.queuedWeth() == 0, "preflight failure changed queue");
    }

    function testDonatedWethCannotBypassTheDestinationLockedQueue() external {
        Fixture memory fixture = _deployLaunchedFixture(address(this), true);
        (int24 tickLower, int24 tickUpper) = _wethOnlyRange(fixture);
        VM.deal(address(this), address(this).balance + 1 ether);
        fixture.weth.deposit{value: 1 ether}();
        require(fixture.weth.transfer(address(fixture.vault), 1 ether), "vault donation failed");

        bytes4 selector = _revertSelector(
            address(fixture.vault),
            abi.encodeCall(
                ProtocolLiquidityVault.addLiquidityCycle,
                (tickLower, tickUpper, CYCLE_LIQUIDITY, uint256(1 ether), block.timestamp)
            )
        );

        require(
            selector == ProtocolLiquidityVault.QueuedWethExceeded.selector,
            "donation bypassed destination-locked queue"
        );
        require(fixture.vault.queuedWeth() == 0, "donation entered queue accounting");
        require(
            fixture.weth.balanceOf(address(fixture.vault)) == 1 ether,
            "failed donated cycle moved WETH"
        );
        require(fixture.vault.permanentlyLockedWeth() == 0, "donation was locked");
    }
}
