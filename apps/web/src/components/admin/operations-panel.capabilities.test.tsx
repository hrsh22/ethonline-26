import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({ protocol: undefined as unknown }));

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

const capabilities = (
  overrides: Partial<Record<string, boolean>> = {},
): Record<string, boolean> => ({
  owner: false,
  keeper: false,
  liquidityExecutor: false,
  guardian: false,
  recovery: false,
  creator: false,
  ...overrides,
});

const protocol = (capabilityFlags: Record<string, boolean>) => ({
  accessState: "ready" as const,
  address: "0x0000000000000000000000000000000000004444",
  deploymentAvailable: true,
  healthPending: false,
  healthError: null,
  walletRead: { status: "loaded" as const, snapshot: { partialFailures: [] } },
  health: {
    capabilities: capabilityFlags,
    connectedWalletFrozen: false,
    deployment: { observedAt: 1, observedBlock: 1n },
    health: { observedBlock: 1n },
    market: {
      currentTick: undefined,
      liquidityPotWeth: 0n,
      liquidityPotWethFormatted: "0",
      creatorPotWeth: 5n * 10n ** 17n,
      creatorPotWethFormatted: "0.5",
      rewardPotWeth: 0n,
      rewardPotWethFormatted: "0",
      tickSpacing: 60,
      wethIsCurrency0: true,
    },
    operations: {
      rewardEpochCount: 0n,
      lastRewardEpochAt: 0n,
      nextRewardEpochAt: 0n,
      trackQueues: [],
      trackOutcomes: [],
      protocolOwnedLiquidity: {
        queuedWeth: 0n,
        queuedWethFormatted: "0",
        permanentlyLockedWethFormatted: "0",
        cycleCount: 0,
      },
    },
    pauses: {
      liquidToken: false,
      rewards: false,
      converter: false,
      liquidity: false,
    },
    roles: {
      owners: {},
      creator: "0x0000000000000000000000000000000000000006",
    },
  },
  transaction: { status: "idle" as const },
  refresh: vi.fn(),
  getActionState: vi.fn(() => ({ enabled: true, reason: undefined })),
  execute: vi.fn(),
  retry: vi.fn(),
});

describe("capability-scoped admin console", () => {
  beforeEach(() => {
    protocolState.protocol = undefined;
  });

  // The role panel deliberately lists capabilities the actor does *not* hold,
  // so these assert on rendered controls rather than on words anywhere.
  const controls = (html: string): string =>
    [...html.matchAll(/<button[^>]*>(?<label>[^<]*)</gu)]
      .map((match) => match.groups?.label ?? "")
      .join(" | ");

  it("shows a keeper only the keeper actions", () => {
    protocolState.protocol = protocol(capabilities({ keeper: true }));
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(controls(html)).toContain("Open Reward Epoch");
    expect(controls(html)).not.toContain("Withdraw all");
    expect(controls(html)).not.toMatch(/\bPause\b/u);
    expect(html).not.toContain("Pause controls");
    expect(html).not.toContain("Creator fees");
  });

  it("shows a creator only the creator withdrawal", () => {
    protocolState.protocol = protocol(capabilities({ creator: true }));
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Creator fees");
    expect(controls(html)).toContain("Withdraw all");
    expect(html).toContain("0.5 WETH");
    // No unrelated operator capability is inherited.
    expect(controls(html)).not.toContain("Open Reward Epoch");
    expect(html).not.toContain("Pause controls");
    expect(controls(html)).not.toMatch(/\bPause\b/u);
  });

  it("shows a liquidity executor only the liquidity action", () => {
    protocolState.protocol = protocol(
      capabilities({ liquidityExecutor: true }),
    );
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(controls(html)).toContain("Execute");
    expect(html).not.toContain("Creator fees");
    expect(controls(html)).not.toContain("Open Reward Epoch");
  });

  it("shows pause controls only to module owners", () => {
    protocolState.protocol = protocol(capabilities({ owner: true }));
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Pause controls");
    expect(controls(html)).toMatch(/\bPause\b/u);
    expect(html).not.toContain("Creator fees");
    expect(controls(html)).not.toContain("Open Reward Epoch");
  });

  it("tells a console role with no actionable capability why the deck is empty", () => {
    protocolState.protocol = protocol(capabilities({ guardian: true }));
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("No actions for this authority");
    expect(html).not.toContain("Creator fees");
    expect(controls(html)).not.toContain("Open Reward Epoch");
  });

  it("names the empty half of the authority columns instead of leaving it blank", () => {
    /* An authority holding every role left "Cannot do" as a heading over an
       empty list, which reads as a board that failed to load rather than as
       a wallet with nothing withheld. */
    protocolState.protocol = protocol(
      capabilities({
        creator: true,
        guardian: true,
        keeper: true,
        liquidityExecutor: true,
        owner: true,
        recovery: true,
      }),
    );
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Cannot do");
    expect(html).toContain(
      "Nothing. This wallet holds every capability the console exposes.",
    );
    expect(html).not.toMatch(/Cannot do<\/h3><ul/u);
  });

  it("does not offer a withdrawal when no creator fees have accrued", () => {
    const base = protocol(capabilities({ creator: true }));
    protocolState.protocol = {
      ...base,
      health: {
        ...base.health,
        market: {
          ...base.health.market,
          creatorPotWeth: 0n,
          creatorPotWethFormatted: "0",
        },
      },
    };
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("No creator fees have accrued yet.");
    expect(controls(html)).not.toContain("Withdraw all");
  });
});
