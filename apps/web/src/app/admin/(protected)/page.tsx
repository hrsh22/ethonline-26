import type { Metadata } from "next";

import { OperationsPanel } from "@/components/admin/operations-panel";
import { ProtectedAdminPage } from "@/components/admin/protected-admin-page";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";
import { requireAdminSession } from "@/lib/admin-session.server";

export const metadata = {
  title: applicationCopy.operations.title,
  description: applicationCopy.operations.introduction,
} satisfies Metadata;

export default async function AdminPage() {
  const session = await requireAdminSession("/admin");
  return (
    <ProtectedAdminPage session={session}>
      <PageFrame>
        <PageHeading
          eyebrow={applicationCopy.operations.eyebrow}
          lede={applicationCopy.operations.introduction}
          title={applicationCopy.operations.title}
        />
        <OperationsPanel />
      </PageFrame>
    </ProtectedAdminPage>
  );
}
