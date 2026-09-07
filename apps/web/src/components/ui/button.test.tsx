import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, ButtonLink } from "./button";

const classTokens = (html: string) =>
  new Set(/class="([^"]*)"/u.exec(html)?.[1]?.split(" "));

describe("shared action sizing", () => {
  it("retains disabled appearance when the action remains keyboard focusable", () => {
    const html = renderToStaticMarkup(
      <Button disabled focusableWhenDisabled>
        Submit
      </Button>,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-disabled=""');
    const tokens = classTokens(html);
    expect(tokens).toContain("data-disabled:bg-[var(--surface-3)]");
    expect(tokens).toContain("data-disabled:text-[var(--text-tertiary)]");
    expect(tokens).toContain("disabled:bg-[var(--surface-3)]");
  });

  it.each(["default", "xs", "sm", "lg"] as const)(
    "lets %s text actions wrap within their container without losing their touch target",
    (size) => {
      const label =
        "Review the collectible and continue to your connected wallet";
      for (const action of [
        <Button key="button" size={size}>
          {label}
        </Button>,
        <ButtonLink key="link" href="/start" size={size}>
          {label}
        </ButtonLink>,
      ]) {
        const html = renderToStaticMarkup(action);
        const tokens = classTokens(html);
        expect(html).toContain(label);
        expect(tokens).toContain("h-auto");
        expect(tokens).toContain("max-w-full");
        expect(tokens).toContain("whitespace-normal");
        expect(tokens).toContain(size === "lg" ? "min-h-12" : "min-h-11");
        expect(tokens).not.toContain("whitespace-nowrap");
      }
    },
  );

  it.each([
    ["icon", "size-11"],
    ["icon-xs", "size-6"],
    ["icon-sm", "size-7"],
    ["icon-lg", "size-9"],
  ] as const)(
    "keeps %s controls fixed with the existing minimum touch target",
    (size, dimension) => {
      const tokens = classTokens(
        renderToStaticMarkup(
          <Button aria-label="Close" size={size}>
            <svg aria-hidden="true" />
          </Button>,
        ),
      );
      expect(tokens).toContain(dimension);
      expect(tokens).toContain("min-h-11");
      expect(tokens).toContain("min-w-11");
      expect(tokens).not.toContain("h-auto");
      expect(tokens).not.toContain("max-w-full");
    },
  );
});
