import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { readLaunchedBaseSepoliaManifest } from "./base-sepolia-manifest.ts";
import { fileSystem, runMain, validate } from "./effect-runtime.ts";
import { decodeGenesisCurveConfiguration } from "./genesis-curve/configuration.ts";
import {
  assertGenesisCurveManifestCrossCheck,
  buildGenesisCurveReport,
  renderGenesisCurveReport,
  serializeGenesisCurveReport,
} from "./genesis-curve/report.ts";

interface CommandArguments {
  readonly configPath: string;
  readonly json: boolean;
  readonly requireManifestMatch: boolean;
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const commandArguments = (arguments_: readonly string[]): CommandArguments => {
  let configPath = resolve(
    repositoryRoot,
    "docs/economics/genesis-curve-base-sepolia.json",
  );
  let json = false;
  let requireManifestMatch = true;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--config") {
      const selectedPath = arguments_[index + 1];
      if (selectedPath === undefined) {
        throw new Error("--config requires a JSON file path");
      }
      configPath = resolve(process.cwd(), selectedPath);
      requireManifestMatch = false;
      index += 1;
      continue;
    }
    throw new Error(`Unknown genesis curve argument: ${String(argument)}`);
  }
  return { configPath, json, requireManifestMatch };
};

runMain(
  Effect.gen(function* () {
    const arguments_ = yield* validate(
      "Genesis curve command arguments are invalid",
      () => commandArguments(process.argv.slice(2)),
    );
    const serialized = yield* fileSystem(
      `Could not read genesis curve configuration at ${arguments_.configPath}`,
      () => readFileSync(arguments_.configPath, "utf8"),
    );
    const unknownConfiguration = yield* validate(
      "Genesis curve configuration is not valid JSON",
      () => JSON.parse(serialized) as unknown,
    );
    const configuration =
      yield* decodeGenesisCurveConfiguration(unknownConfiguration);
    const manifest = yield* readLaunchedBaseSepoliaManifest(
      resolve(repositoryRoot, "deployments/84532.json"),
    );
    const report = yield* validate(
      "Could not build the Genesis Liquidity curve report",
      () => buildGenesisCurveReport(configuration, manifest),
    );
    if (arguments_.requireManifestMatch) {
      yield* validate(
        "Genesis curve report does not match the checked deployment",
        () => assertGenesisCurveManifestCrossCheck(report.manifestCrossCheck),
      );
    }
    process.stdout.write(
      arguments_.json
        ? serializeGenesisCurveReport(report)
        : `${renderGenesisCurveReport(report)}\n`,
    );
  }),
);
