export interface ProtocolHealthReadScope {
  readonly includeConnectedWallet: boolean;
  readonly includeOperationalHistory: boolean;
  readonly includeRewardHistory: boolean;
}

export const shouldLoadMarketHistory = (pathname: string): boolean =>
  pathname === "/market";

export const shouldLoadPublicStatus = (pathname: string): boolean =>
  pathname === "/status" || pathname === "/market";

export const getProtocolHealthReadScope = (
  pathname: string,
): ProtocolHealthReadScope => {
  const diagnostics =
    pathname === "/admin/diagnostics" ||
    pathname.startsWith("/admin/diagnostics/");
  return {
    includeConnectedWallet: pathname !== "/status",
    includeOperationalHistory: pathname === "/admin" || diagnostics,
    includeRewardHistory: pathname === "/status" || diagnostics,
  };
};
