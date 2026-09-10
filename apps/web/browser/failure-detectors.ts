import type { ConsoleMessage, Page, Request, Response } from "playwright";

/**
 * A production browser run fails on any of these. Each detector exists because
 * the previous JSDOM harness could not observe it: it fetched pre-hydration
 * HTML, so hydration mismatch, failed assets, real geometry, and post-auth
 * request behaviour were all invisible.
 */
export type BrowserFailureKind =
  | "console-error"
  | "page-error"
  | "asset-failed"
  | "hydration-mismatch"
  | "page-overflow"
  | "layout-collision"
  | "focus-broken"
  | "published-metadata"
  | "idle-request"
  | "protected-request"
  | "state-not-reached"
  | "http-response"
  | "accessibility";

export interface BrowserFailure {
  readonly kind: BrowserFailureKind;
  readonly detail: string;
}

/** React reports hydration problems as console text or a thrown error. */
const HYDRATION_MARKERS = [
  "hydration failed",
  "text content does not match",
  "did not match. server:",
  "server rendered html didn't match",
  "there was an error while hydrating",
];

/**
 * A production build minifies React's messages, so the English text above
 * never appears in exactly the build this harness exists to test. These are
 * the minified codes React uses for hydration failures.
 */
const HYDRATION_ERROR_CODES = [418, 421, 422, 423, 425];

const isHydrationMismatch = (text: string): boolean => {
  const normalized = text.toLowerCase();
  if (HYDRATION_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }
  const minified = /minified react error #(\d+)/u.exec(normalized);
  return (
    minified !== null && HYDRATION_ERROR_CODES.includes(Number(minified[1]))
  );
};

/**
 * Requests that must never be issued before an authenticated admin session
 * exists. A leak here means protected data was fetched by an anonymous page.
 */
const PROTECTED_PATH_MARKERS = [
  "/v1/admin/diagnostics/",
  "/api/admin/history/",
];

const isResourceLoadNotice = (text: string): boolean =>
  text.startsWith("Failed to load resource:");

const isProtectedRequest = (url: string): boolean =>
  PROTECTED_PATH_MARKERS.some((marker) => url.includes(marker));

/** Asset classes whose failure breaks a production page. */
const ASSET_RESOURCE_TYPES = new Set(["script", "stylesheet", "font", "image"]);

export interface BrowserObserver {
  readonly failures: readonly BrowserFailure[];
  /** Allows a fixture to permit protected requests once auth is established. */
  readonly allowProtectedRequests: () => void;
  readonly record: (failure: BrowserFailure) => void;
}

export interface ApplicationRequestCounts {
  readonly jsonRpc: number;
  readonly publicApi: number;
}

export interface ApplicationRequestObserver {
  readonly reset: () => void;
  readonly snapshot: () => ApplicationRequestCounts;
}

const classifyApplicationRequest = (
  request: Request,
): keyof ApplicationRequestCounts | undefined => {
  const pathname = new URL(request.url()).pathname;
  if (
    pathname.startsWith("/v1/history/") ||
    pathname.startsWith("/v1/funding/") ||
    pathname.startsWith("/api/admin/")
  ) {
    return "publicApi";
  }
  const body = request.postData();
  return request.method() === "POST" && body?.includes('"jsonrpc"') === true
    ? "jsonRpc"
    : undefined;
};

/** Counts only application data reads, excluding assets and wallet metadata. */
export const observeApplicationRequests = (
  page: Page,
): ApplicationRequestObserver => {
  let counts: ApplicationRequestCounts = { jsonRpc: 0, publicApi: 0 };
  page.on("request", (request: Request) => {
    const kind = classifyApplicationRequest(request);
    if (kind === undefined) return;
    counts = { ...counts, [kind]: counts[kind] + 1 };
  });
  return {
    reset: () => {
      counts = { jsonRpc: 0, publicApi: 0 };
    },
    snapshot: () => ({ ...counts }),
  };
};

export const idleRequestFailure = (
  label: string,
  counts: ApplicationRequestCounts,
): BrowserFailure | undefined => {
  const total = counts.jsonRpc + counts.publicApi;
  return total === 0
    ? undefined
    : {
        kind: "idle-request",
        detail: `${label}: ${counts.jsonRpc} JSON-RPC and ${counts.publicApi} public API request(s) fired after initial reads settled without any interaction`,
      };
};

export const observePage = (page: Page): BrowserObserver => {
  const failures: BrowserFailure[] = [];
  let protectedAllowed = false;

  const record = (failure: BrowserFailure): void => {
    failures.push(failure);
  };

  page.on("console", (message: ConsoleMessage) => {
    const text = message.text();
    if (isHydrationMismatch(text)) {
      record({ detail: text.slice(0, 400), kind: "hydration-mismatch" });
      return;
    }
    // The browser emits a generic "Failed to load resource" line for every
    // non-2xx response, including documents this matrix deliberately expects
    // to 404 and requests a fixture deliberately fails. The request handlers
    // below report real asset failures with precise detail, so this lower
    // fidelity duplicate would only add noise.
    if (message.type() === "error" && !isResourceLoadNotice(text)) {
      record({ detail: text.slice(0, 400), kind: "console-error" });
    }
  });

  page.on("pageerror", (error: Error) => {
    record({
      detail: error.message.slice(0, 400),
      kind: isHydrationMismatch(error.message)
        ? "hydration-mismatch"
        : "page-error",
    });
  });

  page.on("requestfailed", (request: Request) => {
    if (!ASSET_RESOURCE_TYPES.has(request.resourceType())) return;
    record({
      kind: "asset-failed",
      detail: `${request.resourceType()} ${request.url()} (${
        request.failure()?.errorText ?? "unknown"
      })`,
    });
  });

  page.on("response", (response: Response) => {
    const request = response.request();
    if (
      ASSET_RESOURCE_TYPES.has(request.resourceType()) &&
      response.status() >= 400
    ) {
      record({
        kind: "asset-failed",
        detail: `${request.resourceType()} ${response.url()} returned ${response.status()}`,
      });
    }
  });

  page.on("request", (request: Request) => {
    if (protectedAllowed || !isProtectedRequest(request.url())) return;
    record({
      kind: "protected-request",
      detail: `${request.method()} ${request.url()} before authentication`,
    });
  });

  return {
    failures,
    allowProtectedRequests: () => {
      protectedAllowed = true;
    },
    record,
  };
};

/**
 * Real layout geometry, which CSS-text inspection cannot provide. A tolerance
 * of one pixel absorbs sub-pixel rounding without hiding a real overflow.
 */
export const pageOverflow = async (
  page: Page,
): Promise<{ readonly scrollWidth: number; readonly clientWidth: number }> =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

export const overflowFailure = (
  label: string,
  measured: { readonly scrollWidth: number; readonly clientWidth: number },
): BrowserFailure | undefined =>
  measured.scrollWidth > measured.clientWidth + 1
    ? {
        kind: "page-overflow",
        detail: `${label}: document scrolls to ${measured.scrollWidth}px inside ${measured.clientWidth}px`,
      }
    : undefined;

/**
 * Header contents can visually overlap while the document still has no
 * horizontal overflow. Measure the collector's actual interactive boxes so a
 * cramped brand, navigation, or wallet area fails independently of scrolling.
 */
export const collectorHeaderCollisionFailure = async (
  page: Page,
  label: string,
): Promise<BrowserFailure | undefined> => {
  const measured = await page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>(
      'nav[aria-label="Collector navigation"]',
    );
    if (navigation === null) return undefined;
    const header = navigation.closest("header") as HTMLElement;
    const toggle = header.querySelector<HTMLElement>(
      '[aria-controls="collector-navigation"]',
    );
    const brand = header.querySelector<HTMLElement>("a") as HTMLElement;
    const actions =
      header.querySelector<HTMLElement>("[data-collector-wallet-actions]") ??
      toggle?.parentElement;
    if (actions === null || actions === undefined) return undefined;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    };
    const visibleLinkBox = (element: Element) => {
      const result = box(element);
      for (
        let ancestor = element.parentElement;
        ancestor !== null && ancestor !== header;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const clip = box(ancestor);
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          result.top = Math.max(result.top, clip.top);
          result.bottom = Math.min(result.bottom, clip.bottom);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          result.left = Math.max(result.left, clip.left);
          result.right = Math.min(result.right, clip.right);
        }
      }
      return result;
    };
    const links = [...navigation.querySelectorAll<HTMLElement>("a")].filter(
      (link) => link.getBoundingClientRect().width > 0,
    );
    return {
      actions: box(actions),
      brand: box(brand),
      first: visibleLinkBox(links.at(0) ?? brand),
      last: visibleLinkBox(links.at(-1) ?? brand),
      // The responsive menu hides an ancestor, so the nav's own display
      // value can remain block while none of its links have a rendered box.
      navigationVisible: links.length > 0,
    };
  });

  if (measured === undefined) return undefined;

  /* The shell is a horizontal bar on phones and a vertical rail on laptops, so
   * ordering along one axis says nothing. Two boxes collide when they overlap
   * on both axes by more than the tolerance. */
  const tolerance = 1;
  type Box = typeof measured.brand;
  const overlaps = (a: Box, b: Box) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
  const describe = (name: string, a: Box) =>
    `${name} at ${a.left.toFixed(1)}–${a.right.toFixed(1)}px × ${a.top.toFixed(1)}–${a.bottom.toFixed(1)}px`;

  let collision: string | undefined;
  if (overlaps(measured.brand, measured.actions)) {
    collision = `${describe("brand", measured.brand)} overlaps ${describe("actions", measured.actions)}`;
  } else if (
    measured.navigationVisible &&
    overlaps(measured.brand, measured.first)
  ) {
    collision = `${describe("brand", measured.brand)} overlaps ${describe("first navigation link", measured.first)}`;
  } else if (
    measured.navigationVisible &&
    overlaps(measured.last, measured.actions)
  ) {
    collision = `${describe("last navigation link", measured.last)} overlaps ${describe("actions", measured.actions)}`;
  }

  return collision === undefined
    ? undefined
    : { detail: `${label}: ${collision}`, kind: "layout-collision" };
};

/** The promoted faucet utility must be both rendered and reachable above any
 * transient wallet notice in the sticky collector header. */
export const collectorFundingVisibilityFailure = async (
  page: Page,
  label: string,
): Promise<BrowserFailure | undefined> => {
  const visibleLink = page.locator(
    '[data-shell="collector"] header a[href="/faucet"]:visible',
  );
  if ((await visibleLink.count()) === 1) {
    // Hydration opens and closes the real wallet chooser. Let its exit layer
    // finish releasing pointer events before testing the header beneath it.
    await visibleLink.click({ trial: true, timeout: 5_000 }).catch(() => {});
  }
  const issue = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '[data-shell="collector"] header',
    );
    if (header === null) return undefined;
    const links = [
      ...header.querySelectorAll<HTMLAnchorElement>('a[href="/faucet"]'),
    ].filter((link) => {
      const style = getComputedStyle(link);
      const rect = link.getBoundingClientRect();
      return [
        style.display !== "none",
        style.visibility !== "hidden",
        Number(style.opacity) > 0,
        rect.width > 0,
        rect.height > 0,
      ].every(Boolean);
    });
    if (links.length !== 1)
      return `expected one visible Get test funds link, found ${links.length}`;
    const link = links[0]!;
    const rect = link.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    if (top === null || (!link.contains(top) && !top.contains(link)))
      return `Get test funds is obscured by ${top?.tagName.toLowerCase() ?? "nothing"}`;
    if (
      [
        rect.left < 0,
        rect.top < 0,
        rect.right > document.documentElement.clientWidth,
        rect.bottom > document.documentElement.clientHeight,
      ].some(Boolean)
    )
      return "Get test funds is clipped outside the viewport";
    return undefined;
  });
  return issue === undefined
    ? undefined
    : { detail: `${label}: ${issue}`, kind: "layout-collision" };
};

/**
 * Keyboard entry must reach a visible, focusable control. A skip link that
 * cannot be focused is a broken keyboard path even when it exists in the DOM.
 */
export const focusFailure = async (
  page: Page,
  label: string,
): Promise<BrowserFailure | undefined> => {
  const startedOnControl = await page.evaluate(() => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.tabIndex >= 0
    );
  });
  await page.keyboard.press("Tab");
  const readFocus = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return undefined;
      const rectangle = active.getBoundingClientRect();
      return {
        tag: active.tagName.toLowerCase(),
        visible: rectangle.width > 0 && rectangle.height > 0,
      };
    });
  let focused = await readFocus();
  // A final control can tab into browser chrome. Its forward tab-cycle length
  // varies by platform; reverse that one traversal only when focus really left
  // the document. BODY focus loss inside the page remains a failure.
  if (
    focused === undefined &&
    startedOnControl &&
    !(await page.evaluate(() => document.hasFocus()))
  ) {
    await page.keyboard.press("Shift+Tab");
    focused = await readFocus();
  }
  if (focused === undefined) {
    return { kind: "focus-broken", detail: `${label}: Tab reached no control` };
  }
  return focused.visible
    ? undefined
    : {
        kind: "focus-broken",
        detail: `${label}: first focused control <${focused.tag}> has no visible box`,
      };
};

/** Check computed styles and rendered geometry, independent of CSS class names. */
export const renderedStyleFailures = async (
  page: Page,
  label: string,
): Promise<readonly BrowserFailure[]> => {
  const details = await page.evaluate(() => {
    const failures: string[] = [];
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]',
    )) {
      if (input.getClientRects().length === 0) continue;
      if (Number.parseFloat(getComputedStyle(input).fontSize) < 16) {
        failures.push(
          `numeric input ${input.getAttribute("aria-label") || input.name || input.id} is smaller than 16px`,
        );
      }
    }
    // Put a real base-unit balance into the narrowest rendered metric cell.
    // Keep and restore the original nodes; only the data varies, not markup.
    const cell = [...document.querySelectorAll<HTMLElement>("dl dd")]
      .filter((candidate) => candidate.getClientRects().length > 0)
      .sort((a, b) => a.clientWidth - b.clientWidth)[0];
    if (cell !== undefined) {
      const children = [...cell.childNodes];
      try {
        cell.textContent = "0.000000000000000001 WETH";
        if (cell.scrollWidth > cell.clientWidth + 1)
          failures.push("exact base-unit balance overflows its metric cell");
      } finally {
        cell.replaceChildren(...children);
      }
    }
    return failures;
  });
  const chart = page.getByRole("img", { name: /market history$/u });
  if ((await chart.count()) > 0) {
    await chart.first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const visibleFocus = await chart.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        document.activeElement === element &&
        element.matches(":focus-visible") &&
        style.outlineStyle !== "none" &&
        Number.parseFloat(style.outlineWidth) > 0 &&
        style.outlineColor !== "rgba(0, 0, 0, 0)"
      );
    });
    if (!visibleFocus)
      details.push("keyboard focus on the chart has no visible outline");
  }
  return details.map((detail) => ({
    kind: "accessibility",
    detail: `${label}: ${detail}`,
  }));
};
