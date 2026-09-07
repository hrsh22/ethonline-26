export interface ProtocolHealthReadScope {
  readonly includeBytecodeInventory: boolean;
  readonly includeConnectedWallet: boolean;
  readonly includeOperationalHistory: boolean;
  readonly includeRewardHistory: boolean;
}

export const shouldLoadMarketHistory = (pathname: string): boolean =>
  pathname === "/market";

export const shouldLoadPublicStatus = (pathname: string): boolean =>
  ["/", "/learn", "/admin/sign-in", "/status", "/market"].includes(pathname);

export const getProtocolHealthReadScope = (
  pathname: string,
): ProtocolHealthReadScope => {
  const diagnostics =
    pathname === "/admin/diagnostics" ||
    pathname.startsWith("/admin/diagnostics/");
  return {
    includeBytecodeInventory:
      pathname === "/admin" || pathname.startsWith("/admin/"),
    includeConnectedWallet: pathname !== "/status",
    includeOperationalHistory: pathname === "/admin" || diagnostics,
    includeRewardHistory: pathname === "/status" || diagnostics,
  };
};
