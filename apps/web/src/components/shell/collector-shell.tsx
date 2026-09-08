"use client";

import { ArrowLeftRight, Compass, Orbit } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CollectorActivity } from "@/components/shell/collector-activity";
import { MobileActivityIndicator } from "@/components/shell/mobile-activity";
import { BrandMark, ShellSkipLink } from "@/components/shell/rail";
import { WalletControl } from "@/components/wallet-control";
import { applicationCopy, identity } from "@/lib/identity";
import {
  createShellNavigation,
  type NavigationDestination,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

const collectorIcons = {
  "/explore": Compass,
  "/exchange": ArrowLeftRight,
  "/fleet": Orbit,
} as const;

function PrimaryNavigation({
  destinations,
}: {
  readonly destinations: readonly NavigationDestination[];
}) {
  return (
    <nav
      aria-label={applicationCopy.shell.collectorNavigation}
      className="hidden h-full tablet:block"
      id="collector-navigation"
    >
      <ul className="flex h-full items-stretch gap-1">
        {destinations.map((destination) => (
          <li className="flex" key={destination.href}>
            <Link
              aria-current={destination.active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center border-b-2 px-3 text-body font-medium transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none laptop:px-4",
                destination.active
                  ? "border-signal text-ink"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
              href={destination.href}
            >
              {destination.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MobileNavigation({
  destinations,
}: {
  readonly destinations: readonly NavigationDestination[];
}) {
  return (
    <nav
      aria-label="Mobile collector navigation"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] tablet:hidden"
      data-mobile-navigation
    >
      {destinations.map((destination) => {
        const Icon =
          collectorIcons[destination.href as keyof typeof collectorIcons];
        return (
          <Link
            aria-current={destination.active ? "page" : undefined}
            className={cn(
              "relative flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 px-1 text-caption",
              destination.active
                ? "border-signal text-ink"
                : "border-transparent text-ink-soft",
            )}
            href={destination.href}
            key={destination.href}
          >
            <Icon aria-hidden="true" className="size-5" />
            {destination.label}
            {destination.href === "/fleet" ? <MobileActivityIndicator /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function CollectorFooter({
  utility,
}: {
  readonly utility: readonly NavigationDestination[];
}) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-[85rem] flex-col gap-3 px-4 py-5 tablet:flex-row tablet:items-baseline tablet:justify-between tablet:px-6">
        <p className="font-mono text-label text-ink-faint">
          <span className="text-ink-soft">{identity.brand}</span>
          {" · "}
          {applicationCopy.shell.testnetLabel}
          {" · "}
          {applicationCopy.shell.testnetCompactDisclosure}
        </p>
        <nav aria-label={applicationCopy.shell.protocolNavigation}>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            <li>
              <Link
                className="flex min-h-11 items-center text-body-sm text-ink-soft hover:text-ink"
                href="/learn#help"
              >
                Help
              </Link>
            </li>
            {utility.map((destination) => (
              <li key={destination.href}>
                <Link
                  aria-current={destination.active ? "page" : undefined}
                  className="flex min-h-11 items-center text-body-sm text-ink-soft transition-colors duration-[var(--motion-fast)] hover:text-ink motion-reduce:transition-none"
                  href={destination.href}
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/** Compact collector chrome. Transaction state remains mounted above route content. */
export function CollectorShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const navigation = createShellNavigation("collector", pathname);

  return (
    <div
      className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] tablet:pb-0"
      data-shell="collector"
    >
      <ShellSkipLink />
      <header className="sticky top-0 z-40 border-b border-line bg-surface-1/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-[4.75rem] w-full max-w-[85rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 tablet:grid tablet:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] tablet:gap-3 tablet:px-6 tablet:py-0">
          <div
            className="flex shrink-0 flex-col items-start gap-0 tablet:flex-row tablet:items-center tablet:gap-2"
            data-collector-brand
          >
            <BrandMark
              className="shrink-0 [&_[data-brand-mark]]:hidden compact:[&_[data-brand-mark]]:block"
              context={`${applicationCopy.shell.testnetLabel} · No value`}
              href="/"
            />
            <p className="font-mono text-label leading-tight text-[var(--status-warning-text)] compact:hidden">
              Base Sepolia
              <span className="block text-ink-faint">No value</span>
            </p>
          </div>
          <PrimaryNavigation destinations={navigation.primary} />
          <div
            className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-3 tablet:ml-0"
            data-collector-wallet-actions
          >
            <WalletControl />
          </div>
        </div>
      </header>
      <CollectorActivity />
      <div className="flex min-h-[calc(100dvh-4.75rem)] flex-col">
        <div className="flex-1">{children}</div>
        <CollectorFooter utility={navigation.utility} />
      </div>
      <MobileNavigation destinations={navigation.primary} />
    </div>
  );
}
