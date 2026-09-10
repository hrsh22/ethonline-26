import { describe, expect, it } from "vitest";

import {
  ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES,
  decodeAdminHistoryResponse,
  decodeAdminKeeperAttemptsHistoryResponse,
  decodeAdminOperationsHistoryResponse,
} from "../src/admin-history.js";
import { ADMIN_DIAGNOSTIC_PATHS } from "../src/admin-auth.js";

const fingerprint = `0x${"11".repeat(32)}` as const;
const manifest = {
  canonicalPool: {
    currency0: "0x0000000000000000000000000000000000000001",
    currency1: "0x0000000000000000000000000000000000000002",
    poolId: `0x${"22".repeat(32)}`,
  },
  chainId: 84_532,
  commitment: `0x${"33".repeat(32)}`,
  fingerprint,
  launchBlock: "10",
  network: "base-sepolia",
  sources: {
    canonicalFeeHook: "0x0000000000000000000000000000000000000003",
    epochConverter: "0x0000000000000000000000000000000000000004",
    fuelCore: "0x0000000000000000000000000000000000000005",
    poolManager: "0x0000000000000000000000000000000000000006",
    protocolLiquidityVault: "0x0000000000000000000000000000000000000007",
    rewardLedger: "0x0000000000000000000000000000000000000008",
  },
} as const;

const operations = {
  ignored: "strip me",
  items: [],
  manifest,
  page: { hasMore: false, ignored: true },
  snapshot: { canonicalRevision: 0, generation: "generation-1" },
  status: {
    coverage: { fromBlock: "10" },
    head: {},
    requested: { fromBlock: "10", toBlock: "123" },
    state: "partial",
  },
} as const;

const keeperAttempts = {
  evidence: {
    coverage: { 1: "partial", 2: "partial", 3: "partial", 4: "partial" },
    freshness: { maximumAgeSeconds: "300" },
    generation: "generation-1",
    ignored: "strip me",
    source: "keeper-attempt-journal",
    state: "unavailable",
    tracks: {
      1: { state: "unknown" },
      2: { state: "unknown" },
      3: { state: "unknown" },
      4: { state: "unknown" },
    },
  },
  manifest,
} as const;

describe("admin history response contracts", () => {
  it("accepts paired CCA lifecycle and source evidence", () => {
    const ccaManifest = {
      ...manifest,
      cca: {
        startBlock: "100",
        endBlock: "110",
        claimBlock: "111",
        migrationBlock: "111",
      },
      sources: {
        ...manifest.sources,
        cca: {
          auction: "0x0000000000000000000000000000000000000011",
          bidEscrowFactory: "0x0000000000000000000000000000000000000012",
          launchCoordinator: "0x0000000000000000000000000000000000000013",
          strategy: "0x0000000000000000000000000000000000000014",
        },
      },
    } as const;

    expect(
      decodeAdminOperationsHistoryResponse(
        { ...operations, manifest: ccaManifest },
        fingerprint,
      ).manifest,
    ).toEqual(ccaManifest);
    expect(() =>
      decodeAdminOperationsHistoryResponse(
        { ...operations, manifest: { ...manifest, cca: ccaManifest.cca } },
        fingerprint,
      ),
    ).toThrow(/appear together/u);
  });

  it("exports path-specific bounded decoders that strip unknown fields", () => {
    expect(ADMIN_HISTORY_RESPONSE_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(
      decodeAdminOperationsHistoryResponse(operations, fingerprint),
    ).toEqual({
      items: [],
      manifest,
      page: { hasMore: false },
      snapshot: { canonicalRevision: 0, generation: "generation-1" },
      status: {
        coverage: { fromBlock: "10" },
        head: {},
        requested: { fromBlock: "10", toBlock: "123" },
        state: "partial",
      },
    });
    expect(
      decodeAdminKeeperAttemptsHistoryResponse(keeperAttempts, fingerprint),
    ).toEqual({
      evidence: {
        coverage: {
          1: "partial",
          2: "partial",
          3: "partial",
          4: "partial",
        },
        freshness: { maximumAgeSeconds: "300" },
        generation: "generation-1",
        source: "keeper-attempt-journal",
        state: "unavailable",
        tracks: {
          1: { state: "unknown" },
          2: { state: "unknown" },
          3: { state: "unknown" },
          4: { state: "unknown" },
        },
      },
      manifest,
    });
  });

  it("routes only known protected history paths and pins the fingerprint", () => {
    expect(
      decodeAdminHistoryResponse(
        ADMIN_DIAGNOSTIC_PATHS.operations,
        operations,
        fingerprint,
      ),
    ).toEqual(decodeAdminOperationsHistoryResponse(operations, fingerprint));
    expect(() =>
      decodeAdminHistoryResponse(
        "/v1/admin/diagnostics/unknown",
        operations,
        fingerprint,
      ),
    ).toThrow(/Unsupported/u);
    expect(() =>
      decodeAdminOperationsHistoryResponse(operations, `0x${"99".repeat(32)}`),
    ).toThrow(/fingerprint/u);
  });
});
