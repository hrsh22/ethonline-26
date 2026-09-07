import assert from "node:assert/strict";
import type { Page } from "playwright";

/** Public collector journey; uses the existing browser/HTTP boundary. */
export async function checkPublicCollection(page: Page, origin: string) {
  assert.equal(new URL(page.url()).pathname, "/");
  const gallery = page.getByRole("region", { name: "Explore the collection" });
  assert.equal(await gallery.getByRole("link").count(), 8);
  await page.getByRole("textbox", { name: "Find an identity" }).fill("0042");
  // Input focus must not hide the fixed navigation: reappearing on submit
  // pointerdown can intercept pointerup and discard the user's click.
  assert.equal(
    await page.locator("[data-mobile-navigation]").isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Open identity" }).click();
  await page
    .getByText(
      "Enter a whole identity number from 1 to 4444, without leading zeros.",
    )
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.getByRole("textbox", { name: "Find an identity" }).fill("42");
  await page.getByRole("button", { name: "Open identity" }).click();
  await page.waitForURL(`${origin}/fleet/42`);
  await page.getByRole("button", { name: "Copy craft link" }).waitFor();
  const imageUrl = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  assert.ok(imageUrl);
  const path = new URL(imageUrl, origin).pathname;
  const first = await page.request.get(`${origin}${path}`);
  assert.equal(first.status(), 200);
  assert.match(first.headers()["content-type"] ?? "", /image\/png/);
  assert.ok((await first.body()).length > 1000);
  const second = await page.request.get(`${origin}${path}`);
  assert.deepEqual(await first.body(), await second.body());
  assert.match(await page.title(), /42/);

  // Browser platform boundaries are controlled; no external share recipient.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });
  await page.getByRole("button", { name: "Share craft", exact: true }).click();
  await page.getByText("Public craft link copied.").waitFor();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    }),
  );
  await page.getByRole("button", { name: "Share craft", exact: true }).click();
  await page.getByText("Sharing complete.").waitFor();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    }),
  );
  await page.getByRole("button", { name: "Share craft", exact: true }).click();
  await page
    .getByText("Sharing cancelled. You can still copy the link.")
    .waitFor();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Copy craft link" }).click();
  const manual = page.getByRole("textbox", { name: "Public craft link" });
  await manual.waitFor();
  assert.equal(await manual.inputValue(), `${origin}/fleet/42`);
}
