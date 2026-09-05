// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Decides whether the current Permanent Collectible owner may receive a claim.
interface IClaimGate {
    function isClaimAllowed(address currentOwner) external view returns (bool);
}
