import { renderToStaticMarkup } from "react-dom/server";
import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import { CraftArt } from "./craft-art";
import { Amount, Rate, Unavailable } from "./value";

const markup = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("value primitives", () => {
  it("renders a readable display and keeps the exact value reachable", () => {
    const html = markup(
      <Rate
        unit="WETH / $FUEL"
        value={parseUnits("0.005750386365257872", 18)}
      />,
    );
    expect(html).toContain("0.0057504");
    // The precision the display drops has to stay available, not vanish.
    expect(html).toContain('title="0.005750386365257872"');
    expect(html).toContain("WETH / $FUEL");
  });

  it("omits the title when the display is already exact", () => {
    expect(markup(<Amount value={parseUnits("2.5", 18)} />)).not.toContain(
      "title=",
    );
  });

  it("states an unreadable value once instead of repeating a placeholder", () => {
    const html = markup(
      <Unavailable reason="Connect a wallet to load holdings." />,
    );
    expect(html).toContain("—");
    expect(html).toContain('aria-label="Connect a wallet to load holdings."');
    expect(html).not.toContain("Not loaded");
  });
});

describe("craft art", () => {
  it("names a standalone mark and hides one that repeats adjacent text", () => {
    const standalone = markup(<CraftArt identityId={1204} />);
    expect(standalone).toContain('role="img"');
    expect(standalone).toContain('aria-label="Identity 1204, grounded craft"');

    // An empty accessible name on role="img" is a serious axe violation, so a
    // duplicated mark must be hidden rather than silently unnamed.
    const beside = markup(<CraftArt decorative identityId={1204} />);
    expect(beside).toContain('aria-hidden="true"');
    expect(beside).not.toContain('role="img"');
    expect(beside).not.toContain("aria-label");
  });

  it("draws the same geometry for an identity every time", () => {
    expect(markup(<CraftArt identityId={1204} />)).toBe(
      markup(<CraftArt identityId={1204} />),
    );
    expect(markup(<CraftArt identityId={1204} />)).not.toBe(
      markup(<CraftArt identityId={1205} />),
    );
  });
});
