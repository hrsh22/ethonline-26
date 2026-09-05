// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICanonicalFeeHook {
    function manager() external view returns (address);

    function registry() external view returns (address);

    function weth() external view returns (address);

    function rewardDestination() external view returns (address);

    function rewardPot() external view returns (uint256);

    function pullRewardPot(uint256 amount) external;

    function liquidityDestination() external view returns (address);

    function liquidityPot() external view returns (uint256);

    function pullLiquidityPot(uint256 amount) external;

    function isAuthorizedFuelSettlement(address operator, address from, address to)
        external
        view
        returns (bool);
}
