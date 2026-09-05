import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const providerSource = readFileSync(
  new URL("./wallet-provider.tsx", import.meta.url),
  "utf8",
);
const foundations = readFileSync(
  new URL("../app/styles/foundations.css", import.meta.url),
  "utf8",
);

const rootBlock = /:root\s*\{(?<body>[^}]*)\}/u.exec(foundations)?.groups?.body;
const token = (name: string): string | undefined =>
  new RegExp(`--${name}:\\s*(?<value>#[\\da-f]{6});`, "iu").exec(
    rootBlock ?? "",
  )?.groups?.value;

describe("wallet provider theme", () => {
  it("pins the wallet modal to the single dark theme", () => {
    expect(providerSource).toMatch(/themeMode:\s*"dark"/u);
    expect(providerSource).not.toMatch(/prefers-color-scheme/u);
  });

  it("mirrors the graphite accent and canvas literals", () => {
    // Reown cannot read custom properties, so the literals are asserted
    // against the token map rather than duplicated by hand.
    const accentFill = token("accent-fill");
    const canvas = token("canvas");
    expect(accentFill).toBeDefined();
    expect(canvas).toBeDefined();
    expect(providerSource).toContain(`"--w3m-accent": "${accentFill}"`);
    expect(providerSource).toContain(`"--w3m-color-mix": "${canvas}"`);
  });

  it("offers intentional wallet providers without an unrelated email login", () => {
    expect(providerSource).toMatch(/email:\s*false/u);
    expect(providerSource).toMatch(/emailShowWallets:\s*false/u);
    expect(providerSource).toMatch(/allWallets:\s*"SHOW"/u);
    expect(providerSource).toMatch(/featuredWalletIds:\s*\[/u);
  });
});
