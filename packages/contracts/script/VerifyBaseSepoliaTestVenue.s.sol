// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {BaseSepoliaInfrastructure} from "../src/deployment/BaseSepoliaInfrastructure.sol";
import {
    BaseSepoliaTestVenueConfiguration as Config
} from "../src/deployment/BaseSepoliaTestVenueConfiguration.sol";
import {
    BaseSepoliaTestVenueValidation as Validation
} from "../src/deployment/BaseSepoliaTestVenueValidation.sol";
import {MintableTestToken} from "../src/test-assets/MintableTestToken.sol";
import {MintableTestWETH} from "../src/test-assets/MintableTestWETH.sol";
import {MockStock} from "../src/test-assets/MockStock.sol";
import {TestConversionVenue} from "../src/test-assets/TestConversionVenue.sol";

/// @notice Writes the manifest only from a subsequent read of confirmed Base Sepolia state.
contract VerifyBaseSepoliaTestVenue is Script {
    struct Deployment {
        MockStock[4] stocks;
        TestConversionVenue venue;
        address operator;
        address weth;
        address usdc;
        bool selfFunded;
    }

    function run() external {
        Deployment memory deployment = _loadConfirmedDeployment();
        if (deployment.selfFunded) {
            BaseSepoliaInfrastructure.validateDeployedPoolManager();
        } else {
            BaseSepoliaInfrastructure.validateDeployedOfficialInfrastructure();
        }
        _verifyContracts(deployment);
        _verifyAllPoolsAndQuotes(deployment);
        _writeVerifiedManifest(deployment);
    }

    function _loadConfirmedDeployment() private view returns (Deployment memory deployment) {
        string memory defaultPath =
            string.concat(vm.projectRoot(), "/../../deployments/84532.venue.json");
        string memory configurationPath = vm.envOr("TEST_VENUE_CONFIGURATION_PATH", defaultPath);
        string memory json = vm.readFile(configurationPath);
        require(vm.parseJsonUint(json, ".schemaVersion") == 1, "wrong config schema");
        require(vm.parseJsonUint(json, ".chainId") == 84_532, "wrong config chain");
        require(
            _sameString(vm.parseJsonString(json, ".environment"), "staging"),
            "wrong config environment"
        );
        require(
            _sameString(vm.parseJsonString(json, ".network"), "base-sepolia"),
            "wrong config network"
        );
        string memory assetProfile = vm.parseJsonString(json, ".assetProfile");
        deployment.selfFunded = _sameString(assetProfile, "self-funded-test-assets");
        require(
            deployment.selfFunded || _sameString(assetProfile, "official-test-assets"),
            "wrong asset profile"
        );
        deployment.operator = vm.parseJsonAddress(json, ".operator");
        require(
            vm.parseJsonAddress(json, ".contracts.uniswapV4PoolManager")
                == BaseSepoliaInfrastructure.POOL_MANAGER,
            "unofficial configured PoolManager"
        );
        deployment.venue =
            TestConversionVenue(vm.parseJsonAddress(json, ".contracts.testConversionVenue"));
        deployment.weth = vm.parseJsonAddress(json, ".contracts.weth");
        deployment.usdc = vm.parseJsonAddress(json, ".contracts.usdc");
        if (!deployment.selfFunded) {
            require(deployment.weth == BaseSepoliaInfrastructure.WETH, "unofficial configured WETH");
            require(deployment.usdc == BaseSepoliaInfrastructure.USDC, "unofficial configured USDC");
        }
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            deployment.stocks[index] = MockStock(
                vm.parseJsonAddress(
                    json, string.concat(".contracts.", stockConfig.contractManifestKey)
                )
            );
        }
    }

    function _verifyContracts(Deployment memory deployment) private view {
        require(deployment.operator != address(0), "zero deployment operator");
        require(address(deployment.venue).code.length != 0, "venue is not confirmed onchain");
        require(
            address(deployment.venue.manager()) == BaseSepoliaInfrastructure.POOL_MANAGER,
            "venue uses unofficial PoolManager"
        );
        require(deployment.venue.operator() == deployment.operator, "wrong venue operator");

        if (deployment.selfFunded) {
            require(
                MintableTestWETH(payable(deployment.weth)).isWrappedNativeTestAsset(),
                "self-funded WETH cannot wrap native Ether"
            );
            _verifyTestAsset(
                MintableTestToken(deployment.weth),
                Config.SELF_FUNDED_WETH_NAME,
                Config.SELF_FUNDED_WETH_SYMBOL,
                Config.SELF_FUNDED_WETH_DECIMALS,
                Config.SELF_FUNDED_WETH_INITIAL_SUPPLY,
                deployment.operator
            );
            _verifyTestAsset(
                MintableTestToken(deployment.usdc),
                Config.SELF_FUNDED_USDC_NAME,
                Config.SELF_FUNDED_USDC_SYMBOL,
                Config.SELF_FUNDED_USDC_DECIMALS,
                Config.SELF_FUNDED_USDC_INITIAL_SUPPLY,
                deployment.operator
            );
        }

        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            MockStock stock = deployment.stocks[index];
            require(address(stock).code.length != 0, "stock is not confirmed onchain");
            require(
                keccak256(bytes(stock.name())) == keccak256(bytes(stockConfig.name)),
                "wrong mock stock name"
            );
            require(
                keccak256(bytes(stock.symbol())) == keccak256(bytes(stockConfig.symbol)),
                "wrong mock stock symbol"
            );
            require(stock.totalSupply() == Config.STOCK_FIXED_SUPPLY, "wrong mock stock supply");
            require(stock.operator() == deployment.operator, "wrong mock stock operator");
        }
    }

    function _verifyTestAsset(
        MintableTestToken token,
        string memory expectedName,
        string memory expectedSymbol,
        uint8 expectedDecimals,
        uint256 expectedSupply,
        address expectedOperator
    ) private view {
        require(address(token).code.length != 0, "test asset is not confirmed onchain");
        require(
            keccak256(bytes(token.name())) == keccak256(bytes(expectedName)), "wrong asset name"
        );
        require(
            keccak256(bytes(token.symbol())) == keccak256(bytes(expectedSymbol)),
            "wrong asset symbol"
        );
        require(token.decimals() == expectedDecimals, "wrong asset decimals");
        require(token.totalSupply() == expectedSupply, "wrong asset supply");
        require(token.operator() == expectedOperator, "wrong asset operator");
    }

    function _verifyAllPoolsAndQuotes(Deployment memory deployment) private {
        Validation.verifyPool(
            deployment.venue,
            deployment.weth,
            deployment.usdc,
            Config.WETH_USDC_SEED_LIQUIDITY,
            Validation.wethUsdcSeedPrice(deployment.weth, deployment.usdc)
        );
        uint256 maximumClipUsdc = _verifyDeterministicQuotes(
            deployment.venue, deployment.weth, deployment.usdc, 10 ether, 1 * 1e6
        );
        require(maximumClipUsdc <= 1_100 * 1e6, "10 WETH clip requires unrealistic test USDC");

        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            address stock = address(deployment.stocks[index]);
            Validation.verifyPool(
                deployment.venue,
                deployment.usdc,
                stock,
                Config.USDC_STOCK_SEED_LIQUIDITY,
                Validation.usdcStockSeedPrice(deployment.usdc, stock)
            );
            _verifyDeterministicQuotes(deployment.venue, deployment.usdc, stock, 1 * 1e6, 1 ether);
        }
    }

    function _verifyDeterministicQuotes(
        TestConversionVenue venue,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) private returns (uint256 firstAQuote) {
        firstAQuote = venue.quoteExactInput(tokenA, tokenB, amountA);
        uint256 repeatedAQuote = venue.quoteExactInput(tokenA, tokenB, amountA);
        uint256 firstBQuote = venue.quoteExactInput(tokenB, tokenA, amountB);
        uint256 repeatedBQuote = venue.quoteExactInput(tokenB, tokenA, amountB);
        require(firstAQuote != 0 && firstAQuote == repeatedAQuote, "invalid forward quote");
        require(firstBQuote != 0 && firstBQuote == repeatedBQuote, "invalid reverse quote");
    }

    function _writeVerifiedManifest(Deployment memory deployment) private {
        string memory contractsJson = vm.serializeAddress(
            "contracts",
            deployment.selfFunded ? "selfFundedTestUsdc" : "circleTestUsdc",
            deployment.usdc
        );
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            contractsJson = vm.serializeAddress(
                "contracts", stockConfig.contractManifestKey, address(deployment.stocks[index])
            );
        }
        contractsJson = vm.serializeAddress(
            "contracts",
            deployment.selfFunded ? "selfFundedTestWeth" : "officialWeth",
            deployment.weth
        );
        contractsJson =
            vm.serializeAddress("contracts", "testConversionVenue", address(deployment.venue));
        contractsJson = vm.serializeAddress(
            "contracts", "uniswapV4PoolManager", BaseSepoliaInfrastructure.POOL_MANAGER
        );

        string memory poolsJson = string.concat(
            "{\"wethUsdc\":", _verifiedPoolJson(deployment.venue, deployment.weth, deployment.usdc)
        );
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            poolsJson = string.concat(
                poolsJson,
                ",\"",
                stockConfig.poolManifestKey,
                "\":",
                _verifiedPoolJson(
                    deployment.venue, deployment.usdc, address(deployment.stocks[index])
                )
            );
        }
        poolsJson = string.concat(poolsJson, "}");
        string memory manifest = string.concat(
            "{\"$schema\":\"./schema.json\",\"schemaVersion\":1,",
            "\"chainId\":84532,\"network\":\"base-sepolia\",\"contracts\":",
            contractsJson,
            ",\"conversionPools\":",
            poolsJson,
            "}"
        );
        string memory defaultPath = string.concat(vm.projectRoot(), "/../../deployments/84532.json");
        string memory manifestPath = vm.envOr("DEPLOYMENT_MANIFEST_PATH", defaultPath);
        vm.writeJson(manifest, manifestPath);
    }

    function _verifiedPoolJson(TestConversionVenue venue, address tokenA, address tokenB)
        private
        view
        returns (string memory)
    {
        (PoolId poolId_, PoolKey memory key, uint160 seedSqrtPriceX96, uint128 activeLiquidity) =
            venue.verifiedPoolConfiguration(tokenA, tokenB);
        return string.concat(
            "{\"poolId\":\"",
            vm.toString(PoolId.unwrap(poolId_)),
            "\",\"currency0\":\"",
            vm.toString(Currency.unwrap(key.currency0)),
            "\",\"currency1\":\"",
            vm.toString(Currency.unwrap(key.currency1)),
            "\",\"fee\":",
            vm.toString(uint256(key.fee)),
            ",\"tickSpacing\":",
            vm.toString(int256(key.tickSpacing)),
            ",\"hooks\":\"",
            vm.toString(address(key.hooks)),
            "\",\"seedSqrtPriceX96\":\"",
            vm.toString(uint256(seedSqrtPriceX96)),
            "\",\"activeLiquidity\":\"",
            vm.toString(uint256(activeLiquidity)),
            "\"}"
        );
    }

    function _sameString(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
