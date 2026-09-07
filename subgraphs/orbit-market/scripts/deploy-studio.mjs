import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const directory = fileURLToPath(new URL("..", import.meta.url));
try {
  process.loadEnvFile(resolve(directory, "../../.env"));
} catch {}
const key = process.env.GRAPH_STUDIO_DEPLOY_KEY;
if (!key)
  throw new Error("Set GRAPH_STUDIO_DEPLOY_KEY in the ignored root .env");
const version = process.argv[2] ?? "0.1.0";
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Version must be a semver release");
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
