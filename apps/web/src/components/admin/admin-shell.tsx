"use client";

import { Activity, Orbit, SlidersHorizontal, Stethoscope } from "lucide-react";
import { usePathname } from "next/navigation";

import {
  BrandMark,
  ShellRail,
  ShellSkipLink,
  type NavigationIcons,
} from "@/components/shell/rail";
import { Badge } from "@/components/ui/badge";
import { Address, Unavailable } from "@/components/ui/value";
import { WalletControl } from "@/components/wallet-control";
import type { AdminSessionDTO } from "@/lib/admin-session-contract";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { createShellNavigation } from "@/lib/navigation";

/**
 * The operator console shell.
 *
 * It is the collector's rail with a different payload: the console
 * destinations, the destinations that leave the console in their own labelled
 * landmark, and the session this console is being operated under pinned above
 * the wallet. One instrument, two applications — an operator crossing between
 * them recognises the layout rather than relearning it.
 */

const icons: NavigationIcons = {
  "/admin": SlidersHorizontal,
  "/admin/diagnostics": Stethoscope,
  "/status": Activity,
  "/": Orbit,
};

/** UTC, so a server render and its hydration agree on the same characters. */
const expiryLabel = (expiresAt: string): string => {
  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.getTime())
    ? expiresAt
    : `${expiry.toISOString().slice(11, 16)} UTC`;
};

/** The short form of the deployment this console is bound to. */
const fingerprintLabel = (fingerprint: string): string =>
  `${fingerprint.slice(0, 10)}…`;

/**
 * Who is operating, with what, and until when. Every action in the console is
 * taken under these three facts, so they sit with the sign-out control rather
 * than inside a route that may scroll away.
 */
function SessionSummary({ session }: { readonly session: AdminSessionDTO }) {
  return (
    <div className="hidden min-w-0 flex-col gap-2 laptop:flex">
      <p className="font-mono text-label tracking-[0.14em] text-ink-faint uppercase">
        Session
      </p>
      <Address
        className="block text-body-sm text-ink"
        value={session.address}
      />
      <ul className="flex flex-wrap gap-1">
        {session.roles.map((role) => (
          <li key={role}>
            <Badge tone="neutral">{role}</Badge>
          </li>
        ))}
      </ul>
      <p className="flex items-baseline gap-2 font-mono text-label tracking-[0.08em] text-ink-faint uppercase">
        Expires
        <time
          className="tracking-normal text-ink-soft tabular-nums"
          dateTime={session.expiresAt}
        >
          {expiryLabel(session.expiresAt)}
        </time>
      </p>
    </div>
  );
}

/**
 * The standing conditions of the console: which chain it acts on, that it is
 * the console and not the collector application, and which deployment record
 * the session is bound to.
 */
function AdminStatusStrip() {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-canvas px-4 py-1 tablet:px-6">
      <p
        className="flex flex-wrap items-baseline gap-x-2 font-mono text-label tracking-[0.1em] text-ink-soft uppercase"
        role="status"
      >
        <span className="text-[var(--status-warning-text)]">
          {applicationCopy.shell.testnetLabel}
        </span>
        <span aria-hidden="true">·</span>
        <span>{applicationCopy.shell.operatorConsole}</span>
      </p>
      <p className="flex items-baseline gap-2 font-mono text-label tracking-[0.1em] text-ink-faint uppercase">
        Deployment
        {protocolDeploymentFingerprint === undefined ? (
          <Unavailable reason="No deployment record is configured for this build." />
        ) : (
          <span className="tracking-normal text-ink-soft tabular-nums">
            {fingerprintLabel(protocolDeploymentFingerprint)}
          </span>
        )}
      </p>
    </div>
  );
}

export function AdminShell({
  children,
  session,
}: {
  readonly children: React.ReactNode;
  readonly session: AdminSessionDTO;
}) {
  const pathname = usePathname();
  const navigation = createShellNavigation("admin", pathname);

  return (
    <div
      className="min-h-dvh laptop:grid laptop:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      data-shell="admin"
    >
      <ShellSkipLink />
      <ShellRail
        brand={
          <BrandMark
            className="mr-auto min-w-0 laptop:mr-0 laptop:border-b laptop:border-line laptop:px-4 laptop:py-3"
            context={applicationCopy.shell.operatorConsole}
            href="/admin"
          />
        }
        icons={icons}
        key={`${session.issuedAt}:${pathname}`}
        navigationId="admin-navigation"
        sections={[
          {
            ariaLabel: applicationCopy.shell.adminNavigation,
            groups: [
              {
                destinations: navigation.primary,
                label: applicationCopy.shell.adminTasksGroup,
              },
            ],
          },
          {
            /* Destinations that leave the console are their own landmark so
               an operator cannot mistake them for console tabs. */
            ariaLabel: applicationCopy.shell.adminExitNavigation,
            groups: [
              {
                destinations: navigation.utility,
                label: applicationCopy.shell.adminExitGroup,
              },
            ],
          },
        ]}
      >
        <SessionSummary session={session} />
        <WalletControl />
      </ShellRail>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <AdminStatusStrip />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
