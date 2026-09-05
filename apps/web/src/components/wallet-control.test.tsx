import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const walletState = vi.hoisted(() => ({
  connection: {
    status: "disconnected" as
      "connected" | "connecting" | "disconnected" | "reconnecting",
    address: "0x0000000000000000000000000000000000004444",
    chainId: 84_532,
  },
  switchChain: {
    isError: false,
    isPending: false,
    mutate: vi.fn(),
  },
}));

vi.mock("@reown/appkit/react", () => ({
  modal: { open: vi.fn() },
}));

vi.mock("@/lib/wagmi", () => ({
  isReownConfigured: true,
  protocolChain: { id: 84_532 },
}));

vi.mock("wagmi", () => ({
  useConnection: () => walletState.connection,
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => walletState.switchChain,
}));

import { WalletControl } from "./wallet-control";

describe("wallet control", () => {
  beforeEach(() => {
    walletState.connection = {
      status: "disconnected",
      address: "0x0000000000000000000000000000000000004444",
      chainId: 84_532,
    };
    walletState.switchChain.isError = false;
    walletState.switchChain.isPending = false;
    walletState.switchChain.mutate.mockReset();
  });

  it("offers the Reown modal when no wallet is connected", () => {
    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain("Connect wallet");
    expect(html).toContain('data-wallet-state="disconnected"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  });

  it.each([
    ["connecting", "Connecting wallet"],
    ["reconnecting", "Restoring wallet"],
  ] as const)("explains the disabled %s state", (status, label) => {
    walletState.connection = { ...walletState.connection, status };

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain('data-wallet-state="connecting"');
    expect(html).toContain(label);
    const reasonId =
      /aria-describedby="(?<id>wallet-connection-reason-[^"]+)"/u.exec(html)
        ?.groups?.id;
    expect(reasonId).toBeDefined();
    expect(html).toContain(`id="${reasonId}"`);
    expect(html).toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  });

  it("uses inverse semantics for disabled reasons on a dark surface", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connecting",
    };

    const html = renderToStaticMarkup(<WalletControl surface="inverse" />);

    expect(html).toMatch(
      /class="[^"]*disabled-reason[^"]*"[^>]*data-surface="inverse"/u,
    );
  });

  it("uses a contrast-safe filled network action on a dark surface", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connected",
      chainId: 1,
    };

    const html = renderToStaticMarkup(<WalletControl surface="inverse" />);
    const buttonClass = /<button[^>]*class="(?<className>[^"]+)"/u.exec(html)
      ?.groups?.className;

    expect(buttonClass).toContain("bg-primary");
    expect(buttonClass).toContain("text-primary-foreground");
    expect(buttonClass).not.toContain("bg-background");
  });

  it("scopes disabled reasons when two wallet controls share a page", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connecting",
    };

    const html = renderToStaticMarkup(
      <>
        <WalletControl />
        <WalletControl />
      </>,
    );
    const reasonIds = [
      ...html.matchAll(/aria-describedby="(?<id>[^"]+)"/gu),
    ].map((match) => match.groups?.id ?? "");

    expect(reasonIds).toHaveLength(2);
    expect(new Set(reasonIds).size).toBe(2);
    for (const reasonId of reasonIds) {
      expect(html).toContain(`id="${reasonId}"`);
    }
  });

  it("shows the connected Base Sepolia account without reopening the modal", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connected",
    };

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain("0x0000…4444");
    expect(html).toContain("Disconnect");
    expect(html).toContain('data-wallet-state="connected"');
    expect(html).not.toContain("Connect wallet");
  });

  it("offers a network switch for a connected account on another chain", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connected",
      chainId: 1,
    };

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain("Switch to Base Sepolia");
    expect(html).toContain('data-wallet-state="wrong-network"');
    expect(html).not.toContain("0x0000…4444");
  });

  it("announces a pending network switch and explains why the control is disabled", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connected",
      chainId: 1,
    };
    walletState.switchChain.isPending = true;

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain('data-wallet-state="switching"');
    expect(html).toContain("Switching network");
    const reasonId =
      /aria-describedby="(?<id>wallet-network-reason-[^"]+)"/u.exec(html)
        ?.groups?.id;
    expect(reasonId).toBeDefined();
    expect(html).toContain(`id="${reasonId}"`);
    expect(html).toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  });

  it("turns a rejected network request into safe, actionable feedback", () => {
    walletState.connection = {
      ...walletState.connection,
      status: "connected",
      chainId: 1,
    };
    walletState.switchChain.isError = true;

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain('data-wallet-state="rejected"');
    expect(html).toContain("Network switch was not approved");
    expect(html).toContain("Switch to Base Sepolia");
    expect(html).not.toContain("Error:");
  });
});
