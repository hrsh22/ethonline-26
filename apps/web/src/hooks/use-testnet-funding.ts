"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePublicClient, useSignMessage } from "wagmi";

import type { TestnetFundingResponse } from "@orbit/config/testnet-funding";
import { normalizeProtocolError } from "@orbit/protocol/errors";

import {
  protocolDeploymentFingerprint,
  protocolDeploymentManifest,
} from "@/lib/deployment";
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

const fundingQueryKey = (address: ProtocolClient["address"]) =>
  [
    "testnet-funding-status",
    address?.toLowerCase(),
    protocolDeploymentFingerprint,
  ] as const;

const withFundingPolicy = (
  previous: TestnetFundingResponse,
  next: TestnetFundingResponse,
): TestnetFundingResponse =>
  next.service === undefined && previous.service !== undefined
    ? { ...next, service: previous.service }
    : next;

const newerFundingResponse = (
  previous: TestnetFundingResponse | undefined,
  next: TestnetFundingResponse,
): TestnetFundingResponse => {
  if (previous === undefined) return next;
  if (
    previous.observedAt !== undefined &&
    next.observedAt !== undefined &&
    previous.observedAt > next.observedAt
  )
    return previous;
  const priorRequest = previous.request;
  const nextRequest = next.request;
  if (
    priorRequest !== undefined &&
    nextRequest !== undefined &&
    priorRequest.id === nextRequest.id &&
    ["funded", "failed"].includes(priorRequest.state) &&
    ["pending", "retryable"].includes(nextRequest.state)
  )
    return previous;
  // Grant responses omit service policy; keep the last observed rules visible
  // until a fresh status response replaces them for this wallet-scoped query.
  return withFundingPolicy(previous, next);
};

const validateFundingScope = (
  response: TestnetFundingResponse,
  address: NonNullable<ProtocolClient["address"]>,
) => {
  if (
    response.service !== undefined &&
    protocolDeploymentManifest !== undefined &&
    response.service.chainId !== protocolDeploymentManifest.chainId
  )
    throw new Error("Funding status belongs to another chain");
  if (
    response.recipient !== undefined &&
    response.recipient.address.toLowerCase() !== address.toLowerCase()
  )
    throw new Error("Funding status belongs to another wallet");
};
const unavailableFundingResponse = (response: TestnetFundingResponse) =>
  response.recipient === undefined &&
  response.request === undefined &&
  ["funding-unavailable", "funding-rpc-unavailable"].includes(
    response.error?.code ?? "",
  );
const fundingMutationFailure = (
  current: boolean,
  failed: boolean,
  resolved: boolean,
  error: Error | null,
): "signature-rejected" | "retryable" | undefined => {
  if (!current || !failed || resolved) return undefined;
  return error instanceof FundingSignatureRejectedError
    ? "signature-rejected"
    : "retryable";
};

export const useTestnetFundingStatus = (protocol: ProtocolClient) => {
  const ready = protocol.accessState === "ready";
  const address = protocol.address;
  const queryClient = useQueryClient();
  const queryKey = fundingQueryKey(address);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await readTestnetFundingStatus(address!, fetch, signal);
      validateFundingScope(response, address!);
      const previous =
        queryClient.getQueryData<TestnetFundingResponse>(queryKey);
      if (previous !== undefined && unavailableFundingResponse(response))
        throw new Error("Funding status is temporarily unavailable");
      return newerFundingResponse(previous, response);
    },
    enabled: ready && address !== undefined,
    refetchInterval: (query) =>
      query.state.data?.request?.state === "pending" ||
      query.state.data?.request?.state === "retryable" ||
      query.state.data?.recipient?.state === "pending"
        ? 5_000
        : false,
    retry: false,
  });
  return {
    failed: query.isError,
    pending: query.isPending,
    refresh: query.refetch,
    response: query.data,
    updatedAt: query.dataUpdatedAt,
  } as const;
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
  const queryClient = useQueryClient();
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
    onSuccess: async (response, recipient) => {
      if (
        response.recipient !== undefined &&
        response.recipient.address.toLowerCase() !== recipient.toLowerCase()
      )
        throw new Error("Funding response belongs to another wallet");
      const queryKey = fundingQueryKey(recipient);
      // Cancel older reads before seeding acceptance; newer server evidence wins.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<TestnetFundingResponse>(queryKey, (previous) =>
        newerFundingResponse(previous, response),
      );
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const previousAddress = useRef(address);
  useEffect(() => {
    if (previousAddress.current === address) return;
    previousAddress.current = address;
    fundWallet.reset();
  }, [address, fundWallet]);

  const mutationCurrent = mutationMatchesAddress(address, fundWallet.variables);
  const response = fundingStatus.response;
  const resolvedFailure =
    fundingStatus.updatedAt > fundWallet.submittedAt &&
    response?.recipient?.state !== undefined &&
    response.recipient.state !== "unavailable";
  const view = createTestnetFundingView({
    accessState: protocol.accessState,
    hasMutationResponse: response !== undefined,
    mutationFailure: fundingMutationFailure(
      mutationCurrent,
      fundWallet.isError,
      resolvedFailure,
      fundWallet.error,
    ),
    mutationPending: mutationCurrent && fundWallet.isPending,
    queryFailed: fundingStatus.failed,
    queryPending: fundingStatus.pending,
    response,
  });
  const refreshedGrant = useRef<string | undefined>(undefined);
  useEffect(() => {
    const state = response?.recipient?.state;
    if (
      protocol.accessState !== "ready" ||
      (state !== "funded" && state !== "already-funded")
    )
      return;
    const grant = `${address}:${response?.request?.id ?? "funded"}`;
    if (refreshedGrant.current === grant) return;
    refreshedGrant.current = grant;
    void (async () => {
      const block = await publicClient?.getBlockNumber().catch(() => undefined);
      await protocol.refreshWallet(block);
    })().catch(() => undefined);
  }, [address, protocol, publicClient, response]);
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
