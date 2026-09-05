"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePublicClient, useSignMessage } from "wagmi";

import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";
import { normalizeProtocolError } from "@orbit/protocol/errors";

import { identity } from "@/lib/identity";
import {
  readTestnetFundingChallenge,
  readTestnetFundingStatus,
  requestTestnetFunding,
  type TestnetFundingSource,
} from "@/lib/testnet-funding-client";
import { createTestnetFundingView } from "@/lib/testnet-funding-view";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

class FundingSignatureRejectedError extends Error {}

export const useTestnetFundingStatus = (protocol: ProtocolClient) => {
  const ready = protocol.accessState === "ready";
  const address = protocol.address;
  const query = useQuery({
    queryKey: ["testnet-funding-status", address],
    queryFn: () => readTestnetFundingStatus(address!),
    enabled: ready && address !== undefined,
    refetchInterval: false,
    retry: false,
  });
  const response = query.isError ? undefined : query.data;
  return {
    failed: query.isError,
    pending: query.isPending,
    refresh: query.refetch,
    response,
  } as const;
};

const mutationResponseForAddress = (
  address: ProtocolClient["address"],
  mutationAddress: ProtocolClient["address"],
  response: TestnetFundingResponse | undefined,
): TestnetFundingResponse | undefined => {
  if (address === undefined || mutationAddress === undefined) return undefined;
  if (mutationAddress.toLowerCase() !== address.toLowerCase()) return undefined;
  const responseAddress = response?.recipient?.address;
  if (responseAddress === undefined) return response;
  return responseAddress.toLowerCase() === address.toLowerCase()
    ? response
    : undefined;
};

const mutationMatchesAddress = (
  address: ProtocolClient["address"],
  mutationAddress: ProtocolClient["address"],
): boolean =>
  address !== undefined &&
  mutationAddress !== undefined &&
  mutationAddress.toLowerCase() === address.toLowerCase();

export const useTestnetFunding = (
  protocol: ProtocolClient,
  source: TestnetFundingSource,
) => {
  const address = protocol.address;
  const fundingStatus = useTestnetFundingStatus(protocol);
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const fundWallet = useMutation({
    mutationFn: async (recipient: NonNullable<typeof address>) => {
      // Prove control of the recipient wallet before any inventory moves.
      const message = await readTestnetFundingChallenge(recipient);
      const signature = await signMessageAsync({ message }).catch(
        (cause: unknown) => {
          if (
            normalizeProtocolError(cause, identity).code === "wallet-rejected"
          ) {
            throw new FundingSignatureRejectedError();
          }
          throw cause;
        },
      );
      return requestTestnetFunding(recipient, source, { message, signature });
    },
    onSuccess: async () => {
      // The grant has confirmed. Refresh direct balances at or beyond this
      // block; permanent holdings may still await indexed evidence and expose
      // the existing explicit retry if bounded catch-up does not finish.
      const fundedThroughBlock = await publicClient
        ?.getBlockNumber()
        .catch(() => undefined);
      await Promise.all([
        fundingStatus.refresh(),
        protocol.refreshWallet(fundedThroughBlock),
      ]);
    },
  });
  const previousAddress = useRef(address);
  useEffect(() => {
    if (previousAddress.current === address) return;
    previousAddress.current = address;
    fundWallet.reset();
  }, [address, fundWallet]);

  const mutationResponse = mutationResponseForAddress(
    address,
    fundWallet.variables,
    fundWallet.data,
  );
  const mutationCurrent = mutationMatchesAddress(address, fundWallet.variables);
  const response = mutationResponse ?? fundingStatus.response;
  const view = createTestnetFundingView({
    accessState: protocol.accessState,
    hasMutationResponse: mutationResponse !== undefined,
    mutationFailure:
      mutationCurrent && fundWallet.isError
        ? fundWallet.error instanceof FundingSignatureRejectedError
          ? "signature-rejected"
          : "retryable"
        : undefined,
    mutationPending: mutationCurrent && fundWallet.isPending,
    queryFailed: fundingStatus.failed,
    queryPending: fundingStatus.pending,
    response,
  });
  const fund = (): void => {
    if (address !== undefined) fundWallet.mutate(address);
  };
  const retry = (): void => {
    if (view.action === "retry-funding") {
      fund();
      return;
    }
    void fundingStatus.refresh();
  };

  return {
    fund,
    response,
    retry,
    statusResponse: fundingStatus.response,
    view,
  } as const;
};
