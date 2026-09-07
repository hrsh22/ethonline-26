import assert from "node:assert/strict";
import type { Page } from "playwright";
import { overflowFailure, pageOverflow } from "./failure-detectors.ts";

export async function assertNoOverflow(page: Page, label: string) {
  const failure = overflowFailure(label, await pageOverflow(page));
  if (failure === undefined) return;
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          (element.getBoundingClientRect().right > innerWidth + 1 ||
            (element instanceof HTMLElement &&
              element.scrollWidth > element.clientWidth + 1)) &&
          element.children.length < 2,
      )
      .map((element) => ({
        tag: element.tagName,
        text: element.textContent?.slice(0, 100),
        rect: element.getBoundingClientRect().toJSON(),
      }))
      .slice(0, 12),
  );
  assert.fail(`${failure.detail}: ${JSON.stringify(overflowing)}`);
}

async function assertSharedActionWraps(page: Page) {
  const measured = await page
    .getByRole("button", { name: "Preview Grounded", exact: true })
    .first()
    .evaluate((source) => {
      const container = document.createElement("div");
      container.style.width = "160px";
      const action = source.cloneNode(true) as HTMLButtonElement;
      action.textContent = "Go on to the next step or go back";
      container.append(action);
      document.body.append(container);
      try {
        return {
          height: action.getBoundingClientRect().height,
          minimum: Number.parseFloat(getComputedStyle(action).minHeight),
          width: action.getBoundingClientRect().width,
          scrollWidth: container.scrollWidth,
        };
      } finally {
        container.remove();
      }
    });
  assert.ok(
    measured.height > measured.minimum,
    "Long shared text actions must grow beyond their minimum height",
  );
  assert.ok(
    measured.width <= 160 && measured.scrollWidth <= 160,
    "Shared text actions must fit their available width",
  );
}

/** Browser emulation checks; these do not establish physical-wallet support. */
export async function checkMobileAccessibility(page: Page, origin: string) {
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
    "auto",
  );
  const preview = page
    .getByRole("button", { name: "Preview Orbiter", exact: true })
    .first();
  await preview.click();
  const groundedPreview = page
    .getByRole("button", { name: "Preview Grounded", exact: true })
    .first();
  await groundedPreview.waitFor();
  assert.equal(
    await groundedPreview.evaluate(
      (button) => getComputedStyle(button).transitionProperty,
    ),
    "none",
  );

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.evaluate(() => document.fonts.ready);
  await assertSharedActionWraps(page);
  await assertNoOverflow(page, "Relics at 200% root text");
  const navigation = page.locator("[data-mobile-navigation]");
  for (const [name, path] of [
    ["Fleet", "/fleet"],
    ["Trade", "/exchange"],
    ["Rewards", "/rewards"],
  ] as const) {
    await navigation.getByRole("link", { name, exact: true }).click();
    await page.waitForURL(`${origin}${path}`);
    assert.equal(
      await navigation
        .getByRole("link", { name, exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await assertNoOverflow(page, `${name} at 200% root text`);
  }
  await page.goBack();
  await page.waitForURL(`${origin}/exchange`);
  assert.equal(
    await navigation
      .getByRole("link", { name: "Trade", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    ),
    32,
  );
  await assertNoOverflow(page, "Back to Trade at 200% root text");
  await assertShortViewportFocus(page);
  await page
    .getByRole("link", { name: "ORBIT 4444: Protocol overview", exact: true })
    .click();
  await page.waitForURL(`${origin}/`);
  await page
    .getByRole("region", { name: "Explore the collection" })
    .scrollIntoViewIfNeeded();
  await assertNoOverflow(page, "Public gallery at 200% root text");
}

/** Native Tab scrolling must account for the fixed collector navigation. */
async function assertShortViewportFocus(page: Page) {
  const viewport = page.viewportSize();
  const previous = await page.evaluate(() => {
    const style = document.documentElement.style;
    const saved = {
      fontSize: style.fontSize,
      scrollBehavior: style.scrollBehavior,
    };
    style.fontSize = "100%";
    // Measure the scroll destination independently of animation timing.
    style.scrollBehavior = "auto";
    return saved;
  });
  try {
    await page.setViewportSize({ width: 375, height: 350 });
    await page.getByRole("textbox", { name: "You pay", exact: true }).focus();
    await page.keyboard.press("Tab");
    const bounds = await page
      .getByRole("textbox", { name: "You receive", exact: true })
      .evaluate((input) => ({
        focused: document.activeElement === input,
        input: input.getBoundingClientRect().toJSON(),
        header: document
          .querySelector("header")!
          .getBoundingClientRect()
          .toJSON(),
        navigation: document
          .querySelector("[data-mobile-navigation]")!
          .getBoundingClientRect()
          .toJSON(),
      }));
    assert.ok(bounds.focused, "Tab must reach the receive amount");
    assert.ok(
      bounds.input.top >= bounds.header.bottom + 6 &&
        bounds.input.bottom <= bounds.navigation.top - 6,
      `Focused amount must stay between the header and mobile navigation: ${JSON.stringify(bounds)}`,
    );
  } finally {
    await page.evaluate(
      (saved) => Object.assign(document.documentElement.style, saved),
      previous,
    );
    if (viewport !== null) await page.setViewportSize(viewport);
  }
}

/** Measure text ink too: overflow-hidden can conceal a broken segmented label. */
export async function assertFleetFiltersReadable(page: Page) {
  const controls = page
    .getByRole("group", { name: "Filter collection" })
    .getByRole("button");
  assert.equal(await controls.count(), 3);
  for (const button of await controls.all()) {
    const bounds = await button.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = element.getBoundingClientRect();
      return {
        label: element.textContent,
        box: box.toJSON(),
        text: [...range.getClientRects()].map((rect) => rect.toJSON()),
      };
    });
    assert.ok(
      bounds.text.every(
        (rect) =>
          rect.left >= bounds.box.left - 1 &&
          rect.right <= bounds.box.right + 1 &&
          rect.top >= bounds.box.top - 1 &&
          rect.bottom <= bounds.box.bottom + 1,
      ),
      `Fleet filter text must remain fully visible: ${JSON.stringify(bounds)}`,
    );
  }
}

export async function assertMobileCollectionText(page: Page, filters: boolean) {
  const viewport = page.viewportSize();
  const previousSize = await page.evaluate(
    () => document.documentElement.style.fontSize,
  );
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const size of ["100%", "200%"]) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = value;
      }, size);
      await page.evaluate(() => document.fonts.ready);
      if (filters) await assertFleetFiltersReadable(page);
      await assertNoOverflow(page, `Fleet at375px and ${size} text`);
    }
  } finally {
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = value;
    }, previousSize);
    if (viewport !== null) await page.setViewportSize(viewport);
  }
}
