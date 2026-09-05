import type { Address, Hex } from "viem";

import { PUBLIC_API_PATHS } from "@orbit/config/public-api";
import {
  decodeTestnetFundingResponse,
  type TestnetFundingResponse,
} from "@orbit/config/testnet-funding";

import { publicApiUrl } from "./public-api";

export type TestnetFundingSource = "faucet" | "onboarding";

const decodeResponse = async (
  response: Response,
): Promise<TestnetFundingResponse> =>
  decodeTestnetFundingResponse(await response.json());

export const readTestnetFundingStatus = async (
  recipient: Address,
  fetcher: typeof fetch = fetch,
): Promise<TestnetFundingResponse> =>
  decodeResponse(
    await fetcher(
      publicApiUrl(PUBLIC_API_PATHS.funding.status) +
        "?recipient=" +
        String(recipient),
    ),
  );

export interface TestnetFundingProof {
  readonly message: string;
  readonly signature: Hex;
}

/**
 * Requests the single-use challenge a recipient must sign to prove it controls
 * the wallet being funded.
 */
export const readTestnetFundingChallenge = async (
  recipient: Address,
  fetcher: typeof fetch = fetch,
): Promise<string> => {
  const response = await fetcher(
    `${publicApiUrl(PUBLIC_API_PATHS.funding.challenge)}?recipient=${String(recipient)}`,
  );
  const body = (await response.json()) as {
    readonly challenge?: { readonly message?: unknown };
  };
  const message = body.challenge?.message;
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("The funding challenge could not be read");
  }
  return message;
};

export const requestTestnetFunding = async (
  recipient: Address,
  source: TestnetFundingSource,
  proof: TestnetFundingProof,
  fetcher: typeof fetch = fetch,
): Promise<TestnetFundingResponse> =>
  decodeResponse(
    await fetcher(publicApiUrl(PUBLIC_API_PATHS.funding.fund), {
      body: JSON.stringify({ proof, recipient, source }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
