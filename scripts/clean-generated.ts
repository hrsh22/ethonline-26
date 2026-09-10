import { rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.slice(2).includes("--dry-run");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--" && argument !== "--dry-run");

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
}

// Keep this list explicit. In particular, cleanup must never expand into .data,
// private environment files, deployment records, or durable SQLite state.
const generatedPaths = [
  "node_modules/.cache",
  "coverage",
  "apps/api/dist",
  "apps/api/coverage",
  "apps/api/node_modules/.cache",
  "apps/web/.next",
  "apps/web/coverage",
  "apps/web/out",
  "apps/web/playwright-report",
  "apps/web/test-results",
  "apps/web/browser-matrix-report.json",
  "apps/web/browser/baseline",
  "apps/web/tsconfig.tsbuildinfo",
  "packages/config/dist",
  "packages/config/coverage",
  "packages/config/node_modules/.cache",
  "packages/contracts/cache",
  "packages/contracts/out",
  "packages/contracts/coverage",
  "packages/protocol/dist",
  "packages/protocol/coverage",
  "packages/protocol/node_modules/.cache",
  "subgraphs/orbit-market/build",
  "subgraphs/orbit-market/generated",
  "subgraphs/orbit-market/tests/.bin",
  "subgraphs/orbit-market/tests/.latest.json",
] as const;

for (const generatedPath of generatedPaths) {
  const absolutePath = resolve(repositoryRoot, generatedPath);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);

  if (
    repositoryRelativePath === "" ||
    repositoryRelativePath.startsWith("..")
  ) {
    throw new Error(`Refusing to clean unsafe path: ${absolutePath}`);
  }

  console.log(`${dryRun ? "Would remove" : "Removing"} ${generatedPath}`);
  if (!dryRun) {
    await rm(absolutePath, { force: true, recursive: true });
  }
}
