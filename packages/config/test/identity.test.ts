import { describe, expect, it } from "vitest";

import {
  createIdentityApplicationCopy,
  identityConfigurations,
  selectIdentityConfiguration,
  selectedIdentityConfiguration,
  selectedIdentityKey,
} from "../src/identity.js";

describe("identity configuration", () => {
  it("switches every user-facing identity value through one selection input", () => {
    const orbit = selectIdentityConfiguration("orbit-4444");
    const neutral = selectIdentityConfiguration("neutral-test");

    expect(orbit).toMatchObject({
      brand: "ORBIT 4444",
      liquidToken: {
        displayName: "$FUEL",
        name: "ORBIT Fuel",
        symbol: "FUEL",
      },
      collectibleToken: {
        name: "ORBIT 4444 Collectibles",
        symbol: "ORBIT",
      },
      terms: {
        transientCollectible: "Grounded Craft",
        discoveryDraw: "Discovery",
        discoveryDrawPlural: "Discoveries",
        commitment: "Launch",
        permanentCollectible: "Orbiter",
        basketRelic: "Station",
        indicatorRelic: "Observatory",
      },
      navigation: {
        exchange: "Exchange",
        collection: "Fleet",
        commitment: "Launch",
        rewards: "Reward Stocks",
        basketRelics: "Stations",
        indicatorRelic: "Observatory",
      },
    });
    expect(orbit.assets.transient).toMatch(/^placeholder:\/\//);
    expect(orbit.disclosures.placeholderMetadata).toContain("not final");

    expect(neutral).toMatchObject({
      brand: "Base Collectible Rewards",
      liquidToken: {
        displayName: "Test Liquid Token",
        name: "Test Liquid Token",
        symbol: "TEST",
      },
      collectibleToken: {
        name: "Test Collectibles",
        symbol: "TCOL",
      },
      terms: {
        transientCollectible: "Transient Collectible",
        discoveryDraw: "Assignment",
        discoveryDrawPlural: "Assignments",
        commitment: "Commit",
        permanentCollectible: "Permanent Collectible",
        basketRelic: "Basket Relic",
        indicatorRelic: "Indicator Relic",
      },
    });
    expect(neutral.copy.homeIntroduction).not.toContain("ORBIT");

    expect(selectedIdentityConfiguration).toBe(
      identityConfigurations[selectedIdentityKey],
    );
  });

  it("derives collector-facing home and launch language from the selected identity", () => {
    const orbitCopy = createIdentityApplicationCopy(
      selectIdentityConfiguration("orbit-4444"),
    );
    const neutralCopy = createIdentityApplicationCopy(
      selectIdentityConfiguration("neutral-test"),
    );

    expect(orbitCopy).toMatchObject({
      navigation: {
        admin: "Admin",
      },
      home: {
        eyebrow: "BASE SEPOLIA / ORBIT 4444",
        title: "Find the craft worth keeping.",
        primaryAction: "Trade $FUEL",
        secondaryAction: "Trade $FUEL",
      },
      launch: {
        title: "Launch Grounded Craft",
        finalAction: "Burn 1 $FUEL and Launch",
        warning:
          "Launch irreversibly burns one $FUEL and makes the selected Grounded Craft a permanent Orbiter.",
      },
    });
    expect(JSON.stringify(neutralCopy)).not.toMatch(
      /ORBIT|\$FUEL|Grounded Craft|Orbiter|Discovery|Fleet|Reward Stocks|Stations|Observatory/,
    );
    expect(neutralCopy.market.eyebrow).toBe("PUBLIC PRIMARY MARKET");
    expect(orbitCopy).not.toHaveProperty("onboarding");
    expect(orbitCopy.home).not.toHaveProperty("steps");
  });
});
