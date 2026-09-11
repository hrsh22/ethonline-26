import { describe, expect, it, vi } from "vitest";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  deploymentEnvironmentForName,
  requireDeployableDeploymentEnvironment,
} from "@orbit/config/deployment-environments";
import { resolveCcaManifestOutput } from "./deploy-cca-protocol.ts";
import { resolveProtocolManifestOutput } from "./deploy-protocol.ts";

vi.mock("./effect-runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./effect-runtime.ts")>()),
  runMain: vi.fn(),
}));

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ["development", "development-sepolia", "staging"] as const;

describe.each([
  ["CCA", resolveCcaManifestOutput],
  ["protocol", resolveProtocolManifestOutput],
] as const)("%s deployment manifest outputs", (_, resolveOutput) => {
  it("rejects a symlink alias for another environment's canonical directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "manifest-output-"));
    try {
      symlinkSync(join(root, "deployments"), join(directory, "alias"));
      const target = requireDeployableDeploymentEnvironment(
        deploymentEnvironmentForName("development-sepolia"),
      );
      expect(() =>
        resolveOutput(target, join(directory, "alias", "84532.staging.json")),
      ).toThrow("belongs to deployment environment staging");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  for (const name of names) {
    const target = requireDeployableDeploymentEnvironment(
      deploymentEnvironmentForName(name),
    );
    it(`allows ${name}'s default, explicit canonical and archival paths`, () => {
      const canonical = join(root, target.manifestPath);
      expect(resolveOutput(target, undefined)).toBe(canonical);
      expect(resolveOutput(target, canonical)).toBe(canonical);
      const archive = join(root, "deployments", "archive", `${name}.json`);
      expect(resolveOutput(target, archive)).toBe(archive);
    });
    for (const otherName of names.filter((other) => other !== name)) {
      it(`rejects ${name} writing ${otherName}'s canonical manifest`, () => {
        const other = requireDeployableDeploymentEnvironment(
          deploymentEnvironmentForName(otherName),
        );
        const canonical = join(root, other.manifestPath);
        for (const path of [
          canonical,
          relative(process.cwd(), canonical),
          join(
            dirname(canonical),
            "archive",
            "..",
            canonical.split("/").at(-1)!,
          ),
        ]) {
          expect(() => resolveOutput(target, path)).toThrow(
            `belongs to deployment environment ${otherName}`,
          );
        }
      });
    }
  }
});
