import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { createKeeperAttemptRecorder } from "./keeper-attempt-client.ts";

const INGEST_TOKEN = Buffer.from(
  "base-quotron-test:ingest-v1".padEnd(32, "."),
).toString("base64url");

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("No port");
      resolve(address.port);
    });
  });
const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );

describe("keeper-attempt recorder", () => {
  it("retries bounded transient failures and serializes bigint milestones", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const recorder = createKeeperAttemptRecorder({
      ingestApiToken: INGEST_TOKEN,
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
      maximumAttempts: 2,
    });

    await recorder.observeAttempt({
      type: "attempt-observed",
      attemptId: "track-2",
      runId: "run-1",
      actionKind: "reward-track",
      track: 2,
      observedBlock: 123n,
      observedAt: 456n,
      outcome: "pending",
      transactionHash: `0x${"a".repeat(64)}`,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/internal/v1/keeper-attempts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${INGEST_TOKEN}`,
        }),
        body: expect.stringContaining('"observedBlock":"123"'),
      }),
    );
  });

  it("fails closed after the configured number of attempts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const recorder = createKeeperAttemptRecorder({
      baseUrl: "http://127.0.0.1:8787",
      ingestApiToken: INGEST_TOKEN,
      fetcher,
      maximumAttempts: 2,
    });

    await expect(
      recorder.startRun({
        type: "run-started",
        runId: "run-1",
        observedBlock: 1n,
        observedAt: 2n,
      }),
    ).rejects.toThrow("status 503");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures or accept credentialed URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const recorder = createKeeperAttemptRecorder({
      baseUrl: "http://127.0.0.1:8787",
      ingestApiToken: INGEST_TOKEN,
      fetcher,
      maximumAttempts: 3,
    });

    await expect(
      recorder.startRun({
        type: "run-started",
        runId: "run-1",
        observedBlock: 1n,
        observedAt: 2n,
      }),
    ).rejects.toThrow("status 401");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() =>
      createKeeperAttemptRecorder({
        baseUrl: "https://token@history.internal",
        ingestApiToken: INGEST_TOKEN,
      }),
    ).toThrow("exact root http://127.0.0.1:<port>");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe destinations and credentials before fetch", () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const baseUrl of [
      "https://127.0.0.1:8787",
      "http://localhost:8787",
      "http://127.0.0.1:8787/relay",
      "http://127.0.0.1:8787?redirect=https://evil.example",
    ]) {
      expect(() =>
        createKeeperAttemptRecorder({
          baseUrl,
          ingestApiToken: INGEST_TOKEN,
          fetcher,
        }),
      ).toThrow("exact root http://127.0.0.1:<port>");
    }
    expect(() =>
      createKeeperAttemptRecorder({
        baseUrl: "http://127.0.0.1:8787",
        ingestApiToken: "weak",
        fetcher,
      }),
    ).toThrow("43 to 512");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never follows same-origin-path or cross-port redirects", async () => {
    let redirectedRequests = 0;
    const target = createServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(204).end();
    });
    const targetPort = await listen(target);
    let redirectLocation = "/redirected";
    const origin = createServer((request, response) => {
      if (request.url === "/redirected") redirectedRequests += 1;
      response.writeHead(307, { location: redirectLocation }).end();
    });
    const originPort = await listen(origin);
    try {
      const recorder = () =>
        createKeeperAttemptRecorder({
          baseUrl: `http://127.0.0.1:${originPort}`,
          ingestApiToken: INGEST_TOKEN,
          maximumAttempts: 1,
        });
      await expect(
        recorder().startRun({
          type: "run-started",
          runId: "same-origin",
          observedBlock: 1n,
          observedAt: 2n,
        }),
      ).rejects.toThrow("network request failed");
      redirectLocation = `http://127.0.0.1:${targetPort}/captured`;
      await expect(
        recorder().startRun({
          type: "run-started",
          runId: "cross-port",
          observedBlock: 1n,
          observedAt: 2n,
        }),
      ).rejects.toThrow("network request failed");
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([close(origin), close(target)]);
    }
  });
});
