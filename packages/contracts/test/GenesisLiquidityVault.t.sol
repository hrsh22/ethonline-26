// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {GenesisLiquidityVault} from "../src/liquidity/GenesisLiquidityVault.sol";
import {CanonicalFeeHook} from "../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {CanonicalHookMining} from "./helpers/CanonicalHookMining.sol";

interface GenesisLiquidityVm {
    function deal(address account, uint256 newBalance) external;

    function etch(address target, bytes calldata code) external;

    function prank(address sender) external;

    function warp(uint256 timestamp) external;
}

contract GenesisRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract GenesisTokenHarness {
    uint256 public totalSupply;
    uint16 public permanentCount;
    uint16 public availableIdentityCount;
    uint16 public totalTransientCount;
    uint256 public totalPendingDiscoveryCount;
    bool public launched;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => bool exempt) public isDiscoveryExempt;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function configureGenesis(address holder, address manager) external {
        require(totalSupply == 0, "already configured");
        totalSupply = 4_444 ether;
        availableIdentityCount = 4_444;
        balanceOf[holder] = totalSupply;
        isDiscoveryExempt[holder] = true;
        isDiscoveryExempt[manager] = true;
    }

    function setDiscoveryExempt(address account, bool exempt) external {
        isDiscoveryExempt[account] = exempt;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 balance = balanceOf[msg.sender];
        require(balance >= amount, "insufficient balance");
        balanceOf[msg.sender] = balance - amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        uint256 balance = balanceOf[from];
        require(balance >= amount, "insufficient balance");
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract GenesisRegistryHarness is ICanonicalMarketRegistry {
    IPoolManager public immutable manager;
    address public immutable fuel;
    address public immutable weth;
    PoolKey private _key;

    constructor(IPoolManager manager_, address fuel_, address weth_) {
        manager = manager_;
        fuel = fuel_;
        weth = weth_;
        (Currency currency0, Currency currency1) = fuel_ < weth_
            ? (Currency.wrap(fuel_), Currency.wrap(weth_))
            : (Currency.wrap(weth_), Currency.wrap(fuel_));
        _key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function router() external pure returns (address) {
        return address(1);
    }

    function hook() external pure returns (address) {
        return address(0);
    }

    function isSealed() external pure returns (bool) {
        return true;
    }

    function poolId() external view returns (PoolId) {
        return _key.toId();
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    function isRegisteredPool(PoolKey calldata key) external view returns (bool) {
        return PoolId.unwrap(key.toId()) == PoolId.unwrap(_key.toId());
    }

    function isAuthorizedFuelSettlement(address, address, address) external pure returns (bool) {
        return false;
    }
}

contract GenesisLiquidityVaultTest is CanonicalHookMining {
    using StateLibrary for IPoolManager;

    GenesisLiquidityVm private constant VM =
        GenesisLiquidityVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Fixture {
        PoolManager manager;
        MockWETH weth;
        FuelCore liquidToken;
        CanonicalMarketRegistry registry;
        CanonicalRouter router;
        PoolKey key;
    }

    receive() external payable {}

    function testSeedsEntireSupplyAsOneSidedPermanentlyOwnedPosition() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deployPreparedFixture();

        vault.initializeAndSeed(block.timestamp);

        PoolId poolId = fixture.key.toId();
        (uint160 sqrtPriceX96, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(poolId);
        (uint128 positionLiquidity,,) = IPoolManager(address(fixture.manager))
            .getPositionInfo(
                poolId, address(vault), vault.tickLower(), vault.tickUpper(), vault.POSITION_SALT()
            );
        require(vault.seeded(), "vault was not sealed after seeding");
        require(sqrtPriceX96 == vault.openingSqrtPriceX96(), "opening price changed");
        require(currentTick == vault.openingTick(), "opening tick changed");
        require(positionLiquidity == vault.seededLiquidity(), "position liquidity mismatch");
        require(positionLiquidity != 0, "position has no liquidity");
        require(
            fixture.liquidToken.balanceOf(address(fixture.manager))
                == vault.seededLiquidTokenAmount(),
            "PoolManager did not receive seeded Liquid Tokens"
        );
        require(
            fixture.liquidToken.balanceOf(address(vault)) == vault.roundingDust(),
            "vault balance does not equal documented dust"
        );
        require(vault.roundingDust() <= vault.MAX_ROUNDING_DUST(), "rounding dust too large");
        require(fixture.weth.balanceOf(address(vault)) == 0, "vault supplied WETH");
        require(fixture.weth.balanceOf(address(fixture.manager)) == 0, "pool received WETH");
        require(fixture.liquidToken.totalTransientCount() == 0, "genesis materialized identities");
        require(fixture.liquidToken.totalPendingDiscoveryCount() == 0, "genesis queued discovery");
        require(fixture.liquidToken.availableIdentityCount() == 4_444, "available pool changed");
        require(
            fixture.liquidToken.totalSupply() + uint256(fixture.liquidToken.permanentCount())
                    * 1 ether == fixture.liquidToken.MAX_LIQUID_SUPPLY(),
            "economic units changed"
        );
    }

    function testLaunchFreezesExemptionAndNoInterfaceCanRemoveOrWithdrawPosition() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deploySeededFixture();
        PoolId poolId = fixture.key.toId();
        uint128 liquidityBefore = vault.seededLiquidity();

        fixture.liquidToken.launch();

        require(
            !_call(
                address(fixture.liquidToken),
                abi.encodeCall(FuelCore.setDiscoveryExempt, (address(vault), false))
            ),
            "launch did not freeze exemption"
        );
        require(
            !_call(
                address(vault),
                abi.encodeCall(GenesisLiquidityVault.initializeAndSeed, (block.timestamp))
            ),
            "vault seeded twice"
        );
        require(
            !_call(
                address(vault), abi.encodeWithSignature("removeLiquidity(uint128)", liquidityBefore)
            ),
            "position removal interface exists"
        );
        require(
            !_call(
                address(vault),
                abi.encodeWithSignature(
                    "withdraw(address,uint256)", address(fixture.liquidToken), uint256(1)
                )
            ),
            "asset withdrawal interface exists"
        );
        require(
            !_call(
                address(vault),
                abi.encodeWithSignature(
                    "rescue(address,uint256)", address(fixture.liquidToken), uint256(1)
                )
            ),
            "token rescue interface exists"
        );
        require(
            !_call(address(vault), abi.encodeWithSignature("collectFees()")),
            "fee withdrawal interface exists"
        );
        require(
            !_call(
                address(vault),
                abi.encodeWithSignature(
                    "execute(address,bytes)", address(fixture.liquidToken), bytes("")
                )
            ),
            "arbitrary call interface exists"
        );

        require(fixture.liquidToken.launched(), "launch failed");
        require(fixture.liquidToken.isDiscoveryExempt(address(vault)), "vault exemption changed");
        require(
            _positionLiquidity(fixture.manager, poolId, vault) == liquidityBefore,
            "locked liquidity changed"
        );
    }

    function testFirstBoundedWholeUnitBuyUsesOpeningBenchmarkAndMaterializesTransientCollectible()
        external
    {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deploySeededFixture();
        fixture.liquidToken.launch();
        VM.deal(address(this), 1 ether);
        fixture.weth.deposit{value: 1 ether}();
        require(
            fixture.weth.approve(address(fixture.router), type(uint256).max), "WETH approval failed"
        );

        (uint256 maximumWethInput, uint256 feeAmount) =
            fixture.router.quoteExactOutput(false, 1 ether);
        uint256 poolWethInput = maximumWethInput - feeAmount;
        uint256 actualWethInput = fixture.router
            .swapExactOutput(
                CanonicalRouter.ExactOutputParams({
                    fuelForWeth: false,
                    amountOut: 1 ether,
                    amountInMaximum: maximumWethInput,
                    recipient: address(this),
                    deadline: block.timestamp,
                    useNative: false
                })
            );

        (, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.key.toId());
        require(actualWethInput == maximumWethInput, "bounded buy exceeded quote");
        require(
            poolWethInput >= 0.0057 ether && poolWethInput <= 0.0058 ether,
            "first buy missed opening benchmark"
        );
        require(
            fixture.liquidToken.balanceOf(address(this)) == 1 ether,
            "whole Liquid Token not delivered"
        );
        require(
            fixture.liquidToken.transientCount(address(this)) == 1, "Transient Collectible missing"
        );
        require(
            fixture.liquidToken.collectibleBalanceOf(address(this)) == 1, "mirror balance missing"
        );
        require(
            fixture.liquidToken.availableIdentityCount() == 4_443, "identity pool was not drawn"
        );
        if (vault.liquidTokenIsCurrency0()) {
            require(currentTick > vault.openingTick(), "buy moved direct price down");
        } else {
            require(currentTick < vault.openingTick(), "buy moved inverse price up");
        }
    }

    function testGenesisCurveTypeScriptVectorsMatchLocalV4SwapSimulation() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deploySeededFixture();
        fixture.liquidToken.launch();

        (uint256 oneLiquidTokenWethInput, uint256 oneLiquidTokenFee) =
            fixture.router.quoteExactOutput(false, 1 ether);
        require(
            oneLiquidTokenWethInput == 5_922_137_909_661_698, "exact-output WETH vector changed"
        );
        require(oneLiquidTokenFee == 177_664_137_289_850, "exact-output fee vector changed");

        (uint256 oneWethLiquidTokenOutput, uint256 oneWethFee) =
            fixture.router.quoteExactInput(false, 1 ether);
        require(
            oneWethLiquidTokenOutput == 162_712_010_965_735_327_875,
            "exact-input Liquid Token vector changed"
        );
        require(oneWethFee == 30_000_000_000_000_000, "exact-input fee vector changed");

        VM.deal(address(this), 1 ether);
        fixture.weth.deposit{value: 1 ether}();
        require(
            fixture.weth.approve(address(fixture.router), type(uint256).max), "WETH approval failed"
        );
        fixture.router
            .swapExactOutput(
                CanonicalRouter.ExactOutputParams({
                    fuelForWeth: false,
                    amountOut: 1 ether,
                    amountInMaximum: oneLiquidTokenWethInput,
                    recipient: address(this),
                    deadline: block.timestamp,
                    useNative: false
                })
            );

        (uint160 endSqrtPriceX96,,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.key.toId());
        uint160 expectedEndSqrtPriceX96 = vault.liquidTokenIsCurrency0()
            ? 6_005_560_932_877_008_688_726_663_638
            : 1_045_214_894_252_948_397_192_189_665_927;
        require(endSqrtPriceX96 == expectedEndSqrtPriceX96, "post-buy sqrt-price vector changed");
    }

    function testTranslatesOpeningPriceAndOneSidedTicksUnderEitherCurrencyOrdering() external {
        PoolManager manager = new PoolManager(address(this));
        address lowerToken = address(0x1000);
        address middleToken = address(0x2000);
        address upperToken = address(0x3000);
        VM.etch(lowerToken, hex"00");
        VM.etch(middleToken, hex"00");
        VM.etch(upperToken, hex"00");

        GenesisLiquidityVault liquidTokenFirst = new GenesisLiquidityVault(
            new GenesisRegistryHarness(manager, lowerToken, middleToken), address(this)
        );
        GenesisLiquidityVault wethFirst = new GenesisLiquidityVault(
            new GenesisRegistryHarness(manager, upperToken, middleToken), address(this)
        );

        require(
            liquidTokenFirst.liquidTokenIsCurrency0(),
            "lower-address Liquid Token was not currency0"
        );
        require(liquidTokenFirst.openingTick() == -51_600, "direct opening tick was not inverted");
        require(
            liquidTokenFirst.tickLower() == -51_600,
            "direct Liquid Token range did not start at price"
        );
        require(
            liquidTokenFirst.tickUpper() == TickMath.maxUsableTick(60),
            "direct Liquid Token range used wrong upper bound"
        );
        require(
            !wethFirst.liquidTokenIsCurrency0(), "higher-address Liquid Token was not currency1"
        );
        require(wethFirst.openingTick() == 51_600, "inverse opening tick changed");
        require(
            wethFirst.tickLower() == TickMath.minUsableTick(60),
            "inverse Liquid Token range used wrong lower bound"
        );
        require(wethFirst.tickUpper() == 51_600, "inverse Liquid Token range did not end at price");
        require(
            liquidTokenFirst.openingSqrtPriceX96() == TickMath.getSqrtPriceAtTick(-51_600),
            "direct opening price mismatch"
        );
        require(
            wethFirst.openingSqrtPriceX96() == TickMath.getSqrtPriceAtTick(51_600),
            "inverse opening price mismatch"
        );
        require(liquidTokenFirst.targetLiquidity() != 0, "direct orientation has no liquidity");
        require(wethFirst.targetLiquidity() != 0, "inverse orientation has no liquidity");
    }

    function testSeedsOnlyLiquidTokenUnderEitherCurrencyOrdering() external {
        GenesisTokenHarness template = new GenesisTokenHarness();
        bytes memory tokenCode = address(template).code;
        address liquidTokenFirstAddress = address(0x1000);
        address wethAfterAddress = address(0x2000);
        address wethFirstAddress = address(0x3000);
        address liquidTokenAfterAddress = address(0x4000);
        VM.etch(liquidTokenFirstAddress, tokenCode);
        VM.etch(wethAfterAddress, tokenCode);
        VM.etch(wethFirstAddress, tokenCode);
        VM.etch(liquidTokenAfterAddress, tokenCode);

        _seedOrderedPair(liquidTokenFirstAddress, wethAfterAddress, true);
        _seedOrderedPair(liquidTokenAfterAddress, wethFirstAddress, false);
    }

    function testExposesFailClosedPreflightAndImmediatePostconditionValidation() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deployPreparedFixture();

        vault.validatePreflight();
        vault.initializeAndSeed(block.timestamp);
        vault.validateSeededPostconditions();

        require(vault.seeded(), "validated vault was not seeded");
        require(
            fixture.liquidToken.totalSupply() + uint256(fixture.liquidToken.permanentCount())
                    * 1 ether == vault.GENESIS_SUPPLY(),
            "validated economic units changed"
        );
    }

    function testPreflightRejectsMissingExemptionAndIncompleteFunding() external {
        Fixture memory fixture = _deployFixture();
        GenesisLiquidityVault vault = new GenesisLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.registry)), address(this)
        );
        fixture.liquidToken.setDiscoveryExempt(address(fixture.manager), true);
        require(
            _revertSelector(
                address(vault), abi.encodeCall(GenesisLiquidityVault.validatePreflight, ())
            ) == GenesisLiquidityVault.NotExempt.selector,
            "missing vault exemption was not rejected"
        );

        fixture.liquidToken.setDiscoveryExempt(address(vault), true);
        require(
            fixture.liquidToken
            .approve(address(vault), fixture.liquidToken.MAX_LIQUID_SUPPLY() - 1),
            "partial vault approval failed"
        );
        require(
            _revertSelector(
                address(vault), abi.encodeCall(GenesisLiquidityVault.validatePreflight, ())
            ) == GenesisLiquidityVault.GenesisAllowanceInsufficient.selector,
            "partial genesis allowance was not rejected"
        );

        require(
            fixture.liquidToken.approve(address(vault), fixture.liquidToken.MAX_LIQUID_SUPPLY()),
            "full vault approval failed"
        );
    }

    function testRejectsWrongOperatorExpiredSeedAndDirectCallback() external {
        (, GenesisLiquidityVault vault) = _deployPreparedFixture();

        VM.prank(address(0xBAD));
        require(
            _revertSelector(
                address(vault),
                abi.encodeCall(GenesisLiquidityVault.initializeAndSeed, (type(uint256).max))
            ) == GenesisLiquidityVault.NotOperator.selector,
            "wrong operator seeded vault"
        );
        VM.warp(100);
        require(
            _revertSelector(
                address(vault), abi.encodeCall(GenesisLiquidityVault.initializeAndSeed, (99))
            ) == GenesisLiquidityVault.DeadlineExpired.selector,
            "expired genesis seed succeeded"
        );
        require(
            _revertSelector(
                address(vault), abi.encodeCall(GenesisLiquidityVault.unlockCallback, (bytes("")))
            ) == GenesisLiquidityVault.CallbackNotPoolManager.selector,
            "direct unlock callback succeeded"
        );
    }

    function testHostilePoolInitializationCannotStrandGenesisSupply() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deployPreparedFixture();
        fixture.manager.initialize(fixture.key, TickMath.getSqrtPriceAtTick(0));

        require(
            _revertSelector(
                address(vault),
                abi.encodeCall(GenesisLiquidityVault.initializeAndSeed, (type(uint256).max))
            ) == GenesisLiquidityVault.PoolAlreadyInitialized.selector,
            "hostile initialization was not detected before funding"
        );
        require(
            fixture.liquidToken.balanceOf(address(this)) == fixture.liquidToken.MAX_LIQUID_SUPPLY(),
            "hostile initialization moved the genesis supply"
        );
        require(
            fixture.liquidToken.balanceOf(address(vault)) == 0,
            "hostile initialization stranded Liquid Tokens"
        );
    }

    function testPreLaunchSwapCannotMovePriceOrStrandLiquidTokensInExemptVault() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deploySeededFixture();
        VM.deal(address(this), 1 ether);
        fixture.weth.deposit{value: 1 ether}();
        require(
            fixture.weth.approve(address(fixture.router), type(uint256).max), "WETH approval failed"
        );

        require(
            !_call(
                address(fixture.router),
                abi.encodeCall(
                    CanonicalRouter.swapExactOutput,
                    (CanonicalRouter.ExactOutputParams({
                            fuelForWeth: false,
                            amountOut: 1 ether,
                            amountInMaximum: 1 ether,
                            recipient: address(vault),
                            deadline: type(uint256).max,
                            useNative: false
                        }))
                )
            ),
            "pre-launch swap reached an exempt recipient"
        );
        (uint160 sqrtPriceX96, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.key.toId());
        require(sqrtPriceX96 == vault.openingSqrtPriceX96(), "pre-launch price moved");
        require(currentTick == vault.openingTick(), "pre-launch tick moved");
        require(
            fixture.liquidToken.balanceOf(address(vault)) == vault.roundingDust(),
            "pre-launch swap stranded Liquid Tokens"
        );
    }

    function testDonatedWethCannotBlockSeedingOrPostconditionValidation() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deployPreparedFixture();
        VM.deal(address(this), 2);
        fixture.weth.deposit{value: 2}();
        require(fixture.weth.transfer(address(vault), 1), "pre-seed WETH donation failed");

        vault.initializeAndSeed(block.timestamp);
        require(fixture.weth.transfer(address(vault), 1), "post-seed WETH donation failed");
        vault.validateSeededPostconditions();

        require(fixture.weth.balanceOf(address(vault)) == 2, "WETH donations moved");
        require(fixture.weth.balanceOf(address(fixture.manager)) == 0, "position used WETH");
    }

    function testPostconditionValidationIgnoresUnrelatedSingletonManagerWethBalance() external {
        (Fixture memory fixture, GenesisLiquidityVault vault) = _deploySeededFixture();
        VM.deal(address(this), 1);
        fixture.weth.deposit{value: 1}();
        require(fixture.weth.transfer(address(fixture.manager), 1), "manager WETH mutation failed");

        vault.validateSeededPostconditions();
    }

    function _deployFixture() private returns (Fixture memory fixture) {
        fixture.manager = new PoolManager(address(this));
        fixture.weth = new MockWETH();
        fixture.liquidToken = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(0xBEEF),
            new GenesisRecoveryHarness()
        );
        fixture.registry = new CanonicalMarketRegistry(
            fixture.manager, address(fixture.liquidToken), address(fixture.weth), address(this)
        );
        CanonicalFeeHook hook = _deployMinedHook(
            new CanonicalHookDeployer(),
            fixture.manager,
            fixture.registry,
            address(fixture.weth),
            address(0xA11CE),
            address(0xB0B),
            address(0xC0FFEE)
        );
        fixture.router =
            new CanonicalRouter(fixture.manager, fixture.registry, address(fixture.weth));

        (Currency currency0, Currency currency1) = address(fixture.liquidToken)
            < address(fixture.weth)
            ? (Currency.wrap(address(fixture.liquidToken)), Currency.wrap(address(fixture.weth)))
            : (Currency.wrap(address(fixture.weth)), Currency.wrap(address(fixture.liquidToken)));
        fixture.key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        fixture.registry.registerPool(fixture.key, address(fixture.router));
        fixture.registry.seal();
        fixture.liquidToken
            .setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(fixture.registry)));
    }

    function _deploySeededFixture()
        private
        returns (Fixture memory fixture, GenesisLiquidityVault vault)
    {
        (fixture, vault) = _deployPreparedFixture();
        vault.initializeAndSeed(block.timestamp);
        fixture.liquidToken.setDiscoveryExempt(address(this), false);
    }

    function _deployPreparedFixture()
        private
        returns (Fixture memory fixture, GenesisLiquidityVault vault)
    {
        fixture = _deployFixture();
        vault = new GenesisLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.registry)), address(this)
        );
        fixture.liquidToken.setDiscoveryExempt(address(fixture.manager), true);
        fixture.liquidToken.setDiscoveryExempt(address(vault), true);
        require(
            fixture.liquidToken.approve(address(vault), fixture.liquidToken.MAX_LIQUID_SUPPLY()),
            "vault approval failed"
        );
    }

    function _call(address target, bytes memory data) private returns (bool success) {
        (success,) = target.call(data);
    }

    function _revertSelector(address target, bytes memory data) private returns (bytes4 selector) {
        (bool success, bytes memory reason) = target.call(data);
        require(!success && reason.length >= 4, "expected custom-error revert");
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }
    }

    function _positionLiquidity(PoolManager manager, PoolId poolId, GenesisLiquidityVault vault)
        private
        view
        returns (uint128 liquidity)
    {
        (liquidity,,) = IPoolManager(address(manager))
            .getPositionInfo(
                poolId, address(vault), vault.tickLower(), vault.tickUpper(), vault.POSITION_SALT()
            );
    }

    function _seedOrderedPair(
        address liquidTokenAddress,
        address wethAddress,
        bool expectLiquidTokenFirst
    ) private {
        PoolManager manager = new PoolManager(address(this));
        GenesisLiquidityVault vault = new GenesisLiquidityVault(
            new GenesisRegistryHarness(manager, liquidTokenAddress, wethAddress), address(this)
        );
        GenesisTokenHarness liquidTokenHarness = GenesisTokenHarness(liquidTokenAddress);
        GenesisTokenHarness wethHarness = GenesisTokenHarness(wethAddress);
        liquidTokenHarness.configureGenesis(address(this), address(manager));
        liquidTokenHarness.setDiscoveryExempt(address(vault), true);
        require(
            liquidTokenHarness.approve(address(vault), vault.GENESIS_SUPPLY()),
            "ordered vault approval failed"
        );

        vault.initializeAndSeed(block.timestamp);

        require(
            vault.liquidTokenIsCurrency0() == expectLiquidTokenFirst, "unexpected token ordering"
        );
        require(
            liquidTokenHarness.balanceOf(address(manager)) == vault.seededLiquidTokenAmount(),
            "ordered pool did not receive Liquid Tokens"
        );
        require(wethHarness.balanceOf(address(manager)) == 0, "ordered pool received WETH");
        require(
            liquidTokenHarness.balanceOf(address(vault)) == vault.roundingDust(),
            "ordered vault dust mismatch"
        );
        require(vault.roundingDust() <= vault.MAX_ROUNDING_DUST(), "ordered dust too large");
        require(
            _positionLiquidity(manager, vault.registry().poolId(), vault)
                == vault.seededLiquidity(),
            "ordered position liquidity mismatch"
        );
    }
}
