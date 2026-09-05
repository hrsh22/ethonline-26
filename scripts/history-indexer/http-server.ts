import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { CanonicalMarketCandleFeed } from "@orbit/protocol/history";
import { Data, Effect, Scope } from "effect";

import type {
  HistoryAvailability,
  HistoryAvailabilityFailure,
} from "./availability.ts";
import type { HistoryIndexConfiguration } from "./configuration.ts";
import type {
  KeeperActionKind,
  KeeperAttemptFailureClass,
  KeeperAttemptOutcome,
  KeeperAttemptStore,
  KeeperTrack,
} from "./keeper-attempt-store.ts";
import type { HistoryEventName, HistoryQuery } from "./model.ts";
import type { HistoryStore } from "./sqlite-store.ts";

export class HistoryHttpError extends Data.TaggedError("HistoryHttpError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface RunningHistoryHttpServer {
  readonly url: string;
}

export interface HistoryHttpServerOptions {
  readonly ingestApiToken: string | undefined;
  readonly readApiToken: string | undefined;
  readonly availability: HistoryAvailability;
  readonly configuration: HistoryIndexConfiguration;
  readonly host: string;
  readonly port: number;
  readonly store: HistoryStore;
  readonly marketCandles?: {
    readonly readLatest: () => Promise<CanonicalMarketCandleFeed>;
  };
  readonly keeperAttempts?: {
    readonly availability?: HistoryAvailability;
    readonly currentTime: () => bigint;
    readonly maximumAgeSeconds: bigint;
    readonly store: KeeperAttemptStore;
  };
}

const MAXIMUM_INGESTION_BYTES = 32 * 1_024;
const keeperActionKinds = new Set<KeeperActionKind>([
  "reward-epoch",
  "reward-track",
  "protocol-liquidity",
]);
const keeperOperatorOutcomes = new Set<KeeperAttemptOutcome>([
  "preparing",
  "not-required",
  "simulated",
  "failed-before-submission",
  "pending",
]);
const keeperFailureClasses = new Set<KeeperAttemptFailureClass>([
  "quote-unavailable",
  "preflight-rejected",
  "submission-rejected",
  "receipt-unavailable",
  "execution-reverted",
  "canonicality-uncertain",
]);

const routeEvents: Readonly<Record<string, readonly HistoryEventName[]>> = {
  "/v1/market/swaps": ["swap"],
  "/v1/market/fees": ["fee-accrued"],
  "/v1/protocol/liquidity-cycles": ["protocol-liquidity-added"],
  "/v1/protocol/permanent-commitments": ["permanent-commitment"],
  "/v1/protocol/rewards": [
    "reward-epoch-opened",
    "track-executed",
    "reward-notified",
    "reward-claimed",
  ],
  "/v1/protocol/operations": [
    "reward-epoch-opened",
    "track-executed",
    "reward-claimed",
    "protocol-liquidity-added",
  ],
};

const publicAvailabilityMessages: Readonly<Record<string, string>> = {
  "history-not-synchronized":
    "Indexed history has not completed its initial synchronization",
  "history-rpc-unavailable":
    "Indexed history is temporarily unavailable while its RPC source recovers",
  "history-canonicality-check-failed":
    "Indexed history is temporarily unavailable while canonicality is rechecked",
};

const publicAvailabilityFailure = (
  failure: HistoryAvailabilityFailure,
): HistoryAvailabilityFailure => ({
  code: failure.code,
  message:
    publicAvailabilityMessages[failure.code] ??
    "Indexed history synchronization is unavailable",
});

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const serialized = JSON.stringify(body, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(serialized);
};

const noContent = (response: ServerResponse): void => {
  response.writeHead(204, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end();
};

const authorized = (
  request: IncomingMessage,
  apiToken: string | undefined,
): boolean => {
  if (apiToken === undefined) return false;
  const authorization = request.headers.authorization;
  if (authorization === undefined) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${apiToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const decimal = (url: URL, name: string, fallback: bigint): bigint => {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new RangeError(`${name} must be an unsigned decimal integer`);
  }
  return BigInt(value);
};

const pageLimit = (
  url: URL,
  configuration: HistoryIndexConfiguration,
): number => {
  const value = url.searchParams.get("limit");
  const limit = value === null ? configuration.maximumPageSize : Number(value);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > configuration.maximumPageSize
  ) {
    throw new RangeError(
      `limit must be from 1 to ${configuration.maximumPageSize}`,
    );
  }
  return limit;
};

const pageOrder = (url: URL): "asc" | "desc" => {
  const value = url.searchParams.get("order") ?? "asc";
  if (value !== "asc" && value !== "desc") {
    throw new RangeError("order must be asc or desc");
  }
  return value;
};

const queryFrom = (
  url: URL,
  eventNames: readonly HistoryEventName[],
  options: HistoryHttpServerOptions,
): HistoryQuery => {
  const checkpoint = options.store.readCheckpoint();
  const fromBlock = decimal(
    url,
    "fromBlock",
    options.configuration.launchBlock,
  );
  const toBlock = decimal(
    url,
    "toBlock",
    checkpoint?.blockNumber ?? options.configuration.launchBlock,
  );
  if (fromBlock > toBlock) {
    throw new RangeError("fromBlock must not be greater than toBlock");
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  return {
    eventNames,
    fromBlock,
    toBlock,
    limit: pageLimit(url, options.configuration),
    order: pageOrder(url),
    ...(cursor === undefined ? {} : { cursor }),
  };
};

const manifestIdentity = (configuration: HistoryIndexConfiguration) => ({
  chainId: configuration.chainId,
  network: configuration.network,
  fingerprint: configuration.manifestFingerprint,
  commitment: configuration.manifestCommitment,
  launchBlock: configuration.launchBlock,
  canonicalPool: configuration.canonicalPool,
  sources: configuration.sources,
});

type JsonRecord = Readonly<Record<string, unknown>>;

const jsonRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};

const requestDecimal = (value: unknown, label: string): bigint => {
  const encoded = requiredString(value, label);
  if (!/^(0|[1-9][0-9]*)$/u.test(encoded)) {
    throw new TypeError(`${label} must be an unsigned decimal integer`);
  }
  return BigInt(encoded);
};

const requestHash = (value: unknown, label: string): `0x${string}` => {
  const encoded = requiredString(value, label);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(encoded)) {
    throw new TypeError(`${label} must be a 32-byte hash`);
  }
  return encoded as `0x${string}`;
};

const optionalHash = (
  value: unknown,
  label: string,
): `0x${string}` | undefined =>
  value === undefined ? undefined : requestHash(value, label);

const requestTrack = (value: unknown): KeeperTrack | undefined => {
  if (value === undefined) return undefined;
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) {
    throw new TypeError("track must be from 1 to 4");
  }
  return value;
};

const requestEnum = <Value extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<Value>,
): Value => {
  const candidate = requiredString(value, label) as Value;
  if (!allowed.has(candidate)) throw new TypeError(`${label} is unsupported`);
  return candidate;
};

const optionalFailureClass = (
  value: unknown,
): KeeperAttemptFailureClass | undefined =>
  value === undefined
    ? undefined
    : requestEnum(value, "failureClass", keeperFailureClasses);

const readRequestJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAXIMUM_INGESTION_BYTES) {
      throw new RangeError("Keeper attempt ingestion body is too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const runInputFrom = (body: JsonRecord, recordedAt: bigint) => ({
  runId: requiredString(body.runId, "runId"),
  observedBlock: requestDecimal(body.observedBlock, "observedBlock"),
  observedAt: requestDecimal(body.observedAt, "observedAt"),
  recordedAt,
});

const recordAttemptFrom = (body: JsonRecord, recordedAt: bigint) => {
  const track = requestTrack(body.track);
  const failureClass = optionalFailureClass(body.failureClass);
  const transactionHash = optionalHash(body.transactionHash, "transactionHash");
  if (body.receipt !== undefined) {
    throw new TypeError("Operator ingestion cannot provide receipt evidence");
  }
  return {
    attemptId: requiredString(body.attemptId, "attemptId"),
    runId: requiredString(body.runId, "runId"),
    actionKind: requestEnum(body.actionKind, "actionKind", keeperActionKinds),
    ...(track === undefined ? {} : { track }),
    observedBlock: requestDecimal(body.observedBlock, "observedBlock"),
    observedAt: requestDecimal(body.observedAt, "observedAt"),
    recordedAt,
    outcome: requestEnum(body.outcome, "outcome", keeperOperatorOutcomes),
    ...(failureClass === undefined ? {} : { failureClass }),
    ...(transactionHash === undefined ? {} : { transactionHash }),
  };
};

const ingestKeeperAttempt = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: NonNullable<HistoryHttpServerOptions["keeperAttempts"]>,
): Promise<void> => {
  try {
    const mediaType = request.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      throw new TypeError("Keeper attempt ingestion requires JSON");
    }
    const body = jsonRecord(await readRequestJson(request), "ingestion body");
    const type = requiredString(body.type, "type");
    const recordedAt = options.currentTime();
    if (type === "run-started") {
      options.store.startRun(runInputFrom(body, recordedAt));
    } else if (type === "attempt-observed") {
      options.store.recordAttempt(recordAttemptFrom(body, recordedAt));
    } else if (type === "run-completed") {
      options.store.completeRun(runInputFrom(body, recordedAt));
    } else {
      throw new TypeError("Unsupported keeper attempt ingestion type");
    }
    noContent(response);
  } catch {
    json(response, 400, { error: "invalid-keeper-attempt" });
  }
};

const indexPosition = (options: HistoryHttpServerOptions) => {
  const checkpoint = options.store.readCheckpoint();
  return {
    coverage: {
      fromBlock: options.configuration.launchBlock,
      indexedThroughBlock: checkpoint?.blockNumber,
      indexedThroughTime: checkpoint?.blockTimestamp,
    },
    head: {
      observedBlock: checkpoint?.observedHeadBlock,
      lagBlocks:
        checkpoint === undefined
          ? undefined
          : checkpoint.observedHeadBlock - checkpoint.blockNumber,
    },
  };
};

const statusBody = (options: HistoryHttpServerOptions) => {
  const availability = options.availability.read();
  const checkpoint = options.store.readCheckpoint();
  const confirmedHead =
    checkpoint === undefined ||
    checkpoint.observedHeadBlock < options.configuration.confirmationBlocks
      ? undefined
      : checkpoint.observedHeadBlock - options.configuration.confirmationBlocks;
  const complete =
    checkpoint !== undefined &&
    confirmedHead !== undefined &&
    checkpoint.blockNumber >= confirmedHead;
  return {
    manifest: manifestIdentity(options.configuration),
    snapshot: options.store.readIndexSnapshot(),
    status: {
      state:
        availability.state === "error"
          ? "error"
          : complete
            ? "complete"
            : "partial",
      ...indexPosition(options),
      ...(availability.state === "error"
        ? {
            error: publicAvailabilityFailure(availability),
          }
        : {}),
    },
  };
};

const requestedErrorRange = (options: HistoryHttpServerOptions, url: URL) => {
  const checkpoint = options.store.readCheckpoint();
  return {
    fromBlock:
      url.searchParams.get("fromBlock") ??
      options.configuration.launchBlock.toString(),
    toBlock:
      url.searchParams.get("toBlock") ??
      (checkpoint?.blockNumber ?? options.configuration.launchBlock).toString(),
  };
};

const publicError = (
  options: HistoryHttpServerOptions,
  cause: unknown,
  url: URL,
  failure?: { readonly code: string; readonly message: string },
) => {
  const invalid = cause instanceof RangeError;
  return {
    manifest: manifestIdentity(options.configuration),
    snapshot: options.store.readIndexSnapshot(),
    items: [],
    page: { hasMore: false },
    status: {
      state: "error",
      requested: requestedErrorRange(options, url),
      ...indexPosition(options),
      error: {
        code:
          failure?.code ?? (invalid ? "invalid-query" : "history-unavailable"),
        message:
          failure?.message ??
          (invalid && cause instanceof Error
            ? cause.message
            : "Indexed history is unavailable"),
      },
    },
  };
};

const requestUrl = (request: IncomingMessage): URL =>
  new URL(request.url ?? "/", "http://history-index.local");

const readinessBody = (options: HistoryHttpServerOptions) => {
  const availability = options.availability.read();
  const checkpointReady = options.store.readCheckpoint() !== undefined;
  const ready = checkpointReady && availability.state === "ready";
  let status: "ready" | "error" | "backfill" = "backfill";
  if (ready) status = "ready";
  else if (checkpointReady) status = "error";
  return {
    ready,
    body: {
      status,
      ...(availability.state === "error"
        ? { error: publicAvailabilityFailure(availability) }
        : {}),
    },
  } as const;
};

const handleKeeperEvidence = (
  response: ServerResponse,
  options: HistoryHttpServerOptions,
): void => {
  const keeperAttempts = options.keeperAttempts;
  if (keeperAttempts === undefined) {
    json(response, 503, { error: "keeper-attempt-evidence-unavailable" });
    return;
  }
  const keeperAvailability = keeperAttempts.availability?.read();
  if (keeperAvailability?.state === "error") {
    json(response, 503, {
      error: "keeper-attempt-evidence-unavailable",
      code: keeperAvailability.code,
    });
    return;
  }
  try {
    json(response, 200, {
      manifest: manifestIdentity(options.configuration),
      evidence: keeperAttempts.store.readEvidence({
        currentTime: keeperAttempts.currentTime(),
        maximumAgeSeconds: keeperAttempts.maximumAgeSeconds,
      }),
    });
  } catch {
    json(response, 503, { error: "keeper-attempt-evidence-unavailable" });
  }
};

const handleServiceRoute = (
  pathname: string,
  response: ServerResponse,
  options: HistoryHttpServerOptions,
): boolean => {
  if (pathname === "/healthz") {
    json(response, 200, { status: "up" });
    return true;
  }
  if (pathname === "/readyz") {
    const readiness = readinessBody(options);
    json(response, readiness.ready ? 200 : 503, readiness.body);
    return true;
  }
  if (pathname === "/v1/status") {
    const availability = options.availability.read();
    json(
      response,
      availability.state === "ready" ? 200 : 503,
      statusBody(options),
    );
    return true;
  }
  if (pathname === "/v1/protocol/keeper-attempts") {
    handleKeeperEvidence(response, options);
    return true;
  }
  return false;
};

const handleMarketCandles = async (
  response: ServerResponse,
  options: HistoryHttpServerOptions,
): Promise<void> => {
  let feed: CanonicalMarketCandleFeed;
  if (options.marketCandles === undefined) {
    feed = { source: "uniswap-v4-subgraph", state: "unconfigured" };
  } else {
    try {
      feed = await options.marketCandles.readLatest();
    } catch {
      // The chart can fall back to the local canonical Swap series. Provider
      // errors stay server-side and no configured URL or credential is ever
      // projected into this public response.
      feed = { source: "uniswap-v4-subgraph", state: "unavailable" };
    }
  }
  json(response, 200, {
    manifest: manifestIdentity(options.configuration),
    feed,
  });
};

const handleKeeperIngestion = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: HistoryHttpServerOptions,
  pathname: string,
): Promise<boolean> => {
  if (
    request.method !== "POST" ||
    pathname !== "/internal/v1/keeper-attempts"
  ) {
    return false;
  }
  if (options.ingestApiToken === undefined) {
    json(response, 503, {
      error: "keeper-attempt-ingestion-auth-not-configured",
    });
    return true;
  }
  if (!authorized(request, options.ingestApiToken)) {
    json(response, 401, { error: "unauthorized" });
    return true;
  }
  if (options.keeperAttempts === undefined) {
    json(response, 503, { error: "keeper-attempt-ingestion-unavailable" });
    return true;
  }
  await ingestKeeperAttempt(request, response, options.keeperAttempts);
  return true;
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: HistoryHttpServerOptions,
): Promise<void> => {
  const url = requestUrl(request);
  if (await handleKeeperIngestion(request, response, options, url.pathname))
    return;
  if (request.method !== "GET") {
    json(response, 405, { error: "method-not-allowed" });
    return;
  }
  if (!authorized(request, options.readApiToken)) {
    json(response, 401, { error: "unauthorized" });
    return;
  }
  if (handleServiceRoute(url.pathname, response, options)) return;
  if (url.pathname === "/v1/market/candles") {
    await handleMarketCandles(response, options);
    return;
  }
  const eventNames = routeEvents[url.pathname];
  if (eventNames === undefined) {
    json(response, 404, { error: "not-found" });
    return;
  }
  const availability = options.availability.read();
  if (availability.state === "error") {
    json(
      response,
      503,
      publicError(
        options,
        availability,
        url,
        publicAvailabilityFailure(availability),
      ),
    );
    return;
  }
  try {
    const page = options.store.queryEvents(queryFrom(url, eventNames, options));
    json(response, 200, {
      manifest: manifestIdentity(options.configuration),
      ...page,
    });
  } catch (cause) {
    json(
      response,
      cause instanceof RangeError ? 400 : 500,
      publicError(options, cause, url),
    );
  }
};

const stopServer = (
  server: ReturnType<typeof createServer>,
): Effect.Effect<void> =>
  Effect.async((resume) => {
    server.close(() => resume(Effect.void));
  });

export const acquireHistoryHttpServer = (
  options: HistoryHttpServerOptions,
): Effect.Effect<RunningHistoryHttpServer, HistoryHttpError, Scope.Scope> => {
  if (
    options.readApiToken !== undefined &&
    options.readApiToken === options.ingestApiToken
  ) {
    return Effect.fail(
      new HistoryHttpError({
        message: "History read and ingestion credentials must be distinct",
        cause: new Error("History service credential scopes overlap"),
      }),
    );
  }
  return Effect.acquireRelease(
    Effect.async<
      RunningHistoryHttpServer & {
        readonly server: ReturnType<typeof createServer>;
      },
      HistoryHttpError
    >((resume) => {
      const server = createServer((request, response) => {
        void handleRequest(request, response, options).catch(
          (cause: unknown) => {
            // The last-resort handler answers requests that failed before any
            // authorization ran -- a malformed request-target throws in URL
            // parsing ahead of the token check -- so it must not embed the
            // manifest fingerprint or index snapshot the authorized error
            // body carries. It also must not throw itself: parsing the
            // request URL again here crashed the process on the exact input
            // that got us here.
            if (!response.headersSent) {
              json(response, 500, {
                status: {
                  state: "error",
                  error: {
                    code: "history-unavailable",
                    message: "Indexed history is unavailable",
                  },
                },
              });
            } else {
              response.destroy(cause instanceof Error ? cause : undefined);
            }
          },
        );
      });
      const fail = (cause: Error): void => {
        resume(
          Effect.fail(
            new HistoryHttpError({
              message: "Could not start history HTTP server",
              cause,
            }),
          ),
        );
      };
      server.once("error", fail);
      server.listen(options.port, options.host, () => {
        server.removeListener("error", fail);
        const address = server.address() as AddressInfo;
        resume(
          Effect.succeed({
            url: `http://${options.host}:${address.port}`,
            server,
          }),
        );
      });
      return Effect.sync(() => server.close());
    }),
    ({ server }) => stopServer(server),
  ).pipe(Effect.map(({ url }) => ({ url })));
};
