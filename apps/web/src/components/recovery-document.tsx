import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { applicationCopy, identity } from "@/lib/identity";

/**
 * The document behind the global 404 and the boundary of last resort.
 *
 * Neither inherits the root layout, so each has to carry its own `<html>`,
 * the font variables and a minimal collector chrome: the brand mark, the
 * testnet strip, a skip link, and enough navigation to leave. The full rail
 * is deliberately absent; a page that failed to resolve should not pretend
 * to be a route.
 */
export function RecoveryDocument({
  children,
  fontVariables,
}: {
  readonly children: React.ReactNode;
  readonly fontVariables: string;
}) {
  return (
    <html className={fontVariables} data-scroll-behavior="smooth" lang="en">
      <body>
        <div className="flex min-h-dvh flex-col" data-shell="collector">
          <nav
            aria-label={applicationCopy.shell.accessibilityNavigation}
            className="contents"
          >
            <a
              className="fixed top-2 left-4 z-100 flex min-h-11 -translate-y-[160%] items-center rounded-[var(--radius-control)] bg-signal-fill px-4 font-mono text-body-sm font-semibold text-signal-fill-text focus-visible:translate-y-0"
              href="#main-content"
            >
              {applicationCopy.shell.skipToContent}
            </a>
          </nav>
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-line bg-surface-1 px-4 tablet:px-6">
            <Link
              aria-label={`${identity.brand}: ${applicationCopy.shell.home}`}
              className="flex min-h-11 min-w-0 items-center gap-3"
              href="/"
            >
              <span
                aria-hidden="true"
                className="grid size-7 flex-none place-items-center rounded-[var(--radius-control)] bg-signal-fill font-mono text-body-sm font-bold text-signal-fill-text"
              >
                O
              </span>
              <span
                className="font-mono text-body font-bold tracking-[0.08em] whitespace-nowrap text-ink uppercase"
                data-brand-mark
              >
                {identity.brand}
              </span>
            </Link>
            <nav aria-label={applicationCopy.shell.protocolNavigation}>
              <ul className="flex flex-wrap items-center gap-1">
                <li>
                  <ButtonLink href="/start" size="sm" variant="ghost">
                    {applicationCopy.navigation.start}
                  </ButtonLink>
                </li>
                <li>
                  <ButtonLink href="/status" size="sm" variant="ghost">
                    {applicationCopy.navigation.status}
                  </ButtonLink>
                </li>
              </ul>
            </nav>
          </header>
          <p
            className="flex min-h-8 flex-wrap items-center gap-x-2 border-b border-line bg-canvas px-4 py-1 font-mono text-label tracking-[0.1em] text-ink-soft uppercase tablet:px-6"
            role="status"
          >
            <span className="text-[var(--status-warning-text)]">
              {applicationCopy.shell.testnetLabel}
            </span>
            <span>{applicationCopy.shell.testnetCompactDisclosure}</span>
          </p>
          <div className="flex-1">{children}</div>
          <footer className="border-t border-line px-4 py-5 font-mono text-label tracking-[0.1em] text-ink-faint uppercase tablet:px-6">
            <span className="text-ink-soft">{identity.brand}</span>
            {" · "}
            {applicationCopy.shell.testnetCompactDisclosure}
          </footer>
        </div>
      </body>
    </html>
  );
}
