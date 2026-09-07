import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { chromium, type Page, type BrowserContext } from "playwright";
import { CollectorFixture } from "./collector-fixture.ts";
import { installDataFixture, installWalletFixture } from "./fixtures.ts";

const origin = process.argv[2];
const output = process.argv[3];
assert.ok(
  origin && output,
  "Usage: node collector-performance.ts ORIGIN OUTPUT.json [--public | --fleet-50] [--diagnostic]",
);
const browser = await chromium.launch();
const results: unknown[] = [];
const diagnostic = process.argv.includes("--diagnostic");
const publicExploration = process.argv.includes("--public");
const largeFleet = process.argv.includes("--fleet-50");
assert.ok(!(publicExploration && largeFleet), "Choose one extended scenario");

async function install(page: Page, fixture: CollectorFixture) {
  // No external request can escape to a real provider or service.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await installDataFixture(page, "stubbed");
  await fixture.install(page);
  await installWalletFixture(page, "transacting");
  await page.route("**/v1/delivery/status", (route) =>
    route.fulfill({ status: 503, json: { error: "fixture-unavailable" } }),
  );
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) await wait(150);
    await route.fallback();
  });
}

try {
  for (const route of publicExploration
    ? ["/"]
    : diagnostic || largeFleet
      ? ["/fleet"]
      : ["/fleet", "/exchange"]) {
    for (let run = 1; run <= (diagnostic ? 1 : 3); run += 1) {
      let storageState:
        Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
      if (!publicExploration) {
        // Obtain application-owned connection persistence through its real chooser.
        const seed = await browser.newContext({
          viewport: { width: 375, height: 812 },
        });
        const seedPage = await seed.newPage();
        await install(seedPage, new CollectorFixture());
        await seedPage.goto(`${origin}/fleet`);
        const connect = seedPage
          .getByRole("button", { name: "Connect wallet", exact: true })
          .first();
        const choice = seedPage.getByText("Browser Matrix Wallet", {
          exact: true,
        });
        const preamble = seedPage.getByRole("button", {
          name: /^(Continue with a wallet|Choose wallet)$/,
          exact: true,
        });
        const chooser = choice.or(preamble).first();
        for (let attempt = 0; !(await chooser.isVisible()); attempt += 1) {
          assert.ok(attempt < 15, "Wallet chooser did not hydrate");
          await connect.click();
          await chooser.waitFor({ timeout: 1000 }).catch(() => undefined);
        }
        if (await preamble.isVisible()) await preamble.click();
        await choice.click();
        await seedPage
          .locator('[data-wallet-state="connected"]')
          .first()
          .waitFor();
        await wait(250);
        storageState = await seed.storageState();
        for (const originState of storageState.origins)
          originState.localStorage = originState.localStorage.filter(
            (entry) => !entry.name.startsWith("orbit:"),
          );
        await seed.close();
      }

      const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        ...(storageState ? { storageState } : {}),
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      if (!publicExploration)
        await page.addInitScript(() => {
          sessionStorage.setItem("matrix-wallet-connected", "yes");
          type FixtureProvider = {
            request: (args: { method: string }) => Promise<unknown>;
          };
          const grant = (provider: FixtureProvider | undefined) => {
            if (provider)
              void provider.request({ method: "eth_requestAccounts" });
          };
          window.addEventListener(
            "eip6963:announceProvider",
            (event) =>
              grant(
                (event as CustomEvent<{ provider: FixtureProvider }>).detail
                  .provider,
              ),
            { once: true },
          );
          grant((window as unknown as { ethereum?: FixtureProvider }).ethereum);
        });
      const fixture = new CollectorFixture();
      if (largeFleet) {
        fixture.identityIds.splice(
          0,
          1,
          ...Array.from({ length: 50 }, (_, index) => index + 1),
        );
        const value = fixture.value.bind(fixture);
        fixture.value = (contract, fn, args) => {
          const result = value(contract, fn, args);
          return contract === "fuelCore" &&
            fn === "balanceOf" &&
            result === 10n ** 18n
            ? 50n * 10n ** 18n
            : result;
        };
      }
      await install(page, fixture);
      if (diagnostic)
        await page.addInitScript(() => {
          const headerTrace: unknown[] = [];
          Object.assign(window, { collectorHeaderTrace: headerTrace });
          document.addEventListener("DOMContentLoaded", () => {
            const header = document.querySelector("header.sticky");
            if (!header) return;
            new ResizeObserver(() =>
              headerTrace.push({
                at: performance.now(),
                height: header.getBoundingClientRect().height,
                text: (header as HTMLElement).innerText,
                rootFontSize: getComputedStyle(document.documentElement)
                  .fontSize,
                fontsStatus: document.fonts.status,
                button: (() => {
                  const button = header.querySelector("button[data-slot]");
                  if (!button) return null;
                  const style = getComputedStyle(button);
                  return Object.fromEntries(
                    [
                      "fontSize",
                      "fontFamily",
                      "lineHeight",
                      "letterSpacing",
                      "padding",
                      "width",
                    ].map((key) => [
                      key,
                      style[key as keyof CSSStyleDeclaration],
                    ]),
                  );
                })(),
                walletWrap: header.querySelector("[data-wallet-state]")
                  ? getComputedStyle(
                      header.querySelector("[data-wallet-state]")!,
                    ).flexWrap
                  : null,
                wallet: header.querySelector("[data-wallet-state]")?.outerHTML,
              }),
            ).observe(header);
          });
        });
      await page.addInitScript(() => {
        const metrics = {
          cls: 0,
          fcp: 0,
          lcp: 0,
          lcpElement: "",
          shifts: [] as {
            at: number;
            score: number;
            sources: string[];
            bounds: unknown[];
          }[],
        };
        const markup = (element: Element | undefined, length: number): string =>
          element?.outerHTML?.slice(0, length) ?? "unknown";
        let shiftStart = 0;
        let shiftLast = 0;
        let shiftScore = 0;
        Object.assign(window, { collectorPerformance: metrics });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (
              entry.entryType === "layout-shift" &&
              !(entry as PerformanceEntry & { hadRecentInput: boolean })
                .hadRecentInput
            ) {
              if (
                entry.startTime - shiftLast > 1000 ||
                entry.startTime - shiftStart > 5000
              ) {
                shiftStart = entry.startTime;
                shiftScore = 0;
              }
              shiftScore += (entry as PerformanceEntry & { value: number })
                .value;
              const shifted = entry as PerformanceEntry & {
                value: number;
                sources?: {
                  node?: Element;
                  previousRect: DOMRectReadOnly;
                  currentRect: DOMRectReadOnly;
                }[];
              };
              metrics.shifts.push({
                at: entry.startTime,
                score: shifted.value,
                bounds: (shifted.sources ?? []).map((source) => ({
                  before: source.previousRect.toJSON(),
                  after: source.currentRect.toJSON(),
                  styles:
                    source.node instanceof Element
                      ? {
                          font: getComputedStyle(source.node).font,
                          display: getComputedStyle(source.node).display,
                          position: getComputedStyle(source.node).position,
                        }
                      : null,
                })),
                sources: (shifted.sources ?? []).map(
                  (source) =>
                    source.node?.outerHTML?.slice(0, 350) ?? "unknown",
                ),
              });
              shiftLast = entry.startTime;
              metrics.cls = Math.max(metrics.cls, shiftScore);
            }
            if (entry.entryType === "largest-contentful-paint") {
              metrics.lcp = entry.startTime;
              metrics.lcpElement = markup(
                (entry as PerformanceEntry & { element?: Element }).element,
                700,
              );
            }
            if (entry.name === "first-contentful-paint")
              metrics.fcp = entry.startTime;
          }
        }).observe({
          entryTypes: ["layout-shift", "largest-contentful-paint", "paint"],
        });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 200_000,
        uploadThroughput: 93_750,
      });
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
      if (!publicExploration)
        await page.locator('[data-wallet-state="connected"]').first().waitFor();
      if (publicExploration)
        await page.getByRole("heading", { level: 1 }).waitFor();
      else if (route === "/fleet")
        await page
          .getByRole("link", { name: /Inspect/ })
          .first()
          .waitFor({ timeout: 30_000 });
      else
        await page
          .getByRole("button", {
            name: "Use the full WETH balance",
            exact: true,
          })
          .waitFor({ timeout: 30_000 });
      const ready = await page.evaluate(() => performance.now());
      // Fixed 15-second post-navigation observation includes startup settling, no actions.
      await wait(Math.max(0, 15_000 - ready));
      const metrics = await page.evaluate(() => ({
        ...(window as unknown as { collectorPerformance: object })
          .collectorPerformance,
        elapsed: performance.now(),
        headerTrace: (window as unknown as { collectorHeaderTrace?: unknown[] })
          .collectorHeaderTrace,
      }));
      assert.equal(fixture.submissions.length, 0);
      assert.equal(
        fixture.unsupported.size,
        0,
        [...fixture.unsupported].join("\n"),
      );
      const methods = Object.fromEntries(
        [...new Set(fixture.methods)]
          .sort()
          .map((method) => [
            method,
            fixture.methods.filter((value) => value === method).length,
          ]),
      );
      const result = {
        route,
        scenario: publicExploration
          ? "public-home-disconnected"
          : largeFleet
            ? "fleet-50"
            : "collector-one",
        run,
        heldIdentities: publicExploration ? 0 : fixture.identityIds.length,
        renderedInspectLinks: await page
          .getByRole("link", { name: /^Inspect/ })
          .count(),
        rpcHttp: fixture.rpcRequests,
        methods,
        readyMilliseconds: ready,
        ...metrics,
      };
      results.push(result);
      writeFileSync(output, JSON.stringify({ results }, null, 2));
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
  writeFileSync(
    output,
    JSON.stringify(
      {
        origin,
        browserVersion: browser.version(),
        recordedAt: new Date().toISOString(),
        viewport: { width: 375, height: 812 },
        network: {
          latencyMilliseconds: 150,
          downloadBytesPerSecond: 200_000,
          uploadBytesPerSecond: 93_750,
          mockedExternalResponseDelayMilliseconds: 150,
        },
        cache: publicExploration
          ? "fresh disconnected browser context; HTTP cache disabled"
          : "fresh browser context; HTTP cache disabled; wallet storage restored",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
