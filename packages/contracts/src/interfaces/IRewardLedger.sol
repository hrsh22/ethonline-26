// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../AttributeRegistry.sol";
import {IRewardLedgerCallbacks} from "./IRewardLedgerCallbacks.sol";

/// @notice Public RewardLedger surface for conversion, claims, and reward reads.
interface IRewardLedger is IRewardLedgerCallbacks {
    function epochConverter() external view returns (address);
    function notifyReward(AttributeRegistry.RewardTrack track, address token, uint256 amount)
        external;
    function claim(uint16[] calldata identityIds) external;
    function pending(uint16 identityId, AttributeRegistry.RewardTrack track)
        external
        view
        returns (uint256 amount);
    function pendingAll(uint16 identityId) external view returns (uint256[4] memory amounts);
    function rewardToken(AttributeRegistry.RewardTrack track) external view returns (address);
    function totalActiveWeight(AttributeRegistry.RewardTrack track) external view returns (uint256);
    function unclaimedTrackPot(AttributeRegistry.RewardTrack track) external view returns (uint256);
    function totalLiability(AttributeRegistry.RewardTrack track) external view returns (uint256);
}
