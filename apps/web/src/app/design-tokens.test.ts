import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("./styles/foundations.css", import.meta.url),
  "utf8",
);

const declarations = (body: string): ReadonlyMap<string, string> =>
  new Map(
    [...body.matchAll(/(?<name>--[\w-]+):\s*(?<value>[^;]+);/gu)].map(
      (match) => [match.groups?.name ?? "", match.groups?.value?.trim() ?? ""],
    ),
  );

const blockBody = (selector: RegExp): string => {
  const body = new RegExp(
    `${selector.source}\\s*\\{(?<body>[^}]*)\\}`,
    "u",
  ).exec(stylesheet)?.groups?.body;
  if (body === undefined) {
    throw new Error(`Token block ${selector.source} is required`);
  }
  return body;
};

/** The one map every surface reads — collector and operator console alike. */
const graphite = declarations(blockBody(/:root/u));

const parseHex = (value: string): readonly [number, number, number] => {
  const match =
    /^#(?<red>[\da-f]{2})(?<green>[\da-f]{2})(?<blue>[\da-f]{2})$/iu.exec(
      value,
    );
  const red = match?.groups?.red;
  const green = match?.groups?.green;
  const blue = match?.groups?.blue;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Expected hex color, got ${value}`);
  }
  return [red, green, blue].map(
    (channel) => Number.parseInt(channel, 16) / 255,
  ) as unknown as readonly [number, number, number];
};

const luminance = (color: string): number => {
  const linearize = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const [red, green, blue] = parseHex(color).map(
    linearize,
  ) as unknown as readonly [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground: string, background: string): number => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

const surfaces = ["--canvas", "--surface-1", "--surface-2", "--surface-3"];

const textPairs = [
  ...["--text-primary", "--text-secondary", "--text-tertiary"].flatMap((text) =>
    surfaces.map((surface) => [text, surface] as const),
  ),
  ["--text-primary", "--status-warning-surface"],
  ["--text-secondary", "--status-warning-surface"],
  ["--accent-fill-text", "--accent-fill"],
  ...surfaces.map((surface) => ["--accent-text", surface] as const),
  ["--accent-text", "--accent-surface"],
  ["--status-info-text", "--status-info-surface"],
  ["--status-success-text", "--status-success-surface"],
  ["--status-warning-text", "--status-warning-surface"],
  ["--status-danger-text", "--status-danger-surface"],
  ...[
    "--status-info-text",
    "--status-success-text",
    "--status-warning-text",
    "--status-danger-text",
  ].flatMap((text) => surfaces.map((surface) => [text, surface] as const)),
  ["--inverse-text", "--inverse-surface"],
  ["--inverse-text", "--inverse-surface-raised"],
  ["--inverse-text-muted", "--inverse-surface"],
  ["--inverse-text-muted", "--inverse-surface-raised"],
  ["--inverse-accent-text", "--inverse-surface"],
  ["--inverse-status-info-text", "--inverse-surface-raised"],
  ["--inverse-status-success-text", "--inverse-surface-raised"],
  ["--inverse-status-warning-text", "--inverse-surface-raised"],
  ["--inverse-status-danger-text", "--inverse-surface-raised"],
  ["--status-success-fill-text", "--status-success-fill"],
  ["--chart-value", "--chart-surface"],
  ["--chart-label", "--chart-surface"],
] as const;

const nonTextPairs = [
  ...surfaces.map((surface) => ["--focus-ring", surface] as const),
  ...surfaces.map((surface) => ["--border-strong", surface] as const),
  ["--chart-primary", "--chart-surface"],
  ["--chart-secondary", "--chart-surface"],
  ["--chart-positive", "--chart-surface"],
  ["--chart-negative", "--chart-surface"],
  ["--accent-fill", "--canvas"],
  ["--accent-fill", "--surface-1"],
] as const;

const resolve = (tokens: ReadonlyMap<string, string>, name: string): string => {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing token ${name}`);
  const reference = /^var\((?<name>--[\w-]+)\)$/u.exec(value)?.groups?.name;
  return reference === undefined ? value : resolve(tokens, reference);
};

const pure = new Set(["#000000", "#ffffff"]);

describe("graphite design tokens", () => {
  it("ships one dark map with no color-scheme split", () => {
    expect(stylesheet).not.toMatch(/@media[^{]*prefers-color-scheme/u);
    expect(blockBody(/:root/u)).toMatch(/color-scheme:\s*dark;/u);
    // No second token map: the console is not a light theme any more.
    expect(stylesheet).not.toMatch(/color-scheme:\s*light/u);
    expect(stylesheet).not.toMatch(/\[data-theme="ledger"\]/u);
  });

  it("keeps the canvas and panels dark and the ink light", () => {
    for (const surface of [...surfaces, "--chart-surface"]) {
      expect(luminance(resolve(graphite, surface)), surface).toBeLessThan(0.1);
    }
    expect(luminance(resolve(graphite, "--text-primary"))).toBeGreaterThan(0.7);
  });

  it("uses neither pure black nor pure white", () => {
    for (const [name, value] of graphite) {
      if (value.startsWith("#")) {
        expect(pure.has(value.toLowerCase()), name).toBe(false);
      }
    }
  });

  it.each(textPairs)("%s on %s reads at AA", (foreground, background) => {
    expect(
      contrast(resolve(graphite, foreground), resolve(graphite, background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(nonTextPairs)("%s on %s marks at 3:1", (foreground, background) => {
    expect(
      contrast(resolve(graphite, foreground), resolve(graphite, background)),
    ).toBeGreaterThanOrEqual(3);
  });

  it("binds the mono face to every semantic font variable", () => {
    expect(graphite.get("--font-sans")).toBe("var(--font-jetbrains)");
    expect(graphite.get("--font-mono")).toBe("var(--font-jetbrains)");
    expect(graphite.get("--font-display")).toBe("var(--font-jetbrains)");
  });
});
