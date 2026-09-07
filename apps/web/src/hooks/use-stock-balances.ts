"use client";

import { runPublicRead } from "@orbit/protocol/read-lifetime";
import type { createProtocolReader } from "@orbit/protocol/reader";
import { useQuery } from "@tanstack/react-query";

import { protocolDeploymentFingerprint } from "@/lib/deployment";
import type { CollectorAccessState } from "@/lib/collector-access";
import { refetchUntilObservedBlock } from "@/lib/transaction-execution";
import { webProtocolQueryRetryCount } from "@/lib/web-rpc-policy";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
export type StockBalanceSnapshot = Awaited<
  ReturnType<ReturnType<typeof createProtocolReader>["readStockBalances"]>
>;

export type StockBalancesRead =
  | {
      readonly status: "blocked";
      readonly accessState: Exclude<CollectorAccessState, "ready">;
    }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "loaded";
      readonly snapshot: StockBalanceSnapshot;
      readonly stale: boolean;
    };

/** Mounted only on Rewards; account changes never reuse another wallet's data. */
export function useStockBalances(protocol: ProtocolClient) {
  const address = protocol.address;
  const enabled = protocol.accessState === "ready" && address !== undefined;
  // The provider advances this wallet-scoped receipt floor after a claim (and
  // other confirmed actions). A new floor starts a fresh read automatically.
  const minimumBlock = protocol.minimumCollectibleBlock;
  const query = useQuery({
    queryKey: [
      "protocol-stock-balances",
      protocolDeploymentFingerprint,
      address?.toLowerCase(),
      minimumBlock?.toString(),
    ],
    queryFn: ({ signal }) =>
      runPublicRead(
        async (readSignal) => {
          const reader = protocol.readerForSignal(readSignal);
          if (reader === undefined || address === undefined) {
            throw new Error("Stock balance reader is unavailable");
          }
          const read = () => {
            readSignal.throwIfAborted();
            return reader.readStockBalances(address);
          };
          if (minimumBlock === undefined) return read();
          const result = await refetchUntilObservedBlock({
            minimumBlock,
            refetch: read,
          });
          if (result.status !== "caught-up") {
            throw new Error("Stock balances are still catching up");
          }
          return result.snapshot;
        },
        { signal },
      ),
    enabled,
    retry: webProtocolQueryRetryCount,
  });
  const read: StockBalancesRead =
    protocol.accessState !== "ready"
      ? { status: "blocked", accessState: protocol.accessState }
      : query.data !== undefined
        ? { status: "loaded", snapshot: query.data, stale: query.isError }
        : query.isError
          ? { status: "failed" }
          : { status: "loading" };

  return {
    read,
    refreshing: enabled && query.isFetching,
    refresh: async () => {
      if (enabled) await query.refetch();
    },
  };
}
