import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";
import type { OperatorControlState } from "@orbit/config/operator-control";

import { applicationCopy } from "@/lib/identity";

/**
 * The cockpit answers the questions an operator actually arrives with: who am I
 * signed in as, is anything broken, may anything run, what happened last, and
 * what needs me now. Protocol structures and raw evidence stay behind
 * diagnostics rather than leading the page.
 */
export type CockpitSeverity = "critical" | "warning" | "notice" | "ok";

/**
 * Severity is carried by an explicit rank as well as a colour, so it survives
 * a monochrome screen, a screen reader, and a printout.
 */
export const severityRank: Readonly<Record<CockpitSeverity, number>> = {
  critical: 3,
  warning: 2,
  notice: 1,
  ok: 0,
};

export const severityLabel: Readonly<Record<CockpitSeverity, string>> = {
  critical: "Critical",
  warning: "Needs attention",
  notice: "For information",
  ok: "Healthy",
};

/**
 * Every status the cockpit shows must be able to answer where it came from,
 * when it was observed, whether that is still current, who owns it, what it
 * affects, and what to do next. A status that cannot is not worth rendering.
 */
export interface CockpitStatus {
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly id: string;
  readonly impact: string;
  readonly nextStep: string;
  readonly observed: string;
  readonly observedAt: string;
  readonly owner: string;
  readonly severity: CockpitSeverity;
  readonly source: string;
  readonly title: string;
}

/**
 * Liveness and policy are the control plane's answers, and "not read yet" is a
 * third answer that is neither. Before this existed the console had two
 * definitions of operator-service liveness: the cockpit hardcoded `offline`
 * because a protocol read cannot observe a process, while the automation panel
 * read the control plane -- so the same page said CRITICAL / Offline and
 * Online at the same moment.
 */
export type OperatorServiceState =
  "online" | "degraded" | "offline" | "unknown";
export type AutomationMode = "stopped" | "dry-run" | "live" | "unknown";
export type ProtocolPauseState = "active" | "partially-paused" | "paused";
export type WorkEligibility = "ready" | "blocked" | "idle" | "unknown";

export interface CockpitInput {
  readonly automation: AutomationMode;
  readonly checks: readonly {
    readonly explanation: string;
    readonly freshness: "fresh" | "stale";
    readonly id: string;
    readonly observedBlock: string;
    readonly severity: "critical" | "warning" | "info";
    readonly status: "pass" | "warn" | "fail" | "unknown";
  }[];
  readonly dependenciesReady: boolean | undefined;
  readonly lastOutcome:
    | {
        readonly at: string | undefined;
        readonly outcome: string;
        readonly sanitizedFailure: string | undefined;
      }
    | undefined;
  readonly nextRunAt: string | undefined;
  readonly observedBlock: string | undefined;
  readonly pauses: ProtocolPauseState;
  readonly roles: readonly AdminConsoleRoleId[];
  readonly service: OperatorServiceState;
  /** When the control plane last reported liveness, never a protocol block. */
  readonly serviceObservedAt: string | undefined;
  readonly work: WorkEligibility;
}

/**
 * The control-plane facts the cockpit cannot read for itself: liveness, stored
 * policy, the next scheduled run, and the last run's outcome. They arrive from
 * one place -- `GET /v1/admin/operator/state` through the admin relay -- so the
 * attention board and the automation panel can no longer disagree about
 * whether the operator service is running.
 */
export type ControlPlaneFacts = Pick<
  CockpitInput,
  "automation" | "lastOutcome" | "nextRunAt" | "service" | "serviceObservedAt"
>;

export interface OperatorControlReading {
  /** The decoded control-plane state, or nothing when it has not been read. */
  readonly state: OperatorControlState | undefined;
  /** True only when the control-plane read actually failed. */
  readonly unreachable: boolean;
}

/** Control-plane clocks are epoch milliseconds; protocol reads are blocks. */
export const controlTimestamp = (
  milliseconds: number | undefined,
): string | undefined =>
  milliseconds === undefined
    ? undefined
    : new Date(milliseconds).toISOString().replace("T", " ").slice(0, 19);

/**
 * One definition of operator-service liveness for the whole console.
 *
 * An unread control plane is `unknown`, not `offline`: the cockpit used to
 * assume `offline` because a protocol read cannot observe a process, which
 * escalated a healthy deployment to CRITICAL beside an automation panel that
 * said Online. Only a failed read is evidence of an unreachable control plane.
 */
export const operatorControlFacts = (
  reading: OperatorControlReading,
): ControlPlaneFacts => {
  const state = reading.state;
  if (state === undefined) {
    return {
      automation: "unknown",
      lastOutcome: undefined,
      nextRunAt: undefined,
      service: reading.unreachable ? "offline" : "unknown",
      serviceObservedAt: undefined,
    };
  }
  const run = state.latestRun;
  return {
    automation: state.desired.mode,
    lastOutcome:
      run === undefined
        ? undefined
        : {
            at: controlTimestamp(run.finishedAt ?? run.startedAt),
            outcome: run.outcome,
            sanitizedFailure: run.sanitizedFailure,
          },
    nextRunAt: controlTimestamp(state.nextRunAt),
    service: state.service,
    serviceObservedAt: controlTimestamp(state.heartbeat?.at),
  };
};

/**
 * Only an unreachable control plane is critical. A late heartbeat is a warning
 * and an unread control plane is a notice: neither is evidence that the
 * operator process is down, and reporting either as CRITICAL / Offline told
 * operators the service was dead while it was serving state.
 */
const SERVICE_SEVERITY: Readonly<
  Record<OperatorServiceState, CockpitSeverity>
> = {
  online: "ok",
  degraded: "warning",
  offline: "critical",
  unknown: "notice",
};

const SERVICE_FRESHNESS: Readonly<
  Record<OperatorServiceState, CockpitStatus["freshness"]>
> = {
  online: "fresh",
  degraded: "stale",
  offline: "stale",
  unknown: "unknown",
};

const SERVICE_IMPACT: Readonly<Record<OperatorServiceState, string>> = {
  online: "Recurring operator work can run.",
  degraded:
    "The operator process has not reported in; work may already have stopped.",
  offline:
    "No recurring operator work is running, whatever the automation policy says.",
  unknown:
    "Whether recurring operator work is running could not be determined.",
};

const SERVICE_NEXT_STEP: Readonly<Record<OperatorServiceState, string>> = {
  online: "No action needed.",
  degraded:
    "Check the supervisor process if the heartbeat does not return shortly.",
  offline: "Check the supervisor process before changing automation policy.",
  unknown: "Retry the control-plane read before changing automation policy.",
};

const serviceStatus = (input: CockpitInput): CockpitStatus => {
  const severity = SERVICE_SEVERITY[input.service];
  return {
    freshness: SERVICE_FRESHNESS[input.service],
    id: "operator-service",
    impact: SERVICE_IMPACT[input.service],
    nextStep: SERVICE_NEXT_STEP[input.service],
    observed: applicationCopy.cockpit.service[input.service],
    // The heartbeat is a control-plane clock reading, never a protocol block.
    observedAt: input.serviceObservedAt ?? applicationCopy.common.notObserved,
    owner: applicationCopy.cockpit.owners.operator,
    severity,
    source: applicationCopy.cockpit.sources.heartbeat,
    title: applicationCopy.cockpit.titles.service,
  };
};

const automationStatus = (input: CockpitInput): CockpitStatus => ({
  // Policy is a setting, not a fault. A stopped operator is a notice, because
  // an operator may have stopped it deliberately.
  freshness: input.automation === "unknown" ? "unknown" : "fresh",
  id: "automation-policy",
  impact:
    input.automation === "live"
      ? "Eligible transactions may be signed."
      : input.automation === "dry-run"
        ? "Work is planned and simulated but never signed."
        : input.automation === "stopped"
          ? "No new runs will start."
          : "The stored policy has not been read from the control plane.",
  nextStep:
    input.automation === "stopped"
      ? "Enable dry-run or live execution when the service is healthy."
      : input.automation === "unknown"
        ? "Retry the control-plane read before changing automation policy."
        : "No action needed.",
  observed: applicationCopy.cockpit.automation[input.automation],
  observedAt: applicationCopy.cockpit.storedPolicy,
  owner: applicationCopy.cockpit.owners.keeper,
  severity:
    input.automation === "stopped" || input.automation === "unknown"
      ? "notice"
      : "ok",
  source: applicationCopy.cockpit.sources.controlPlane,
  title: applicationCopy.cockpit.titles.automation,
});

const pauseStatus = (input: CockpitInput): CockpitStatus => ({
  freshness: input.observedBlock === undefined ? "unknown" : "fresh",
  id: "protocol-pause",
  impact:
    input.pauses === "active"
      ? "Collector and operator actions are available."
      : "Some collector or operator actions are unavailable while paused.",
  nextStep:
    input.pauses === "active"
      ? "No action needed."
      : "Resume the paused modules when the reason for the pause is resolved.",
  observed: applicationCopy.cockpit.pauses[input.pauses],
  observedAt: input.observedBlock ?? applicationCopy.common.notObserved,
  owner: applicationCopy.cockpit.owners.owner,
  severity: input.pauses === "active" ? "ok" : "warning",
  source: applicationCopy.cockpit.sources.onchain,
  title: applicationCopy.cockpit.titles.pauses,
});

const workStatus = (input: CockpitInput): CockpitStatus => ({
  // "No work" and "cannot tell" are different answers and must not share copy.
  freshness: input.work === "unknown" ? "unknown" : "fresh",
  id: "work-eligibility",
  impact:
    input.work === "ready"
      ? "There is protocol work the operator could perform now."
      : input.work === "blocked"
        ? "Work exists but a precondition prevents it."
        : input.work === "idle"
          ? "There is no protocol work to perform."
          : "Whether work exists could not be determined.",
  nextStep:
    input.work === "blocked"
      ? "Resolve the blocking precondition shown in the queue."
      : input.work === "unknown"
        ? "Retry the protocol read before acting."
        : "No action needed.",
  observed: applicationCopy.cockpit.work[input.work],
  observedAt: input.observedBlock ?? applicationCopy.common.notObserved,
  owner: applicationCopy.cockpit.owners.protocol,
  severity:
    input.work === "blocked"
      ? "warning"
      : input.work === "unknown"
        ? "notice"
        : "ok",
  source: applicationCopy.cockpit.sources.onchain,
  title: applicationCopy.cockpit.titles.work,
});

const dependencyStatus = (input: CockpitInput): CockpitStatus => ({
  freshness: input.dependenciesReady === undefined ? "unknown" : "fresh",
  id: "dependency-readiness",
  impact:
    input.dependenciesReady === true
      ? "Operator inputs can be read."
      : "Operator inputs cannot be read, so planning may fail.",
  nextStep:
    input.dependenciesReady === true
      ? "No action needed."
      : "Check the history and funding services before enabling execution.",
  observed:
    input.dependenciesReady === undefined
      ? applicationCopy.cockpit.dependencies.unknown
      : applicationCopy.cockpit.dependencies[
          input.dependenciesReady ? "ready" : "unavailable"
        ],
  observedAt: applicationCopy.cockpit.sources.readiness,
  owner: applicationCopy.cockpit.owners.operator,
  severity:
    input.dependenciesReady === true
      ? "ok"
      : input.dependenciesReady === undefined
        ? "notice"
        : "warning",
  source: applicationCopy.cockpit.sources.readiness,
  title: applicationCopy.cockpit.titles.dependencies,
});

const CHECK_LABEL: Readonly<
  Record<CockpitInput["checks"][number]["status"], string>
> = {
  fail: applicationCopy.status.check.failing,
  pass: applicationCopy.status.check.healthy,
  unknown: applicationCopy.common.notObserved,
  warn: applicationCopy.status.check.warning,
};

/**
 * An unknown check is missing evidence, not a failure. Reporting it as a
 * failure would tell an operator something is broken when the truth is that
 * nothing could be read.
 */
const checkSeverity = (
  check: CockpitInput["checks"][number],
): CockpitSeverity => {
  if (check.status === "unknown") return "notice";
  if (check.status !== "fail") return "notice";
  return check.severity === "critical" ? "critical" : "warning";
};

/** A failing protocol check becomes an attention row with its own evidence. */
const checkStatus = (check: CockpitInput["checks"][number]): CockpitStatus => ({
  freshness: check.freshness,
  id: `check:${check.id}`,
  impact: check.explanation,
  nextStep:
    check.status === "fail"
      ? "Investigate this check in Diagnostics before running work."
      : check.status === "unknown"
        ? "Retry the protocol read; this check has no observation yet."
        : "Review this check when convenient.",
  observed: CHECK_LABEL[check.status],
  observedAt: check.observedBlock,
  owner: applicationCopy.cockpit.owners.protocol,
  severity: checkSeverity(check),
  source: applicationCopy.cockpit.sources.onchain,
  title: check.id,
});

export interface CockpitView {
  /** Rows the operator must look at, most severe first. */
  readonly attention: readonly CockpitStatus[];
  readonly globalSeverity: CockpitSeverity;
  readonly headline: string;
  readonly lastOutcome:
    | {
        readonly detail: string;
        readonly severity: CockpitSeverity;
        readonly title: string;
      }
    | undefined;
  readonly nextRun: string;
  readonly roles: readonly AdminConsoleRoleId[];
  /** The standing facts, always shown, in a fixed order. */
  readonly services: readonly CockpitStatus[];
}

const lastOutcomeView = (input: CockpitInput) => {
  const outcome = input.lastOutcome;
  if (outcome === undefined) return undefined;
  const failed = outcome.outcome === "failed";
  return {
    detail:
      outcome.sanitizedFailure ??
      `${outcome.outcome}${outcome.at === undefined ? "" : ` at ${outcome.at}`}`,
    severity: failed ? ("warning" as const) : ("ok" as const),
    title: applicationCopy.cockpit.lastOutcome(outcome.outcome),
  };
};

export const deriveCockpitView = (input: CockpitInput): CockpitView => {
  const services = [
    serviceStatus(input),
    dependencyStatus(input),
    automationStatus(input),
    pauseStatus(input),
    workStatus(input),
  ];
  const attention = [
    ...services.filter((status) => status.severity !== "ok"),
    ...input.checks
      .filter((check) => check.status !== "pass")
      .map((check) => checkStatus(check)),
  ].sort(
    (left, right) => severityRank[right.severity] - severityRank[left.severity],
  );
  const globalSeverity = attention[0]?.severity ?? ("ok" as CockpitSeverity);
  return {
    attention,
    globalSeverity,
    headline: applicationCopy.cockpit.headline[globalSeverity],
    lastOutcome: lastOutcomeView(input),
    nextRun: input.nextRunAt ?? applicationCopy.cockpit.noScheduledRun,
    roles: input.roles,
    services,
  };
};

/** What this actor can and cannot do, stated explicitly. */
export interface RoleCapabilitySummary {
  readonly can: readonly string[];
  readonly cannot: readonly string[];
}

const CAPABILITY_BY_ROLE: Readonly<Record<AdminConsoleRoleId, string>> = {
  "liquid-token-owner": "Pause and resume the liquid token",
  "reward-ledger-owner": "Pause and resume reward accounting",
  "converter-owner": "Pause and resume reward conversion",
  "liquidity-owner": "Pause and resume protocol-owned liquidity",
  guardian: "Act as guardian for recovery procedures",
  recovery: "Act as the recovery signer",
  keeper: "Open reward epochs, run reward tracks, and control automation",
  "liquidity-executor": "Execute protocol-owned liquidity cycles",
  creator: "Withdraw accrued creator fees to the configured destination",
};

export const roleCapabilities = (
  roles: readonly AdminConsoleRoleId[],
): RoleCapabilitySummary => {
  const held = new Set(roles);
  const entries = Object.entries(CAPABILITY_BY_ROLE) as readonly [
    AdminConsoleRoleId,
    string,
  ][];
  return {
    can: entries
      .filter(([role]) => held.has(role))
      .map(([, capability]) => capability),
    cannot: entries
      .filter(([role]) => !held.has(role))
      .map(([, capability]) => capability),
  };
};
