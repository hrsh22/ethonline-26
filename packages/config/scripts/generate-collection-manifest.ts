import { mkdirSync, writeFileSync } from "node:fs";

import { hexToBytes } from "viem";
import { Effect } from "effect";

import { fileSystem, runMain } from "../../../scripts/effect-runtime.ts";

import {
  collectionManifestArtifact,
  renderCollectionManifestArtifact,
  serializeCanonicalCollectionManifest,
} from "../dist/collection-manifest.js";

runMain(
  Effect.gen(function* () {
    const manifestUrl = new URL("../collection/manifest.json", import.meta.url);
    const canonicalManifestUrl = new URL(
      "../collection/manifest.bin",
      import.meta.url,
    );

    yield* fileSystem("Could not write collection manifest artifacts", () => {
      mkdirSync(new URL("../collection/", import.meta.url), {
        recursive: true,
      });
      writeFileSync(manifestUrl, renderCollectionManifestArtifact());
      writeFileSync(
        canonicalManifestUrl,
        hexToBytes(
          serializeCanonicalCollectionManifest(
            collectionManifestArtifact.entries,
          ),
        ),
      );
    });
  }),
);
