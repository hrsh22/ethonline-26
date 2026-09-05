import { describe, expect, it } from "vitest";

import {
  readPublicEvidenceCache,
  writePublicEvidenceCache,
} from "./public-evidence-cache";

describe("public evidence cache", () => {
  it("round-trips public snapshots with bigint evidence and provenance", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const model = { observedBlock: 46_352_953n, permanent: 12 };

    writePublicEvidenceCache(storage, "launch-hash", model, 1_700_000_000_000);

    expect([...values.keys()]).toEqual([
      "orbit:public-evidence:v1:launch-hash",
    ]);
    expect(readPublicEvidenceCache(storage, "launch-hash")).toEqual({
      model,
      savedAt: 1_700_000_000_000,
    });
  });

  it("ignores corrupt or differently scoped evidence", () => {
    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined,
    };
    expect(readPublicEvidenceCache(storage, "another-launch")).toBeUndefined();
  });

  it.each(["1e999", "-1"])(
    "ignores an invalid persisted timestamp (%s)",
    (savedAt) => {
      const storage = {
        getItem: () => `{"model":{"permanent":12},"savedAt":${savedAt}}`,
      };

      expect(readPublicEvidenceCache(storage, "launch-hash")).toBeUndefined();
    },
  );
});
