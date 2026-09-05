import { readFileSync } from "node:fs";

import { toBytes } from "viem";
import { describe, expect, it } from "vitest";

import {
  collectionManifestArtifact,
  collectionManifestHash,
  renderCollectionManifestArtifact,
  serializeCanonicalCollectionManifest,
} from "../src/collection-manifest.js";

const checkedManifestUrl = new URL(
  "../collection/manifest.json",
  import.meta.url,
);
const checkedCanonicalManifestUrl = new URL(
  "../collection/manifest.bin",
  import.meta.url,
);

describe("collection manifest", () => {
  it("regenerates the complete sealed assignment byte for byte", () => {
    const checkedManifest = readFileSync(checkedManifestUrl, "utf8");
    const checkedCanonicalManifest = readFileSync(checkedCanonicalManifestUrl);
    const entries = collectionManifestArtifact.entries;

    expect(renderCollectionManifestArtifact()).toBe(checkedManifest);
    expect(checkedCanonicalManifest).toEqual(
      Buffer.from(toBytes(serializeCanonicalCollectionManifest(entries))),
    );
    expect(collectionManifestHash).toBe(
      collectionManifestArtifact.provenance.manifestHash,
    );
    expect(entries).toHaveLength(4444);
    const ordinary = entries.filter((entry) => entry.collectibleKind === 0);
    expect(ordinary).toHaveLength(4440);
    for (const track of [1, 2, 3, 4]) {
      const assigned = ordinary.filter((entry) => entry.track === track);
      expect(assigned).toHaveLength(1110);
      expect(
        [1, 2, 3, 4].map(
          (tier) => assigned.filter((entry) => entry.tier === tier).length,
        ),
      ).toEqual([612, 333, 133, 32]);
    }
    expect(
      ordinary.every(
        (entry) => entry.weight === [100, 150, 250, 500][entry.tier - 1],
      ),
    ).toBe(true);
    expect(entries.slice(4440)).toEqual([
      {
        identityId: 4441,
        track: 0,
        tier: 0,
        weight: 0,
        collectibleKind: 1,
      },
      {
        identityId: 4442,
        track: 0,
        tier: 0,
        weight: 0,
        collectibleKind: 1,
      },
      {
        identityId: 4443,
        track: 0,
        tier: 0,
        weight: 0,
        collectibleKind: 1,
      },
      {
        identityId: 4444,
        track: 0,
        tier: 0,
        weight: 0,
        collectibleKind: 2,
      },
    ]);
  });
});
