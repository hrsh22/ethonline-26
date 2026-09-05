import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect, Either } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { createKeeperAttemptRecorder } from "./keeper-attempt-client.ts";
import {
  openKeeperAttemptOutbox,
  replayKeeperAttemptOutbox,
} from "./keeper-attempt-outbox.ts";
import { createHistoryAvailability } from "./history-indexer/availability.ts";
import { deriveHistoryIndexConfiguration } from "./history-indexer/configuration.ts";
import { acquireHistoryHttpServer } from "./history-indexer/http-server.ts";
import { openKeeperAttemptStore } from "./history-indexer/keeper-attempt-store.ts";
import { resolveHistoryListenerPolicy } from "./history-indexer/listener-policy.ts";
import { openHistoryStore } from "./history-indexer/sqlite-store.ts";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/31337.json", "utf8")) as unknown,
);
const configuration = deriveHistoryIndexConfiguration(manifest);
const temporaryDirectories: string[] = [];
const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const READ_TOKEN_V1 = historyCredentialFixture("read-v1");
const INGEST_TOKEN_V1 = historyCredentialFixture("ingest-v1");
const READ_TOKEN_V2 = historyCredentialFixture("read-v2");
const INGEST_TOKEN_V2 = historyCredentialFixture("ingest-v2");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-keeper-http-"));
  temporaryDirectories.push(directory);
  return directory;
};

const post = (url: string, token: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("keeper attempt HTTP boundary", () => {
  it("rejects shared read and ingestion credentials before listening", async () => {
    const directory = temporaryDirectory();
    const historyStore = openHistoryStore(
      join(directory, "history.sqlite"),
      configuration,
    );
    const availability = createHistoryAvailability();
    availability.markReady();

    const result = await Effect.runPromise(
      Effect.either(
        Effect.scoped(
          acquireHistoryHttpServer({
            readApiToken: READ_TOKEN_V1,
            ingestApiToken: READ_TOKEN_V1,
            availability,
            configuration,
            host: "127.0.0.1",
            port: 0,
            store: historyStore,
          }),
        ),
      ),
    );
    historyStore.close();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toBe(
        "History read and ingestion credentials must be distinct",
      );
      expect(String(result.left.cause)).not.toContain(READ_TOKEN_V1);
    }
  });

  it("keeps ingestion authenticated and serves only public-safe evidence", async () => {
    const directory = temporaryDirectory();
    const historyStore = openHistoryStore(
      join(directory, "history.sqlite"),
      configuration,
    );
    const attemptStore = openKeeperAttemptStore(
      join(directory, "keeper.sqlite"),
      {
        chainId: configuration.chainId,
        manifestFingerprint: configuration.manifestFingerprint,
      },
    );
    const availability = createHistoryAvailability();
    availability.markReady();
    const readToken = READ_TOKEN_V1;
    const ingestToken = INGEST_TOKEN_V1;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquireHistoryHttpServer({
            readApiToken: readToken,
            ingestApiToken: ingestToken,
            availability,
            configuration,
            host: "127.0.0.1",
            port: 0,
            store: historyStore,
            keeperAttempts: {
              currentTime: () => 120n,
              maximumAgeSeconds: 30n,
              store: attemptStore,
            },
          });
          const internalUrl = `${server.url}/internal/v1/keeper-attempts`;
          const publicUrl = `${server.url}/v1/protocol/keeper-attempts`;
          const unauthorized = yield* Effect.promise(() =>
            fetch(internalUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
          );
          expect(unauthorized.status).toBe(401);

          const readCannotIngest = yield* Effect.promise(() =>
            post(internalUrl, readToken, {
              type: "run-started",
              runId: "wrong-scope-read",
              observedBlock: "90",
              observedAt: "900",
            }),
          );
          expect(readCannotIngest.status).toBe(401);

          const started = yield* Effect.promise(() =>
            post(internalUrl, ingestToken, {
              type: "run-started",
              runId: "http-run",
              observedBlock: "90",
              observedAt: "900",
            }),
          );
          expect(started.status).toBe(204);
          const outbox = openKeeperAttemptOutbox(
            join(directory, "outbox.sqlite"),
            {
              chainId: configuration.chainId,
              manifestFingerprint: configuration.manifestFingerprint,
            },
          );
          outbox.enqueue(
            {
              runStarted: {
                type: "run-started",
                runId: "http-run",
                observedBlock: 90n,
                observedAt: 900n,
              },
              attempt: {
                type: "attempt-observed",
                attemptId: "http-epoch",
                runId: "http-run",
                actionKind: "reward-epoch",
                observedBlock: 100n,
                observedAt: 1_000n,
                outcome: "pending",
                transactionHash: `0x${"c".repeat(64)}`,
              },
            },
            1_001n,
          );
          yield* Effect.promise(() =>
            replayKeeperAttemptOutbox(
              outbox,
              createKeeperAttemptRecorder({
                ingestApiToken: ingestToken,
                baseUrl: server.url,
                maximumAttempts: 1,
              }),
            ),
          );
          expect(outbox.pendingDeliveries()).toEqual([]);
          outbox.close();
          const forgedFinal = yield* Effect.promise(() =>
            post(internalUrl, ingestToken, {
              type: "attempt-observed",
              attemptId: "forged-track-1",
              runId: "http-run",
              actionKind: "reward-track",
              track: 1,
              observedBlock: "100",
              observedAt: "1000",
              outcome: "succeeded",
              transactionHash: `0x${"a".repeat(64)}`,
              receipt: {
                blockNumber: "101",
                blockHash: `0x${"b".repeat(64)}`,
                blockTimestamp: "1001",
              },
            }),
          );
          expect(forgedFinal.status).toBe(400);
          for (const track of [1, 2, 3, 4] as const) {
            const response = yield* Effect.promise(() =>
              post(internalUrl, ingestToken, {
                type: "attempt-observed",
                attemptId: `http-track-${track}`,
                runId: "http-run",
                actionKind: "reward-track",
                track,
                observedBlock: "100",
                observedAt: "1000",
                outcome:
                  track === 2 ? "failed-before-submission" : "not-required",
                ...(track === 2 ? { failureClass: "preflight-rejected" } : {}),
                rawReason: `private RPC diagnostic ${ingestToken}`,
              }),
            );
            expect(response.status).toBe(204);
          }
          const completed = yield* Effect.promise(() =>
            post(internalUrl, ingestToken, {
              type: "run-completed",
              runId: "http-run",
              observedBlock: "100",
              observedAt: "1000",
            }),
          );
          expect(completed.status).toBe(204);

          const ingestCannotRead = yield* Effect.promise(() =>
            fetch(publicUrl, {
              headers: { authorization: `Bearer ${ingestToken}` },
            }),
          );
          expect(ingestCannotRead.status).toBe(401);

          const response = yield* Effect.promise(() =>
            fetch(publicUrl, {
              headers: { authorization: `Bearer ${readToken}` },
            }),
          );
          const serialized = yield* Effect.promise(() => response.text());
          expect(response.status).toBe(200);
          expect(JSON.parse(serialized)).toMatchObject({
            manifest: {
              chainId: configuration.chainId,
              fingerprint: configuration.manifestFingerprint,
            },
            evidence: {
              source: "keeper-attempt-journal",
              state: "fresh",
              coverage: {
                1: "complete",
                2: "complete",
                3: "complete",
                4: "complete",
              },
              tracks: {
                2: {
                  state: "retryable",
                  latest: {
                    actionKind: "reward-track",
                    track: 2,
                    outcome: "failed-before-submission",
                    failureClass: "preflight-rejected",
                  },
                },
              },
            },
          });
          expect(serialized).not.toContain(readToken);
          expect(serialized).not.toContain(ingestToken);
          expect(serialized).not.toContain("private RPC diagnostic");
          expect(serialized).not.toContain("rawReason");
          expect(serialized).not.toContain("http-run");
          expect(serialized).not.toContain("http-track");
        }),
      ),
    );
    attemptStore.close();
    historyStore.close();
  });

  it("rotates read and ingestion credentials independently", async () => {
    const exercise = async ({
      ingestToken,
      rejectedIngestToken,
      readToken,
      rejectedReadToken,
      runId,
    }: {
      readonly ingestToken: string;
      readonly rejectedIngestToken: string;
      readonly readToken: string;
      readonly rejectedReadToken: string;
      readonly runId: string;
    }) => {
      const directory = temporaryDirectory();
      const historyStore = openHistoryStore(
        join(directory, "history.sqlite"),
        configuration,
      );
      const attemptStore = openKeeperAttemptStore(
        join(directory, "keeper.sqlite"),
        {
          chainId: configuration.chainId,
          manifestFingerprint: configuration.manifestFingerprint,
        },
      );
      const availability = createHistoryAvailability();
      availability.markReady();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const listener = resolveHistoryListenerPolicy({
              host: "127.0.0.1",
              readApiToken: readToken,
              ingestApiToken: ingestToken,
            });
            const server = yield* acquireHistoryHttpServer({
              readApiToken: listener.readApiToken,
              ingestApiToken: listener.ingestApiToken,
              availability,
              configuration,
              host: listener.host,
              port: 0,
              store: historyStore,
              keeperAttempts: {
                currentTime: () => 120n,
                maximumAgeSeconds: 30n,
                store: attemptStore,
              },
            });
            const statusUrl = `${server.url}/v1/status`;
            const internalUrl = `${server.url}/internal/v1/keeper-attempts`;
            const acceptedRead = yield* Effect.promise(() =>
              fetch(statusUrl, {
                headers: { authorization: `Bearer ${readToken}` },
              }),
            );
            const rejectedRead = yield* Effect.promise(() =>
              fetch(statusUrl, {
                headers: {
                  authorization: `Bearer ${rejectedReadToken}`,
                },
              }),
            );
            const acceptedIngestion = yield* Effect.promise(() =>
              post(internalUrl, ingestToken, {
                type: "run-started",
                runId,
                observedBlock: "90",
                observedAt: "900",
              }),
            );
            const rejectedIngestion = yield* Effect.promise(() =>
              post(internalUrl, rejectedIngestToken, {
                type: "run-started",
                runId: `${runId}-rejected`,
                observedBlock: "90",
                observedAt: "900",
              }),
            );

            expect(acceptedRead.status).toBe(200);
            expect(rejectedRead.status).toBe(401);
            expect(acceptedIngestion.status).toBe(204);
            expect(rejectedIngestion.status).toBe(401);
          }),
        ),
      );
      attemptStore.close();
      historyStore.close();
    };

    await exercise({
      readToken: READ_TOKEN_V2,
      rejectedReadToken: READ_TOKEN_V1,
      ingestToken: INGEST_TOKEN_V1,
      rejectedIngestToken: INGEST_TOKEN_V2,
      runId: "read-rotated",
    });
    await exercise({
      readToken: READ_TOKEN_V2,
      rejectedReadToken: READ_TOKEN_V1,
      ingestToken: INGEST_TOKEN_V2,
      rejectedIngestToken: INGEST_TOKEN_V1,
      runId: "ingest-rotated",
    });
  });
});
