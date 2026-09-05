import { describe, expect, it } from "vitest";

import { createTestnetFundingView } from "./testnet-funding-view";

const address = "0x2000000000000000000000000000000000000002";
const response = (
  recipientState:
    | "eligible"
    | "already-funded"
    | "funded"
    | "pending"
    | "rate-limited"
    | "limit-reached"
    | "unavailable",
  serviceState: "ready" | "disabled" | "inventory-empty" = "ready",
) => ({
  apiVersion: 1 as const,
  service: { chainId: 84_532, state: serviceState },
  recipient: { address, state: recipientState },
});

describe("testnet faucet state", () => {
  it.each([
    ["disconnected", "disconnected", "connect-wallet"],
    ["wrong-network", "wrong-network", "switch-network"],
    ["deployment-pending", "deployment-pending", "none"],
  ] as const)(
    "keeps %s collector access ahead of funding state",
    (accessState, state, action) => {
      expect(
        createTestnetFundingView({
          accessState,
          response: response("eligible"),
        }),
      ).toMatchObject({ state, action });
    },
  );

  it.each([
    [response("eligible"), "eligible", "fund"],
    [response("pending"), "pending", "retry-funding"],
    [response("already-funded"), "funded", "trade"],
    [response("funded"), "funded", "trade"],
    [response("rate-limited"), "cooldown", "retry-status"],
    [response("limit-reached"), "lifetime-exhausted", "none"],
    [
      response("unavailable", "inventory-empty"),
      "inventory-empty",
      "retry-status",
    ],
    [response("unavailable", "disabled"), "disabled", "retry-status"],
  ] as const)(
    "maps a public response to %s",
    (fundingResponse, state, action) => {
      expect(
        createTestnetFundingView({
          accessState: "ready",
          response: fundingResponse,
        }),
      ).toMatchObject({ state, action });
    },
  );

  it("distinguishes RPC evidence failure from a general service outage", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        response: {
          apiVersion: 1,
          error: { code: "funding-rpc-unavailable" },
        },
      }),
    ).toMatchObject({ state: "rpc-unavailable", action: "retry-status" });
    expect(
      createTestnetFundingView({
        accessState: "ready",
        queryFailed: true,
      }),
    ).toMatchObject({ state: "unavailable", action: "retry-status" });
  });

  it("does not send a wallet that kept nothing on to trade", () => {
    // The transfers confirmed and the allowance is spent, but the wallet
    // forwarded the gas. Offering "Buy on Trade" here walks a collector with
    // no gas into a failing transaction.
    expect(
      createTestnetFundingView({
        accessState: "ready",
        response: {
          apiVersion: 1,
          recipient: { address, state: "funded", retainedTargets: false },
        },
      }),
    ).toMatchObject({ state: "funded-not-retained", action: "retry-status" });
    expect(
      createTestnetFundingView({
        accessState: "ready",
        response: {
          apiVersion: 1,
          recipient: { address, state: "funded", retainedTargets: true },
        },
      }),
    ).toMatchObject({ state: "funded", action: "trade" });
  });

  it("says the faucet is occupied rather than broken", () => {
    // One abandoned request refused every other wallet, and masking the reason
    // told the collector the service was down when it was serving someone else.
    expect(
      createTestnetFundingView({
        accessState: "ready",
        hasMutationResponse: true,
        response: { apiVersion: 1, error: { code: "funding-busy" } },
      }),
    ).toMatchObject({ state: "busy", action: "retry-funding" });
  });

  it("separates a settling balance read from an unavailable node", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        response: { apiVersion: 1, error: { code: "funding-confirming" } },
      }),
    ).toMatchObject({ state: "confirming", action: "retry-funding" });
  });

  it("distinguishes a retryable transfer from an in-flight mutation", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        hasMutationResponse: true,
        response: {
          apiVersion: 1,
          request: { id: "retry", state: "retryable" },
          error: { code: "funding-failed" },
        },
      }),
    ).toMatchObject({ state: "retryable", action: "retry-funding" });
    expect(
      createTestnetFundingView({
        accessState: "ready",
        mutationPending: true,
      }),
    ).toMatchObject({ state: "submitting", action: "none" });
  });

  it("turns a rejected funding transport into an explicit safe retry", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        mutationFailed: true,
        response: response("eligible"),
      }),
    ).toMatchObject({ state: "retryable", action: "retry-funding" });
  });

  it("does not let stale query evidence mask a failed status refresh", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        queryFailed: true,
        response: response("eligible"),
      }),
    ).toMatchObject({ state: "unavailable", action: "retry-status" });
    expect(
      createTestnetFundingView({
        accessState: "ready",
        queryFailed: true,
        response: response("already-funded"),
      }),
    ).toMatchObject({ state: "unavailable", action: "retry-status" });
  });

  it("keeps a current mutation outcome when its follow-up status read fails", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        hasMutationResponse: true,
        queryFailed: true,
        response: {
          apiVersion: 1,
          request: { id: "complete", state: "funded" },
        },
      }),
    ).toMatchObject({ state: "funded", action: "trade" });
  });

  it("treats a completed request as complete even before status catches up", () => {
    expect(
      createTestnetFundingView({
        accessState: "ready",
        response: {
          apiVersion: 1,
          request: { id: "complete", state: "funded" },
        },
      }),
    ).toMatchObject({ state: "funded", action: "trade" });
  });
});
