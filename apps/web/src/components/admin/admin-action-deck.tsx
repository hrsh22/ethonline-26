"use client";

import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import { AdminClaimPolicyCard } from "@/components/admin/admin-claim-policy-card";
import {
  formatObserved,
  formatObservedWeth,
  holdsAny,
  type HealthSnapshot,
  type ProtocolClient,
  type ReviewContext,
} from "@/components/admin/admin-console-context";
import { AdminCreatorFeeCard } from "@/components/admin/admin-creator-fee-card";
import { AdminPolActionCard } from "@/components/admin/admin-pol-action-card";
import { AdminTrackActionCard } from "@/components/admin/admin-track-action-card";
import { StateFeedback } from "@/components/state-feedback";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";

type MinimumOutputs = Partial<Record<1 | 2 | 3 | 4, string>>;

/** Which action cards this actor's capabilities entitle it to see. */
const deckCapabilities = (roles: readonly AdminConsoleRoleId[]) => {
  const keeper = holdsAny(roles, ["keeper"]);
  const liquidityExecutor = holdsAny(roles, ["liquidity-executor"]);
  const creator = holdsAny(roles, ["creator"]);
  const claimPolicy = holdsAny(roles, ["liquid-token-owner"]);
  return {
    claimPolicy,
    count: [keeper, liquidityExecutor, creator, claimPolicy].filter(Boolean)
      .length,
    creator,
    keeper,
    liquidityExecutor,
  };
};

/**
 * The keeper's board: opening the next reward epoch, and converting each
 * track's queued WETH. Both live in one panel because an operator runs them in
 * that order within a single cycle.
 */
function KeeperActionPanel({
  context,
  deadline,
  health,
  minimumOutputs,
  onMinimumOutput,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly deadline: bigint;
  readonly health: HealthSnapshot;
  readonly minimumOutputs: MinimumOutputs;
  readonly onMinimumOutput: (track: 1 | 2 | 3 | 4, value: string) => void;
  readonly protocol: ProtocolClient;
}) {
  const action = { type: "open-reward-epoch" } as const;
  const state = protocol.getActionState(action);
  const queues = health?.operations.trackQueues ?? [];
  return (
    <Panel
      className="laptop:col-span-12"
      meta={applicationCopy.operations.keeper}
      title={applicationCopy.operations.actionDeck}
    >
      <DataList className="mb-3">
        <DataRow
          label={applicationCopy.operations.epochCount}
          tone="live"
          value={formatObserved(health?.operations.rewardEpochCount)}
        />
        <DataRow
          label={applicationCopy.operations.queue}
          note="WETH"
          value={formatObservedWeth(
            health === undefined
              ? undefined
              : queues.reduce((total, queue) => total + (queue.weth ?? 0n), 0n),
          )}
        />
      </DataList>
      <AdminActionControl
        action={action}
        enabled={state.enabled}
        label={applicationCopy.operations.openEpoch}
        onExecute={protocol.execute}
        pending={context.pending}
        reason={state.reason}
        review={{
          ...context,
          currentState: `${formatObserved(
            health?.operations.rewardEpochCount,
          )} ${applicationCopy.publicStatus.epochCountLabel}`,
          intendedState: applicationCopy.operations.reviewEpochOpened,
          subject: applicationCopy.operations.epoch,
        }}
      />
      <div className="mt-3 grid gap-2 tablet:grid-cols-2 laptop:grid-cols-4">
        {queues.map((track) => (
          <AdminTrackActionCard
            context={context}
            deadline={deadline}
            key={track.trackId}
            minimumOutputText={minimumOutputs[track.trackId] ?? ""}
            onMinimumOutput={onMinimumOutput}
            protocol={protocol}
            track={track}
          />
        ))}
      </div>
    </Panel>
  );
}

/**
 * The board of privileged actions: one panel per action family, rendered only
 * for the capabilities the authenticated session actually holds. Every control
 * submits from a review, never a single click.
 */
export function AdminActionDeck({
  context,
  health,
  minimumOutputs,
  onMinimumOutput,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly health: HealthSnapshot;
  readonly minimumOutputs: MinimumOutputs;
  readonly onMinimumOutput: (track: 1 | 2 | 3 | 4, value: string) => void;
  readonly protocol: ProtocolClient;
}) {
  const deadline = BigInt((health?.deployment.observedAt ?? 0) + 300);
  const deck = deckCapabilities(context.roles);
  return (
    <>
      {deck.keeper ? (
        <KeeperActionPanel
          context={context}
          deadline={deadline}
          health={health}
          minimumOutputs={minimumOutputs}
          onMinimumOutput={onMinimumOutput}
          protocol={protocol}
        />
      ) : null}
      {deck.liquidityExecutor ? (
        <AdminPolActionCard
          context={context}
          health={health}
          protocol={protocol}
        />
      ) : null}
      {deck.claimPolicy ? (
        <AdminClaimPolicyCard
          context={context}
          health={health}
          protocol={protocol}
        />
      ) : null}
      {deck.creator ? (
        <AdminCreatorFeeCard
          context={context}
          health={health}
          protocol={protocol}
        />
      ) : null}
      {deck.count === 0 ? (
        <StateFeedback
          className="laptop:col-span-12"
          description={applicationCopy.operations.noActionableCapability}
          title={applicationCopy.operations.noActionableCapabilityTitle}
          tone="empty"
        />
      ) : null}
    </>
  );
}
