import { Effect, Schema } from "effect";

import { RpcError, rpc, validate } from "./effect-runtime.ts";

const HexSchema = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]*$/));
const AddressSchema = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/));
const OptionalHexSchema = Schema.NullOr(HexSchema);
const OptionalAddressSchema = Schema.NullOr(AddressSchema);

const TransactionReceiptSchema = Schema.NullOr(
  Schema.Struct({
    status: HexSchema,
    transactionHash: HexSchema,
    blockNumber: HexSchema,
    contractAddress: OptionalAddressSchema,
  }),
);

const TransactionSchema = Schema.NullOr(
  Schema.Struct({
    hash: HexSchema,
    from: AddressSchema,
    blockNumber: OptionalHexSchema,
    nonce: HexSchema,
    to: OptionalAddressSchema,
    input: HexSchema,
  }),
);

const JsonRpcEnvelopeSchema = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      message: Schema.String,
    }),
  ),
});

const resultSchemas = {
  anvil_setBalance: Schema.Null,
  anvil_setStorageAt: Schema.Boolean,
  eth_accounts: Schema.Array(AddressSchema),
  eth_call: HexSchema,
  eth_chainId: HexSchema,
  eth_getCode: HexSchema,
  eth_getStorageAt: HexSchema,
  eth_getTransactionByHash: TransactionSchema,
  eth_getTransactionCount: HexSchema,
  eth_getTransactionReceipt: TransactionReceiptSchema,
  // Anvil unlocks its own accounts, so a test can send as one of them without
  // holding a key. Returns the transaction hash.
  eth_sendTransaction: HexSchema,
} as const;

export type JsonRpcMethod = keyof typeof resultSchemas;
export type JsonRpcTransaction = typeof TransactionSchema.Type;
export type JsonRpcTransactionReceipt = typeof TransactionReceiptSchema.Type;

export interface JsonRpcResults {
  readonly anvil_setBalance: null;
  readonly anvil_setStorageAt: boolean;
  readonly eth_accounts: readonly string[];
  readonly eth_call: string;
  readonly eth_chainId: string;
  readonly eth_getCode: string;
  readonly eth_getStorageAt: string;
  readonly eth_getTransactionByHash: JsonRpcTransaction;
  readonly eth_getTransactionCount: string;
  readonly eth_sendTransaction: string;
  readonly eth_getTransactionReceipt: JsonRpcTransactionReceipt;
}

export type JsonRpcResult<Method extends JsonRpcMethod> =
  JsonRpcResults[Method];

interface JsonRpcClientOptions {
  readonly attempts?: number;
  readonly retryDelayMilliseconds?: (
    attempt: number,
    requestId: number,
  ) => number;
}

const defaultRetryDelay = (attempt: number, requestId: number): number =>
  200 * 2 ** attempt + (requestId % 7) * 25;

export const createJsonRpcClient = (
  url: string,
  {
    attempts = 1,
    retryDelayMilliseconds = defaultRetryDelay,
  }: JsonRpcClientOptions = {},
) => {
  let requestId = 0;

  return <Method extends JsonRpcMethod>(
    method: Method,
    params: readonly unknown[] = [],
  ) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        requestId += 1;
        const response = yield* rpc(`${method} request failed`, () =>
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              method,
              params,
            }),
          }),
        );
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt + 1 < attempts) {
          yield* Effect.sleep(retryDelayMilliseconds(attempt, requestId));
          continue;
        }
        if (!response.ok) {
          return yield* Effect.fail(
            new RpcError({
              message: `${method} returned HTTP ${response.status}`,
              cause: response.status,
            }),
          );
        }
        const payload = yield* rpc(`${method} response was not JSON`, () =>
          response.json(),
        );
        const envelope = yield* validate(
          `${method} returned an invalid JSON-RPC envelope`,
          () => Schema.decodeUnknownSync(JsonRpcEnvelopeSchema)(payload),
        );
        if (envelope.error !== undefined) {
          return yield* Effect.fail(
            new RpcError({
              message: `${method} failed: ${envelope.error.message}`,
              cause: envelope.error,
            }),
          );
        }
        if (!("result" in envelope)) {
          return yield* Effect.fail(
            new RpcError({
              message: `${method} returned no result`,
              cause: envelope,
            }),
          );
        }
        const schema = resultSchemas[method] as Schema.Schema<unknown>;
        return (yield* validate(`${method} returned an invalid result`, () =>
          Schema.decodeUnknownSync(schema)(envelope.result),
        )) as JsonRpcResults[Method];
      }
      return yield* Effect.fail(
        new RpcError({
          message: `${method} exhausted its RPC retry budget`,
          cause: method,
        }),
      );
    });
};
