import { describe, expect, it } from "vitest";

import { decodeTestnetFundingResponse } from "../src/testnet-funding.js";

describe("testnet funding wire response", () => {
  it("decodes the versioned public states shared by the worker and web client", () => {
    expect(
      decodeTestnetFundingResponse({
        apiVersion: 1,
        service: {
          chainId: 84_532,
          state: "inventory-empty",
        },
        recipient: {
          address: "0x2000000000000000000000000000000000000002",
          state: "pending",
        },
        request: {
          id: "request-1",
          state: "retryable",
          transactions: [],
        },
        error: {
          code: "funding-rpc-unavailable",
          message: "Receipt RPC is temporarily unavailable",
        },
      }),
    ).toMatchObject({
      apiVersion: 1,
      service: { state: "inventory-empty" },
      recipient: { state: "pending" },
      request: { state: "retryable" },
      error: { code: "funding-rpc-unavailable" },
    });
  });

  it("rejects unsupported versions and invented service or recipient states", () => {
    expect(() =>
      decodeTestnetFundingResponse({
        apiVersion: 2,
        service: { chainId: 84_532, state: "ready" },
      }),
    ).toThrow();
    expect(() =>
      decodeTestnetFundingResponse({
        apiVersion: 1,
        recipient: {
          address: "0x2000000000000000000000000000000000000002",
          state: "mystery",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeTestnetFundingResponse({
        apiVersion: 1,
        error: { code: "funding-invented-state" },
      }),
    ).toThrow();
  });
});
