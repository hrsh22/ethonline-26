import type { Route } from "next";

/** Only public collection origins can control a detail page's Back link. */
export function collectionReturnTarget(params: {
  readonly from?: string | string[] | undefined;
  readonly returnTo?: string | string[] | undefined;
}): Route {
  if (params.from === "explore") return "/explore";
  if (typeof params.returnTo !== "string") return "/fleet";
  try {
    const target = new URL(params.returnTo, "https://orbit.invalid");
    if (
      !params.returnTo.startsWith("/fleet?") ||
      target.origin !== "https://orbit.invalid" ||
      target.pathname !== "/fleet"
    )
      return "/fleet";
    return `/fleet${target.search}` as Route;
  } catch {
    return "/fleet";
  }
}
