import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ConnectionStatus =
  "connected" | "connecting" | "disconnected" | "reconnecting";

const shellState = vi.hoisted(() => ({
  configured: true,
  connection: {
    address: "0x0000000000000000000000000000000000004444",
    chainId: 84_532,
    status: "disconnected" as ConnectionStatus,
  },
  pathname: "/exchange",
  switchChain: { isError: false, isPending: false, mutate: vi.fn() },
}));

// The live readout needs the protocol provider; the shell tests exercise
// navigation and wallet states, not protocol reads.
// Activity has its own provider and browser journeys; these checks isolate shell navigation.
vi.mock("@/components/shell/collector-activity", () => ({
  CollectorActivity: () => null,
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({ transaction: { status: "idle" } }),
}));
vi.mock("@/components/shell/live-pulse", () => ({ LivePulse: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => shellState.pathname,
}));

vi.mock("@reown/appkit/react", () => ({ modal: { open: vi.fn() } }));

vi.mock("@/lib/wagmi", () => ({
  get isReownConfigured() {
    return shellState.configured;
  },
  protocolChain: { id: 84_532 },
}));

vi.mock("wagmi", () => ({
  useConnection: () => shellState.connection,
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => shellState.switchChain,
}));

import { CollectorShell } from "./shell/collector-shell";

const renderShell = () =>
  renderToStaticMarkup(
    <CollectorShell>
      <main>Collector content</main>
    </CollectorShell>,
  );

const walletState = (html: string): string | undefined =>
  /data-wallet-state="([a-z-]+)"/u.exec(html)?.[1];

describe("collector shell wallet states", () => {
  beforeEach(() => {
    shellState.configured = true;
    shellState.connection = {
      address: "0x0000000000000000000000000000000000004444",
      chainId: 84_532,
      status: "disconnected",
    };
    shellState.pathname = "/exchange";
    shellState.switchChain.isError = false;
    shellState.switchChain.isPending = false;
  });

  it("offers a connect action while disconnected", () => {
    const html = renderShell();
    expect(walletState(html)).toBe("disconnected");
    expect(html).toContain("Connect wallet");
  });

  it("lets an unconfigured wallet notice shrink without collapsing the menu target", () => {
    shellState.configured = false;

    const html = renderShell();

    expect(html).toContain(
      "Wallet connection is not configured for this deployment.",
    );
    expect(html).toMatch(/class="wallet-session wallet-control-state[^"]*"/u);
    expect(html).toMatch(/class="flex min-w-0 items-center gap-2[^"]*"/u);
    const toggleClasses =
      /<button[^>]*aria-controls="collector-navigation"[^>]*class="(?<classes>[^"]+)"/u.exec(
        html,
      )?.groups?.classes;
    expect(toggleClasses).toContain("shrink-0");
  });

  it("reports an in-progress connection without a second notice", () => {
    shellState.connection.status = "connecting";
    const html = renderShell();
    expect(walletState(html)).toBe("connecting");
    expect(html).toContain("Connecting wallet");
    // The header owns the wallet notice; the shell must not repeat it.
    expect(html.match(/data-wallet-state=/gu)).toHaveLength(1);
  });

  it("reports a restoring connection distinctly from a fresh one", () => {
    shellState.connection.status = "reconnecting";
    const html = renderShell();
    expect(walletState(html)).toBe("connecting");
    expect(html).toContain("Restoring wallet");
  });

  it("asks for the protocol network when the wallet is on another chain", () => {
    shellState.connection = {
      address: "0x0000000000000000000000000000000000004444",
      chainId: 1,
      status: "connected",
    };
    const html = renderShell();
    expect(walletState(html)).toBe("wrong-network");
    expect(html).toContain("Switch to");
  });

  it("marks a pending network switch instead of offering it again", () => {
    shellState.connection = {
      address: "0x0000000000000000000000000000000000004444",
      chainId: 1,
      status: "connected",
    };
    shellState.switchChain.isPending = true;
    const html = renderShell();
    expect(walletState(html)).toBe("switching");
    expect(html).toContain("Switching network");
    expect(html).toContain("disabled");
  });

  it("shows the connected wallet without pushing navigation aside", () => {
    shellState.connection = {
      address: "0x0000000000000000000000000000000000004444",
      chainId: 84_532,
      status: "connected",
    };
    const html = renderShell();
    expect(walletState(html)).toBe("connected");
    expect(html).toContain("Disconnect");
    const navigationIndex = html.indexOf('id="collector-navigation"');
    const walletIndex = html.indexOf("data-wallet-state=");
    expect(navigationIndex).toBeGreaterThan(-1);
    expect(navigationIndex).toBeLessThan(walletIndex);
  });

  it("keeps the menu toggle available in every wallet state", () => {
    for (const status of [
      "disconnected",
      "connecting",
      "reconnecting",
      "connected",
    ] as const) {
      shellState.connection = {
        address: "0x0000000000000000000000000000000000004444",
        chainId: 84_532,
        status,
      };
      expect(renderShell()).toContain('aria-controls="collector-navigation"');
    }
  });
});
