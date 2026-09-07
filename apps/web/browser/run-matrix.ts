import { CollectorFixture } from "./collector-fixture.ts";
import {
  checkLaunchJourney,
  checkTradeStagesJourney,
  checkApprovalReloadJourney,
  checkPartialRewardsJourney,
  checkReceiptRecoveryJourney,
  checkQuoteRecoveryJourney,
  checkFundingDiscoveryJourney,
} from "./collector-journeys.ts";
import { checkPublicCollection } from "./public-collection.ts";
import { checkMobileAccessibility } from "./mobile-accessibility.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import axe from "axe-core";
import { chromium, type Browser, type Page } from "playwright";

import { ADMIN_FIXTURE_COOKIE } from "./admin-fixture.ts";

import {
  collectorHeaderCollisionFailure,
  focusFailure,
  idleRequestFailure,
  observeApplicationRequests,
  observePage,
  overflowFailure,
  pageOverflow,
  renderedStyleFailures,
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
  readonly collector?: {
    readonly rpcRequests: number;
    readonly quoteRequests: number;
    readonly quoteAborts: number;
    readonly submissions: number;
    readonly fundingRequests: number;
  };
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
 * Opening a controlled dialog proves React handled a real user interaction.
 * The server-rendered document alone cannot satisfy this readiness check.
 */
export const awaitHydration = async (page: Page): Promise<void> => {
  await page.waitForLoadState("domcontentloaded");
  const connect = page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first();
  const dialog = page
    .getByRole("button", { name: "Continue with a wallet", exact: true })
    .or(page.getByText("Browser Matrix Wallet", { exact: true }))
    .or(page.getByText("Connect Wallet", { exact: true }))
    .first();
  const deadline = Date.now() + 15_000;
  while (!(await dialog.isVisible())) {
    // A click before hydration is discarded by the browser. Retry the user
    // action until its visible result appears, never accept elapsed time alone.
    await connect.click({ timeout: 1_000 }).catch((error) => {
      if (Date.now() >= deadline) throw error;
    });
    await dialog
      .waitFor({ state: "visible", timeout: 1_000 })
      .catch((error) => {
        if (Date.now() >= deadline) throw error;
      });
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
};

const connectWallet = async (
  page: Page,
  wallet: WalletFixture,
): Promise<void> => {
  if (wallet === "disconnected") return;
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  const walletChoice = page.getByText("Browser Matrix Wallet", { exact: true });
  const walletMenu = page.getByRole("button", {
    name: "Continue with a wallet",
    exact: true,
  });
  await walletChoice
    .or(walletMenu)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await walletMenu.isVisible()) await walletMenu.click();
  await page
    .getByText("Browser Matrix Wallet", { exact: true })
    .click({ timeout: 15_000 });
  if (wallet === "wrong-network") {
    await page
      .locator('[data-wallet-state="connected"]')
      .first()
      .waitFor({ state: "visible" });
    // Model a user changing networks in the wallet, through EIP-1193 rather
    // than editing the application's wallet state or storage.
    await page.evaluate(async () => {
      const ethereum = (
        window as unknown as {
          ethereum: { request: (request: unknown) => Promise<unknown> };
        }
      ).ethereum;
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      });
    });
  }
  const expected =
    wallet === "ordinary" || wallet === "transacting" ? "connected" : wallet;
  await page
    .locator(`[data-wallet-state="${expected}"]`)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  if (wallet === "connecting") {
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .locator('[data-wallet-state="connecting"]')
      .first()
      .waitFor({ state: "visible" });
  } else {
    const chainId = await page.evaluate(async () => {
      const ethereum = (
        window as unknown as {
          ethereum: { request: (request: unknown) => Promise<unknown> };
        }
      ).ethereum;
      return ethereum.request({ method: "eth_chainId" });
    });
    const expectedChain = wallet === "wrong-network" ? "0x1" : "0x14a34";
    if (chainId !== expectedChain)
      throw new Error(
        `Wallet reported ${String(chainId)} instead of ${expectedChain}`,
      );
  }
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
  readonly expectedHeading?: string | undefined;
  readonly label: string;
  readonly options: MatrixOptions;
  readonly path: string;
  readonly screenshot?: boolean | undefined;
  readonly viewport: Viewport;
  readonly wallet: WalletFixture;
  readonly idleWindowMilliseconds?: number;
  readonly backgroundTraffic?: "idle" | "recovering";
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

const inspectBackgroundTraffic = async (
  page: Page,
  traffic: ReturnType<typeof observeApplicationRequests>,
  input: VisitInput,
): Promise<BrowserFailure | undefined> => {
  await awaitApplicationTrafficQuiet(page, traffic);
  const initialRequests = requestCount(traffic.snapshot());
  traffic.reset();
  await page.waitForTimeout(input.idleWindowMilliseconds!);
  const requests = traffic.snapshot();
  if (input.backgroundTraffic === "idle")
    return idleRequestFailure(input.label, requests);
  if (requests.jsonRpc === 0 || requestCount(requests) > initialRequests) {
    throw new Error(
      "Failed wallet reads must recover automatically with a bounded background read",
    );
  }
  return undefined;
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
  failures.push(...(await renderedStyleFailures(page, input.label)));
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

const inspectAdminInputs = async (
  page: Page,
  input: VisitInput,
): Promise<void> => {
  await page.context().addCookies([
    {
      name: "orbit_admin_session",
      value: ADMIN_FIXTURE_COOKIE.split("=")[1]!,
      url: input.options.origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const sessionResponse = await page.request.get(
    `${input.options.origin}/api/admin/auth/session`,
  );
  if (sessionResponse.status() !== 200)
    throw new Error(
      `Admin session fixture was rejected by the real HTTP boundary: ${sessionResponse.status()} ${await sessionResponse.text()}`,
    );
  await page.goto(`${input.options.origin}/admin`);
  await page
    .getByRole("button", {
      name: "Advanced: set a raw minimum output",
      exact: true,
    })
    .first()
    .click();
  const minimum = page
    .getByRole("textbox", {
      name: "Raw minimum output in stock token units",
      exact: true,
    })
    .first();
  const amount = page.getByRole("textbox", {
    name: "WETH amount",
    exact: true,
  });
  await minimum.fill("42");
  await amount.fill("0.5");
  if (
    (await minimum.inputValue()) !== "42" ||
    (await amount.inputValue()) !== "0.5"
  )
    throw new Error("Admin inputs did not handle user input");
  // Prove the same detector catches a regression on the actual component,
  // not only on the synthetic harness self-test element.
  const previousFont = await minimum.evaluate((node) => {
    const previous = node.style.fontSize;
    node.style.fontSize = "12px";
    return previous;
  });
  const detected = (await renderedStyleFailures(page, input.label)).some(
    (failure) => failure.detail.includes("numeric input"),
  );
  await minimum.evaluate((node, previous) => {
    node.style.fontSize = previous;
  }, previousFont);
  if (!detected)
    throw new Error("Small actual admin input escaped the style detector");
};

const visit = async (
  browser: Browser,
  input: VisitInput,
  // The shared case runner dispatches the bounded journey/route checks.
  // eslint-disable-next-line complexity
): Promise<MatrixCaseResult> => {
  const context = await browser.newContext({
    colorScheme: "dark",
    ...(input.label === "mobile-accessibility:back-text-motion"
      ? { reducedMotion: "reduce" as const }
      : {}),
    viewport: { height: input.viewport.height, width: input.viewport.width },
  });
  const page = await context.newPage();
  const observer = observePage(page);
  const traffic = observeApplicationRequests(page);
  const failures: BrowserFailure[] = [];
  const collector = input.label.startsWith("collector-journey:")
    ? new CollectorFixture()
    : undefined;
  try {
    await installWalletFixture(page, input.wallet);
    await installDataFixture(page, input.data);
    if (collector !== undefined && input.label.endsWith("partial-rewards")) {
      collector.permanent = true;
      collector.indexed = true;
      collector.partialRewards = true;
      collector.identityIds.push(43, 45);
    }
    if (collector !== undefined && input.label.endsWith("receipt-recovery"))
      collector.receiptFailures = 2;
    if (collector !== undefined && input.label.endsWith("funding-discovery")) {
      collector.funded = false;
      collector.delivered = false;
    }
    await collector?.install(page);
    await page.goto(`${input.options.origin}${input.path}`, {
      waitUntil: "commit",
    });
    // The global 404 is a static recovery document, without the wallet shell.
    if (input.path === "/does-not-exist") {
      await page
        .getByRole("heading", { level: 1 })
        .waitFor({ state: "visible" });
    } else {
      await awaitHydration(page);
    }
    await connectWallet(page, input.wallet);
    if (collector !== undefined) {
      if (input.label.endsWith("partial-rewards"))
        await checkPartialRewardsJourney(page, collector);
      else if (input.label.endsWith("receipt-recovery"))
        await checkReceiptRecoveryJourney(page, collector);
      else if (input.label.endsWith("quote-recovery"))
        await checkQuoteRecoveryJourney(page, collector);
      else if (input.label.endsWith("funding-discovery"))
        await checkFundingDiscoveryJourney(page, collector);
      else if (input.label.endsWith("approval-reload"))
        await checkApprovalReloadJourney(page, collector);
      else if (input.label.endsWith("trade-stages"))
        await checkTradeStagesJourney(page, collector);
      else await checkLaunchJourney(page, collector);
    }
    if (input.label === "public-collection:explore-and-share") {
      await checkPublicCollection(page, input.options.origin);
    }
    if (input.label === "mobile-accessibility:back-text-motion") {
      await checkMobileAccessibility(page, input.options.origin);
    }
    if (input.data === "admin-inputs") {
      observer.allowProtectedRequests();
      await inspectAdminInputs(page, input);
    }
    if (input.expectedHeading !== undefined) {
      await page
        .getByRole("heading", { name: input.expectedHeading, exact: true })
        .waitFor({ state: "visible", timeout: 15_000 });
    }
    if (input.data === "funded") {
      await page
        .locator('[data-funding-state="funded"]')
        .getByRole("link", { name: "Buy $FUEL on Trade", exact: true })
        .waitFor({ state: "visible" });
    }
    if (input.data === "market") {
      await page
        .getByRole("img", { name: /market history$/u })
        .waitFor({ state: "visible", timeout: 15_000 });
    }
    if (input.data === "cached-stale") {
      await page
        .getByText("Showing last-known public snapshot", { exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByText("Stale snapshot", { exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByText("4,400", { exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByRole("definition")
        .filter({ hasText: /^2\.0000WETH/u })
        .waitFor({ state: "visible" });
      await page
        .getByRole("definition")
        .filter({ hasText: /^123,456/u })
        .waitFor({ state: "visible" });
      await page
        .locator('time[datetime="2023-11-14T22:13:20.000Z"]')
        .waitFor({ state: "visible" });
    }
    if (input.backgroundTraffic !== undefined) {
      const failure = await inspectBackgroundTraffic(page, traffic, input);
      if (failure !== undefined) failures.push(failure);
    }
    failures.push(...(await inspectPage(page, input)));
  } catch (error) {
    const visibleState = await page
      .locator("body")
      .ariaSnapshot()
      .catch(() => "");
    failures.push({
      kind: "state-not-reached",
      detail: `${input.label}: ${String(error)}\n${collector === undefined ? "" : [...collector.unsupported].join("\n")}\n${visibleState.slice(-4000)}`,
    });
  } finally {
    await context.close();
  }
  return {
    failures: [...observer.failures, ...failures],
    label: input.label,
    ...(collector === undefined
      ? {}
      : {
          collector: {
            rpcRequests: collector.rpcRequests,
            quoteRequests: collector.quoteRequests,
            quoteAborts: collector.quoteAborts,
            submissions: collector.submissions.length,
            fundingRequests: collector.fundingRequests,
          },
        }),
  };
};

const selected = (options: MatrixOptions, label: string): boolean =>
  options.only === undefined ||
  options.only.some((filter) => label.includes(filter));

/** HTTP status and framing policy are independent of client-side rendering. */
const inspectHttp = async (origin: string): Promise<MatrixCaseResult> => {
  const failures: BrowserFailure[] = [];
  for (const route of [
    ...ROUTE_CASES,
    { path: "/api/admin/auth/session", status: 401, finalPath: undefined },
  ]) {
    const response = await fetch(`${origin}${route.path}`, {
      redirect: "manual",
    });
    const expected = route.status ?? 200;
    const messages: string[] = [];
    if (response.status !== expected)
      messages.push(`expected HTTP ${expected}, received ${response.status}`);
    if (route.finalPath !== undefined) {
      const location = response.headers.get("location");
      const target = new URL(location ?? "", origin);
      if (`${target.pathname}${target.search}` !== route.finalPath) {
        messages.push(
          `expected redirect to ${route.finalPath}, received ${location}`,
        );
      }
    }
    if (
      response.headers.get("content-security-policy") !==
      "frame-ancestors 'none'"
    )
      messages.push("missing framing-only Content-Security-Policy");
    if (response.headers.get("x-frame-options") !== "DENY")
      messages.push("missing X-Frame-Options DENY");
    failures.push(
      ...messages.map((message) => ({
        kind: "http-response" as const,
        detail: `${route.path}: ${message}`,
      })),
    );
    await response.body?.cancel();
  }
  return { label: "http:routes-and-security", failures };
};

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
  STATE_CASES.map((state) => ({
    axe: true,
    data: state.data,
    expectedHeading: state.heading,
    label: `state:${state.label}${state.path} (${walletFixtureLabels[state.wallet]}, ${dataFixtureLabels[state.data]})`,
    options,
    path: state.path,
    viewport: RELEASE_VIEWPORTS[0] as Viewport,
    wallet: state.wallet,
  }));

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

const adminInputPlan = (options: MatrixOptions): readonly VisitInput[] => [
  {
    axe: true,
    data: "admin-inputs",
    expectFinalPath: "/admin",
    label: "admin-inputs:keeper-and-creator@375",
    options,
    path: "/admin/sign-in",
    viewport: RELEASE_VIEWPORTS[0] as Viewport,
    wallet: "ordinary",
  },
];

/** Settled views stay idle; failed wallet reads recover without input. */
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
    backgroundTraffic: "idle",
  },
  {
    axe: false,
    data: "stubbed",
    label: "read-recovery:connected-faucet",
    idleWindowMilliseconds: 31_000,
    options,
    path: "/faucet",
    viewport: RELEASE_VIEWPORTS[3] as Viewport,
    wallet: "ordinary",
    backgroundTraffic: "recovering",
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
    ...adminInputPlan(options),
    ...idleTrafficPlan(options),
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/exchange",
      label: "collector-journey:approval-reload",
      options,
      path: "/exchange",
      viewport: RELEASE_VIEWPORTS[3] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/exchange",
      label: "collector-journey:trade-stages",
      options,
      path: "/exchange",
      viewport: RELEASE_VIEWPORTS[3] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/fleet",
      label: "collector-journey:funding-discovery",
      options,
      path: "/faucet",
      viewport: RELEASE_VIEWPORTS[3] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/fleet",
      label: "collector-journey:quote-recovery",
      options,
      path: "/exchange",
      viewport: RELEASE_VIEWPORTS[3] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      label: "collector-journey:receipt-recovery",
      options,
      path: "/fleet/42",
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      label: "collector-journey:partial-rewards",
      options,
      path: "/rewards",
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/fleet",
      label: "collector-journey:launch-reload",
      options,
      path: "/fleet/42",
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: "transacting" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/fleet/42",
      label: "public-collection:explore-and-share",
      options,
      path: "/",
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: "disconnected" as const,
    },
    {
      axe: true,
      data: "stubbed" as const,
      expectFinalPath: "/",
      label: "mobile-accessibility:back-text-motion",
      options,
      path: "/relics",
      viewport: RELEASE_VIEWPORTS[0] as Viewport,
      wallet: "disconnected" as const,
    },
  ].filter((entry) => selected(options, entry.label));
  const cases: MatrixCaseResult[] = selected(
    options,
    "http:routes-and-security",
  )
    ? [await inspectHttp(options.origin)]
    : [];
  const browser = await chromium.launch();
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
