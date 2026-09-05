// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDiscoveryAdapter} from "../interfaces/IDiscoveryAdapter.sol";

contract DeterministicDiscoveryAdapter is IDiscoveryAdapter {
    bytes32 public immutable seed;

    constructor(bytes32 seed_) {
        seed = seed_;
    }

    function requestDiscovery(address, uint256 firstNonce, uint256 count)
        external
        view
        returns (DiscoveryResponse memory response)
    {
        bytes32[] memory entropies = new bytes32[](count);
        for (uint256 index; index < count; ++index) {
            entropies[index] = bytes32(uint256(seed) + firstNonce + index);
        }
        response = DiscoveryResponse({
            immediate: true, entropies: entropies, requestIds: new bytes32[](0)
        });
    }
}
