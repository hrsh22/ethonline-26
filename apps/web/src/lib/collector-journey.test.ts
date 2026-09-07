import { describe, expect, it } from "vitest";

import { createCollectorJourneyView } from "./collector-journey";

const address = "0x2000000000000000000000000000000000000002";

const fundingResponse = (
  state: "eligible" | "already-funded",
  balances?: { readonly ethWei: string; readonly wethWei: string },
) => ({
  apiVersion: 1 as const,
  service: { chainId: 84_532, state: "ready" as const },
  recipient: {
    address,
    state,
    ...(balances === undefined ? {} : { balances }),
  },
});

const walletRead = (
  progress: "empty" | "pending" | "grounded" | "orbiter",
  settlementBalanceWei = 0n,
) => ({
  status: "loaded" as const,
  snapshot: {
    liquidToken: {
      // Base units: the journey view no longer formats these itself.
      rawWei: 4n * 10n ** 17n,
      wholeUnits: 0,
      nextDiscoveryDraw: {
        thresholdWei: 10n ** 18n,
        remainingWei: 6n * 10n ** 17n,
      },
    },
    settlementToken: { rawWei: settlementBalanceWei },
    collectibles: {
      permanentHoldingsStatus: "complete" as const,
      pendingDiscovery: { count: progress === "pending" ? 1 : 0 },
      transient: progress === "grounded" ? [{ identityId: 1493 }] : [],
      permanent: progress === "orbiter" ? [{ identityId: 1493 }] : [],
    },
  },
});

describe("collector journey view", () => {
  it.each([
    ["disconnected", "connect-wallet"],
    ["wrong-network", "switch-network"],
    ["deployment-pending", "none"],
  ] as const)("keeps %s access in the Fund phase", (accessState, action) => {
    const journey = createCollectorJourneyView({
      accessState,
      walletRead: { status: "blocked", accessState },
    });

    expect(journey.phases).toMatchObject([
      { id: "fund", status: "current", action },
      { id: "discover", status: "waiting", action: "none" },
      { id: "launch", status: "waiting", action: "none" },
    ]);
  });

  it("routes an unfunded empty wallet to the bounded faucet", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      fundingResponse: fundingResponse("eligible"),
      walletRead: walletRead("empty"),
    });

    expect(journey.phases[0]).toMatchObject({
      id: "fund",
      status: "current",
      action: "open-faucet",
    });
    expect(journey.metrics).toEqual({
      available: true,
      balanceWei: 4n * 10n ** 17n,
      nextThresholdWei: 10n ** 18n,
      remainingWei: 6n * 10n ** 17n,
      pending: 0,
      transient: 0,
      permanent: 0,
    });
  });

  it("routes a funded wallet to Trade until it crosses Discovery", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      fundingResponse: fundingResponse("already-funded"),
      walletRead: walletRead("empty"),
    });

    expect(journey.phases).toMatchObject([
      { id: "fund", status: "current", action: "open-trade" },
      { id: "discover", status: "waiting", action: "none" },
      { id: "launch", status: "waiting", action: "none" },
    ]);
  });

  it("routes an eligible partial wallet to Trade when it already has WETH and gas", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      fundingResponse: fundingResponse("eligible", {
        ethWei: "5000000000000000",
        wethWei: "50000000000000000",
      }),
      walletRead: walletRead("empty", 50_000_000_000_000_000n),
    });

    expect(journey.phases[0]).toMatchObject({
      id: "fund",
      status: "current",
      action: "open-trade",
    });
  });

  it("keeps WETH without gas on the Faucet path", () => {
    const wethWei = 50_000_000_000_000_000n;
    const journey = createCollectorJourneyView({
      accessState: "ready",
      fundingResponse: fundingResponse("eligible", {
        ethWei: "0",
        wethWei: wethWei.toString(),
      }),
      walletRead: walletRead("empty", wethWei),
    });

    expect(journey.phases[0].action).toBe("open-faucet");
  });

  it("routes native ETH without WETH directly to Trade", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      nativeBalanceWei: 5_000_000_000_000_000n,
      walletRead: walletRead("empty", 0n),
    });

    expect(journey.phases[0].action).toBe("open-trade");
  });

  it("collapses Fund once a Discovery is pending", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      fundingResponse: fundingResponse("eligible"),
      walletRead: walletRead("pending"),
    });

    expect(journey.phases).toMatchObject([
      { id: "fund", status: "complete", action: "none" },
      { id: "discover", status: "current", action: "open-collection" },
      { id: "launch", status: "waiting", action: "none" },
    ]);
  });

  it("selects a Grounded Craft for the irreversible Launch review", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      walletRead: walletRead("grounded"),
    });

    expect(journey.phases).toMatchObject([
      { id: "fund", status: "complete" },
      { id: "discover", status: "complete" },
      {
        id: "launch",
        status: "current",
        action: "review-launch",
        targetIdentityId: 1493,
      },
    ]);
  });

  it("reduces a permanent Orbiter wallet to a completed journey", () => {
    const journey = createCollectorJourneyView({
      accessState: "ready",
      walletRead: walletRead("orbiter"),
    });

    expect(journey.complete).toBe(true);
    expect(journey.phases.every(({ status }) => status === "complete")).toBe(
      true,
    );
    expect(journey.primaryIdentityId).toBe(1493);
  });
});
