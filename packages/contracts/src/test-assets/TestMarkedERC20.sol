// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestERC20} from "./TestERC20.sol";

/// @notice ERC-20 base that rejects metadata which could be mistaken for a production asset.
abstract contract TestMarkedERC20 is TestERC20 {
    error InvalidTestMetadata();

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        TestERC20(name_, symbol_, decimals_)
    {
        if (!_hasTestMarker(bytes(name_)) || !_hasTestMarker(bytes(symbol_))) {
            revert InvalidTestMetadata();
        }
    }

    function _hasTestMarker(bytes memory value) private pure returns (bool) {
        if (value.length < 4) return false;
        for (uint256 index = 0; index <= value.length - 4; ++index) {
            bytes4 marker;
            assembly ("memory-safe") {
                marker := mload(add(add(value, 0x20), index))
            }
            if (marker == 0x4d4f434b || marker == 0x54455354) return true;
        }
        return false;
    }
}
