import { describe, expect, it } from "vitest";

import { derivePrivilegedActionReview } from "./privileged-action-review";

const base = {
  actor: "0x1111111111111111111111111111111111111111",
  chainLabel: "Base Sepolia",
  currentState: "Queued",
  intendedState: "Converted",
  observedBlock: 46_176_595n,
  roles: ["keeper"] as const,
  subject: "Track 1",
};

const trackAction = {
  type: "execute-track",
  track: 1,
  minimumStockOutput: 990n,
  deadline: 1_800_000_000n,
} as const;

describe("privileged action review", () => {
  it("names the exact capability each action requires", () => {
    expect(
      derivePrivilegedActionReview({ ...base, action: trackAction })
        .requiredRole,
    ).toBe("keeper");
    expect(
      derivePrivilegedActionReview({
        ...base,
        action: {
          type: "execute-pol",
          tickLower: -60,
          tickUpper: 60,
          liquidity: 1n,
          maximumWeth: 1n,
          deadline: 1n,
        },
      }).requiredRole,
    ).toBe("liquidity-executor");
    expect(
      derivePrivilegedActionReview({
        ...base,
        action: { type: "withdraw-creator-fees", amount: 1n },
      }).requiredRole,
    ).toBe("creator");
    expect(
      derivePrivilegedActionReview({
        ...base,
        action: { type: "set-pause", module: "rewards", paused: true },
      }).requiredRole,
    ).toBe("reward-ledger-owner");
  });

  it("pins the actor, network, and observation block", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
    });
    expect(review.actor).toBe(base.actor);
    expect(review.network).toBe("Base Sepolia");
    expect(review.observedBlock).toBe("46176595");
    expect(review.currentState).toBe("Queued");
    expect(review.intendedState).toBe("Converted");
  });

  it("states the expected output, policy minimum, and quote block in display units", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      expectedOutput: {
        quotedOutput: 2n * 10n ** 18n,
        minimumOutput: 198n * 10n ** 16n,
        minimumOutputBps: 9_900,
        quoteBlock: 46_176_595n,
      },
    });
    const rows = new Map(review.rows);
    expect(rows.get("Expected output")).toContain("2 ");
    expect(rows.get("Protected minimum")).toContain("1.98 ");
    expect(rows.get("Protected minimum")).toContain("(99%)");
    expect(rows.get("Route quoted at block")).toBe("46176595");
  });

  it("shows the deadline for actions that carry one", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
    });
    expect(new Map(review.rows).get("Must confirm before")).toContain("UTC");
    const epoch = derivePrivilegedActionReview({
      ...base,
      action: { type: "open-reward-epoch" },
    });
    expect(new Map(epoch.rows).has("Must confirm before")).toBe(false);
  });

  it("refuses to submit when the protected minimum rounds to zero", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      expectedOutput: {
        quotedOutput: 1n,
        minimumOutput: 0n,
        minimumOutputBps: 9_900,
        quoteBlock: 46_176_595n,
      },
    });
    expect(review.blocker).toContain("rounds to zero");
  });

  it("refuses to submit against a quote older than the snapshot", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      expectedOutput: {
        quotedOutput: 10n ** 18n,
        minimumOutput: 99n * 10n ** 16n,
        minimumOutputBps: 9_900,
        quoteBlock: 46_176_500n,
      },
    });
    expect(review.blocker).toContain("older than the current snapshot");
  });

  it("refuses to submit when the route quote failed", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      expectedOutput: {
        quotedOutput: 10n ** 18n,
        minimumOutput: 99n * 10n ** 16n,
        minimumOutputBps: 9_900,
        quoteBlock: 46_176_595n,
      },
      quoteStale: true,
    });
    expect(review.blocker).toContain("Refresh the quote");
  });

  it("refuses to submit without a connected signing wallet", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      actor: undefined,
    });
    expect(review.blocker).toContain("No signing wallet");
  });

  it("accepts a current quote pinned to the observed block", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: trackAction,
      expectedOutput: {
        quotedOutput: 10n ** 18n,
        minimumOutput: 99n * 10n ** 16n,
        minimumOutputBps: 9_900,
        quoteBlock: 46_176_595n,
      },
    });
    expect(review.blocker).toBeUndefined();
  });

  it("names which actions a pause stops and which remain available", () => {
    const paused = derivePrivilegedActionReview({
      ...base,
      action: { type: "set-pause", module: "converter", paused: true },
    });
    expect(paused.consequences[0]).toContain("Stops reward-epoch opening");
    expect(paused.consequences[0]).toContain("Queued WETH stays queued");
    expect(paused.consequences[1]).toContain("governed separately");

    const resumed = derivePrivilegedActionReview({
      ...base,
      action: { type: "set-pause", module: "converter", paused: false },
    });
    expect(resumed.consequences[0]).toContain("Restores reward-epoch opening");
  });

  it("distinguishes each module's pause blast radius", () => {
    const modules = [
      "liquidToken",
      "rewards",
      "converter",
      "liquidity",
    ] as const;
    const messages = modules.map(
      (module) =>
        derivePrivilegedActionReview({
          ...base,
          action: { type: "set-pause", module, paused: true },
        }).consequences[0],
    );
    expect(new Set(messages).size).toBe(modules.length);
  });

  it("states that creator withdrawal cannot choose a destination", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: { type: "withdraw-creator-fees", amount: 5n * 10n ** 17n },
    });
    expect(new Map(review.rows).get("Amount")).toBe("0.5 WETH");
    expect(review.consequences[0]).toContain("cannot be chosen here");
  });

  it("warns that protocol-owned liquidity is permanently locked", () => {
    const review = derivePrivilegedActionReview({
      ...base,
      action: {
        type: "execute-pol",
        tickLower: -120,
        tickUpper: 120,
        liquidity: 10n,
        maximumWeth: 10n ** 18n,
        deadline: 1_800_000_000n,
      },
    });
    const rows = new Map(review.rows);
    expect(rows.get("Tick range")).toBe("-120 → 120");
    expect(rows.get("WETH budget")).toBe("1 WETH");
    expect(review.consequences[0]).toContain("permanently locked");
  });
});
