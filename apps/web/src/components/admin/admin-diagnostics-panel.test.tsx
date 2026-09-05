import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminDiagnosticsSnapshotInput } from "@/lib/protocol-status-model";

const state = vi.hoisted(() => ({
  protocol: undefined as unknown,
  funding: undefined as unknown,
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => state.protocol,
}));

vi.mock("@/hooks/use-testnet-funding", () => ({
  useTestnetFundingStatus: () => state.funding,
}));

import { AdminDiagnosticsPanel } from "./admin-diagnostics-panel";

const hash = (value: number) =>
  `0x${value.toString(16).padStart(64, "0")}` as const;

const health = {
  health: {
    status: "degraded",
    checks: [
      {
        id: "read-freshness",
        status: "pass",
        severity: "warning",
        freshness: "fresh",
        observedBlock: 200n,
        expected: "at most 90s old",
        observed: "4s old",
        explanation: "The direct read is fresh.",
      },
      {
        id: "binding:market.manager",
        status: "fail",
        severity: "critical",
        freshness: "fresh",
        observedBlock: 200n,
        expected: "0x0000000000000000000000000000000000000001",
        observed: "0x0000000000000000000000000000000000000002",
        explanation: "The market binding differs.",
      },
    ],
  },
  deployment: {
    network: "base-sepolia",
    expectedChainId: 84_532,
    observedChainId: 84_532,
    observedBlock: 200n,
    observedAt: 1_700_000_000,
    expectedManifestCommitment: hash(90),
    manifestCommitment: hash(91),
  },
  collection: {
    liquidSupplyFormatted: "3600",
    permanentCount: 800,
    transientCount: 40,
    pendingDiscoveryCount: 4,
    availableIdentityCount: 3_604,
  },
  operations: {
    historyStatus: "partial",
    rewardHistoryStatus: "complete",
    rewardEpochCount: 7n,
    trackQueues: [
      {
        track: "AAPLc",
        trackId: 1,
        wethFormatted: "1",
        deferred: false,
        status: "ready",
      },
    ],
    trackOutcomes: {
      1: { latest: undefined },
      2: { latest: undefined },
      3: { latest: undefined },
      4: { latest: undefined },
    },
    protocolOwnedLiquidity: {
      queuedWethFormatted: "5",
      permanentlyLockedWethFormatted: "6",
      cycleCount: 2n,
    },
    recentEvents: [],
    summary: {
      "reward-epoch": { lastSuccessful: undefined, lastFailed: undefined },
      conversion: { lastSuccessful: undefined, lastFailed: undefined },
      retry: { lastSuccessful: undefined, lastFailed: undefined },
      claim: { lastSuccessful: undefined, lastFailed: undefined },
      "pol-execution": { lastSuccessful: undefined, lastFailed: undefined },
    },
  },
  rewards: {
    tracks: [
      {
        track: "AAPLc",
        rawTokenBalance: 1n,
        rawLiability: 1n,
        activeWeight: 1n,
        unclaimedTrackPot: 0n,
        basketRelicPot: 0n,
        indicatorRelicPot: 0n,
        solvent: true,
      },
    ],
  },
  roles: {
    owners: {
      liquidToken: "0x0000000000000000000000000000000000000011",
      rewards: "0x0000000000000000000000000000000000000013",
      converter: "0x0000000000000000000000000000000000000014",
      liquidity: "0x0000000000000000000000000000000000000015",
    },
    keeper: "0x0000000000000000000000000000000000000012",
    liquidityExecutor: "0x0000000000000000000000000000000000000012",
    guardian: "0x0000000000000000000000000000000000000016",
    recoveryAuthority: "0x0000000000000000000000000000000000000017",
    creator: "0x0000000000000000000000000000000000000018",
  },
} as const;

const adminHealth: AdminDiagnosticsSnapshotInput = health;

describe("admin diagnostics panel", () => {
  beforeEach(() => {
    state.protocol = {
      accessState: "ready",
      deploymentAvailable: true,
      health: adminHealth,
      healthError: null,
      healthPending: false,
      refresh: vi.fn(async () => undefined),
    };
    state.funding = {
      failed: false,
      pending: false,
      response: { service: { chainId: 84_532, state: "ready" } },
    };
  });

  it("renders raw evidence only in diagnostics and labels every data source", () => {
    const html = renderToStaticMarkup(<AdminDiagnosticsPanel />);

    expect(html).toContain("Evidence sources");
    expect(html).toContain("Live onchain snapshot");
    expect(html).toContain("Operational history index");
    expect(html).toContain("Reward history index");
    expect(html).toContain("Testnet funding service");
    expect(html).toContain("Keeper and liquidity workers");
    expect(html).toContain("Not inferable from onchain state");
    expect(html).toContain("Raw onchain accounting and queues");
    expect(html).toContain("Complete health-check ledger");
    /* The four evidence disclosures are collapsible triggers now, not a
       stylesheet class. Each keeps its raw evidence in the document so the
       browser's own page search can still find it. */
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(4);
    expect(html).toContain("Selected deployment manifest");
    expect(html).toContain(hash(90));
    expect(html).toContain(hash(91));
    expect(html).toContain("Role configuration");
    expect(html).toContain("0x0000000000000000000000000000000000000012");
    expect(html).toContain("The market binding differs.");
    expect(html).toContain("AAPLc");
    expect(html).not.toContain("Authorized action deck");
  });

  it("keeps diagnostics unavailable until a direct read succeeds", () => {
    state.protocol = {
      ...(state.protocol as Record<string, unknown>),
      health: undefined,
      healthError: new Error("private RPC failure"),
    };

    const html = renderToStaticMarkup(<AdminDiagnosticsPanel />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Diagnostics unavailable");
    expect(html).toContain("Diagnostics could not read live onchain evidence");
    expect(html).toContain("Retry diagnostics");
    expect(html).not.toContain("private RPC failure");
  });
});
