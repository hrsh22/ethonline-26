// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

interface ICcaBidEscrowFuel is IERC20Minimal {
    function launched() external view returns (bool);
}

/// @notice Fixed-beneficiary custody for CCA token claims and currency refunds.
/// @dev Anyone may trigger a withdrawal, but assets can only go to `beneficiary`.
contract CcaBidEscrow {
    uint256 public constant MAX_FUEL_WITHDRAWAL = 64 ether;

    address public immutable beneficiary;
    ICcaBidEscrowFuel public immutable fuel;
    IERC20Minimal public immutable currency;

    bool private _entered;

    error FuelNotLaunched();
    error InvalidConfiguration(address account);
    error Reentrancy();
    error TransferFailed(address token, uint256 amount);

    event Withdrawal(address indexed token, address indexed beneficiary, uint256 amount);

    constructor(address beneficiary_, address fuel_, address currency_) {
        if (beneficiary_ == address(0)) revert InvalidConfiguration(beneficiary_);
        if (fuel_ == address(0) || fuel_.code.length == 0) {
            revert InvalidConfiguration(fuel_);
        }
        if (currency_ == address(0) || currency_.code.length == 0 || currency_ == fuel_) {
            revert InvalidConfiguration(currency_);
        }

        beneficiary = beneficiary_;
        fuel = ICcaBidEscrowFuel(fuel_);
        currency = IERC20Minimal(currency_);
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @notice Sends every available currency refund to the fixed beneficiary.
    /// @dev This remains usable before FUEL trading launches and after failed launches.
    function withdrawCurrency() external nonReentrant returns (uint256 amount) {
        amount = currency.balanceOf(address(this));
        _transfer(currency, amount);
    }

    /// @notice Sends the next discovery-safe tranche of FUEL to the fixed beneficiary.
    function withdrawFuel() external nonReentrant returns (uint256 amount) {
        if (!fuel.launched()) revert FuelNotLaunched();

        uint256 balance = fuel.balanceOf(address(this));
        amount = balance > MAX_FUEL_WITHDRAWAL ? MAX_FUEL_WITHDRAWAL : balance;
        _transfer(fuel, amount);
    }

    function _transfer(IERC20Minimal token, uint256 amount) private {
        if (amount == 0) return;
        if (!token.transfer(beneficiary, amount)) {
            revert TransferFailed(address(token), amount);
        }
        emit Withdrawal(address(token), beneficiary, amount);
    }
}
