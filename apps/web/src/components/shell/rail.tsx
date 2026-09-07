"use client";

import { Menu, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { applicationCopy, identity } from "@/lib/identity";
import type { NavigationDestination } from "@/lib/navigation";
import { useDismissableMenu } from "@/lib/use-dismissable-menu";
import { cn } from "@/lib/utils";

/**
 * The rail both application shells are built from.
 *
 * On desktop it is a persistent left column: the brand first, the navigation
 * groups under it, and the shell's own controls pinned to the bottom. Below
 * the laptop breakpoint it collapses into a top bar whose navigation opens as
 * one dismissable drawer, so a narrow layout has a single panel to open.
 *
 * The collector and the operator console differ only in what they put in it,
 * which is the point: an operator moving between them should recognise the
 * same instrument, not learn a second one.
 */

export type NavigationIcons = Readonly<
  Record<string, React.ComponentType<{ className?: string }>>
>;

/** A labelled set of destinations inside one navigation landmark. */
export interface RailGroup {
  readonly destinations: readonly NavigationDestination[];
  readonly label: string;
}

/**
 * One navigation landmark. The console splits its destinations across two so
 * an operator cannot mistake a link that leaves the console for a console tab;
 * the collector keeps its loop and its evidence surfaces in one.
 */
export interface RailSection {
  readonly ariaLabel: string;
  readonly groups: readonly RailGroup[];
}

export function ShellSkipLink() {
  return (
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
  );
}

export function BrandMark({
  className,
  context,
  href,
}: {
  readonly className?: string;
  /** The line under the wordmark: which of the two applications this is. */
  readonly context: string;
  readonly href: "/" | "/admin";
}) {
  return (
    <Link
      aria-label={`${identity.brand}: ${applicationCopy.shell.home}`}
      className={cn(
        "flex min-h-11 items-center gap-3 laptop:shrink-0",
        className,
      )}
      href={href}
    >
      <span
        aria-hidden="true"
        className="grid size-7 flex-none place-items-center rounded-[var(--radius-control)] bg-signal-fill font-mono text-body-sm font-bold text-signal-fill-text"
      >
        O
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        {/* The browser harness injects a hydration mismatch and a header
            collision through this hook; it is an explicit attribute rather
            than a generated class so a rebuild cannot silently unhook it. */}
        <span
          className="font-mono text-body font-bold tracking-[0.08em] whitespace-nowrap text-ink uppercase"
          data-brand-mark
        >
          {identity.brand}
        </span>
        <span className="mt-1 hidden font-mono text-label tracking-[0.12em] text-ink-faint uppercase compact:block">
          {context}
        </span>
      </span>
    </Link>
  );
}

function NavigationLink({
  destination,
  icons,
}: {
  readonly destination: NavigationDestination;
  readonly icons: NavigationIcons;
}) {
  const Icon = icons[destination.href];
  return (
    <Link
      aria-current={destination.active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 border-l-2 px-4 font-mono text-body-sm font-semibold tracking-[0.06em] uppercase transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none",
        destination.active
          ? "border-signal bg-surface-3 text-ink"
          : "border-transparent text-ink-soft hover:bg-surface-2 hover:text-ink",
      )}
      href={destination.href}
    >
      {Icon === undefined ? null : (
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 flex-none",
            destination.active ? "text-signal" : "text-ink-faint",
          )}
        />
      )}
      {destination.label}
    </Link>
  );
}

function NavigationGroup({
  group,
  icons,
}: {
  readonly group: RailGroup;
  readonly icons: NavigationIcons;
}) {
  return (
    <div>
      <p className="px-4 pt-3 pb-1 font-mono text-label tracking-[0.14em] text-ink-faint uppercase">
        {group.label}
      </p>
      <ul>
        {group.destinations.map((destination) => (
          <li key={destination.href}>
            <NavigationLink destination={destination} icons={icons} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `children` are the shell's own controls — the wallet, and whatever session
 * facts belong beside it. They share the bar with the drawer toggle on narrow
 * layouts, so they are listed as a focus peer: without that the trap's tab
 * cycle skips them, leaving no keyboard path to the wallet while the drawer
 * is open.
 */
const secondaryRouteActive = (
  sections: readonly RailSection[],
  mobileDestinations: readonly NavigationDestination[] | undefined,
) =>
  mobileDestinations !== undefined &&
  !mobileDestinations.some((destination) => destination.active) &&
  sections
    .flatMap((section) => section.groups.flatMap((group) => group.destinations))
    .some((destination) => destination.active);

export function ShellRail({
  brand,
  children,
  icons = {},
  navigationId,
  sections,
  mobileDestinations,
  mobileActivityIndicator,
  mobileActivityLink,
}: {
  readonly brand: React.ReactNode;
  readonly children: React.ReactNode;
  readonly icons?: NavigationIcons;
  readonly navigationId: string;
  readonly mobileDestinations?: readonly NavigationDestination[];
  readonly mobileActivityIndicator?: React.ReactNode;
  readonly mobileActivityLink?: React.ReactNode;
  readonly sections: readonly RailSection[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreActive = secondaryRouteActive(sections, mobileDestinations);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mobileNavigation = useRef<HTMLElement>(null);
  const activeMenuButton = useRef<HTMLButtonElement>(null);
  const railActions = useRef<HTMLDivElement>(null);
  const peers = useMemo(() => [railActions, mobileNavigation], []);

  const close = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) (activeMenuButton.current ?? menuButton.current)?.focus();
  }, []);

  useDismissableMenu({
    control: menuButton,
    menu,
    onDismiss: close,
    open: menuOpen,
    peers,
  });

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 flex min-h-14 items-center gap-3 border-b border-line bg-surface-1 px-4",
          "laptop:h-dvh laptop:flex-col laptop:items-stretch laptop:gap-0 laptop:border-r laptop:border-b-0 laptop:px-0",
        )}
      >
        {brand}

        <div
          className={cn(
            "absolute inset-x-0 top-full hidden max-h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto border-b border-line bg-surface-1 pb-3 shadow-[var(--shadow-overlay)] data-open:flex",
            "laptop:static laptop:flex laptop:min-h-0 laptop:max-h-none laptop:flex-1 laptop:border-0 laptop:shadow-none",
            mobileDestinations !== undefined &&
              "max-h-[calc(100dvh-7.5rem-env(safe-area-inset-bottom))]",
          )}
          data-open={menuOpen || undefined}
          id={navigationId}
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("a") !== null)
              close(false);
          }}
          ref={menu}
        >
          {sections.map((section) => (
            <nav
              className="shrink-0"
              aria-label={section.ariaLabel}
              key={section.ariaLabel}
            >
              {section.groups.map((group) => (
                <NavigationGroup
                  group={group}
                  icons={icons}
                  key={group.label}
                />
              ))}
            </nav>
          ))}
          {mobileActivityLink}
        </div>

        <div
          className="flex min-w-0 items-center gap-2 laptop:shrink-0 laptop:flex-col laptop:items-stretch laptop:border-t laptop:border-line laptop:p-3 [&_.wallet-button]:laptop:w-full"
          ref={railActions}
        >
          {children}
          <button
            aria-controls={navigationId}
            aria-expanded={menuOpen}
            aria-label={
              menuOpen
                ? applicationCopy.shell.closeMenu
                : applicationCopy.shell.openMenu
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong text-ink transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 laptop:hidden motion-reduce:transition-none"
            data-open={menuOpen || undefined}
            onClick={(event) => {
              activeMenuButton.current = event.currentTarget;
              setMenuOpen((current) => !current);
            }}
            ref={menuButton}
            type="button"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </header>
      {mobileDestinations === undefined ? null : (
        <nav
          aria-label="Mobile collector navigation"
          data-mobile-navigation
          ref={mobileNavigation}
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] laptop:hidden"
        >
          {mobileDestinations.map((destination) => {
            const Icon = icons[destination.href];
            return (
              <Link
                key={destination.href}
                href={destination.href}
                aria-current={destination.active ? "page" : undefined}
                onClick={() => close(false)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-caption",
                  destination.active ? "text-signal" : "text-ink-soft",
                )}
              >
                {Icon === undefined ? null : (
                  <Icon className="size-5" aria-hidden="true" />
                )}
                {destination.label}
              </Link>
            );
          })}
          <button
            type="button"
            aria-label="More navigation"
            aria-current={moreActive ? "page" : undefined}
            aria-controls={navigationId}
            aria-expanded={menuOpen}
            className={cn(
              "relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-caption",
              moreActive ? "text-signal" : "text-ink-soft",
            )}
            onClick={(event) => {
              activeMenuButton.current = event.currentTarget;
              setMenuOpen((current) => !current);
            }}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
            More{mobileActivityIndicator}
          </button>
        </nav>
      )}
    </>
  );
}
