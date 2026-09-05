/** @vitest-environment jsdom */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

type LitIconButton = HTMLElement & {
  readonly updateComplete: Promise<boolean>;
};

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const requireFromAppKit = createRequire(require.resolve("@reown/appkit"));
  const iconButtonModule = requireFromAppKit.resolve(
    "@reown/appkit-ui/wui-icon-button",
  );
  await import(/* @vite-ignore */ pathToFileURL(iconButtonModule).href);
});

describe("Reown icon button accessibility", () => {
  it.each([
    ["close", "Close"],
    ["helpCircle", "Help"],
    ["chevronLeft", "Back"],
    ["clock", "Smart sessions"],
  ])("names the %s header action %j", async (icon, accessibleName) => {
    const control = document.createElement("wui-icon-button") as LitIconButton;
    control.setAttribute("icon", icon);
    document.body.append(control);
    await control.updateComplete;

    expect(
      control.shadowRoot?.querySelector("button")?.getAttribute("aria-label"),
    ).toBe(accessibleName);

    control.remove();
  });
});
