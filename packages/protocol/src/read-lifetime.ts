import { Data, Effect, Either } from "effect";

export class PublicReadTimeoutError extends Data.TaggedError(
  "PublicReadTimeoutError",
)<{
  readonly message: string;
}> {}

/** The signal owns actual HTTP work, not just the caller's wait for it. */
export const runPublicRead = async <Result>(
  read: (signal: AbortSignal) => Promise<Result>,
  {
    signal,
    timeoutMilliseconds = 8_000,
  }: {
    readonly signal?: AbortSignal | undefined;
    readonly timeoutMilliseconds?: number;
  } = {},
): Promise<Result> => {
  const result = await Effect.runPromise(
    Effect.tryPromise({ try: read, catch: (cause) => cause }).pipe(
      Effect.timeoutFail({
        duration: timeoutMilliseconds,
        onTimeout: () =>
          new PublicReadTimeoutError({
            message: `Public protocol read timed out after ${timeoutMilliseconds / 1_000} seconds.`,
          }),
      }),
      Effect.either,
    ),
    { signal },
  );
  if (Either.isLeft(result)) throw result.left;
  return result.right;
};

/** A fresh binding per query also preserves viem's shorter per-request timeout. */
export const bindReadSignal =
  (fetcher: typeof fetch, signal: AbortSignal): typeof fetch =>
  async (input, init) => {
    signal.throwIfAborted();
    const requestSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const response = await fetcher(input, {
      ...init,
      signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
    });
    signal.throwIfAborted();
    return response;
  };
