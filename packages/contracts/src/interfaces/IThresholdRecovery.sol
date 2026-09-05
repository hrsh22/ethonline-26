// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IThresholdRecovery {
    function getThreshold() external view returns (uint256);
}
