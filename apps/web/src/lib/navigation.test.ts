import { describe, expect, it } from "vitest";

import {
  collectorReturnDestination,
  createShellNavigation,
} from "./navigation";

describe("collector return destinations", () => {
  it("allows only known collector origins and keeps legacy Fleet returns", () => {
    expect(collectorReturnDestination("/auction")).toEqual({
      href: "/auction",
      label: "Auction",
    });
    expect(collectorReturnDestination("/exchange")).toEqual({
      href: "/exchange",
      label: "Trade",
    });
    expect(collectorReturnDestination("/start")).toEqual({
      href: "/fleet",
      label: "Fleet",
    });
    expect(collectorReturnDestination("/fleet")).toEqual({
      href: "/fleet",
      label: "Fleet",
    });
    expect(collectorReturnDestination("https://example.com")).toBeUndefined();
    expect(collectorReturnDestination("//example.com")).toBeUndefined();
    expect(collectorReturnDestination("/auction/other")).toBeUndefined();
  });
});

describe("collector navigation", () => {
  it("exposes the collector destinations and secondary utilities", () => {
    const navigation = createShellNavigation("collector", "/exchange");

    expect(navigation.primary.map((entry) => entry.href)).toEqual([
      "/explore",
      "/exchange",
      "/fleet",
    ]);
    expect(navigation.primary.map((entry) => entry.label)).toEqual([
      "Explore",
      "Trade",
      "My Fleet",
    ]);
    expect(navigation.utility.map((entry) => entry.href)).toEqual([
      "/auction",
      "/learn",
      "/status",
      "/faucet",
    ]);
    expect(navigation.utility.map((entry) => entry.label)).toEqual([
      "Auction results",
      "Learn",
      "Protocol status",
      "Faucet",
    ]);
  });

  it("marks exactly one destination active, including on a detail page", () => {
    for (const [pathname, expected] of [
      ["/explore", "/explore"],
      ["/auction", "/auction"],
      ["/exchange", "/exchange"],
      ["/market", "/exchange"],
      ["/relics", "/explore"],
      ["/fleet", "/fleet"],
      ["/fleet/1204", "/fleet"],
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
