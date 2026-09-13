import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const directory = fileURLToPath(new URL("..", import.meta.url));
for (const file of ["../../.env", "../../.env.deployment.local"]) {
  try {
    process.loadEnvFile(resolve(directory, file));
  } catch {}
}
const key = process.env.GRAPH_STUDIO_DEPLOY_KEY;
if (!key)
  throw new Error(
    "Set GRAPH_STUDIO_DEPLOY_KEY in the ignored root .env.deployment.local",
  );
const packageVersion = JSON.parse(
  readFileSync(resolve(directory, "package.json"), "utf8"),
).version;
const version = process.argv[2] ?? packageVersion;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Version must be a semver release");
const generated = spawnSync(
  process.execPath,
  [
    resolve(directory, "scripts/generate-manifest-config.mjs"),
    resolve(directory, "../../deployments/84532.staging.json"),
  ],
  { cwd: directory, encoding: "utf8" },
);
if (generated.status !== 0) {
  process.stderr.write(generated.stderr || generated.stdout);
  process.exit(generated.status ?? 1);
}
// This endpoint deploys to free Studio. It does not publish onchain or enable billing.
const result = spawnSync(
  resolve(directory, "node_modules/.bin/graph"),
  [
    "deploy",
    "orbit-market",
    "--node",
    "https://api.studio.thegraph.com/deploy/",
    "--deploy-key",
    key,
    "--version-label",
    version,
  ],
  { cwd: directory, encoding: "utf8", timeout: 180000 },
);
for (const output of [result.stdout, result.stderr])
  if (output) process.stdout.write(output.replaceAll(key, "[REDACTED]"));
process.exitCode = result.status ?? 1;
