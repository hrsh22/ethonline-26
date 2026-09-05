import axe from "axe-core";
import { chromium, type Page } from "playwright";

import { installDataFixture } from "./fixtures.ts";
import { awaitHydration } from "./run-matrix.ts";

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
  type BrowserFailureKind,
  type BrowserObserver,
} from "./failure-detectors.ts";

/**
 * A harness that cannot fail is worthless. Each case injects one real defect
 * into a real production page and asserts the corresponding detector fires.
 */
export interface SelfTestOutcome {
  readonly detected: boolean;
  readonly expected: BrowserFailureKind | "none";
  readonly name: string;
  readonly observed: readonly BrowserFailure[];
}

const withPage = async <Value>(
  origin: string,
  path: string,
  body: (page: Page) => Promise<Value>,
): Promise<Value> => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    try {
      void origin;
      await installDataFixture(page, "stubbed");
      return await body(page);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
};

const settle = awaitHydration;

/**
 * Hydration, request failures, and network leaks are reported asynchronously,
 * so a fixed settle window silently passes whenever the machine is slower than
 * the window. That turned this harness green on a loaded CI runner while the
 * defect it injected went unobserved. Poll instead: a working detector still
 * finishes in milliseconds, and a broken one still fails, one deadline later.
 */
const OBSERVATION_TIMEOUT_MILLISECONDS = 20_000;

const waitForFailure = async (
  page: Page,
  observer: BrowserObserver,
  matches: (failure: BrowserFailure) => boolean,
): Promise<boolean> => {
  for (
    let elapsed = 0;
    elapsed < OBSERVATION_TIMEOUT_MILLISECONDS;
    elapsed += 100
  ) {
    if (observer.failures.some(matches)) return true;
    await page.waitForTimeout(100);
  }
  return observer.failures.some(matches);
};

export const runHarnessSelfTest = async (
  origin: string,
): Promise<readonly SelfTestOutcome[]> => {
  const outcomes: SelfTestOutcome[] = [];

  for (const defect of [
    "none",
    "small-input",
    "balance-overflow",
    "invisible-focus",
  ] as const) {
    outcomes.push(
      await withPage(origin, "/", async (page) => {
        await page.setContent(`
        <style>
          input { font-size: ${defect === "small-input" ? 12 : 16}px }
          dd { width: 100px; ${defect === "balance-overflow" ? "" : "overflow-wrap: anywhere"} }
          :focus-visible { outline: ${defect === "invisible-focus" ? "none" : "2px solid orange"} }
        </style>
        <input type="number" aria-label="Amount">
        <dl><dt>Balance</dt><dd>1 WETH</dd></dl>
        <svg role="img" aria-label="Token market history" tabindex="0" width="200" height="100"></svg>
        <button>After chart</button>
      `);
        const failures = await renderedStyleFailures(page, defect);
        return {
          name: `rendered styles: ${defect}`,
          expected: defect === "none" ? "none" : "accessibility",
          detected: failures.length > 0 === (defect !== "none"),
          observed: failures,
        };
      }),
    );
  }

  // Check clean layouts as well as defects: a detector that always reports
  // a collision would otherwise pass every collision injection below.
  for (const state of ["hidden", "visible", "overlapping"] as const) {
    outcomes.push(
      await withPage(origin, "/", async (page) => {
        await page.setContent(`
          <header style="display: flex; gap: 20px">
            <a href="/">Brand</a>
            <div id="collector-navigation" ${state === "hidden" ? 'style="display: none"' : ""}>
              <nav aria-label="Collector navigation">
                <a href="/fleet" ${state === "overlapping" ? 'style="position: absolute; left: 8px; top: 8px"' : ""}>Fleet</a>
              </nav>
            </div>
            <div><button aria-controls="collector-navigation">Menu</button></div>
          </header>
        `);
        const failure = await collectorHeaderCollisionFailure(page, state);
        const expectsCollision = state === "overlapping";
        return {
          detected: (failure !== undefined) === expectsCollision,
          expected: expectsCollision ? "layout-collision" : "none",
          name: `collector navigation ${state}`,
          observed: failure === undefined ? [] : [failure],
        };
      }),
    );
  }

  // 1. A failed production asset.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      const observer = observePage(page);
      await page.route("**/*.js", (route) => route.abort("failed"));
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      const preventedHydration = await awaitHydration(page).then(
        () => false,
        () => true,
      );
      return {
        detected:
          preventedHydration &&
          (await waitForFailure(
            page,
            observer,
            (failure) => failure.kind === "asset-failed",
          )),
        expected: "asset-failed" as const,
        name: "broken production asset",
        observed: observer.failures,
      };
    }),
  );

  // 2. Real page-level horizontal overflow.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      await page.addStyleTag({
        content:
          "body::after{content:'';display:block;width:4000px;height:1px}",
      });
      await page.waitForTimeout(100);
      const failure = overflowFailure(
        "self-test overflow",
        await pageOverflow(page),
      );
      return {
        detected: failure !== undefined,
        expected: "page-overflow" as const,
        name: "page-level overflow",
        observed: failure === undefined ? [] : [failure],
      };
    }),
  );

  // 3. A header collision that does not create document overflow.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      await page.evaluate(() => {
        const brand = document.querySelector("[data-brand-mark]")?.closest("a");
        // The shell is a flex row on phones and a vertical rail on laptops,
        // and in both the brand is allowed to shrink, so an oversized width
        // cannot collide any more — flex absorbs it, and if it cannot, the
        // result is document overflow that the overflow detector already
        // owns. Overlap is what this detector exists to catch, so the
        // injection takes the brand out of flow and stretches it over the
        // whole shell so it lands on the wallet cluster in either layout.
        brand?.setAttribute(
          "style",
          "position: absolute; left: 0; top: 0; width: 900px; height: 100dvh",
        );
      });
      const failure = await collectorHeaderCollisionFailure(
        page,
        "self-test collision",
      );
      return {
        detected: failure !== undefined,
        expected: "layout-collision" as const,
        name: "collector header collision",
        observed: failure === undefined ? [] : [failure],
      };
    }),
  );

  // 4. An accessibility violation Axe must report after hydration.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      await page.evaluate(() => {
        const image = document.createElement("img");
        image.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
        document.body.prepend(image);
      });
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const runner = (
          window as unknown as {
            readonly axe: {
              readonly run: (
                context: Document,
                options: unknown,
              ) => Promise<{ readonly violations: readonly unknown[] }>;
            };
          }
        ).axe;
        const result = await runner.run(document, {
          resultTypes: ["violations"],
          runOnly: { type: "rule", values: ["image-alt"] },
        });
        return result.violations.length;
      });
      return {
        detected: violations > 0,
        expected: "accessibility" as const,
        name: "accessibility violation",
        observed: [],
      };
    }),
  );

  // 5. A hydration mismatch. The server HTML is rewritten in flight so the
  // client renders different text than the server sent, which is the failure
  // class the pre-hydration JSDOM harness could never observe.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      const observer = observePage(page);
      await page.route(`${origin}/`, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        await route.fulfill({
          // The collector shell is a client component, so changing visible
          // brand text makes the client render something different from the
          // server instead of relying on an attribute-only mismatch. Anchored
          // on the shell's explicit hook, not on a generated class name.
          body: body.replace(/(data-brand-mark[^>]*>)[^<]+/u, "$1BROKEN ORBIT"),
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
        });
      });
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      const detected = await waitForFailure(
        page,
        observer,
        (failure) => failure.kind === "hydration-mismatch",
      );
      return {
        detected,
        expected: "hydration-mismatch" as const,
        name: "hydration mismatch",
        observed: observer.failures,
      };
    }),
  );

  // 5. A protected admin fetch from an unauthenticated page.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      const observer = observePage(page);
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      await page.evaluate(
        () =>
          void fetch("/api/admin/history/protocol/operations").catch(
            () => undefined,
          ),
      );
      return {
        detected: await waitForFailure(
          page,
          observer,
          (failure) => failure.kind === "protected-request",
        ),
        expected: "protected-request" as const,
        name: "unauthorized admin fetch",
        observed: observer.failures,
      };
    }),
  );

  // 6. A broken keyboard path.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      await page.evaluate(() => {
        for (const element of document.querySelectorAll<HTMLElement>(
          "a,button,input,select,textarea,[tabindex]",
        )) {
          element.setAttribute("tabindex", "-1");
        }
      });
      const failure = await focusFailure(page, "self-test focus");
      return {
        detected: failure !== undefined,
        expected: "focus-broken" as const,
        name: "broken keyboard path",
        observed: failure === undefined ? [] : [failure],
      };
    }),
  );

  // 7. Application data traffic after the initial-load window.
  outcomes.push(
    await withPage(origin, "/", async (page) => {
      const traffic = observeApplicationRequests(page);
      await page.goto(`${origin}/`, { waitUntil: "commit" });
      await settle(page);
      traffic.reset();
      await page.evaluate(
        () => void fetch("/v1/history/status").catch(() => undefined),
      );
      await page.waitForTimeout(100);
      const failure = idleRequestFailure(
        "self-test idle traffic",
        traffic.snapshot(),
      );
      return {
        detected: failure !== undefined,
        expected: "idle-request" as const,
        name: "idle application request",
        observed: failure === undefined ? [] : [failure],
      };
    }),
  );

  return outcomes;
};
