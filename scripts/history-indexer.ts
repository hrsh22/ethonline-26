import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect } from "effect";

import { fileSystem, runInterruptibleMain } from "./effect-runtime.ts";
import { createHistoryAvailability } from "./history-indexer/availability.ts";
import { acquireHistoryHttpServer } from "./history-indexer/http-server.ts";
import { acquireKeeperAttemptStore } from "./history-indexer/keeper-attempt-store.ts";
import { createHistoryChainSource } from "./history-indexer/rpc-source.ts";
import { loadHistoryRuntimeConfiguration } from "./history-indexer/runtime-configuration.ts";
import { acquireHistoryStore } from "./history-indexer/sqlite-store.ts";
import { createUniswapV4CandleSource } from "./history-indexer/uniswap-v4-candles.ts";
import {
  synchronizeHistory,
  type HistorySynchronizationResult,
} from "./history-indexer/synchronize.ts";
import { createViemHistoryPublicClient } from "./history-indexer/viem-client.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const oneShot = (arguments_: readonly string[]): boolean => {
  const unexpected = arguments_.filter((argument) => argument !== "--once");
  if (unexpected.length > 0) {
    throw new Error(
      `Unknown history indexer argument: ${unexpected.join(", ")}`,
    );
  }
  return arguments_.includes("--once");
};

const reportSynchronization = (result: HistorySynchronizationResult): void => {
  process.stdout.write(
    `History indexed through ${result.indexedThroughBlock ?? "none"}; observed head ${result.observedHeadBlock}; ${result.rangesCommitted} range(s) committed.\n`,
  );
};

export const selectInitialSynchronization = <Success, Failure, Requirements>(
  runOnce: boolean,
  synchronize: Effect.Effect<Success, Failure, Requirements>,
  synchronizeUntilSuccessful: Effect.Effect<Success, Failure, Requirements>,
): Effect.Effect<Success, Failure, Requirements> =>
  runOnce ? synchronize : synchronizeUntilSuccessful;

const historyIndexer = Effect.scoped(
  Effect.gen(function* () {
    const runOnce = yield* Effect.try({
      try: () => oneShot(process.argv.slice(2)),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const runtime = yield* loadHistoryRuntimeConfiguration(
      repositoryRoot,
      runOnce ? "once" : "service",
    );
    yield* fileSystem("Could not create the history data directory", () =>
      mkdirSync(dirname(runtime.databasePath), { recursive: true }),
    );
    yield* fileSystem(
      "Could not create the keeper-attempt data directory",
      () =>
        mkdirSync(dirname(runtime.keeperAttemptDatabasePath), {
          recursive: true,
        }),
    );
    const store = yield* acquireHistoryStore(
      runtime.databasePath,
      runtime.index,
    );
    const keeperAttemptStore = yield* acquireKeeperAttemptStore(
      runtime.keeperAttemptDatabasePath,
      {
        chainId: runtime.index.chainId,
        manifestFingerprint: runtime.index.manifestFingerprint,
      },
    );
    const client = createViemHistoryPublicClient(runtime.rpcUrl, runtime.index);
    const source = createHistoryChainSource(client, runtime.index);
    const availability = createHistoryAvailability();
    const keeperAttemptAvailability = createHistoryAvailability();
    keeperAttemptAvailability.markFailed({
      code: "keeper-attempts-not-reconciled",
      message:
        "Keeper-attempt receipts have not completed initial reconciliation",
    });
    const reconcileKeeperAttempts = (result: HistorySynchronizationResult) =>
      Effect.promise(async () => {
        try {
          await keeperAttemptStore.reconcileReceipts({
            confirmationBlocks: runtime.index.confirmationBlocks,
            concurrency: runtime.index.rpcConcurrency,
            source: client,
            observedBlock: result.observedHeadBlock,
            recordedAt: BigInt(Math.floor(Date.now() / 1_000)),
          });
          keeperAttemptAvailability.markReady();
        } catch {
          keeperAttemptAvailability.markFailed({
            code: "keeper-attempt-reconciliation-unavailable",
            message: "Submitted keeper transactions could not be reconciled",
          });
        }
      });
    const synchronize = synchronizeHistory({
      configuration: runtime.index,
      onCanonicalityUncertain: () =>
        Effect.sync(() => {
          availability.markFailed({
            code: "history-canonicality-check-failed",
            message: "A persisted checkpoint is no longer canonical",
          });
        }),
      source,
      store,
    }).pipe(
      Effect.tap((result) => Effect.sync(() => reportSynchronization(result))),
      Effect.tap(() => Effect.sync(availability.markReady)),
      Effect.tap(reconcileKeeperAttempts),
    );
    const retryAfterPoll = (code: string, message: string) =>
      Effect.sync(() => {
        availability.markFailed({ code, message });
        process.stderr.write(
          `${message}; retrying after ${runtime.pollMilliseconds / 1_000}s.\n`,
        );
      }).pipe(Effect.andThen(Effect.sleep(runtime.pollMilliseconds)));
    const synchronizeUntilSuccessful: typeof synchronize = Effect.suspend(() =>
      synchronize.pipe(
        Effect.catchTag("HistoryRpcError", (error) =>
          error.retryable
            ? retryAfterPoll(
                "history-rpc-unavailable",
                "History RPC cycle failed after bounded retries",
              ).pipe(Effect.andThen(synchronizeUntilSuccessful))
            : Effect.fail(error),
        ),
        Effect.catchTag("HistoryCanonicalityError", (error) =>
          retryAfterPoll(
            "history-canonicality-check-failed",
            error.message,
          ).pipe(Effect.andThen(synchronizeUntilSuccessful)),
        ),
      ),
    );
    yield* selectInitialSynchronization(
      runOnce,
      synchronize,
      synchronizeUntilSuccessful,
    );
    if (runOnce) return;
    if (runtime.listener === undefined) {
      return yield* Effect.die("History listener policy was not resolved");
    }
    const server = yield* acquireHistoryHttpServer({
      readApiToken: runtime.listener.readApiToken,
      ingestApiToken: runtime.listener.ingestApiToken,
      availability,
      configuration: runtime.index,
      host: runtime.listener.host,
      port: runtime.port,
      store,
      ...(runtime.uniswapV4Subgraph === undefined
        ? {}
        : {
            marketCandles: createUniswapV4CandleSource({
              ...runtime.uniswapV4Subgraph,
              currency0: runtime.index.canonicalPool.currency0,
              currency1: runtime.index.canonicalPool.currency1,
              liquidToken: runtime.index.sources.fuelCore,
              poolId: runtime.index.canonicalPool.poolId,
            }),
          }),
      keeperAttempts: {
        availability: keeperAttemptAvailability,
        currentTime: () => BigInt(Math.floor(Date.now() / 1_000)),
        maximumAgeSeconds: runtime.keeperAttemptMaximumAgeSeconds,
        store: keeperAttemptStore,
      },
    });
    process.stdout.write(
      `History indexer API listening at ${server.url}; databases ${runtime.databasePath} and ${runtime.keeperAttemptDatabasePath}.\n`,
    );
    const cycle = Effect.sleep(runtime.pollMilliseconds).pipe(
      Effect.andThen(synchronizeUntilSuccessful),
    );
    yield* Effect.forever(cycle);
  }),
);

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runInterruptibleMain(historyIndexer);
}
