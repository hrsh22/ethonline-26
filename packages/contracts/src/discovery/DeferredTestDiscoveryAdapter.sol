// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IDiscoveryAdapter} from "../interfaces/IDiscoveryAdapter.sol";

interface IDeferredDiscoveryReceiver {
    function fulfillDiscovery(bytes32 requestId, bytes32 entropy) external returns (bool);
}

contract DeferredTestDiscoveryAdapter is IDiscoveryAdapter {
    mapping(bytes32 requestId => address requester) public requesterOf;

    error UnknownRequest(bytes32 requestId);

    function requestDiscovery(address recipient, uint256 firstNonce, uint256 count)
        external
        returns (DiscoveryResponse memory response)
    {
        bytes32[] memory requestIds = new bytes32[](count);
        for (uint256 index; index < count; ++index) {
            bytes32 requestId =
                keccak256(abi.encode(msg.sender, recipient, firstNonce + index, address(this)));
            requesterOf[requestId] = msg.sender;
            requestIds[index] = requestId;
        }
        response = DiscoveryResponse({
            immediate: false, entropies: new bytes32[](0), requestIds: requestIds
        });
    }

    function fulfill(bytes32 requestId, bytes32 entropy) external returns (bool) {
        address requester = requesterOf[requestId];
        if (requester == address(0)) revert UnknownRequest(requestId);
        return IDeferredDiscoveryReceiver(requester).fulfillDiscovery(requestId, entropy);
    }
}
