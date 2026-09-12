import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import type { Page } from "playwright";
import {
  CollectorFixture,
  COLLECTOR_VRF_REQUEST,
} from "./collector-fixture.ts";

import { assertMobileCollectionText } from "./mobile-accessibility.ts";

async function submitLaunch(page: Page) {
  await page
    .getByRole("heading", { name: "Grounded Craft #42", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review Launch", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Burn 1 $FUEL and Launch", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
}

export async function checkLaunchJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  await submitLaunch(page);
  assert.equal(fixture.submissions.length, 1);
  await page.reload();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.locator('[data-slot="popover-content"]');
  await notifications
    .getByText("No new notifications.", { exact: true })
    .waitFor();
  // Confirmation must arrive while the panel is open so closing it proves
  // that newly displayed activity is marked read, including across reload.
  fixture.confirm();
  await page
    .getByRole("heading", { name: "Orbiter #42", exact: true })
    .waitFor({ timeout: 20_000 });
  await notifications
    .getByRole("link", { name: "View Orbiter #42", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Help with this wallet action",
        exact: true,
      })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await notifications.waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Back to Fleet", exact: true }).click();
  await page
    .getByRole("link", { name: /Inspect/ })
    .first()
    .waitFor({ timeout: 20_000 });
  assert.ok((await page.locator("main").innerText()).includes("42"));
  await assertMobileCollectionText(page, true);
  assert.equal(fixture.submissions.length, 1);
  assert.equal(await page.locator('[data-status="confirmed"]').count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Dismiss completed activity", exact: true })
      .count(),
    0,
  );
  await page.reload();
  await page
    .getByRole("link", { name: /Inspect/ })
    .first()
    .waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('[data-status="confirmed"]').count(), 0);
  assert.equal(await page.locator("#collector-activity").count(), 0);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  assert.equal(
    await page
      .locator('[data-slot="popover-content"]')
      .getByText("No new notifications.", { exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole("link", { name: "View transaction", exact: true })
      .count(),
    0,
  );
  assert.equal(fixture.submissions.length, 1);
  await page.keyboard.press("Escape");
  await page
    .locator('[data-slot="popover-content"]')
    .waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") === "Notifications",
  );
  assert.equal(
    await page
      .getByRole("button", { name: /^Notifications/ })
      .evaluate((button) => button === document.activeElement),
    true,
  );
  await page.getByRole("link", { name: "Rewards", exact: true }).click();
  await page
    .getByRole("button", {
      name: "How your rewards are progressing",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "When will my Orbiter receive rewards?",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("progressbar", {
      name: "Funding for the next reward cycle",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), "0");
  assert.ok((await page.locator("main").innerText()).includes("Your track"));
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === "/fleet" && !url.searchParams.has("view"),
  );
}

export async function checkPartialRewardsJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  await page.getByText(/Some rewards are still updating/).waitFor();
  await page
    .getByRole("button", { name: "Claim eligible rewards", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByText(
      "Known rewards only. Identities still updating are not included in this claim.",
    )
    .waitFor();
  const text = await dialog.innerText();
  assert.ok(text.includes("METAc") && text.includes("NVDAc"));
  assert.ok(
    !text.includes("5.0000"),
    "Different reward assets must not be summed into one total",
  );
  assert.equal(fixture.submissions.length, 0);
  await dialog
    .getByRole("button", { name: "Confirm claim", exact: true })
    .click();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
  assert.equal(fixture.submissions.length, 1);
  const submitted = fixture.decodeSubmission();
  assert.equal(submitted.functionName, "claim");
  assert.deepEqual(submitted.args?.[0], [42, 43]);
  fixture.rewardsClaimed = true;
  fixture.receiptAvailable = true;
  fixture.blockNumber += 1n;
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  await page.getByText("No claimable rewards", { exact: true }).waitFor();
  assert.equal(fixture.submissions.length, 1);
}

export async function checkReceiptRecoveryJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  await submitLaunch(page);
  await page
    .getByText("Waiting for transaction confirmation", { exact: true })
    .waitFor();
  assert.equal(fixture.submissions.length, 1);
  fixture.receiptFailures = 0;
  fixture.confirm();
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  await page
    .getByRole("heading", { name: "Orbiter #42", exact: true })
    .waitFor();
  assert.equal(fixture.submissions.length, 1);
}

export async function checkQuoteRecoveryJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  const input = page.getByLabel("You pay", { exact: true });
  const selector = toFunctionSelector("quoteExactInput(bool,uint256)").slice(2);
  fixture.holdNextQuote = true;
  fixture.quoteRateLimits = 1;
  const first = page.waitForRequest(
    (request) => request.postData()?.includes(selector) === true,
  );
  await input.fill("0.01");
  await first;
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request.postData()?.includes(selector) === true,
  });
  await input.fill("0.02");
  await aborted;
  await input.fill("0.03");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor({ timeout: 15_000 });
  assert.ok(fixture.quoteAborts >= 1);
  assert.ok(
    fixture.quoteRequests <= 4,
    `Expected <=4 quote HTTP requests, observed ${fixture.quoteRequests}`,
  );
  assert.equal(fixture.submissions.length, 0);
  await page
    .getByRole("link", { name: "My Fleet", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("heading", { name: "My Fleet", exact: true }).waitFor();
}

export async function checkFundingDiscoveryJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  await page.locator('[data-funding-state="eligible"]').waitFor();
  await page
    .locator('[data-funding-state="eligible"]')
    .getByRole("button")
    .click();
  await page
    .getByText("Your top-up is being processed", { exact: true })
    .waitFor();
  assert.equal(fixture.fundingRequests, 1);
  fixture.fundingFailures = 1;
  const unavailable = page.waitForResponse(
    (response) =>
      response.url().includes("/v1/funding/status") &&
      response.status() === 503,
  );
  await unavailable;
  await page.reload();
  await page
    .getByText("Your top-up is being processed", { exact: true })
    .waitFor();
  fixture.funded = true;
  fixture.fundingPending = false;
  await page
    .locator('[data-funding-state="funded"]')
    .waitFor({ timeout: 10_000 });
  assert.equal(fixture.fundingRequests, 1);
  await page
    .getByRole("link", { name: "Buy $FUEL on Trade", exact: true })
    .click();
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Buy $FUEL", exact: true })
    .and(page.locator(":not([aria-pressed])"))
    .click();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
  fixture.receiptAvailable = true;
  fixture.pending = true;
  fixture.blockNumber += 1n;
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  await page
    .getByRole("link", { name: "My Fleet", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByText(/Your Discovery is taking longer than usual/i)
    .first()
    .waitFor();
  assert.ok(
    !(await page.locator("main").innerText()).includes("No collectibles yet"),
  );
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      COLLECTOR_VRF_REQUEST.toString(),
    ),
  );
  await assertMobileCollectionText(page, false);
  fixture.pending = false;
  fixture.delivered = true;
  fixture.blockNumber += 1n;
  await page
    .getByRole("link", { name: /Inspect/ })
    .first()
    .waitFor({ timeout: 35_000 });
  assert.equal(fixture.submissions.length, 1);
  assert.equal(fixture.fundingRequests, 1);
  await page
    .getByRole("link", { name: "Protocol status", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Protocol status", exact: true })
    .waitFor();
  assert.equal(await page.locator("#collector-activity").count(), 0);
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      "Checking discovery progress",
    ),
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Protocol status", exact: true })
    .waitFor();
  assert.equal(await page.locator("#collector-activity").count(), 0);
  await page
    .getByRole("link", { name: "My Fleet", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("link", { name: /Inspect/ })
    .first()
    .waitFor();
}

export async function checkTradeStagesJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  // A fresh Trade entry loads market history; advanced controls are optional.
  await page
    .getByRole("button", { name: "Advanced chart", exact: true })
    .click();
  await page.getByRole("group", { name: "Chart range", exact: true }).waitFor();
  fixture.receiptAvailable = true;
  const input = page.getByLabel("You pay", { exact: true });
  const submit = (label: string) =>
    page
      .getByRole("button", { name: label, exact: true })
      .and(page.locator(":not([aria-pressed])"));
  await page.getByRole("button", { name: "ETH", exact: true }).click();
  await input.fill("0.01");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  fixture.rejectNextSubmission = true;
  await submit("Buy $FUEL").click();
  await page
    .getByText(
      /The wallet cancelled this request. No transaction was submitted./,
    )
    .waitFor();
  assert.equal(fixture.submissions.length, 0);
  await page.getByRole("button", { name: "ETH", exact: true }).click();
  await input.fill("0.01");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  await submit("Buy $FUEL").click();
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  assert.equal(fixture.submissions.length, 1);
  assert.equal(fixture.decodeSubmission().functionName, "swapExactInput");
  assert.deepEqual(fixture.decodeSubmission().args?.[0], {
    ...(fixture.decodeSubmission().args?.[0] as object),
    useNative: true,
    fuelForWeth: false,
    amountIn: 10n ** 16n,
  });
  await page
    .getByRole("button", { name: "Dismiss completed activity", exact: true })
    .click();
  fixture.allowance = 0n;
  await page.getByRole("button", { name: "WETH", exact: true }).click();
  await input.fill("0.02");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  await submit("Buy $FUEL").click();
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  assert.equal(fixture.submissions.length, 3);
  assert.equal(fixture.decodeSubmission(1).functionName, "approve");
  assert.equal(fixture.decodeSubmission(2).functionName, "swapExactInput");
  assert.equal(
    (fixture.decodeSubmission(2).args?.[0] as { useNative: boolean }).useNative,
    false,
  );
  await page
    .getByRole("button", { name: "Dismiss completed activity", exact: true })
    .click();
  fixture.allowance = 100n * 10n ** 18n;
  await page
    .getByRole("button", { name: "Sell $FUEL", exact: true })
    .and(page.locator("[aria-pressed]"))
    .click();
  await input.fill("0.1");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  await submit("Sell $FUEL").click();
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  assert.equal(fixture.submissions.length, 4);
  assert.equal(
    (fixture.decodeSubmission(3).args?.[0] as { fuelForWeth: boolean })
      .fuelForWeth,
    true,
  );
}

export async function checkApprovalReloadJourney(
  page: Page,
  fixture: CollectorFixture,
) {
  fixture.allowance = 0n;
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  const buy = page
    .getByRole("button", { name: "Buy $FUEL", exact: true })
    .and(page.locator(":not([aria-pressed])"));
  await buy.click();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
  assert.equal(fixture.decodeSubmission().functionName, "approve");
  assert.equal(fixture.submissions.length, 1);
  await page.reload();
  fixture.allowance = 100n * 10n ** 18n;
  fixture.receiptAvailable = true;
  await page
    .getByText(/no exchange was submitted/)
    .waitFor({ timeout: 20_000 });
  assert.equal(fixture.submissions.length, 1);
  await page
    .getByRole("button", { name: "Dismiss completed activity", exact: true })
    .click();
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await page
    .getByRole("region", { name: "Review trade", exact: true })
    .waitFor();
  await buy.click();
  await page
    .getByText("Confirmed on Base Sepolia", { exact: true })
    .waitFor({ timeout: 20_000 });
  assert.equal(fixture.submissions.length, 2);
  assert.equal(fixture.decodeSubmission().functionName, "swapExactInput");
}
