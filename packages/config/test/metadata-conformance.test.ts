import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "../src/identity.js";

describe("onchain metadata conformance", () => {
  it("uses the deployment identity in the Solidity renderer's test vectors", () => {
    const conformance = JSON.parse(
      readFileSync(
        new URL("../collection/metadata-conformance.json", import.meta.url),
        "utf8",
      ),
    ) as { identity: Record<string, string> };
    const orbit = selectIdentityConfiguration("orbit-4444");
    expect(conformance.identity).toEqual({
      transientCollectible: orbit.terms.transientCollectible,
      permanentCollectible: orbit.terms.permanentCollectible,
      basketRelic: orbit.terms.basketRelic,
      indicatorRelic: orbit.terms.indicatorRelic,
      metadataDescription: [
        orbit.copy.metadataDescription,
        orbit.disclosures.testnet,
        orbit.disclosures.placeholderMetadata,
      ].join(" "),
      transientImage: orbit.assets.transient,
      permanentImage: orbit.assets.permanent,
      basketRelicImage: orbit.assets.basketRelic,
      indicatorRelicImage: orbit.assets.indicatorRelic,
    });
  });
});
