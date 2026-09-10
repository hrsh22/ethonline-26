import { once } from "node:events";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRuntimeServiceEnvironment,
  readRuntimeEnvironmentSource,
  spawnRuntimeServiceProcess,
} from "./runtime-environment.ts";

describe("runtime service process isolation", () => {
  it("keeps Graph query credentials in the API and deploy authority out of runtime services", () => {
    const environment = {
      GRAPH_STUDIO_QUERY_URL:
        "https://api.studio.thegraph.com/query/1/orbit-market/v1",
      GRAPH_API_KEY: "query-test-key",
      GRAPH_STUDIO_DEPLOY_KEY: "deploy-test-key",
      NEXT_PUBLIC_PRIVY_APP_ID: "public-app-id",
    };
    expect(createRuntimeServiceEnvironment("api", environment)).toMatchObject({
      GRAPH_STUDIO_QUERY_URL: environment.GRAPH_STUDIO_QUERY_URL,
      GRAPH_API_KEY: environment.GRAPH_API_KEY,
    });
    for (const service of [
      "api",
      "funding",
      "history",
      "operator",
      "web",
    ] as const) {
      const projected = createRuntimeServiceEnvironment(service, environment);
      expect(projected.GRAPH_STUDIO_DEPLOY_KEY).toBeUndefined();
      if (service !== "api") expect(projected.GRAPH_API_KEY).toBeUndefined();
    }
    expect(
      createRuntimeServiceEnvironment("web", environment)
        .NEXT_PUBLIC_PRIVY_APP_ID,
    ).toBe("public-app-id");
  });
  it("keeps admin-auth authority state in the API process and out of web", () => {
    const environment = {
      ADMIN_AUTH_APP_ORIGIN: "https://orbit.example",
      ADMIN_AUTH_CHALLENGE_TTL_SECONDS: "300",
      ADMIN_AUTH_DATABASE_PATH: "/var/lib/orbit/admin-auth/admin-auth.sqlite",
      ADMIN_AUTH_MANIFEST_PATH: "deployments/84532.json",
      ADMIN_AUTH_RPC_URL: "https://sepolia.base.org/private-key-in-url",
      ADMIN_AUTH_SESSION_TTL_SECONDS: "900",
      DEPLOYER_PRIVATE_KEY: "forbidden",
    };
    const api = createRuntimeServiceEnvironment("api", environment);
    expect(api).toMatchObject({
      ADMIN_AUTH_APP_ORIGIN: environment.ADMIN_AUTH_APP_ORIGIN,
      ADMIN_AUTH_CHALLENGE_TTL_SECONDS:
        environment.ADMIN_AUTH_CHALLENGE_TTL_SECONDS,
      ADMIN_AUTH_DATABASE_PATH: environment.ADMIN_AUTH_DATABASE_PATH,
      ADMIN_AUTH_MANIFEST_PATH: environment.ADMIN_AUTH_MANIFEST_PATH,
      ADMIN_AUTH_RPC_URL: environment.ADMIN_AUTH_RPC_URL,
      ADMIN_AUTH_SESSION_TTL_SECONDS:
        environment.ADMIN_AUTH_SESSION_TTL_SECONDS,
    });
    expect(api.DEPLOYER_PRIVATE_KEY).toBeUndefined();
    const web = createRuntimeServiceEnvironment("web", environment);
    for (const name of Object.keys(environment)) {
      expect(web[name]).toBeUndefined();
    }
  });

  it("gives the API the operator control upstream and no other process", () => {
    const environment = {
      OPERATOR_CONTROL_API_TOKEN: "o".repeat(48),
      OPERATOR_CONTROL_URL: "http://127.0.0.1:8795",
    };
    // The API proxies the console to the operator; a missing name here reads
    // as "no control surface configured" rather than as a misconfiguration,
    // so the whole control plane fails silently.
    expect(createRuntimeServiceEnvironment("api", environment)).toMatchObject(
      environment,
    );
    for (const service of ["funding", "history", "operator", "web"] as const) {
      const projected = createRuntimeServiceEnvironment(service, environment);
      expect(projected.OPERATOR_CONTROL_URL).toBeUndefined();
      if (service !== "operator") {
        expect(projected.OPERATOR_CONTROL_API_TOKEN).toBeUndefined();
      }
    }
  });

  it("merges a runtime file with host precedence and an explicit missing-file policy", () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-runtime-env-"));
    const path = join(directory, "service.env");
    const missingPath = join(directory, "missing.env");
    try {
      writeFileSync(
        path,
        "DEPLOYER_PRIVATE_KEY=file-secret\nPUBLIC_API_PORT=8700\n",
      );

      expect(
        readRuntimeEnvironmentSource({
          environment: { PATH: "/usr/bin", PUBLIC_API_PORT: "8800" },
          path,
          required: true,
        }),
      ).toEqual({
        DEPLOYER_PRIVATE_KEY: "file-secret",
        PATH: "/usr/bin",
        PUBLIC_API_PORT: "8800",
      });
      expect(
        readRuntimeEnvironmentSource({
          environment: { PATH: "/usr/bin" },
          path: missingPath,
          required: false,
        }),
      ).toEqual({ PATH: "/usr/bin" });
      expect(() =>
        readRuntimeEnvironmentSource({
          environment: {},
          path: missingPath,
          required: true,
        }),
      ).toThrow();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  const cases = [
    {
      allowedName: "HISTORY_READ_API_TOKEN",
      allowedValue: "sentinel-read-token",
      forbiddenName: "HISTORY_INGEST_API_TOKEN",
      service: "api",
    },
    {
      allowedName: "HISTORY_INGEST_API_TOKEN",
      allowedValue: "sentinel-ingest-token",
      forbiddenName: "OPERATOR_PRIVATE_KEY",
      service: "history",
    },
    {
      allowedName: "TESTNET_FUNDING_SIGNER_PRIVATE_KEY",
      allowedValue: "sentinel-funding-key",
      forbiddenName: "HISTORY_READ_API_TOKEN",
      service: "funding",
    },
    {
      allowedName: "TESTNET_FUNDING_ENV_PATH",
      allowedValue: ".env.testnet-funding",
      forbiddenName: "HISTORY_INGEST_API_TOKEN",
      service: "funding-launcher",
    },
    {
      allowedName: "HISTORY_INGEST_API_TOKEN",
      allowedValue: "sentinel-ingest-token",
      forbiddenName: "HISTORY_READ_API_TOKEN",
      service: "operator",
    },
    {
      allowedName: "NEXT_PUBLIC_API_URL",
      allowedValue: "https://api.example",
      forbiddenName: "OPERATOR_PRIVATE_KEY",
      service: "web",
    },
  ] as const;

  it.each(cases)(
    "starts the $service service with only its reviewed environment",
    async ({ allowedName, allowedValue, forbiddenName, service }) => {
      const child = spawnRuntimeServiceProcess({
        arguments: [
          "-e",
          `process.exit(
            process.env[${JSON.stringify(allowedName)}] === ${JSON.stringify(allowedValue)} &&
            process.env[${JSON.stringify(forbiddenName)}] === undefined &&
            process.env.__NEXT_PROCESSED_ENV === ${JSON.stringify(
              service === "web" ? "true" : undefined,
            )} &&
            process.env.CI === "true" &&
            process.env.HISTORY_API_TOKEN === undefined &&
            process.env.DEPLOYER_PRIVATE_KEY === undefined &&
            process.env.NODE_OPTIONS === undefined &&
            process.env.AWS_SECRET_ACCESS_KEY === undefined &&
            process.env.GITHUB_TOKEN === undefined
              ? 0
              : 70,
          )`,
        ],
        command: process.execPath,
        environment: {
          AWS_SECRET_ACCESS_KEY: "sentinel-cloud-secret",
          CI: "true",
          DEPLOYER_PRIVATE_KEY: "sentinel-deployer-secret",
          GITHUB_TOKEN: "sentinel-github-secret",
          HISTORY_API_TOKEN: "sentinel-legacy-history-token",
          HISTORY_INGEST_API_TOKEN: "sentinel-ingest-token",
          HISTORY_READ_API_TOKEN: "sentinel-read-token",
          NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
          OPERATOR_PRIVATE_KEY: "sentinel-operator-key",
          __NEXT_PROCESSED_ENV: "false",
          [allowedName]: allowedValue,
        },
        service,
        stdio: "ignore",
      });

      const [code, signal] = (await once(child, "exit")) as [
        number | null,
        NodeJS.Signals | null,
      ];
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    },
  );

  it("supplies and documents every browser-public binding the web application reads", () => {
    const webSource = new URL("../apps/web/src/", import.meta.url);
    const sources = readdirSync(webSource, {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name));
    const read = new Set(
      sources.flatMap((entry) =>
        Array.from(
          readFileSync(join(entry.parentPath, entry.name), "utf8").matchAll(
            /process\.env\.(?<name>NEXT_PUBLIC_[A-Z0-9_]+)/gu,
          ),
          (match) => match.groups?.name ?? "",
        ),
      ),
    );
    const example = readFileSync(
      new URL("../config/env/web.env.example", import.meta.url),
      "utf8",
    );

    expect(read.size).toBeGreaterThan(0);
    for (const name of [...read].sort()) {
      // The launcher projects only allowlisted names, so a binding the web code
      // reads but the allowlist omits is silently undefined in every official
      // command. The authoritative template must document it without inviting
      // a local apps/web/.env.local, which the launcher refuses to start with.
      expect(
        createRuntimeServiceEnvironment("web", { [name]: "configured" }),
      ).toMatchObject({ [name]: "configured" });
      expect(example).toMatch(new RegExp(`^${name}=`, "mu"));
    }
  });

  // The projection is the seam every official command goes through, and both
  // failures it hides are silent: an omitted name is undefined rather than
  // rejected, and an optional one then resolves to "not configured". That is
  // how the operator control proxy and the funding signer each shipped
  // unreachable while their runbooks documented them.
  const projectedServices = [
    {
      directory: "../apps/api/src/",
      minimum: 15,
      service: "api",
      template: "../config/env/api.env.example",
    },
    {
      directory: "../scripts/testnet-funding/",
      minimum: 8,
      service: "funding",
      template: "../config/env/funding.env.example",
    },
  ] as const;

  const environmentNamesRead = (directory: string): ReadonlySet<string> => {
    const source = new URL(directory, import.meta.url);
    const files = readdirSync(source, {
      recursive: true,
      withFileTypes: true,
    }).filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts"),
    );
    return new Set(
      files.flatMap((entry) => {
        const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
        return [
          ...Array.from(
            text.matchAll(/environment\.(?<name>[A-Z][A-Z0-9_]+)/gu),
            (match) => match.groups?.name ?? "",
          ),
          ...Array.from(
            text.matchAll(
              /(?:required|optional|secret)\(\s*environment,\s*"(?<name>[A-Z][A-Z0-9_]+)"/gu,
            ),
            (match) => match.groups?.name ?? "",
          ),
          ...Array.from(
            text.matchAll(
              /^\s+(?<name>[A-Z][A-Z0-9_]+):\s*(?:Schema\.|config\.)/gmu,
            ),
            (match) => match.groups?.name ?? "",
          ),
        ];
      }),
    );
  };

  it.each(projectedServices)(
    "supplies and documents every environment binding the $service process reads",
    ({ directory, minimum, service, template }) => {
      const read = environmentNamesRead(directory);
      const documented = readFileSync(
        new URL(template, import.meta.url),
        "utf8",
      );

      // A floor, so a refactor that stops matching the read patterns fails
      // here instead of quietly asserting nothing.
      expect(read.size).toBeGreaterThanOrEqual(minimum);
      for (const name of [...read].sort()) {
        expect(
          createRuntimeServiceEnvironment(service, { [name]: "configured" }),
        ).toMatchObject({ [name]: "configured" });
        if (service === "funding" && name === "NEXT_PUBLIC_APP_URL") {
          expect(documented).toMatch(/# NEXT_PUBLIC_APP_URL;/u);
        } else {
          expect(documented).toMatch(new RegExp(`^${name}=`, "mu"));
        }
      }
    },
  );

  it.each([
    ["api", "../config/env/api.env.example"],
    ["funding", "../config/env/funding.env.example"],
    ["funding-replenisher", "../config/env/replenisher.env.example"],
    ["history", "../config/env/history.env.example"],
    ["operator", "../config/env/operator.env.example"],
    ["web", "../config/env/web.env.example"],
  ] as const)(
    "keeps the authoritative %s template aligned with its runtime allowlist",
    (service, templatePath) => {
      const runtimeSource = readFileSync(
        new URL("./runtime-environment.ts", import.meta.url),
        "utf8",
      );
      const candidates = new Set(
        Array.from(
          runtimeSource.matchAll(/"(?<name>[A-Z][A-Z0-9_]*)"/gu),
          (match) => match.groups?.name ?? "",
        ),
      );
      const environment = Object.fromEntries(
        [...candidates].map((name) => [name, "configured"]),
      );
      const projected = new Set(
        Object.keys(createRuntimeServiceEnvironment(service, environment)),
      );
      const template = readFileSync(
        new URL(templatePath, import.meta.url),
        "utf8",
      );
      const documented = new Set(
        Array.from(
          template.matchAll(/^(?<name>[A-Z][A-Z0-9_]*)=/gmu),
          (match) => match.groups?.name ?? "",
        ),
      );
      const processOwned = new Set([
        "CI",
        "LANG",
        "LC_ALL",
        "PATH",
        "TMPDIR",
        "TZ",
        ...(service === "funding" ? ["NEXT_PUBLIC_APP_URL"] : []),
        ...(service === "operator" ? ["OPERATOR_CONTROL_RUN_ID"] : []),
        ...(service === "web"
          ? [
              "HOSTNAME",
              "NEXT_TELEMETRY_DISABLED",
              "NODE_ENV",
              "PORT",
              "__NEXT_PROCESSED_ENV",
            ]
          : []),
      ]);
      for (const name of processOwned) projected.delete(name);

      expect([...documented].sort()).toEqual([...projected].sort());
    },
  );

  it("keeps every slim local-integration binding documented by a process owner", () => {
    const variableNames = (path: string): ReadonlySet<string> =>
      new Set(
        Array.from(
          readFileSync(new URL(path, import.meta.url), "utf8").matchAll(
            /^(?<name>[A-Z][A-Z0-9_]*)=/gmu,
          ),
          (match) => match.groups?.name ?? "",
        ),
      );
    const localIntegration = variableNames("../.env.example");
    const authoritative = new Set(
      [
        "api",
        "deployment",
        "funding",
        "history",
        "operator",
        "replenisher",
        "web",
      ].flatMap((service) => [
        ...variableNames(`../config/env/${service}.env.example`),
      ]),
    );

    expect(localIntegration.size).toBeGreaterThan(10);
    for (const name of localIntegration) expect(authoritative).toContain(name);
  });

  it("documents every one-shot deployment and maintenance binding", () => {
    const templates = [
      "api",
      "deployment",
      "funding",
      "history",
      "operator",
      "replenisher",
      "web",
    ]
      .map((service) =>
        readFileSync(
          new URL(`../config/env/${service}.env.example`, import.meta.url),
          "utf8",
        ),
      )
      .join("\n");
    const sources = [
      "./accept-module-governance.ts",
      "./deploy-cca-protocol.ts",
      "./deploy-protocol.ts",
      "./governance-safe.ts",
      "./health-environment.ts",
      "./smoke-base-sepolia.ts",
      "./verify-base-sepolia-sources.ts",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    const read = new Set(
      sources.flatMap((source) => [
        ...Array.from(
          source.matchAll(/^\s+(?<name>[A-Z][A-Z0-9_]+):\s*Schema\./gmu),
          (match) => match.groups?.name ?? "",
        ),
        ...Array.from(
          source.matchAll(/process\.env\.(?<name>[A-Z][A-Z0-9_]+)/gu),
          (match) => match.groups?.name ?? "",
        ),
      ]),
    );

    expect(read.size).toBeGreaterThan(15);
    for (const name of [...read].sort()) {
      expect(templates).toMatch(new RegExp(`^${name}=`, "mu"));
    }
  });

  it("keeps standalone API, history, and operator entry points from reloading the root environment", () => {
    const apiMain = readFileSync(
      new URL("../apps/api/src/main.ts", import.meta.url),
      "utf8",
    );
    const historyRuntime = readFileSync(
      new URL("./history-indexer/runtime-configuration.ts", import.meta.url),
      "utf8",
    );
    const operatorRuntime = readFileSync(
      new URL("./base-sepolia-operator.ts", import.meta.url),
      "utf8",
    );

    expect(apiMain).not.toMatch(/loadEnvFile|["']\.env["']/u);
    expect(historyRuntime).not.toMatch(/loadEnvironmentFile|["']\.env["']/u);
    expect(operatorRuntime).not.toMatch(/loadEnvironmentFile|["']\.env["']/u);
  });
});
