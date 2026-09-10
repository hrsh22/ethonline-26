import { describe, expect, it } from "vitest";

import {
  classifyChangedPaths,
  classifyCiProfile,
  formatGithubOutputs,
} from "./ci-changes.ts";

const noHeavyGates = {
  code_checks: false,
  web_unit: false,
  public_api: false,
  protocol_scripts: false,
  contract_unit: false,
  contract_invariants: false,
  deployment: false,
  web_production: false,
};

const everyGate = {
  code_checks: true,
  web_unit: true,
  public_api: true,
  protocol_scripts: true,
  contract_unit: true,
  contract_invariants: true,
  deployment: true,
  web_production: true,
};

describe("CI changed-path classification", () => {
  it("keeps documentation-only changes out of production and contract gates", () => {
    expect(
      classifyChangedPaths(["README.md", "docs/operations/runbook.md"]),
    ).toEqual(noHeavyGates);
  });

  it("routes web-only changes only to web feedback", () => {
    expect(
      classifyChangedPaths([
        "apps/web/src/components/exchange.tsx",
        "apps/web/src/components/exchange.test.tsx",
      ]),
    ).toEqual({
      ...noHeavyGates,
      code_checks: true,
      web_unit: true,
      web_production: true,
    });
  });

  it("routes bounded operator changes to protocol and script tests", () => {
    expect(
      classifyChangedPaths([
        "scripts/base-sepolia-operator.ts",
        "scripts/base-sepolia-operator-state.test.ts",
      ]),
    ).toEqual({
      ...noHeavyGates,
      code_checks: true,
      protocol_scripts: true,
    });
  });

  it.each([
    "config/env/history.env.example",
    "config/env/operator.env.example",
    "config/env/funding.env.example",
    "config/env/replenisher.env.example",
  ])("routes the %s runtime template to protocol and script tests", (path) => {
    expect(classifyChangedPaths([path])).toEqual({
      ...noHeavyGates,
      code_checks: true,
      protocol_scripts: true,
    });
  });

  it("routes the web environment template to web and template-alignment feedback", () => {
    expect(classifyChangedPaths(["config/env/web.env.example"])).toEqual({
      ...noHeavyGates,
      code_checks: true,
      protocol_scripts: true,
      web_unit: true,
      web_production: true,
    });
  });

  it("routes the API environment template to API and template-alignment feedback", () => {
    expect(classifyChangedPaths(["config/env/api.env.example"])).toEqual({
      ...noHeavyGates,
      code_checks: true,
      protocol_scripts: true,
      public_api: true,
    });
  });

  it("routes the combined local environment through every runtime consumer", () => {
    expect(classifyChangedPaths([".env.example"])).toEqual({
      ...noHeavyGates,
      code_checks: true,
      web_unit: true,
      public_api: true,
      protocol_scripts: true,
      web_production: true,
    });
  });

  it("routes API implementation changes only to the API gate", () => {
    expect(classifyChangedPaths(["apps/api/src/http-server.ts"])).toEqual({
      ...noHeavyGates,
      code_checks: true,
      public_api: true,
    });
  });

  it.each([
    "packages/config/src/public-api.ts",
    "packages/config/test/public-api.test.ts",
  ])(
    "routes the shared API contract to API and browser gates for %s",
    (path) => {
      expect(classifyChangedPaths([path])).toEqual({
        ...noHeavyGates,
        code_checks: true,
        public_api: true,
        web_unit: true,
        web_production: true,
      });
    },
  );

  it.each([
    "packages/contracts/src/market/CanonicalFeeHook.sol",
    "packages/config/src/collection-manifest.ts",
    "deployments/84532.json",
    "apps/web/src/generated/deployment-manifests.ts",
    "scripts/deploy-protocol.ts",
    "scripts/effect-runtime.ts",
    "scripts/json-rpc.ts",
    "config/env/deployment.env.example",
    ".github/workflows/ci.yml",
    "pnpm-lock.yaml",
  ])("fails closed through every gate for %s", (path) => {
    expect(classifyChangedPaths([path])).toEqual(everyGate);
  });

  it("unions independent path effects without dropping safety gates", () => {
    expect(
      classifyChangedPaths([
        "apps/web/src/app/page.tsx",
        "scripts/base-sepolia-operator.ts",
      ]),
    ).toEqual({
      ...noHeavyGates,
      code_checks: true,
      web_unit: true,
      protocol_scripts: true,
      web_production: true,
    });
  });

  it("fails closed for an unknown non-documentation path", () => {
    expect(classifyChangedPaths(["new-workspace/tool.ts"])).toEqual(everyGate);
  });

  it("provides deterministic benchmark profiles and inspectable outputs", () => {
    expect(classifyCiProfile("web")).toEqual({
      ...noHeavyGates,
      code_checks: true,
      web_unit: true,
      web_production: true,
    });
    expect(classifyCiProfile("full")).toEqual(everyGate);
    expect(formatGithubOutputs(classifyCiProfile("web"))).toBe(
      [
        "code_checks=true",
        "web_unit=true",
        "public_api=false",
        "protocol_scripts=false",
        "contract_unit=false",
        "contract_invariants=false",
        "deployment=false",
        "web_production=true",
      ].join("\n") + "\n",
    );
  });
});
