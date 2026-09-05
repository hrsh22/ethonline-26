import { describe, expect, it } from "vitest";

import { createShellNavigation } from "./navigation";

describe("collector navigation", () => {
  it("lists the collecting loop before the public evidence", () => {
    const navigation = createShellNavigation("collector", "/exchange");

    expect(navigation.primary.map((entry) => entry.href)).toEqual([
      "/start",
      "/exchange",
      "/fleet",
      "/relics",
      "/rewards",
    ]);
    expect(navigation.utility.map((entry) => entry.href)).toEqual([
      "/market",
      "/status",
      "/learn",
      "/faucet",
    ]);
  });

  it("marks exactly one destination active, including on a detail page", () => {
    for (const [pathname, expected] of [
      ["/exchange", "/exchange"],
      ["/fleet", "/fleet"],
      ["/fleet/1204", "/fleet"],
      ["/relics", "/relics"],
      ["/faucet", "/faucet"],
    ] as const) {
      const navigation = createShellNavigation("collector", pathname);
      const active = [...navigation.primary, ...navigation.utility].filter(
        (entry) => entry.active,
      );
      expect(active, pathname).toHaveLength(1);
      expect(active[0]?.href).toBe(expected);
    }
  });

  it("marks no destination active on a page outside the navigation", () => {
    const navigation = createShellNavigation("collector", "/");
    expect(
      [...navigation.primary, ...navigation.utility].some(
        (entry) => entry.active,
      ),
    ).toBe(false);
  });

  it("does not treat a sibling path as nested", () => {
    // `/fleet` owns `/fleet/1204`; it must not own `/fleet-something`.
    const navigation = createShellNavigation("collector", "/fleet-x");
    expect(navigation.primary.some((entry) => entry.active)).toBe(false);
  });
});

describe("admin navigation", () => {
  it("separates console tabs from destinations that leave the console", () => {
    const navigation = createShellNavigation("admin", "/admin/diagnostics");
    expect(navigation.primary.map((entry) => entry.href)).toEqual([
      "/admin",
      "/admin/diagnostics",
    ]);
    expect(navigation.utility.map((entry) => entry.href)).toEqual([
      "/status",
      "/",
    ]);
    expect(navigation.primary.filter((entry) => entry.active)).toHaveLength(1);
    expect(navigation.primary[1]?.active).toBe(true);
  });

  it("marks the console root active only on its own path", () => {
    const navigation = createShellNavigation("admin", "/admin");
    expect(navigation.primary[0]?.active).toBe(true);
    expect(navigation.primary[1]?.active).toBe(false);
    expect(navigation.utility.some((entry) => entry.active)).toBe(false);
  });
});
