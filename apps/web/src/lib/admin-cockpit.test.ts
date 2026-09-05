import { describe, expect, it } from "vitest";

import type { OperatorControlState } from "@orbit/config/operator-control";

import {
  controlTimestamp,
  deriveCockpitView,
  operatorControlFacts,
  roleCapabilities,
  severityRank,
  type CockpitInput,
} from "./admin-cockpit";

const input = (overrides: Partial<CockpitInput> = {}): CockpitInput => ({
  automation: "live",
  checks: [],
  dependenciesReady: true,
  lastOutcome: undefined,
  nextRunAt: "2026-08-31 20:00:00",
  observedBlock: "46176595",
  pauses: "active",
  roles: ["keeper"],
  service: "online",
  serviceObservedAt: "2026-08-31 19:59:00",
  work: "idle",
  ...overrides,
});

describe("admin cockpit view", () => {
  it("answers the landing questions in one place", () => {
    const view = deriveCockpitView(input());
    expect(view.services.map((status) => status.id)).toEqual([
      "operator-service",
      "dependency-readiness",
      "automation-policy",
      "protocol-pause",
      "work-eligibility",
    ]);
    expect(view.roles).toEqual(["keeper"]);
    expect(view.nextRun).toBe("2026-08-31 20:00:00");
  });

  it("reports healthy when nothing needs attention", () => {
    const view = deriveCockpitView(input());
    expect(view.attention).toEqual([]);
    expect(view.globalSeverity).toBe("ok");
    expect(view.headline).toContain("healthy");
  });

  it("never lets a live policy imply a running service", () => {
    const view = deriveCockpitView(input({ service: "offline" }));
    const service = view.services.find(
      (status) => status.id === "operator-service",
    );
    expect(service?.severity).toBe("critical");
    expect(service?.impact).toContain("whatever the automation policy says");
    expect(view.globalSeverity).toBe("critical");
  });

  it("treats a late heartbeat as degraded rather than offline", () => {
    const view = deriveCockpitView(input({ service: "degraded" }));
    expect(
      view.services.find((status) => status.id === "operator-service")
        ?.severity,
    ).toBe("warning");
  });

  it("does not escalate an unread control plane to critical", () => {
    const view = deriveCockpitView(
      input({ automation: "unknown", service: "unknown" }),
    );
    const service = view.services.find(
      (status) => status.id === "operator-service",
    );
    expect(service?.severity).toBe("notice");
    expect(service?.freshness).toBe("unknown");
    expect(service?.observed).toBe("Not read yet");
    expect(view.globalSeverity).toBe("notice");
  });

  it("dates the service status from the heartbeat, not a protocol block", () => {
    const service = deriveCockpitView(
      input({
        observedBlock: "46176595",
        serviceObservedAt: "2026-09-05 08:04:00",
      }),
    ).services.find((status) => status.id === "operator-service");
    expect(service?.observedAt).toBe("2026-09-05 08:04:00");
  });

  it("treats a stopped policy as a setting, not a fault", () => {
    const view = deriveCockpitView(input({ automation: "stopped" }));
    const automation = view.services.find(
      (status) => status.id === "automation-policy",
    );
    expect(automation?.severity).toBe("notice");
    expect(view.globalSeverity).toBe("notice");
    expect(view.headline).toContain("worth reviewing");
  });

  it("distinguishes no work from unavailable evidence", () => {
    const idle = deriveCockpitView(input({ work: "idle" }));
    const unknown = deriveCockpitView(input({ work: "unknown" }));
    const idleStatus = idle.services.find(
      (status) => status.id === "work-eligibility",
    );
    const unknownStatus = unknown.services.find(
      (status) => status.id === "work-eligibility",
    );
    expect(idleStatus?.severity).toBe("ok");
    expect(idleStatus?.impact).toContain("no protocol work");
    expect(unknownStatus?.severity).toBe("notice");
    expect(unknownStatus?.impact).toContain("could not be determined");
    expect(unknownStatus?.freshness).toBe("unknown");
  });

  it("gives every status a source, owner, impact, and next step", () => {
    for (const status of deriveCockpitView(
      input({ automation: "stopped", pauses: "paused", work: "blocked" }),
    ).services) {
      expect(status.source.length).toBeGreaterThan(3);
      expect(status.owner.length).toBeGreaterThan(2);
      expect(status.impact.length).toBeGreaterThan(10);
      expect(status.nextStep.length).toBeGreaterThan(10);
      expect(status.observedAt.length).toBeGreaterThan(0);
      expect(["fresh", "stale", "unknown"]).toContain(status.freshness);
    }
  });

  it("orders attention by severity, most severe first", () => {
    const view = deriveCockpitView(
      input({
        automation: "stopped",
        checks: [
          {
            explanation: "A queue could not be read",
            freshness: "stale",
            id: "queue1",
            observedBlock: "46176500",
            severity: "critical",
            status: "fail",
          },
        ],
        pauses: "paused",
      }),
    );
    const ranks = view.attention.map((status) => severityRank[status.severity]);
    expect([...ranks].sort((left, right) => right - left)).toEqual(ranks);
    expect(view.attention[0]?.severity).toBe("critical");
  });

  it("carries a failing check's own evidence into attention", () => {
    const view = deriveCockpitView(
      input({
        checks: [
          {
            explanation: "The reward pot could not be read",
            freshness: "stale",
            id: "rewardPot",
            observedBlock: "46176400",
            severity: "warning",
            status: "fail",
          },
        ],
      }),
    );
    const row = view.attention.find(
      (status) => status.id === "check:rewardPot",
    );
    expect(row).toMatchObject({
      freshness: "stale",
      observedAt: "46176400",
      severity: "warning",
    });
    expect(row?.nextStep).toContain("Diagnostics");
  });

  it("keeps a passing check out of attention", () => {
    const view = deriveCockpitView(
      input({
        checks: [
          {
            explanation: "ok",
            freshness: "fresh",
            id: "launched",
            observedBlock: "46176595",
            severity: "info",
            status: "pass",
          },
        ],
      }),
    );
    expect(view.attention).toEqual([]);
  });

  it("reports a failed run as attention-worthy without leaking transport detail", () => {
    const view = deriveCockpitView(
      input({
        lastOutcome: {
          at: "2026-08-31 19:00:00",
          outcome: "failed",
          sanitizedFailure: "RPC unavailable",
        },
      }),
    );
    expect(view.lastOutcome).toMatchObject({
      detail: "RPC unavailable",
      severity: "warning",
    });
    expect(view.lastOutcome?.title).toContain("failed");
  });

  it("says there is no scheduled run rather than showing an empty value", () => {
    expect(deriveCockpitView(input({ nextRunAt: undefined })).nextRun).toBe(
      "No run scheduled",
    );
  });
});

describe("role capabilities", () => {
  it("states what a keeper can and cannot do", () => {
    const summary = roleCapabilities(["keeper"]);
    expect(summary.can).toEqual([
      "Open reward epochs, run reward tracks, and control automation",
    ]);
    expect(summary.cannot).toContain(
      "Withdraw accrued creator fees to the configured destination",
    );
    expect(summary.cannot).toContain("Pause and resume the liquid token");
  });

  it("does not let a creator inherit unrelated controls", () => {
    const summary = roleCapabilities(["creator"]);
    expect(summary.can).toEqual([
      "Withdraw accrued creator fees to the configured destination",
    ]);
    expect(summary.cannot).toContain(
      "Open reward epochs, run reward tracks, and control automation",
    );
    expect(summary.cannot).toContain("Execute protocol-owned liquidity cycles");
  });

  it("reports every capability as absent for a wallet with no role", () => {
    const summary = roleCapabilities([]);
    expect(summary.can).toEqual([]);
    expect(summary.cannot.length).toBeGreaterThan(5);
  });

  it("combines several held roles", () => {
    const summary = roleCapabilities(["keeper", "creator"]);
    expect(summary.can).toHaveLength(2);
  });
});

const controlState = (
  overrides: Partial<OperatorControlState> = {},
): OperatorControlState => ({
  audit: [],
  desired: { mode: "live", oneShot: "none" },
  heartbeat: {
    at: Date.UTC(2026, 8, 5, 8, 4, 0),
    observedMode: "live",
    supervisor: "launchd",
  },
  nextRunAt: Date.UTC(2026, 8, 5, 8, 9, 0),
  service: "online",
  ...overrides,
});

describe("operator control facts", () => {
  it("takes liveness, policy, and the next run from the control plane", () => {
    const facts = operatorControlFacts({
      state: controlState(),
      unreachable: false,
    });
    expect(facts).toMatchObject({
      automation: "live",
      nextRunAt: "2026-09-05 08:09:00",
      service: "online",
      serviceObservedAt: "2026-09-05 08:04:00",
    });
  });

  it("gives the cockpit the same liveness the control panel renders", () => {
    for (const service of ["online", "degraded", "offline"] as const) {
      expect(
        operatorControlFacts({
          state: controlState({ service }),
          unreachable: false,
        }).service,
      ).toBe(service);
    }
  });

  it("reports an unread control plane as unknown rather than offline", () => {
    const view = deriveCockpitView({
      ...input(),
      ...operatorControlFacts({ state: undefined, unreachable: false }),
    });
    expect(view.globalSeverity).toBe("notice");
    expect(
      view.services.find((status) => status.id === "operator-service")
        ?.severity,
    ).toBe("notice");
  });

  it("reports an unreachable control plane as offline and critical", () => {
    const view = deriveCockpitView({
      ...input(),
      ...operatorControlFacts({ state: undefined, unreachable: true }),
    });
    expect(view.globalSeverity).toBe("critical");
    expect(
      view.services.find((status) => status.id === "operator-service")
        ?.observed,
    ).toBe("Offline");
  });

  it("carries the latest run outcome and its sanitized failure", () => {
    const facts = operatorControlFacts({
      state: controlState({
        latestRun: {
          authority: "keeper",
          finishedAt: Date.UTC(2026, 8, 5, 8, 0, 0),
          outcome: "failed",
          sanitizedFailure: "RPC unavailable",
          startedAt: Date.UTC(2026, 8, 5, 7, 59, 0),
        },
      }),
      unreachable: false,
    });
    expect(facts.lastOutcome).toEqual({
      at: "2026-09-05 08:00:00",
      outcome: "failed",
      sanitizedFailure: "RPC unavailable",
    });
  });

  it("says no run is scheduled when the control plane schedules none", () => {
    const facts = operatorControlFacts({
      state: controlState({ nextRunAt: undefined }),
      unreachable: false,
    });
    expect(facts.nextRunAt).toBeUndefined();
    expect(deriveCockpitView({ ...input(), ...facts }).nextRun).toBe(
      "No run scheduled",
    );
  });

  it("reads control-plane clocks as milliseconds", () => {
    expect(controlTimestamp(Date.UTC(2026, 8, 5, 8, 4, 5))).toBe(
      "2026-09-05 08:04:05",
    );
    expect(controlTimestamp(undefined)).toBeUndefined();
  });
});
