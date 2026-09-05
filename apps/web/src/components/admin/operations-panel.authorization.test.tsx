/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorizeAction: vi.fn(),
  execute: vi.fn(),
  retry: vi.fn(),
  roles: ["keeper"] as Array<"keeper" | "recovery">,
}));

const health = {
  capabilities: {
    owner: false,
    keeper: true,
    liquidityExecutor: false,
    guardian: false,
    recovery: false,
    creator: false,
  },
  connectedWalletFrozen: false,
  deployment: { observedAt: 1_000 },
  health: { observedBlock: 100n },
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
};

const protocol = {
  accessState: "ready" as const,
  address: "0x1111111111111111111111111111111111111111",
  deploymentAvailable: true,
  execute: state.execute,
  getActionState: vi.fn(() => ({ enabled: true, reason: undefined })),
  health,
  healthError: null,
  healthPending: false,
  refresh: vi.fn(),
  retry: state.retry,
  transaction: { status: "idle" as const },
};

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
  useProtocolClient: () => protocol,
}));

vi.mock("@/components/admin/admin-session-boundary", () => ({
  useOptionalAdminSession: () => ({
    authorizeAction: state.authorizeAction,
    endSession: vi.fn(),
    session: { roles: state.roles },
  }),
}));

import { OperationsPanel } from "./operations-panel";

describe("admin operation authorization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.authorizeAction.mockReset().mockResolvedValue(undefined);
    state.execute.mockReset().mockResolvedValue({ status: "confirmed" });
    state.retry.mockReset().mockResolvedValue({ status: "confirmed" });
    state.roles = ["keeper"];
    health.capabilities.keeper = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Privileged actions now submit from a review, so the deck control opens the
  // dialog and the dialog's confirm performs the execution.
  const confirmReview = async (triggerText: string) => {
    const trigger = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.startsWith(triggerText),
    );
    await act(async () => trigger?.click());
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-privileged-review] button",
      ),
    ].find((candidate) => candidate.textContent === "Sign and submit");
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
  };

  it("injects a minimum-shape server authorization into each admin execution", async () => {
    await act(async () => root.render(<OperationsPanel />));

    await confirmReview("Open");

    expect(state.execute).toHaveBeenCalledWith(
      { type: "open-reward-epoch" },
      expect.any(String),
      expect.any(Function),
    );
    const authorize = state.execute.mock.calls[0]?.[2] as
      | ((action: { readonly type: "open-reward-epoch" }) => Promise<void>)
      | undefined;
    await authorize?.({ type: "open-reward-epoch" });
    expect(state.authorizeAction).toHaveBeenCalledWith({
      type: "open-reward-epoch",
    });
  });

  it("keeps a recovery signer inside the console using the server-authenticated role", async () => {
    state.roles = ["recovery"];
    health.capabilities.keeper = false;

    await act(async () => root.render(<OperationsPanel />));

    expect(container.textContent).toContain("Recovery");
    expect(container.textContent).not.toContain("No admin role detected");
  });
});
