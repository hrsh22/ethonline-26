"use client";

import { runPublicRead } from "@orbit/protocol/read-lifetime";
import { useQuery } from "@tanstack/react-query";

import type { useProtocolClient } from "@/providers/protocol-client-provider";
import { webProtocolQueryRetryCount } from "@/lib/web-rpc-policy";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

export interface RewardTrackQuoteState {
  readonly quote:
    | {
        readonly quotedOutput: bigint;
        readonly minimumOutput: bigint;
        readonly minimumOutputBps: number;
        readonly quoteBlock: bigint;
      }
    | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

/**
 * Quotes a reward track's sealed conversion route through the same reader
 * helper and slippage policy the automated runner uses, so the console's
 * protected minimum matches what the operator would submit.
 */
export const useRewardTrackQuote = (
  protocol: ProtocolClient,
  track: 1 | 2 | 3 | 4,
  wethInput: bigint | undefined,
): RewardTrackQuoteState => {
  const query = useQuery({
    // Keyed by what the operator asked for, not by the observed block. Focus,
    // reconnect, and explicit refresh can update the same cached quote without
    // blanking it mid-read; transaction preparation re-validates its age.
    queryKey: ["reward-track-quote", track, wethInput?.toString()],
    queryFn: async ({ signal }) =>
      runPublicRead(
        async (readSignal) => {
          const reader = protocol.readerForSignal(readSignal);
          if (reader === undefined || wethInput === undefined) {
            throw new Error("The reward track route cannot be quoted yet");
          }
          const quote = await reader.quoteRewardTrack(track, wethInput);
          return {
            quotedOutput: quote.quotedOutput,
            minimumOutput: quote.minimumOutput,
            minimumOutputBps: quote.minimumOutputBps,
            quoteBlock: quote.observedBlock,
          };
        },
        { signal },
      ),
    enabled:
      protocol.reader !== undefined &&
      wethInput !== undefined &&
      wethInput > 0n,
    retry: webProtocolQueryRetryCount,
    refetchInterval: (query) =>
      query.state.status === "error" ? 30_000 : false,
    staleTime: 15_000,
  });
  return {
    quote: query.data,
    failed: query.error !== null,
    loading: query.isFetching && query.data === undefined,
    refresh: async () => {
      await query.refetch();
    },
  };
};
