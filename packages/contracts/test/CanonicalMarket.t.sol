// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {CustomRevert} from "v4-core/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {IDiscoveryAdapter} from "../src/interfaces/IDiscoveryAdapter.sol";
import {IInitializerHook} from "../src/interfaces/IInitializerHook.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalFeeHook} from "../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {MockUSDC} from "../src/test-assets/MockUSDC.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {CanonicalHookMining} from "./helpers/CanonicalHookMining.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";

interface CanonicalMarketVm {
    function deal(address target, uint256 balance) external;

    function prank(address sender) external;

    function warp(uint256 timestamp) external;
}

contract CanonicalRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract UnauthorizedCanonicalInitializer {
    function initialize(IPoolManager manager, PoolKey calldata key, uint160 sqrtPriceX96) external {
        manager.initialize(key, sqrtPriceX96);
    }
}

contract ReentrantDiscoveryAdapter is IDiscoveryAdapter {
    FuelCore public core;
    bool public attempted;
    bool public reentrySucceeded;

    function setCore(FuelCore core_) external {
        require(address(core) == address(0), "core already set");
        core = core_;
    }

    function requestDiscovery(address recipient, uint256 firstNonce, uint256 count)
        external
        returns (DiscoveryResponse memory response)
    {
        attempted = true;
        (reentrySucceeded,) =
            address(core).call(abi.encodeCall(FuelCore.transfer, (recipient, uint256(0))));
        bytes32[] memory entropies = new bytes32[](count);
        for (uint256 index; index < count; ++index) {
            entropies[index] = bytes32(firstNonce + index + 100);
        }
        response = DiscoveryResponse({
            immediate: true, entropies: entropies, requestIds: new bytes32[](0)
        });
    }
}

contract ReentrantMockWETH is MockWETH {
    address public callbackRecipient;

    function setCallbackRecipient(address recipient) external {
        callbackRecipient = recipient;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        super._transfer(from, to, amount);
        if (to == callbackRecipient) {
            (bool callbackSucceeded,) = to.call("");
            require(callbackSucceeded, "callback failed");
        }
    }
}

contract ReentrantPotDestination {
    CanonicalFeeHook public hook;
    bool public attempted;
    bool public reentrySucceeded;

    receive() external payable {
        attempted = true;
        (reentrySucceeded,) =
            address(hook).call(abi.encodeCall(CanonicalFeeHook.pullRewardPot, (uint256(1))));
    }

    function setHook(CanonicalFeeHook hook_) external {
        require(address(hook) == address(0), "hook already set");
        hook = hook_;
    }

    function pullReward(uint256 amount) external {
        hook.pullRewardPot(amount);
    }
}

contract ReentrantNativeRecipient {
    CanonicalRouter public immutable router;
    bool public attempted;
    bool public reentrySucceeded;

    constructor(CanonicalRouter router_) {
        router = router_;
    }

    receive() external payable {
        attempted = true;
        (reentrySucceeded,) = address(router)
            .call(abi.encodeCall(CanonicalRouter.quoteExactInput, (false, uint256(1))));
    }
}

contract CanonicalLiquiditySeeder is IUnlockCallback {
    using SafeCast for int128;

    IPoolManager public immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function seed(
        PoolKey calldata key,
        uint128 liquidity,
        address payer,
        int24 tickLower,
        int24 tickUpper
    ) external {
        manager.unlock(abi.encode(key, liquidity, payer, tickLower, tickUpper));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "callback caller");
        (PoolKey memory key, uint128 liquidity, address payer, int24 tickLower, int24 tickUpper) =
            abi.decode(data, (PoolKey, uint128, address, int24, int24));
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
        if (delta.amount0() < 0) {
            _settle(key.currency0, payer, (-delta.amount0()).toUint128());
        }
        if (delta.amount1() < 0) {
            _settle(key.currency1, payer, (-delta.amount1()).toUint128());
        }
        return abi.encode(delta);
    }

    function _settle(Currency currency, address payer, uint256 amount) private {
        manager.sync(currency);
        address token = Currency.unwrap(currency);
        require(IERC20Minimal(token).transferFrom(payer, address(manager), amount), "seed transfer");
        manager.settle();
    }
}

contract CanonicalTrader {
    using SafeCast for uint256;

    receive() external payable {}

    function approveToken(address token, address spender) external {
        require(IERC20Minimal(token).approve(spender, type(uint256).max), "approval failed");
    }

    function exactInput(CanonicalRouter router, CanonicalRouter.ExactInputParams calldata params)
        external
        payable
        returns (uint256)
    {
        return router.swapExactInput{value: msg.value}(params);
    }

    function exactOutput(CanonicalRouter router, CanonicalRouter.ExactOutputParams calldata params)
        external
        payable
        returns (uint256)
    {
        return router.swapExactOutput{value: msg.value}(params);
    }

    function exactInputNative(
        CanonicalRouter router,
        CanonicalRouter.ExactInputParams calldata params
    ) external returns (uint256) {
        return router.swapExactInput{value: params.amountIn}(params);
    }

    function exactOutputNative(
        CanonicalRouter router,
        CanonicalRouter.ExactOutputParams calldata params
    ) external returns (uint256) {
        return router.swapExactOutput{value: params.amountInMaximum}(params);
    }

    function rogueExactInput(
        PoolSwapTest router,
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amount
    ) external {
        router.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amount.toInt256(),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            bytes("")
        );
    }
}

contract CanonicalMarketRegistryTest is CanonicalHookMining {
    function testFuelCoreCannotLaunchWithoutASealedCanonicalMarket() external {
        FuelCore fuel = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(0xBEEF),
            new CanonicalRecoveryHarness()
        );

        (bool launched,) = address(fuel).call(abi.encodeCall(FuelCore.launch, ()));

        require(!launched, "launch bypassed Canonical Market setup");
        require(!fuel.launched(), "failed launch changed state");
    }

    function testRegistersAndSealsExactlyOneDynamicFuelWethPoolWithRequiredPermissionBits()
        external
    {
        PoolManager manager = new PoolManager(address(this));
        MockWETH weth = new MockWETH();
        MockUSDC fuel = new MockUSDC(4_444 ether, address(this));
        CanonicalMarketRegistry registry =
            new CanonicalMarketRegistry(manager, address(fuel), address(weth), address(this));
        CanonicalHookDeployer deployer = new CanonicalHookDeployer();

        uint160 requiredFlags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        CanonicalFeeHook hook = _deployMinedHook(
            deployer,
            manager,
            registry,
            address(weth),
            address(0xA11CE),
            address(0xB0B),
            address(0xC0FFEE)
        );
        CanonicalRouter router = new CanonicalRouter(manager, registry, address(weth));

        (Currency currency0, Currency currency1) = address(fuel) < address(weth)
            ? (Currency.wrap(address(fuel)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(fuel)));
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        registry.registerPool(key, address(router));
        hook.configureInitializer(address(this));
        registry.seal();

        require(registry.isSealed(), "registry did not seal");
        require(PoolId.unwrap(registry.poolId()) == PoolId.unwrap(key.toId()), "wrong pool ID");
        require(registry.router() == address(router), "wrong router");
        require(registry.permissionBits() == requiredFlags, "wrong hook permission bits");
        require(hook.authorized() == address(this), "wrong initializer authority");
        require(
            hook.supportsInterface(type(IInitializerHook).interfaceId),
            "initializer interface missing"
        );
        require(hook.supportsInterface(0x01ffc9a7), "ERC-165 interface missing");
        (bool reconfigured,) =
            address(hook).call(abi.encodeCall(hook.configureInitializer, (address(router))));
        require(!reconfigured, "initializer authority changed");

        _assertUnauthorizedInitializationRejected(manager, key);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        (bool secondRegistrationSucceeded,) = address(registry)
            .call(abi.encodeCall(CanonicalMarketRegistry.registerPool, (key, address(router))));
        require(!secondRegistrationSucceeded, "registry accepted a second pool");
    }

    function _assertUnauthorizedInitializationRejected(PoolManager manager, PoolKey memory key)
        private
    {
        UnauthorizedCanonicalInitializer hostile = new UnauthorizedCanonicalInitializer();
        (bool initialized,) = address(hostile)
            .call(
                abi.encodeCall(
                    hostile.initialize,
                    (IPoolManager(address(manager)), key, TickMath.getSqrtPriceAtTick(0))
                )
            );
        require(!initialized, "unauthorized initializer opened the pool");
    }
}

contract CanonicalMarketTradingTest is CanonicalHookMining {
    CanonicalMarketVm internal constant VM =
        CanonicalMarketVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant MAX_DISCOVERY_MUTATIONS = 64;
    uint256 private constant FRACTIONAL_FUEL_BALANCE = 0.25 ether;
    uint256 private constant SELLER_STARTING_BALANCE = 65.25 ether;

    struct Fixture {
        PoolManager manager;
        MockWETH weth;
        FuelCore fuel;
        CanonicalMarketRegistry registry;
        CanonicalFeeHook hook;
        CanonicalRouter router;
        PoolKey key;
        PoolKey rogueKey;
    }

    receive() external payable {}

    function testExactInputWethPurchaseUsesRealPoolAndSplitsExactlyThreePercent() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = new CanonicalTrader();
        require(fixture.weth.transfer(address(trader), 20 ether), "trader funding failed");
        trader.approveToken(address(fixture.weth), address(fixture.router));

        (uint256 quotedFuel, uint256 quotedFee) = fixture.router.quoteExactInput(false, 10 ether);
        uint256 receivedFuel = trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 10 ether,
                amountOutMinimum: quotedFuel,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );

        require(receivedFuel == quotedFuel, "execution disagreed with quote");
        require(quotedFee == 0.3 ether, "wrong quoted WETH fee");
        require(fixture.fuel.balanceOf(address(trader)) == receivedFuel, "FUEL was not delivered");
        require(fixture.hook.rewardPot() == 0.2 ether, "wrong reward pot");
        require(fixture.hook.liquidityPot() == 0.085 ether, "wrong liquidity pot");
        require(fixture.hook.creatorPot() == 0.015 ether, "wrong creator pot");
        require(
            fixture.hook.rewardPot() + fixture.hook.liquidityPot() + fixture.hook.creatorPot()
                == 0.3 ether,
            "pots do not sum to 3%"
        );
    }

    function testBuyWithFractionalStartingBalanceExecutesAt63DiscoveryMutations() external {
        _assertFractionalBuyBoundary(63, true);
    }

    function testBuyWithFractionalStartingBalanceExecutesAt64DiscoveryMutations() external {
        _assertFractionalBuyBoundary(MAX_DISCOVERY_MUTATIONS, true);
    }

    function testBuyWithFractionalStartingBalanceRejects65DiscoveryMutations() external {
        _assertFractionalBuyBoundary(MAX_DISCOVERY_MUTATIONS + 1, false);
    }

    function testSellFromFractionalBalanceExecutesAt63DiscoveryMutations() external {
        _assertFractionalSellBoundary(63, true);
    }

    function testSellFromFractionalBalanceExecutesAt64DiscoveryMutations() external {
        _assertFractionalSellBoundary(MAX_DISCOVERY_MUTATIONS, true);
    }

    function testSellFromFractionalBalanceRejects65DiscoveryMutations() external {
        _assertFractionalSellBoundary(MAX_DISCOVERY_MUTATIONS + 1, false);
    }

    function testSafeBuyQuoteRevertsAtomicallyAfterRecipientBoundaryDrift() external {
        Fixture memory fixture = _deployFixture();
        uint256 fuelOutput = 64.25 ether;
        CanonicalTrader trader = new CanonicalTrader();
        require(
            fixture.fuel.transfer(address(trader), FRACTIONAL_FUEL_BALANCE),
            "initial fractional buyer funding failed"
        );
        (uint256 quotedWethInput,) = fixture.router.quoteExactOutput(false, fuelOutput);
        require(
            fixture.weth.transfer(address(trader), quotedWethInput), "buyer WETH funding failed"
        );
        trader.approveToken(address(fixture.weth), address(fixture.router));

        require(
            fixture.fuel.transfer(address(trader), 0.5 ether), "buyer boundary drift funding failed"
        );
        uint256 wethBefore = fixture.weth.balanceOf(address(trader));
        CanonicalRouter.ExactOutputParams memory params = CanonicalRouter.ExactOutputParams({
            fuelForWeth: false,
            amountOut: fuelOutput,
            amountInMaximum: quotedWethInput,
            recipient: address(trader),
            deadline: block.timestamp,
            useNative: false
        });
        (bool succeeded, bytes memory result) = address(trader)
            .call(abi.encodeCall(CanonicalTrader.exactOutput, (fixture.router, params)));

        require(!succeeded, "boundary-drifted buy succeeded");
        _assertDiscoveryMutationLimit(result, address(fixture.fuel), MAX_DISCOVERY_MUTATIONS + 1);
        require(
            fixture.fuel.balanceOf(address(trader)) == 0.75 ether, "failed drifted buy changed FUEL"
        );
        require(
            fixture.weth.balanceOf(address(trader)) == wethBefore, "failed drifted buy spent WETH"
        );
        require(
            fixture.fuel.transientCount(address(trader)) == 0,
            "failed drifted buy materialized identities"
        );
    }

    function testSafeSellQuoteRevertsAtomicallyAfterSenderBoundaryDrift() external {
        Fixture memory fixture = _deployFixture();
        _seedCanonicalWethSide(fixture);
        CanonicalTrader seller = new CanonicalTrader();
        require(
            fixture.fuel.transfer(address(seller), MAX_DISCOVERY_MUTATIONS * 1 ether),
            "seller whole-unit funding failed"
        );
        require(
            fixture.fuel.transfer(address(seller), 1.75 ether), "seller fractional funding failed"
        );
        seller.approveToken(address(fixture.fuel), address(fixture.router));
        uint256 fuelInput = 64.75 ether;
        (uint256 quotedWethOutput,) = fixture.router.quoteExactInput(true, fuelInput);

        VM.prank(address(seller));
        require(
            fixture.fuel.transfer(address(0xD12F7), 0.5 ether),
            "seller boundary drift transfer failed"
        );
        uint256 wethBefore = fixture.weth.balanceOf(address(seller));
        CanonicalRouter.ExactInputParams memory params = CanonicalRouter.ExactInputParams({
            fuelForWeth: true,
            amountIn: fuelInput,
            amountOutMinimum: quotedWethOutput,
            recipient: address(seller),
            deadline: block.timestamp,
            useNative: false
        });
        (bool succeeded, bytes memory result) = address(seller)
            .call(abi.encodeCall(CanonicalTrader.exactInput, (fixture.router, params)));

        require(!succeeded, "boundary-drifted sell succeeded");
        _assertDiscoveryMutationLimit(result, address(fixture.fuel), MAX_DISCOVERY_MUTATIONS + 1);
        require(
            fixture.fuel.balanceOf(address(seller)) == 65.25 ether,
            "failed drifted sell changed FUEL"
        );
        require(
            fixture.weth.balanceOf(address(seller)) == wethBefore,
            "failed drifted sell delivered WETH"
        );
        require(
            fixture.fuel.transientCount(address(seller)) == MAX_DISCOVERY_MUTATIONS + 1,
            "failed drifted sell dissolved identities"
        );
    }

    function testFrozenTraderCannotBuyFuelForAnUnfrozenRecipient() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        address recipient = address(0xCAFE);
        VM.prank(address(0xBEEF));
        fixture.fuel.guardianFreeze(address(trader));
        uint256 wethBefore = fixture.weth.balanceOf(address(trader));

        CanonicalRouter.ExactInputParams memory params = CanonicalRouter.ExactInputParams({
            fuelForWeth: false,
            amountIn: 1 ether,
            amountOutMinimum: 0,
            recipient: recipient,
            deadline: block.timestamp,
            useNative: false
        });
        (bool succeeded,) = address(trader)
            .call(abi.encodeCall(CanonicalTrader.exactInput, (fixture.router, params)));

        require(!succeeded, "router discarded the real trader identity");
        require(fixture.weth.balanceOf(address(trader)) == wethBefore, "failed trade spent WETH");
        require(fixture.fuel.balanceOf(recipient) == 0, "failed trade delivered FUEL");
    }

    function testBothDirectionsAndExactOutputChargeAgainstTheWethLeg() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 50 ether);

        (uint256 purchasedFuel,) = fixture.router.quoteExactInput(false, 20 ether);
        trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 20 ether,
                amountOutMinimum: purchasedFuel,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );
        trader.approveToken(address(fixture.fuel), address(fixture.router));

        uint256 totalPotBefore = _totalPot(fixture.hook);
        (uint256 quotedWeth, uint256 saleFee) = fixture.router.quoteExactInput(true, 5 ether);
        uint256 wethBefore = fixture.weth.balanceOf(address(trader));
        uint256 receivedWeth = trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: 5 ether,
                amountOutMinimum: quotedWeth,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );
        require(receivedWeth == quotedWeth, "wrong exact-input WETH output");
        require(fixture.weth.balanceOf(address(trader)) == wethBefore + quotedWeth, "sale unpaid");
        require(_totalPot(fixture.hook) == totalPotBefore + saleFee, "sale fee not accrued");

        (uint256 fuelInput, uint256 exactOutputFee) = fixture.router.quoteExactOutput(true, 1 ether);
        uint256 exactOutputWethBefore = fixture.weth.balanceOf(address(trader));
        uint256 actualFuelInput = trader.exactOutput(
            fixture.router,
            CanonicalRouter.ExactOutputParams({
                fuelForWeth: true,
                amountOut: 1 ether,
                amountInMaximum: fuelInput,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );
        require(actualFuelInput == fuelInput, "exact-output input disagreed with quote");
        (uint256 expectedFee,,,) = fixture.hook.feeAmounts(1 ether + exactOutputFee);
        require(exactOutputFee == expectedFee, "exact-output fee base was not gross WETH");
        require(
            fixture.weth.balanceOf(address(trader)) == exactOutputWethBefore + 1 ether,
            "exact WETH output was not preserved"
        );
    }

    function testExactFuelOutputIncludesWethFeeInsideMaximumInput() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        (uint256 wethInput, uint256 fuelOutputFee) = fixture.router.quoteExactOutput(false, 1 ether);

        uint256 actualWethInput = trader.exactOutput(
            fixture.router,
            CanonicalRouter.ExactOutputParams({
                fuelForWeth: false,
                amountOut: 1 ether,
                amountInMaximum: wethInput,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );

        require(actualWethInput == wethInput, "wrong exact-output WETH input");
        (uint256 expectedFee,,,) = fixture.hook.feeAmounts(actualWethInput);
        require(fuelOutputFee == expectedFee, "fee was not 3% of actual WETH input");
        require(fixture.fuel.balanceOf(address(trader)) == 1 ether, "exact FUEL output changed");
    }

    function testFeeRemainderAndPotWithdrawalsStayDestinationLocked() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 10 ether,
                amountOutMinimum: 0,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );

        (uint256 total, uint256 reward, uint256 liquidity, uint256 creator) =
            fixture.hook.feeAmounts(9_999);
        require(total == 299, "wrong rounded total");
        require(reward == 199, "wrong rounded reward allocation");
        require(liquidity == 84, "wrong rounded liquidity allocation");
        require(creator == 16, "final remainder was not deterministic");
        require(reward + liquidity + creator == total, "rounded allocations lost value");

        (bool wrongDestinationSucceeded,) =
            address(fixture.hook).call(abi.encodeCall(CanonicalFeeHook.pullRewardPot, (1)));
        require(!wrongDestinationSucceeded, "arbitrary caller pulled reward pot");
        VM.prank(address(0xA11CE));
        (bool crossedPots,) =
            address(fixture.hook).call(abi.encodeCall(CanonicalFeeHook.pullLiquidityPot, (1)));
        require(!crossedPots, "reward destination pulled liquidity pot");

        uint256 rewardPot = fixture.hook.rewardPot();
        VM.prank(address(0xA11CE));
        fixture.hook.pullRewardPot(rewardPot);
        require(fixture.hook.rewardPot() == 0, "reward pot did not clear");
        require(fixture.weth.balanceOf(address(0xA11CE)) == rewardPot, "wrong reward destination");
    }

    function testNativeInputRefundAndWethOutputUnwrapStrandNoRouterValue() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = new CanonicalTrader();
        VM.deal(address(trader), 20 ether);

        (uint256 quotedNativeInput,) = fixture.router.quoteExactOutput(false, 2 ether);
        uint256 maximumNativeInput = quotedNativeInput + 1 ether;
        uint256 etherBefore = address(trader).balance;
        uint256 actualNativeInput = trader.exactOutputNative(
            fixture.router,
            CanonicalRouter.ExactOutputParams({
                fuelForWeth: false,
                amountOut: 2 ether,
                amountInMaximum: maximumNativeInput,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: true
            })
        );
        require(actualNativeInput == quotedNativeInput, "native exact-output input changed");
        require(address(trader).balance == etherBefore - actualNativeInput, "native refund wrong");

        trader.approveToken(address(fixture.fuel), address(fixture.router));
        uint256 etherBeforeSale = address(trader).balance;
        uint256 unwrappedOut = trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: true
            })
        );
        require(address(trader).balance == etherBeforeSale + unwrappedOut, "WETH not unwrapped");
        require(address(fixture.router).balance == 0, "router stranded native ETH");
        require(fixture.weth.balanceOf(address(fixture.router)) == 0, "router stranded WETH");
    }

    function testRoguePoolOnRegisteredManagerCannotSettleFuel() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        PoolSwapTest rogueRouter = new PoolSwapTest(fixture.manager);
        trader.approveToken(address(fixture.weth), address(rogueRouter));
        bool zeroForOne = Currency.unwrap(fixture.rogueKey.currency0) == address(fixture.weth);
        uint256 wethBefore = fixture.weth.balanceOf(address(trader));

        (bool succeeded,) = address(trader)
            .call(
                abi.encodeCall(
                    CanonicalTrader.rogueExactInput,
                    (rogueRouter, fixture.rogueKey, zeroForOne, uint256(1 ether))
                )
            );

        require(!succeeded, "rogue pool settled FUEL");
        require(fixture.weth.balanceOf(address(trader)) == wethBefore, "rogue attempt spent WETH");
    }

    function testDeadlinesAndMinimumMaximumBoundsFailBeforeMovingValue() external {
        VM.warp(100);
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        (uint256 quotedFuel,) = fixture.router.quoteExactInput(false, 1 ether);
        uint256 wethBefore = fixture.weth.balanceOf(address(trader));
        uint256 potBefore = _totalPot(fixture.hook);

        CanonicalRouter.ExactInputParams memory expired = CanonicalRouter.ExactInputParams({
            fuelForWeth: false,
            amountIn: 1 ether,
            amountOutMinimum: 0,
            recipient: address(trader),
            deadline: 99,
            useNative: false
        });
        (bool expiredSucceeded,) = address(trader)
            .call(abi.encodeCall(CanonicalTrader.exactInput, (fixture.router, expired)));
        require(!expiredSucceeded, "expired swap succeeded");

        CanonicalRouter.ExactInputParams memory excessiveMinimum = expired;
        excessiveMinimum.deadline = 100;
        excessiveMinimum.amountOutMinimum = quotedFuel + 1;
        (bool minimumSucceeded,) = address(trader)
            .call(abi.encodeCall(CanonicalTrader.exactInput, (fixture.router, excessiveMinimum)));
        require(!minimumSucceeded, "minimum-output bound was ignored");

        (uint256 quotedWethInput,) = fixture.router.quoteExactOutput(false, 1 ether);
        CanonicalRouter.ExactOutputParams memory insufficientMaximum =
            CanonicalRouter.ExactOutputParams({
                fuelForWeth: false,
                amountOut: 1 ether,
                amountInMaximum: quotedWethInput - 1,
                recipient: address(trader),
                deadline: 100,
                useNative: false
            });
        (bool maximumSucceeded,) = address(trader)
            .call(
                abi.encodeCall(CanonicalTrader.exactOutput, (fixture.router, insufficientMaximum))
            );
        require(!maximumSucceeded, "maximum-input bound was ignored");
        require(fixture.weth.balanceOf(address(trader)) == wethBefore, "failed bound spent WETH");
        require(_totalPot(fixture.hook) == potBefore, "failed bound accrued a fee");
    }

    function testRouterRejectsReentryFromNativeOutputRecipient() external {
        Fixture memory fixture = _deployFixture();
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 10 ether,
                amountOutMinimum: 0,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );
        trader.approveToken(address(fixture.fuel), address(fixture.router));
        ReentrantNativeRecipient recipient = new ReentrantNativeRecipient(fixture.router);

        trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                recipient: address(recipient),
                deadline: block.timestamp,
                useNative: true
            })
        );

        require(recipient.attempted(), "recipient did not attempt reentry");
        require(!recipient.reentrySucceeded(), "router reentry succeeded");
        require(address(fixture.router).balance == 0, "reentry stranded ETH");
    }

    function testHookRejectsReentryAcrossDestinationPotWithdrawal() external {
        ReentrantMockWETH weth = new ReentrantMockWETH();
        ReentrantPotDestination destination = new ReentrantPotDestination();
        Fixture memory fixture =
            _deployFixtureWith(weth, address(destination), address(0xB0B), address(0xC0FFEE));
        destination.setHook(fixture.hook);
        CanonicalTrader trader = _fundTrader(fixture, 10 ether);
        trader.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 10 ether,
                amountOutMinimum: 0,
                recipient: address(trader),
                deadline: block.timestamp,
                useNative: false
            })
        );
        uint256 pot = fixture.hook.rewardPot();
        weth.setCallbackRecipient(address(destination));

        destination.pullReward(pot - 1);

        require(destination.attempted(), "destination did not attempt reentry");
        require(!destination.reentrySucceeded(), "hook pot reentry succeeded");
        require(fixture.hook.rewardPot() == 1, "outer pot withdrawal failed");
    }

    function testFuelCoreRejectsDiscoveryAdapterReentry() external {
        ReentrantDiscoveryAdapter adapter = new ReentrantDiscoveryAdapter();
        FuelCore core = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            adapter,
            address(0xBEEF),
            new CanonicalRecoveryHarness()
        );
        adapter.setCore(core);
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.launch();
        CanonicalTrader holder = new CanonicalTrader();

        require(core.transfer(address(holder), 1 ether), "outer transfer failed");

        require(adapter.attempted(), "adapter did not attempt reentry");
        require(!adapter.reentrySucceeded(), "FuelCore reentry succeeded");
        require(core.balanceOf(address(holder)) == 1 ether, "outer transfer state changed");
    }

    function _assertFractionalBuyBoundary(uint256 discoveryMutations, bool shouldSucceed) private {
        Fixture memory fixture = _deployFixture();
        uint256 fuelOutput = discoveryMutations * 1 ether - FRACTIONAL_FUEL_BALANCE;
        (uint256 quotedWethInput,) = fixture.router.quoteExactOutput(false, fuelOutput);
        CanonicalTrader trader = _fundTrader(fixture, quotedWethInput);
        require(
            fixture.fuel.transfer(address(trader), FRACTIONAL_FUEL_BALANCE),
            "fractional buyer funding failed"
        );

        uint256 wethBefore = fixture.weth.balanceOf(address(trader));
        CanonicalRouter.ExactOutputParams memory params = CanonicalRouter.ExactOutputParams({
            fuelForWeth: false,
            amountOut: fuelOutput,
            amountInMaximum: quotedWethInput,
            recipient: address(trader),
            deadline: block.timestamp,
            useNative: false
        });
        (bool succeeded, bytes memory result) = address(trader)
            .call(abi.encodeCall(CanonicalTrader.exactOutput, (fixture.router, params)));

        if (!shouldSucceed) {
            require(!succeeded, "over-limit fractional buy succeeded");
            _assertDiscoveryMutationLimit(result, address(fixture.fuel), discoveryMutations);
            require(
                fixture.fuel.balanceOf(address(trader)) == FRACTIONAL_FUEL_BALANCE,
                "failed fractional buy changed FUEL"
            );
            require(
                fixture.weth.balanceOf(address(trader)) == wethBefore,
                "failed fractional buy spent WETH"
            );
            require(
                fixture.fuel.transientCount(address(trader)) == 0,
                "failed fractional buy materialized identities"
            );
            return;
        }

        require(succeeded, "in-limit fractional buy failed");
        require(abi.decode(result, (uint256)) == quotedWethInput, "buy input disagreed with quote");
        require(
            fixture.fuel.balanceOf(address(trader)) == FRACTIONAL_FUEL_BALANCE + fuelOutput,
            "fractional buy delivered wrong FUEL"
        );
        require(
            fixture.fuel.transientCount(address(trader)) == discoveryMutations,
            "fractional buy materialized the wrong identity count"
        );
    }

    function _assertFractionalSellBoundary(uint256 discoveryMutations, bool shouldSucceed) private {
        Fixture memory fixture = _deployFixture();
        _seedCanonicalWethSide(fixture);
        CanonicalTrader seller = new CanonicalTrader();
        require(
            fixture.fuel.transfer(address(seller), MAX_DISCOVERY_MUTATIONS * 1 ether),
            "seller whole-unit funding failed"
        );
        require(
            fixture.fuel.transfer(address(seller), 1.25 ether), "seller fractional funding failed"
        );
        seller.approveToken(address(fixture.fuel), address(fixture.router));

        uint256 fuelInput = discoveryMutations * 1 ether + FRACTIONAL_FUEL_BALANCE;
        (uint256 quotedWethOutput,) = fixture.router.quoteExactInput(true, fuelInput);
        uint256 wethBefore = fixture.weth.balanceOf(address(seller));
        CanonicalRouter.ExactInputParams memory params = CanonicalRouter.ExactInputParams({
            fuelForWeth: true,
            amountIn: fuelInput,
            amountOutMinimum: quotedWethOutput,
            recipient: address(seller),
            deadline: block.timestamp,
            useNative: false
        });
        (bool succeeded, bytes memory result) = address(seller)
            .call(abi.encodeCall(CanonicalTrader.exactInput, (fixture.router, params)));

        if (!shouldSucceed) {
            require(!succeeded, "over-limit fractional sell succeeded");
            _assertDiscoveryMutationLimit(result, address(fixture.fuel), discoveryMutations);
            require(
                fixture.fuel.balanceOf(address(seller)) == SELLER_STARTING_BALANCE,
                "failed fractional sell changed FUEL"
            );
            require(
                fixture.weth.balanceOf(address(seller)) == wethBefore,
                "failed fractional sell delivered WETH"
            );
            require(
                fixture.fuel.transientCount(address(seller)) == discoveryMutations,
                "failed fractional sell dissolved identities"
            );
            return;
        }

        require(succeeded, "in-limit fractional sell failed");
        require(
            abi.decode(result, (uint256)) == quotedWethOutput, "sell output disagreed with quote"
        );
        require(
            fixture.fuel.balanceOf(address(seller)) == SELLER_STARTING_BALANCE - fuelInput,
            "fractional sell retained wrong FUEL"
        );
        require(
            fixture.fuel.transientCount(address(seller))
                == MAX_DISCOVERY_MUTATIONS + 1 - discoveryMutations,
            "fractional sell dissolved the wrong identity count"
        );
    }

    function _seedCanonicalWethSide(Fixture memory fixture) private {
        CanonicalTrader buyer = _fundTrader(fixture, 100 ether);
        buyer.exactInput(
            fixture.router,
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: 100 ether,
                amountOutMinimum: 0,
                recipient: address(this),
                deadline: block.timestamp,
                useNative: false
            })
        );
    }

    function decodeWrappedError(bytes calldata reason)
        external
        pure
        returns (address target, bytes4 selector, bytes memory nestedReason, bytes memory details)
    {
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }

    function _assertDiscoveryMutationLimit(
        bytes memory reason,
        address expectedFuel,
        uint256 expectedRequested
    ) private view {
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }
        if (selector == CustomRevert.WrappedError.selector) {
            address target;
            bytes4 callSelector;
            bytes memory nestedReason;
            bytes memory details;
            (target, callSelector, nestedReason, details) = this.decodeWrappedError(reason);
            require(target == expectedFuel, "wrong wrapped-error target");
            require(callSelector == IERC20Minimal.transfer.selector, "wrong wrapped call selector");
            require(details.length == 4, "wrong wrapped-error details");
            reason = nestedReason;
        }

        require(reason.length == 68, "wrong discovery-limit revert length");
        uint256 requested;
        uint256 maximum;
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
            requested := mload(add(reason, 0x24))
            maximum := mload(add(reason, 0x44))
        }
        require(selector == FuelCore.DiscoveryMutationLimitExceeded.selector, "wrong error");
        require(requested == expectedRequested, "wrong requested discovery mutations");
        require(maximum == MAX_DISCOVERY_MUTATIONS, "wrong maximum discovery mutations");
    }

    function _deployFixture() private returns (Fixture memory fixture) {
        return
            _deployFixtureWith(new MockWETH(), address(0xA11CE), address(0xB0B), address(0xC0FFEE));
    }

    function _deployFixtureWith(
        MockWETH weth_,
        address rewardDestination,
        address liquidityDestination,
        address creatorDestination
    ) private returns (Fixture memory fixture) {
        fixture.manager = new PoolManager(address(this));
        fixture.weth = weth_;
        fixture.fuel = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(0xBEEF),
            new CanonicalRecoveryHarness()
        );
        fixture.registry = new CanonicalMarketRegistry(
            fixture.manager, address(fixture.fuel), address(fixture.weth), address(this)
        );
        CanonicalHookDeployer deployer = new CanonicalHookDeployer();
        fixture.hook = _deployMinedHook(
            deployer,
            fixture.manager,
            fixture.registry,
            address(fixture.weth),
            rewardDestination,
            liquidityDestination,
            creatorDestination
        );
        fixture.router =
            new CanonicalRouter(fixture.manager, fixture.registry, address(fixture.weth));

        (Currency currency0, Currency currency1) = address(fixture.fuel) < address(fixture.weth)
            ? (Currency.wrap(address(fixture.fuel)), Currency.wrap(address(fixture.weth)))
            : (Currency.wrap(address(fixture.weth)), Currency.wrap(address(fixture.fuel)));
        fixture.key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(fixture.hook))
        });
        fixture.registry.registerPool(fixture.key, address(fixture.router));
        fixture.hook.configureInitializer(address(this));
        fixture.registry.seal();
        fixture.fuel.setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(fixture.registry)));
        fixture.fuel.setDiscoveryExempt(address(fixture.manager), true);

        fixture.manager.initialize(fixture.key, TickMath.getSqrtPriceAtTick(0));
        fixture.rogueKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        fixture.manager.initialize(fixture.rogueKey, TickMath.getSqrtPriceAtTick(0));
        CanonicalLiquiditySeeder seeder = new CanonicalLiquiditySeeder(fixture.manager);
        require(fixture.fuel.approve(address(seeder), type(uint256).max), "FUEL approval failed");
        VM.deal(address(this), 2_000 ether);
        fixture.weth.deposit{value: 1_500 ether}();
        bool fuelIsCurrency0 = Currency.unwrap(currency0) == address(fixture.fuel);
        int24 tickLower = fuelIsCurrency0 ? int24(0) : int24(-120);
        int24 tickUpper = fuelIsCurrency0 ? int24(120) : int24(0);
        seeder.seed(fixture.key, 100_000 ether, address(this), tickLower, tickUpper);
        seeder.seed(fixture.rogueKey, 10_000 ether, address(this), tickLower, tickUpper);
        require(
            fixture.weth.balanceOf(address(fixture.manager)) == 0,
            "genesis liquidity unexpectedly seeded WETH"
        );
        fixture.fuel.launch();
    }

    function _fundTrader(Fixture memory fixture, uint256 amount)
        private
        returns (CanonicalTrader trader)
    {
        trader = new CanonicalTrader();
        require(fixture.weth.transfer(address(trader), amount), "trader funding failed");
        trader.approveToken(address(fixture.weth), address(fixture.router));
    }

    function _totalPot(CanonicalFeeHook hook) private view returns (uint256) {
        return hook.rewardPot() + hook.liquidityPot() + hook.creatorPot();
    }
}
