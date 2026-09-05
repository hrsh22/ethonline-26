// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library TickSpacingTestHelper {
    int24 private constant _CANONICAL_TICK_SPACING = 60;

    function floorToCanonicalSpacing(int24 tick) internal pure returns (int24) {
        int24 remainder = tick % _CANONICAL_TICK_SPACING;
        return remainder < 0 ? tick - remainder - _CANONICAL_TICK_SPACING : tick - remainder;
    }

    function ceilToCanonicalSpacing(int24 tick) internal pure returns (int24) {
        int24 remainder = tick % _CANONICAL_TICK_SPACING;
        return remainder > 0 ? tick - remainder + _CANONICAL_TICK_SPACING : tick - remainder;
    }
}
