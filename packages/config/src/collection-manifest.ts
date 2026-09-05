import { concatHex, keccak256, numberToHex, toBytes } from "viem";

export const COLLECTION_SIZE = 4444;
export const ORDINARY_IDENTITY_COUNT = 4440;
export const MANIFEST_SEED = "base-collectible-rewards-poc-v1";
export const MANIFEST_ALGORITHM_VERSION = "keccak256-sort-v1";
export const MANIFEST_CANONICAL_SERIALIZATION =
  "Concatenated fixed-width big-endian records ordered by identity ID: uint16 identityId, uint8 track, uint8 tier, uint16 weight, uint8 collectibleKind.";

export const trackCodes = {
  1: "AAPLc",
  2: "GOOGLc",
  3: "METAc",
  4: "NVDAc",
} as const;

export const tierCodes = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
} as const;

export const collectibleKindCodes = {
  0: "ordinary",
  1: "basket-relic",
  2: "indicator-relic",
} as const;

export type TrackCode = keyof typeof trackCodes;
export type TierCode = keyof typeof tierCodes;
export type CollectibleKindCode = keyof typeof collectibleKindCodes;
export type TierWeight = 100 | 150 | 250 | 500;

export interface CollectionManifestEntry {
  readonly identityId: number;
  readonly track: 0 | TrackCode;
  readonly tier: 0 | TierCode;
  readonly weight: 0 | TierWeight;
  readonly collectibleKind: CollectibleKindCode;
}

const tierDefinitions: ReadonlyArray<{
  readonly tier: TierCode;
  readonly weight: TierWeight;
  readonly count: number;
}> = [
  { tier: 1, weight: 100, count: 612 },
  { tier: 2, weight: 150, count: 333 },
  { tier: 3, weight: 250, count: 133 },
  { tier: 4, weight: 500, count: 32 },
];

/** Reward weight per Rarity Tier, I–IV, as the manifest assigns it. */
export const tierWeights: readonly TierWeight[] = tierDefinitions.map(
  (definition) => definition.weight,
);

export const serializeCanonicalCollectionManifest = (
  entries: readonly CollectionManifestEntry[],
) =>
  concatHex(
    entries.map((entry) =>
      concatHex([
        numberToHex(entry.identityId, { size: 2 }),
        numberToHex(entry.track, { size: 1 }),
        numberToHex(entry.tier, { size: 1 }),
        numberToHex(entry.weight, { size: 2 }),
        numberToHex(entry.collectibleKind, { size: 1 }),
      ]),
    ),
  );

export const hashCollectionManifest = (
  entries: readonly CollectionManifestEntry[],
) => keccak256(toBytes(serializeCanonicalCollectionManifest(entries)));

export const generateCollectionManifest = (): CollectionManifestEntry[] => {
  const ordinaryAssignments: Array<
    Omit<CollectionManifestEntry, "identityId">
  > = [];

  for (const track of [1, 2, 3, 4] as const) {
    for (const definition of tierDefinitions) {
      for (let index = 0; index < definition.count; index += 1) {
        ordinaryAssignments.push({
          track,
          tier: definition.tier,
          weight: definition.weight,
          collectibleKind: 0,
        });
      }
    }
  }

  const shuffledAssignments = ordinaryAssignments
    .map((assignment, sourceIndex) => ({
      assignment,
      sourceIndex,
      sortKey: keccak256(toBytes(`${MANIFEST_SEED}:${sourceIndex}`)),
    }))
    .sort(
      (left, right) =>
        (left.sortKey < right.sortKey
          ? -1
          : left.sortKey > right.sortKey
            ? 1
            : 0) || left.sourceIndex - right.sourceIndex,
    );

  const entries: CollectionManifestEntry[] = shuffledAssignments.map(
    ({ assignment }, index) => ({
      identityId: index + 1,
      ...assignment,
    }),
  );

  for (let identityId = 4441; identityId <= 4443; identityId += 1) {
    entries.push({
      identityId,
      track: 0,
      tier: 0,
      weight: 0,
      collectibleKind: 1,
    });
  }
  entries.push({
    identityId: 4444,
    track: 0,
    tier: 0,
    weight: 0,
    collectibleKind: 2,
  });

  return entries;
};

const createCollectionManifestArtifact = () => {
  const entries = generateCollectionManifest();

  return {
    provenance: {
      seed: MANIFEST_SEED,
      algorithmVersion: MANIFEST_ALGORITHM_VERSION,
      canonicalSerialization: MANIFEST_CANONICAL_SERIALIZATION,
      hashAlgorithm: "keccak256",
      manifestHash: hashCollectionManifest(entries),
      weightScale: 100,
      trackCodes,
      tierCodes,
      collectibleKindCodes,
    },
    entries,
  } as const;
};

export const collectionManifestArtifact = createCollectionManifestArtifact();
export const collectionManifestHash =
  collectionManifestArtifact.provenance.manifestHash;

export const renderCollectionManifestArtifact = () =>
  `${JSON.stringify(collectionManifestArtifact, null, 2)}\n`;
