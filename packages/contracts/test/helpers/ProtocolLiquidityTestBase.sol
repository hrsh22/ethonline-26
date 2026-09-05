// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {FuelCore} from "../../src/FuelCore.sol";
import {DeterministicDiscoveryAdapter} from "../../src/discovery/DeterministicDiscoveryAdapter.sol";
import {ICanonicalFeeHook} from "../../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../../src/interfaces/ICanonicalMarketRegistry.sol";
import {IThresholdRecovery} from "../../src/interfaces/IThresholdRecovery.sol";
import {GenesisLiquidityVault} from "../../src/liquidity/GenesisLiquidityVault.sol";
import {ProtocolLiquidityVault} from "../../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalFeeHook} from "../../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../../src/market/CanonicalRouter.sol";
import {MockWETH} from "../../src/test-assets/MockWETH.sol";
import {CanonicalHookMining} from "./CanonicalHookMining.sol";
import {TickSpacingTestHelper} from "./TickSpacingTestHelper.sol";

interface ProtocolLiquidityVm {
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract ProtocolLiquidityRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract ReentrantLiquidityWeth is MockWETH {
    ProtocolLiquidityVault public target;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function setTarget(ProtocolLiquidityVault target_) external {
        require(address(target) == address(0), "target already set");
        target = target_;
    }

    function executeCycle(
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 maximumWeth,
        uint256 deadline
    ) external returns (uint256) {
        return target.addLiquidityCycle(tickLower, tickUpper, liquidity, maximumWeth, deadline);
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        super._transfer(from, to, amount);
        if (to == address(target) && !reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded,) = address(target)
                .call(
                    abi.encodeCall(
                        ProtocolLiquidityVault.addLiquidityCycle,
                        (int24(0), int24(60), uint128(1), uint256(1), type(uint256).max)
                    )
                );
        }
    }
}

abstract contract ProtocolLiquidityTestBase is CanonicalHookMining {
    using StateLibrary for IPoolManager;

    ProtocolLiquidityVm internal constant VM =
        ProtocolLiquidityVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint128 internal constant CYCLE_LIQUIDITY = 1_000_000_000_000_000;

    struct Fixture {
        PoolManager manager;
        MockWETH weth;
        FuelCore fuel;
        CanonicalMarketRegistry registry;
        CanonicalFeeHook hook;
        CanonicalRouter router;
        ProtocolLiquidityVault vault;
        PoolKey key;
    }

    receive() external payable {}

    function _deployUnregisteredFixture(address executor, bool wethIsCurrency0)
        internal
        returns (Fixture memory fixture)
    {
        fixture.manager = new PoolManager(address(this));
        (fixture.weth, fixture.fuel) = _deployOrderedAssets(wethIsCurrency0);
        _bindVault(fixture, executor);
    }

    function _deployUnregisteredFixtureWithWeth(MockWETH weth_, address executor)
        internal
        returns (Fixture memory fixture)
    {
        fixture.manager = new PoolManager(address(this));
        fixture.weth = weth_;
        fixture.fuel = _deployFuel();
        _bindVault(fixture, executor);
    }

    function _registerFixture(Fixture memory fixture)
        internal
        returns (Fixture memory registeredFixture)
    {
        fixture.hook = _deployMinedHook(
            new CanonicalHookDeployer(),
            fixture.manager,
            fixture.registry,
            address(fixture.weth),
            address(0xA11CE),
            address(fixture.vault),
            address(0xC0FFEE)
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
        fixture.registry.seal();
        fixture.fuel.setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(fixture.registry)));
        fixture.vault.configureCanonicalFeeHook(ICanonicalFeeHook(address(fixture.hook)));
        fixture.vault.sealConfiguration();
        registeredFixture = fixture;
    }

    function _launchFixture(Fixture memory fixture)
        internal
        returns (Fixture memory launchedFixture)
    {
        fixture = _registerFixture(fixture);
        GenesisLiquidityVault genesis = new GenesisLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.registry)), address(this)
        );
        fixture.fuel.setDiscoveryExempt(address(fixture.manager), true);
        fixture.fuel.setDiscoveryExempt(address(genesis), true);
        require(
            fixture.fuel.approve(address(genesis), fixture.fuel.MAX_LIQUID_SUPPLY()),
            "genesis approval failed"
        );
        genesis.initializeAndSeed(block.timestamp);
        fixture.fuel.setDiscoveryExempt(address(this), false);
        fixture.fuel.launch();
        launchedFixture = fixture;
    }

    function _deployLaunchedFixture(address executor, bool wethIsCurrency0)
        internal
        returns (Fixture memory fixture)
    {
        fixture = _launchFixture(_deployUnregisteredFixture(executor, wethIsCurrency0));
    }

    function _deployLaunchedFixtureWithWeth(MockWETH weth_, address executor)
        internal
        returns (Fixture memory fixture)
    {
        fixture = _launchFixture(_deployUnregisteredFixtureWithWeth(weth_, executor));
    }

    function _accrueLiquidityPot(Fixture memory fixture, uint256 fuelOutput) internal {
        VM.deal(address(this), address(this).balance + 10 ether);
        fixture.weth.deposit{value: 10 ether}();
        require(
            fixture.weth.approve(address(fixture.router), type(uint256).max),
            "router WETH approval failed"
        );
        fixture.router
            .swapExactOutput(
                CanonicalRouter.ExactOutputParams({
                    fuelForWeth: false,
                    amountOut: fuelOutput,
                    amountInMaximum: 10 ether,
                    recipient: address(this),
                    deadline: block.timestamp,
                    useNative: false
                })
            );
        require(fixture.hook.liquidityPot() != 0, "trade accrued no liquidity pot");
    }

    function _wethOnlyRange(Fixture memory fixture)
        internal
        view
        returns (int24 tickLower, int24 tickUpper)
    {
        (, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.key.toId());
        if (fixture.vault.wethIsCurrency0()) {
            tickLower = TickSpacingTestHelper.ceilToCanonicalSpacing(currentTick);
            tickUpper = tickLower + 600;
        } else {
            tickUpper = TickSpacingTestHelper.floorToCanonicalSpacing(currentTick);
            tickLower = tickUpper - 600;
        }
    }

    function _fuelRequiredRange(Fixture memory fixture)
        internal
        view
        returns (int24 tickLower, int24 tickUpper)
    {
        (, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.key.toId());
        if (fixture.vault.wethIsCurrency0()) {
            tickUpper = TickSpacingTestHelper.floorToCanonicalSpacing(currentTick);
            tickLower = tickUpper - 600;
        } else {
            tickLower = TickSpacingTestHelper.ceilToCanonicalSpacing(currentTick);
            tickUpper = tickLower + 600;
        }
    }

    function _callCycle(
        ProtocolLiquidityVault vault,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 maximumWeth,
        uint256 deadline
    ) internal returns (bool success) {
        (success,) = address(vault)
            .call(
                abi.encodeCall(
                    ProtocolLiquidityVault.addLiquidityCycle,
                    (tickLower, tickUpper, liquidity, maximumWeth, deadline)
                )
            );
    }

    function _call(address target, bytes memory data) internal returns (bool success) {
        (success,) = target.call(data);
    }

    function _revertSelector(address target, bytes memory data) internal returns (bytes4 selector) {
        (bool success, bytes memory reason) = target.call(data);
        require(!success && reason.length >= 4, "expected custom-error revert");
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }
    }

    function _bindVault(Fixture memory fixture, address executor) private {
        fixture.registry = new CanonicalMarketRegistry(
            fixture.manager, address(fixture.fuel), address(fixture.weth), address(this)
        );
        fixture.vault = new ProtocolLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.registry)), address(this), executor
        );
    }

    function _deployOrderedAssets(bool wethIsCurrency0)
        private
        returns (MockWETH weth_, FuelCore fuel_)
    {
        DeterministicDiscoveryAdapter discovery =
            new DeterministicDiscoveryAdapter(bytes32(uint256(100)));
        ProtocolLiquidityRecoveryHarness recovery = new ProtocolLiquidityRecoveryHarness();
        bytes32 fuelSalt = keccak256("protocol-liquidity-fuel");
        bytes32 fuelInitCodeHash = keccak256(
            abi.encodePacked(
                type(FuelCore).creationCode,
                abi.encode(
                    "Test Liquid Token",
                    "TEST",
                    "Test Collectible",
                    "TC",
                    address(this),
                    discovery,
                    address(0xBEEF),
                    recovery
                )
            )
        );
        address predictedFuel = _create2Address(fuelSalt, fuelInitCodeHash);
        bytes32 wethInitCodeHash = keccak256(type(MockWETH).creationCode);
        bytes32 wethSalt;
        address predictedWeth;
        for (uint256 nonce; nonce < type(uint256).max; ++nonce) {
            wethSalt = bytes32(nonce);
            predictedWeth = _create2Address(wethSalt, wethInitCodeHash);
            if ((predictedWeth < predictedFuel) == wethIsCurrency0) break;
        }

        fuel_ = new FuelCore{salt: fuelSalt}(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            discovery,
            address(0xBEEF),
            recovery
        );
        weth_ = new MockWETH{salt: wethSalt}();
        require(address(fuel_) == predictedFuel, "ordered Fuel address mismatch");
        require(address(weth_) == predictedWeth, "ordered WETH address mismatch");
        require(
            (address(weth_) < address(fuel_)) == wethIsCurrency0,
            "requested currency order not produced"
        );
    }

    function _deployFuel() private returns (FuelCore fuel_) {
        fuel_ = new FuelCore(
            "Test Liquid Token",
            "TEST",
            "Test Collectible",
            "TC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(0xBEEF),
            new ProtocolLiquidityRecoveryHarness()
        );
    }

    function _create2Address(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
