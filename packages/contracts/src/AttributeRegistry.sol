// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Stores the deployment's identity assignment behind an immutable manifest commitment.
contract AttributeRegistry {
    uint16 public constant COLLECTION_SIZE = 4_444;
    uint16 public constant ORDINARY_IDENTITY_COUNT = 4_440;

    enum RewardTrack {
        None,
        AAPLc,
        GOOGLc,
        METAc,
        NVDAc
    }

    enum RarityTier {
        None,
        I,
        II,
        III,
        IV
    }

    enum CollectibleKind {
        Ordinary,
        BasketRelic,
        IndicatorRelic
    }

    struct AttributeInput {
        uint16 identityId;
        RewardTrack track;
        RarityTier tier;
        uint16 weight;
        CollectibleKind collectibleKind;
    }

    struct Attributes {
        RewardTrack track;
        RarityTier tier;
        uint16 weight;
        CollectibleKind collectibleKind;
    }

    error EmptyBatch();
    error DuplicateIdentity(uint16 identityId);
    error IdentityNotLoaded(uint16 identityId);
    error IncompleteRegistry(uint16 loadedCount);
    error InvalidAttributeCodes(uint16 identityId);
    error InvalidIdentityId(uint16 identityId);
    error ManifestCommitmentMismatch(bytes32 expected, bytes32 actual);
    error MissingIdentity(uint16 expected, uint16 actual);
    error RegistrySealed();
    error Unauthorized(address caller);
    error ZeroManifestCommitment();

    event RegistrySealedForever(bytes32 indexed manifestCommitment);

    bytes32 public immutable manifestCommitment;
    address public immutable owner;
    uint16 public loadedCount;
    bool public isSealed;

    mapping(uint16 identityId => Attributes attributes) private _attributes;

    constructor(bytes32 manifestCommitment_) {
        if (manifestCommitment_ == bytes32(0)) revert ZeroManifestCommitment();
        manifestCommitment = manifestCommitment_;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    function loadBatch(AttributeInput[] calldata batch) external onlyOwner {
        if (isSealed) revert RegistrySealed();
        if (batch.length == 0) revert EmptyBatch();

        uint16 expectedIdentityId = loadedCount + 1;
        for (uint256 index = 0; index < batch.length; ++index) {
            AttributeInput calldata input = batch[index];
            if (input.identityId == 0 || input.identityId > COLLECTION_SIZE) {
                revert InvalidIdentityId(input.identityId);
            }
            if (input.identityId < expectedIdentityId) {
                revert DuplicateIdentity(input.identityId);
            }
            if (input.identityId > expectedIdentityId) {
                revert MissingIdentity(expectedIdentityId, input.identityId);
            }
            _validateAttributes(input);

            _attributes[input.identityId] = Attributes({
                track: input.track,
                tier: input.tier,
                weight: input.weight,
                collectibleKind: input.collectibleKind
            });
            ++expectedIdentityId;
        }

        loadedCount = expectedIdentityId - 1;
    }

    function seal() external onlyOwner {
        if (isSealed) revert RegistrySealed();
        if (loadedCount != COLLECTION_SIZE) revert IncompleteRegistry(loadedCount);
        bytes32 actualCommitment = _attributeCommitment();
        if (actualCommitment != manifestCommitment) {
            revert ManifestCommitmentMismatch(manifestCommitment, actualCommitment);
        }

        isSealed = true;
        emit RegistrySealedForever(manifestCommitment);
    }

    function isComplete() external view returns (bool) {
        return loadedCount == COLLECTION_SIZE;
    }

    function nextIdentityId() external view returns (uint16) {
        return loadedCount + 1;
    }

    function attributeOf(uint16 identityId) external view returns (Attributes memory) {
        if (identityId == 0 || identityId > loadedCount) revert IdentityNotLoaded(identityId);
        return _attributes[identityId];
    }

    function _validateAttributes(AttributeInput calldata input) private pure {
        if (input.identityId <= ORDINARY_IDENTITY_COUNT) {
            if (
                input.track == RewardTrack.None || input.tier == RarityTier.None
                    || input.weight != _weightForTier(input.tier)
                    || input.collectibleKind != CollectibleKind.Ordinary
            ) {
                revert InvalidAttributeCodes(input.identityId);
            }
            return;
        }

        CollectibleKind expectedCollectibleKind = input.identityId == COLLECTION_SIZE
            ? CollectibleKind.IndicatorRelic
            : CollectibleKind.BasketRelic;
        if (
            input.track != RewardTrack.None || input.tier != RarityTier.None || input.weight != 0
                || input.collectibleKind != expectedCollectibleKind
        ) {
            revert InvalidAttributeCodes(input.identityId);
        }
    }

    function _weightForTier(RarityTier tier) private pure returns (uint16) {
        if (tier == RarityTier.I) return 100;
        if (tier == RarityTier.II) return 150;
        if (tier == RarityTier.III) return 250;
        if (tier == RarityTier.IV) return 500;
        return 0;
    }

    function _attributeCommitment() private view returns (bytes32 commitment) {
        bytes memory canonical = new bytes(uint256(COLLECTION_SIZE) * 7);

        // Attributes occupy one packed storage word. Reading and encoding that word once per
        // identity keeps the one-time seal transaction below Base's transaction gas cap while
        // preserving the exact checked-in seven-byte canonical representation.
        assembly ("memory-safe") {
            let canonicalData := add(canonical, 0x20)
            let attributesSlot := _attributes.slot
            for { let identityId := 1 } lt(identityId, 4445) { identityId := add(identityId, 1) } {
                mstore(0x00, identityId)
                mstore(0x20, attributesSlot)
                let attributes := sload(keccak256(0x00, 0x40))
                let encoded :=
                    or(
                        shl(40, identityId),
                        or(
                            shl(32, and(attributes, 0xff)),
                            or(
                                shl(24, and(shr(8, attributes), 0xff)),
                                or(
                                    shl(8, and(shr(16, attributes), 0xffff)),
                                    and(shr(32, attributes), 0xff)
                                )
                            )
                        )
                    )
                mstore(add(canonicalData, mul(sub(identityId, 1), 7)), shl(200, encoded))
            }
            commitment := keccak256(canonicalData, mul(4444, 7))
        }
    }
}
