"use client";

import { RecoverySurface } from "@/components/recovery-surface";
import { Button, ButtonLink } from "@/components/ui/button";
import { applicationCopy } from "@/lib/identity";

/**
 * The route-level boundary the app previously did not have: one malformed
 * payload or render bug unwound to Next's bare production error screen and
 * took the whole route with it -- on the admin console that included the
 * pause controls. Recovery is scoped to the failed route.
 */
export default function RouteError({
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  return (
    <RecoverySurface
      actions={
        <>
          <Button onClick={reset} type="button">
            {applicationCopy.routeCrash.retry}
          </Button>
          <ButtonLink href="/" variant="outline">
            {applicationCopy.common.returnHome}
          </ButtonLink>
          <ButtonLink href="/status" variant="outline">
            {applicationCopy.routeCrash.status}
          </ButtonLink>
        </>
      }
      description={applicationCopy.routeCrash.introduction}
      eyebrow={applicationCopy.routeCrash.eyebrow}
      title={applicationCopy.routeCrash.title}
    />
  );
}
