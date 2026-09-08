import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ pathname: "/" }));

// Activity has its own provider and browser journeys; these checks isolate shell navigation.
vi.mock("@/components/shell/collector-activity", () => ({
  CollectorActivity: () => null,
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

import { AdminShell } from "./admin/admin-shell";
import { CollectorShell } from "./shell/collector-shell";

const adminSession = {
  address: "0x1111111111111111111111111111111111111111" as const,
  chainId: 84_532 as const,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}` as const,
  expiresAt: "2026-09-05T05:15:00.000Z",
  issuedAt: "2026-09-05T05:00:00.000Z",
  observedBlock: {
    hash: `0x${"a".repeat(64)}` as const,
    number: "31000000",
  },
  roles: ["keeper"] as const,
};

describe("application route shells", () => {
  beforeEach(() => {
    routeState.pathname = "/";
  });

  it("renders the compact collector header without promoting admin controls", () => {
    routeState.pathname = "/exchange";

    const html = renderToStaticMarkup(
      <CollectorShell>
        <main>Collector content</main>
      </CollectorShell>,
    );

    expect(html).toContain('aria-label="Collector navigation"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Explore");
    expect(html).toContain("Trade");
    expect(html).toContain("My Fleet");
    expect(html).toContain("Protocol status");
    expect(html).toContain("No-value test assets.");
    expect(html).toContain("BASE SEPOLIA");
    expect(html).toContain("Testnet · no value");
    expect(html).toContain("data-collector-wallet-actions");
    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain("Live at block");
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain(">Admin<");
  });

  it("renders a separate operator context with a collector escape route", () => {
    routeState.pathname = "/admin";

    const html = renderToStaticMarkup(
      <AdminShell session={adminSession}>
        <main>Operator content</main>
      </AdminShell>,
    );

    expect(html).toContain('aria-label="Admin navigation"');
    expect(html).toContain("Operator console");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Operations");
    expect(html).toContain('href="/admin/diagnostics"');
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Public protocol status");
    expect(html).toContain("Collector app");
    expect(html).not.toContain('aria-label="Collector navigation"');
  });

  it("houses the brand lockup, both navigation groups and the session in the console rail", () => {
    routeState.pathname = "/admin";

    const html = renderToStaticMarkup(
      <AdminShell session={adminSession}>
        <main>Operator content</main>
      </AdminShell>,
    );

    // The rail is the shell's <header>, as it is in the collector.
    const rail =
      /<header[^>]*>(?<rail>[\s\S]*?)<\/header>/u.exec(html)?.groups?.rail ??
      "";
    expect(rail).toContain("Operator console");
    expect(rail).toContain('aria-label="Admin navigation"');
    expect(rail).toContain('aria-label="Leave admin navigation"');
    expect(rail).toContain("Operations");
    expect(rail).toContain("Diagnostics");
    // Who is operating, under which roles, and until when: the facts every
    // console action is taken under sit with the wallet that ends the session.
    expect(rail).toContain("keeper");
    expect(rail).toContain(`dateTime="${adminSession.expiresAt}"`);
    expect(rail).toContain("Test wallet");
    expect(html.match(/Test wallet/gu)).toHaveLength(1);
  });
});
