// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TwoStepOwnable} from "../src/governance/TwoStepOwnable.sol";

contract GovernedModule is TwoStepOwnable {
    uint256 public governedValue;

    constructor(address initialOwner) TwoStepOwnable(initialOwner) {}

    function setGovernedValue(uint256 value) external onlyOwner {
        governedValue = value;
    }
}

/// @dev A minimal multisig stand-in. It matters that the accepting party can be
///      a contract, because a Safe is the intended production owner.
contract AcceptingMultisig {
    function accept(TwoStepOwnable module) external {
        module.acceptOwnership();
    }

    function setValue(GovernedModule module, uint256 value) external {
        module.setGovernedValue(value);
    }
}

contract ModuleGovernanceTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant SUCCESSOR = address(0xB0B);
    address private constant STRANGER = address(0xBEEF);

    GovernedModule private module;

    function setUp() public {
        module = new GovernedModule(OWNER);
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableInvalidOwner.selector, address(0))
        );
        new GovernedModule(address(0));
    }

    function test_ownerIsSetAtDeployment() public view {
        assertEq(module.owner(), OWNER);
        assertEq(module.pendingOwner(), address(0));
    }

    function test_onlyOwnerPerformsGovernedOperation() public {
        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, STRANGER)
        );
        module.setGovernedValue(1);

        vm.prank(OWNER);
        module.setGovernedValue(7);
        assertEq(module.governedValue(), 7);
    }

    function test_transferDoesNotMoveOwnershipUntilAccepted() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);

        assertEq(module.owner(), OWNER);
        assertEq(module.pendingOwner(), SUCCESSOR);

        // The old owner still governs until the handover completes.
        vm.prank(OWNER);
        module.setGovernedValue(3);
        assertEq(module.governedValue(), 3);
    }

    function test_acceptCompletesHandoverAndRejectsOldOwner() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);
        vm.prank(SUCCESSOR);
        module.acceptOwnership();

        assertEq(module.owner(), SUCCESSOR);
        assertEq(module.pendingOwner(), address(0));

        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, OWNER));
        module.setGovernedValue(9);

        vm.prank(SUCCESSOR);
        module.setGovernedValue(11);
        assertEq(module.governedValue(), 11);
    }

    function test_onlyNomineeCanAccept() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);

        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, STRANGER)
        );
        module.acceptOwnership();
        assertEq(module.owner(), OWNER);
    }

    function test_acceptWithoutNominationReverts() public {
        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, STRANGER)
        );
        module.acceptOwnership();
    }

    function test_transferRejectsZeroAddress() public {
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableInvalidOwner.selector, address(0))
        );
        module.transferOwnership(address(0));
    }

    function test_transferRejectsCurrentOwner() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(TwoStepOwnable.OwnableInvalidOwner.selector, OWNER));
        module.transferOwnership(OWNER);
    }

    function test_cancelWithdrawsNomination() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);
        vm.prank(OWNER);
        module.cancelOwnershipTransfer();

        assertEq(module.pendingOwner(), address(0));
        vm.prank(SUCCESSOR);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, SUCCESSOR)
        );
        module.acceptOwnership();
        assertEq(module.owner(), OWNER);
    }

    function test_cancelWithoutNominationReverts() public {
        vm.prank(OWNER);
        vm.expectRevert(TwoStepOwnable.OwnableNoPendingTransfer.selector);
        module.cancelOwnershipTransfer();
    }

    function test_onlyOwnerCancels() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);
        vm.prank(STRANGER);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, STRANGER)
        );
        module.cancelOwnershipTransfer();
        assertEq(module.pendingOwner(), SUCCESSOR);
    }

    function test_nominationCanBeRedirectedBeforeAcceptance() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);
        vm.prank(OWNER);
        module.transferOwnership(STRANGER);

        assertEq(module.pendingOwner(), STRANGER);
        vm.prank(SUCCESSOR);
        vm.expectRevert(
            abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, SUCCESSOR)
        );
        module.acceptOwnership();
    }

    /// @dev The handover a production deployment actually performs.
    function test_multisigHandoverDrill() public {
        AcceptingMultisig safe = new AcceptingMultisig();

        vm.prank(OWNER);
        module.transferOwnership(address(safe));
        safe.accept(module);

        assertEq(module.owner(), address(safe));

        // The multisig can perform the exact governed operation.
        safe.setValue(module, 42);
        assertEq(module.governedValue(), 42);

        // And the replaced key cannot.
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, OWNER));
        module.setGovernedValue(43);
    }

    /// @dev A compromised key is replaced while it still functions. Once the
    ///      successor accepts, the compromised key has no authority.
    function test_compromisedKeyRecoveryDrill() public {
        AcceptingMultisig safe = new AcceptingMultisig();

        vm.prank(OWNER);
        module.transferOwnership(address(safe));
        safe.accept(module);

        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(TwoStepOwnable.OwnableUnauthorized.selector, OWNER));
        module.transferOwnership(STRANGER);
        assertEq(module.owner(), address(safe));
    }

    function test_ownershipCanBeHandedOnAgain() public {
        vm.prank(OWNER);
        module.transferOwnership(SUCCESSOR);
        vm.prank(SUCCESSOR);
        module.acceptOwnership();

        vm.prank(SUCCESSOR);
        module.transferOwnership(STRANGER);
        vm.prank(STRANGER);
        module.acceptOwnership();

        assertEq(module.owner(), STRANGER);
    }
}
