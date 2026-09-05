"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";

import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { buttonVariants } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import {
  dialogActionsClassName,
  dialogBackdropClassName,
  dialogDescriptionClassName,
  dialogPopupClassName,
  dialogTitleClassName,
} from "@/components/ui/dialog";
import { Well } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { PrivilegedActionReview } from "@/lib/privileged-action-review";

/** A submission already in flight must not be duplicated. */
const blockedByPending = (pending: boolean): string | undefined =>
  pending ? applicationCopy.operations.reviewPendingReason : undefined;

const reviewReasonId = (label: string): string =>
  `review-blocked-${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`;

function ReviewSnapshot({
  review,
}: {
  readonly review: PrivilegedActionReview;
}) {
  const pinned: readonly (readonly [string, string])[] = [
    [applicationCopy.operations.reviewActor, review.actor],
    [applicationCopy.operations.reviewRequiredRole, review.requiredRole],
    [applicationCopy.operations.reviewNetwork, review.network],
    [applicationCopy.operations.reviewObservedBlock, review.observedBlock],
    [applicationCopy.operations.reviewSubject, review.subject],
    [applicationCopy.operations.reviewCurrentState, review.currentState],
  ];
  return (
    <DataList className="mt-4">
      {pinned.map(([term, value]) => (
        <DataRow key={term} label={term} value={value} />
      ))}
      <DataRow
        label={applicationCopy.operations.reviewIntendedState}
        tone="live"
        value={<span data-intended>{review.intendedState}</span>}
      />
      {review.rows.map(([term, value]) => (
        <DataRow key={term} label={term} value={value} />
      ))}
    </DataList>
  );
}

/**
 * What the submission changes, in the operator's own terms. It is the last
 * thing read before a wallet prompt, so it is a warning well rather than a
 * paragraph.
 */
function ReviewConsequences({
  consequences,
}: {
  readonly consequences: readonly string[];
}) {
  if (consequences.length === 0) return null;
  return (
    <Well className="mt-4 border-[var(--status-warning-text)]">
      <h3 className="font-mono text-label font-semibold tracking-[0.1em] text-[var(--status-warning-text)] uppercase">
        {applicationCopy.operations.reviewConsequences}
      </h3>
      <ul className="mt-2 grid gap-1.5 text-body-sm text-ink">
        {consequences.map((consequence) => (
          <li key={consequence}>{consequence}</li>
        ))}
      </ul>
    </Well>
  );
}

/**
 * The reviewed submission itself: pinned snapshot, consequences, blocker, and
 * the confirm/cancel pair.
 */
function ReviewPopup({
  close,
  label,
  onConfirm,
  pending,
  reasonId,
  review,
}: {
  readonly label: string;
  readonly onConfirm: () => Promise<unknown>;
  readonly close: () => void;
  readonly pending: boolean;
  readonly reasonId: string;
  readonly review: PrivilegedActionReview;
}) {
  const [submitting, setSubmitting] = useState(false);
  const blocker = review.blocker;
  const confirm = async () => {
    setSubmitting(true);
    try {
      // Preparation simulates against the current block, so a state change
      // between opening this review and confirming still fails closed.
      await onConfirm();
    } finally {
      setSubmitting(false);
      close();
    }
  };
  return (
    <AlertDialog.Popup className={dialogPopupClassName} data-privileged-review>
      <AlertDialog.Title className={dialogTitleClassName}>
        {applicationCopy.operations.reviewTitle(label)}
      </AlertDialog.Title>
      <AlertDialog.Description className={dialogDescriptionClassName}>
        {applicationCopy.operations.reviewIntroduction}
      </AlertDialog.Description>
      <ReviewSnapshot review={review} />
      <ReviewConsequences consequences={review.consequences} />
      {blocker === undefined ? null : (
        <StateFeedback
          className="mt-4"
          compact
          description={blocker}
          title={applicationCopy.operations.reviewBlockedTitle}
          tone="blocked"
        />
      )}
      <div className={dialogActionsClassName}>
        <AlertDialog.Close className={buttonVariants({ variant: "outline" })}>
          {applicationCopy.operations.reviewCancel}
        </AlertDialog.Close>
        {/* A plain button, not AlertDialog.Close: closing on click unmounted
            the popup before the async confirmation started, so the
            "simulating" label and the double-submit guard both rendered into
            nothing while gas estimation and the wallet prompt ran unseen. The
            dialog closes when the confirmation settles. */}
        <button
          aria-describedby={blocker === undefined ? undefined : reasonId}
          className={buttonVariants()}
          disabled={blocker !== undefined || submitting || pending}
          onClick={() => void confirm()}
          type="button"
        >
          {submitting
            ? applicationCopy.operations.reviewSimulating
            : applicationCopy.operations.reviewConfirm}
        </button>
      </div>
      {blocker === undefined ? null : (
        <DisabledReason id={reasonId}>{blocker}</DisabledReason>
      )}
    </AlertDialog.Popup>
  );
}

/**
 * Every privileged admin action passes through this review. It is keyboard
 * operable, states what will change against a pinned snapshot, simulates
 * immediately before signing, and refuses to submit while a blocker stands or
 * another submission is in flight.
 */
export function PrivilegedActionReviewDialog({
  disabledReason,
  label,
  onConfirm,
  pending,
  review,
  variant = "default",
}: {
  readonly disabledReason: string | undefined;
  readonly label: string;
  readonly onConfirm: () => Promise<unknown>;
  readonly pending: boolean;
  readonly review: PrivilegedActionReview;
  /** Only one action on a panel is the filled one; the rest are outlines. */
  readonly variant?: "default" | "outline" | "destructive";
}) {
  const reasonId = reviewReasonId(label);
  const triggerReason = disabledReason ?? blockedByPending(pending);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <AlertDialog.Root onOpenChange={setOpen} open={open}>
        <AlertDialog.Trigger
          aria-describedby={
            triggerReason === undefined ? undefined : `${reasonId}-trigger`
          }
          className={cn(
            buttonVariants({ variant }),
            "h-auto min-h-11 w-full py-2 text-center whitespace-normal",
          )}
          disabled={triggerReason !== undefined}
        >
          {label}
        </AlertDialog.Trigger>
        {triggerReason === undefined ? null : (
          <DisabledReason id={`${reasonId}-trigger`}>
            {triggerReason}
          </DisabledReason>
        )}
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={dialogBackdropClassName} />
          <ReviewPopup
            close={() => setOpen(false)}
            label={label}
            onConfirm={onConfirm}
            pending={pending}
            reasonId={`${reasonId}-modal`}
            review={review}
          />
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
