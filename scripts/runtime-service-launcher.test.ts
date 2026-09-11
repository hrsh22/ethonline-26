import { describe, expect, it } from "vitest";

import { runtimeServiceLaunchConfiguration } from "./runtime-service-launcher.ts";

describe("runtime service launcher arguments", () => {
  it("retains the history --once argument under every environment profile", () => {
    expect(
      runtimeServiceLaunchConfiguration([
        "history",
        "--once",
        "--profile=staging",
      ]),
    ).toMatchObject({
      arguments: expect.arrayContaining(["--once"]),
      environmentProfile: "staging",
      service: "history",
    });
    expect(
      runtimeServiceLaunchConfiguration(["--no-env-file", "history", "--once"]),
    ).toMatchObject({
      arguments: expect.arrayContaining(["--once"]),
      environmentProfile: "none",
      service: "history",
    });
  });

  it("defaults to the optional development profile for existing commands", () => {
    expect(runtimeServiceLaunchConfiguration(["api"])).toMatchObject({
      environmentProfile: "development",
      service: "api",
    });
  });

  it("still rejects forwarded arguments for non-history services", () => {
    expect(() =>
      runtimeServiceLaunchConfiguration([
        "operator",
        "--once",
        "--profile=staging",
      ]),
    ).toThrow(/Unexpected operator runtime arguments/u);
  });
});
