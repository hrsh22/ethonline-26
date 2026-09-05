import { describe, expect, it } from "vitest";

import {
  createWebQueryClient,
  WEB_QUERY_STALE_TIME_MILLISECONDS,
} from "./query-client";

describe("web query policy", () => {
  it("does not spend RPC or API capacity while an idle tab stays open", () => {
    const client = createWebQueryClient();

    expect(client.getDefaultOptions().queries).toMatchObject({
      refetchInterval: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: WEB_QUERY_STALE_TIME_MILLISECONDS,
    });

    client.clear();
  });
});
