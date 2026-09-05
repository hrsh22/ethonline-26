"use client";

import { useState } from "react";
import type { ProtocolAction } from "@orbit/protocol/transactions";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import type {
  HealthSnapshot,
  ProtocolClient,
  ReviewContext,
} from "@/components/admin/admin-console-context";
import { StateFeedback } from "@/components/state-feedback";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel, Well } from "@/components/ui/panel";
import { Address } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import type { PrivilegedActionReviewInput } from "@/lib/privileged-action-review";

const isEvmAddress = (value: string): value is `0x${string}` =>
  /^0x[0-9a-fA-F]{40}$/u.test(value.trim()) &&
  !/^0x0{40}$/iu.test(value.trim());

const ZERO_ADDRESS = `0x${"0".repeat(40)}` as const;

/**
 * Absent is not always-allow: a manifest written before the claim policy was
 * recorded says nothing about the bound gate, so only a declared always-allow
 * policy earns the definitive copy.
 */
function FixedClaimPolicy({ declared }: { readonly declared: boolean }) {
  return (
    <Panel
      className="laptop:col-span-6"
      title={applicationCopy.operations.claimPolicyTitle}
    >
      <StateFeedback
        compact
        description={
          declared
            ? applicationCopy.operations.claimPolicyFixed
            : applicationCopy.operations.claimPolicyUndeclared
        }
        title={applicationCopy.operations.claimPolicyTitle}
        tone={declared ? "notice" : "partial"}
      />
    </Panel>
  );
}

function ClaimPolicyControls({
  account,
  context,
  onAccountChange,
  protocol,
  review,
  target,
}: {
  readonly account: string;
  readonly context: ReviewContext;
  readonly onAccountChange: (value: string) => void;
  readonly protocol: ProtocolClient;
  readonly review: Omit<
    PrivilegedActionReviewInput,
    "action" | "intendedState"
  >;
  readonly target: `0x${string}` | undefined;
}) {
  return (
    <Well className="mt-3 grid gap-3">
      <label
        className="flex min-h-11 flex-col justify-center gap-1 font-mono text-label tracking-[0.1em] text-ink-faint uppercase"
        htmlFor="claim-policy-account"
      >
        {applicationCopy.operations.claimPolicyAccountLabel}
        <input
          autoComplete="off"
          className="min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-canvas px-3 font-mono text-body tracking-normal text-ink normal-case outline-none focus:border-[var(--accent-fill)]"
          id="claim-policy-account"
          onChange={(event) => onAccountChange(event.currentTarget.value)}
          size={1}
          spellCheck={false}
          type="text"
          value={account}
        />
      </label>
      {([true, false] as const).map((allowed) => {
        const action = {
          type: "set-claim-policy",
          account: target ?? ZERO_ADDRESS,
          allowed,
        } as const satisfies ProtocolAction;
        const state = protocol.getActionState(action);
        return (
          <AdminActionControl
            action={action}
            enabled={state.enabled && target !== undefined}
            key={String(allowed)}
            label={
              allowed
                ? applicationCopy.operations.claimPolicyApprove
                : applicationCopy.operations.claimPolicyRevoke
            }
            onExecute={protocol.execute}
            pending={context.pending}
            reason={
              target === undefined
                ? applicationCopy.operations.claimPolicyInvalidAccount
                : state.reason
            }
            review={{
              ...review,
              intendedState: allowed
                ? applicationCopy.operations.claimPolicyApproveIntent
                : applicationCopy.operations.claimPolicyRevokeIntent,
            }}
            variant={allowed ? "default" : "destructive"}
          />
        );
      })}
    </Well>
  );
}

/**
 * Claim eligibility for the configurable proof-of-concept policy. The fixed
 * always-allow policy cannot deny, so the card says so rather than offering
 * controls that would silently do nothing.
 */
export function AdminClaimPolicyCard({
  context,
  health,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
}) {
  const [account, setAccount] = useState("");
  const administrator = health?.deployment.claimPolicy?.administrator;
  const configurable = health?.deployment.claimPolicy?.mode === "configurable";
  const trimmed = account.trim();
  const target = isEvmAddress(trimmed) ? trimmed : undefined;

  if (!configurable) {
    return (
      <FixedClaimPolicy
        declared={health?.deployment.claimPolicy !== undefined}
      />
    );
  }
  return (
    <Panel
      className="laptop:col-span-6"
      meta={applicationCopy.operations.owner}
      title={applicationCopy.operations.claimPolicyTitle}
    >
      <DataList>
        <DataRow
          label={applicationCopy.operations.claimPolicyAdministrator}
          value={
            administrator === undefined ? (
              applicationCopy.common.notObserved
            ) : (
              <Address value={administrator} />
            )
          }
        />
      </DataList>
      <ClaimPolicyControls
        account={account}
        context={context}
        onAccountChange={setAccount}
        protocol={protocol}
        review={{
          ...context,
          currentState: applicationCopy.operations.claimPolicyTitle,
          subject: applicationCopy.operations.claimPolicyTitle,
        }}
        target={target}
      />
    </Panel>
  );
}
