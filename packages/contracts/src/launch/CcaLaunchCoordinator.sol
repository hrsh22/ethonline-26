// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICcaLaunchFuel {
    function owner() external view returns (address);

    function pendingOwner() external view returns (address);

    function launched() external view returns (bool);

    function acceptOwnership() external;

    function transferOwnership(address newOwner) external;

    function setDiscoveryExempt(address account, bool exempt) external;

    function setProtectedAccount(address account, bool protected_) external;

    function launch() external;
}

interface ICcaLaunchReadiness {
    function isReady() external view returns (bool);
}

/// @notice Temporary FuelCore owner that enforces auction-to-pool completion before trading opens.
contract CcaLaunchCoordinator {
    ICcaLaunchFuel public immutable fuel;
    ICcaLaunchReadiness public immutable readiness;
    address public immutable configurationAuthority;
    address public immutable governanceOwner;

    address public escrowFactory;
    bool public configurationSealed;
    bool public activated;

    error InvalidConfiguration(address configured);
    error Unauthorized(address caller);
    error ConfigurationSealed();
    error ConfigurationIncomplete();
    error FuelOwnershipNotOffered(address pendingOwner);
    error FuelOwnershipMissing(address currentOwner);
    error LaunchNotReady();
    error AlreadyActivated();

    event EscrowFactoryConfigured(address indexed factory);
    event ConfigurationFinalized();
    event LaunchEscrowRegistered(address indexed escrow);
    event FuelOwnershipAccepted();
    event FuelActivated(address indexed governanceOwner);

    constructor(
        ICcaLaunchFuel fuel_,
        ICcaLaunchReadiness readiness_,
        address configurationAuthority_,
        address governanceOwner_
    ) {
        if (
            address(fuel_).code.length == 0 || address(readiness_).code.length == 0
                || configurationAuthority_ == address(0) || governanceOwner_ == address(0)
        ) revert InvalidConfiguration(address(0));
        fuel = fuel_;
        readiness = readiness_;
        configurationAuthority = configurationAuthority_;
        governanceOwner = governanceOwner_;
    }

    function configureEscrowFactory(address factory) external {
        if (msg.sender != configurationAuthority) revert Unauthorized(msg.sender);
        if (configurationSealed) revert ConfigurationSealed();
        if (factory.code.length == 0 || escrowFactory != address(0)) {
            revert InvalidConfiguration(factory);
        }
        escrowFactory = factory;
        emit EscrowFactoryConfigured(factory);
    }

    function sealConfiguration() external {
        if (msg.sender != configurationAuthority) revert Unauthorized(msg.sender);
        if (configurationSealed) revert ConfigurationSealed();
        if (escrowFactory == address(0)) revert ConfigurationIncomplete();
        configurationSealed = true;
        emit ConfigurationFinalized();
    }

    /// @notice Accepts the pre-auction FuelCore ownership offer after fixed setup is complete.
    function acceptFuelOwnership() external {
        if (!configurationSealed) revert ConfigurationIncomplete();
        address pending = fuel.pendingOwner();
        if (pending != address(this)) revert FuelOwnershipNotOffered(pending);
        fuel.acceptOwnership();
        emit FuelOwnershipAccepted();
    }

    /// @notice Registers a deterministic bidder escrow while FuelCore remains pre-launch.
    function registerLaunchEscrow(address escrow) external {
        if (msg.sender != escrowFactory) revert Unauthorized(msg.sender);
        if (!configurationSealed || activated || escrow.code.length == 0) {
            revert InvalidConfiguration(escrow);
        }
        if (fuel.owner() != address(this)) revert FuelOwnershipMissing(fuel.owner());
        fuel.setDiscoveryExempt(escrow, true);
        fuel.setProtectedAccount(escrow, true);
        emit LaunchEscrowRegistered(escrow);
    }

    /// @notice Opens FUEL trading only after the exact hooked pool owns permanently locked liquidity.
    function activate() external {
        if (activated) revert AlreadyActivated();
        if (fuel.owner() != address(this)) revert FuelOwnershipMissing(fuel.owner());
        if (!readiness.isReady()) revert LaunchNotReady();
        activated = true;
        fuel.launch();
        if (governanceOwner != address(this)) fuel.transferOwnership(governanceOwner);
        emit FuelActivated(governanceOwner);
    }
}
