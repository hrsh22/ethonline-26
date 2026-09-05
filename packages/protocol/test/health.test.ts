import { describe, expect, it } from "vitest";

import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  deriveProtocolHealth,
  type ProtocolHealthInput,
} from "../src/health.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as const;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}` as const;
const identity = selectIdentityConfiguration("orbit-4444");

const healthyInput = (): ProtocolHealthInput => ({
  observedBlock: 120n,
  observedAt: 1_000,
  currentTime: 1_010,
  maximumAgeSeconds: 30,
  liquidSupplyWei: 4_400n * 10n ** 18n,
  permanentCount: 44,
  transientCount: 20,
  pendingDiscoveryCount: 4,
  availableIdentityCount: 4_380,
  expectedManifestCommitment: hash("4444"),
  observedManifestCommitment: hash("4444"),
  bindings: [
    {
      id: "fuel.rewardLedger",
      expected: address("1"),
      observed: address("1"),
      explanation: "Liquid Token rewards reach the sealed Reward Ledger.",
    },
  ],
  values: [],
  bytecode: [],
  seals: [
    {
      id: "attributes",
      sealed: true,
      explanation: "Collection attributes are immutable.",
    },
  ],
  rewardTracks: [
    { track: "AAPLc", tokenBalance: 100n, liability: 90n },
    { track: "GOOGLc", tokenBalance: 200n, liability: 200n },
    { track: "METAc", tokenBalance: 300n, liability: 250n },
    { track: "NVDAc", tokenBalance: 400n, liability: 0n },
  ],
  rpcFailures: [],
});

describe("protocol health derivation", () => {
  it("proves the supply partition and per-track solvency from independent values", () => {
    const health = deriveProtocolHealth(healthyInput(), identity);

    expect(health.status).toBe("healthy");
    expect(
      health.checks.find((check) => check.id === "supply-invariant"),
    ).toMatchObject({
      status: "pass",
      expected: "4444000000000000000000",
      observed: "4444000000000000000000",
      observedBlock: 120n,
    });
    expect(
      health.checks.filter((check) => check.id.startsWith("reward-solvency:")),
    ).toHaveLength(4);
  });

  it("keeps Pending Discovery requests outside the identity partition", () => {
    const withoutPending = healthyInput();
    withoutPending.pendingDiscoveryCount = 0;
    const withPending = healthyInput();
    withPending.pendingDiscoveryCount = 200;

    expect(
      deriveProtocolHealth(withoutPending, identity).checks.find(
        (check) => check.id === "collection-partition",
      )?.status,
    ).toBe("pass");
    expect(
      deriveProtocolHealth(withPending, identity).checks.find(
        (check) => check.id === "collection-partition",
      )?.status,
    ).toBe("pass");
  });

  it("reports accounting mismatches, stale reads, deployment drift, and partial RPC failures", () => {
    const input = healthyInput();
    input.liquidSupplyWei -= 1n;
    input.rewardTracks[2] = {
      track: "METAc",
      tokenBalance: 249n,
      liability: 250n,
    };
    input.observedManifestCommitment = hash("bad");
    input.currentTime = 1_100;
    input.rpcFailures = ["canonical market quote unavailable"];

    const health = deriveProtocolHealth(input, identity);

    expect(health.status).toBe("critical");
    expect(health.freshness).toBe("stale");
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "supply-invariant", status: "fail" }),
        expect.objectContaining({
          id: "reward-solvency:METAc",
          status: "fail",
        }),
        expect.objectContaining({ id: "identity-manifest", status: "fail" }),
        expect.objectContaining({
          id: "rpc:0",
          status: "unknown",
          observed: "unavailable",
        }),
      ]),
    );
    expect(health.checks.map((check) => check.observed)).not.toContain(
      "canonical market quote unavailable",
    );
    expect(health.rpcFailures).toEqual(["canonical market quote unavailable"]);
  });

  it("marks checks unknown instead of evaluating unavailable fallback values", () => {
    const input = healthyInput();
    input.availability = {
      supplyInvariant: false,
      collectionPartition: true,
      identityManifest: true,
    };
    input.rewardTracks[0] = {
      ...input.rewardTracks[0]!,
      tokenBalance: 0n,
      liability: 0n,
      available: false,
    };
    input.rpcFailures = ["supply and AAPLc reads failed"];

    const health = deriveProtocolHealth(input, identity);

    expect(health.status).toBe("degraded");
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "supply-invariant",
          status: "unknown",
          observed: "unavailable",
        }),
        expect.objectContaining({
          id: "reward-solvency:AAPLc",
          status: "unknown",
          observed: "unavailable",
        }),
      ]),
    );
  });

  it("degrades only the affected operational check for a deferred track or intentional pause", () => {
    const input = healthyInput();
    input.operationalChecks = [
      {
        id: "track:1",
        status: "pass",
        severity: "warning",
        expected: "clear or executable",
        observed: "clear",
        explanation: "AAPLc can progress.",
      },
      {
        id: "track:3",
        status: "fail",
        severity: "warning",
        expected: "clear or executable",
        observed: "deferred after failure",
        explanation: "METAc needs a retry.",
      },
      {
        id: "pause:converter",
        status: "fail",
        severity: "warning",
        expected: "active",
        observed: "paused",
        explanation: "The Reward Epoch module is intentionally paused.",
      },
    ];

    const health = deriveProtocolHealth(input, identity);

    expect(health.status).toBe("degraded");
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "track:1", status: "pass" }),
        expect.objectContaining({
          id: "track:3",
          status: "fail",
          severity: "warning",
        }),
        expect.objectContaining({
          id: "pause:converter",
          status: "fail",
          severity: "warning",
        }),
      ]),
    );
  });
});
