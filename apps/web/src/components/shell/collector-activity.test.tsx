/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ address: "0xabc", operationId: "first" }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    address: state.address,
    chainId: 84532,
    transaction: { status: "submission-unknown" },
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
vi.mock("@/components/collector-help", () => ({ CollectorHelp: () => null }));
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
