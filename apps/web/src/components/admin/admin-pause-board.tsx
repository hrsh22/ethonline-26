"use client";

import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import {
  holdsAny,
  type HealthSnapshot,
  type ProtocolClient,
  type ReviewContext,
} from "@/components/admin/admin-console-context";
import { DisabledReason } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Well } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";

type PauseModule = "liquidToken" | "rewards" | "converter" | "liquidity";

/** Each module's pause is the exact owner's capability, not a shared one. */
const PAUSE_OWNER_ROLE = {
  liquidToken: "liquid-token-owner",
  rewards: "reward-ledger-owner",
  converter: "converter-owner",
  liquidity: "liquidity-owner",
} as const satisfies Readonly<Record<PauseModule, AdminConsoleRoleId>>;

const pauseModules = (
  health: HealthSnapshot,
): ReadonlyArray<readonly [PauseModule, string, boolean | undefined]> => [
  [
    "liquidToken",
    applicationCopy.operations.liquidTokenModule,
    health?.pauses.liquidToken,
  ],
  ["rewards", applicationCopy.rewards.eyebrow, health?.pauses.rewards],
  ["converter", applicationCopy.operations.epoch, health?.pauses.converter],
  ["liquidity", applicationCopy.operations.polModule, health?.pauses.liquidity],
];

const pauseStatus = (paused: boolean | undefined): string => {
  if (paused === undefined) return applicationCopy.common.notObserved;
  return paused
    ? applicationCopy.status.queue.paused
    : applicationCopy.status.check.healthy;
};

const pauseTone = (paused: boolean | undefined) =>
  paused === undefined ? "neutral" : paused ? "warning" : "success";

function PauseModuleCard({
  context,
  label,
  module,
  paused,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly label: string;
  readonly module: PauseModule;
  readonly paused: boolean | undefined;
  readonly protocol: ProtocolClient;
}) {
  const action =
    paused === undefined
      ? undefined
      : ({ type: "set-pause", module, paused: !paused } as const);
  const state = action
    ? protocol.getActionState(action)
    : { enabled: false, reason: applicationCopy.common.notObserved };
  const actionLabel = paused
    ? applicationCopy.operations.resume(label)
    : applicationCopy.operations.pause(label);
  return (
    <Well className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase">
          {label}
        </h3>
        <span data-pause-state={paused === undefined ? "unknown" : paused}>
          <Badge dot tone={pauseTone(paused)}>
            {pauseStatus(paused)}
          </Badge>
        </span>
      </div>
      {action ? (
        <AdminActionControl
          action={action}
          enabled={state.enabled}
          label={actionLabel}
          onExecute={protocol.execute}
          pending={context.pending}
          reason={state.reason}
          review={{
            ...context,
            currentState: pauseStatus(paused),
            intendedState: pauseStatus(!paused),
            subject: label,
          }}
          variant={paused ? "outline" : "destructive"}
        />
      ) : (
        <div>
          <Button
            aria-describedby={`reason-set-pause-${module}-unavailable`}
            className="h-auto min-h-11 w-full py-2 text-center whitespace-normal"
            disabled
            type="button"
            variant="outline"
          >
            {actionLabel}
          </Button>
          <DisabledReason id={`reason-set-pause-${module}-unavailable`}>
            Refresh the current pause snapshot before changing {label}.
          </DisabledReason>
        </div>
      )}
    </Well>
  );
}

/** An operator who owns no module has no pause board at all. */
export function AdminPauseBoard({
  context,
  health,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
}) {
  const owned = pauseModules(health).filter(([module]) =>
    holdsAny(context.roles, [PAUSE_OWNER_ROLE[module]]),
  );
  if (owned.length === 0) return null;
  return (
    <Panel
      className="laptop:col-span-12"
      meta={applicationCopy.operations.owner}
      title={applicationCopy.operations.pauseControls}
    >
      <div className="grid gap-2 tablet:grid-cols-2 laptop:grid-cols-4">
        {owned.map(([module, label, paused]) => (
          <PauseModuleCard
            context={context}
            key={module}
            label={label}
            module={module}
            paused={paused}
            protocol={protocol}
          />
        ))}
      </div>
    </Panel>
  );
}
