import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import manifest from "./manifest";

const foundations = readFileSync(
  new URL("./styles/foundations.css", import.meta.url),
  "utf8",
);

const themeValue = (token: string): string | undefined =>
  new RegExp(`--${token}:\\s*(?<value>#[\\da-f]{6});`, "iu").exec(foundations)
    ?.groups?.value;

describe("application manifest theme", () => {
  it("stays bound to the visible paper-and-ink theme", () => {
    expect(themeValue("canvas")).toBeDefined();
    expect(themeValue("accent-fill")).toBeDefined();
    expect(manifest()).toMatchObject({
      background_color: themeValue("canvas"),
      theme_color: themeValue("accent-fill"),
    });
  });
});
