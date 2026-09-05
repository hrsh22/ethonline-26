import { QueryClient } from "@tanstack/react-query";

/**
 * Browser reads refresh on an explicit action, a stale-window focus, or a
 * reconnect. They never run on a standing timer: one protocol snapshot fans
 * out into enough RPC calls that an idle tab can otherwise consume the public
 * provider's rate budget before a real transaction begins.
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
