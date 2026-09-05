"use client";

import type { ProtocolAction } from "@orbit/protocol/transactions";

import { PrivilegedActionReviewDialog } from "@/components/admin/privileged-action-review";
import { applicationCopy } from "@/lib/identity";
import type { PrivilegedActionReviewInput } from "@/lib/privileged-action-review";
import { derivePrivilegedActionReview } from "@/lib/privileged-action-review";

/**
 * Every privileged action is submitted from a review, never from a single
 * click. The disabled reason still explains a blocked precondition before the
 * review is even reachable.
 */
export function AdminActionControl({
  action,
  enabled,
  label,
  onExecute,
  pending,
  reason,
  review,
  variant = "default",
}: {
  readonly action: ProtocolAction;
  readonly enabled: boolean;
  readonly label: string;
  readonly onExecute: (
    action: ProtocolAction,
    label: string,
  ) => Promise<unknown>;
  readonly pending: boolean;
  readonly reason: string | undefined;
  readonly review: Omit<PrivilegedActionReviewInput, "action">;
  readonly variant?: "default" | "outline" | "destructive";
}) {
  /* The reason stands on its own. It used to be prefixed with "Unavailable
     because", which glued a subordinating conjunction onto a complete
     sentence -- "Unavailable because Enter a positive WETH amount." -- and
     left the admin notes reading differently from the identical notes the
     collector surfaces render under a disabled button. */
  const renderedReason =
    reason === undefined || reason === applicationCopy.common.notObserved
      ? "Refresh the current protocol snapshot before retrying this action."
      : reason;
  return (
    <PrivilegedActionReviewDialog
      disabledReason={enabled ? undefined : renderedReason}
      label={label}
      onConfirm={() => onExecute(action, label)}
      pending={pending}
      review={derivePrivilegedActionReview({ ...review, action })}
      variant={variant}
    />
  );
}
