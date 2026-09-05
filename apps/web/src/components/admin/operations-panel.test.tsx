import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({
  protocol: undefined as unknown,
}));

vi.mock("wagmi", () => ({
  useSignMessage: () => ({
    signMessageAsync: async () => `0x${"ab".repeat(65)}`,
  }),
}));

const controlState = vi.hoisted(() => ({
  reading: { state: undefined, unreachable: false } as {
    readonly state: unknown;
    readonly unreachable: boolean;
  },
}));

vi.mock("@/components/admin/operator-control-state", () => ({
  useOperatorControlState: () => controlState.reading,
}));

vi.mock("@/components/admin/operator-control-panel", () => ({
  OperatorControlPanel: () => null,
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));

import { OperationsPanel } from "./operations-panel";

const ordinaryWalletProtocol = () => ({
  accessState: "ready" as const,
  address: "0x0000000000000000000000000000000000004444",
  deploymentAvailable: true,
  healthPending: false,
  healthError: null,
  walletRead: {
    status: "loaded" as const,
    snapshot: { partialFailures: [] },
  },
  health: {
    capabilities: {
      owner: false,
      keeper: false,
      liquidityExecutor: false,
      guardian: false,
      recovery: false,
      creator: false,
    },
    connectedWalletFrozen: false,
    deployment: { observedAt: 1 },
    health: { observedBlock: 1n },
    market: {
      currentTick: undefined,
      liquidityPotWeth: 0n,
      liquidityPotWethFormatted: "0",
    },
    operations: {
      rewardEpochCount: 0n,
      lastRewardEpochAt: 0n,
      nextRewardEpochAt: 0n,
      trackQueues: [],
      trackOutcomes: [],
      recentEvents: [],
      protocolOwnedLiquidity: {
        queuedWeth: 0n,
        queuedWethFormatted: "0",
        permanentlyLockedWethFormatted: "0",
        cycleCount: 0n,
      },
    },
    pauses: {},
    roles: { owners: {} },
  },
  getActionState: vi.fn(() => ({ enabled: false, reason: "No role" })),
  execute: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  transaction: { status: "idle" as const },
});

describe("admin operations access", () => {
  it("explains a missing admin role before rendering protocol controls", () => {
    protocolState.protocol = ordinaryWalletProtocol();

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("No admin role detected");
    expect(html).toContain('data-state="blocked"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Authorized action deck");
    expect(html).not.toContain("Role configuration");
    expect(html).toContain('href="/status"');
  });

  it("announces an authority read failure assertively without exposing raw errors", () => {
    protocolState.protocol = {
      ...ordinaryWalletProtocol(),
      healthError: new Error("private operator rpc failed"),
    };

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).not.toContain("private operator rpc failed");
  });

  it("disables authorized action controls while a transaction is in flight", () => {
    const protocol = ordinaryWalletProtocol();
    protocolState.protocol = {
      ...protocol,
      health: {
        ...protocol.health,
        // Boards are capability-scoped now, so this case grants the exact
        // capabilities whose controls it asserts on.
        capabilities: {
          ...protocol.health.capabilities,
          keeper: true,
          liquidityExecutor: true,
          owner: true,
        },
      },
      getActionState: vi.fn(() => ({
        enabled: false,
        reason: "Transaction pending",
      })),
      transaction: {
        status: "simulated" as const,
        label: "Open Reward Epoch",
      },
    };

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open Reward Epoch/);
    const disabledButtons = [
      ...html.matchAll(/<button(?<attributes>[^>]*)>/gu),
    ].filter((button) => button.groups?.attributes?.includes('disabled=""'));
    expect(disabledButtons.length).toBeGreaterThan(1);
    for (const button of disabledButtons) {
      const reasonId = /aria-describedby="(?<id>[^"]+)"/u.exec(
        button.groups?.attributes ?? "",
      )?.groups?.id;
      expect(reasonId, button[0]).toBeDefined();
      expect(html, reasonId).toContain(`id="${reasonId}"`);
    }
    expect(html).toContain('class="');
    expect(html).toContain("disabled-reason");
    expect(html).toContain('role="note"');
    expect(html).toContain("Refresh the current market snapshot");
    expect(html).toContain("Refresh the current pause snapshot");
    expect(html).not.toContain("Not observed yet</p>");
    /* The reasons read as sentences on their own. Prefixing them with
       "Unavailable because" glued a conjunction onto an imperative. */
    expect(html).not.toContain("Unavailable because");
  });

  it.each([
    [0n, "No previous Reward Epoch"],
    [undefined, "Not observed yet"],
    [1_735_689_600n, "2025-01-01 00:00:00"],
  ])(
    "distinguishes the last epoch at %s from next-epoch readiness",
    (at, label) => {
      const protocol = ordinaryWalletProtocol();
      protocolState.protocol = {
        ...protocol,
        health: {
          ...protocol.health,
          capabilities: { ...protocol.health.capabilities, keeper: true },
          operations: { ...protocol.health.operations, lastRewardEpochAt: at },
        },
      };

      const html = renderToStaticMarkup(<OperationsPanel />);

      expect(
        /Last Reward Epoch<\/dt><dd[^>]*>([^<]*)<\/dd>/u.exec(html)?.[1],
      ).toBe(label);
      expect(html).toMatch(/Next Reward Epoch<\/dt><dd[^>]*>Ready now<\/dd>/u);
    },
  );

  it.each(["live", "stopped"] as const)(
    "separates the online service from %s policy and reward-track work",
    (mode) => {
      /* The attention board used to hardcode an offline service because a
       protocol read cannot observe a process, so it reported CRITICAL /
       Offline beside an automation panel that said Online for the same
       deployment at the same moment. */
      const protocol = ordinaryWalletProtocol();
      protocolState.protocol = {
        ...protocol,
        health: {
          ...protocol.health,
          capabilities: { ...protocol.health.capabilities, keeper: true },
          collection: { pendingDiscoveryCount: 1 },
          pauses: {
            liquidToken: false,
            rewards: false,
            converter: false,
            liquidity: false,
          },
        },
      };
      controlState.reading = {
        state: {
          audit: [],
          desired: { mode, oneShot: "none" },
          heartbeat: {
            at: Date.UTC(2026, 8, 5, 8, 4, 0),
            observedMode: mode,
            supervisor: "launchd",
          },
          nextRunAt: Date.UTC(2026, 8, 5, 8, 9, 0),
          service: "online",
        },
        unreachable: false,
      };

      const html = renderToStaticMarkup(<OperationsPanel />);

      expect(html).toContain("Online");
      if (mode === "stopped") {
        expect(html).toContain("Stopped");
        expect(html).toContain("Automation policy");
        expect(html).not.toContain("Everything is running");
      }
      expect(html).toContain("Reward-track queues");
      expect(html).toContain("No reward-track funds queued");
      expect(html).not.toContain("No work queued");
      expect(html).not.toContain("Offline");
      expect(html).not.toContain(
        "Check the supervisor process before changing automation policy",
      );
      expect(html).not.toContain(
        "Something is broken and needs an operator now",
      );

      controlState.reading = { state: undefined, unreachable: false };
    },
  );

  it("does not call the operator service offline before the control plane is read", () => {
    const protocol = ordinaryWalletProtocol();
    protocolState.protocol = {
      ...protocol,
      health: {
        ...protocol.health,
        capabilities: { ...protocol.health.capabilities, keeper: true },
      },
    };
    controlState.reading = { state: undefined, unreachable: false };

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Not read yet");
    expect(html).not.toContain("Offline");
    expect(html).not.toContain("Something is broken and needs an operator now");
  });

  it("escalates to critical only when the control plane cannot be reached", () => {
    const protocol = ordinaryWalletProtocol();
    protocolState.protocol = {
      ...protocol,
      health: {
        ...protocol.health,
        capabilities: { ...protocol.health.capabilities, keeper: true },
      },
    };
    controlState.reading = { state: undefined, unreachable: true };

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Offline");
    expect(html).toContain(
      "Check the supervisor process before changing automation policy",
    );

    controlState.reading = { state: undefined, unreachable: false };
  });

  it("renders balances as headlines rather than exact 18-decimal expansions", () => {
    /* The console used to render the reader's `formatUnits(value, 18)`
       strings, so an accrued creator fee reached the operator as
       "0.003718500000000005 WETH" -- the exact string the format module's
       docstring cites as the thing it exists to prevent. */
    const protocol = ordinaryWalletProtocol();
    protocolState.protocol = {
      ...protocol,
      health: {
        ...protocol.health,
        capabilities: {
          ...protocol.health.capabilities,
          creator: true,
          keeper: true,
          liquidityExecutor: true,
        },
        market: {
          ...protocol.health.market,
          creatorPotWeth: 3_718_500_000_000_005n,
          creatorPotWethFormatted: "0.003718500000000005",
        },
        operations: {
          ...protocol.health.operations,
          protocolOwnedLiquidity: {
            ...protocol.health.operations.protocolOwnedLiquidity,
            permanentlyLockedWeth: 21_071_499_999_999_995n,
            permanentlyLockedWethFormatted: "0.021071499999999995",
          },
        },
      },
    };

    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("0.0037185");
    expect(html).toContain("0.021071");
    expect(html).not.toContain("0.003718500000000005 WETH");
    expect(html).not.toContain("0.021071499999999995");
    /* The exact wei stays one disclosure away rather than being dropped. */
    expect(html).toContain("3718500000000005");
  });
});
