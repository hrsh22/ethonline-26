"use client";

import { StateFeedback } from "@/components/state-feedback";
import { Button, ButtonLink } from "@/components/ui/button";
import type { AdminAccessState } from "@/lib/admin-access";
import { applicationCopy } from "@/lib/identity";

const adminAccessMessage = (
  state: Exclude<AdminAccessState, "authorized">,
): { readonly body: string; readonly title: string } => {
  switch (state) {
    case "disconnected":
      return {
        title: applicationCopy.access.disconnectedTitle,
        body: applicationCopy.access.disconnectedBody,
      };
    case "wrong-network":
      return {
        title: applicationCopy.access.wrongNetworkTitle,
        body: applicationCopy.access.wrongNetworkBody,
      };
    case "deployment-pending":
      return {
        title: applicationCopy.access.deploymentPendingTitle,
        body: applicationCopy.access.deploymentPendingBody,
      };
    case "loading":
      return {
        title: applicationCopy.operations.checkingRolesTitle,
        body: applicationCopy.operations.checkingRolesBody,
      };
    case "read-failed":
      return {
        title: applicationCopy.operations.roleReadFailedTitle,
        body: applicationCopy.operations.roleReadFailedBody,
      };
    case "unauthorized":
      return {
        title: applicationCopy.operations.noRoleTitle,
        body: applicationCopy.operations.noRoleBody,
      };
  }
};

/**
 * Explains a blocked console before any protocol control renders: what stands
 * between this wallet and the boards, and the safe way back out.
 */
export function AdminAccessGate({
  onRetry,
  state,
}: {
  readonly onRetry: () => Promise<void>;
  readonly state: Exclude<AdminAccessState, "authorized">;
}) {
  const message = adminAccessMessage(state);
  const tone =
    state === "loading"
      ? ("loading" as const)
      : state === "read-failed"
        ? ("error" as const)
        : ("blocked" as const);
  return (
    <StateFeedback
      action={
        <>
          {state === "read-failed" ? (
            <Button onClick={() => void onRetry()} type="button">
              {applicationCopy.operations.retryRoleRead}
            </Button>
          ) : null}
          <ButtonLink href="/status" variant="outline">
            {applicationCopy.operations.back}
          </ButtonLink>
        </>
      }
      description={message.body}
      title={message.title}
      tone={tone}
    />
  );
}
