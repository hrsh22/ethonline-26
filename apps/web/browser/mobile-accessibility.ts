import assert from "node:assert/strict";
import type { Page } from "playwright";
import { overflowFailure, pageOverflow } from "./failure-detectors.ts";

async function assertNoOverflow(page: Page, label: string) {
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

/** Browser emulation checks; these do not establish physical-wallet support. */
export async function checkMobileAccessibility(page: Page, origin: string) {
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
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
  await page
    .getByRole("link", { name: "ORBIT 4444: Protocol overview", exact: true })
    .click();
  await page.waitForURL(`${origin}/`);
  await page
    .getByRole("region", { name: "Explore the collection" })
    .scrollIntoViewIfNeeded();
  await assertNoOverflow(page, "Public gallery at 200% root text");
}
