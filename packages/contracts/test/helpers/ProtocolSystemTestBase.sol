// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {AttributeRegistry} from "../../src/AttributeRegistry.sol";
import {FuelCore} from "../../src/FuelCore.sol";
import {FuelMirror} from "../../src/FuelMirror.sol";
import {RewardLedger} from "../../src/RewardLedger.sol";
import {ConfigurableClaimGate} from "../../src/claim/ConfigurableClaimGate.sol";
import {
    DeterministicConversionAdapter
} from "../../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../../src/conversion/EpochConverter.sol";
import {DeferredTestDiscoveryAdapter} from "../../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {ICanonicalFeeHook} from "../../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../../src/interfaces/ICanonicalMarketRegistry.sol";
import {IConversionAdapter} from "../../src/interfaces/IConversionAdapter.sol";
import {IRewardLedgerCallbacks} from "../../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../../src/interfaces/IThresholdRecovery.sol";
import {GenesisLiquidityVault} from "../../src/liquidity/GenesisLiquidityVault.sol";
import {ProtocolLiquidityVault} from "../../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalFeeHook} from "../../src/market/CanonicalFeeHook.sol";
import {CanonicalHookDeployer} from "../../src/market/CanonicalHookDeployer.sol";
import {CanonicalMarketRegistry} from "../../src/market/CanonicalMarketRegistry.sol";
import {CanonicalRouter} from "../../src/market/CanonicalRouter.sol";
import {MockStock} from "../../src/test-assets/MockStock.sol";
import {MockWETH} from "../../src/test-assets/MockWETH.sol";
import {CanonicalHookMining} from "./CanonicalHookMining.sol";
import {TickSpacingTestHelper} from "./TickSpacingTestHelper.sol";

contract ProtocolSystemRecoveryAuthority is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function setFrozen(FuelCore core, address account, bool frozen) external {
        core.setFrozen(account, frozen);
    }

    function recoverLiquid(FuelCore core, address from, address to, uint256 amount) external {
        core.recoverLiquid(from, to, amount);
    }

    function recoverCollectible(FuelCore core, address from, address to, uint16 identityId)
        external
    {
        core.recoverCollectible(from, to, identityId);
    }
}

contract ProtocolSystemGuardian {
    function freeze(FuelCore core, address account) external {
        core.guardianFreeze(account);
    }
}

contract ProtocolSystemActor {
    receive() external payable {}

    function approveToken(address token, address spender) external {
        (bool succeeded, bytes memory result) = token.call(
            abi.encodeWithSignature("approve(address,uint256)", spender, type(uint256).max)
        );
        require(succeeded && abi.decode(result, (bool)), "token approval failed");
    }

    function buy(CanonicalRouter router, uint256 wethInput) external returns (uint256 fuelOutput) {
        fuelOutput = router.swapExactInput(
            CanonicalRouter.ExactInputParams({
                fuelForWeth: false,
                amountIn: wethInput,
                amountOutMinimum: 0,
                recipient: address(this),
                deadline: block.timestamp,
                useNative: false
            })
        );
    }

    function sell(CanonicalRouter router, uint256 fuelInput) external returns (uint256 wethOutput) {
        wethOutput = router.swapExactInput(
            CanonicalRouter.ExactInputParams({
                fuelForWeth: true,
                amountIn: fuelInput,
                amountOutMinimum: 0,
                recipient: address(this),
                deadline: block.timestamp,
                useNative: false
            })
        );
    }

    function transferLiquid(FuelCore core, address recipient, uint256 amount) external {
        require(core.transfer(recipient, amount), "liquid transfer failed");
    }

    function approveCollectible(FuelMirror mirror, address operator, uint16 identityId) external {
        mirror.approve(operator, identityId);
    }

    function transferCollectible(FuelMirror mirror, address recipient, uint16 identityId) external {
        mirror.transferFrom(address(this), recipient, identityId);
    }

    function transferCollectibleFrom(
        FuelMirror mirror,
        address owner,
        address recipient,
        uint16 identityId
    ) external {
        mirror.transferFrom(owner, recipient, identityId);
    }

    function commit(FuelCore core, uint16 identityId) external {
        core.commit(identityId);
    }

    function claim(RewardLedger ledger, uint16[] calldata identityIds) external {
        ledger.claim(identityIds);
    }
}

abstract contract ProtocolSystemTestBase is Test, CanonicalHookMining {
    using StateLibrary for IPoolManager;

    bytes32 internal constant MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;
    uint128 internal constant POL_CYCLE_LIQUIDITY = 1_000_000_000_000_000;

    struct ProtocolSystemFixture {
        PoolManager manager;
        MockWETH weth;
        FuelCore fuel;
        FuelMirror mirror;
        AttributeRegistry attributes;
        DeferredTestDiscoveryAdapter discovery;
        ProtocolSystemRecoveryAuthority recovery;
        ProtocolSystemGuardian guardian;
        MockStock[4] stocks;
        ConfigurableClaimGate claimGate;
        RewardLedger ledger;
        EpochConverter converter;
        CanonicalMarketRegistry marketRegistry;
        CanonicalFeeHook feeHook;
        CanonicalRouter router;
        GenesisLiquidityVault genesisVault;
        ProtocolLiquidityVault protocolLiquidityVault;
        DeterministicConversionAdapter[4] conversionAdapters;
        PoolKey marketKey;
    }

    receive() external payable {}

    function _deployProtocolSystem() internal returns (ProtocolSystemFixture memory fixture) {
        fixture.manager = new PoolManager(address(this));
        fixture.weth = new MockWETH();
        fixture.discovery = new DeferredTestDiscoveryAdapter();
        fixture.recovery = new ProtocolSystemRecoveryAuthority();
        fixture.guardian = new ProtocolSystemGuardian();
        fixture.fuel = new FuelCore(
            "System Liquid Token",
            "SYS",
            "System Collectible",
            "SYSC",
            address(this),
            fixture.discovery,
            address(fixture.guardian),
            fixture.recovery
        );
        fixture.mirror = fixture.fuel.mirror();
        fixture.attributes = _deployAttributeRegistry();
        fixture.stocks = _deploySystemStocks();
        fixture.claimGate = new ConfigurableClaimGate(address(this));
        fixture.ledger = new RewardLedger(
            address(fixture.fuel),
            fixture.attributes,
            _stockAddresses(fixture.stocks),
            fixture.claimGate,
            address(this)
        );
        fixture.converter = new EpochConverter(
            address(fixture.weth), address(fixture.ledger), address(this), address(this)
        );
        fixture.marketRegistry = new CanonicalMarketRegistry(
            fixture.manager, address(fixture.fuel), address(fixture.weth), address(this)
        );
        fixture.protocolLiquidityVault = new ProtocolLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.marketRegistry)), address(this), address(this)
        );
        fixture.feeHook = _deployMinedHook(
            new CanonicalHookDeployer(),
            fixture.manager,
            fixture.marketRegistry,
            address(fixture.weth),
            address(fixture.converter),
            address(fixture.protocolLiquidityVault),
            address(this)
        );
        fixture.router =
            new CanonicalRouter(fixture.manager, fixture.marketRegistry, address(fixture.weth));
        fixture.marketKey = _marketKey(fixture);
        fixture.marketRegistry.registerPool(fixture.marketKey, address(fixture.router));
        fixture.marketRegistry.seal();
        fixture.genesisVault = new GenesisLiquidityVault(
            ICanonicalMarketRegistry(address(fixture.marketRegistry)), address(this)
        );

        _configureOwnership(fixture);
        _configureRewards(fixture);
        _configureProtocolLiquidity(fixture);
        _seedAndLaunch(fixture);
    }

    function _configureOwnership(ProtocolSystemFixture memory fixture) private {
        fixture.fuel.setDiscoveryExempt(address(fixture.manager), true);
        fixture.fuel.setDiscoveryExempt(address(fixture.genesisVault), true);
        fixture.fuel.setProtectedAccount(address(fixture.manager), true);
        fixture.fuel.setProtectedAccount(address(fixture.genesisVault), true);
        fixture.fuel.setProtectedAccount(address(fixture.feeHook), true);
        fixture.fuel.setProtectedAccount(address(fixture.router), true);
        fixture.fuel.setProtectedAccount(address(fixture.converter), true);
        fixture.fuel.setProtectedAccount(address(fixture.ledger), true);
        fixture.fuel.setProtectedAccount(address(fixture.protocolLiquidityVault), true);
        fixture.fuel
            .setCanonicalMarketRegistry(ICanonicalMarketRegistry(address(fixture.marketRegistry)));
        fixture.ledger.sealEpochConverter(address(fixture.converter));
        fixture.fuel.setRewardLedger(IRewardLedgerCallbacks(address(fixture.ledger)));
    }

    function _configureRewards(ProtocolSystemFixture memory fixture) private {
        fixture.converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(fixture.feeHook)));
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            fixture.conversionAdapters[trackIndex] = new DeterministicConversionAdapter(
                track,
                address(fixture.converter),
                address(fixture.weth),
                address(fixture.stocks[trackIndex]),
                address(fixture.ledger)
            );
            fixture.converter
                .configureTrack(
                    track,
                    address(fixture.stocks[trackIndex]),
                    IConversionAdapter(address(fixture.conversionAdapters[trackIndex]))
                );
            require(
                fixture.stocks[trackIndex].transfer(
                    address(fixture.conversionAdapters[trackIndex]), 1_000 ether
                ),
                "conversion adapter funding failed"
            );
        }
        fixture.converter.sealConfiguration();
    }

    function _configureProtocolLiquidity(ProtocolSystemFixture memory fixture) private {
        fixture.protocolLiquidityVault
            .configureCanonicalFeeHook(ICanonicalFeeHook(address(fixture.feeHook)));
        fixture.protocolLiquidityVault.sealConfiguration();
    }

    function _seedAndLaunch(ProtocolSystemFixture memory fixture) private {
        require(
            fixture.fuel.approve(address(fixture.genesisVault), type(uint256).max),
            "Genesis allowance failed"
        );
        fixture.genesisVault.initializeAndSeed(block.timestamp);
        fixture.genesisVault.validateSeededPostconditions();
        fixture.fuel.launch();
    }

    function _deployAttributeRegistry() private returns (AttributeRegistry registry) {
        bytes memory canonical = vm.readFileBinary("../config/collection/manifest.bin");
        assertEq(keccak256(canonical), MANIFEST_HASH, "manifest hash changed");
        registry = new AttributeRegistry(MANIFEST_HASH);

        uint256 inputCount = canonical.length / 7;
        uint256 offset;
        while (offset < inputCount) {
            uint256 remaining = inputCount - offset;
            uint256 batchSize = remaining > 200 ? 200 : remaining;
            AttributeRegistry.AttributeInput[] memory batch =
                new AttributeRegistry.AttributeInput[](batchSize);
            for (uint256 index = 0; index < batchSize; ++index) {
                batch[index] = _attributeInput(canonical, offset + index);
            }
            registry.loadBatch(batch);
            offset += batchSize;
        }
        registry.seal();
    }

    function _deploySystemStocks() private returns (MockStock[4] memory stocks) {
        stocks[0] = new MockStock(
            "AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", 1_000_000 ether, address(this)
        );
        stocks[1] = new MockStock(
            "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", 1_000_000 ether, address(this)
        );
        stocks[2] = new MockStock(
            "METAc MOCK TEST Stock", "MOCK-METAc-TEST", 1_000_000 ether, address(this)
        );
        stocks[3] = new MockStock(
            "NVDAc MOCK TEST Stock", "MOCK-NVDAc-TEST", 1_000_000 ether, address(this)
        );
    }

    function _stockAddresses(MockStock[4] memory stocks)
        private
        pure
        returns (address[4] memory addresses)
    {
        for (uint256 index = 0; index < 4; ++index) {
            addresses[index] = address(stocks[index]);
        }
    }

    function _marketKey(ProtocolSystemFixture memory fixture)
        private
        pure
        returns (PoolKey memory key)
    {
        (Currency currency0, Currency currency1) = address(fixture.fuel) < address(fixture.weth)
            ? (Currency.wrap(address(fixture.fuel)), Currency.wrap(address(fixture.weth)))
            : (Currency.wrap(address(fixture.weth)), Currency.wrap(address(fixture.fuel)));
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(fixture.feeHook))
        });
    }

    function _attributeInput(bytes memory canonical, uint256 index)
        private
        pure
        returns (AttributeRegistry.AttributeInput memory input)
    {
        uint256 offset = index * 7;
        input = AttributeRegistry.AttributeInput({
            identityId: (uint16(uint8(canonical[offset])) << 8)
                | uint16(uint8(canonical[offset + 1])),
            track: AttributeRegistry.RewardTrack(uint8(canonical[offset + 2])),
            tier: AttributeRegistry.RarityTier(uint8(canonical[offset + 3])),
            weight: (uint16(uint8(canonical[offset + 4])) << 8)
                | uint16(uint8(canonical[offset + 5])),
            collectibleKind: AttributeRegistry.CollectibleKind(uint8(canonical[offset + 6]))
        });
    }

    function _ordinaryIdentity(
        ProtocolSystemFixture memory fixture,
        AttributeRegistry.RewardTrack track
    ) internal view returns (uint16 identityId) {
        for (uint16 candidate = 1; candidate <= 4_440; ++candidate) {
            AttributeRegistry.Attributes memory attributes =
                fixture.attributes.attributeOf(candidate);
            if (attributes.track == track) return candidate;
        }
        revert("ordinary identity missing");
    }

    function _wethOnlyRange(ProtocolSystemFixture memory fixture)
        internal
        view
        returns (int24 tickLower, int24 tickUpper)
    {
        (, int24 currentTick,,) =
            IPoolManager(address(fixture.manager)).getSlot0(fixture.marketKey.toId());
        if (fixture.protocolLiquidityVault.wethIsCurrency0()) {
            tickLower = TickSpacingTestHelper.ceilToCanonicalSpacing(currentTick);
            tickUpper = tickLower + 600;
        } else {
            tickUpper = TickSpacingTestHelper.floorToCanonicalSpacing(currentTick);
            tickLower = tickUpper - 600;
        }
    }
}
