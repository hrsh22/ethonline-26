import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeBlockedVenueInventory } from "../src/blocked-venue-inventory.js";

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8")) as unknown;

const inventory = decodeBlockedVenueInventory(
  readJson("../../deployments/84532.blocked-venues.json"),
);

describe("blocked alternative-venue inventory", () => {
  it("decodes the checked Base Sepolia inventory", () => {
    expect(inventory.chainId).toBe(84_532);
    expect(inventory.network).toBe("base-sepolia");
    expect(inventory.entries.length).toBeGreaterThan(0);
  });

  it("keeps every entry distinct by label, address, and codehash", () => {
    // The blocklist is frozen at launch, so a duplicate is a wasted slot in a
    // list that can never be extended, and a duplicated label would make a
    // health failure name the wrong venue.
    for (const field of ["label", "address", "codehash"] as const) {
      const values = inventory.entries.map((entry) => entry[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("never blocks a contract the protocol itself has to reach", () => {
    // Blocking one of these would not close an alternative venue, it would
    // break the canonical one: `_rejectBlockedVenue` runs against the operator,
    // sender, and recipient of every liquid-token transfer.
    const manifest = readJson("../../deployments/84532.json") as {
      contracts: Record<string, string>;
    };
    const reachable = new Set(
      Object.entries(manifest.contracts)
        // The public launcher is used to create and migrate the canonical pool
        // before Fuel transfers begin, then deliberately blocked as an
        // alternative venue after launch.
        .filter(([name]) => name !== "liquidityLauncher")
        .map(([, address]) => address.toLowerCase()),
    );
    for (const entry of inventory.entries) {
      expect(reachable.has(entry.address.toLowerCase())).toBe(false);
    }
  });

  it("states provenance specific enough to re-derive each entry", () => {
    for (const entry of inventory.entries) {
      // A remembered address is not provenance. Every entry has to say how the
      // contract's identity was confirmed, not just what it is called.
      expect(entry.verifiedBy).not.toBe(entry.source);
      expect(entry.rationale.length).toBeGreaterThan(40);
    }
  });
});
