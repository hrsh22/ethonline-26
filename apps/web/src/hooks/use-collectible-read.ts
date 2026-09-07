"use client";

import { runPublicRead } from "@orbit/protocol/read-lifetime";
import { useQuery } from "@tanstack/react-query";

import { protocolDeploymentFingerprint } from "@/lib/deployment";
import { refetchUntilObservedBlock } from "@/lib/transaction-execution";
import { webProtocolQueryRetryCount } from "@/lib/web-rpc-policy";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

/**
 * Reads one known identity directly from the chain. Collection enumeration is
 * an indexed concern; ownership and action eligibility for a known token ID
 * are not.
 *
 * An identity that has never been drawn resolves as a `not-discovered` result
 * rather than a query error, so the retry policy below applies only to reads
 * that genuinely failed.
 */
export const useCollectibleRead = (
  identityId: number,
  protocol: ProtocolClient,
) =>
  useQuery({
    queryKey: [
      "protocol-collectible",
      protocolDeploymentFingerprint,
      identityId,
      protocol.minimumCollectibleBlock?.toString(),
    ],
    queryFn: ({ signal }) =>
      runPublicRead(
        async (readSignal) => {
          const reader = protocol.readerForSignal(readSignal);
          if (reader === undefined)
            throw new Error("Collectible reader unavailable");
          const minimumBlock = protocol.minimumCollectibleBlock;
          if (minimumBlock === undefined)
            return reader.readCollectible(identityId);
          const observed = await refetchUntilObservedBlock({
            minimumBlock,
            refetch: () => {
              readSignal.throwIfAborted();
              return reader.readCollectible(identityId);
            },
          });
          if (observed.status !== "caught-up")
            throw new Error(
              "Checking identity ownership after the confirmed transaction.",
            );
          return observed.snapshot;
        },
        { signal },
      ),
    // Known-token ownership and metadata are public chain state. Requiring a
    // connected wallet here left shared NFT links permanently loading even
    // though the reader was available; only mutations remain wallet-gated.
    enabled: protocol.deploymentAvailable && protocol.reader !== undefined,
    refetchInterval: (query) =>
      query.state.status === "error" ? 30_000 : false,
    retry: webProtocolQueryRetryCount,
  });
