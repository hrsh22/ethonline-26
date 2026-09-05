import { describe, expect, it, vi } from "vitest";

import {
  deriveCurrentHealth,
  deriveWalletRead,
  isPublicStatusModel,
  withPublicReadTimeout,
  walletSnapshotIsSynchronizing,
} from "./protocol-client-provider";

describe("protocol client wallet synchronization", () => {
  it("marks retained wallet data as synchronizing until the confirmed block is indexed", () => {
    expect(walletSnapshotIsSynchronizing(10n, 9n)).toBe(true);
    expect(walletSnapshotIsSynchronizing(10n, undefined)).toBe(true);
    expect(walletSnapshotIsSynchronizing(10n, 10n)).toBe(false);
    expect(walletSnapshotIsSynchronizing(undefined, 9n)).toBe(false);
  });
});

describe("protocol client wallet read", () => {
  it("surfaces a current query error instead of a retained wallet snapshot", () => {
    const error = new Error("current wallet read failed");
    const snapshot = {} as NonNullable<
      Parameters<typeof deriveWalletRead>[0]["snapshot"]
    >;

    expect(
      deriveWalletRead({
        accessState: "ready",
        error,
        fetching: false,
        pending: false,
        snapshot,
      }),
    ).toEqual({ status: "failed", error });
  });
});

describe("protocol client health read", () => {
  it("retains public health after a refresh failure and fails operator health closed", () => {
    const snapshot = {} as NonNullable<
      Parameters<typeof deriveCurrentHealth>[0]
    >;

    expect(
      deriveCurrentHealth(snapshot, new Error("current read failed")),
    ).toBe(snapshot);
    expect(
      deriveCurrentHealth(snapshot, new Error("current read failed"), true),
    ).toBeUndefined();
    expect(deriveCurrentHealth(snapshot, null)).toBe(snapshot);
  });

  it("rejects incomplete cached public evidence before React can consume it", () => {
    expect(
      isPublicStatusModel({
        health: "healthy",
        freshness: "fresh",
        network: "base-sepolia",
        observedAt: 1_700_000_000,
        observedBlock: 200n,
        collection: {},
        funds: {},
      }),
    ).toBe(false);
  });

  it("turns a public read into actionable failure after eight seconds", async () => {
    vi.useFakeTimers();
    const result = withPublicReadTimeout(
      () => new Promise<never>(() => undefined),
    );
    const rejection = expect(result).rejects.toThrow(
      "timed out after 8 seconds",
    );
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;
    vi.useRealTimers();
  });
});
