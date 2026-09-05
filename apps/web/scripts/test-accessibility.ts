import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

import axe from "axe-core";
import { Effect } from "effect";
import { JSDOM, VirtualConsole } from "jsdom";

import { rpc, runMain, spawnProcess } from "../../../scripts/effect-runtime.ts";
import { nextRuntimeArguments } from "../../../scripts/next-runtime-command.ts";

interface RouteState {
  readonly finalPath?: string;
  readonly path: string;
  readonly status: number;
}

interface FramePolicyExpectation extends RouteState {
  readonly redirect?: RequestRedirect;
}

const framePolicyExpectations: readonly FramePolicyExpectation[] = [
  { path: "/", status: 200 },
  { path: "/admin/sign-in", status: 200 },
  { path: "/admin", redirect: "manual", status: 307 },
  { path: "/api/admin/auth/session", status: 401 },
];

const framePolicyFailures = (
  expectation: FramePolicyExpectation,
  response: Response,
): readonly string[] => {
  const failures: string[] = [];
  if (response.status !== expectation.status) {
    failures.push(
      `${expectation.path}: expected HTTP ${expectation.status}, received ${response.status}`,
    );
  }
  const contentSecurityPolicy = response.headers.get("content-security-policy");
  if (contentSecurityPolicy !== "frame-ancestors 'none'") {
    failures.push(
      `${expectation.path}: expected the framing-only Content-Security-Policy, received ${JSON.stringify(contentSecurityPolicy)}`,
    );
  }
  const frameOptions = response.headers.get("x-frame-options");
  if (frameOptions !== "DENY") {
    failures.push(
      `${expectation.path}: expected X-Frame-Options DENY, received ${JSON.stringify(frameOptions)}`,
    );
  }
  return failures;
};

const auditRoute = async (
  origin: string,
  route: RouteState,
): Promise<ReadonlyArray<string>> => {
  const response = await fetch(`${origin}${route.path}`);
  if (response.status !== route.status) {
    return [
      `${route.path}: expected HTTP ${route.status}, received ${response.status}`,
    ];
  }
  if (route.finalPath !== undefined) {
    const finalUrl = new URL(response.url);
    const finalPath = `${finalUrl.pathname}${finalUrl.search}`;
    if (finalPath !== route.finalPath) {
      return [
        `${route.path}: expected final path ${route.finalPath}, received ${finalPath}`,
      ];
    }
  }
  // Next renders notFound() through a transient __next_error__ document;
  // the app layout (including lang) is applied during hydration. Keep the
  // production HTTP assertion here and audit those hydrated states in a
  // real browser instead of treating the pre-hydration envelope as UI.
  if (route.status === 404) return [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (!error.message.includes("HTMLCanvasElement's getContext")) {
      console.error(error);
    }
  });
  const dom = new JSDOM(await response.text(), {
    runScripts: "outside-only",
    url: `${origin}${route.path}`,
    virtualConsole,
  });
  dom.window.eval(axe.source);
  const result = await dom.window.axe.run(dom.window.document, {
    resultTypes: ["violations"],
  });
  const failures = result.violations.map(
    (violation: axe.Result) =>
      `${route.path}: ${violation.id} (${violation.impact ?? "unknown"}) ${violation.help}`,
  );
  dom.window.close();
  return failures;
};

runMain(
  Effect.gen(function* () {
    const port = 3_107;
    const origin = `http://127.0.0.1:${port}`;
    const routeStates = [
      { path: "/", status: 200 },
      { path: "/start", status: 200 },
      { path: "/faucet", status: 200 },
      { path: "/exchange", status: 200 },
      { path: "/market", status: 200 },
      { path: "/fleet", status: 200 },
      { path: "/fleet/42", status: 200 },
      { path: "/fleet/0042", status: 404 },
      { path: "/fleet/4e2", status: 404 },
      { path: "/fleet/4445", status: 404 },
      { path: "/rewards", status: 200 },
      { path: "/relics", status: 200 },
      { path: "/status", status: 200 },
      { path: "/learn", status: 200 },
      {
        finalPath: "/admin/sign-in?next=%2Fadmin",
        path: "/admin",
        status: 200,
      },
      {
        finalPath: "/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
        path: "/admin/diagnostics",
        status: 200,
      },
    ];

    const server = yield* spawnProcess(
      "Could not start the Next.js server",
      () =>
        spawn(
          process.execPath,
          nextRuntimeArguments("start", "--port", String(port)),
          {
            cwd: new URL("..", import.meta.url),
            env: {
              NEXT_PUBLIC_API_URL: "http://127.0.0.1:8800",
              // next.config.ts fails a production start without the app
              // origin, because it is signed into operator commands and
              // published as wallet metadata. The audit server satisfies the
              // guard explicitly; browser-visible values were baked at build.
              NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3001",
              NEXT_TELEMETRY_DISABLED: "1",
              NODE_ENV: "production",
              __NEXT_PROCESSED_ENV: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
    );

    const output: string[] = [];
    server.stdout.on("data", (chunk) => output.push(String(chunk)));
    server.stderr.on("data", (chunk) => output.push(String(chunk)));

    yield* rpc("Accessibility browser audit failed", async () => {
      try {
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          try {
            const response = await fetch(origin);
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            await wait(250);
          }
        }
        if (!ready) {
          throw new Error(
            `Application server did not become ready.\n${output.join("")}`,
          );
        }

        const frameFailures: string[] = [];
        for (const expectation of framePolicyExpectations) {
          const response = await fetch(`${origin}${expectation.path}`, {
            ...(expectation.redirect === undefined
              ? {}
              : { redirect: expectation.redirect }),
          });
          frameFailures.push(...framePolicyFailures(expectation, response));
        }
        if (frameFailures.length > 0) {
          throw new Error(
            `Security-header audit failed:\n${frameFailures.join("\n")}`,
          );
        }

        const failures: string[] = [];
        for (const route of routeStates) {
          failures.push(...(await auditRoute(origin, route)));
        }

        if (failures.length > 0) {
          throw new Error(
            `Accessibility audit failed:\n${failures.join("\n")}`,
          );
        }
        console.log(
          `Accessibility audit passed for ${routeStates.length} route states; security-header audit passed for ${framePolicyExpectations.length} response states`,
        );
      } finally {
        server.kill("SIGTERM");
      }
    });
  }),
);
