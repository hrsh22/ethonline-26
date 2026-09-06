"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createIndexedHistoryReaders,
  IndexedHistoryError,
} from "@orbit/protocol/history";
import { PUBLIC_API_PATHS } from "@orbit/config/public-api";
import {
  protocolDeploymentFingerprint,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { publicApiUrl } from "@/lib/public-api";
import { useProtocolClient } from "@/providers/protocol-client-provider";

/** One bounded HTTP history page shared across collector surfaces; no chain RPC. */
export function useDiscoveryHistory({
  poll = false,
}: { readonly poll?: boolean } = {}) {
  const protocol = useProtocolClient();
  const address = protocol.address;
  const manifest = protocolDeploymentManifest;
  const wallet = protocol.walletRead;
  const throughBlock =
    wallet.status === "loaded" ? wallet.snapshot.observedBlock : undefined;
  const pending =
    wallet.status === "loaded" &&
    wallet.snapshot.collectibles.pendingDiscovery.count > 0;
  const query = useQuery({
    queryKey: [
      "collector-discovery-history",
      protocolDeploymentFingerprint,
      address?.toLowerCase(),
    ],
    enabled:
      address !== undefined &&
      manifest !== undefined &&
      throughBlock !== undefined,
    queryFn: async ({ signal }) => {
      if (
        manifest === undefined ||
        address === undefined ||
        throughBlock === undefined
      )
        throw new Error("Discovery history scope unavailable");
      const history = createIndexedHistoryReaders({
        manifest,
        identity,
        basePath: publicApiUrl(PUBLIC_API_PATHS.history.root),
        fetcher: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          }),
      });
      return history.protocol.discoveries(
        address,
        BigInt(manifest.launch.blockNumber),
        throughBlock,
      );
    },
    staleTime: 15_000,
    refetchInterval: poll
      ? (query) =>
          pending || needsDiscoveryRecovery(query.state.data, query.state.error)
            ? 15_000
            : false
      : false,
    retry: false,
  });
  const { refetch, isEnabled } = query;
  const confirmationHash = confirmedHash(protocol.transaction);
  useEffect(() => {
    if (poll && isEnabled) void refetch({ cancelRefetch: false });
    // Wallet observation changes alone are not a new acquisition. Refresh on a
    // confirmed action or synchronization transition; active history has its timer.
  }, [
    poll,
    address,
    pending,
    protocol.walletSynchronizing,
    confirmationHash,
    isEnabled,
    refetch,
  ]);
  return { ...query, data: visibleDiscoveryHistory(query) };
}

function visibleDiscoveryHistory<T>(query: {
  readonly data: T;
  readonly isError: boolean;
  readonly error: Error | null;
}): T | undefined {
  if (!query.isError) return query.data;
  return query.error instanceof IndexedHistoryError &&
    query.error.code === "history-rpc-unavailable"
    ? query.data
    : undefined;
}

const confirmedHash = (
  transaction: ReturnType<typeof useProtocolClient>["transaction"],
) => (transaction?.status === "confirmed" ? transaction.hash : undefined);
const needsDiscoveryRecovery = (
  data:
    | {
        readonly requests: readonly { readonly outcome: string }[];
        readonly coverage?: string;
      }
    | undefined,
  error: Error | null,
) =>
  error !== null ||
  data?.coverage === "partial" ||
  data?.requests.some((request) => request.outcome === "pending");
