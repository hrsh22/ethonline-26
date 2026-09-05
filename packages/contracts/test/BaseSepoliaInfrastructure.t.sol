// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseSepoliaInfrastructure} from "../src/deployment/BaseSepoliaInfrastructure.sol";

contract BaseSepoliaInfrastructureHarness {
    function validate(uint256 chainId, address weth, address usdc, address poolManager)
        external
        pure
    {
        BaseSepoliaInfrastructure.validate(chainId, weth, usdc, poolManager);
    }

    function validatePoolManager(uint256 chainId, address poolManager) external pure {
        BaseSepoliaInfrastructure.validatePoolManager(chainId, poolManager);
    }
}

contract BaseSepoliaInfrastructureTest {
    function testAcceptsOnlyOfficialSettlementConversionAssetsAndPoolManager() external {
        BaseSepoliaInfrastructureHarness harness = new BaseSepoliaInfrastructureHarness();
        harness.validate(
            BaseSepoliaInfrastructure.CHAIN_ID,
            BaseSepoliaInfrastructure.WETH,
            BaseSepoliaInfrastructure.USDC,
            BaseSepoliaInfrastructure.POOL_MANAGER
        );

        _requireRejected(
            harness,
            84_531,
            BaseSepoliaInfrastructure.WETH,
            BaseSepoliaInfrastructure.USDC,
            BaseSepoliaInfrastructure.POOL_MANAGER
        );
        _requireRejected(
            harness,
            BaseSepoliaInfrastructure.CHAIN_ID,
            address(0xBEEF),
            BaseSepoliaInfrastructure.USDC,
            BaseSepoliaInfrastructure.POOL_MANAGER
        );
        _requireRejected(
            harness,
            BaseSepoliaInfrastructure.CHAIN_ID,
            BaseSepoliaInfrastructure.WETH,
            address(0xCAFE),
            BaseSepoliaInfrastructure.POOL_MANAGER
        );
        _requireRejected(
            harness,
            BaseSepoliaInfrastructure.CHAIN_ID,
            BaseSepoliaInfrastructure.WETH,
            BaseSepoliaInfrastructure.USDC,
            address(0xD00D)
        );
    }

    function testSelfFundedProfileStillRejectsWrongChainOrPoolManager() external {
        BaseSepoliaInfrastructureHarness harness = new BaseSepoliaInfrastructureHarness();
        harness.validatePoolManager(
            BaseSepoliaInfrastructure.CHAIN_ID, BaseSepoliaInfrastructure.POOL_MANAGER
        );

        (bool wrongChain,) = address(harness)
            .call(
                abi.encodeCall(
                    BaseSepoliaInfrastructureHarness.validatePoolManager,
                    (uint256(84_531), BaseSepoliaInfrastructure.POOL_MANAGER)
                )
            );
        require(!wrongChain, "wrong chain was accepted");

        (bool wrongManager,) = address(harness)
            .call(
                abi.encodeCall(
                    BaseSepoliaInfrastructureHarness.validatePoolManager,
                    (BaseSepoliaInfrastructure.CHAIN_ID, address(0xD00D))
                )
            );
        require(!wrongManager, "wrong PoolManager was accepted");
    }

    function _requireRejected(
        BaseSepoliaInfrastructureHarness harness,
        uint256 chainId,
        address weth,
        address usdc,
        address poolManager
    ) private {
        (bool succeeded,) = address(harness)
            .call(
                abi.encodeCall(
                    BaseSepoliaInfrastructureHarness.validate, (chainId, weth, usdc, poolManager)
                )
            );
        require(!succeeded, "unofficial Base Sepolia infrastructure was accepted");
    }
}
