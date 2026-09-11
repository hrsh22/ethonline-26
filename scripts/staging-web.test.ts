import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { nextRuntimeArguments } from "./next-runtime-command.ts";
import {
  assertNoUncheckedNextEnvironmentFiles,
  createDevelopmentSepoliaWebLaunchPlan,
  createStagingWebLaunchPlan,
  createWebEnvironment,
  normalizeCanonicalApplicationUrl,
  resolveStagingWebEnvironment,
} from "./staging-web.ts";

const nextPackage = realpathSync(
  fileURLToPath(new URL("../apps/web/node_modules/next", import.meta.url)),
);
const nextEnvironmentModule = join(
  dirname(nextPackage),
  "@next/env/dist/index.js",
);
const webNodeModules = fileURLToPath(
  new URL("../apps/web/node_modules", import.meta.url),
);

const isolatedWebEnvironment = () =>
  createWebEnvironment(
    {
      publicApiUrl: "http://127.0.0.1:8800",
      rpcUrl: "https://base-sepolia.example",
    },
    {
      NEXT_TELEMETRY_DISABLED: "1",
      PATH: process.env.PATH,
    },
  );

const temporaryWebDirectory = (): string =>
  mkdtempSync(join(tmpdir(), "orbit-next-env-"));

const nextEnvironmentSentinels =
  "DEPLOYER_PRIVATE_KEY=sentinel-deployer-value\nNEXT_PUBLIC_UNREVIEWED_SECRET=sentinel-public-value\n";

const availablePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a Next.js test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((cause) => {
      if (cause === undefined) resolve();
      else reject(cause);
    });
  });
  return address.port;
};

describe("staging web environment", () => {
  const publicApiUrl = "http://127.0.0.1:8800";

  it("requires a canonical HTTPS origin for a production build", () => {
    expect(() => normalizeCanonicalApplicationUrl(undefined)).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
    expect(() =>
      normalizeCanonicalApplicationUrl("http://localhost:3000"),
    ).toThrow(/HTTPS origin/);
    expect(() =>
      normalizeCanonicalApplicationUrl("https://orbit.example/path"),
    ).toThrow(/HTTPS origin/);
    expect(normalizeCanonicalApplicationUrl("https://orbit.example/")).toBe(
      "https://orbit.example",
    );
  });

  it("projects the staging launcher before the long-lived web process starts", () => {
    const plan = createStagingWebLaunchPlan({
      AWS_SECRET_ACCESS_KEY: "sentinel-cloud-secret",
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_PRIVY_APP_ID: "public-project-id",
      NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
      OPERATOR_PRIVATE_KEY: "sentinel-operator-secret",
      PATH: "/usr/bin",
      RPC_URL: "https://base-sepolia.example",
    });

    expect(plan.supervisorEnvironment).toEqual({ PATH: "/usr/bin" });
    expect(plan.webEnvironment).toEqual({
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "staging",
      NEXT_PUBLIC_PRIVY_APP_ID: "public-project-id",
      NEXT_PUBLIC_RPC_URL: "https://base-sepolia.example",
      PATH: "/usr/bin",
      __NEXT_PROCESSED_ENV: "true",
    });
    expect(JSON.stringify(plan)).not.toContain("sentinel-cloud-secret");
    expect(JSON.stringify(plan)).not.toContain("sentinel-operator-secret");
    expect(JSON.stringify(plan)).not.toContain("/sentinel/forbidden.cjs");
  });

  it("forces the development-sepolia selector for the normal dev target", () => {
    const plan = createDevelopmentSepoliaWebLaunchPlan({
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "staging",
      RPC_URL: "https://base-sepolia.example",
    });

    expect(plan.webEnvironment).toMatchObject({
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development-sepolia",
      NEXT_PUBLIC_RPC_URL: "https://base-sepolia.example",
      __NEXT_PROCESSED_ENV: "true",
    });
  });

  it("binds workspace web commands to the isolated web entry point", () => {
    const workspace = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };

    expect(workspace.scripts.dev).toBe(
      "pnpm build:packages && node scripts/staging-web.ts dev",
    );
    expect(workspace.scripts["dev:local"]).toBe(
      "pnpm build:packages && node scripts/staging-web.ts dev:local",
    );
    expect(workspace.scripts["dev:staging"]).toBe(
      "pnpm build:packages && node scripts/staging-web.ts dev:staging",
    );
    expect(workspace.scripts["backend:staging"]).toBe(
      "pnpm build:packages && pnpm --filter @orbit/api build && node scripts/backend.ts --profile=staging",
    );
    expect(workspace.scripts["history:backfill"]).toBe(
      "pnpm build:packages && node scripts/runtime-service-launcher.ts history --once",
    );
    expect(workspace.scripts["history:worker"]).toBe(
      "pnpm build:packages && node scripts/runtime-service-launcher.ts history",
    );
    expect(workspace.scripts["operator:watch"]).toBe(
      "pnpm build:packages && node scripts/runtime-service-launcher.ts operator-watch",
    );
    expect(workspace.scripts["operator:base-sepolia"]).toBe(
      "pnpm build:packages && node scripts/runtime-service-launcher.ts operator",
    );
    expect(workspace.scripts.dev).not.toContain("operator");
    expect(workspace.scripts.dev).not.toContain("funding");
    expect(workspace.scripts["funding:worker"]).toBe(
      "pnpm --filter @orbit/config build && node scripts/testnet-funding-launcher.ts",
    );
    expect(workspace.scripts["api:serve"]).toBe(
      "pnpm build:packages && pnpm --filter @orbit/api build && pnpm --filter @orbit/api start",
    );
    const apiWorkspace = JSON.parse(
      readFileSync(
        new URL("../apps/api/package.json", import.meta.url),
        "utf8",
      ),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    expect(apiWorkspace.scripts.start).toBe(
      "node ../../scripts/runtime-service-launcher.ts api",
    );
    const webWorkspace = JSON.parse(
      readFileSync(
        new URL("../apps/web/package.json", import.meta.url),
        "utf8",
      ),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    expect(webWorkspace.scripts.prebuild).toBeUndefined();
    expect(webWorkspace.scripts.dev).toBe(
      "node ../../scripts/staging-web.ts dev",
    );
    expect(webWorkspace.scripts["dev:local"]).toBe(
      "node ../../scripts/staging-web.ts dev:local",
    );
    expect(webWorkspace.scripts["dev:staging"]).toBe(
      "node ../../scripts/staging-web.ts dev:staging",
    );
    expect(webWorkspace.scripts.build).toBe(
      "node ../../scripts/staging-web.ts build",
    );
    expect(webWorkspace.scripts.start).toBe(
      "node ../../scripts/staging-web.ts start",
    );
    expect(webWorkspace.scripts.typecheck).toBe(
      "node ../../scripts/staging-web.ts typecheck",
    );
  });

  it("forwards Base Sepolia reads without accepting operator lifecycle settings", () => {
    const configuration = resolveStagingWebEnvironment({
      BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
      NEXT_PUBLIC_API_URL: publicApiUrl,
      OPERATOR_EXECUTE: "true",
      OPERATOR_INTERVAL_SECONDS: "not-a-number",
      OPERATOR_WORKER_ENABLED: "true",
    });

    expect(configuration).toEqual({
      publicApiUrl,
      rpcUrl: "https://base-sepolia.example",
    });
  });

  it("keeps every private key out of the web child environment", () => {
    const webEnvironment = createWebEnvironment(
      { publicApiUrl, rpcUrl: "https://base-sepolia.example" },
      {
        DEPLOYER_PRIVATE_KEY: "deployer-secret",
        HISTORY_API_TOKEN: "history-secret",
        HISTORY_INGEST_API_TOKEN: "history-ingest-secret",
        HISTORY_INDEX_URL: "http://127.0.0.1:8787",
        HISTORY_READ_API_TOKEN: "history-read-secret",
        OPERATOR_KEEPER_PRIVATE_KEY: "keeper-secret",
        OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY: "executor-secret",
        OPERATOR_PRIVATE_KEY: "operator-secret",
        TESTNET_FUNDING_API_TOKEN: "funding-secret",
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: "funding-secret",
        TESTNET_FUNDING_SERVICE_URL: "http://127.0.0.1:8790",
        NEXT_PUBLIC_PRIVY_APP_ID: "public-connector-id",
      },
    );

    expect(webEnvironment).toMatchObject({
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "staging",
      NEXT_PUBLIC_PRIVY_APP_ID: "public-connector-id",
      NEXT_PUBLIC_RPC_URL: "https://base-sepolia.example",
      __NEXT_PROCESSED_ENV: "true",
    });
    expect(webEnvironment.DEPLOYER_PRIVATE_KEY).toBeUndefined();
    expect(webEnvironment.HISTORY_API_TOKEN).toBeUndefined();
    expect(webEnvironment.HISTORY_INGEST_API_TOKEN).toBeUndefined();
    expect(webEnvironment.HISTORY_INDEX_URL).toBeUndefined();
    expect(webEnvironment.HISTORY_READ_API_TOKEN).toBeUndefined();
    expect(webEnvironment.OPERATOR_PRIVATE_KEY).toBeUndefined();
    expect(webEnvironment.OPERATOR_KEEPER_PRIVATE_KEY).toBeUndefined();
    expect(
      webEnvironment.OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY,
    ).toBeUndefined();
    expect(webEnvironment.TESTNET_FUNDING_API_TOKEN).toBeUndefined();
    expect(webEnvironment.TESTNET_FUNDING_SIGNER_PRIVATE_KEY).toBeUndefined();
    expect(webEnvironment.TESTNET_FUNDING_SERVICE_URL).toBeUndefined();
  });

  it("passes only the reviewed browser-public environment", () => {
    const webEnvironment = createWebEnvironment(
      { publicApiUrl, rpcUrl: "https://base-sepolia.example" },
      {
        AWS_SECRET_ACCESS_KEY: "cloud-secret",
        GITHUB_TOKEN: "github-secret",
        HISTORY_INGEST_API_TOKEN: "history-ingest-secret",
        HISTORY_READ_API_TOKEN: "history-read-secret",
        NEXT_PUBLIC_APP_URL: "https://orbit.example",
        NEXT_PUBLIC_PRIVY_APP_ID: "public-connector-id",
        NEXT_PUBLIC_UNREVIEWED_SECRET: "mistakenly-public-secret",
        NODE_OPTIONS: "--require=/sentinel/forbidden.cjs",
        PATH: "/usr/bin",
        WALLETCONNECT_URI: "wc:sentinel",
        __NEXT_PROCESSED_ENV: "false",
      },
    );

    expect(webEnvironment).toEqual({
      NEXT_PUBLIC_API_URL: publicApiUrl,
      NEXT_PUBLIC_APP_URL: "https://orbit.example",
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "staging",
      NEXT_PUBLIC_PRIVY_APP_ID: "public-connector-id",
      NEXT_PUBLIC_RPC_URL: "https://base-sepolia.example",
      PATH: "/usr/bin",
      __NEXT_PROCESSED_ENV: "true",
    });
  });

  it("rejects every unchecked Next.js environment-file shape without reading its values", () => {
    const directory = temporaryWebDirectory();
    try {
      writeFileSync(join(directory, ".env.example"), "REFERENCE_ONLY=true\n");
      writeFileSync(
        join(directory, ".env.development.local"),
        nextEnvironmentSentinels,
      );
      symlinkSync(".env.example", join(directory, ".env.production.local"));
      mkdirSync(join(directory, ".env.local"));

      let diagnostic = "";
      try {
        assertNoUncheckedNextEnvironmentFiles(directory);
      } catch (cause) {
        diagnostic = cause instanceof Error ? cause.message : String(cause);
      }
      expect(diagnostic).toContain(".env.development.local");
      expect(diagnostic).toContain(".env.local");
      expect(diagnostic).toContain(".env.production.local");
      expect(diagnostic).not.toContain("sentinel-deployer-value");
      expect(diagnostic).not.toContain("sentinel-public-value");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("prevents the pinned Next environment loader from restoring filtered bindings", async () => {
    const directory = temporaryWebDirectory();
    try {
      writeFileSync(
        join(directory, ".env.development.local"),
        nextEnvironmentSentinels,
      );
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const nextEnvironment = await import(${JSON.stringify(
            pathToFileURL(nextEnvironmentModule).href,
          )});
const { loadEnvConfig } = nextEnvironment.default;
loadEnvConfig(${JSON.stringify(directory)}, true);
process.exit(
  process.env.DEPLOYER_PRIVATE_KEY === undefined &&
  process.env.NEXT_PUBLIC_UNREVIEWED_SECRET === undefined
    ? 0
    : 70,
);`,
        ],
        { env: isolatedWebEnvironment(), stdio: "ignore" },
      );
      const [code, signal] = (await once(child, "exit")) as [
        number | null,
        NodeJS.Signals | null,
      ];
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps filtered bindings absent after a real Next.js development reload", async () => {
    const directory = temporaryWebDirectory();
    let child: ReturnType<typeof spawn> | undefined;
    let output = "";
    try {
      mkdirSync(join(directory, "app"));
      writeFileSync(
        join(directory, "package.json"),
        `${JSON.stringify({ private: true, type: "module" })}\n`,
      );
      writeFileSync(
        join(directory, "app/page.js"),
        'export default function Page() { return "isolated"; }\n',
      );
      mkdirSync(join(directory, "app/probe"));
      writeFileSync(
        join(directory, "app/probe/route.js"),
        `export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    privateBinding: process.env["DEPLOYER_PRIVATE_KEY"] ?? null,
    publicBinding: process.env["NEXT_PUBLIC_UNREVIEWED_SECRET"] ?? null,
  });
}
`,
      );
      writeFileSync(
        join(directory, "next.config.mjs"),
        `for (const name of ["DEPLOYER_PRIVATE_KEY", "NEXT_PUBLIC_UNREVIEWED_SECRET"]) {
  if (process.env[name] !== undefined) {
    throw new Error(\`Filtered environment binding reached Next.js config: \${name}\`);
  }
}
export default {};
`,
      );
      symlinkSync(webNodeModules, join(directory, "node_modules"), "dir");
      const port = await availablePort();
      let markReady: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      let markBlocked: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        markBlocked = resolve;
      });
      child = spawn(
        process.execPath,
        nextRuntimeArguments(
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
          "--webpack",
        ),
        {
          cwd: directory,
          env: isolatedWebEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (chunk) => {
        output += String(chunk);
        if (/Ready in/u.test(output)) markReady?.();
        if (/Blocked unchecked Next\.js environment file read:/u.test(output)) {
          markBlocked?.();
        }
      });
      child.stderr?.on("data", (chunk) => {
        output += String(chunk);
        if (/Ready in/u.test(output)) markReady?.();
        if (/Blocked unchecked Next\.js environment file read:/u.test(output)) {
          markBlocked?.();
        }
      });
      const exited = once(child, "exit").then(([code, signal]) => {
        throw new Error(
          `Next.js isolation child exited before readiness with code ${String(
            code,
          )} and signal ${String(signal)}: ${output
            .replaceAll("sentinel-deployer-value", "[REDACTED]")
            .replaceAll("sentinel-public-value", "[REDACTED]")}`,
        );
      });

      const startupDeadline = Date.now() + 10_000;
      await Promise.race([
        ready,
        exited,
        wait(startupDeadline - Date.now()).then(() => {
          throw new Error("The isolated Next.js test child did not start");
        }),
      ]);

      const requestProbe = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/probe`);
        const body = await response.text();
        return { body, response };
      };
      const redacted = (value: string): string =>
        value
          .replaceAll("sentinel-deployer-value", "[REDACTED]")
          .replaceAll("sentinel-public-value", "[REDACTED]");
      const parseProbe = (
        body: string,
        response: Response,
        stage: "initial" | "after reload",
      ) => {
        expect({
          body: redacted(body),
          stage,
          status: response.status,
        }).toMatchObject({ status: 200 });
        return JSON.parse(body) as {
          readonly privateBinding: string | null;
          readonly publicBinding: string | null;
        };
      };
      const waitForInitialProbe = async () => {
        let lastObservation = "no HTTP response";
        while (Date.now() < startupDeadline) {
          try {
            const { body, response } = await requestProbe();
            lastObservation = `HTTP ${String(response.status)}: ${redacted(body)}`;
            if (response.ok) return parseProbe(body, response, "initial");
          } catch (cause) {
            lastObservation =
              cause instanceof Error ? cause.message : String(cause);
          }
          await wait(50);
        }
        throw new Error(
          `The isolated Next.js probe route did not become ready. Last observation: ${lastObservation}. Child output: ${redacted(
            output,
          )}`,
        );
      };
      expect(await waitForInitialProbe()).toEqual({
        privateBinding: null,
        publicBinding: null,
      });

      writeFileSync(
        join(directory, ".env.development.local"),
        nextEnvironmentSentinels,
      );
      await Promise.race([
        blocked,
        exited,
        wait(10_000).then(() => {
          throw new Error(
            "Next.js did not attempt the guarded environment-file read",
          );
        }),
      ]);
      const { body, response } = await requestProbe();
      expect(parseProbe(body, response, "after reload")).toEqual({
        privateBinding: null,
        publicBinding: null,
      });
    } finally {
      if (
        child !== undefined &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await Promise.race([stopped, wait(5_000)]);
      }
      rmSync(directory, { force: true, recursive: true });
    }
  }, 20_000);

  it("requires an RPC URL but lets an explicit RPC_URL take precedence", () => {
    expect(() => resolveStagingWebEnvironment({})).toThrow(
      /RPC_URL or BASE_SEPOLIA_RPC_URL is required for pnpm dev/,
    );
    expect(
      resolveStagingWebEnvironment({
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        NEXT_PUBLIC_API_URL: publicApiUrl,
        RPC_URL: "https://explicit.example",
      }),
    ).toEqual({ publicApiUrl, rpcUrl: "https://explicit.example" });
  });

  it("treats a blank RPC_URL binding as absent", () => {
    expect(
      resolveStagingWebEnvironment({
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        NEXT_PUBLIC_API_URL: publicApiUrl,
        RPC_URL: "",
      }),
    ).toEqual({ publicApiUrl, rpcUrl: "https://base-sepolia.example" });
  });

  it("requires a safe public API origin", () => {
    expect(() =>
      resolveStagingWebEnvironment({
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
      }),
    ).toThrow(/NEXT_PUBLIC_API_URL is required/u);
    expect(() =>
      resolveStagingWebEnvironment({
        BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
        NEXT_PUBLIC_API_URL: "http://api.orbit.example",
      }),
    ).toThrow(/HTTPS origin/u);
  });
});
