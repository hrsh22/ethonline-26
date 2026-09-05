import { describe, expect, it } from "vitest";

import { decodeForkSmokeEvidence } from "./smoke-evidence.ts";

const evidence = (snapshot: unknown) => ({
  healthSnapshots: [snapshot],
  failedTrack: { retainedQueue: "1" },
  invariants: { polFuelAfter: "0" },
});

describe("fork smoke evidence", () => {
  it("requires every health snapshot to report its RPC failures", () => {
    expect(() => decodeForkSmokeEvidence(evidence({}))).toThrow();
  });

  it("accepts an explicit empty RPC-failure report", () => {
    expect(
      decodeForkSmokeEvidence(evidence({ rpcFailures: [] })).healthSnapshots,
    ).toEqual([{ rpcFailures: [] }]);
  });
});
