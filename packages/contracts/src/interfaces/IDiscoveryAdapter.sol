// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IDiscoveryAdapter {
    struct DiscoveryResponse {
        bool immediate;
        bytes32[] entropies;
        bytes32[] requestIds;
    }

    function requestDiscovery(address recipient, uint256 firstNonce, uint256 count)
        external
        returns (DiscoveryResponse memory response);
}
