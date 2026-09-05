import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { resolveHistoryListenerPolicy } from "./listener-policy.ts";

const historyCredentialFixture = (label: string): string =>
  Buffer.from(`base-quotron-test:${label}`.padEnd(32, ".")).toString(
    "base64url",
  );
const readToken = historyCredentialFixture("read-v1");
const ingestToken = historyCredentialFixture("ingest-v1");

describe("history listener policy", () => {
  it("requires exact loopback and strong, distinct scoped credentials", () => {
    expect(
      resolveHistoryListenerPolicy({
        host: "127.0.0.1",
        readApiToken: readToken,
        ingestApiToken: ingestToken,
      }),
    ).toEqual({
      host: "127.0.0.1",
      readApiToken: readToken,
      ingestApiToken: ingestToken,
    });

    for (const input of [
      { host: "0.0.0.0", readApiToken: readToken, ingestApiToken: ingestToken },
      {
        host: "localhost",
        readApiToken: readToken,
        ingestApiToken: ingestToken,
      },
      {
        host: "127.0.0.1",
        readApiToken: undefined,
        ingestApiToken: ingestToken,
      },
      { host: "127.0.0.1", readApiToken: "weak", ingestApiToken: ingestToken },
      {
        host: "127.0.0.1",
        readApiToken: `${readToken}\n`,
        ingestApiToken: ingestToken,
      },
      {
        host: "127.0.0.1",
        readApiToken: `${readToken.slice(0, -1)}9`,
        ingestApiToken: ingestToken,
      },
      {
        host: "127.0.0.1",
        readApiToken: Buffer.alloc(32).toString("base64url"),
        ingestApiToken: ingestToken,
      },
      { host: "127.0.0.1", readApiToken: readToken, ingestApiToken: readToken },
    ]) {
      expect(() => resolveHistoryListenerPolicy(input)).toThrow();
    }
  });
});
