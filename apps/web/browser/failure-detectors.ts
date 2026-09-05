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
    ) as HTMLElement;
    const brand = header.querySelector<HTMLElement>("a") as HTMLElement;
    const actions = toggle.parentElement as HTMLElement;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    };
    const links = [...navigation.querySelectorAll<HTMLElement>("a")].filter(
      (link) => link.getBoundingClientRect().width > 0,
    );
    return {
      actions: box(actions),
      brand: box(brand),
      first: box(links.at(0) ?? brand),
      last: box(links.at(-1) ?? brand),
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

/**
 * Keyboard entry must reach a visible, focusable control. A skip link that
 * cannot be focused is a broken keyboard path even when it exists in the DOM.
 */
export const focusFailure = async (
  page: Page,
  label: string,
): Promise<BrowserFailure | undefined> => {
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return undefined;
    const rectangle = active.getBoundingClientRect();
    return {
      tag: active.tagName.toLowerCase(),
      visible: rectangle.width > 0 && rectangle.height > 0,
    };
  });
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
