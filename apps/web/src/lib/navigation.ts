import type { Route } from "next";

import { applicationCopy, identity } from "@/lib/identity";

export type ShellContext = "collector" | "admin";

export interface NavigationDestination {
  readonly active: boolean;
  readonly href: Route;
  readonly label: string;
}

export interface CollectorReturnDestination {
  readonly href: "/auction" | "/exchange" | "/fleet";
  readonly label: "Auction" | "Fleet" | "Trade";
}

/** Strictly validates collector origins that may be carried in a query string. */
export const collectorReturnDestination = (
  returnTo: string | null | undefined,
): CollectorReturnDestination | undefined => {
  switch (returnTo) {
    case "/auction":
      return { href: "/auction", label: "Auction" };
    case "/exchange":
      return { href: "/exchange", label: "Trade" };
    case "/start":
    case "/fleet":
      return { href: "/fleet", label: "Fleet" };
    default:
      return undefined;
  }
};

interface NavigationDefinition {
  readonly href: Route;
  readonly label: string;
  /** Also active for paths beneath this one. */
  readonly nested?: boolean;
}

const collectorNavigation = {
  primary: [
    { href: "/explore", label: "Explore" },
    { href: "/exchange", label: "Trade" },
    {
      href: "/fleet",
      label: identity.navigation.collectionTask,
      nested: true,
    },
  ],
  utility: [
    { href: "/auction", label: "Auction results" },
    { href: "/learn", label: "Learn" },
    { href: "/status", label: "Protocol status" },
    { href: "/faucet", label: "Faucet" },
  ],
} as const satisfies NavigationDefinitions;

const adminNavigation = {
  primary: [
    { href: "/admin", label: applicationCopy.shell.operationsNavigation },
    {
      href: "/admin/diagnostics",
      label: applicationCopy.shell.diagnosticsNavigation,
      nested: true,
    },
  ],
  utility: [
    { href: "/status", label: applicationCopy.shell.publicStatusNavigation },
    { href: "/", label: applicationCopy.shell.collectorAppNavigation },
  ],
} as const satisfies NavigationDefinitions;

interface NavigationDefinitions {
  readonly primary: readonly NavigationDefinition[];
  readonly utility: readonly NavigationDefinition[];
}

const isActive = (
  pathname: string,
  definition: NavigationDefinition,
): boolean =>
  pathname === definition.href ||
  (definition.nested === true && pathname.startsWith(`${definition.href}/`));

const destinations = (
  pathname: string,
  definitions: readonly NavigationDefinition[],
): readonly NavigationDestination[] =>
  definitions.map((definition) => ({
    active: isActive(pathname, definition),
    href: definition.href,
    label: definition.label,
  }));

export const createShellNavigation = (
  context: ShellContext,
  pathname: string,
  options: {
    readonly fromExplore?: boolean;
    readonly auctionActive?: boolean;
  } = {},
) => {
  const definitions =
    context === "collector" ? collectorNavigation : adminNavigation;
  const primaryPathname =
    context === "collector"
      ? options.fromExplore && pathname.startsWith("/fleet/")
        ? "/explore"
        : pathname === "/market"
          ? "/exchange"
          : pathname === "/relics"
            ? "/explore"
            : pathname
      : pathname;
  return {
    primary: destinations(
      primaryPathname,
      context === "collector" && options.auctionActive
        ? [
            definitions.primary[0]!,
            { href: "/auction", label: "Auction" },
            ...definitions.primary.slice(1),
          ]
        : definitions.primary,
    ),
    utility: destinations(pathname, definitions.utility),
  } as const;
};
