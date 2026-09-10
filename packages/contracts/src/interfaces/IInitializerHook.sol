// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Interface required by Uniswap Liquidity Launcher's LBP strategy.
/// @dev Kept locally to avoid coupling ORBIT's v4 types to the launcher's newer v4 dependency.
/// Source revision: Uniswap/liquidity-launcher 873cbb23, src/interfaces/IInitializerHook.sol.
interface IInitializerHook is IERC165 {
    function authorized() external view returns (address);
}
