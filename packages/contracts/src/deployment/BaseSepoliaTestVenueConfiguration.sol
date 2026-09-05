// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Shared deterministic parameters for the valueless Base Sepolia conversion venue.
library BaseSepoliaTestVenueConfiguration {
    uint256 internal constant STOCK_COUNT = 4;
    uint256 internal constant STOCK_FIXED_SUPPLY = 1_000_000_000 ether;
    string internal constant SELF_FUNDED_USDC_NAME = "USDC MOCK TEST Self-Funded";
    string internal constant SELF_FUNDED_USDC_SYMBOL = "MOCK-USDC-TEST";
    uint8 internal constant SELF_FUNDED_USDC_DECIMALS = 6;
    uint256 internal constant SELF_FUNDED_USDC_INITIAL_SUPPLY = 1_000_000_000 * 1e6;
    string internal constant SELF_FUNDED_WETH_NAME = "WETH MOCK TEST Self-Funded";
    string internal constant SELF_FUNDED_WETH_SYMBOL = "MOCK-WETH-TEST";
    uint8 internal constant SELF_FUNDED_WETH_DECIMALS = 18;
    uint256 internal constant SELF_FUNDED_WETH_INITIAL_SUPPLY = 1_000_000 ether;
    uint24 internal constant TEST_LP_FEE = 4_444;
    int24 internal constant TEST_TICK_SPACING = 11;
    uint128 internal constant USDC_STOCK_SEED_LIQUIDITY = 4_000_000_000_000_000;
    int24 internal constant USDC_STOCK_ABSOLUTE_TICK = 276_300;
    uint128 internal constant WETH_USDC_SEED_LIQUIDITY = 200_000_000_000_000;
    int24 internal constant WETH_USDC_ABSOLUTE_TICK = 230_280;

    error InvalidStockIndex(uint256 index);

    struct StockConfiguration {
        string name;
        string symbol;
        string contractManifestKey;
        string poolManifestKey;
    }

    function stockConfiguration(uint256 index)
        internal
        pure
        returns (StockConfiguration memory configuration)
    {
        if (index == 0) {
            return StockConfiguration({
                name: "AAPLc MOCK TEST Stock",
                symbol: "MOCK-AAPLc-TEST",
                contractManifestKey: "mockAaplc",
                poolManifestKey: "aaplc"
            });
        }
        if (index == 1) {
            return StockConfiguration({
                name: "GOOGLc MOCK TEST Stock",
                symbol: "MOCK-GOOGLc-TEST",
                contractManifestKey: "mockGooglc",
                poolManifestKey: "googlc"
            });
        }
        if (index == 2) {
            return StockConfiguration({
                name: "METAc MOCK TEST Stock",
                symbol: "MOCK-METAc-TEST",
                contractManifestKey: "mockMetac",
                poolManifestKey: "metac"
            });
        }
        if (index == 3) {
            return StockConfiguration({
                name: "NVDAc MOCK TEST Stock",
                symbol: "MOCK-NVDAc-TEST",
                contractManifestKey: "mockNvdac",
                poolManifestKey: "nvdac"
            });
        }
        revert InvalidStockIndex(index);
    }
}
