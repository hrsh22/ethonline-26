// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {
    BaseSepoliaTestVenueConfiguration as Config
} from "../src/deployment/BaseSepoliaTestVenueConfiguration.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockUSDC} from "../src/test-assets/MockUSDC.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {TestConversionVenue} from "../src/test-assets/TestConversionVenue.sol";

interface ConversionVenueVm {
    function deal(address account, uint256 newBalance) external;
}

contract TestConversionVenueTest {
    using StateLibrary for IPoolManager;

    struct FivePoolFixture {
        PoolManager manager;
        TestConversionVenue venue;
        MockWETH weth;
        MockUSDC usdc;
        MockStock[4] stocks;
    }

    ConversionVenueVm internal constant VM =
        ConversionVenueVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testInitializesAndVerifiesArtificialWethUsdcPool() external {
        PoolManager manager = new PoolManager(address(this));
        TestConversionVenue venue = new TestConversionVenue(manager, address(this));
        MockWETH weth = new MockWETH();
        MockUSDC usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        VM.deal(address(this), 250 ether);
        weth.deposit{value: 200 ether}();
        require(weth.approve(address(venue), type(uint256).max), "WETH approval failed");
        require(usdc.approve(address(venue), type(uint256).max), "USDC approval failed");

        uint128 seededLiquidity = 1_000_000_000_000_000;
        PoolId initializedId =
            venue.initializeWethUsdcPool(address(weth), address(usdc), seededLiquidity);
        PoolKey memory key = venue.poolKey(address(weth), address(usdc));
        (
            PoolId configuredId,
            PoolKey memory configuredKey,
            uint160 verifiedSeedPrice,
            uint128 verifiedSeedLiquidity
        ) = venue.verifiedPoolConfiguration(address(weth), address(usdc));
        IPoolManager poolManager = IPoolManager(address(manager));

        address expectedCurrency0 = address(weth) < address(usdc) ? address(weth) : address(usdc);
        address expectedCurrency1 = address(weth) < address(usdc) ? address(usdc) : address(weth);
        int24 expectedTick = address(weth) == expectedCurrency0 ? int24(-230_280) : int24(230_280);
        (uint160 sqrtPriceX96, int24 actualTick,, uint24 lpFee) =
            poolManager.getSlot0(initializedId);

        require(Currency.unwrap(key.currency0) == expectedCurrency0, "currency0 is not sorted");
        require(Currency.unwrap(key.currency1) == expectedCurrency1, "currency1 is not sorted");
        require(PoolId.unwrap(key.toId()) == PoolId.unwrap(initializedId), "pool ID mismatch");
        require(PoolId.unwrap(configuredId) == PoolId.unwrap(initializedId), "wrong verified ID");
        require(
            PoolId.unwrap(configuredKey.toId()) == PoolId.unwrap(initializedId),
            "wrong verified key"
        );
        require(key.fee == 4_444, "wrong test LP fee");
        require(key.tickSpacing == 11, "wrong tick spacing");
        require(address(key.hooks) == address(0), "unexpected hooks");
        require(sqrtPriceX96 == TickMath.getSqrtPriceAtTick(expectedTick), "wrong initial price");
        require(verifiedSeedPrice == sqrtPriceX96, "wrong verified seed price");
        require(actualTick == expectedTick, "wrong initial tick");
        require(lpFee == 4_444, "wrong active LP fee");
        require(
            poolManager.getLiquidity(initializedId) == seededLiquidity, "liquidity is not active"
        );
        require(verifiedSeedLiquidity == seededLiquidity, "wrong verified seed liquidity");
    }

    function testUsesDedicatedTestKeyWhenExistingPublicWethUsdcPoolAlreadyExists() external {
        PoolManager manager = new PoolManager(address(this));
        TestConversionVenue venue = new TestConversionVenue(manager, address(this));
        MockWETH weth = new MockWETH();
        MockUSDC usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        VM.deal(address(this), 250 ether);
        weth.deposit{value: 200 ether}();
        require(weth.approve(address(venue), type(uint256).max), "WETH approval failed");
        require(usdc.approve(address(venue), type(uint256).max), "USDC approval failed");

        (Currency currency0, Currency currency1) = address(weth) < address(usdc)
            ? (Currency.wrap(address(weth)), Currency.wrap(address(usdc)))
            : (Currency.wrap(address(usdc)), Currency.wrap(address(weth)));
        PoolKey memory existingPublicKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(existingPublicKey, TickMath.getSqrtPriceAtTick(0));

        PoolId testPoolId =
            venue.initializeWethUsdcPool(address(weth), address(usdc), 1_000_000_000_000_000);
        PoolKey memory testKey = venue.poolKey(address(weth), address(usdc));
        require(testKey.fee == 4_444, "venue reused existing public LP fee");
        require(testKey.tickSpacing == 11, "venue reused existing public tick spacing");
        require(
            PoolId.unwrap(testPoolId) != PoolId.unwrap(existingPublicKey.toId()),
            "venue reused initialized public pool"
        );
    }

    function testBaseSepoliaLiquiditySupportsTenWethWithoutUnrealisticTestUsdc() external {
        PoolManager manager = new PoolManager(address(this));
        TestConversionVenue venue = new TestConversionVenue(manager, address(this));
        MockWETH weth = new MockWETH();
        MockUSDC usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        VM.deal(address(this), 50 ether);
        weth.deposit{value: 40 ether}();
        require(weth.approve(address(venue), type(uint256).max), "WETH approval failed");
        require(usdc.approve(address(venue), type(uint256).max), "USDC approval failed");
        venue.initializeWethUsdcPool(address(weth), address(usdc), Config.WETH_USDC_SEED_LIQUIDITY);

        uint256 maximumClipUsdc = venue.quoteExactInput(address(weth), address(usdc), 10 ether);
        require(maximumClipUsdc != 0, "10 WETH quote is not executable");
        require(maximumClipUsdc <= 1_100 * 1e6, "10 WETH quote requires unrealistic test USDC");
    }

    function testQuotesDeterministicExactInputsAcrossAllFiveArtificialPools() external {
        FivePoolFixture memory fixture = _deployFivePoolFixture();

        uint256 firstWethQuote =
            fixture.venue.quoteExactInput(address(fixture.weth), address(fixture.usdc), 1 ether);
        uint256 repeatedWethQuote =
            fixture.venue.quoteExactInput(address(fixture.weth), address(fixture.usdc), 1 ether);
        uint256 maximumClipQuote =
            fixture.venue.quoteExactInput(address(fixture.weth), address(fixture.usdc), 10 ether);
        require(firstWethQuote == repeatedWethQuote, "quote mutated pool state");
        require(firstWethQuote > 98 * 1e6, "one WETH quote is artificially too low");
        require(firstWethQuote < 101 * 1e6, "one WETH quote is artificially too high");
        require(maximumClipQuote > 800 * 1e6, "maximum clip lacks executable USDC");
        require(maximumClipQuote < 1_100 * 1e6, "maximum clip requires unrealistic USDC");

        for (uint256 index = 0; index < fixture.stocks.length; ++index) {
            uint256 stockOut = fixture.venue
                .quoteExactInput(address(fixture.usdc), address(fixture.stocks[index]), 1 * 1e6);
            uint256 usdcOut = fixture.venue
                .quoteExactInput(address(fixture.stocks[index]), address(fixture.usdc), 1 ether);
            require(stockOut > 0.98 ether && stockOut < 1.01 ether, "wrong stock quote");
            require(usdcOut > 0.98 * 1e6 && usdcOut < 1.01 * 1e6, "wrong reverse quote");
        }
    }

    function testExecutesQuotedSwapsInBothDirectionsAcrossAllFivePools() external {
        FivePoolFixture memory fixture = _deployFivePoolFixture();

        uint256 quotedUsdc =
            fixture.venue.quoteExactInput(address(fixture.weth), address(fixture.usdc), 1 ether);
        uint256 receivedUsdc = fixture.venue
            .swapExactInput(
                address(fixture.weth), address(fixture.usdc), 1 ether, quotedUsdc, address(this)
            );
        require(receivedUsdc == quotedUsdc, "WETH to USDC execution disagreed with quote");
        uint256 quotedWeth = fixture.venue
        .quoteExactInput(address(fixture.usdc), address(fixture.weth), receivedUsdc);
        uint256 receivedWeth = fixture.venue
            .swapExactInput(
                address(fixture.usdc),
                address(fixture.weth),
                receivedUsdc,
                quotedWeth,
                address(this)
            );
        require(receivedWeth == quotedWeth, "USDC to WETH execution disagreed with quote");
        require(receivedWeth > 0.98 ether && receivedWeth < 1 ether, "wrong WETH round trip");

        for (uint256 index = 0; index < fixture.stocks.length; ++index) {
            uint256 quotedStock = fixture.venue
                .quoteExactInput(address(fixture.usdc), address(fixture.stocks[index]), 10 * 1e6);
            uint256 receivedStock = fixture.venue
                .swapExactInput(
                    address(fixture.usdc),
                    address(fixture.stocks[index]),
                    10 * 1e6,
                    quotedStock,
                    address(this)
                );
            require(receivedStock == quotedStock, "USDC to stock execution disagreed with quote");

            uint256 quotedBack = fixture.venue
                .quoteExactInput(
                    address(fixture.stocks[index]), address(fixture.usdc), receivedStock
                );
            uint256 receivedBack = fixture.venue
                .swapExactInput(
                    address(fixture.stocks[index]),
                    address(fixture.usdc),
                    receivedStock,
                    quotedBack,
                    address(this)
                );
            require(receivedBack == quotedBack, "stock to USDC execution disagreed with quote");
            require(receivedBack > 9.8 * 1e6, "stock round trip lost too much");
            require(receivedBack < 10 * 1e6, "stock round trip created value");
        }
    }

    function testPausedOrRejectedStockFailsOnlyItsOwnRewardDestinationRoute() external {
        PoolManager manager = new PoolManager(address(this));
        TestConversionVenue venue = new TestConversionVenue(manager, address(this));
        MockUSDC usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        MockStock aapl = new MockStock(
            "AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", 1_000_000_000 ether, address(this)
        );
        MockStock googl = new MockStock(
            "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", 1_000_000_000 ether, address(this)
        );
        address rewardDestination = address(0x1ED6E2);
        address alternateRecipient = address(0xA11CE);

        require(usdc.approve(address(venue), type(uint256).max), "USDC approval failed");
        require(aapl.approve(address(venue), type(uint256).max), "AAPL approval failed");
        require(googl.approve(address(venue), type(uint256).max), "GOOGL approval failed");
        venue.initializeUsdcStockPool(address(usdc), address(aapl), 10_000_000_000_000_000);
        venue.initializeUsdcStockPool(address(usdc), address(googl), 10_000_000_000_000_000);

        uint256 usdcBeforeFailure = usdc.balanceOf(address(this));
        aapl.setPaused(true);
        (bool pausedRouteSucceeded,) = address(venue)
            .call(
                abi.encodeCall(
                    TestConversionVenue.swapExactInput,
                    (address(usdc), address(aapl), 1 * 1e6, 0, rewardDestination)
                )
            );
        require(!pausedRouteSucceeded, "paused AAPL route succeeded");
        require(usdc.balanceOf(address(this)) == usdcBeforeFailure, "failed route spent USDC");

        uint256 googlOut =
            venue.swapExactInput(address(usdc), address(googl), 1 * 1e6, 0, rewardDestination);
        require(
            googl.balanceOf(rewardDestination) == googlOut, "healthy GOOGL route did not settle"
        );

        aapl.setPaused(false);
        aapl.setRecipientRejected(rewardDestination, true);
        (bool rejectedRouteSucceeded,) = address(venue)
            .call(
                abi.encodeCall(
                    TestConversionVenue.swapExactInput,
                    (address(usdc), address(aapl), 1 * 1e6, 0, rewardDestination)
                )
            );
        require(!rejectedRouteSucceeded, "rejected reward destination received AAPL");

        uint256 aaplOut =
            venue.swapExactInput(address(usdc), address(aapl), 1 * 1e6, 0, alternateRecipient);
        require(aapl.balanceOf(alternateRecipient) == aaplOut, "AAPL route failed generally");
        uint256 secondGooglOut =
            venue.swapExactInput(address(usdc), address(googl), 1 * 1e6, 0, rewardDestination);
        require(
            googl.balanceOf(rewardDestination) == googlOut + secondGooglOut,
            "rejected AAPL contaminated GOOGL route"
        );
    }

    function _deployFivePoolFixture() private returns (FivePoolFixture memory fixture) {
        fixture.manager = new PoolManager(address(this));
        fixture.venue = new TestConversionVenue(fixture.manager, address(this));
        fixture.weth = new MockWETH();
        fixture.usdc = new MockUSDC(1_000_000_000 * 1e6, address(this));
        fixture.stocks = [
            new MockStock(
                "AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", 1_000_000_000 ether, address(this)
            ),
            new MockStock(
                "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", 1_000_000_000 ether, address(this)
            ),
            new MockStock(
                "METAc MOCK TEST Stock", "MOCK-METAc-TEST", 1_000_000_000 ether, address(this)
            ),
            new MockStock(
                "NVDAc MOCK TEST Stock", "MOCK-NVDAc-TEST", 1_000_000_000 ether, address(this)
            )
        ];

        VM.deal(address(this), 250 ether);
        fixture.weth.deposit{value: 200 ether}();
        require(
            fixture.weth.approve(address(fixture.venue), type(uint256).max), "WETH approval failed"
        );
        require(
            fixture.usdc.approve(address(fixture.venue), type(uint256).max), "USDC approval failed"
        );
        fixture.venue
            .initializeWethUsdcPool(
                address(fixture.weth), address(fixture.usdc), 1_000_000_000_000_000
            );
        for (uint256 index = 0; index < fixture.stocks.length; ++index) {
            require(
                fixture.stocks[index].approve(address(fixture.venue), type(uint256).max),
                "stock approval failed"
            );
            fixture.venue
                .initializeUsdcStockPool(
                    address(fixture.usdc), address(fixture.stocks[index]), 10_000_000_000_000_000
                );
        }
    }
}
