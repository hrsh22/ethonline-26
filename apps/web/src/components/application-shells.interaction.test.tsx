/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ pathname: "/exchange" }));

// The live readout needs the protocol provider; the shell tests exercise
// navigation and wallet states, not protocol reads.
vi.mock("@/components/shell/live-pulse", () => ({ LivePulse: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => routeState.pathname,
}));

vi.mock("@/components/wallet-control", () => ({
  WalletControl: () => <button type="button">Test wallet</button>,
}));

import { CollectorShell } from "./shell/collector-shell";

describe("collector mobile navigation", () => {
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

  it("opens explicitly and returns focus to its control when Escape closes it", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="collector-navigation"]',
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container
        .querySelector("#collector-navigation")
        ?.hasAttribute("data-open"),
    ).toBe(true);

    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps opened navigation before the wallet in DOM and mobile visual order", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );

    const wallet = [...container.querySelectorAll("header button")].find(
      (button) => button.textContent === "Test wallet",
    );
    const firstDestination = container.querySelector(
      'nav[aria-label="Collector navigation"] a',
    );

    expect(firstDestination?.compareDocumentPosition(wallet as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("does not reopen stale menu state after navigating away and back", async () => {
    const renderShell = async () =>
      act(async () =>
        root.render(
          <CollectorShell>
            <main>Collector content</main>
          </CollectorShell>,
        ),
      );
    await renderShell();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-controls="collector-navigation"]',
        )
        ?.click(),
    );
    expect(
      container
        .querySelector('[aria-controls="collector-navigation"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");

    routeState.pathname = "/start";
    await renderShell();
    expect(
      container
        .querySelector('[aria-controls="collector-navigation"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    routeState.pathname = "/exchange";
    await renderShell();
    expect(
      container
        .querySelector('[aria-controls="collector-navigation"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("closes when a pointer interaction lands outside the menu", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="collector-navigation"]',
    );
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    await act(async () =>
      document.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open for a pointer interaction inside the menu", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="collector-navigation"]',
    );
    await act(async () => toggle?.click());

    const link = container.querySelector<HTMLAnchorElement>(
      "#collector-navigation a",
    );
    await act(async () =>
      link?.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("contains Tab within the open menu and its control", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="collector-navigation"]',
    );
    await act(async () => toggle?.click());

    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        "#collector-navigation a",
      ),
    ];
    const first = links.at(0);
    const last = links.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    // The toggle is the cycle's last element in document order, so Tab from
    // it wraps to the first link. The old order fabricated [toggle, ...links]
    // and wrapped Tab from the last link straight to the toggle -- skipping
    // the wallet controls that sit between them, which left a keyboard user
    // no path to connecting a wallet while the menu was open.
    toggle?.focus();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      ),
    );
    expect(document.activeElement).toBe(first);

    first?.focus();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Tab",
          shiftKey: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(toggle);

    // Mid-cycle Tab is not intercepted: from the last link it proceeds
    // naturally toward the header actions instead of being wrapped past them.
    last?.focus();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      ),
    );
    expect(document.activeElement).toBe(last);
  });

  it("offers the loop and the evidence surfaces without reaching the footer", async () => {
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );
    const menu = container.querySelector("#collector-navigation");
    const hrefs = [...(menu?.querySelectorAll("a") ?? [])].map((link) =>
      link.getAttribute("href"),
    );
    for (const href of [
      "/start",
      "/exchange",
      "/fleet",
      "/relics",
      "/rewards",
      "/market",
      "/status",
      "/learn",
      "/faucet",
    ]) {
      expect(hrefs).toContain(href);
    }
    // The rail holds every destination once; the admin console is not one.
    expect(hrefs.filter((href) => href === "/fleet")).toHaveLength(1);
    expect(hrefs).not.toContain("/admin");
  });

  it("marks the current route inside the menu", async () => {
    routeState.pathname = "/fleet/1493";
    await act(async () =>
      root.render(
        <CollectorShell>
          <main>Collector content</main>
        </CollectorShell>,
      ),
    );
    const current = container.querySelector(
      '#collector-navigation a[aria-current="page"]',
    );
    expect(current?.getAttribute("href")).toBe("/fleet");
  });
});
