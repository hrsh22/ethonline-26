import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readEnvironmentTemplate = (
  path: string,
): Readonly<Record<string, string>> => {
  const entries = readFileSync(new URL(path, import.meta.url), "utf8")
    .split(/\r?\n/u)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    });
  return Object.fromEntries(entries);
};

describe("hosted staging environment templates", () => {
  const serviceTemplates = [
    {
      manifest: "ADMIN_AUTH_MANIFEST_PATH",
      path: "../config/env/api.env.example",
      state: ["ADMIN_AUTH_DATABASE_PATH"],
    },
    {
      manifest: "TESTNET_FUNDING_MANIFEST_PATH",
      path: "../config/env/funding.env.example",
      state: ["TESTNET_FUNDING_DATABASE_PATH"],
    },
    {
      manifest: "HISTORY_MANIFEST_PATH",
      path: "../config/env/history.env.example",
      state: ["HISTORY_DATABASE_PATH", "KEEPER_ATTEMPT_DATABASE_PATH"],
    },
    {
      manifest: "DEPLOYMENT_MANIFEST_PATH",
      path: "../config/env/operator.env.example",
      state: [
        "OPERATOR_EVIDENCE_PATH",
        "KEEPER_ATTEMPT_OUTBOX_PATH",
        "OPERATOR_CONTROL_DATABASE_PATH",
      ],
    },
    {
      manifest: "TESTNET_FUNDING_REPLENISH_MANIFEST_PATH",
      path: "../config/env/replenisher.env.example",
      state: ["TESTNET_FUNDING_REPLENISH_DATABASE_PATH"],
    },
  ] as const;

  it.each(serviceTemplates)(
    "targets the staging deployment and state namespace in $path",
    ({ manifest, path, state }) => {
      const environment = readEnvironmentTemplate(path);

      expect(environment[manifest]).toBe("deployments/84532.staging.json");
      for (const name of state) {
        expect(environment[name]).toMatch(/^\/var\/lib\/orbit\/staging\//u);
      }
    },
  );

  it("keeps the combined staging profile aligned with persistent service state", () => {
    const environment = readEnvironmentTemplate("../.env.staging.example");

    expect(environment.TESTNET_FUNDING_REPLENISH_DATABASE_PATH).toBe(
      ".data/staging/replenisher/replenisher.sqlite",
    );
    expect(environment.OPERATOR_EVIDENCE_PATH).toBe(
      ".data/staging/operator/evidence.json",
    );

    for (const [name, value] of Object.entries(environment)) {
      if (name.endsWith("_MANIFEST_PATH")) {
        expect(value).toBe("deployments/84532.staging.json");
      }
      if (
        name.endsWith("_DATABASE_PATH") ||
        name.endsWith("_OUTBOX_PATH") ||
        name === "OPERATOR_EVIDENCE_PATH"
      ) {
        expect(value).toMatch(/^\.data\/staging\//u);
      }
    }
  });
});
