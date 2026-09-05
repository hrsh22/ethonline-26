// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {AlwaysAllowClaimGate} from "../src/claim/AlwaysAllowClaimGate.sol";
import {DeterministicConversionAdapter} from "../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../src/interfaces/IConversionAdapter.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {RewardPotSourceHarness} from "./helpers/EpochConverterTestBase.sol";

interface EpochLedgerVm {
    function deal(address account, uint256 newBalance) external;
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

contract EpochConverterRewardLedgerTest {
    EpochLedgerVm private constant VM =
        EpochLedgerVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;

    function testMeasuredConversionFundsTheRealRewardLedgerAccounting() external {
        AttributeRegistry registry = _deployRegistry();
        MockWETH weth = new MockWETH();
        MockStock[4] memory stocks = _deployStocks();
        address[4] memory stockAddresses;
        for (uint256 index = 0; index < 4; ++index) {
            stockAddresses[index] = address(stocks[index]);
        }
        RewardLedger ledger = new RewardLedger(
            address(this), registry, stockAddresses, new AlwaysAllowClaimGate(), address(this)
        );
        EpochConverter converter =
            new EpochConverter(address(weth), address(ledger), address(this), address(this));
        ledger.sealEpochConverter(address(converter));
        RewardPotSourceHarness feeHook = new RewardPotSourceHarness(weth, address(converter));
        converter.configureCanonicalFeeHook(ICanonicalFeeHook(address(feeHook)));

        DeterministicConversionAdapter[4] memory adapters;
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            adapters[trackIndex] = new DeterministicConversionAdapter(
                track,
                address(converter),
                address(weth),
                address(stocks[trackIndex]),
                address(ledger)
            );
            converter.configureTrack(
                track,
                address(stocks[trackIndex]),
                IConversionAdapter(address(adapters[trackIndex]))
            );
        }
        converter.sealConfiguration();

        VM.deal(address(this), 0.04 ether);
        weth.deposit{value: 0.04 ether}();
        require(weth.approve(address(feeHook), 0.04 ether), "fee hook approval failed");
        feeHook.fund(0.04 ether);
        require(
            stocks[0].transfer(address(adapters[0]), 0.01 ether), "adapter stock funding failed"
        );
        converter.openRewardEpoch();

        uint256 measuredOutput = converter.executeTrack(
            AttributeRegistry.RewardTrack.AAPLc, 0.01 ether, block.timestamp
        );

        require(measuredOutput == 0.01 ether, "wrong converter output");
        require(
            stocks[0].balanceOf(address(ledger)) == measuredOutput,
            "Reward Ledger funding disagreed with measurement"
        );
        require(
            ledger.totalLiability(AttributeRegistry.RewardTrack.AAPLc) == measuredOutput,
            "Reward Ledger liability was not exact"
        );
        require(
            ledger.unclaimedTrackPot(AttributeRegistry.RewardTrack.AAPLc) == 0.00825 ether,
            "ordinary Reward Track allocation changed"
        );
    }

    function _deployRegistry() private returns (AttributeRegistry registry) {
        bytes memory canonical = VM.readFileBinary("../config/collection/manifest.bin");
        require(keccak256(canonical) == MANIFEST_HASH, "manifest hash changed");
        registry = new AttributeRegistry(MANIFEST_HASH);

        uint256 offset;
        uint256 inputCount = canonical.length / 7;
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

    function _deployStocks() private returns (MockStock[4] memory stocks) {
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
}
