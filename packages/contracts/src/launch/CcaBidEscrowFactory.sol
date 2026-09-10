// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CcaBidEscrow} from "./CcaBidEscrow.sol";

/// @notice Narrow launch-coordinator surface used while the coordinator owns FuelCore.
interface ICcaLaunchEscrowRegistrar {
    function registerLaunchEscrow(address escrow) external;
}

/// @notice Deploys and registers one deterministic CCA bid escrow per beneficiary.
contract CcaBidEscrowFactory {
    address public immutable fuel;
    address public immutable currency;
    ICcaLaunchEscrowRegistrar public immutable registrar;

    mapping(address beneficiary => address escrow) public escrowOf;
    mapping(address escrow => address beneficiary) public beneficiaryOf;
    mapping(address escrow => bool registered) public isEscrow;

    bool private _entered;

    error InvalidConfiguration(address account);
    error Reentrancy();

    event EscrowDeployed(address indexed beneficiary, address indexed escrow);

    constructor(address fuel_, address currency_, address registrar_) {
        if (fuel_ == address(0) || fuel_.code.length == 0) {
            revert InvalidConfiguration(fuel_);
        }
        if (currency_ == address(0) || currency_.code.length == 0 || currency_ == fuel_) {
            revert InvalidConfiguration(currency_);
        }
        if (registrar_ == address(0) || registrar_.code.length == 0) {
            revert InvalidConfiguration(registrar_);
        }

        fuel = fuel_;
        currency = currency_;
        registrar = ICcaLaunchEscrowRegistrar(registrar_);
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Deploys the beneficiary's escrow and registers its FuelCore custody policy.
    /// @dev Repeated calls are idempotent and do not repeat coordinator registration.
    function deployEscrow(address beneficiary) external nonReentrant returns (address escrow) {
        if (beneficiary == address(0)) revert InvalidConfiguration(beneficiary);

        escrow = escrowOf[beneficiary];
        if (escrow != address(0)) return escrow;

        escrow =
            address(new CcaBidEscrow{salt: escrowSalt(beneficiary)}(beneficiary, fuel, currency));
        registrar.registerLaunchEscrow(escrow);

        escrowOf[beneficiary] = escrow;
        beneficiaryOf[escrow] = beneficiary;
        isEscrow[escrow] = true;
        emit EscrowDeployed(beneficiary, escrow);
    }

    function predictEscrow(address beneficiary) external view returns (address) {
        if (beneficiary == address(0)) revert InvalidConfiguration(beneficiary);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(CcaBidEscrow).creationCode, abi.encode(beneficiary, fuel, currency)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(this), escrowSalt(beneficiary), initCodeHash
                        )
                    )
                )
            )
        );
    }

    function escrowSalt(address beneficiary) public pure returns (bytes32) {
        return keccak256(abi.encode(beneficiary));
    }
}
