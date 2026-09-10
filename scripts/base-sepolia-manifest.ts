import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect } from "effect";

import { fileSystem, validate } from "./effect-runtime.ts";

export const resolveRepositoryPath = (
  repositoryRoot: string,
  configuredPath: string | undefined,
  defaultPath: string,
): string => {
  const selectedPath = configuredPath ?? defaultPath;
  return isAbsolute(selectedPath)
    ? selectedPath
    : resolve(repositoryRoot, selectedPath);
};

export const readLaunchedBaseSepoliaManifest = (
  manifestPath: string,
): Effect.Effect<ProtocolDeploymentManifest, Error> =>
  Effect.gen(function* () {
    const serialized = yield* fileSystem(
      `Could not read deployment manifest at ${manifestPath}`,
      () => readFileSync(manifestPath, "utf8"),
    );
    return yield* validate(
      "A Base Sepolia deployment manifest is required",
      () => {
        const manifest = decodeProtocolDeploymentManifest(
          JSON.parse(serialized) as unknown,
        );
        if (manifest.chainId !== 84_532) {
          throw new Error("A Base Sepolia deployment manifest is required");
        }
        return manifest;
      },
    );
  });
