export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RequestRateLimiter {
  readonly consume: (
    client: string,
    nowMilliseconds: number,
  ) => RateLimitDecision;
}

interface WindowState {
  count: number;
  readonly resetsAt: number;
}

export interface RequestRateLimiterOptions {
  readonly maximumClients: number;
  readonly maximumRequests: number;
  readonly windowMilliseconds: number;
}

const retryAfter = (resetsAt: number, nowMilliseconds: number): number =>
  Math.max(1, Math.ceil((resetsAt - nowMilliseconds) / 1_000));

const evictExpired = (
  windows: Map<string, WindowState>,
  nowMilliseconds: number,
): void => {
  for (const [client, state] of windows) {
    if (state.resetsAt <= nowMilliseconds) windows.delete(client);
  }
};

export const createRequestRateLimiter = ({
  maximumClients,
  maximumRequests,
  windowMilliseconds,
}: RequestRateLimiterOptions): RequestRateLimiter => {
  const windows = new Map<string, WindowState>();
  return {
    consume: (client, nowMilliseconds) => {
      const current = windows.get(client);
      if (current !== undefined && current.resetsAt > nowMilliseconds) {
        current.count += 1;
        return {
          allowed: current.count <= maximumRequests,
          retryAfterSeconds: retryAfter(current.resetsAt, nowMilliseconds),
        };
      }
      if (current !== undefined) windows.delete(client);
      if (windows.size >= maximumClients) {
        evictExpired(windows, nowMilliseconds);
        // Fail closed at capacity. The previous fallback evicted the oldest
        // *live* entry to admit the newcomer, which inverted the control: a
        // flood of fresh client keys -- one IPv6 /64 is 2^64 of them --
        // preferentially evicted its own earlier entries, resetting the
        // attacker's budget to zero on demand while flushing every legitimate
        // client's window state. Denying new clients while the map is full of
        // live windows bounds the damage to at most one window's wait instead.
        if (windows.size >= maximumClients) {
          return {
            allowed: false,
            retryAfterSeconds: Math.ceil(windowMilliseconds / 1_000),
          };
        }
      }
      windows.set(client, {
        count: 1,
        resetsAt: nowMilliseconds + windowMilliseconds,
      });
      return {
        allowed: true,
        retryAfterSeconds: Math.ceil(windowMilliseconds / 1_000),
      };
    },
  };
};
