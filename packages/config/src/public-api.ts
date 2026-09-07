import { Schema } from "effect";

import {
  decodePublicFundingProof,
  type PublicFundingProof,
} from "./funding-proof.js";
import { getAddress, zeroAddress, type Address } from "viem";

export const PUBLIC_API_PATHS = {
  analytics: { rewardFunding: "/v1/analytics/reward-funding" },
  delivery: { status: "/v1/delivery/status" },
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
    discoveries: "/v1/history/protocol/discoveries",
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

/** Read-only service evidence. Unknown dependency/work state must not be inferred from a heartbeat. */
const Milliseconds = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
export const DeliveryStatusSchema = Schema.Struct({
  apiVersion: Schema.Literal(1),
  chainId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  deploymentFingerprint: Schema.String.pipe(Schema.minLength(1)),
  observedAt: Milliseconds,
  expiresAt: Milliseconds,
  policy: Schema.Struct({
    mode: Schema.Literal("stopped", "dry-run", "live"),
    oneShot: Schema.Literal("none", "dry-run", "live"),
  }),
  liveness: Schema.Struct({
    state: Schema.Literal("online", "degraded", "offline"),
    heartbeatAt: Schema.optional(Milliseconds),
    expiresAt: Schema.optional(Milliseconds),
  }),
  dependencyReadiness: Schema.Literal("unknown"),
  workEligibility: Schema.Literal("unknown"),
  latestRun: Schema.optional(
    Schema.Struct({
      outcome: Schema.Literal(
        "running",
        "completed",
        "failed",
        "skipped",
        "unknown",
      ),
      startedAt: Milliseconds,
      finishedAt: Schema.optional(Milliseconds),
    }),
  ),
});
export type DeliveryStatus = typeof DeliveryStatusSchema.Type;
export const decodeDeliveryStatus =
  Schema.decodeUnknownSync(DeliveryStatusSchema);

const GraphUnits = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9][0-9]{0,77})$/u),
);
const GraphHash = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{64}$/u));
const GraphToken = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/u)),
  symbol: Schema.String.pipe(Schema.maxLength(32)),
  decimals: Schema.Number.pipe(Schema.int(), Schema.between(0, 36)),
});
export const RewardFundingDataSchema = Schema.Struct({
  _meta: Schema.Struct({
    block: Schema.Struct({
      number: Milliseconds,
      hash: Schema.NullOr(GraphHash),
      timestamp: Schema.NullOr(Milliseconds),
    }),
    hasIndexingErrors: Schema.Boolean,
    deployment: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  }),
  rewardFundingSummary: Schema.NullOr(
    Schema.Struct({
      id: GraphHash,
      totalFeesWeth: GraphUnits,
      totalRewardsWeth: GraphUnits,
      totalLiquidityWeth: GraphUnits,
      totalCreatorWeth: GraphUnits,
      totalConvertedWeth: GraphUnits,
      feeEventCount: Milliseconds,
      conversionCount: Milliseconds,
      lastEventBlock: GraphUnits,
      lastEventTimestamp: GraphUnits,
      pool: Schema.Struct({
        id: GraphHash,
        inputTokens: Schema.Array(GraphToken).pipe(Schema.itemsCount(2)),
        swaps: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            hash: GraphHash,
            timestamp: GraphUnits,
            amountIn: GraphUnits,
            amountOut: GraphUnits,
            tokenIn: GraphToken,
            tokenOut: GraphToken,
          }),
        ).pipe(Schema.maxItems(5)),
      }),
    }),
  ),
});
export const RewardFundingResponseSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("available"),
    observedAt: Milliseconds,
    data: RewardFundingDataSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    observedAt: Milliseconds,
    reason: Schema.Literal(
      "not-configured",
      "budget-exhausted",
      "provider-error",
      "indexing-error",
    ),
  }),
);
export type RewardFundingResponse = typeof RewardFundingResponseSchema.Type;
export const decodeRewardFundingResponse = Schema.decodeUnknownSync(
  RewardFundingResponseSchema,
);
