"use client";

import { useQuery } from "@tanstack/react-query";

import { protocolDeploymentManifest } from "@/lib/deployment";
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
      protocolDeploymentManifest?.launch.transactionHash,
      identityId,
    ],
    queryFn: () => {
      if (protocol.reader === undefined) {
        throw new Error("Collectible reader unavailable");
      }
      return protocol.reader.readCollectible(identityId);
    },
    // Known-token ownership and metadata are public chain state. Requiring a
    // connected wallet here left shared NFT links permanently loading even
    // though the reader was available; only mutations remain wallet-gated.
    enabled: protocol.deploymentAvailable && protocol.reader !== undefined,
    refetchInterval: false,
    retry: webProtocolQueryRetryCount,
  });
