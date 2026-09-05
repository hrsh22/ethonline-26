"use client";

import { RecoveryDocument } from "@/components/recovery-document";
import { RecoverySurface } from "@/components/recovery-surface";
import { Button, ButtonLink } from "@/components/ui/button";
import { applicationCopy } from "@/lib/identity";

import { applicationFontVariables } from "./fonts";
import "./globals.css";

/**
 * The boundary of last resort, rendered when the root layout itself fails --
 * so it carries its own document shell rather than inheriting one.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  return (
    <RecoveryDocument fontVariables={applicationFontVariables}>
      <RecoverySurface
        actions={
          <>
            <Button onClick={reset} type="button">
              {applicationCopy.routeCrash.retry}
            </Button>
            <ButtonLink href="/" variant="outline">
              {applicationCopy.common.returnHome}
            </ButtonLink>
          </>
        }
        description={applicationCopy.routeCrash.introduction}
        eyebrow={applicationCopy.routeCrash.eyebrow}
        title={applicationCopy.routeCrash.title}
      />
    </RecoveryDocument>
  );
}
