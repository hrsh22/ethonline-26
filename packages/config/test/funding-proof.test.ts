import { describe, expect, it } from "vitest";

import {
  createFundingProofChallenge,
  decodePublicFundingProof,
  FUNDING_PROOF_STATEMENT,
  FUNDING_PROOF_TTL_SECONDS,
  verifyFundingProofFields,
} from "../src/funding-proof.js";

const recipient = "0x2000000000000000000000000000000000000002" as const;
const nonce = "a".repeat(32);
const issuedAt = 1_800_000_000_000;

const challenge = (
  overrides: Partial<Parameters<typeof createFundingProofChallenge>[0]> = {},
) =>
  createFundingProofChallenge({
    chainId: 84_532,
    domain: "orbit.test",
    issuedAtMilliseconds: issuedAt,
    nonce,
    recipient,
    uri: "https://orbit.test/faucet",
    ...overrides,
  });

const expectation = (overrides: Record<string, unknown> = {}) => ({
  chainId: 84_532,
  domain: "orbit.test",
  nowMilliseconds: issuedAt + 1_000,
  recipient,
  ...overrides,
});

describe("funding wallet-control proof", () => {
  it("binds domain, chain, recipient, purpose, nonce, and expiry", () => {
    const built = challenge();
    expect(built.message).toContain("orbit.test");
    expect(built.message).toContain(recipient);
    expect(built.message).toContain(nonce);
    expect(built.message).toContain(FUNDING_PROOF_STATEMENT);
    expect(built.message).toContain("Chain ID: 84532");
    expect(Date.parse(built.expiresAt) - Date.parse(built.issuedAt)).toBe(
      FUNDING_PROOF_TTL_SECONDS * 1_000,
    );
  });

  it("rejects a malformed nonce and the zero recipient", () => {
    expect(() => challenge({ nonce: "short" })).toThrow(TypeError);
    expect(() =>
      challenge({ recipient: `0x${"0".repeat(40)}` as typeof recipient }),
    ).toThrow(TypeError);
  });

  it("accepts a current proof for the expected deployment", () => {
    const result = verifyFundingProofFields(challenge().message, expectation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.nonce).toBe(nonce);
      expect(result.fields.recipient).toBe(recipient);
    }
  });

  it("rejects a proof issued for another site", () => {
    const result = verifyFundingProofFields(
      challenge({ domain: "evil.test", uri: "https://evil.test/faucet" })
        .message,
      expectation(),
    );
    expect(result).toEqual({ ok: false, reason: "domain-mismatch" });
  });

  it("rejects a proof issued for another chain", () => {
    const result = verifyFundingProofFields(
      challenge({ chainId: 1 }).message,
      expectation(),
    );
    expect(result).toEqual({ ok: false, reason: "chain-mismatch" });
  });

  it("rejects a proof bound to another recipient", () => {
    const result = verifyFundingProofFields(
      challenge().message,
      expectation({ recipient: "0x3000000000000000000000000000000000000003" }),
    );
    expect(result).toEqual({ ok: false, reason: "recipient-mismatch" });
  });

  it("rejects an expired proof", () => {
    const result = verifyFundingProofFields(
      challenge().message,
      expectation({
        nowMilliseconds: issuedAt + FUNDING_PROOF_TTL_SECONDS * 1_000 + 1,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a proof dated far in the future", () => {
    const result = verifyFundingProofFields(
      challenge({ issuedAtMilliseconds: issuedAt + 600_000 }).message,
      expectation(),
    );
    expect(result).toEqual({ ok: false, reason: "not-yet-valid" });
  });

  it("rejects a signed message that is not a funding proof", () => {
    const tampered = challenge().message.replace(
      FUNDING_PROOF_STATEMENT,
      "Approve unlimited spending",
    );
    expect(verifyFundingProofFields(tampered, expectation())).toEqual({
      ok: false,
      reason: "purpose-mismatch",
    });
  });

  it("rejects an unparseable message", () => {
    expect(verifyFundingProofFields("not a proof", expectation())).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("decodes only a hex signature and a bounded message", () => {
    expect(
      decodePublicFundingProof({
        message: "hello",
        signature: `0x${"ab".repeat(65)}`,
      }),
    ).toEqual({ message: "hello", signature: `0x${"ab".repeat(65)}` });
    expect(() =>
      decodePublicFundingProof({ message: "hello", signature: "not-hex" }),
    ).toThrow(TypeError);
    expect(() =>
      decodePublicFundingProof({
        message: "x".repeat(2_001),
        signature: `0x${"ab".repeat(65)}`,
      }),
    ).toThrow(TypeError);
  });
});
