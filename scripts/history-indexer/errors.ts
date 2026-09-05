import { Data } from "effect";

export class HistoryConfigurationError extends Data.TaggedError(
  "HistoryConfigurationError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class HistoryPersistenceError extends Data.TaggedError(
  "HistoryPersistenceError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class HistoryRpcError extends Data.TaggedError("HistoryRpcError")<{
  readonly message: string;
  readonly retryable: boolean;
  readonly rangeTooLarge: boolean;
  readonly cause: unknown;
}> {}

export class HistoryDecodeError extends Data.TaggedError("HistoryDecodeError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class HistoryCanonicalityError extends Data.TaggedError(
  "HistoryCanonicalityError",
)<{
  readonly message: string;
  readonly blockNumber: bigint;
  readonly expectedHash: string;
  readonly observedHash: string;
}> {}

export class DeepReorgError extends Data.TaggedError("DeepReorgError")<{
  readonly message: string;
  readonly checkpointBlock: bigint;
  readonly retainedFromBlock: bigint | undefined;
}> {}
