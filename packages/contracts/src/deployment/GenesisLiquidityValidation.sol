// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../FuelCore.sol";
import {GenesisLiquidityVault} from "../liquidity/GenesisLiquidityVault.sol";

/// @notice Shared distribution checks for broadcast-time and confirmed-state verification.
library GenesisLiquidityValidation {
    function verifyDistribution(
        FuelCore liquidToken,
        GenesisLiquidityVault vault,
        address deployer,
        address treasury
    ) internal view {
        require(liquidToken.balanceOf(deployer) == 0, "deployer retained Liquid Tokens");
        if (treasury != address(0)) {
            require(liquidToken.balanceOf(treasury) == 0, "treasury retained Liquid Tokens");
        }
        require(liquidToken.isDiscoveryExempt(address(vault)), "vault is not Discovery Draw-exempt");
        require(
            liquidToken.isDiscoveryExempt(address(vault.manager())),
            "PoolManager is not Discovery Draw-exempt"
        );
        require(
            !liquidToken.isDiscoveryExempt(deployer), "deployer setup exemption was not cleared"
        );
        require(
            vault.seededLiquidTokenAmount() + vault.roundingDust() == vault.GENESIS_SUPPLY(),
            "Genesis Liquidity distribution is incomplete"
        );
    }
}
