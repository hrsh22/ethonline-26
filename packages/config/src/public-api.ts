import { Schema } from "effect";

import {
  decodePublicFundingProof,
  type PublicFundingProof,
} from "./funding-proof.js";
import { getAddress, zeroAddress, type Address } from "viem";

export const PUBLIC_API_PATHS = {
  funding: {
    challenge: "/v1/funding/challenge",
    fund: "/v1/funding/fund",
    root: "/v1/funding",
    status: "/v1/funding/status",
  },
  health: "/healthz",
  history: {
    keeperAttempts: "/v1/history/protocol/keeper-attempts",
    marketCandles: "/v1/history/market/candles",
    marketFees: "/v1/history/market/fees",
    marketSwaps: "/v1/history/market/swaps",
    operations: "/v1/history/protocol/operations",
    permanentCommitments: "/v1/history/protocol/permanent-commitments",
    protocolLiquidity: "/v1/history/protocol/liquidity-cycles",
    rewards: "/v1/history/protocol/rewards",
    root: "/v1/history",
    status: "/v1/history/status",
  },
  ready: "/readyz",
} as const;

const PublicFundingRequestInput = Schema.Struct({
  recipient: Schema.String,
  source: Schema.Literal("faucet", "onboarding"),
});

export type PublicFundingSource = "faucet" | "onboarding";

export interface PublicFundingRequest {
  readonly recipient: Address;
  readonly source: PublicFundingSource;
  /** Proof that the caller controls `recipient`. */
  readonly proof: PublicFundingProof;
}

const requestRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Funding request must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
};

export const decodePublicFundingRequest = (
  value: unknown,
): PublicFundingRequest => {
  const record = requestRecord(value);
  if (
    Object.keys(record).some(
      (name) => name !== "recipient" && name !== "source" && name !== "proof",
    )
  ) {
    throw new TypeError("Funding request contains an unsupported field");
  }
  const decoded = Schema.decodeUnknownSync(PublicFundingRequestInput)(record);
  const recipient = getAddress(decoded.recipient);
  if (recipient === zeroAddress) {
    throw new TypeError("Funding recipient must not be zero");
  }
  return {
    proof: decodePublicFundingProof(record.proof),
    recipient,
    source: decoded.source,
  };
};

const parsedPublicApiUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw new TypeError("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL");
  }
};

const localApiHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const usesPublicApiProtocol = (url: URL): boolean =>
  url.protocol === "https:" ||
  (url.protocol === "http:" && localApiHosts.has(url.hostname));

const containsOnlyOriginComponents = (url: URL): boolean =>
  url.username.length === 0 &&
  url.password.length === 0 &&
  url.pathname === "/" &&
  url.search.length === 0 &&
  url.hash.length === 0;

export const normalizePublicApiBaseUrl = (value: string): string => {
  const url = parsedPublicApiUrl(value);
  if (!usesPublicApiProtocol(url) || !containsOnlyOriginComponents(url)) {
    throw new TypeError(
      "NEXT_PUBLIC_API_URL must be an HTTPS origin or local HTTP origin",
    );
  }
  return url.origin;
};

export const publicApiEndpoint = (baseUrl: string, path: string): string =>
  normalizePublicApiBaseUrl(baseUrl) + path;
