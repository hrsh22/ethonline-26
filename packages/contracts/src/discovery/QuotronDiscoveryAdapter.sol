// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    VRFConsumerBaseV2Plus
} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {IDiscoveryAdapter} from "../interfaces/IDiscoveryAdapter.sol";

interface IFuelDiscoveryReceiver {
    function fulfillDiscovery(bytes32 requestId, bytes32 entropy) external returns (bool accepted);

    function isPendingDiscovery(bytes32 requestId) external view returns (bool);
}

/// @notice Requests one Chainlink VRF seed for each acquisition batch, then exposes
///         retryable, permissionless finalization in bounded chunks.
/// @dev The coordinator callback only persists verified randomness. Identity selection
///      and minting happen later through `finalizeDiscovery`, so application work can
///      revert and be retried without losing the one-shot VRF callback. Every protocol
///      request derives domain-separated entropy from the same verified seed. A
///      cancelled FuelCore request still consumes its derived result but cannot
///      materialize an identity.
contract QuotronDiscoveryAdapter is IDiscoveryAdapter, VRFConsumerBaseV2Plus {
    uint256 public constant MAX_DISCOVERIES_PER_REQUEST = 64;
    uint256 public constant MAX_FINALIZATION_MUTATIONS = 8;
    uint256 public constant DELAY_THRESHOLD = 15 minutes;

    enum RequestState {
        Unknown,
        AwaitingRandomness,
        Ready,
        Finalized
    }

    struct VrfRequest {
        RequestState state;
        uint64 requestedAt;
        uint64 fulfilledAt;
        uint16 count;
        uint16 finalizedCount;
        bool delayReported;
        uint256 randomWord;
    }

    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16 public immutable requestConfirmations;
    uint32 public immutable callbackGasLimit;

    address public fuelCore;

    mapping(uint256 vrfRequestId => bytes32[] protocolRequestIds) private _protocolRequestIds;
    mapping(uint256 vrfRequestId => VrfRequest request) private _vrfRequests;
    mapping(bytes32 protocolRequestId => uint256 vrfRequestId) public vrfRequestForProtocolRequest;
    mapping(uint256 vrfRequestId => uint256 sequence) public requestSequence;
    mapping(uint256 sequence => uint256 vrfRequestId) public vrfRequestIdAtSequence;

    uint256 public requestSequenceCount;
    uint256 public nextFinalizationSequence;

    bool private _finalizing;

    error FuelCoreAlreadyConfigured(address configured);
    error InvalidConfiguration();
    error InvalidFinalizationCount(uint256 count);
    error DiscoveryStillActive(bytes32 requestId);
    error NotFuelCore(address caller);
    error RequestFinalizationOutOfOrder(
        uint256 requestId, uint256 sequence, uint256 expectedSequence
    );
    error RequestNotReady(uint256 requestId, RequestState state);
    error RequestNotDelayed(uint256 requestId, uint256 reportableAt);
    error ReentrantFinalization();

    event FuelCoreConfigured(address indexed fuelCore);
    event DiscoveryRandomnessRequested(uint256 indexed vrfRequestId, uint256 count);
    event DiscoveryRandomnessReady(uint256 indexed vrfRequestId, uint256 count);
    event DiscoveryRandomnessDelayed(
        uint256 indexed vrfRequestId, uint256 requestedAt, uint256 reportedAt
    );
    event UnexpectedRandomnessIgnored(uint256 indexed vrfRequestId, uint256 wordCount);
    event DiscoveryFinalizationProgress(
        uint256 indexed vrfRequestId, uint256 finalizedCount, uint256 totalCount
    );
    event CancelledDiscoveryBatchSkipped(uint256 indexed vrfRequestId, uint256 count);
    event DiscoveryRandomnessFulfilled(
        uint256 indexed vrfRequestId, bytes32 indexed protocolRequestId, bool accepted
    );

    constructor(
        address coordinator,
        bytes32 keyHash_,
        uint256 subscriptionId_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_
    ) VRFConsumerBaseV2Plus(coordinator) {
        if (
            keyHash_ == bytes32(0) || subscriptionId_ == 0 || requestConfirmations_ == 0
                || callbackGasLimit_ == 0
        ) {
            revert InvalidConfiguration();
        }
        keyHash = keyHash_;
        subscriptionId = subscriptionId_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
    }

    /// @notice One-time deployment wiring before FuelCore launches.
    function setFuelCore(address fuelCore_) external onlyOwner {
        if (fuelCore != address(0)) revert FuelCoreAlreadyConfigured(fuelCore);
        if (fuelCore_.code.length == 0) revert InvalidConfiguration();
        fuelCore = fuelCore_;
        emit FuelCoreConfigured(fuelCore_);
    }

    function protocolRequestCount(uint256 vrfRequestId) external view returns (uint256) {
        return _protocolRequestIds[vrfRequestId].length;
    }

    function protocolRequestIdAt(uint256 vrfRequestId, uint256 index)
        external
        view
        returns (bytes32)
    {
        return _protocolRequestIds[vrfRequestId][index];
    }

    function requestStatus(uint256 vrfRequestId)
        external
        view
        returns (
            RequestState state,
            uint256 requestedAt,
            uint256 fulfilledAt,
            uint256 count,
            uint256 finalizedCount,
            bool delayReported
        )
    {
        VrfRequest storage request = _vrfRequests[vrfRequestId];
        return (
            request.state,
            request.requestedAt,
            request.fulfilledAt,
            request.count,
            request.finalizedCount,
            request.delayReported
        );
    }

    function isDelayed(uint256 vrfRequestId) public view returns (bool) {
        VrfRequest storage request = _vrfRequests[vrfRequestId];
        return request.state == RequestState.AwaitingRandomness
            && block.timestamp >= uint256(request.requestedAt) + DELAY_THRESHOLD;
    }

    function requestDiscovery(address, uint256 firstNonce, uint256 count)
        external
        returns (DiscoveryResponse memory response)
    {
        if (msg.sender != fuelCore) revert NotFuelCore(msg.sender);
        if (count == 0 || count > MAX_DISCOVERIES_PER_REQUEST) {
            revert InvalidConfiguration();
        }

        bytes32[] memory requestIds = new bytes32[](count);
        uint256 vrfRequestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
                )
            })
        );
        // The protocol caps count at 64 and timestamps remain well inside uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 compactCount = uint16(count);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 requestedAt = uint64(block.timestamp);
        _vrfRequests[vrfRequestId] = VrfRequest({
            state: RequestState.AwaitingRandomness,
            requestedAt: requestedAt,
            fulfilledAt: 0,
            count: compactCount,
            finalizedCount: 0,
            delayReported: false,
            randomWord: 0
        });
        uint256 sequence = requestSequenceCount;
        requestSequenceCount = sequence + 1;
        requestSequence[vrfRequestId] = sequence;
        vrfRequestIdAtSequence[sequence] = vrfRequestId;
        for (uint256 index; index < count; ++index) {
            bytes32 protocolRequestId =
                keccak256(abi.encode(address(this), vrfRequestId, firstNonce + index));
            _protocolRequestIds[vrfRequestId].push(protocolRequestId);
            vrfRequestForProtocolRequest[protocolRequestId] = vrfRequestId;
            requestIds[index] = protocolRequestId;
        }
        emit DiscoveryRandomnessRequested(vrfRequestId, count);

        response = DiscoveryResponse({
            immediate: false, entropies: new bytes32[](0), requestIds: requestIds
        });
    }

    /// @notice Emits one durable incident signal once a coordinator response is late.
    /// @dev Reporting does not cancel or replace randomness. Chainlink explicitly warns
    ///      that selective cancellation or re-requesting creates a reroll surface.
    function reportDelayedRequest(uint256 vrfRequestId) external returns (bool reported) {
        VrfRequest storage request = _vrfRequests[vrfRequestId];
        if (request.state != RequestState.AwaitingRandomness || request.delayReported) {
            return false;
        }
        uint256 reportableAt = uint256(request.requestedAt) + DELAY_THRESHOLD;
        if (block.timestamp < reportableAt) {
            revert RequestNotDelayed(vrfRequestId, reportableAt);
        }
        request.delayReported = true;
        emit DiscoveryRandomnessDelayed(vrfRequestId, request.requestedAt, block.timestamp);
        return true;
    }

    /// @notice Advances past a head batch only after every corresponding FuelCore
    ///         request was cancelled by ordinary Liquid Token movement.
    /// @dev This is the liveness recovery that preserves randomness integrity: no
    ///      replacement randomness is requested and no unseen result is revealed.
    function skipCancelledDiscovery(uint256 vrfRequestId) external returns (uint256 skipped) {
        VrfRequest storage request = _vrfRequests[vrfRequestId];
        if (request.state != RequestState.AwaitingRandomness && request.state != RequestState.Ready)
        {
            revert RequestNotReady(vrfRequestId, request.state);
        }
        uint256 sequence = requestSequence[vrfRequestId];
        if (
            sequence != nextFinalizationSequence
                || vrfRequestIdAtSequence[nextFinalizationSequence] != vrfRequestId
        ) {
            revert RequestFinalizationOutOfOrder(vrfRequestId, sequence, nextFinalizationSequence);
        }

        bytes32[] storage protocolRequestIds = _protocolRequestIds[vrfRequestId];
        for (uint256 index; index < protocolRequestIds.length; ++index) {
            bytes32 protocolRequestId = protocolRequestIds[index];
            if (IFuelDiscoveryReceiver(fuelCore).isPendingDiscovery(protocolRequestId)) {
                revert DiscoveryStillActive(protocolRequestId);
            }
        }

        skipped = request.count;
        request.finalizedCount = request.count;
        request.state = RequestState.Finalized;
        ++nextFinalizationSequence;
        delete _protocolRequestIds[vrfRequestId];
        emit CancelledDiscoveryBatchSkipped(vrfRequestId, skipped);
    }

    /// @notice Applies ready discovery results in retryable gas-bounded chunks.
    /// @dev Passing a larger count is safe: one call never performs more than the
    ///      measured mutation limit, while callers can repeat until `remaining` is zero.
    function finalizeDiscovery(uint256 vrfRequestId, uint256 maxCount)
        external
        returns (uint256 processed, uint256 remaining)
    {
        if (maxCount == 0) revert InvalidFinalizationCount(maxCount);
        if (_finalizing) revert ReentrantFinalization();

        VrfRequest storage request = _vrfRequests[vrfRequestId];
        if (request.state == RequestState.Finalized) return (0, 0);
        if (request.state != RequestState.Ready) {
            revert RequestNotReady(vrfRequestId, request.state);
        }
        uint256 sequence = requestSequence[vrfRequestId];
        if (
            sequence != nextFinalizationSequence
                || vrfRequestIdAtSequence[nextFinalizationSequence] != vrfRequestId
        ) {
            revert RequestFinalizationOutOfOrder(vrfRequestId, sequence, nextFinalizationSequence);
        }

        uint256 from = request.finalizedCount;
        uint256 boundedCount =
            maxCount < MAX_FINALIZATION_MUTATIONS ? maxCount : MAX_FINALIZATION_MUTATIONS;
        uint256 to = from + boundedCount;
        if (to > request.count) to = request.count;

        _finalizing = true;
        // Progress is written before external calls to close the reentrancy window. A
        // receiver revert rolls this write and every earlier mutation in the chunk back.
        // forge-lint: disable-next-line(unsafe-typecast)
        request.finalizedCount = uint16(to);
        if (to == request.count) request.state = RequestState.Finalized;
        for (uint256 index = from; index < to; ++index) {
            bytes32 protocolRequestId = _protocolRequestIds[vrfRequestId][index];
            bytes32 entropy = keccak256(abi.encode(request.randomWord, protocolRequestId));
            bool accepted =
                IFuelDiscoveryReceiver(fuelCore).fulfillDiscovery(protocolRequestId, entropy);
            emit DiscoveryRandomnessFulfilled(vrfRequestId, protocolRequestId, accepted);
        }
        _finalizing = false;

        processed = to - from;
        remaining = request.count - to;
        emit DiscoveryFinalizationProgress(vrfRequestId, to, request.count);
        if (remaining == 0) {
            ++nextFinalizationSequence;
            delete _protocolRequestIds[vrfRequestId];
        }
    }

    function fulfillRandomWords(uint256 vrfRequestId, uint256[] calldata randomWords)
        internal
        override
    {
        VrfRequest storage request = _vrfRequests[vrfRequestId];
        if (request.state != RequestState.AwaitingRandomness || randomWords.length == 0) {
            emit UnexpectedRandomnessIgnored(vrfRequestId, randomWords.length);
            return;
        }
        request.randomWord = randomWords[0];
        // forge-lint: disable-next-line(unsafe-typecast)
        request.fulfilledAt = uint64(block.timestamp);
        request.state = RequestState.Ready;
        emit DiscoveryRandomnessReady(vrfRequestId, request.count);
    }
}
