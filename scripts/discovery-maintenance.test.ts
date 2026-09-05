import { describe, expect, it, vi } from "vitest";

import type { DiscoveryBatchObservation } from "@orbit/protocol/discovery";

import {
  bindLocalDiscoverySigner,
  runDiscoveryMaintenance,
  type DiscoveryMaintenanceAction,
} from "./discovery-maintenance.ts";

const batch = (
  overrides: Partial<DiscoveryBatchObservation> = {},
): DiscoveryBatchObservation => ({
  vrfRequestId: 44n,
  sequence: 0n,
  state: "ready",
  requestedAt: 1_000n,
  fulfilledAt: 1_030n,
  count: 15,
  finalizedCount: 0,
  delayReported: false,
  delayed: false,
  fullyCancelled: false,
  ...overrides,
});

describe("discovery maintenance", () => {
  it("replaces a simulation-only address with the local signing account", () => {
    const localAccount = {
      address: `0x${"22".repeat(20)}`,
      source: "privateKey",
      type: "local",
    } as Parameters<typeof bindLocalDiscoverySigner>[1];
    const request = {
      account: `0x${"11".repeat(20)}`,
      functionName: "finalizeDiscovery",
    };

    const signedRequest = bindLocalDiscoverySigner(request, localAccount);

    expect(signedRequest.account).toBe(localAccount);
    expect(signedRequest.functionName).toBe("finalizeDiscovery");
  });

  it("drains a ready batch through repeated bounded confirmed calls", async () => {
    const observations = [batch(), batch({ finalizedCount: 8 }), undefined];
    const observe = vi.fn(async () => observations.shift());
    const attempt = vi.fn(
      async (action: DiscoveryMaintenanceAction, execute: boolean) => {
        void action;
        void execute;
        return {
          status: "confirmed" as const,
          transactionHash: `0x${"11".repeat(32)}` as const,
        };
      },
    );

    const evidence = await runDiscoveryMaintenance({
      chain: { observe, attempt },
      execute: true,
      maximumActions: 8,
    });

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls.map(([action]) => action.kind)).toEqual([
      "finalize",
      "finalize",
    ]);
    expect(evidence.status).toBe("idle");
    expect(evidence.actions).toHaveLength(2);
  });

  it("reports a delayed request once without trying replacement randomness", async () => {
    const delayed = batch({
      state: "awaiting-randomness",
      fulfilledAt: undefined,
      delayed: true,
    });
    const attempt = vi.fn(
      async (action: DiscoveryMaintenanceAction, execute: boolean) => {
        void action;
        void execute;
        return { status: "simulated" as const };
      },
    );

    const evidence = await runDiscoveryMaintenance({
      chain: { observe: async () => delayed, attempt },
      execute: false,
      maximumActions: 8,
    });

    expect(attempt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "report-delay", vrfRequestId: 44n }),
      false,
    );
    expect(evidence.status).toBe("simulated");
  });

  it("leaves an on-time external request alone with an explicit reason", async () => {
    const attempt = vi.fn();

    const evidence = await runDiscoveryMaintenance({
      chain: {
        observe: async () =>
          batch({
            state: "awaiting-randomness",
            fulfilledAt: undefined,
          }),
        attempt,
      },
      execute: true,
      maximumActions: 8,
    });

    expect(attempt).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({
      status: "waiting",
      reason: "Waiting for the verified Chainlink VRF response.",
    });
  });
});
