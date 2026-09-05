// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IVRFCoordinatorV2Plus
} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

import {QuotronDiscoveryAdapter} from "../discovery/QuotronDiscoveryAdapter.sol";

/// @notice Atomically creates, funds, and wires the protocol's VRF subscription.
/// @dev Chainlink subscription IDs include the previous block hash. Keeping every
///      operation that consumes the freshly created ID inside this constructor
///      prevents a deployment script from encoding a simulated ID into later
///      transactions. Anyone may top up the subscription directly at the
///      coordinator; ordinary discovery never requires this bootstrap again.
contract VrfSubscriptionBootstrap {
    IVRFCoordinatorV2Plus public immutable coordinator;
    uint256 public immutable subscriptionId;
    QuotronDiscoveryAdapter public immutable discovery;
    address public immutable deploymentOwner;

    bool public finalized;

    error AlreadyFinalized();
    error InvalidConfiguration();
    error NotDeploymentOwner(address caller);

    constructor(
        IVRFCoordinatorV2Plus coordinator_,
        bytes32 keyHash,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        address deploymentOwner_
    ) payable {
        if (
            address(coordinator_).code.length == 0 || keyHash == bytes32(0)
                || requestConfirmations == 0 || callbackGasLimit == 0
                || deploymentOwner_ == address(0) || msg.value == 0
        ) {
            revert InvalidConfiguration();
        }

        coordinator = coordinator_;
        deploymentOwner = deploymentOwner_;
        uint256 createdSubscriptionId = coordinator_.createSubscription();
        subscriptionId = createdSubscriptionId;
        coordinator_.fundSubscriptionWithNative{value: msg.value}(createdSubscriptionId);
        QuotronDiscoveryAdapter adapter = new QuotronDiscoveryAdapter(
            address(coordinator_),
            keyHash,
            createdSubscriptionId,
            requestConfirmations,
            callbackGasLimit
        );
        discovery = adapter;
        coordinator_.addConsumer(createdSubscriptionId, address(adapter));
    }

    /// @notice Completes one-time FuelCore wiring and offers adapter ownership
    ///         to the deployment owner, who can accept without passing the
    ///         block-derived subscription ID through another transaction.
    function finalizeFuelCore(address fuelCore) external {
        if (msg.sender != deploymentOwner) revert NotDeploymentOwner(msg.sender);
        if (finalized) revert AlreadyFinalized();
        finalized = true;
        discovery.setFuelCore(fuelCore);
        discovery.transferOwnership(deploymentOwner);
    }
}
