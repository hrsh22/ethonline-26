"use client";

import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  Coins,
  Droplets,
  LineChart,
  Orbit,
  Rocket,
  Satellite,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  MobileActivityIndicator,
  MobileActivityLink,
} from "@/components/shell/mobile-activity";
import { LivePulse } from "@/components/shell/live-pulse";
import { CollectorActivity } from "@/components/shell/collector-activity";
import {
  BrandMark,
  ShellRail,
  ShellSkipLink,
  type NavigationIcons,
} from "@/components/shell/rail";
import { WalletControl } from "@/components/wallet-control";
import { applicationCopy, identity } from "@/lib/identity";
import {
  createShellNavigation,
  type NavigationDestination,
} from "@/lib/navigation";

/**
 * The collector shell: a persistent left rail on desktop, a top bar with a
 * drawer below the laptop breakpoint.
 *
 * The rail is the `<header>`: brand first, the navigation, then the wallet
 * pinned to the bottom. The content column carries a status strip, the route,
 * and a footer. Exactly one treatment marks where you are — the signal rule.
 */

const icons: NavigationIcons = {
  "/start": Rocket,
  "/exchange": ArrowLeftRight,
  "/fleet": Orbit,
  "/relics": Satellite,
  "/rewards": Coins,
  "/market": LineChart,
  "/status": Activity,
  "/learn": BookOpen,
  "/faucet": Droplets,
};

/**
 * The status strip. The testnet disclosure is a standing condition of this
 * deployment and stays announced as a status; the live readout beside it is
 * not announced, because it changes with every block.
 */
function StatusStrip() {
  return (
    <div className="grid min-h-[5.25rem] content-center gap-1 border-b border-line bg-canvas px-4 py-1 tablet:flex tablet:min-h-8 tablet:flex-wrap tablet:items-center tablet:justify-between tablet:gap-x-4 tablet:px-6">
      <p
        className="flex flex-col items-start gap-x-2 font-mono text-label tracking-[0.1em] text-ink-soft uppercase tablet:flex-row tablet:flex-wrap tablet:items-baseline"
        role="status"
      >
        <span className="text-[var(--status-warning-text)]">
          {applicationCopy.shell.testnetLabel}
        </span>
        <span>{applicationCopy.shell.testnetCompactDisclosure}</span>
      </p>
      <LivePulse />
    </div>
  );
}

function CollectorFooter({
  utility,
}: {
  readonly utility: readonly NavigationDestination[];
}) {
  return (
    <footer className="border-t border-line">
      <div className="flex w-full flex-col gap-3 px-4 py-5 tablet:flex-row tablet:items-baseline tablet:justify-between tablet:px-6">
        <p className="font-mono text-label tracking-[0.1em] text-ink-faint uppercase">
          <span className="text-ink-soft">{identity.brand}</span>
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
                  className="flex min-h-11 items-center font-mono text-label tracking-[0.1em] text-ink-soft uppercase transition-colors duration-[var(--motion-fast)] hover:text-ink motion-reduce:transition-none"
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

export function CollectorShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const navigation = createShellNavigation("collector", pathname);

  return (
    <div
      className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] laptop:pb-0 laptop:grid laptop:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      data-shell="collector"
    >
      {/* `contents`: the skip link is fixed-position, and its wrapper must
          not occupy the rail's grid column. */}
      <ShellSkipLink />
      <ShellRail
        brand={
          <BrandMark
            /* Below `compact` the bar has to hold the wordmark, the connected
               address, its action and the menu toggle in one 56px row, and it
               cannot: the wallet pair wrapped, the address floated over the
               wordmark and the header grew to 96px on every route. The badge
               keeps the link (and its accessible name) on the phone; the
               wordmark returns as soon as there is room for it. */
            className="mr-auto min-w-0 [&_[data-brand-mark]]:hidden compact:[&_[data-brand-mark]]:block laptop:mr-0 laptop:border-b laptop:border-line laptop:px-4 laptop:py-3"
            context={applicationCopy.shell.chainLabel}
            href="/"
          />
        }
        icons={icons}
        key={pathname}
        navigationId="collector-navigation"
        mobileDestinations={["/fleet", "/exchange", "/rewards"].flatMap(
          (href) =>
            navigation.primary.filter(
              (destination) => destination.href === href,
            ),
        )}
        mobileActivityIndicator={<MobileActivityIndicator />}
        mobileActivityLink={<MobileActivityLink />}
        sections={[
          {
            ariaLabel: applicationCopy.shell.collectorNavigation,
            groups: [
              {
                destinations: navigation.primary,
                label: applicationCopy.shell.collectGroup,
              },
              {
                destinations: navigation.utility,
                label: applicationCopy.shell.protocolGroup,
              },
            ],
          },
        ]}
      >
        <WalletControl />
      </ShellRail>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <StatusStrip />
        <CollectorActivity />
        <div className="flex-1">{children}</div>
        <CollectorFooter utility={navigation.utility} />
      </div>
    </div>
  );
}
