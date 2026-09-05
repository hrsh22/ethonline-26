import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import axe from "axe-core";
import { chromium, type Browser, type Page } from "playwright";

import {
  collectorHeaderCollisionFailure,
  focusFailure,
  idleRequestFailure,
  observeApplicationRequests,
  observePage,
  overflowFailure,
  pageOverflow,
  type BrowserFailure,
} from "./failure-detectors.ts";
import {
  dataFixtureLabels,
  installDataFixture,
  installWalletFixture,
  walletFixtureLabels,
  type DataFixture,
  type WalletFixture,
} from "./fixtures.ts";
import {
  RELEASE_VIEWPORTS,
  ROUTE_CASES,
  SHELL_VIEWPORTS,
  STATE_CASES,
  type Viewport,
} from "./matrix.ts";

export interface MatrixOptions {
  readonly origin: string;
  /** Restricts the run for a per-ticket check instead of the release matrix. */
  readonly only?: readonly string[] | undefined;
  readonly screenshotDirectory?: string | undefined;
}

export interface MatrixCaseResult {
  readonly failures: readonly BrowserFailure[];
  readonly label: string;
}

export interface MatrixResult {
  readonly cases: readonly MatrixCaseResult[];
  readonly failures: readonly BrowserFailure[];
}

const AXE_OPTIONS = {
  resultTypes: ["violations"],
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
} as const;

/**
 * Waits for React to take over. Axe and geometry checks before hydration would
 * measure the server envelope, which is exactly the gap in the JSDOM harness.
 */
const awaitHydration = async (page: Page): Promise<void> => {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(
      () => document.documentElement.getAttribute("lang") !== null,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(250);
};

const runAxe = async (
  page: Page,
  label: string,
): Promise<readonly BrowserFailure[]> => {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async (options) => {
    const runner = (
      window as unknown as {
        readonly axe: {
          readonly run: (
            context: Document,
            options: unknown,
          ) => Promise<{
            readonly violations: readonly {
              readonly help: string;
              readonly id: string;
              readonly impact: string | null;
              readonly nodes: readonly unknown[];
            }[];
          }>;
        };
      }
    ).axe;
    const result = await runner.run(document, options);
    return result.violations.map((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      // The failing selector is what makes a violation actionable.
      targets: violation.nodes
        .slice(0, 3)
        .map((node) =>
          String(
            (node as { readonly target?: readonly unknown[] }).target?.[0] ??
              "unknown",
          ),
        ),
    }));
  }, AXE_OPTIONS);
  return violations.map((violation) => ({
    detail: `${label}: ${violation.id} (${violation.impact ?? "unknown"}) ${violation.help} on ${violation.nodes} node(s) at ${violation.targets.join(", ")}`,
    kind: "accessibility" as const,
  }));
};

const captureScreenshot = async (
  page: Page,
  directory: string,
  name: string,
): Promise<void> => {
  const target = join(directory, `${name}.png`);
  mkdirSync(dirname(target), { recursive: true });
  await page.screenshot({ fullPage: false, path: target });
};

interface VisitInput {
  readonly axe: boolean;
  readonly data: DataFixture;
  readonly expectFinalPath?: string | undefined;
  readonly label: string;
  readonly options: MatrixOptions;
  readonly path: string;
  readonly screenshot?: boolean | undefined;
  readonly viewport: Viewport;
  readonly wallet: WalletFixture;
  readonly idleWindowMilliseconds?: number;
  readonly verifyIdleTraffic?: boolean;
}

const requestCount = (counts: {
  readonly jsonRpc: number;
  readonly publicApi: number;
}): number => counts.jsonRpc + counts.publicApi;

/** Lets initial reads and their bounded retries finish before the idle window. */
const awaitApplicationTrafficQuiet = async (
  page: Page,
  traffic: ReturnType<typeof observeApplicationRequests>,
): Promise<void> => {
  const deadline = Date.now() + 12_000;
  let previousCount = requestCount(traffic.snapshot());
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const currentCount = requestCount(traffic.snapshot());
    if (currentCount !== previousCount) {
      previousCount = currentCount;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= 4_000) return;
  }
  throw new Error("Application requests did not settle before the idle audit");
};

const landingFailure = (
  page: Page,
  input: VisitInput,
): BrowserFailure | undefined => {
  if (input.expectFinalPath === undefined) return undefined;
  const actual = new URL(page.url());
  const landed = `${actual.pathname}${actual.search}`;
  return landed === input.expectFinalPath
    ? undefined
    : {
        detail: `${input.label}: expected to land on ${input.expectFinalPath}, landed on ${landed}`,
        kind: "protected-request",
      };
};

/** Social previews and wallet discovery must never publish browser-relative or
 * local-development asset URLs from a production build. */
const publishedMetadataFailure = async (
  page: Page,
  input: VisitInput,
): Promise<BrowserFailure | undefined> => {
  if (input.path !== "/") return undefined;
  const urls = await page.evaluate(() => ({
    appleIcon: document
      .querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
      ?.getAttribute("href"),
    icon: document
      .querySelector<HTMLLinkElement>('link[rel="icon"]')
      ?.getAttribute("href"),
    openGraph: document
      .querySelector<HTMLMetaElement>('meta[property="og:image"]')
      ?.getAttribute("content"),
    twitter: document
      .querySelector<HTMLMetaElement>('meta[name="twitter:image"]')
      ?.getAttribute("content"),
  }));
  const invalid = Object.entries(urls).filter(([, value]) => {
    if (value === null || value === undefined) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol !== "https:" || parsed.hostname === "localhost";
    } catch {
      return true;
    }
  });
  if (invalid.length > 0) {
    return {
      detail: `${input.label}: invalid production metadata ${invalid
        .map(([name, value]) => `${name}=${value ?? "missing"}`)
        .join(", ")}`,
      kind: "published-metadata",
    };
  }
  const localAssetFailures: string[] = [];
  for (const [name, value] of Object.entries(urls)) {
    const path = new URL(value as string).pathname;
    const response = await page.request.get(`${input.options.origin}${path}`);
    if (!response.ok()) localAssetFailures.push(`${name}=${path}`);
  }
  return localAssetFailures.length === 0
    ? undefined
    : {
        detail: `${input.label}: published metadata asset failed ${localAssetFailures.join(", ")}`,
        kind: "published-metadata",
      };
};

/** Every post-hydration assertion for one visited page. */
const inspectPage = async (
  page: Page,
  input: VisitInput,
): Promise<readonly BrowserFailure[]> => {
  const failures: BrowserFailure[] = [];
  const landing = landingFailure(page, input);
  if (landing !== undefined) failures.push(landing);
  const metadata = await publishedMetadataFailure(page, input);
  if (metadata !== undefined) failures.push(metadata);
  const overflow = overflowFailure(input.label, await pageOverflow(page));
  if (overflow !== undefined) failures.push(overflow);
  const collision = await collectorHeaderCollisionFailure(page, input.label);
  if (collision !== undefined) failures.push(collision);
  const focus = await focusFailure(page, input.label);
  if (focus !== undefined) failures.push(focus);
  if (input.axe) failures.push(...(await runAxe(page, input.label)));
  if (
    input.screenshot === true &&
    input.options.screenshotDirectory !== undefined
  ) {
    await captureScreenshot(
      page,
      input.options.screenshotDirectory,
      input.label,
    );
  }
  return failures;
};

const visit = async (
  browser: Browser,
  input: VisitInput,
): Promise<MatrixCaseResult> => {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: input.viewport.height, width: input.viewport.width },
  });
  const page = await context.newPage();
  const observer = observePage(page);
  const traffic = observeApplicationRequests(page);
  const failures: BrowserFailure[] = [];
  try {
    await installWalletFixture(page, input.wallet);
    await installDataFixture(page, input.data);
    await page.goto(`${input.options.origin}${input.path}`, {
      waitUntil: "commit",
    });
    await awaitHydration(page);
    if (input.verifyIdleTraffic === true) {
      await awaitApplicationTrafficQuiet(page, traffic);
      traffic.reset();
      await page.waitForTimeout(input.idleWindowMilliseconds ?? 31_000);
      const idleFailure = idleRequestFailure(input.label, traffic.snapshot());
      if (idleFailure !== undefined) failures.push(idleFailure);
    }
    failures.push(...(await inspectPage(page, input)));
  } finally {
    await context.close();
  }
  return {
    failures: [...observer.failures, ...failures],
    label: input.label,
  };
};

const selected = (options: MatrixOptions, label: string): boolean =>
  options.only === undefined ||
  options.only.some((filter) => label.includes(filter));

/** Every route at each release viewport, using the shipped dark theme. */
const routePlan = (options: MatrixOptions): readonly VisitInput[] =>
  RELEASE_VIEWPORTS.flatMap((viewport) =>
    ROUTE_CASES.map((route) => ({
      axe: route.axe,
      data: "stubbed" as const,
      expectFinalPath: route.finalPath,
      label: `${route.label}@${viewport.label}/dark`,
      options,
      path: route.path,
      screenshot: route.screenshot === true && viewport.width === 1440,
      viewport,
      wallet: "disconnected" as const,
    })),
  );

/** Targeted regressions at the two widths the responsive rebuild changed. */
const shellPlan = (options: MatrixOptions): readonly VisitInput[] =>
  SHELL_VIEWPORTS.flatMap((viewport) =>
    ["/", "/faucet", "/admin/sign-in"].map((path) => ({
      axe: false,
      data: "stubbed" as const,
      label: `shell${path}@${viewport.label}`,
      options,
      path,
      viewport,
      wallet: "disconnected" as const,
    })),
  );

/** Wallet and data states, paired with the routes that model them. */
const statePlan = (options: MatrixOptions): readonly VisitInput[] =>
  STATE_CASES.flatMap((state) =>
    state.paths.map((path) => ({
      axe: true,
      data: state.data,
      label: `state:${state.label}${path} (${walletFixtureLabels[state.wallet]}, ${dataFixtureLabels[state.data]})`,
      options,
      path,
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: state.wallet,
    })),
  );

/** A connected wallet still needs an admin session for either protected route. */
const adminPlan = (options: MatrixOptions): readonly VisitInput[] =>
  ["/admin", "/admin/diagnostics"].map((path) => ({
    axe: false,
    data: "stubbed" as const,
    expectFinalPath: `/admin/sign-in?next=${encodeURIComponent(path)}`,
    label: `admin-without-session:${path}`,
    options,
    path,
    viewport: RELEASE_VIEWPORTS[3] as Viewport,
    wallet: "ordinary" as const,
  }));

/** Exercises the former 15-second and 30-second read owners without input. */
const idleTrafficPlan = (options: MatrixOptions): readonly VisitInput[] => [
  {
    axe: false,
    data: "stubbed",
    label: "idle-network:craft-detail",
    idleWindowMilliseconds: 16_000,
    options,
    path: "/fleet/42",
    viewport: RELEASE_VIEWPORTS[3] as Viewport,
    wallet: "disconnected",
    verifyIdleTraffic: true,
  },
  {
    axe: false,
    data: "stubbed",
    label: "idle-network:connected-faucet",
    idleWindowMilliseconds: 31_000,
    options,
    path: "/faucet",
    viewport: RELEASE_VIEWPORTS[3] as Viewport,
    wallet: "ordinary",
    verifyIdleTraffic: true,
  },
];

export const runBrowserMatrix = async (
  options: MatrixOptions,
): Promise<MatrixResult> => {
  const plan = [
    ...routePlan(options),
    ...shellPlan(options),
    ...statePlan(options),
    ...adminPlan(options),
    ...idleTrafficPlan(options),
  ].filter((entry) => selected(options, entry.label));
  const browser = await chromium.launch();
  const cases: MatrixCaseResult[] = [];
  try {
    for (const entry of plan) {
      cases.push(await visit(browser, entry));
    }
  } finally {
    await browser.close();
  }
  return { cases, failures: cases.flatMap((entry) => entry.failures) };
};

export const writeMatrixReport = (path: string, result: MatrixResult): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        cases: result.cases.map((entry) => ({
          failures: entry.failures,
          label: entry.label,
        })),
        failureCount: result.failures.length,
      },
      undefined,
      2,
    )}\n`,
  );
};
