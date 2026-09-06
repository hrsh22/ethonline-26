import { describe, expect, it } from "vitest";
import { createPublicClient } from "viem";
import { foundry } from "viem/chains";

import {
  createWebReadRpcTransport,
  createWebTransactionRpcTransport,
  webProtocolQueryRetryCount,
  webRpcTransportPolicy,
  webTransactionRpcTransportPolicy,
} from "./web-rpc-policy";

describe("interactive web RPC failure policy", () => {
  it("uses a five-second deadline with one backed-off transport retry", () => {
    const transport = createWebReadRpcTransport("https://rpc.invalid")({
      chain: foundry,
    });
    expect(transport.config).toMatchObject({
      retryCount: 1,
      retryDelay: 1_000,
      timeout: 5_000,
    });
  });

  it("does not multiply transport retries at the query layer", () => {
    expect(webProtocolQueryRetryCount).toBe(0);
  });

  it("backs off before retrying a rate-limited read", async () => {
    let requestCount = 0;
    const fetchFn: typeof fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response("{}", {
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "1",
          },
          status: 429,
        });
      }
      return new Response(
        JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x1" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    };
    const client = createPublicClient({
      chain: foundry,
      transport: createWebReadRpcTransport("https://rpc.invalid", fetchFn),
    });
    const startedAt = performance.now();

    await expect(client.getBlockNumber()).resolves.toBe(1n);

    expect(requestCount).toBe(2);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1_000);
  });

  it.each([429, 200])(
    "shares a rate-limit cooldown across readers after HTTP %s without extending read deadlines",
    async (status) => {
      let requests = 0;
      const endpoint = `https://cooldown-${status}.test`;
      const fetchFn: typeof fetch = async () => {
        requests += 1;
        return Response.json(
          {
            id: 1,
            jsonrpc: "2.0",
            error: { code: 429, message: "Too many requests" },
          },
          { status, headers: { "Retry-After": "60" } },
        );
      };
      const reader = () =>
        createPublicClient({
          chain: foundry,
          transport: createWebReadRpcTransport(endpoint, fetchFn, {
            retryCount: 0,
            retryDelay: 0,
            timeout: 40,
          }),
        });
      await expect(reader().getBlockNumber()).rejects.toThrow();
      await expect(
        reader().getBalance({
          address: "0x0000000000000000000000000000000000000001",
        }),
      ).rejects.toThrow();
      expect(requests).toBe(1);
    },
  );

  it("times out an RPC response whose body never completes", async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Intentionally never enqueue or close: the transport deadline must
        // abort body consumption after the response headers have arrived.
      },
    });
    const fetchFn: typeof fetch = async () =>
      new Response(stalledBody, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    const client = createPublicClient({
      chain: foundry,
      transport: createWebReadRpcTransport("https://rpc.invalid", fetchFn, {
        retryCount: 0,
        retryDelay: 0,
        timeout: 20,
      }),
    });
    const startedAt = performance.now();

    await expect(client.getBlockNumber()).rejects.toThrow();

    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("cancels an oversized RPC body before buffering it", async () => {
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"'));
      },
    });
    const fetchFn: typeof fetch = async () =>
      new Response(oversizedBody, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    const client = createPublicClient({
      chain: foundry,
      transport: createWebReadRpcTransport(
        "https://rpc.invalid",
        fetchFn,
        { retryCount: 0, retryDelay: 0, timeout: 100 },
        4,
      ),
    });

    await expect(client.getBlockNumber()).rejects.toThrow(
      "RPC response body exceeds 4 bytes",
    );
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("keeps the bounded error when advertised-size cancellation rejects", async () => {
    let cancellationAttempted = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellationAttempted = true;
        return Promise.reject(new Error("mock cancellation failed"));
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const fetchFn: typeof fetch = async () =>
      new Response(body, {
        headers: {
          "Content-Length": "99",
          "Content-Type": "application/json",
        },
        status: 200,
      });
    const client = createPublicClient({
      chain: foundry,
      transport: createWebReadRpcTransport(
        "https://rpc.invalid",
        fetchFn,
        { retryCount: 0, retryDelay: 0, timeout: 100 },
        4,
      ),
    });

    await expect(client.getBlockNumber()).rejects.toThrow(
      "RPC response body exceeds 4 bytes",
    );
    expect(cancellationAttempted).toBe(true);
  });

  it("does not wait for a source whose overflow cancellation never settles", async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return new Promise(() => undefined);
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"'));
      },
    });
    const fetchFn: typeof fetch = async () =>
      new Response(body, {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    const client = createPublicClient({
      chain: foundry,
      transport: createWebReadRpcTransport(
        "https://rpc.invalid",
        fetchFn,
        { retryCount: 0, retryDelay: 0, timeout: 100 },
        4,
      ),
    });
    const startedAt = performance.now();

    await expect(client.getBlockNumber()).rejects.toThrow(
      "RPC response body exceeds 4 bytes",
    );
    expect(performance.now() - startedAt).toBeLessThan(80);
  });

  it("keeps transaction RPC semantics separate from bounded UI reads", () => {
    const readTransport = createWebReadRpcTransport("https://rpc.invalid");
    const transactionTransport = createWebTransactionRpcTransport(
      "https://rpc.invalid",
    );
    const read = readTransport({ chain: foundry });
    const transaction = transactionTransport({ chain: foundry });

    expect(readTransport).not.toBe(transactionTransport);
    expect(read.config.retryCount).toBe(webRpcTransportPolicy.retryCount);
    expect(read.config.timeout).toBe(webRpcTransportPolicy.timeout);
    expect(transaction.config.retryCount).toBe(
      webTransactionRpcTransportPolicy.retryCount,
    );
    expect(transaction.config.timeout).toBe(
      webTransactionRpcTransportPolicy.timeout,
    );
    expect(webTransactionRpcTransportPolicy).toEqual({
      retryCount: 1,
      retryDelay: 1_000,
      timeout: 30_000,
    });
  });
});
