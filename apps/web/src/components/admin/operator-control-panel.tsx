"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useSignMessage } from "wagmi";

import {
  createOperatorCommandMessage,
  OPERATOR_COMMANDS,
  operatorCommandRequiresSignature,
  type OperatorCommandName,
} from "@orbit/config/operator-control";

import { useOptionalAdminSession } from "@/components/admin/admin-session-boundary";
import { useOperatorControlState } from "@/components/admin/operator-control-state";
import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Panel } from "@/components/ui/panel";
import { Address } from "@/components/ui/value";
import { controlTimestamp } from "@/lib/admin-cockpit";
import {
  newOperatorCommandId,
  sendOperatorCommand,
  type OperatorControlStateDTO,
} from "@/lib/operator-control-client";
import { applicationUrl, deploymentEnvironment } from "@/lib/deployment";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

/** The console formats every control-plane clock the same way, in one place. */
const displayTime = (value: number | undefined): string =>
  controlTimestamp(value) ?? applicationCopy.common.notObserved;

/**
 * The append-only audit trail. It is the durable evidence of who changed what,
 * so it stays on the control panel rather than in a diagnostics drilldown.
 */
function ControlAudit({
  audit,
}: {
  readonly audit: OperatorControlStateDTO["audit"];
}) {
  return (
    <Disclosure searchable title={applicationCopy.cockpit.auditHeading}>
      {audit.length === 0 ? (
        <p className="text-body-sm text-ink-soft">
          {applicationCopy.cockpit.auditEmpty}
        </p>
      ) : (
        <ol className="grid gap-2">
          {audit.map((entry) => (
            <li
              className="grid gap-1 border-b border-line pb-2 last:border-b-0"
              data-result={entry.result}
              key={`${entry.appliedAt}-${entry.command}-${entry.actor}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-body-sm font-semibold text-ink">
                  {entry.command}
                </code>
                <Badge tone={entry.result === "ok" ? "success" : "warning"}>
                  {entry.result}
                </Badge>
                <time
                  className="ml-auto font-mono text-label tracking-[0.08em] text-ink-faint tabular-nums"
                  dateTime={new Date(entry.appliedAt).toISOString()}
                >
                  {displayTime(entry.appliedAt)}
                </time>
              </div>
              <p className="font-mono text-body-sm text-ink-soft">
                {entry.previous} → {entry.next}
              </p>
              <p className="flex flex-wrap items-baseline gap-2 font-mono text-caption text-ink-faint">
                {entry.role}
                <Address value={entry.actor} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </Disclosure>
  );
}

type AdminSessionValue = NonNullable<
  ReturnType<typeof useOptionalAdminSession>
>["session"];

/**
 * The origin whose host the operator's wallet signature is bound to, and the
 * deployment binding inside the message. Both fail closed: a deploy that
 * omits NEXT_PUBLIC_APP_URL previously fell back to `localhost:3000`, so the
 * wallet showed the operator a privileged control-plane signature request for
 * a domain indistinguishable from phishing -- and an absent deployment
 * fingerprint was signed as the empty string, a binding to nothing.
 */
const signingContext = ():
  { readonly fingerprint: string; readonly origin: string } | undefined =>
  applicationUrl === undefined || protocolDeploymentFingerprint === undefined
    ? undefined
    : {
        fingerprint: protocolDeploymentFingerprint,
        origin: applicationUrl,
      };

/**
 * A command that can lead to a signature is bound to this deployment and
 * signed by the operator's wallet before it is sent. Other commands need no
 * signature, so none is requested.
 */
const signCommandIfRequired = async (
  name: OperatorCommandName,
  commandId: string,
  session: AdminSessionValue,
  signMessageAsync: (input: {
    readonly message: string;
  }) => Promise<`0x${string}`>,
): Promise<
  { readonly message: string; readonly signature: `0x${string}` } | undefined
> => {
  if (!operatorCommandRequiresSignature(name)) return undefined;
  const context = signingContext();
  if (context === undefined) {
    throw new Error(
      "Signed operator commands need NEXT_PUBLIC_APP_URL and a deployment binding; this deployment configures neither, so the command was not signed.",
    );
  }
  const message = createOperatorCommandMessage({
    actor: session.address,
    chainId: session.chainId,
    command: name,
    commandId,
    deploymentFingerprint: context.fingerprint,
    domain: new URL(context.origin).host,
    issuedAtMilliseconds: Date.now(),
    uri: `${context.origin}/admin`,
  });
  return { message, signature: await signMessageAsync({ message }) };
};

/** A queued pass and a held writer lease are both operationally relevant. */
function ControlFacts({
  state,
}: {
  readonly state: OperatorControlStateDTO | undefined;
}) {
  if (state === undefined) return null;
  return (
    <DataList className="mb-3">
      <DataRow
        label={applicationCopy.cockpit.titles.service}
        tone="live"
        value={applicationCopy.cockpit.service[state.service]}
      />
      <DataRow
        label={applicationCopy.cockpit.nextRun}
        value={displayTime(state.nextRunAt ?? undefined)}
      />
      <DataRow
        label={applicationCopy.shell.chainLabel}
        value={deploymentEnvironment.chainLabel}
      />
      {state.desired.oneShot === "none" ? null : (
        <DataRow
          label={applicationCopy.cockpit.titles.automation}
          value={
            <Badge tone="live">
              {applicationCopy.cockpit.controlOneShot(state.desired.oneShot)}
            </Badge>
          }
        />
      )}
      {state.writerLease === undefined ? null : (
        <DataRow
          label={applicationCopy.cockpit.owners.operator}
          value={applicationCopy.cockpit.controlLease(state.writerLease.holder)}
        />
      )}
    </DataList>
  );
}

/** The reason the command keys are unavailable, resolved once. */
const controlDisabledReason = (
  authenticated: boolean,
  failedRead: boolean,
  applying: boolean,
): string | undefined => {
  if (!authenticated) return applicationCopy.operations.noRoleBody;
  if (failedRead) return applicationCopy.cockpit.controlUnavailable;
  return applying ? applicationCopy.cockpit.controlPending : undefined;
};

export function OperatorControlPanel() {
  const adminSession = useOptionalAdminSession();
  const protocol = useProtocolClient();
  const { signMessageAsync } = useSignMessage();
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // The same read the cockpit's attention board uses, so the two panels can
  // never describe the operator service differently.
  const state = useOperatorControlState();

  const command = useMutation({
    mutationFn: async (name: OperatorCommandName) => {
      const session = adminSession?.session;
      if (session === undefined) {
        throw new Error("An authenticated admin session is required");
      }
      const commandId = newOperatorCommandId();
      const signedCommand = await signCommandIfRequired(
        name,
        commandId,
        session,
        signMessageAsync,
      );
      return sendOperatorCommand({
        command: name,
        commandId,
        csrfToken: session.csrfToken,
        ...(signedCommand === undefined ? {} : { signedCommand }),
      });
    },
    onError: (cause: unknown) => {
      setFailure(
        cause instanceof Error
          ? cause.message
          : applicationCopy.cockpit.controlUnavailable,
      );
    },
    onSuccess: async () => {
      setFailure(undefined);
      // A command changes protocol state, not just the control ledger: the
      // cockpit and pause board around this panel render from the health
      // read, which otherwise showed pre-command state for up to 30 seconds.
      await Promise.all([state.refetch(), protocol.refresh()]);
    },
  });

  const current = state.state;
  const disabledReason = controlDisabledReason(
    adminSession !== undefined,
    state.unreachable,
    command.isPending,
  );

  return (
    <Panel
      className="laptop:col-span-12"
      meta={
        current === undefined ? undefined : (
          <span data-mode={current.desired.mode}>
            <Badge
              dot
              tone={current.desired.mode === "live" ? "live" : "neutral"}
            >
              {applicationCopy.cockpit.automation[current.desired.mode]}
            </Badge>
          </span>
        )
      }
      title={applicationCopy.cockpit.controlHeading}
      tone="live"
    >
      <p className="mb-3 text-body-sm text-ink-soft">
        {applicationCopy.cockpit.controlIntroduction}
      </p>
      <ControlFacts state={current} />
      <div className="flex flex-wrap gap-2">
        {OPERATOR_COMMANDS.map((name) => (
          <Button
            aria-describedby={
              disabledReason === undefined ? undefined : "control-disabled"
            }
            disabled={disabledReason !== undefined}
            key={name}
            onClick={() => command.mutate(name)}
            type="button"
            variant={name === "stop" ? "destructive" : "outline"}
          >
            {applicationCopy.cockpit.controlCommands[name]}
          </Button>
        ))}
      </div>
      {disabledReason === undefined ? null : (
        <DisabledReason id="control-disabled">{disabledReason}</DisabledReason>
      )}
      <p className="mt-2 text-caption text-ink-faint">
        {applicationCopy.cockpit.controlSignatureNote}
      </p>
      {failure === undefined ? null : (
        <StateFeedback
          className="mt-3"
          compact
          description={failure}
          title={applicationCopy.common.readFailed}
          tone="error"
        />
      )}
      {current === undefined ? null : <ControlAudit audit={current.audit} />}
    </Panel>
  );
}
