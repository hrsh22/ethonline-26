import type { Metadata } from "next";

import { AdminSignIn } from "@/components/admin/admin-sign-in";
import { identity } from "@/lib/identity";
import { safeAdminReturnPath } from "@/lib/admin-session-contract";

export const metadata = {
  title: "Operator sign-in",
  description: `Authenticate an operator wallet before entering the ${identity.brand} admin console.`,
} satisfies Metadata;

export default async function AdminSignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly next?: string | readonly string[];
  }>;
}) {
  const parameters = await searchParams;
  const requestedNext =
    typeof parameters.next === "string" ? parameters.next : undefined;
  // The sign-in page sits outside the console shell on purpose: nothing here
  // is protected, so it renders the Graphite canvas directly.
  return <AdminSignIn next={safeAdminReturnPath(requestedNext)} />;
}
