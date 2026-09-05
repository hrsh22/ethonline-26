"use client";

import { planWethOnlyPolCycle } from "@orbit/protocol/pol-planner";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import {
  formatObserved,
  formatObservedWeth,
  type HealthSnapshot,
  type ProtocolClient,
  type ReviewContext,
} from "@/components/admin/admin-console-context";
import { DisabledReason } from "@/components/state-feedback";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";

const polFundingLabel = (health: HealthSnapshot): string => {
  const queued = health?.operations.protocolOwnedLiquidity.queuedWeth;
  const pot = health?.market.liquidityPotWeth;
  return queued === undefined || pot === undefined
    ? applicationCopy.common.notObserved
    : `${formatObservedWeth(queued)} + ${formatObservedWeth(pot)} WETH`;
};

const createPolAction = (health: HealthSnapshot) => {
  if (health?.market.currentTick === undefined) return undefined;
  const plan = planWethOnlyPolCycle({
    currentTick: health.market.currentTick,
    tickSpacing: health.market.tickSpacing,
    wethIsCurrency0: health.market.wethIsCurrency0,
    availableWeth:
      (health.operations.protocolOwnedLiquidity.queuedWeth ?? 0n) +
      (health.market.liquidityPotWeth ?? 0n),
    currentTimestamp: BigInt(health.deployment.observedAt),
  });
  return plan.status === "ready" ? plan : undefined;
};

export function AdminPolActionCard({
  context,
  health,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
}) {
  const action = createPolAction(health);
  const state = action
    ? protocol.getActionState(action)
    : { enabled: false, reason: applicationCopy.common.notObserved };
  return (
    <Panel
      className="laptop:col-span-6"
      title={applicationCopy.operations.polModule}
    >
      <DataList className="mb-3">
        <DataRow
          label={applicationCopy.operations.polQueue}
          tone="live"
          value={polFundingLabel(health)}
        />
        {action ? (
          <DataRow
            label={applicationCopy.operations.reviewRange}
            value={`${action.tickLower} → ${action.tickUpper}`}
          />
        ) : null}
        <DataRow
          label={applicationCopy.publicStatus.permanentlyLockedWeth}
          value={formatObservedWeth(
            health?.operations.protocolOwnedLiquidity.permanentlyLockedWeth,
          )}
        />
        <DataRow
          label={applicationCopy.publicStatus.liquidityCycles}
          value={formatObserved(
            health?.operations.protocolOwnedLiquidity.cycleCount,
          )}
        />
      </DataList>
      {action ? (
        <AdminActionControl
          action={action}
          enabled={state.enabled}
          label={applicationCopy.operations.executePol}
          onExecute={protocol.execute}
          pending={context.pending}
          reason={state.reason}
          review={{
            ...context,
            currentState: polFundingLabel(health),
            intendedState: applicationCopy.operations.reviewPolAdded,
            subject: applicationCopy.operations.polModule,
          }}
        />
      ) : (
        <div>
          <Button
            aria-describedby="reason-execute-pol-unavailable"
            className="h-auto min-h-11 w-full py-2 text-center whitespace-normal"
            disabled
            type="button"
          >
            {applicationCopy.operations.executePol}
          </Button>
          <DisabledReason id="reason-execute-pol-unavailable">
            Refresh the current market snapshot before executing protocol-owned
            liquidity.
          </DisabledReason>
        </div>
      )}
    </Panel>
  );
}
