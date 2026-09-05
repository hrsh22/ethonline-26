import { describe, expect, it } from "vitest";

import {
  decodePublicFundingRequest,
  normalizePublicApiBaseUrl,
  publicApiEndpoint,
} from "../src/public-api.js";

const proof = {
  message: "orbit.test funding proof",
  signature: `0x${"ab".repeat(65)}`,
} as const;

describe("public API contract", () => {
  it("decodes an exact funding request and checksums its recipient", () => {
    expect(
      decodePublicFundingRequest({
        proof,
        recipient: "0x8d01188806aa960f95a3fe4a343dfc26a8a7e6b5",
        source: "faucet",
      }),
    ).toEqual({
      proof,
      recipient: "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5",
      source: "faucet",
    });
  });

  it("requires a wallet-control proof", () => {
    expect(() =>
      decodePublicFundingRequest({
        recipient: "0x2000000000000000000000000000000000000002",
        source: "faucet",
      }),
    ).toThrow();
  });

  it.each([
    null,
    {},
    {
      amount: "1",
      proof,
      recipient: "0x2000000000000000000000000000000000000002",
      source: "faucet",
    },
    {
      proof,
      recipient: "0x0000000000000000000000000000000000000000",
      source: "faucet",
    },
    {
      proof,
      recipient: "0x2000000000000000000000000000000000000002",
      source: "unknown",
    },
  ])("rejects malformed funding request %#", (request) => {
    expect(() => decodePublicFundingRequest(request)).toThrow();
  });

  it.each([
    ["https://api.orbit.example", "https://api.orbit.example"],
    ["https://api.orbit.example:8443", "https://api.orbit.example:8443"],
    ["http://localhost:8800", "http://localhost:8800"],
    ["http://127.0.0.1:8800", "http://127.0.0.1:8800"],
  ])("normalizes public API origin %s", (value, expected) => {
    expect(normalizePublicApiBaseUrl(value)).toBe(expected);
  });

  it.each([
    "api.orbit.example",
    "http://api.orbit.example",
    "https://api.orbit.example/path",
    "https://user:secret@api.orbit.example",
    "https://api.orbit.example?token=secret",
  ])("rejects unsafe public API base URL %s", (value) => {
    expect(() => normalizePublicApiBaseUrl(value)).toThrow(
      /NEXT_PUBLIC_API_URL/u,
    );
  });

  it("constructs a versioned endpoint from a normalized origin", () => {
    expect(
      publicApiEndpoint("https://api.orbit.example", "/v1/history/status"),
    ).toBe("https://api.orbit.example/v1/history/status");
  });
});
