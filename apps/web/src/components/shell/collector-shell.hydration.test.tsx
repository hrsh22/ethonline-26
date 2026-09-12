/** @vitest-environment jsdom */

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  publicStatus: undefined as { observedBlock: bigint } | undefined,
  pathname: "/",
  search: "",
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({ publicStatus: state.publicStatus }),
}));
vi.mock("@/lib/deployment", () => ({
  protocolDeploymentManifest: { cca: { lifecycle: { endBlock: "200" } } },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/components/shell/collector-activity", () => ({
  CollectorActivity: () => null,
}));
vi.mock("@/components/shell/collector-notifications", () => ({
  CollectorNotifications: () => null,
}));
vi.mock("@/components/shell/mobile-activity", () => ({
  MobileActivityIndicator: () => null,
}));
vi.mock("@/components/wallet-control", () => ({
  WalletControl: () => <button>Connect wallet</button>,
}));

import { CollectorShell } from "./collector-shell";

const content = (
  <CollectorShell>
    <main>Collector content</main>
  </CollectorShell>
);
const labels = ["Collector navigation", "Mobile collector navigation"];
let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.publicStatus = undefined;
  state.pathname = "/";
  state.search = "";
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});
const links = (label: string) =>
  [...container.querySelectorAll(`nav[aria-label="${label}"] a`)].map((link) =>
    link.getAttribute("href"),
  );

async function hydrate() {
  const onRecoverableError = vi.fn();
  await act(async () => {
    root = hydrateRoot(container, content, { onRecoverableError });
  });
  expect(onRecoverableError.mock.calls.map(([error]) => String(error))).toEqual(
    [],
  );
}

describe("collector navigation hydration", () => {
  it("hydrates both server navigation bars before applying a cached active-auction read", async () => {
    container.innerHTML = renderToString(content);
    for (const label of labels)
      expect(links(label)).toEqual(["/explore", "/exchange", "/fleet"]);
    state.publicStatus = { observedBlock: 150n };
    await hydrate();
    for (const label of labels)
      expect(links(label)).toEqual([
        "/explore",
        "/auction",
        "/exchange",
        "/fleet",
      ]);
    state.publicStatus = { observedBlock: 200n };
    await act(async () =>
      root!.render(
        <CollectorShell>
          <main>Updated content</main>
        </CollectorShell>,
      ),
    );
    for (const label of labels)
      expect(links(label)).toEqual(["/explore", "/exchange", "/fleet"]);
  });

  it("accepts auction data after hydration while preserving Explore return context", async () => {
    state.pathname = "/fleet/23";
    state.search = "from=explore";
    container.innerHTML = renderToString(content);
    await hydrate();
    state.publicStatus = { observedBlock: 150n };
    await act(async () =>
      root!.render(
        <CollectorShell>
          <main>Updated content</main>
        </CollectorShell>,
      ),
    );
    for (const label of labels) {
      expect(links(label)).toContain("/auction");
      expect(
        container
          .querySelector(`nav[aria-label="${label}"] a[aria-current="page"]`)
          ?.getAttribute("href"),
      ).toBe("/explore");
    }
  });
});
