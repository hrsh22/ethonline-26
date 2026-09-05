// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Narrow callback surface used by FuelCore during Commitment and transfers.
interface IRewardLedgerCallbacks {
    function fuelCore() external view returns (address);
    function activate(uint16 identityId) external;
    function checkpointBeforeTransfer(uint16 identityId) external;
    function checkpointAfterTransfer(uint16 identityId) external;
}
