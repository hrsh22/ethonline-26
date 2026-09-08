import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { CollectorFixture } from "./collector-fixture.ts";

/** Uses real provider/rendering paths with test-only RPC; never submits. */
export async function checkHangarSelection(
  page: Page,
  fixture: CollectorFixture,
) {
  const selector = page.locator(
    '[data-fleet-hangar] button[data-craft-id="43"]',
  );
  await selector.click();
  assert.equal(await selector.getAttribute("aria-pressed"), "true");
  assert.equal(new URL(page.url()).searchParams.get("selected"), "43");
  await page
    .locator("[data-featured-craft]")
    .getByRole("link", { name: "Inspect Orbiter #43", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Orbiter #43", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Back to Fleet", exact: true }).click();
  await selector.waitFor();
  assert.equal(await selector.getAttribute("aria-pressed"), "true");
  await page.getByRole("link", { name: "Review claims", exact: true }).click();
  await page
    .getByRole("button", { name: "Claim eligible rewards", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("selected"), "43");
  await page
    .getByRole("navigation", { name: "My Fleet views", exact: true })
    .getByRole("link", { name: "Collection", exact: true })
    .click();
  await selector.waitFor();
  assert.equal(await selector.getAttribute("aria-pressed"), "true");
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  const artwork = await page
    .locator("[data-featured-craft] svg")
    .first()
    .boundingBox();
  assert.ok(
    artwork && artwork.y < page.viewportSize()!.height - 64,
    "Featured craft should begin within the first viewport",
  );
  assert.equal(fixture.submissions.length, 0);
}
