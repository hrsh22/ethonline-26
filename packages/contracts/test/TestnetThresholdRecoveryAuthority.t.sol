// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {
    TestnetThresholdRecoveryAuthority
} from "../src/deployment/TestnetThresholdRecoveryAuthority.sol";

contract TestnetRecoveryTarget {
    address public lastAccount;
    address public lastRecipient;
    uint256 public lastAmount;
    bool public lastFrozen;

    function setFrozen(address account, bool frozen) external {
        lastAccount = account;
        lastFrozen = frozen;
    }

    function recoverLiquid(address from, address to, uint256 amount) external {
        lastAccount = from;
        lastRecipient = to;
        lastAmount = amount;
    }

    function recoverCollectible(address from, address to, uint16 identityId) external {
        lastAccount = from;
        lastRecipient = to;
        lastAmount = identityId;
    }
}

contract TestnetThresholdRecoveryAuthorityTest is Test {
    address private constant SIGNER_ONE = address(0xA11CE);
    address private constant SIGNER_TWO = address(0xB0B);
    bytes32 private constant SALT = keccak256("recovery-test");

    TestnetThresholdRecoveryAuthority private authority;
    TestnetRecoveryTarget private target;

    function setUp() external {
        vm.chainId(84_532);
        authority = new TestnetThresholdRecoveryAuthority(SIGNER_ONE, SIGNER_TWO);
        target = new TestnetRecoveryTarget();
    }

    function testRequiresTwoDistinctApprovalsBeforeExecuting() external {
        uint64 validUntilBlock = uint64(block.number + 100);

        vm.prank(SIGNER_ONE);
        authority.approveSetFrozen(
            FuelCore(address(target)), address(0xCAFE), true, SALT, validUntilBlock
        );
        require(target.lastAccount() == address(0), "first approval executed");

        vm.prank(SIGNER_TWO);
        authority.approveSetFrozen(
            FuelCore(address(target)), address(0xCAFE), true, SALT, validUntilBlock
        );
        require(target.lastAccount() == address(0xCAFE), "second approval did not execute");
        require(target.lastFrozen(), "freeze was not forwarded");
        require(authority.getThreshold() == 2, "wrong threshold");
    }

    function testSupportsEveryFuelRecoveryAction() external {
        uint64 validUntilBlock = uint64(block.number + 100);
        address from = address(0xF00D);
        address to = address(0xCAFE);

        vm.prank(SIGNER_ONE);
        authority.approveRecoverLiquid(
            FuelCore(address(target)), from, to, 12 ether, SALT, validUntilBlock
        );
        vm.prank(SIGNER_TWO);
        authority.approveRecoverLiquid(
            FuelCore(address(target)), from, to, 12 ether, SALT, validUntilBlock
        );
        require(target.lastAccount() == from, "liquid source mismatch");
        require(target.lastRecipient() == to, "liquid recipient mismatch");
        require(target.lastAmount() == 12 ether, "liquid amount mismatch");

        bytes32 collectibleSalt = keccak256("collectible-test");
        vm.prank(SIGNER_TWO);
        authority.approveRecoverCollectible(
            FuelCore(address(target)), from, to, 4444, collectibleSalt, validUntilBlock
        );
        vm.prank(SIGNER_ONE);
        authority.approveRecoverCollectible(
            FuelCore(address(target)), from, to, 4444, collectibleSalt, validUntilBlock
        );
        require(target.lastAmount() == 4444, "collectible identity mismatch");
    }

    function testRejectsUnauthorizedDuplicateExpiredAndReplayedApprovals() external {
        uint64 validUntilBlock = uint64(block.number + 100);

        vm.expectRevert();
        authority.approveSetFrozen(
            FuelCore(address(target)), address(1), true, SALT, validUntilBlock
        );

        vm.startPrank(SIGNER_ONE);
        authority.approveSetFrozen(
            FuelCore(address(target)), address(1), true, SALT, validUntilBlock
        );
        vm.expectRevert();
        authority.approveSetFrozen(
            FuelCore(address(target)), address(1), true, SALT, validUntilBlock
        );
        vm.stopPrank();

        vm.prank(SIGNER_TWO);
        authority.approveSetFrozen(
            FuelCore(address(target)), address(1), true, SALT, validUntilBlock
        );

        vm.prank(SIGNER_ONE);
        vm.expectRevert();
        authority.approveSetFrozen(
            FuelCore(address(target)), address(1), true, SALT, validUntilBlock
        );

        vm.roll(validUntilBlock + 1);
        vm.prank(SIGNER_ONE);
        vm.expectRevert();
        authority.approveSetFrozen(
            FuelCore(address(target)), address(2), true, keccak256("expired"), validUntilBlock
        );
    }

    function testRejectsInvalidSignersAndNonBaseSepoliaDeployment() external {
        vm.expectRevert();
        new TestnetThresholdRecoveryAuthority(SIGNER_ONE, SIGNER_ONE);

        vm.chainId(1);
        vm.expectRevert();
        new TestnetThresholdRecoveryAuthority(SIGNER_ONE, SIGNER_TWO);
    }
}
