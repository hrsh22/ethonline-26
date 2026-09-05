import { Schema } from "effect";

const Address = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/u));
const TransactionHash = Schema.String.pipe(
  Schema.pattern(/^0x[0-9a-fA-F]{64}$/u),
);
const UnsignedWei = Schema.String.pipe(Schema.pattern(/^(0|[1-9][0-9]*)$/u));

export const TestnetFundingServiceStateSchema = Schema.Literal(
  "disabled",
  "ready",
  "inventory-empty",
);

export const TestnetFundingRecipientStateSchema = Schema.Literal(
  "eligible",
  "already-funded",
  "funded",
  "pending",
  "rate-limited",
  "limit-reached",
  "unavailable",
);

export const TestnetFundingRequestStateSchema = Schema.Literal(
  "pending",
  "retryable",
  "funded",
);

export const TestnetFundingErrorCodeSchema = Schema.Literal(
  "funding-busy",
  "funding-client-throttled",
  "funding-confirming",
  "funding-daily-budget",
  "funding-daily-grant-limit",
  "funding-proof-expired",
  "funding-proof-invalid",
  "funding-proof-replayed",
  "funding-proof-required",
  "funding-configuration-invalid",
  "funding-disabled",
  "funding-failed",
  "funding-internal-error",
  "funding-invalid-request",
  "funding-inventory-empty",
  "funding-lifetime-limit",
  "funding-method-not-allowed",
  "funding-not-configured",
  "funding-rate-limited",
  "funding-route-not-found",
  "funding-rpc-unavailable",
  "funding-unauthorized",
  "funding-unavailable",
);

const AssetAmounts = Schema.Struct({
  wethWei: UnsignedWei,
  ethWei: UnsignedWei,
});

const TestnetFundingServiceSchema = Schema.Struct({
  state: TestnetFundingServiceStateSchema,
  chainId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  targets: Schema.optional(AssetAmounts),
  cooldownSeconds: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  inventory: Schema.optional(
    Schema.Struct({
      state: Schema.Literal("available", "empty"),
      wethWei: UnsignedWei,
      ethWei: UnsignedWei,
    }),
  ),
  metrics: Schema.optional(
    Schema.Struct({
      successful: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      pending: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      failed: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      rateLimited: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    }),
  ),
  /**
   * Service-wide depletion velocity for the operator alert. Deliberately
   * carries no signer address, signer balance, or key material.
   */
  budget: Schema.optional(
    Schema.Struct({
      windowResetsAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      grantsUsed: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      grantLimit: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      usedRatio: Schema.Number.pipe(Schema.nonNegative()),
      alert: Schema.Literal("normal", "elevated", "critical"),
    }),
  ),
  halted: Schema.optional(Schema.Boolean),
  disabled: Schema.optional(Schema.Boolean),
  disabledAt: Schema.optional(Schema.NullOr(Schema.Number)),
});

const TestnetFundingRecipientSchema = Schema.Struct({
  address: Address,
  state: TestnetFundingRecipientStateSchema,
  balances: Schema.optional(AssetAmounts),
  remaining: Schema.optional(AssetAmounts),
  /**
   * Whether the recipient's balances reached the configured targets once the
   * grant confirmed. An account that forwards what it receives confirms every
   * transfer and still reports false, which is the difference between "the
   * faucet failed" and "your wallet did not keep it".
   */
  retainedTargets: Schema.optional(Schema.Boolean),
  nextEligibleAt: Schema.optional(
    Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  ),
});

const TestnetFundingRequestSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  state: TestnetFundingRequestStateSchema,
  transactions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literal("weth", "eth"),
        hash: TransactionHash,
        state: Schema.Literal("prepared", "broadcast", "confirmed"),
      }),
    ),
  ),
});

const TestnetFundingErrorSchema = Schema.Struct({
  code: TestnetFundingErrorCodeSchema,
  message: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  nextEligibleAt: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  retryAfterMilliseconds: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  windowResetsAt: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
});

/**
 * The single-use wallet-control challenge a recipient signs. It carries no
 * signer or inventory detail, only the message to sign and its lifetime.
 */
const TestnetFundingChallengeSchema = Schema.Struct({
  chainId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  domain: Schema.String.pipe(Schema.minLength(1)),
  expiresAt: Schema.String.pipe(Schema.minLength(1)),
  issuedAt: Schema.String.pipe(Schema.minLength(1)),
  message: Schema.String.pipe(Schema.minLength(1)),
  nonce: Schema.String.pipe(Schema.minLength(1)),
  recipient: Schema.String.pipe(Schema.minLength(1)),
  uri: Schema.String.pipe(Schema.minLength(1)),
});

export const TestnetFundingResponseSchema = Schema.Struct({
  apiVersion: Schema.Literal(1),
  service: Schema.optional(TestnetFundingServiceSchema),
  recipient: Schema.optional(TestnetFundingRecipientSchema),
  request: Schema.optional(TestnetFundingRequestSchema),
  challenge: Schema.optional(TestnetFundingChallengeSchema),
  error: Schema.optional(TestnetFundingErrorSchema),
}).pipe(
  Schema.filter(
    (response) =>
      response.service !== undefined ||
      response.recipient !== undefined ||
      response.request !== undefined ||
      response.challenge !== undefined ||
      response.error !== undefined,
    {
      message: () => "A funding response must contain public state or an error",
    },
  ),
);

export type TestnetFundingResponse = typeof TestnetFundingResponseSchema.Type;
export type TestnetFundingRecipientState =
  typeof TestnetFundingRecipientStateSchema.Type;
export type TestnetFundingServiceState =
  typeof TestnetFundingServiceStateSchema.Type;
export type TestnetFundingErrorCode = typeof TestnetFundingErrorCodeSchema.Type;

export const decodeTestnetFundingResponse = Schema.decodeUnknownSync(
  TestnetFundingResponseSchema,
);
