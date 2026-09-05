"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import type { ProtocolAction } from "@orbit/protocol/transactions";

import { AdminActionControl } from "@/components/admin/admin-action-control";
import {
  formatObservedWeth,
  type HealthSnapshot,
  type ProtocolClient,
  type ReviewContext,
} from "@/components/admin/admin-console-context";
import { StateFeedback } from "@/components/state-feedback";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Panel, Well } from "@/components/ui/panel";
import { Address } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import type { PrivilegedActionReviewInput } from "@/lib/privileged-action-review";

const exactWithdrawalReason = (
  amount: bigint | undefined,
  stateReason: string | undefined,
): string | undefined =>
  amount === undefined
    ? applicationCopy.operations.creatorAmountInvalid
    : stateReason;

/** Rejects anything that is not a positive decimal WETH amount. */
const parseWethAmount = (value: string): bigint | undefined => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return undefined;
  try {
    const parsed = parseUnits(trimmed, 18);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
};

function CreatorFeeSummary({
  destination,
  formatted,
  pot,
}: {
  readonly destination: string;
  readonly formatted: string;
  readonly pot: bigint | undefined;
}) {
  return (
    <>
      <p className="font-mono text-heading font-medium text-signal tabular-nums">
        {formatted} WETH
      </p>
      <DataList className="mt-2">
        <DataRow
          label={applicationCopy.operations.creatorFeeAccrued}
          value={`${formatted} WETH`}
        />
        <DataRow
          label={applicationCopy.operations.creatorFeeDestination}
          value={
            destination === applicationCopy.common.notObserved ? (
              destination
            ) : (
              <Address value={destination} />
            )
          }
        />
      </DataList>
      {pot === undefined || pot === 0n ? null : (
        <Disclosure
          searchable
          title={applicationCopy.rewards.rawUnitsDisclosure}
        >
          <code className="font-mono text-body-sm text-ink [overflow-wrap:anywhere]">
            {pot.toString()}
          </code>
        </Disclosure>
      )}
    </>
  );
}

function CreatorFeeControls({
  context,
  pot,
  protocol,
  review,
}: {
  readonly context: ReviewContext;
  readonly pot: bigint;
  readonly protocol: ProtocolClient;
  readonly review: Omit<PrivilegedActionReviewInput, "action">;
}) {
  const [amountText, setAmountText] = useState("");
  const exactAmount = parseWethAmount(amountText);
  const withdrawAll = {
    type: "withdraw-creator-fees",
    amount: pot,
  } as const satisfies ProtocolAction;
  const exactAction = {
    type: "withdraw-creator-fees",
    amount: exactAmount ?? 0n,
  } as const satisfies ProtocolAction;
  const allState = protocol.getActionState(withdrawAll);
  const exactState = protocol.getActionState(exactAction);
  return (
    <div className="mt-3 grid gap-3">
      <AdminActionControl
        action={withdrawAll}
        enabled={allState.enabled}
        label={applicationCopy.operations.creatorWithdrawAll}
        onExecute={protocol.execute}
        pending={context.pending}
        reason={allState.reason}
        review={review}
      />
      <Well className="grid gap-3">
        <label
          className="flex min-h-11 flex-col justify-center gap-1 font-mono text-label tracking-[0.1em] text-ink-faint uppercase"
          data-creator-fee-controls
          htmlFor="creator-withdraw-amount"
        >
          {applicationCopy.operations.creatorAmountLabel}
          <input
            autoComplete="off"
            className="min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-canvas px-3 font-mono text-lede tracking-normal text-ink normal-case tabular-nums outline-none focus:border-[var(--accent-fill)]"
            id="creator-withdraw-amount"
            inputMode="decimal"
            onChange={(event) => setAmountText(event.currentTarget.value)}
            size={1}
            spellCheck={false}
            type="text"
            value={amountText}
          />
        </label>
        <AdminActionControl
          action={exactAction}
          enabled={exactState.enabled && exactAmount !== undefined}
          label={applicationCopy.operations.creatorWithdrawAmount}
          onExecute={protocol.execute}
          pending={context.pending}
          reason={exactWithdrawalReason(exactAmount, exactState.reason)}
          review={review}
          variant="outline"
        />
      </Well>
    </div>
  );
}

/**
 * Creator fees accrue in the fee hook and can only be pulled to the
 * destination configured onchain. Withdraw-all and an exact amount are both
 * reviewed, and neither grants any other admin capability.
 */
export function AdminCreatorFeeCard({
  context,
  health,
  protocol,
}: {
  readonly context: ReviewContext;
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
}) {
  const pot = health?.market.creatorPotWeth;
  /* The headline is a balance, not evidence. The raw units stay one
     disclosure away in the summary, and the exact expansion stays in
     Diagnostics, so nothing is lost by not printing 18 decimals here. */
  const formatted = formatObservedWeth(pot);
  const review = {
    ...context,
    currentState: `${formatted} WETH`,
    intendedState: applicationCopy.operations.reviewCreatorWithdrawn,
    subject: applicationCopy.operations.creatorFeeTitle,
  };
  return (
    <Panel
      className="laptop:col-span-6"
      meta={applicationCopy.operations.creator}
      title={applicationCopy.operations.creatorFeeTitle}
    >
      <CreatorFeeSummary
        destination={
          health?.roles.creator ?? applicationCopy.common.notObserved
        }
        formatted={formatted}
        pot={pot}
      />
      {pot === undefined || pot === 0n ? (
        <StateFeedback
          className="mt-3"
          compact
          description={applicationCopy.operations.creatorNoBalance}
          title={applicationCopy.operations.creatorFeeAccrued}
          tone="empty"
        />
      ) : (
        <CreatorFeeControls
          context={context}
          pot={pot}
          protocol={protocol}
          review={review}
        />
      )}
    </Panel>
  );
}
