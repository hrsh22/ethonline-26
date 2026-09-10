/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ returnTo: null as string | null }));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      routeState.returnTo === null
        ? undefined
        : { returnTo: routeState.returnTo },
    ),
}));

import { CollectorReturnLink } from "./collector-return-link";

describe("collector return link", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    routeState.returnTo = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (fallbackToTrade = false) =>
    act(async () =>
      root.render(<CollectorReturnLink fallbackToTrade={fallbackToTrade} />),
    );

  it.each([
    ["/auction", "/auction", "Return to Auction"],
    ["/exchange", "/exchange", "Return to Trade"],
    ["/start", "/fleet", "Return to Fleet"],
    ["/fleet", "/fleet", "Return to Fleet"],
  ])(
    "returns %s to its validated collector destination",
    async (query, href, label) => {
      routeState.returnTo = query;
      await render();

      expect(container.querySelector("a")?.getAttribute("href")).toBe(href);
      expect(container.textContent).toBe(label);
    },
  );

  it("drops an invalid return and preserves the direct-faucet Trade continuation", async () => {
    routeState.returnTo = "https://example.com";
    await render();
    expect(container.querySelector("a")).toBeNull();

    await render(true);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/exchange",
    );
    expect(container.textContent).toBe("Buy $FUEL on Trade");
  });
});
