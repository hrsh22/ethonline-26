import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  parseHistoryCredential,
  parseHistoryLoopbackUrl,
} from "../src/history-runtime.js";

const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const READ_CREDENTIAL = historyCredentialFixture("read-v1");

describe("history runtime security configuration", () => {
  it("accepts an exact canonical base64url credential backed by 32 bytes", () => {
    expect(
      parseHistoryCredential(READ_CREDENTIAL, "HISTORY_READ_API_TOKEN"),
    ).toBe(READ_CREDENTIAL);
  });

  it("rejects missing, short, padded, noncanonical, and trivial credentials", () => {
    const noncanonicalPadBits = `${READ_CREDENTIAL.slice(0, -1)}9`;
    for (const value of [
      undefined,
      "a".repeat(42),
      `${READ_CREDENTIAL}=`,
      noncanonicalPadBits,
      Buffer.alloc(32).toString("base64url"),
      Buffer.alloc(32, 0xa5).toString("base64url"),
    ]) {
      expect(() =>
        parseHistoryCredential(value, "HISTORY_READ_API_TOKEN"),
      ).toThrow();
    }
  });

  it("requires the literal loopback root and an explicit nondefault port", () => {
    expect(parseHistoryLoopbackUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    for (const value of [
      "https://127.0.0.1:8787",
      "http://127.0.0.1:8787?next=https://evil.example",
      "http://user@127.0.0.1:8787",
      "http://127.0.0.1",
      "http://127.0.0.1:0",
      "http://127.0.0.1:80",
      "http://127.0.0.1:99999",
      "http://2130706433:8787",
      "http://localhost:8787",
      "http://127.0.0.1:8787/path",
      "not a url",
    ]) {
      expect(() => parseHistoryLoopbackUrl(value)).toThrow();
    }
  });
});
