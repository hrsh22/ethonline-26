import type { Metadata } from "next";

import { AdminDiagnosticsPanel } from "@/components/admin/admin-diagnostics-panel";
import { ProtectedAdminPage } from "@/components/admin/protected-admin-page";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { applicationCopy } from "@/lib/identity";
import { requireAdminSession } from "@/lib/admin-session.server";

export const metadata = {
  title: applicationCopy.operations.diagnosticsTitle,
  description: applicationCopy.operations.diagnosticsIntroduction,
} satisfies Metadata;

export default async function AdminDiagnosticsPage() {
  const session = await requireAdminSession("/admin/diagnostics");
  return (
    <ProtectedAdminPage session={session}>
      <PageFrame>
        <PageHeading
          eyebrow={applicationCopy.operations.diagnosticsEyebrow}
          lede={applicationCopy.operations.diagnosticsIntroduction}
          title={applicationCopy.operations.diagnosticsTitle}
        />
        <AdminDiagnosticsPanel />
      </PageFrame>
    </ProtectedAdminPage>
  );
}
