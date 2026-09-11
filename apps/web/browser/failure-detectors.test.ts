import { describe, expect, it } from "vitest";

import { failedAssetRequest } from "./failure-detectors.ts";

describe("failed asset request classification", () => {
  it("ignores Chromium ORB failures for optional WalletConnect logo artwork", () => {
    expect(
      failedAssetRequest({
        errorText: "net::ERR_BLOCKED_BY_ORB",
        resourceType: "image",
        url: "https://explorer-api.walletconnect.com/v3/logo/sm/example?projectId=public-id",
      }),
    ).toBeUndefined();
  });

  it("still reports first-party image failures", () => {
    expect(
      failedAssetRequest({
        errorText: "net::ERR_FAILED",
        resourceType: "image",
        url: "http://127.0.0.1:3100/missing.png",
      }),
    ).toEqual({
      kind: "asset-failed",
      detail: "image http://127.0.0.1:3100/missing.png (net::ERR_FAILED)",
    });
  });

  it("still reports non-ORB WalletConnect artwork failures", () => {
    expect(
      failedAssetRequest({
        errorText: "net::ERR_CONNECTION_RESET",
        resourceType: "image",
        url: "https://explorer-api.walletconnect.com/v3/logo/sm/example",
      }),
    ).toMatchObject({ kind: "asset-failed" });
  });
});
