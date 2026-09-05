// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICollectibleMetadata {
    function tokenURI(uint16 identityId, bool permanent) external view returns (string memory);
}
