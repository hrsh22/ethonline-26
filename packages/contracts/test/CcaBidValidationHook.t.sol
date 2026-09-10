// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IValidationHook
} from "../lib/continuous-clearing-auction/src/interfaces/IValidationHook.sol";
import {CcaBidEscrow} from "../src/launch/CcaBidEscrow.sol";
import {
    CcaBidEscrowFactory,
    ICcaLaunchEscrowRegistrar
} from "../src/launch/CcaBidEscrowFactory.sol";
import {CcaBidValidationHook} from "../src/launch/CcaBidValidationHook.sol";

contract CcaHookTestToken {
    bool public launched;
    mapping(address account => uint256 balance) public balanceOf;

    function transfer(address recipient, uint256 amount) external returns (bool) {
        uint256 available = balanceOf[msg.sender];
        require(available >= amount, "insufficient test balance");
        balanceOf[msg.sender] = available - amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract CcaHookRegistrarMock is ICcaLaunchEscrowRegistrar {
    mapping(address escrow => bool registered) public isRegistered;

    function registerLaunchEscrow(address escrow) external {
        isRegistered[escrow] = true;
    }
}

contract CcaAuctionCallerMock {
    function validate(
        CcaBidValidationHook hook,
        uint256 maxPrice,
        uint128 amount,
        address owner,
        address sender,
        bytes calldata hookData
    ) external view {
        hook.validate(maxPrice, amount, owner, sender, hookData);
    }
}

contract CcaBidValidationHookTest {
    address private constant _BENEFICIARY = address(0xA11CE);
    address private constant _OTHER_PAYER = address(0xB0B);

    function testRegisteredEscrowAcceptsOnlyItsBeneficiaryAsBidSender() external {
        (CcaBidEscrowFactory factory, CcaAuctionCallerMock auction, CcaBidValidationHook hook) =
            _deploy();
        address escrow = factory.deployEscrow(_BENEFICIARY);

        auction.validate(hook, 123, 456, escrow, _BENEFICIARY, hex"cafe");

        (bool accepted, bytes memory reason) = address(auction)
            .call(
                abi.encodeCall(
                    CcaAuctionCallerMock.validate, (hook, 123, 456, escrow, _OTHER_PAYER, bytes(""))
                )
            );
        require(!accepted, "mismatched payer was accepted");
        require(
            _selector(reason) == CcaBidValidationHook.PayerMismatch.selector,
            "wrong payer-mismatch error"
        );
    }

    function testRejectsUnregisteredOwnerEvenIfItIsACompatibleEscrowContract() external {
        (CcaBidEscrowFactory factory, CcaAuctionCallerMock auction, CcaBidValidationHook hook) =
            _deploy();
        CcaBidEscrow unregistered =
            new CcaBidEscrow(_BENEFICIARY, factory.fuel(), factory.currency());

        (bool accepted, bytes memory reason) = address(auction)
            .call(
                abi.encodeCall(
                    CcaAuctionCallerMock.validate,
                    (hook, 1, 1, address(unregistered), _BENEFICIARY, bytes(""))
                )
            );
        require(!accepted, "unregistered escrow was accepted");
        require(
            _selector(reason) == CcaBidValidationHook.UnregisteredEscrow.selector,
            "wrong unregistered-owner error"
        );
    }

    function testRejectsCallsFromAnyAddressOtherThanBoundAuction() external {
        (CcaBidEscrowFactory factory,, CcaBidValidationHook hook) = _deploy();
        address escrow = factory.deployEscrow(_BENEFICIARY);

        (bool accepted, bytes memory reason) = address(hook)
            .call(
                abi.encodeCall(
                    IValidationHook.validate,
                    (uint256(1), uint128(1), escrow, _BENEFICIARY, bytes(""))
                )
            );
        require(!accepted, "non-auction caller was accepted");
        require(
            _selector(reason) == CcaBidValidationHook.UnauthorizedAuction.selector,
            "wrong auction-caller error"
        );
    }

    function testHookUsesOfficialValidationSelectorAndImmutableBindings() external {
        (CcaBidEscrowFactory factory, CcaAuctionCallerMock auction, CcaBidValidationHook hook) =
            _deploy();

        require(
            CcaBidValidationHook.validate.selector == IValidationHook.validate.selector,
            "validation selector drifted"
        );
        require(hook.auction() == address(auction), "auction binding drifted");
        require(address(hook.factory()) == address(factory), "factory binding drifted");
    }

    function _deploy()
        private
        returns (
            CcaBidEscrowFactory factory,
            CcaAuctionCallerMock auction,
            CcaBidValidationHook hook
        )
    {
        CcaHookTestToken fuel = new CcaHookTestToken();
        CcaHookTestToken currency = new CcaHookTestToken();
        CcaHookRegistrarMock registrar = new CcaHookRegistrarMock();
        factory = new CcaBidEscrowFactory(address(fuel), address(currency), address(registrar));
        auction = new CcaAuctionCallerMock();
        hook = new CcaBidValidationHook(address(auction), factory);
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(reason, 0x20))
        }
    }
}
