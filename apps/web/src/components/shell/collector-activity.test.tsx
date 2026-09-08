/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionState } from "@/lib/transaction-state";
const state = vi.hoisted(() => ({
  address: "0xabc",
  operationId: "first",
  transaction: { status: "submission-unknown" } as TransactionState,
}));
beforeEach(() => {
  state.transaction = {
    status: "submission-unknown",
    label: "Claim rewards",
    message: "Check the wallet for this attempt.",
  };
});
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    address: state.address,
    chainId: 84532,
    transaction: state.transaction,
    transactionMetadata: { operationId: state.operationId },
    walletRead: { status: "unavailable" },
    clearTransaction: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-discovery-history", () => ({
  useDiscoveryHistory: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-discovery-reference", () => ({
  useDiscoveryReference: () => undefined,
}));
vi.mock("@/components/collector-help", () => ({
  CollectorHelp: () => <div>Help with this wallet action</div>,
}));
vi.mock("@/components/transaction-status", () => ({
  TransactionStatus: () => null,
}));
import { CollectorActivity } from "./collector-activity";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("requires a new wallet-activity acknowledgement after wallet or operation change", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<CollectorActivity />));
  await act(async () =>
    container.querySelector<HTMLInputElement>("input")?.click(),
  );
  expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
    false,
  );
  state.address = "0xdef";
  state.operationId = "second";
  await act(async () => root.render(<CollectorActivity />));
  expect(container.querySelector<HTMLInputElement>("input")?.checked).toBe(
    false,
  );
  expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
    true,
  );
  await act(async () => root.unmount());
});

it("verifies a supplied hash without clearing the attempt and keeps errors visible", async () => {
  const { RecoverKnownTransaction } = await import("./collector-activity");
  const recover = vi
    .fn<(hash: string) => Promise<void>>()
    .mockRejectedValue(
      new Error(
        "This transaction does not match the exact call saved for this attempt.",
      ),
    );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<RecoverKnownTransaction onRecover={recover} />),
    );
    const input = container.querySelector("input")!;
    const hash = `0x${"12".repeat(32)}`;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, hash);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(recover).toHaveBeenCalledWith(hash);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "does not match the exact call",
    );
    expect(container.textContent).toContain("never sends another transaction");
    expect(input.value).toBe(hash);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps successful confirmation visible without presenting recovery support", async () => {
  state.transaction = {
    status: "confirmed",
    label: "Claim eligible rewards",
    hash: `0x${"12".repeat(32)}`,
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorActivity />));
    expect(container.textContent).not.toContain("Help with this wallet action");
    expect(container.textContent).toContain("Dismiss completed activity");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps recovery support visible for unresolved wallet activity", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorActivity />));
    expect(container.textContent).toContain("Help with this wallet action");
    expect(container.textContent).toContain("I checked my wallet activity");
  } finally {
    await act(async () => root.unmount());
  }
});
