import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(repositoryRoot, "apps/web");
const nextCli = join(webRoot, "node_modules/next/dist/bin/next");
const nextEnvironmentIsolation = pathToFileURL(
  join(repositoryRoot, "scripts/next-environment-isolation.ts"),
).href;

export type NextRuntimeSubcommand = "build" | "dev" | "start" | "typegen";

export const nextRuntimeArguments = (
  subcommand: NextRuntimeSubcommand,
  ...arguments_: readonly string[]
): readonly string[] => [
  "--import",
  nextEnvironmentIsolation,
  nextCli,
  subcommand,
  ...arguments_,
];
