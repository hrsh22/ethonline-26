import { http } from "viem";

export interface WebRpcTransportPolicy {
  readonly retryCount: number;
  readonly retryDelay: number;
  readonly timeout: number;
}

export const webRpcTransportPolicy = {
  retryCount: 1,
  retryDelay: 250,
  timeout: 5_000,
} as const satisfies WebRpcTransportPolicy;

// Transactions keep the conservative policy that existed before interactive
// status and balance reads received a bounded failure budget. In particular,
// receipt polling must not inherit the shorter UI-read policy after a wallet
// has already submitted a transaction.
export const webTransactionRpcTransportPolicy = {
  retryCount: 6,
  retryDelay: 250,
  timeout: 30_000,
} as const satisfies WebRpcTransportPolicy;

export const webProtocolQueryRetryCount = 0;

type RpcFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAXIMUM_RPC_RESPONSE_BODY_BYTES = 10_485_760;

class RpcResponseBodyTooLargeError extends Error {
  constructor(maximumBytes: number) {
    super(`RPC response body exceeds ${maximumBytes} bytes`);
    this.name = "RpcResponseBodyTooLargeError";
  }
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("RPC request aborted", "AbortError");

const ignoreCancellationFailure = (
  cancel: () => Promise<unknown>,
): Promise<void> => {
  let cancellation: Promise<unknown>;
  try {
    cancellation = cancel();
  } catch {
    return Promise.resolve();
  }
  return cancellation.then(
    () => undefined,
    () => undefined,
  );
};

const withinAbortSignal = <Value>(
  operation: Promise<Value>,
  signal: AbortSignal | null | undefined,
  cancel: () => Promise<unknown>,
): Promise<Value> => {
  if (signal === null || signal === undefined) return operation;
  if (signal.aborted) {
    void ignoreCancellationFailure(cancel);
    return Promise.reject(abortReason(signal));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void ignoreCancellationFailure(cancel);
      reject(abortReason(signal));
    };
    const settle =
      <Settled>(finish: (value: Settled) => void) =>
      (value: Settled) => {
        signal.removeEventListener("abort", onAbort);
        finish(value);
      };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(settle(resolve), settle(reject));
  });
};

const readResponseBodyWithinSignal = async (
  response: Response,
  signal: AbortSignal | null | undefined,
  maximumBytes: number,
) => {
  const contentLength = Number.parseInt(
    response.headers.get("Content-Length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    void ignoreCancellationFailure(async () => response.body?.cancel());
    throw new RpcResponseBodyTooLargeError(maximumBytes);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await withinAbortSignal(reader.read(), signal, async () =>
        reader.cancel(),
      );
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maximumBytes) {
        void ignoreCancellationFailure(async () => reader.cancel());
        throw new RpcResponseBodyTooLargeError(maximumBytes);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const withBoundedResponseHandling =
  (fetchFn: RpcFetch, maximumBytes: number): RpcFetch =>
  async (input, init) => {
    const response = await fetchFn(input, init);
    const body = await readResponseBodyWithinSignal(
      response,
      init?.signal,
      maximumBytes,
    );
    const headers = new Headers(response.headers);
    headers.delete("Retry-After");
    return new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };

export const createWebReadRpcTransport = (
  url: string | undefined,
  fetchFn: RpcFetch = globalThis.fetch,
  policy: WebRpcTransportPolicy = webRpcTransportPolicy,
  maximumResponseBodyBytes = MAXIMUM_RPC_RESPONSE_BODY_BYTES,
) =>
  http(url, {
    ...policy,
    // Viem otherwise replaces retryDelay with an unbounded Retry-After value.
    // One retry still occurs, but it always uses the configured 250 ms delay.
    fetchFn: withBoundedResponseHandling(fetchFn, maximumResponseBodyBytes),
    maxResponseBodySize: maximumResponseBodyBytes,
  });

export const createWebTransactionRpcTransport = (url: string | undefined) =>
  http(url, webTransactionRpcTransportPolicy);
