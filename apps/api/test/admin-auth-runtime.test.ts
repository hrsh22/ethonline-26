import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PublicApiConfiguration } from "../src/configuration.js";
import { openAdminAuthRuntime } from "../src/admin-auth-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), "orbit-admin-auth-runtime-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const adminConfiguration = (
  directory: string,
  manifestPath: string,
): PublicApiConfiguration["adminAuth"] => ({
  appOrigin: "https://orbit.example",
  challengeTtlMilliseconds: 300_000,
  databasePath: join(directory, "private", "admin-auth.sqlite"),
  manifestPath,
  rpcUrl: new URL("https://sepolia.base.org"),
  sessionTtlMilliseconds: 900_000,
});

describe("admin auth runtime", () => {
  it("opens the canonical Base Sepolia manifest and secures durable state", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "84532.json");
    copyFileSync("../../deployments/84532.json", manifestPath);

    const runtime = openAdminAuthRuntime(
      adminConfiguration(directory, manifestPath),
    );

    expect(runtime.service).toBeDefined();
    expect(statSync(join(directory, "private")).mode & 0o777).toBe(0o700);
    expect(
      statSync(join(directory, "private", "admin-auth.sqlite")).mode & 0o777,
    ).toBe(0o600);
    runtime.close();
  });

  it("fails closed before opening state for a non-Base-Sepolia manifest", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "wrong-chain.json");
    writeFileSync(
      manifestPath,
      readFileSync("../../deployments/31337.json", "utf8"),
      "utf8",
    );

    expect(() =>
      openAdminAuthRuntime(adminConfiguration(directory, manifestPath)),
    ).toThrow(/Base Sepolia/u);
    expect(() =>
      statSync(join(directory, "private", "admin-auth.sqlite")),
    ).toThrow();
  });

  it("tightens an existing state directory before opening the database", () => {
    const directory = temporaryDirectory();
    const stateDirectory = join(directory, "private");
    const manifestPath = join(directory, "84532.json");
    copyFileSync("../../deployments/84532.json", manifestPath);
    const configuration = adminConfiguration(directory, manifestPath);
    // The runtime must not inherit a permissive umask or prior directory mode.
    mkdirSync(stateDirectory, { mode: 0o755 });
    chmodSync(stateDirectory, 0o755);

    const runtime = openAdminAuthRuntime(configuration);
    expect(statSync(stateDirectory).mode & 0o777).toBe(0o700);
    runtime.close();
  });

  it("rejects a symlinked state directory or database file", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "84532.json");
    copyFileSync("../../deployments/84532.json", manifestPath);
    const realState = join(directory, "real-state");
    mkdirSync(realState);
    const linkedState = join(directory, "private");
    symlinkSync(realState, linkedState, "dir");

    expect(() =>
      openAdminAuthRuntime({
        ...adminConfiguration(directory, manifestPath),
        databasePath: join(linkedState, "admin-auth.sqlite"),
      }),
    ).toThrow(/symbolic link/u);

    rmSync(linkedState);
    mkdirSync(linkedState);
    const target = join(directory, "target.sqlite");
    writeFileSync(target, "", "utf8");
    symlinkSync(target, join(linkedState, "admin-auth.sqlite"), "file");
    expect(() =>
      openAdminAuthRuntime(adminConfiguration(directory, manifestPath)),
    ).toThrow(/symbolic link/u);
  });

  it("rejects a symbolic link in an ancestor of the state directory", () => {
    const directory = temporaryDirectory();
    const manifestPath = join(directory, "84532.json");
    copyFileSync("../../deployments/84532.json", manifestPath);
    const realParent = join(directory, "real-parent");
    mkdirSync(join(realParent, "private"), { recursive: true });
    const linkedParent = join(directory, "linked-parent");
    symlinkSync(realParent, linkedParent, "dir");
    let runtime: ReturnType<typeof openAdminAuthRuntime> | undefined;

    try {
      expect(() => {
        runtime = openAdminAuthRuntime({
          ...adminConfiguration(directory, manifestPath),
          databasePath: join(linkedParent, "private", "admin-auth.sqlite"),
        });
      }).toThrow(/symbolic link/u);
    } finally {
      runtime?.close();
    }
  });
});
