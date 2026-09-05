import type { ReactNode } from "react";

import { AdminSessionBoundary } from "@/components/admin/admin-session-boundary";
import { AdminShell } from "@/components/admin/admin-shell";
import type { AdminSessionDTO } from "@/lib/admin-session-contract";

export function ProtectedAdminPage({
  children,
  session,
}: {
  readonly children: ReactNode;
  readonly session: AdminSessionDTO;
}) {
  return (
    <AdminSessionBoundary session={session}>
      <AdminShell session={session}>{children}</AdminShell>
    </AdminSessionBoundary>
  );
}
