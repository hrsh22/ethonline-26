// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../FuelCore.sol";
import {IThresholdRecovery} from "../interfaces/IThresholdRecovery.sol";

/// @notice Local-Anvil recovery stand-in. Never deploy this contract to a public network.
contract DevelopmentRecoveryAuthority is IThresholdRecovery {
    address public immutable operator;
    uint256 private immutable _threshold;

    error InvalidConfiguration();
    error NotDevelopmentChain(uint256 chainId);
    error Unauthorized(address caller);

    constructor(address operator_, uint256 threshold_) {
        if (block.chainid != 31_337) revert NotDevelopmentChain(block.chainid);
        if (operator_ == address(0) || threshold_ < 2) revert InvalidConfiguration();
        operator = operator_;
        _threshold = threshold_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized(msg.sender);
        _;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function setFrozen(FuelCore core, address account, bool frozen) external onlyOperator {
        core.setFrozen(account, frozen);
    }

    function recoverLiquid(FuelCore core, address from, address to, uint256 amount)
        external
        onlyOperator
    {
        core.recoverLiquid(from, to, amount);
    }

    function recoverCollectible(FuelCore core, address from, address to, uint16 identityId)
        external
        onlyOperator
    {
        core.recoverCollectible(from, to, identityId);
    }
}
