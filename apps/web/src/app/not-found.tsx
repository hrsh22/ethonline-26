import { CollectionSearchRecovery } from "@/components/collection-search-recovery";
import { RecoverySurface } from "@/components/recovery-surface";
import { ButtonLink } from "@/components/ui/button";

import { notFoundContent } from "./not-found-content";

export const metadata = notFoundContent.metadata;

/** The 404 inside the collector shell; the shell supplies the rail and strip. */
export default function NotFound() {
  return (
    <RecoverySurface
      actions={
        <>
          <CollectionSearchRecovery />
          <ButtonLink href="/learn" variant="outline">
            {notFoundContent.learn}
          </ButtonLink>
        </>
      }
      description={notFoundContent.introduction}
      eyebrow={notFoundContent.eyebrow}
      title={notFoundContent.title}
    />
  );
}
