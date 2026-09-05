// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../src/AttributeRegistry.sol";

interface Vm {
    function coolSlot(address target, bytes32 slot) external;
    function readFileBinary(string calldata path) external view returns (bytes memory data);
}

contract AttributeRegistryTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 internal constant MANIFEST_HASH =
        0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3;

    function testLoadsSequentialBatchesAndExposesCommittedAttributes() external {
        AttributeRegistry registry = new AttributeRegistry(MANIFEST_HASH);
        AttributeRegistry.AttributeInput[] memory batch = new AttributeRegistry.AttributeInput[](2);
        batch[0] = AttributeRegistry.AttributeInput({
            identityId: 1,
            track: AttributeRegistry.RewardTrack.AAPLc,
            tier: AttributeRegistry.RarityTier.I,
            weight: 100,
            collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
        });
        batch[1] = AttributeRegistry.AttributeInput({
            identityId: 2,
            track: AttributeRegistry.RewardTrack.NVDAc,
            tier: AttributeRegistry.RarityTier.IV,
            weight: 500,
            collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
        });

        registry.loadBatch(batch);

        require(registry.manifestCommitment() == MANIFEST_HASH, "wrong commitment");
        require(registry.loadedCount() == 2, "wrong loaded count");
        require(registry.nextIdentityId() == 3, "wrong next identity");

        AttributeRegistry.Attributes memory first = registry.attributeOf(1);
        require(first.track == AttributeRegistry.RewardTrack.AAPLc, "wrong track");
        require(first.tier == AttributeRegistry.RarityTier.I, "wrong tier");
        require(first.weight == 100, "wrong weight");
        require(
            first.collectibleKind == AttributeRegistry.CollectibleKind.Ordinary,
            "wrong collectible kind"
        );
    }

    function testRefusesInvalidOrdinaryAttributeCodes() external {
        AttributeRegistry registry = new AttributeRegistry(MANIFEST_HASH);

        _assertInvalidAttributes(
            registry,
            AttributeRegistry.AttributeInput({
                identityId: 1,
                track: AttributeRegistry.RewardTrack.None,
                tier: AttributeRegistry.RarityTier.I,
                weight: 100,
                collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
            })
        );
        _assertInvalidAttributes(
            registry,
            AttributeRegistry.AttributeInput({
                identityId: 1,
                track: AttributeRegistry.RewardTrack.AAPLc,
                tier: AttributeRegistry.RarityTier.None,
                weight: 100,
                collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
            })
        );
        _assertInvalidAttributes(
            registry,
            AttributeRegistry.AttributeInput({
                identityId: 1,
                track: AttributeRegistry.RewardTrack.AAPLc,
                tier: AttributeRegistry.RarityTier.I,
                weight: 150,
                collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
            })
        );
        _assertInvalidAttributes(
            registry,
            AttributeRegistry.AttributeInput({
                identityId: 1,
                track: AttributeRegistry.RewardTrack.AAPLc,
                tier: AttributeRegistry.RarityTier.I,
                weight: 100,
                collectibleKind: AttributeRegistry.CollectibleKind.BasketRelic
            })
        );
    }

    function testRefusesDuplicateAndMissingIdentityIds() external {
        AttributeRegistry registry = new AttributeRegistry(MANIFEST_HASH);
        AttributeRegistry.AttributeInput[] memory batch = new AttributeRegistry.AttributeInput[](1);
        batch[0] = AttributeRegistry.AttributeInput({
            identityId: 1,
            track: AttributeRegistry.RewardTrack.AAPLc,
            tier: AttributeRegistry.RarityTier.I,
            weight: 100,
            collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
        });
        registry.loadBatch(batch);

        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.loadBatch, (batch)),
            AttributeRegistry.DuplicateIdentity.selector
        );

        AttributeRegistry missingRegistry = new AttributeRegistry(MANIFEST_HASH);
        batch[0].identityId = 2;
        _assertRevertsWith(
            address(missingRegistry),
            abi.encodeCall(AttributeRegistry.loadBatch, (batch)),
            AttributeRegistry.MissingIdentity.selector
        );
    }

    function testRefusesSealingBeforeEveryIdentityIsLoaded() external {
        AttributeRegistry registry = new AttributeRegistry(MANIFEST_HASH);

        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.seal, ()),
            AttributeRegistry.IncompleteRegistry.selector
        );
    }

    function testRefusesSealingACompleteAssignmentThatDoesNotMatchCommitment() external {
        AttributeRegistry.AttributeInput[] memory inputs = _completeCollectionInputs();
        bytes32 actualCommitment = _hashInputs(inputs);
        AttributeRegistry registry = new AttributeRegistry(bytes32(uint256(actualCommitment) ^ 1));
        _loadInputs(registry, inputs);

        require(registry.isComplete(), "registry should be complete");
        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.seal, ()),
            AttributeRegistry.ManifestCommitmentMismatch.selector
        );
    }

    function testSealsMatchingCompleteAssignmentAndRejectsEveryLaterChange() external {
        AttributeRegistry.AttributeInput[] memory inputs = _completeCollectionInputs();
        AttributeRegistry registry = new AttributeRegistry(_hashInputs(inputs));
        _loadInputs(registry, inputs);

        registry.seal();

        require(registry.isSealed(), "registry should be sealed");
        AttributeRegistry.Attributes memory basketRelic = registry.attributeOf(4_441);
        AttributeRegistry.Attributes memory indicatorRelic = registry.attributeOf(4_444);
        require(
            basketRelic.collectibleKind == AttributeRegistry.CollectibleKind.BasketRelic,
            "wrong basket relic kind"
        );
        require(
            indicatorRelic.collectibleKind == AttributeRegistry.CollectibleKind.IndicatorRelic,
            "wrong indicator relic kind"
        );

        AttributeRegistry.AttributeInput[] memory laterBatch =
            new AttributeRegistry.AttributeInput[](1);
        laterBatch[0] = inputs[0];
        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.loadBatch, (laterBatch)),
            AttributeRegistry.RegistrySealed.selector
        );
        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.seal, ()),
            AttributeRegistry.RegistrySealed.selector
        );
    }

    function testSealFitsBaseSepoliaTransactionGasLimit() external {
        AttributeRegistry.AttributeInput[] memory inputs = _completeCollectionInputs();
        AttributeRegistry registry = new AttributeRegistry(_hashInputs(inputs));
        _loadInputs(registry, inputs);
        for (uint16 identityId = 1; identityId <= 4_444; ++identityId) {
            VM.coolSlot(address(registry), keccak256(abi.encode(uint256(identityId), uint256(1))));
        }

        uint256 gasBefore = gasleft();
        registry.seal();
        uint256 gasUsed = gasBefore - gasleft();

        require(gasUsed < 12_500_000, "seal exceeds Base-safe gas budget");
    }

    function testEveryRegistryReadAgreesWithTheCheckedManifest() external {
        bytes memory canonical = VM.readFileBinary("../config/collection/manifest.bin");
        require(canonical.length == 4_444 * 7, "wrong canonical byte length");
        require(keccak256(canonical) == MANIFEST_HASH, "wrong checked manifest hash");

        AttributeRegistry.AttributeInput[] memory inputs = _inputsFromCanonical(canonical);
        AttributeRegistry registry = new AttributeRegistry(MANIFEST_HASH);
        _loadInputs(registry, inputs);

        for (uint16 identityId = 1; identityId <= 4_444; ++identityId) {
            AttributeRegistry.AttributeInput memory expected = inputs[identityId - 1];
            AttributeRegistry.Attributes memory actual = registry.attributeOf(identityId);
            require(actual.track == expected.track, "manifest track mismatch");
            require(actual.tier == expected.tier, "manifest tier mismatch");
            require(actual.weight == expected.weight, "manifest weight mismatch");
            require(
                actual.collectibleKind == expected.collectibleKind,
                "manifest collectible kind mismatch"
            );
        }

        registry.seal();
        require(registry.isSealed(), "checked manifest was not sealed");
    }

    function _assertInvalidAttributes(
        AttributeRegistry registry,
        AttributeRegistry.AttributeInput memory input
    ) internal {
        AttributeRegistry.AttributeInput[] memory batch = new AttributeRegistry.AttributeInput[](1);
        batch[0] = input;
        _assertRevertsWith(
            address(registry),
            abi.encodeCall(AttributeRegistry.loadBatch, (batch)),
            AttributeRegistry.InvalidAttributeCodes.selector
        );
    }

    function _assertRevertsWith(address target, bytes memory callData, bytes4 expectedSelector)
        internal
    {
        (bool success, bytes memory returnData) = target.call(callData);
        require(!success, "expected call to revert");
        require(returnData.length >= 4, "missing revert selector");

        bytes4 actualSelector;
        assembly ("memory-safe") {
            actualSelector := mload(add(returnData, 0x20))
        }
        require(actualSelector == expectedSelector, "wrong revert selector");
    }

    function _completeCollectionInputs()
        internal
        pure
        returns (AttributeRegistry.AttributeInput[] memory inputs)
    {
        inputs = new AttributeRegistry.AttributeInput[](4_444);
        uint16[4] memory tierCounts = [uint16(612), 333, 133, 32];
        uint16[4] memory tierWeights = [uint16(100), 150, 250, 500];
        uint16 identityId = 1;

        for (uint8 trackCode = 1; trackCode <= 4; ++trackCode) {
            for (uint8 tierCode = 1; tierCode <= 4; ++tierCode) {
                for (uint16 index = 0; index < tierCounts[tierCode - 1]; ++index) {
                    inputs[identityId - 1] = AttributeRegistry.AttributeInput({
                        identityId: identityId,
                        track: AttributeRegistry.RewardTrack(trackCode),
                        tier: AttributeRegistry.RarityTier(tierCode),
                        weight: tierWeights[tierCode - 1],
                        collectibleKind: AttributeRegistry.CollectibleKind.Ordinary
                    });
                    ++identityId;
                }
            }
        }

        for (; identityId <= 4_443; ++identityId) {
            inputs[identityId - 1] = AttributeRegistry.AttributeInput({
                identityId: identityId,
                track: AttributeRegistry.RewardTrack.None,
                tier: AttributeRegistry.RarityTier.None,
                weight: 0,
                collectibleKind: AttributeRegistry.CollectibleKind.BasketRelic
            });
        }
        inputs[4_443] = AttributeRegistry.AttributeInput({
            identityId: 4_444,
            track: AttributeRegistry.RewardTrack.None,
            tier: AttributeRegistry.RarityTier.None,
            weight: 0,
            collectibleKind: AttributeRegistry.CollectibleKind.IndicatorRelic
        });
    }

    function _loadInputs(
        AttributeRegistry registry,
        AttributeRegistry.AttributeInput[] memory inputs
    ) internal {
        uint256 offset;
        while (offset < inputs.length) {
            uint256 remaining = inputs.length - offset;
            uint256 batchSize = remaining > 200 ? 200 : remaining;
            AttributeRegistry.AttributeInput[] memory batch =
                new AttributeRegistry.AttributeInput[](batchSize);
            for (uint256 index = 0; index < batchSize; ++index) {
                batch[index] = inputs[offset + index];
            }
            registry.loadBatch(batch);
            offset += batchSize;
        }
    }

    function _hashInputs(AttributeRegistry.AttributeInput[] memory inputs)
        internal
        pure
        returns (bytes32)
    {
        bytes memory canonical = new bytes(inputs.length * 7);
        for (uint256 index = 0; index < inputs.length; ++index) {
            AttributeRegistry.AttributeInput memory input = inputs[index];
            bytes2 encodedIdentityId = bytes2(input.identityId);
            bytes2 encodedWeight = bytes2(input.weight);
            uint256 offset = index * 7;
            canonical[offset] = encodedIdentityId[0];
            canonical[offset + 1] = encodedIdentityId[1];
            canonical[offset + 2] = bytes1(uint8(input.track));
            canonical[offset + 3] = bytes1(uint8(input.tier));
            canonical[offset + 4] = encodedWeight[0];
            canonical[offset + 5] = encodedWeight[1];
            canonical[offset + 6] = bytes1(uint8(input.collectibleKind));
        }
        return keccak256(canonical);
    }

    function _inputsFromCanonical(bytes memory canonical)
        internal
        pure
        returns (AttributeRegistry.AttributeInput[] memory inputs)
    {
        inputs = new AttributeRegistry.AttributeInput[](canonical.length / 7);
        for (uint256 index = 0; index < inputs.length; ++index) {
            uint256 offset = index * 7;
            inputs[index] = AttributeRegistry.AttributeInput({
                identityId: (uint16(uint8(canonical[offset])) << 8)
                    | uint16(uint8(canonical[offset + 1])),
                track: AttributeRegistry.RewardTrack(uint8(canonical[offset + 2])),
                tier: AttributeRegistry.RarityTier(uint8(canonical[offset + 3])),
                weight: (uint16(uint8(canonical[offset + 4])) << 8)
                    | uint16(uint8(canonical[offset + 5])),
                collectibleKind: AttributeRegistry.CollectibleKind(uint8(canonical[offset + 6]))
            });
        }
    }
}
