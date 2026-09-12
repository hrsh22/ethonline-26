/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionState } from "@/lib/transaction-state";
const state = vi.hoisted(() => ({
  address: "0xabc",
  operationId: "first",
  transaction: { status: "submission-unknown" } as TransactionState,
  pending: undefined as number | undefined,
  reference: undefined as string | undefined,
  isApproval: false,
  resumeApproval: vi.fn(),
}));
beforeEach(() => {
  state.pending = undefined;
  state.reference = undefined;
  state.isApproval = false;
  state.resumeApproval.mockReset();
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
    transactionMetadata: {
      operationId: state.operationId,
      isApproval: state.isApproval,
    },
    resumeApproval: state.resumeApproval,
    walletRead:
      state.pending === undefined
        ? { status: "unavailable" }
        : {
            status: "loaded",
            snapshot: {
              collectibles: { pendingDiscovery: { count: state.pending } },
            },
          },
    completedTransactions: [{}],
    clearTransaction: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-discovery-history", () => ({
  useDiscoveryHistory: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-discovery-reference", () => ({
  useDiscoveryReference: () => state.reference,
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
it("lets an interrupted approval continue without requiring manual wallet investigation", async () => {
  state.isApproval = true;
  state.transaction = {
    status: "submission-unknown",
    label: "Approve WETH for exchange",
    message: "Checking your approval on Base Sepolia…",
  };
  state.resumeApproval.mockResolvedValue(undefined);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorActivity />));
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).not.toContain(
      "Transaction hash from your wallet",
    );
    const resume = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue trade",
    );
    expect(resume).toBeDefined();
    await act(async () => resume?.click());
    expect(state.resumeApproval).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
it("requires a new wallet-activity acknowledgement after wallet or operation change", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<CollectorActivity />));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Recovery options")
      ?.click(),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>("input")?.click(),
  );
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Return to review",
    )?.disabled,
  ).toBe(false);
  state.address = "0xdef";
  state.operationId = "second";
  await act(async () => root.render(<CollectorActivity />));
  expect(container.querySelector<HTMLInputElement>("input")?.checked).toBe(
    false,
  );
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Return to review",
    )?.disabled,
  ).toBe(true);
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

it("keeps completed transactions out of the page-level activity banner", async () => {
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
    expect(container.querySelector("#collector-activity")).toBeNull();
    expect(container.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps recovery support visible for unresolved wallet activity", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorActivity />));
    expect(container.textContent).toContain("Help and transaction details");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Help and transaction details")
        ?.click(),
    );
    expect(container.textContent).toContain("Help with this wallet action");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Recovery options")
        ?.click(),
    );
    expect(container.textContent).toContain("I checked my wallet activity");
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not revive the banner for saved completions or a resolved discovery reference", async () => {
  state.transaction = { status: "idle" };
  state.pending = 0;
  state.reference = "past-discovery";
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CollectorActivity />));
    expect(container.textContent).toBe("");
    state.pending = 1;
    await act(async () => root.render(<CollectorActivity />));
    expect(container.textContent).toContain("1 pending Discovery");
    expect(container.querySelector("#collector-activity")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([undefined, 1])(
  "keeps opaque discovery references out of the collector banner (pending: %s)",
  async (pending) => {
    state.transaction = { status: "idle" };
    state.pending = pending;
    state.reference =
      "46834239977972864594047143698670340896121247577665040514495954683581162304911";
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<CollectorActivity />));
      expect(container.textContent).not.toContain(state.reference);
      if (pending === undefined) {
        expect(container.querySelector("#collector-activity")).toBeNull();
      } else {
        expect(container.querySelector('a[href="/fleet"]')).not.toBeNull();
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);
