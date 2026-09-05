// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

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

/// @notice Broadcasts either official-asset or self-funded test-asset venue deployment.
/// @dev This script never writes the confirmed deployment manifest.
contract DeployBaseSepoliaTestVenue is Script {
    struct Deployment {
        MockStock[4] stocks;
        TestConversionVenue venue;
        address weth;
        address usdc;
        bool selfFunded;
    }

    function run() external {
        bool selfFunded = vm.envOr("SELF_FUNDED_TEST_ASSETS", false);
        if (selfFunded) {
            BaseSepoliaInfrastructure.validateDeployedPoolManager();
        } else {
            BaseSepoliaInfrastructure.validateDeployedOfficialInfrastructure();
        }

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);
        Deployment memory deployment = _deployAndSeed(deployer, selfFunded);
        _assertExecutableRoundTrips(deployment, deployer);
        _verifyAllPools(deployment);
        vm.stopBroadcast();

        _logDeployment(deployment);
    }

    function _deployAndSeed(address deployer, bool selfFunded)
        private
        returns (Deployment memory deployment)
    {
        deployment.selfFunded = selfFunded;
        if (selfFunded) {
            deployment.weth = address(
                new MintableTestWETH(
                    Config.SELF_FUNDED_WETH_NAME,
                    Config.SELF_FUNDED_WETH_SYMBOL,
                    Config.SELF_FUNDED_WETH_INITIAL_SUPPLY,
                    deployer
                )
            );
            deployment.usdc = address(
                new MintableTestToken(
                    Config.SELF_FUNDED_USDC_NAME,
                    Config.SELF_FUNDED_USDC_SYMBOL,
                    Config.SELF_FUNDED_USDC_DECIMALS,
                    Config.SELF_FUNDED_USDC_INITIAL_SUPPLY,
                    deployer
                )
            );
        } else {
            deployment.weth = BaseSepoliaInfrastructure.WETH;
            deployment.usdc = BaseSepoliaInfrastructure.USDC;
        }

        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            deployment.stocks[index] = new MockStock(
                stockConfig.name, stockConfig.symbol, Config.STOCK_FIXED_SUPPLY, deployer
            );
        }
        deployment.venue =
            new TestConversionVenue(IPoolManager(BaseSepoliaInfrastructure.POOL_MANAGER), deployer);

        _approve(IERC20Minimal(deployment.weth), address(deployment.venue));
        _approve(IERC20Minimal(deployment.usdc), address(deployment.venue));
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            _approve(IERC20Minimal(address(deployment.stocks[index])), address(deployment.venue));
        }

        deployment.venue
            .initializeWethUsdcPool(
                deployment.weth, deployment.usdc, Config.WETH_USDC_SEED_LIQUIDITY
            );
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            deployment.venue
                .initializeUsdcStockPool(
                    deployment.usdc,
                    address(deployment.stocks[index]),
                    Config.USDC_STOCK_SEED_LIQUIDITY
                );
        }
    }

    function _assertExecutableRoundTrips(Deployment memory deployment, address deployer) private {
        uint256 maximumClipUsdc =
            deployment.venue.quoteExactInput(deployment.weth, deployment.usdc, 10 ether);
        require(maximumClipUsdc != 0, "10 WETH clip is not executable");
        require(maximumClipUsdc <= 1_100 * 1e6, "10 WETH clip requires unrealistic test USDC");

        uint256 usdcOut =
            deployment.venue.quoteExactInput(deployment.weth, deployment.usdc, 0.01 ether);
        uint256 executedUsdc = deployment.venue
            .swapExactInput(deployment.weth, deployment.usdc, 0.01 ether, usdcOut, deployer);
        uint256 wethOut =
            deployment.venue.quoteExactInput(deployment.usdc, deployment.weth, executedUsdc);
        require(
            deployment.venue
                .swapExactInput(deployment.usdc, deployment.weth, executedUsdc, wethOut, deployer)
            == wethOut,
            "WETH/USDC round trip failed"
        );

        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            _assertStockRoundTrip(
                deployment.venue, deployment.usdc, deployment.stocks[index], deployer
            );
        }
    }

    function _assertStockRoundTrip(
        TestConversionVenue venue,
        address usdc,
        MockStock stock,
        address deployer
    ) private {
        uint256 stockOut = venue.quoteExactInput(usdc, address(stock), 1 * 1e6);
        uint256 executedStock =
            venue.swapExactInput(usdc, address(stock), 1 * 1e6, stockOut, deployer);
        uint256 usdcOut = venue.quoteExactInput(address(stock), usdc, executedStock);
        require(
            venue.swapExactInput(address(stock), usdc, executedStock, usdcOut, deployer) == usdcOut,
            "USDC/MockStock round trip failed"
        );
    }

    function _verifyAllPools(Deployment memory deployment) private view {
        Validation.verifyPool(
            deployment.venue,
            deployment.weth,
            deployment.usdc,
            Config.WETH_USDC_SEED_LIQUIDITY,
            Validation.wethUsdcSeedPrice(deployment.weth, deployment.usdc)
        );
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            address stock = address(deployment.stocks[index]);
            Validation.verifyPool(
                deployment.venue,
                deployment.usdc,
                stock,
                Config.USDC_STOCK_SEED_LIQUIDITY,
                Validation.usdcStockSeedPrice(deployment.usdc, stock)
            );
        }
    }

    function _logDeployment(Deployment memory deployment) private pure {
        console2.log(
            deployment.selfFunded
                ? "PROFILE self-funded-test-assets"
                : "PROFILE official-test-assets"
        );
        console2.log("weth", deployment.weth);
        console2.log("usdc", deployment.usdc);
        console2.log("testConversionVenue", address(deployment.venue));
        for (uint256 index = 0; index < Config.STOCK_COUNT; ++index) {
            Config.StockConfiguration memory stockConfig = Config.stockConfiguration(index);
            console2.log(stockConfig.contractManifestKey, address(deployment.stocks[index]));
        }
        console2.log("Record these public values in deployments/84532.venue.json, then verify.");
    }

    function _approve(IERC20Minimal token, address spender) private {
        require(token.approve(spender, type(uint256).max), "test asset approval failed");
    }
}
