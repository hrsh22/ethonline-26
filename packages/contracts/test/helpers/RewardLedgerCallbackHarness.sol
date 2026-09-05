// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IRewardLedgerCallbacks} from "../../src/interfaces/IRewardLedgerCallbacks.sol";

/// @notice Minimal callback boundary for ownership tests that do not exercise reward accounting.
contract RewardLedgerCallbackHarness is IRewardLedgerCallbacks {
    address public immutable override fuelCore;

    mapping(uint16 identityId => bool active) public isActive;

    error InactiveIdentity(uint16 identityId);
    error Unauthorized(address caller);

    constructor(address fuelCore_) {
        fuelCore = fuelCore_;
    }

    modifier onlyFuelCore() {
        if (msg.sender != fuelCore) revert Unauthorized(msg.sender);
        _;
    }

    function activate(uint16 identityId) external onlyFuelCore {
        isActive[identityId] = true;
    }

    function checkpointBeforeTransfer(uint16 identityId) external view onlyFuelCore {
        if (!isActive[identityId]) revert InactiveIdentity(identityId);
    }

    function checkpointAfterTransfer(uint16 identityId) external view onlyFuelCore {
        if (!isActive[identityId]) revert InactiveIdentity(identityId);
    }
}
