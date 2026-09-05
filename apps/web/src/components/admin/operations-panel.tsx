"use client";

import { useCallback, useState } from "react";
import type { ProtocolAction } from "@orbit/protocol/transactions";

import { AdminAccessGate } from "@/components/admin/admin-access-gate";
import { AdminActionDeck } from "@/components/admin/admin-action-deck";
import { AdminCapabilityConsole } from "@/components/admin/admin-capability-console";
import { AdminCockpit } from "@/components/admin/admin-cockpit";
import {
  formatObservedWeth,
  type HealthSnapshot,
  type ProtocolClient,
  type ReviewContext,
} from "@/components/admin/admin-console-context";
import { AdminEpochBoard } from "@/components/admin/admin-epoch-board";
import { AdminPauseBoard } from "@/components/admin/admin-pause-board";
import { useOptionalAdminSession } from "@/components/admin/admin-session-boundary";
import { OperatorControlPanel } from "@/components/admin/operator-control-panel";
import { useOperatorControlState } from "@/components/admin/operator-control-state";
import { TrackQueueLedger } from "@/components/status/track-queue-ledger";
import { TransactionStatus } from "@/components/transaction-status";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import {
  deriveCockpitView,
  operatorControlFacts,
  type CockpitInput,
  type ControlPlaneFacts,
  type OperatorControlReading,
} from "@/lib/admin-cockpit";
import { adminAuthorizationAction } from "@/lib/admin-action-authorization";
import {
  adminConsoleCapabilityRoles,
  getAdminAccessState,
} from "@/lib/admin-access";
import { deploymentEnvironment } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { isTransactionInFlight } from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type MinimumOutputs = Partial<Record<1 | 2 | 3 | 4, string>>;

const pauseState = (health: HealthSnapshot): CockpitInput["pauses"] => {
  const flags = [
    health?.pauses.liquidToken,
    health?.pauses.rewards,
    health?.pauses.converter,
    health?.pauses.liquidity,
  ];
  if (flags.every((paused) => paused === false)) return "active";
  return flags.every((paused) => paused === true)
    ? "paused"
    : "partially-paused";
};

const workEligibility = (health: HealthSnapshot): CockpitInput["work"] => {
  const queues = health?.operations.trackQueues;
  if (queues === undefined) return "unknown";
  if (queues.some((queue) => queue.status === "retryable")) return "blocked";
  return queues.some((queue) => (queue.weth ?? 0n) > 0n) ? "ready" : "idle";
};

/**
 * The cockpit reads protocol facts from the same health snapshot the rest of
 * the console uses, and control-plane facts -- liveness, stored policy, next
 * run, last outcome -- from the one control-plane read the automation panel
 * also renders. It used to assume `automation: "stopped"` and
 * `service: "offline"` because health cannot observe a process, which made the
 * attention board report CRITICAL / Offline beside an automation panel that
 * said Online for the same deployment at the same moment.
 */
const cockpitInput = (
  protocol: ProtocolClient,
  roles: ReviewContext["roles"],
  control: ControlPlaneFacts,
): CockpitInput => {
  const health = protocol.health;
  return {
    automation: control.automation,
    checks: (health?.health.checks ?? []).map((check) => ({
      explanation: check.explanation,
      freshness: check.freshness,
      id: check.id,
      observedBlock: check.observedBlock.toString(),
      severity: check.severity,
      status: check.status,
    })),
    dependenciesReady: health === undefined ? undefined : true,
    lastOutcome: control.lastOutcome,
    nextRunAt: control.nextRunAt,
    observedBlock: health?.health.observedBlock.toString(),
    pauses: pauseState(health),
    roles,
    // Liveness is never inferred from a protocol read; the control plane is
    // the only witness, and it is the same one the control panel renders.
    service: control.service,
    serviceObservedAt: control.serviceObservedAt,
    work: workEligibility(health),
  };
};

const operationsEmptyMessage = (protocol: ProtocolClient): string => {
  if (!protocol.deploymentAvailable) {
    return applicationCopy.access.deploymentPendingBody;
  }
  if (protocol.healthPending) return applicationCopy.common.loading;
  return protocol.healthError
    ? applicationCopy.publicStatus.readUnavailable
    : applicationCopy.operations.noRecentActions;
};

/** The total queued across every track, or nothing when no queue was read. */
const queuedWethTotal = (health: HealthSnapshot): bigint | undefined => {
  const queues = health?.operations.trackQueues;
  if (queues === undefined) return undefined;
  return queues.reduce((total, queue) => total + (queue.weth ?? 0n), 0n);
};

/**
 * The live operator state, before any control: where the console is reading
 * from, how much work is queued, and whether the protocol is running.
 */
function OperatorStateBoard({ health }: { readonly health: HealthSnapshot }) {
  const pauses = pauseState(health);
  const work = workEligibility(health);
  return (
    <MetricGroup columns={4} label={applicationCopy.operations.operatorState}>
      <Metric
        label={applicationCopy.home.observedBlock}
        tone="live"
        value={
          health?.health.observedBlock.toString() ??
          applicationCopy.common.notObserved
        }
      />
      <Metric
        label={applicationCopy.operations.queuedWethTotal}
        value={formatObservedWeth(queuedWethTotal(health))}
        hint={applicationCopy.cockpit.work[work]}
      />
      <Metric
        label={applicationCopy.operations.pauseState}
        value={applicationCopy.cockpit.pauses[pauses]}
      />
      <Metric
        label={applicationCopy.operations.epochCount}
        value={
          health?.operations.rewardEpochCount?.toString() ??
          applicationCopy.common.notObserved
        }
      />
    </MetricGroup>
  );
}

export function OperationsPanel() {
  const protocol = useProtocolClient();
  const adminSession = useOptionalAdminSession();
  const control: OperatorControlReading = useOperatorControlState();
  const [minimumOutputs, setMinimumOutputs] = useState<MinimumOutputs>({});
  const health = protocol.health;
  const authorizeTransaction = useCallback(
    async (action: ProtocolAction): Promise<void> => {
      if (adminSession === undefined) {
        throw new Error("An authenticated admin session is required");
      }
      await adminSession.authorizeAction(adminAuthorizationAction(action));
    },
    [adminSession],
  );
  const authorizedProtocol: ProtocolClient = {
    ...protocol,
    execute: (action, label) =>
      protocol.execute(action, label, authorizeTransaction),
    retry: () => protocol.retry(authorizeTransaction),
  };
  const accessState = getAdminAccessState({
    accessState: protocol.accessState,
    authenticatedRoles: adminSession?.session.roles,
    capabilities: health?.capabilities,
    healthError: protocol.healthError,
    healthPending: protocol.healthPending,
  });
  const updateMinimumOutput = (track: 1 | 2 | 3 | 4, value: string): void => {
    setMinimumOutputs((current) => ({ ...current, [track]: value }));
  };
  const reviewContext: ReviewContext = {
    actor: protocol.address,
    chainLabel: deploymentEnvironment.chainLabel,
    observedBlock: health?.deployment.observedBlock,
    roles: adminConsoleCapabilityRoles({
      authenticatedRoles: adminSession?.session.roles,
      capabilities: health?.capabilities,
    }),
    pending: isTransactionInFlight(protocol.transaction),
  };

  if (accessState !== "authorized") {
    return <AdminAccessGate onRetry={protocol.refresh} state={accessState} />;
  }

  return (
    <div className="grid gap-4">
      {/* The board answers what is true right now before any control is
          offered; the cockpit then says what needs an operator. */}
      <OperatorStateBoard health={health} />
      <div className="grid gap-3 laptop:grid-cols-12">
        <AdminCockpit
          view={deriveCockpitView(
            cockpitInput(
              protocol,
              reviewContext.roles,
              operatorControlFacts(control),
            ),
          )}
        />
        <OperatorControlPanel />
        <AdminEpochBoard health={health} protocol={authorizedProtocol} />
        <AdminCapabilityConsole
          health={health}
          protocol={authorizedProtocol}
          roles={reviewContext.roles}
        />
        <AdminActionDeck
          context={reviewContext}
          health={health}
          minimumOutputs={minimumOutputs}
          onMinimumOutput={updateMinimumOutput}
          protocol={authorizedProtocol}
        />
        <AdminPauseBoard
          context={reviewContext}
          health={health}
          protocol={authorizedProtocol}
        />
      </div>
      <TrackQueueLedger
        ariaLabel={applicationCopy.operations.trackQueueBoard}
        emptyMessage={operationsEmptyMessage(protocol)}
        trackOutcomes={health?.operations.trackOutcomes}
        trackQueues={health?.operations.trackQueues ?? []}
      />
      <TransactionStatus
        onRetry={() => void authorizedProtocol.retry()}
        state={protocol.transaction}
      />
      <Disclosure searchable title={applicationCopy.operations.evidenceDetail}>
        <p className="text-body-sm text-ink-soft">
          {applicationCopy.operations.disclosure}
        </p>
      </Disclosure>
    </div>
  );
}
