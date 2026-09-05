import { Effect } from "effect";

import type { HistoryIndexConfiguration } from "./configuration.ts";
import {
  DeepReorgError,
  HistoryCanonicalityError,
  HistoryDecodeError,
  HistoryPersistenceError,
  HistoryRpcError,
} from "./errors.ts";
import type {
  CanonicalHeader,
  HistoryCheckpoint,
  IndexedHistoryEvent,
} from "./model.ts";
import type { HistoryStore } from "./sqlite-store.ts";

export interface HistoryChainSource {
  readonly getChainId: Effect.Effect<number, HistoryRpcError>;
  readonly getHead: Effect.Effect<CanonicalHeader, HistoryRpcError>;
  readonly getHeader: (
    blockNumber: bigint,
  ) => Effect.Effect<CanonicalHeader, HistoryRpcError>;
  readonly getEvents: (
    fromBlock: bigint,
    toBlock: bigint,
  ) => Effect.Effect<
    readonly IndexedHistoryEvent[],
    HistoryRpcError | HistoryDecodeError
  >;
}

export interface HistorySynchronizationResult {
  readonly state: "complete" | "partial";
  readonly indexedThroughBlock: bigint | undefined;
  readonly observedHeadBlock: bigint;
  readonly rangesCommitted: number;
}

export interface HistoryCanonicalityUncertain {
  readonly checkpoint: HistoryCheckpoint;
  readonly observed: CanonicalHeader;
}

export type HistoryCanonicalityObserver = (
  uncertainty: HistoryCanonicalityUncertain,
) => Effect.Effect<void>;

type HistorySynchronizationError =
  | HistoryRpcError
  | HistoryDecodeError
  | HistoryPersistenceError
  | HistoryCanonicalityError
  | DeepReorgError;

const persistence = <Value>(
  message: string,
  operation: () => Value,
): Effect.Effect<Value, HistoryPersistenceError> =>
  Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof HistoryPersistenceError
        ? cause
        : new HistoryPersistenceError({ message, cause }),
  });

const retryRpc = <Value, OtherError>({
  attemptsRemaining,
  configuration,
  operation,
}: {
  readonly attemptsRemaining: number;
  readonly configuration: HistoryIndexConfiguration;
  readonly operation: () => Effect.Effect<Value, HistoryRpcError | OtherError>;
}): Effect.Effect<Value, HistoryRpcError | OtherError> =>
  operation().pipe(
    Effect.catchAll((error) => {
      if (!(error instanceof HistoryRpcError)) return Effect.fail(error);
      if (!error.retryable || attemptsRemaining <= 1) {
        return Effect.fail(error);
      }
      const attempt = configuration.retryMaximumAttempts - attemptsRemaining;
      const delay =
        configuration.retryBaseDelayMilliseconds * Math.max(1, 2 ** attempt);
      return Effect.sleep(delay).pipe(
        Effect.andThen(
          retryRpc({
            attemptsRemaining: attemptsRemaining - 1,
            configuration,
            operation,
          }),
        ),
      );
    }),
  );

const readCanonicalHeader = (
  blockNumber: bigint,
  configuration: HistoryIndexConfiguration,
  source: HistoryChainSource,
) =>
  retryRpc({
    attemptsRemaining: configuration.retryMaximumAttempts,
    configuration,
    operation: () => source.getHeader(blockNumber),
  });

const requireStableHeader = (
  expected: CanonicalHeader,
  observed: CanonicalHeader,
): Effect.Effect<void, HistoryCanonicalityError> =>
  expected.blockHash === observed.blockHash
    ? Effect.void
    : Effect.fail(
        new HistoryCanonicalityError({
          message: `Canonical block ${expected.blockNumber} changed during history synchronization`,
          blockNumber: expected.blockNumber,
          expectedHash: expected.blockHash,
          observedHash: observed.blockHash,
        }),
      );

const verifyCheckpointAnchor = (
  checkpoint: HistoryCheckpoint | undefined,
  configuration: HistoryIndexConfiguration,
  source: HistoryChainSource,
): Effect.Effect<void, HistoryRpcError | HistoryCanonicalityError> =>
  checkpoint === undefined
    ? Effect.void
    : readCanonicalHeader(checkpoint.blockNumber, configuration, source).pipe(
        Effect.flatMap((observed) => requireStableHeader(checkpoint, observed)),
      );

const fetchEvents = ({
  configuration,
  fromBlock,
  source,
  toBlock,
}: {
  readonly configuration: HistoryIndexConfiguration;
  readonly fromBlock: bigint;
  readonly source: HistoryChainSource;
  readonly toBlock: bigint;
}): Effect.Effect<
  readonly IndexedHistoryEvent[],
  HistoryRpcError | HistoryDecodeError
> =>
  retryRpc({
    attemptsRemaining: configuration.retryMaximumAttempts,
    configuration,
    operation: () => source.getEvents(fromBlock, toBlock),
  }).pipe(
    Effect.catchTag("HistoryRpcError", (error) => {
      if (!error.rangeTooLarge || fromBlock === toBlock) {
        return Effect.fail(error);
      }
      const midpoint = fromBlock + (toBlock - fromBlock) / 2n;
      return Effect.all(
        [
          fetchEvents({
            configuration,
            fromBlock,
            source,
            toBlock: midpoint,
          }),
          fetchEvents({
            configuration,
            fromBlock: midpoint + 1n,
            source,
            toBlock,
          }),
        ],
        { concurrency: 1 },
      ).pipe(Effect.map(([left, right]) => [...left, ...right]));
    }),
  );

const matchingAncestor = (
  configuration: HistoryIndexConfiguration,
  source: HistoryChainSource,
  headers: readonly CanonicalHeader[],
): Effect.Effect<CanonicalHeader | undefined, HistoryRpcError> =>
  Effect.gen(function* () {
    for (const stored of [...headers].reverse()) {
      const canonical = yield* retryRpc({
        attemptsRemaining: configuration.retryMaximumAttempts,
        configuration,
        operation: () => source.getHeader(stored.blockNumber),
      });
      if (canonical.blockHash === stored.blockHash) return stored;
    }
    return undefined;
  });

const synchronizationStart = ({
  configuration,
  observedHead,
  onCanonicalityUncertain,
  source,
  store,
}: {
  readonly configuration: HistoryIndexConfiguration;
  readonly observedHead: CanonicalHeader;
  readonly onCanonicalityUncertain: HistoryCanonicalityObserver;
  readonly source: HistoryChainSource;
  readonly store: HistoryStore;
}): Effect.Effect<
  bigint,
  HistoryRpcError | HistoryPersistenceError | DeepReorgError
> =>
  Effect.gen(function* () {
    const checkpoint = yield* persistence(
      "Could not read the history checkpoint",
      store.readCheckpoint,
    );
    if (checkpoint === undefined) return configuration.launchBlock;
    const canonical = yield* retryRpc({
      attemptsRemaining: configuration.retryMaximumAttempts,
      configuration,
      operation: () => source.getHeader(checkpoint.blockNumber),
    });
    if (canonical.blockHash === checkpoint.blockHash) {
      const overlapStart =
        checkpoint.blockNumber - configuration.overlapBlocks + 1n;
      return overlapStart > configuration.launchBlock
        ? overlapStart
        : configuration.launchBlock;
    }
    yield* onCanonicalityUncertain({ checkpoint, observed: canonical });
    const retained = yield* persistence(
      "Could not read retained canonical headers",
      store.readRetainedHeaders,
    );
    const ancestor = yield* matchingAncestor(configuration, source, retained);
    if (ancestor !== undefined) {
      yield* persistence("Could not rewind reorged history", () =>
        store.rewindCanonicalHistory(ancestor, observedHead),
      );
      return ancestor.blockNumber + 1n;
    }
    return yield* new DeepReorgError({
      message: `No canonical ancestor was found for checkpoint ${checkpoint.blockNumber}`,
      checkpointBlock: checkpoint.blockNumber,
      retainedFromBlock: retained[0]?.blockNumber,
    });
  });

const retainedHeadersForRange = ({
  configuration,
  fromBlock,
  source,
  toBlock,
}: {
  readonly configuration: HistoryIndexConfiguration;
  readonly fromBlock: bigint;
  readonly source: HistoryChainSource;
  readonly toBlock: bigint;
}) => {
  const desiredFrom = toBlock - configuration.overlapBlocks + 1n;
  const retainFrom = desiredFrom > fromBlock ? desiredFrom : fromBlock;
  const blocks = Array.from(
    { length: Number(toBlock - retainFrom + 1n) },
    (_, index) => retainFrom + BigInt(index),
  );
  return Effect.forEach(
    blocks,
    (blockNumber) =>
      retryRpc({
        attemptsRemaining: configuration.retryMaximumAttempts,
        configuration,
        operation: () => source.getHeader(blockNumber),
      }),
    { concurrency: configuration.rpcConcurrency },
  );
};

const targetBlock = (
  head: CanonicalHeader,
  configuration: HistoryIndexConfiguration,
): bigint | undefined => {
  if (head.blockNumber < configuration.confirmationBlocks) return undefined;
  const candidate = head.blockNumber - configuration.confirmationBlocks;
  return candidate < configuration.launchBlock ? undefined : candidate;
};

const requireExpectedChain = (
  observedChainId: number,
  configuration: HistoryIndexConfiguration,
): Effect.Effect<void, HistoryRpcError> =>
  observedChainId === configuration.chainId
    ? Effect.void
    : Effect.fail(
        new HistoryRpcError({
          message: `History RPC chain mismatch: expected ${configuration.chainId}, observed ${observedChainId}`,
          retryable: false,
          rangeTooLarge: false,
          cause: { expected: configuration.chainId, observed: observedChainId },
        }),
      );

const partialResultBeforeLaunch = (
  head: CanonicalHeader,
  store: HistoryStore,
): Effect.Effect<HistorySynchronizationResult, HistoryPersistenceError> =>
  persistence(
    "Could not read the history checkpoint",
    store.readCheckpoint,
  ).pipe(
    Effect.map((checkpoint) => ({
      state: "partial" as const,
      indexedThroughBlock: checkpoint?.blockNumber,
      observedHeadBlock: head.blockNumber,
      rangesCommitted: 0,
    })),
  );

const requireNonregressingTarget = (
  target: bigint | undefined,
  head: CanonicalHeader,
  store: HistoryStore,
): Effect.Effect<void, HistoryPersistenceError | HistoryCanonicalityError> =>
  persistence(
    "Could not read the history checkpoint before selecting a target",
    store.readCheckpoint,
  ).pipe(
    Effect.flatMap((checkpoint) => {
      if (
        checkpoint === undefined ||
        (target !== undefined && target >= checkpoint.blockNumber)
      ) {
        return Effect.void;
      }
      return Effect.fail(
        new HistoryCanonicalityError({
          message: `Confirmed history target ${target ?? "before-launch"} regressed behind checkpoint ${checkpoint.blockNumber}`,
          blockNumber: checkpoint.blockNumber,
          expectedHash: checkpoint.blockHash,
          observedHash: head.blockHash,
        }),
      );
    }),
  );

const synchronizeCanonicalRange = ({
  configuration,
  cursor,
  head,
  source,
  store,
  target,
}: {
  readonly configuration: HistoryIndexConfiguration;
  readonly cursor: bigint;
  readonly head: CanonicalHeader;
  readonly source: HistoryChainSource;
  readonly store: HistoryStore;
  readonly target: bigint;
}): Effect.Effect<bigint, HistorySynchronizationError> =>
  Effect.gen(function* () {
    const candidateEnd = cursor + configuration.batchBlocks - 1n;
    const rangeEnd = candidateEnd < target ? candidateEnd : target;
    const checkpointBefore = yield* persistence(
      "Could not read the history checkpoint before a range",
      store.readCheckpoint,
    );
    if (
      checkpointBefore === undefined ||
      checkpointBefore.blockNumber < cursor
    ) {
      yield* verifyCheckpointAnchor(checkpointBefore, configuration, source);
    }
    const anchorBefore = yield* readCanonicalHeader(
      rangeEnd,
      configuration,
      source,
    );
    const [events, headers] = yield* Effect.all(
      [
        fetchEvents({
          configuration,
          fromBlock: cursor,
          source,
          toBlock: rangeEnd,
        }),
        retainedHeadersForRange({
          configuration,
          fromBlock: cursor,
          source,
          toBlock: rangeEnd,
        }),
      ],
      { concurrency: 1 },
    );
    const anchorAfter = yield* readCanonicalHeader(
      rangeEnd,
      configuration,
      source,
    );
    yield* requireStableHeader(anchorBefore, anchorAfter);
    const retainedThrough = headers.find(
      (item) => item.blockNumber === rangeEnd,
    );
    if (retainedThrough !== undefined) {
      yield* requireStableHeader(anchorAfter, retainedThrough);
    }
    yield* persistence("Could not commit indexed history", () =>
      store.replaceCanonicalRange({
        fromBlock: cursor,
        through: anchorAfter,
        observedHead: head,
        retainedHeaders: headers,
        events,
      }),
    );
    const committedAnchor = yield* readCanonicalHeader(
      rangeEnd,
      configuration,
      source,
    );
    yield* requireStableHeader(anchorAfter, committedAnchor);
    return rangeEnd;
  });

export const synchronizeHistory = ({
  configuration,
  onCanonicalityUncertain = () => Effect.void,
  source,
  store,
}: {
  readonly configuration: HistoryIndexConfiguration;
  readonly onCanonicalityUncertain?: HistoryCanonicalityObserver;
  readonly source: HistoryChainSource;
  readonly store: HistoryStore;
}): Effect.Effect<HistorySynchronizationResult, HistorySynchronizationError> =>
  Effect.gen(function* () {
    const observedChainId = yield* retryRpc({
      attemptsRemaining: configuration.retryMaximumAttempts,
      configuration,
      operation: () => source.getChainId,
    });
    yield* requireExpectedChain(observedChainId, configuration);
    const head = yield* retryRpc({
      attemptsRemaining: configuration.retryMaximumAttempts,
      configuration,
      operation: () => source.getHead,
    });
    const target = targetBlock(head, configuration);
    yield* requireNonregressingTarget(target, head, store);
    if (target === undefined) {
      return yield* partialResultBeforeLaunch(head, store);
    }
    let cursor = yield* synchronizationStart({
      configuration,
      observedHead: head,
      onCanonicalityUncertain,
      source,
      store,
    });
    let rangesCommitted = 0;
    while (cursor <= target) {
      const rangeEnd = yield* synchronizeCanonicalRange({
        configuration,
        source,
        store,
        cursor,
        head,
        target,
      });
      rangesCommitted += 1;
      cursor = rangeEnd + 1n;
    }
    const checkpoint = yield* persistence(
      "Could not read the committed history checkpoint",
      store.readCheckpoint,
    );
    return {
      state: checkpoint?.blockNumber === target ? "complete" : "partial",
      indexedThroughBlock: checkpoint?.blockNumber,
      observedHeadBlock: head.blockNumber,
      rangesCommitted,
    };
  });
