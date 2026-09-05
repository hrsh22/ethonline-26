import type { Route } from "next";

import { applicationCopy } from "@/lib/identity";

export type ShellContext = "collector" | "admin";

export interface NavigationDestination {
  readonly active: boolean;
  readonly href: Route;
  readonly label: string;
}

interface NavigationDefinition {
  readonly href: Route;
  readonly label: string;
  /** Also active for paths beneath this one. */
  readonly nested?: boolean;
}

const collectorNavigation = {
  primary: [
    { href: "/start", label: applicationCopy.navigation.start },
    { href: "/exchange", label: applicationCopy.navigation.exchange },
    {
      href: "/fleet",
      label: applicationCopy.navigation.collection,
      nested: true,
    },
    { href: "/relics", label: applicationCopy.navigation.relics },
    { href: "/rewards", label: applicationCopy.navigation.rewards },
  ],
  utility: [
    { href: "/market", label: applicationCopy.navigation.market },
    { href: "/status", label: applicationCopy.navigation.status },
    { href: "/learn", label: applicationCopy.navigation.learn },
    { href: "/faucet", label: applicationCopy.navigation.faucet },
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
) => {
  const definitions =
    context === "collector" ? collectorNavigation : adminNavigation;
  return {
    primary: destinations(pathname, definitions.primary),
    utility: destinations(pathname, definitions.utility),
  } as const;
};
