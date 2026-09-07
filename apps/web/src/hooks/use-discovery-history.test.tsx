/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IndexedHistoryError } from "@orbit/protocol/history";
import { expect, it, vi } from "vitest";
import { protocolDeploymentFingerprint } from "@/lib/deployment";
const fixture = vi.hoisted(() => ({
  error: new Error("offline") as Error | undefined,
  reads: 0,
  pending: true,
}));
vi.mock("@orbit/protocol/history", async (original) => ({
  ...(await original<typeof import("@orbit/protocol/history")>()),
  createIndexedHistoryReaders: () => ({
    protocol: {
      discoveries: async () => {
        fixture.reads += 1;
        if (fixture.error !== undefined) throw fixture.error;
        return { requests: [], coverage: "complete" };
      },
    },
  }),
}));
vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => ({
    address: "0x0000000000000000000000000000000000000001",
    walletRead: {
      status: "loaded",
      snapshot: {
        observedBlock: 99999999n,
        collectibles: { pendingDiscovery: { count: fixture.pending ? 1 : 0 } },
      },
    },
  }),
}));
import { useDiscoveryHistory } from "./use-discovery-history";
function History() {
  const result = useDiscoveryHistory();
  return <span>{result.data === undefined ? "unavailable" : "retained"}</span>;
}
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it.each([
  "history-rpc-unavailable",
  "history-canonicality-check-failed",
  "unknown",
])("retains old facts only for typed RPC unavailability: %s", async (code) => {
  fixture.error =
    code === "unknown"
      ? new Error("proxy failed")
      : new IndexedHistoryError(code, code, 503);
  fixture.reads = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    [
      "collector-discovery-history",
      protocolDeploymentFingerprint,
      "0x0000000000000000000000000000000000000001",
    ],
    { requests: [] },
    { updatedAt: 1 },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <History />
        <History />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(container.textContent).toBe(
    code === "history-rpc-unavailable"
      ? "retainedretained"
      : "unavailableunavailable",
  );
  expect(fixture.reads).toBe(1);
  await act(async () => root.unmount());
  client.clear();
});

it("stops history requests after complete settled evidence", async () => {
  vi.useFakeTimers();
  fixture.error = undefined;
  fixture.pending = false;
  fixture.reads = 0;
  function PollingHistory() {
    useDiscoveryHistory({ poll: true });
    return null;
  }
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PollingHistory />
      </QueryClientProvider>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fixture.reads).toBe(1);
  await act(async () => root.unmount());
  client.clear();
  vi.useRealTimers();
});
