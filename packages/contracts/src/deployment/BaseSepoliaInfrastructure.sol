// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fail-closed constants for the valueless Base Sepolia POC venue.
library BaseSepoliaInfrastructure {
    uint256 internal constant CHAIN_ID = 84_532;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    error MissingCode(address target);
    error UnofficialPoolManager(address supplied);
    error UnofficialUsdc(address supplied);
    error UnofficialWeth(address supplied);
    error UnexpectedChainId(uint256 supplied);

    function validate(uint256 chainId, address weth, address usdc, address poolManager)
        internal
        pure
    {
        validatePoolManager(chainId, poolManager);
        if (weth != WETH) revert UnofficialWeth(weth);
        if (usdc != USDC) revert UnofficialUsdc(usdc);
    }

    function validatePoolManager(uint256 chainId, address poolManager) internal pure {
        if (chainId != CHAIN_ID) revert UnexpectedChainId(chainId);
        if (poolManager != POOL_MANAGER) revert UnofficialPoolManager(poolManager);
    }

    function validateDeployedOfficialInfrastructure() internal view {
        validateDeployedPoolManager();
        if (WETH.code.length == 0) revert MissingCode(WETH);
        if (USDC.code.length == 0) revert MissingCode(USDC);
    }

    function validateDeployedPoolManager() internal view {
        validatePoolManager(block.chainid, POOL_MANAGER);
        if (POOL_MANAGER.code.length == 0) revert MissingCode(POOL_MANAGER);
    }
}
