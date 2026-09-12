/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queryRefresh: vi.fn().mockResolvedValue(undefined),
  protocolRefresh: vi.fn().mockResolvedValue(undefined),
  deliveryRefresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: state.queryRefresh }),
}));
vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({
    state: "unknown",
    refresh: state.deliveryRefresh,
  }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    health: undefined,
    healthError: null,
    healthRefreshing: false,
    walletRead: { status: "blocked" },
    refresh: state.protocolRefresh,
  }),
}));
import { RewardProgressPanel } from "./reward-progress-panel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("refreshes processing evidence with the visible reward view and stops after unmount", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<RewardProgressPanel />));
  try {
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(state.queryRefresh).toHaveBeenCalledWith(
      { queryKey: ["delivery-status"], type: "active" },
      { cancelRefetch: false },
    );
    const calls = state.queryRefresh.mock.calls.length;
    visibility.mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(state.queryRefresh).toHaveBeenCalledTimes(calls);
  } finally {
    await act(async () => root.unmount());
  }
  state.queryRefresh.mockClear();
  visibility.mockReturnValue("visible");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(state.queryRefresh).not.toHaveBeenCalled();
});

it("refreshes both processing status and onchain progress when requested", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<RewardProgressPanel />));
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Refresh reward progress")
        ?.click(),
    );
    expect(state.protocolRefresh).toHaveBeenCalledOnce();
    expect(state.deliveryRefresh).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
