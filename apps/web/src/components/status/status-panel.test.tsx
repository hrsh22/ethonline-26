/** @vitest-environment jsdom */

import {
  derivePublicStatusModel,
  type PublicStatusSnapshotInput,
} from "@/lib/protocol-status-model";
import type { RewardHistoryEvent } from "@orbit/protocol/reader";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({
  protocol: undefined as unknown,
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));

vi.mock("./delivery-status-panel", () => ({ DeliveryStatusPanel: () => null }));

import { StatusPanel } from "./status-panel";

const hash = (value: number) =>
  `0x${value.toString(16).padStart(64, "0")}` as const;

const rewardHistory: RewardHistoryEvent[] = [
  {
    type: "reward-epoch",
    blockNumber: 190n,
    logIndex: 0,
    transactionHash: hash(1),
    transactionIndex: 0,
    epoch: {
      epochNumber: 7n,
      openedWeth: 4n * 10n ** 18n,
      equalTrackShare: 10n ** 18n,
      finalTrackRemainder: 0n,
    },
  },
  ...([1, 2, 3, 4] as const).map((track): RewardHistoryEvent => ({
    type: "track-conversion",
    blockNumber: 190n + BigInt(track),
    logIndex: 0,
    transactionHash: hash(track + 1),
    transactionIndex: 0,
    track,
    conversion: {
      spentWeth: 10n ** 18n,
      stockReceived: BigInt(track) * 10n ** 18n,
      remainingQueue: 0n,
    },
  })),
];

const trackQueues: PublicStatusSnapshotInput["operations"]["trackQueues"] = (
  [1, 2, 3, 4] as const
).map((trackId) => ({ trackId, weth: 10n ** 18n }));

const loadedHealth = {
  health: {
    status: "degraded",
    checks: [
      {
        id: "read-freshness",
        status: "pass",
        severity: "warning",
        freshness: "fresh",
        observedBlock: 200n,
        explanation: "Fresh read",
      },
      {
        id: "pause:rewards",
        status: "fail",
        severity: "warning",
        freshness: "fresh",
        observedBlock: 200n,
        explanation: "Rewards are paused.",
      },
    ],
  },
  deployment: {
    network: "base-sepolia",
    observedBlock: 200n,
    observedAt: 1_700_000_000,
    expectedManifestCommitment: hash(90),
    manifestCommitment: hash(90),
  },
  collection: {
    permanentCount: 800,
    transientCount: 40,
    pendingDiscoveryCount: 4,
    availableIdentityCount: 3_604,
  },
  market: {
    rewardPotWeth: 10n ** 18n,
    liquidityPotWeth: 2n * 10n ** 18n,
    creatorPotWeth: 3n * 10n ** 18n,
  },
  operations: {
    rewardEpochCount: 7n,
    rewardHistoryStatus: "complete",
    rewardHistory,
    trackQueues,
    protocolOwnedLiquidity: {
      queuedWeth: 5n * 10n ** 18n,
      permanentlyLockedWeth: 6n * 10n ** 18n,
    },
  },
  rewards: {
    tracks: ["AAPLc", "GOOGLc", "METAc", "NVDAc"].map((track, index) => ({
      track,
      rawTokenBalance: BigInt(index + 1) * 10n ** 18n,
      rawLiability: BigInt(index + 1) * 10n ** 18n,
    })),
  },
} as const;

const protocol = (overrides: Record<string, unknown> = {}) => ({
  deploymentAvailable: true,
  publicStatus: derivePublicStatusModel(loadedHealth),
  publicStatusError: null,
  publicStatusPending: false,
  refresh: vi.fn(async () => undefined),
  ...overrides,
});

describe("public status panel", () => {
  beforeEach(() => {
    protocolState.protocol = protocol();
  });

  it("shows a concise public snapshot and keeps raw evidence out of the route", () => {
    const html = renderToStaticMarkup(<StatusPanel />);

    expect(html).toContain("Degraded");
    expect(html).toContain("Fresh snapshot");
    expect(html).toContain("Collection state");
    expect(html).toContain("Destination-locked funds");
    expect(html).toContain("Latest indexed reward activity");
    expect(html).toContain("4 WETH entered at opening");
    expect(html).toContain("1 AAPLc reserved for collector claims");
    expect(html).toContain('href="/market"');
    expect(html).toContain('href="/rewards"');
    expect(html).toContain("View complete indexed reward event history");
    expect(html).not.toContain("Selected deployment manifest");
    expect(html).not.toContain(hash(90));
    expect(html).not.toContain("Role configuration");
    expect(html).not.toContain("Bounded event recorder");
    expect(html).not.toContain("raw token units");
    expect(html).not.toContain("Latest keeper cycle");
    expect(html).not.toContain("Keeper attempt evidence");
    expect(html).not.toContain("admin diagnostics");
  });

  it("ages loaded and restored public evidence without refreshing its observation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(loadedHealth.deployment.observedAt * 1_000);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    let root = createRoot(container);
    try {
      await act(async () => root.render(<StatusPanel />));
      expect(container.textContent).toContain("Fresh snapshot");
      const observed = container.querySelector("time")?.dateTime;

      await act(async () => vi.advanceTimersByTime(30_001));
      expect(container.textContent).toContain("Stale snapshot");
      expect(container.querySelector("time")?.dateTime).toBe(observed);

      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<StatusPanel />));
      expect(container.textContent).toContain("Stale snapshot");
      expect(container.querySelector("time")?.dateTime).toBe(observed);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it("lists the public health checks with exact evidence, without operator-only checks", () => {
    protocolState.protocol = protocol({
      health: {
        ...loadedHealth,
        health: {
          ...loadedHealth.health,
          checks: [
            ...loadedHealth.health.checks,
            {
              id: "track:3",
              status: "fail",
              severity: "warning",
              freshness: "fresh",
              observedBlock: 200n,
              explanation: "METAc needs an isolated retry.",
            },
          ],
        },
      },
    });

    const html = renderToStaticMarkup(<StatusPanel />);

    expect(html).toContain("Public health checks");
    expect(html).toContain('data-check-state="healthy"');
    expect(html).toContain('data-check-state="warning"');
    expect(html).toContain("Rewards are paused.");
    expect(html).not.toContain("METAc needs an isolated retry.");
    // The ledger is evidence for the boards above it, so it stays ahead of the
    // methodology disclosure.
    expect(html.indexOf("Public health checks")).toBeLessThan(
      html.indexOf("Reward index evidence and methodology"),
    );
  });

  it("announces a cold read as busy without implying health", () => {
    protocolState.protocol = protocol({
      publicStatus: undefined,
      publicStatusPending: true,
    });

    const html = renderToStaticMarkup(<StatusPanel />);

    // The condition is stated once, as a busy live region. Three skeleton
    // cards reserved layout but read as content a reader could mistake for a
    // result — the same defect the home page's telemetry board had.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("Reading the latest point-in-time");
    expect(html).toContain("Base Sepolia deployment evidence");
    expect(html).not.toContain("Healthy");
    expect(html).not.toContain("Degraded");
  });

  it("keeps last-known evidence visible when a refresh fails", () => {
    protocolState.protocol = protocol({
      publicStatusError: new Error("private RPC URL failed"),
      publicStatusRefreshing: false,
    });

    const html = renderToStaticMarkup(<StatusPanel />);

    expect(html).toContain("Showing last-known public snapshot");
    expect(html).toContain("Degraded");
    expect(html).toContain("Retry public status");
    expect(html).not.toContain("private RPC URL failed");
  });

  it("offers a safe retry without exposing an upstream error or inferring health", () => {
    protocolState.protocol = protocol({
      publicStatus: undefined,
      publicStatusError: new Error("private RPC URL failed"),
    });

    const html = renderToStaticMarkup(<StatusPanel />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Public snapshot unavailable");
    expect(html).toContain("No healthy state is inferred");
    expect(html).toContain("Retry public status");
    expect(html).not.toContain("private RPC URL failed");
    expect(html).not.toContain("Healthy");
  });
});
