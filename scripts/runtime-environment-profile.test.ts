import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseRuntimeEnvironmentProfileArguments,
  readRuntimeEnvironmentProfile,
} from "./runtime-environment-profile.ts";

describe("runtime environment profiles", () => {
  it("extracts a profile anywhere without consuming service arguments", () => {
    expect(
      parseRuntimeEnvironmentProfileArguments([
        "history",
        "--once",
        "--profile=staging",
      ]),
    ).toEqual({
      profile: "staging",
      remainingArguments: ["history", "--once"],
    });
    expect(
      parseRuntimeEnvironmentProfileArguments(["--no-env-file", "api"]),
    ).toEqual({ profile: "none", remainingArguments: ["api"] });
    expect(parseRuntimeEnvironmentProfileArguments(["operator"])).toEqual({
      profile: "development",
      remainingArguments: ["operator"],
    });
  });

  it("rejects ambiguous and unknown profile selections", () => {
    expect(() =>
      parseRuntimeEnvironmentProfileArguments([
        "--profile=staging",
        "--no-env-file",
      ]),
    ).toThrow(/exactly one/u);
    expect(() =>
      parseRuntimeEnvironmentProfileArguments([
        "--profile=development",
        "--profile=staging",
      ]),
    ).toThrow(/exactly one/u);
    expect(() =>
      parseRuntimeEnvironmentProfileArguments(["--profile=production"]),
    ).toThrow(/development or staging/u);
  });

  it("reads only the selected file with explicit environment precedence", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "orbit-env-profile-"));
    try {
      writeFileSync(
        join(repositoryRoot, ".env"),
        "SOURCE=development\nSHARED=file-development\n",
      );
      writeFileSync(
        join(repositoryRoot, ".env.staging"),
        "SOURCE=staging\nSHARED=file-staging\n",
      );

      expect(
        readRuntimeEnvironmentProfile({
          developmentFileRequired: true,
          environment: { SHARED: "shell" },
          profile: "development",
          repositoryRoot,
        }),
      ).toEqual({ SOURCE: "development", SHARED: "shell" });
      expect(
        readRuntimeEnvironmentProfile({
          developmentFileRequired: true,
          environment: { SHARED: "shell" },
          profile: "staging",
          repositoryRoot,
        }),
      ).toEqual({ SOURCE: "staging", SHARED: "shell" });
      expect(
        readRuntimeEnvironmentProfile({
          developmentFileRequired: true,
          environment: { SHARED: "injected" },
          profile: "none",
          repositoryRoot: join(repositoryRoot, "does-not-exist"),
        }),
      ).toEqual({ SHARED: "injected" });
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
    }
  });

  it("requires staging without falling back to the development file", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "orbit-env-profile-"));
    try {
      writeFileSync(join(repositoryRoot, ".env"), "SOURCE=development\n");
      expect(() =>
        readRuntimeEnvironmentProfile({
          developmentFileRequired: false,
          environment: {},
          profile: "staging",
          repositoryRoot,
        }),
      ).toThrow();
    } finally {
      rmSync(repositoryRoot, { force: true, recursive: true });
    }
  });
});
