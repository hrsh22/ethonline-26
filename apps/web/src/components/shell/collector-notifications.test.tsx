/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompletedCollectorTransaction } from "@/lib/collector-transaction-record";
import type { TransactionState } from "@/lib/transaction-state";

const state = vi.hoisted(() => ({
  pathname: "/fleet",
  address: "0xabc",
  transaction: { status: "idle" } as TransactionState,
  records: [] as CompletedCollectorTransaction[],
  clear: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    address: state.address,
    chainId: 84532,
    transaction: state.transaction,
    completedTransactions: state.records,
    clearTransaction: state.clear,
    markCompletedTransactionsRead: state.markRead,
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/shell/collector-activity", () => ({
  WalletTransactionActivity: () => <p>Current confirmation details</p>,
}));
import { CollectorNotifications } from "./collector-notifications";

const completed: CompletedCollectorTransaction = {
  version: 1,
  operationId: "claim-42",
  actionType: "claim-rewards",
  identityIds: [42],
  affectedIdentityIds: [42],
  createdAt: 1_700_000_000_000,
  savedAt: 1_700_000_001_000,
  phase: { kind: "action" },
  state: {
    status: "confirmed",
    label: "Claim eligible rewards",
    hash: `0x${"12".repeat(32)}`,
  },
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.pathname = "/fleet";
  state.address = "0xabc";
  state.transaction = { status: "idle" };
  state.records = [completed];
  state.clear.mockReset();
  state.markRead.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = () => act(async () => root.render(<CollectorNotifications />));
const open = () =>
  act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );

it("shows saved activity in an anchored popover and marks it read", async () => {
  await render();
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Notifications (1 unread)",
  );
  expect(document.body.textContent).not.toContain("Claim eligible rewards");
  await open();
  const popover = document.querySelector('[data-slot="popover-content"]');
  expect(popover?.textContent).toContain("Claim eligible rewards · confirmed");
  expect(popover?.querySelector('a[href="/fleet/42"]')).not.toBeNull();
  expect(
    popover?.querySelector(
      `a[href="https://sepolia.basescan.org/tx/${completed.state.hash}"]`,
    ),
  ).not.toBeNull();
  expect(state.markRead).toHaveBeenCalledTimes(1);
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Notifications",
  );
  await open();
  expect(state.clear).not.toHaveBeenCalled();
});

it("closes on route or wallet change without carrying another wallet's records", async () => {
  await render();
  await open();
  state.pathname = "/exchange";
  await render();
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  await open();
  expect(document.body.textContent).toContain("Claim eligible rewards");
  state.address = "0xdef";
  state.records = [];
  await render();
  expect(document.body.textContent).not.toContain("Claim eligible rewards");
  await open();
  expect(document.body.textContent).toContain("No new notifications");
});

it("shows a confirmation toast with approval consequences and deduplicates the saved record", async () => {
  state.transaction = {
    ...completed.state,
    message: "Approval confirmed; no exchange was submitted.",
  };
  await render();
  expect(
    document.querySelector('[aria-label="Transaction complete"]')?.textContent,
  ).toContain("no exchange was submitted");
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Notifications (1 unread)",
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Dismiss completed activity"]',
      )!
      .click(),
  );
  expect(state.clear).toHaveBeenCalledTimes(1);
  expect(state.records).toHaveLength(1);
  await open();
  expect(
    document.querySelector('[aria-label="Transaction complete"]'),
  ).toBeNull();
  expect(document.body.textContent).toContain("Current confirmation details");
  expect(document.querySelector('[aria-label="New notifications"]')).toBeNull();
});

it("clears a confirmation that arrives while the notifications panel is open", async () => {
  state.records = [];
  state.transaction = {
    status: "outcome-unknown",
    label: completed.state.label,
    hash: completed.state.hash,
    message: "Checking the submitted transaction automatically.",
  };
  state.markRead.mockImplementation(() => {
    state.records = [];
  });
  state.clear.mockImplementation(() => {
    state.transaction = { status: "idle" };
  });
  await render();
  await open();
  expect(document.body.textContent).toContain("No new notifications");

  state.transaction = completed.state;
  state.records = [completed];
  await render();
  expect(document.body.textContent).toContain("Current confirmation details");
  await open();
  expect(state.clear).toHaveBeenCalledTimes(1);
  expect(state.records).toEqual([]);

  // A new menu instance must not recover the confirmation after closing it.
  state.pathname = "/exchange";
  await render();
  await open();
  expect(document.body.textContent).toContain("No new notifications");
  expect(document.body.textContent).not.toContain(
    "Current confirmation details",
  );
  expect(document.querySelector('[aria-label="New notifications"]')).toBeNull();
});
