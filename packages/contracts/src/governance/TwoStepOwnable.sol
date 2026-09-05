// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title TwoStepOwnable
/// @notice Module ownership that can be handed over without a single mistyped
///         address destroying governance.
/// @dev This replaces two distinct defects. Most modules declared
///      `address public immutable owner`, so a compromised or lost key could
///      never be replaced and recovery could not substitute a new owner.
///      `FuelCore` had the opposite problem: a single-step transfer guarded only
///      against the zero address, so one mistyped nominee silently forfeited the
///      launch, pause, discovery, and blocklist authority of the widest
///      privileged surface in the protocol, irrecoverably. The handover is
///      therefore two steps - the current owner nominates, and the nominee must
///      accept from the very key that will hold the role, which proves the key
///      works before the old one is dropped.
abstract contract TwoStepOwnable {
    address public owner;
    /// @notice The nominated owner, which must accept before it takes effect.
    address public pendingOwner;

    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferAccepted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferCancelled(address indexed currentOwner, address indexed cancelledOwner);

    error OwnableUnauthorized(address caller);
    error OwnableInvalidOwner(address candidate);
    error OwnableNoPendingTransfer();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OwnableUnauthorized(msg.sender);
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert OwnableInvalidOwner(initialOwner);
        owner = initialOwner;
        emit OwnershipTransferAccepted(address(0), initialOwner);
    }

    /// @notice Nominates a new owner. Ownership does not move until accepted.
    /// @dev A Safe or other multisig is a valid nominee; it accepts through its
    ///      own transaction, which also proves the multisig can execute.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0) || newOwner == owner) revert OwnableInvalidOwner(newOwner);
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Withdraws a pending nomination. Ownership is unchanged.
    function cancelOwnershipTransfer() external onlyOwner {
        address cancelled = pendingOwner;
        if (cancelled == address(0)) revert OwnableNoPendingTransfer();
        pendingOwner = address(0);
        emit OwnershipTransferCancelled(owner, cancelled);
    }

    /// @notice Completes the handover. Only the nominee can call this, so the
    ///         new key is proven to work before the old one loses authority.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OwnableUnauthorized(msg.sender);
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferAccepted(previousOwner, msg.sender);
    }
}
