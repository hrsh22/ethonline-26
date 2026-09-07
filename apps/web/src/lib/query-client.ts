import { QueryClient } from "@tanstack/react-query";

/**
 * Browser reads refresh on an explicit action, a stale-window focus, or a
 * reconnect. The wallet query also follows pending discoveries, incomplete
 * reads, and confirmed transactions until they settle. Idle snapshots do not
 * poll because each one fans out into several RPC calls.
 */
export const WEB_QUERY_STALE_TIME_MILLISECONDS = 30_000;

export const createWebQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: false,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        retry: false,
        staleTime: WEB_QUERY_STALE_TIME_MILLISECONDS,
      },
    },
  });
