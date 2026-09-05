// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../../src/AttributeRegistry.sol";
import {
    DeterministicConversionAdapter
} from "../../src/conversion/DeterministicConversionAdapter.sol";
import {EpochConverter} from "../../src/conversion/EpochConverter.sol";
import {ICanonicalFeeHook} from "../../src/interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../../src/interfaces/IConversionAdapter.sol";
import {MockStock} from "../../src/test-assets/MockStock.sol";
import {MockWETH} from "../../src/test-assets/MockWETH.sol";

interface EpochConverterVm {
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract RewardPotSourceHarness {
    MockWETH public immutable token;
    address public immutable rewardDestination;
    uint256 public rewardPot;

    constructor(MockWETH token_, address rewardDestination_) {
        token = token_;
        rewardDestination = rewardDestination_;
    }

    function weth() external view returns (address) {
        return address(token);
    }

    function fund(uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "funding failed");
        rewardPot += amount;
    }

    function pullRewardPot(uint256 amount) external {
        require(msg.sender == rewardDestination, "wrong reward destination");
        rewardPot -= amount;
        require(token.transfer(rewardDestination, _payoutAmount(amount)), "pull failed");
    }

    function _payoutAmount(uint256 amount) internal pure virtual returns (uint256) {
        return amount;
    }
}

contract ShortPayingRewardPotSource is RewardPotSourceHarness {
    constructor(MockWETH token_, address rewardDestination_)
        RewardPotSourceHarness(token_, rewardDestination_)
    {}

    function _payoutAmount(uint256 amount) internal pure override returns (uint256) {
        return amount / 2;
    }
}

contract RewardLedgerHarness {
    address[4] private _rewardTokens;
    address public epochConverter;
    uint256[4] private _notified;

    constructor(address[4] memory rewardTokens_) {
        _rewardTokens = rewardTokens_;
    }

    function setEpochConverter(address converter) external {
        require(epochConverter == address(0), "converter already set");
        epochConverter = converter;
    }

    function rewardToken(AttributeRegistry.RewardTrack track) external view returns (address) {
        return _rewardTokens[uint8(track) - 1];
    }

    function notifyReward(AttributeRegistry.RewardTrack track, address token, uint256 amount)
        external
    {
        require(msg.sender == epochConverter, "wrong converter");
        require(token == _rewardTokens[uint8(track) - 1], "wrong stock");
        _notified[uint8(track) - 1] += amount;
    }

    function notified(AttributeRegistry.RewardTrack track) external view returns (uint256) {
        return _notified[uint8(track) - 1];
    }
}

contract OverreportingConversionAdapter is IConversionAdapter {
    AttributeRegistry.RewardTrack public immutable override configuredTrack;
    address public immutable override converter;
    MockWETH public immutable tokenIn;
    MockStock public immutable tokenOut;
    address public immutable override rewardLedger;

    constructor(
        AttributeRegistry.RewardTrack track_,
        address converter_,
        MockWETH weth_,
        MockStock stock_,
        address rewardLedger_
    ) {
        configuredTrack = track_;
        converter = converter_;
        tokenIn = weth_;
        tokenOut = stock_;
        rewardLedger = rewardLedger_;
    }

    function weth() external view returns (address) {
        return address(tokenIn);
    }

    function stockToken() external view returns (address) {
        return address(tokenOut);
    }

    function convert(AttributeRegistry.RewardTrack, uint256 exactWethInput, uint256, uint256)
        external
        returns (uint256 dishonestReportedOutput)
    {
        require(msg.sender == converter, "wrong converter");
        require(tokenIn.transferFrom(msg.sender, address(this), exactWethInput), "WETH pull failed");
        require(tokenOut.transfer(rewardLedger, exactWethInput / 2), "stock transfer failed");
        dishonestReportedOutput = type(uint256).max;
    }
}

    contract EmptyConversionAdapter is IConversionAdapter {
        AttributeRegistry.RewardTrack public immutable override configuredTrack;
        address public immutable override converter;
        MockWETH public immutable tokenIn;
        address public immutable override stockToken;
        address public immutable override rewardLedger;

        constructor(
            AttributeRegistry.RewardTrack track_,
            address converter_,
            MockWETH weth_,
            address stockToken_,
            address rewardLedger_
        ) {
            configuredTrack = track_;
            converter = converter_;
            tokenIn = weth_;
            stockToken = stockToken_;
            rewardLedger = rewardLedger_;
        }

        function weth() external view returns (address) {
            return address(tokenIn);
        }

        function convert(AttributeRegistry.RewardTrack, uint256 exactWethInput, uint256, uint256)
            external
            returns (uint256 measuredStockOutput)
        {
            require(msg.sender == converter, "wrong converter");
            require(
                tokenIn.transferFrom(msg.sender, address(this), exactWethInput), "WETH pull failed"
            );
            measuredStockOutput = 0;
        }
    }

        abstract contract EpochConverterTestBase {
            EpochConverterVm internal constant VM =
                EpochConverterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

            struct DeterministicFixture {
                MockWETH weth;
                MockStock[4] stocks;
                RewardLedgerHarness ledger;
                EpochConverter converter;
                RewardPotSourceHarness feeHook;
                DeterministicConversionAdapter[4] adapters;
            }

            function _deployDeterministicFixture(address keeper)
                internal
                returns (DeterministicFixture memory fixture)
            {
                fixture.weth = new MockWETH();
                fixture.stocks = _deployStocks(1_000_000 ether);
                fixture.ledger = new RewardLedgerHarness(_stockAddresses(fixture.stocks));
                fixture.converter = new EpochConverter(
                    address(fixture.weth), address(fixture.ledger), keeper, address(this)
                );
                fixture.ledger.setEpochConverter(address(fixture.converter));
                fixture.feeHook = new RewardPotSourceHarness(
                    fixture.weth, address(fixture.converter)
                );
                fixture.converter
                .configureCanonicalFeeHook(ICanonicalFeeHook(address(fixture.feeHook)));
                for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
                    AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(
                        trackIndex + 1
                    );
                    fixture.adapters[trackIndex] = new DeterministicConversionAdapter(
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
                            IConversionAdapter(address(fixture.adapters[trackIndex]))
                        );
                }
                fixture.converter.sealConfiguration();
            }

            function _configureDeterministicTracksFrom(
                EpochConverter converter,
                MockWETH weth,
                MockStock[4] memory stocks,
                RewardLedgerHarness ledger,
                uint8 firstTrackIndex
            ) internal {
                for (uint8 trackIndex = firstTrackIndex; trackIndex < 4; ++trackIndex) {
                    AttributeRegistry.RewardTrack track =
                        AttributeRegistry.RewardTrack(trackIndex + 1);
                    DeterministicConversionAdapter adapter = new DeterministicConversionAdapter(
                        track,
                        address(converter),
                        address(weth),
                        address(stocks[trackIndex]),
                        address(ledger)
                    );
                    converter.configureTrack(
                        track, address(stocks[trackIndex]), IConversionAdapter(address(adapter))
                    );
                }
            }

            function _deployStocks(uint256 supply) internal returns (MockStock[4] memory stocks) {
                stocks[0] =
                    new MockStock("AAPLc MOCK TEST Stock", "MOCK-AAPLc-TEST", supply, address(this));
                stocks[1] =
                    new MockStock(
                    "GOOGLc MOCK TEST Stock", "MOCK-GOOGLc-TEST", supply, address(this)
                );
                stocks[2] =
                    new MockStock("METAc MOCK TEST Stock", "MOCK-METAc-TEST", supply, address(this));
                stocks[3] =
                    new MockStock("NVDAc MOCK TEST Stock", "MOCK-NVDAc-TEST", supply, address(this));
            }

            function _stockAddresses(MockStock[4] memory stocks)
                internal
                pure
                returns (address[4] memory addresses)
            {
                for (uint256 index = 0; index < 4; ++index) {
                    addresses[index] = address(stocks[index]);
                }
            }

            function _fundRewardPot(DeterministicFixture memory fixture, uint256 amount) internal {
                _fundRewardPot(fixture.weth, fixture.feeHook, amount);
            }

            function _fundRewardPot(MockWETH weth, RewardPotSourceHarness feeHook, uint256 amount)
                internal
            {
                VM.deal(address(this), address(this).balance + amount);
                weth.deposit{value: amount}();
                require(weth.approve(address(feeHook), amount), "approval failed");
                feeHook.fund(amount);
            }

            function _fundAdapters(DeterministicFixture memory fixture, uint256 amount) internal {
                for (uint256 index = 0; index < 4; ++index) {
                    require(
                        fixture.stocks[index].transfer(address(fixture.adapters[index]), amount),
                        "adapter stock funding failed"
                    );
                }
            }

            function _executeAapl(
                DeterministicFixture memory fixture,
                uint256 minimumStockOutput,
                uint256 deadline
            ) internal returns (bool settled) {
                (settled,) = address(fixture.converter)
                    .call(
                        abi.encodeCall(
                            EpochConverter.executeTrack,
                            (AttributeRegistry.RewardTrack.AAPLc, minimumStockOutput, deadline)
                        )
                    );
            }

            function _revertSelector(bytes memory reason) internal pure returns (bytes4 selector) {
                if (reason.length < 4) return bytes4(0);
                assembly ("memory-safe") {
                    selector := mload(add(reason, 0x20))
                }
            }
        }
