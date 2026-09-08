/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ pathname: "/exchange" }));

vi.mock("@/components/shell/collector-activity", () => ({
  CollectorActivity: () => <aside data-testid="collector-activity" />,
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({ transaction: { status: "idle" } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => routeState.pathname,
}));
vi.mock("@/components/wallet-control", () => ({
  WalletControl: () => <button type="button">Test wallet</button>,
}));

import { CollectorShell } from "./shell/collector-shell";

describe("collector shell navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    routeState.pathname = "/exchange";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderShell = async () =>
    act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );

  it("offers the same three destinations in the header and mobile bar", async () => {
    await renderShell();

    for (const label of [
      "Collector navigation",
      "Mobile collector navigation",
    ]) {
      const nav = container.querySelector(`nav[aria-label="${label}"]`);
      expect(
        [...(nav?.querySelectorAll("a") ?? [])].map((link) => [
          link.textContent?.trim(),
          link.getAttribute("href"),
        ]),
      ).toEqual([
        ["Explore", "/explore"],
        ["Trade", "/exchange"],
        ["My Fleet", "/fleet"],
      ]);
      expect(
        nav?.querySelector('a[aria-current="page"]')?.getAttribute("href"),
      ).toBe("/exchange");
    }
  });

  it("keeps utilities in the footer and out of permanent primary chrome", async () => {
    await renderShell();

    const primary = container.querySelector(
      'nav[aria-label="Collector navigation"]',
    );
    const footer = container.querySelector(
      'footer nav[aria-label="Protocol navigation"]',
    );
    expect(primary?.textContent).not.toMatch(
      /Help|Learn|Protocol status|Faucet/u,
    );
    expect(
      [...(footer?.querySelectorAll("a") ?? [])].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/learn#help", "/learn", "/status", "/faucet"]);
  });

  it("marks Fleet current on a craft detail route", async () => {
    routeState.pathname = "/fleet/1493";
    await renderShell();

    expect(
      container
        .querySelector(
          'nav[aria-label="Collector navigation"] a[aria-current="page"]',
        )
        ?.getAttribute("href"),
    ).toBe("/fleet");
  });

  it("keeps the home link, navigation, and wallet in header order", async () => {
    await renderShell();

    const header = container.querySelector("header");
    const headerHtml = header?.innerHTML ?? "";
    const brand = header?.querySelector("[data-collector-brand]");
    const headerLayout = header?.firstElementChild;
    const walletActions = header?.querySelector(
      "[data-collector-wallet-actions]",
    );
    expect(headerHtml.indexOf('href="/"')).toBeLessThan(
      headerHtml.indexOf('id="collector-navigation"'),
    );
    expect(headerHtml.indexOf('id="collector-navigation"')).toBeLessThan(
      headerHtml.indexOf("Test wallet"),
    );
    expect(brand?.classList.contains("shrink-0")).toBe(true);
    expect(headerLayout?.classList.contains("flex-wrap")).toBe(true);
    expect(walletActions?.classList.contains("ml-auto")).toBe(true);
    expect(walletActions?.classList.contains("max-w-full")).toBe(true);
    expect(headerHtml).not.toContain("No-value test assets.");
  });

  it("keeps recoverable activity before the current route", async () => {
    await renderShell();

    expect(
      container.innerHTML.indexOf('data-testid="collector-activity"'),
    ).toBeLessThan(container.innerHTML.indexOf("Collector content"));
  });
});
