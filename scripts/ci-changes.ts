import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_GATE_NAMES = [
  "code_checks",
  "web_unit",
  "public_api",
  "protocol_scripts",
  "contract_unit",
  "contract_invariants",
  "deployment",
  "web_production",
] as const;

type CiGateName = (typeof CI_GATE_NAMES)[number];
export type CiClassification = Readonly<Record<CiGateName, boolean>>;
export type CiProfile = "web" | "full";

const noHeavyGates: CiClassification = {
  code_checks: false,
  web_unit: false,
  public_api: false,
  protocol_scripts: false,
  contract_unit: false,
  contract_invariants: false,
  deployment: false,
  web_production: false,
};

const everyGate: CiClassification = Object.fromEntries(
  CI_GATE_NAMES.map((name) => [name, true]),
) as unknown as CiClassification;

const webGates: CiClassification = {
  ...noHeavyGates,
  code_checks: true,
  web_unit: true,
  web_production: true,
};

const webEnvironmentGates: CiClassification = {
  ...webGates,
  protocol_scripts: true,
};

const protocolScriptGates: CiClassification = {
  ...noHeavyGates,
  code_checks: true,
  protocol_scripts: true,
};

const protocolSourceGates: CiClassification = {
  ...protocolScriptGates,
  web_unit: true,
  web_production: true,
};

const publicApiGates: CiClassification = {
  ...noHeavyGates,
  code_checks: true,
  public_api: true,
};

const publicApiEnvironmentGates: CiClassification = {
  ...publicApiGates,
  protocol_scripts: true,
};

const publicApiContractGates: CiClassification = {
  ...publicApiGates,
  web_unit: true,
  web_production: true,
};

const integratedRuntimeEnvironmentGates: CiClassification = {
  ...noHeavyGates,
  code_checks: true,
  web_unit: true,
  public_api: true,
  protocol_scripts: true,
  web_production: true,
};

const documentationPath = (path: string): boolean =>
  path.endsWith(".md") ||
  path.startsWith("docs/") ||
  path.startsWith(".github/ISSUE_TEMPLATE/") ||
  path.startsWith(".github/PULL_REQUEST_TEMPLATE/") ||
  /(^|\/)LICENSE(?:\.|$)/u.test(path);

const sharedSafetyFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "eslint.config.ts",
  "tsconfig.base.json",
  "apps/web/src/generated/deployment-manifests.ts",
]);

const sharedSafetyPrefixes = [
  ".github/workflows/",
  "deployments/",
  "packages/contracts/",
  "packages/config/src/",
  "packages/config/collection/",
] as const;

const sharedSafetyPath = (path: string): boolean =>
  sharedSafetyFiles.has(path) ||
  sharedSafetyPrefixes.some((prefix) => path.startsWith(prefix));

const deploymentScriptPath = (path: string): boolean =>
  [
    "scripts/base-sepolia-manifest.ts",
    "scripts/deploy-protocol.ts",
    "scripts/effect-runtime.ts",
    "scripts/generate-web-deployment-manifest.ts",
    "scripts/json-rpc.ts",
    "scripts/smoke-base-sepolia.ts",
    "scripts/test-base-sepolia-fork-deployment.ts",
    "scripts/test-local-deployment.ts",
    "scripts/verify-base-sepolia-sources.ts",
  ].includes(path);

const sharedEconomicProtocolPath = (path: string): boolean =>
  [
    "packages/protocol/src/contracts.ts",
    "packages/protocol/src/domain.ts",
    "packages/protocol/src/health.ts",
    "packages/protocol/src/transactions.ts",
  ].includes(path) || path.startsWith("packages/protocol/src/pol-");

interface PathRule {
  readonly matches: (path: string) => boolean;
  readonly classification: CiClassification;
}

const pathRules: readonly PathRule[] = [
  { matches: documentationPath, classification: noHeavyGates },
  {
    matches: (path) => path === "config/env/web.env.example",
    classification: webEnvironmentGates,
  },
  {
    matches: (path) => path === "config/env/api.env.example",
    classification: publicApiEnvironmentGates,
  },
  {
    matches: (path) => path === "config/env/deployment.env.example",
    classification: everyGate,
  },
  {
    matches: (path) => path.startsWith("config/env/"),
    classification: protocolScriptGates,
  },
  {
    matches: (path) => path.startsWith("apps/api/"),
    classification: publicApiGates,
  },
  {
    matches: (path) =>
      path === "packages/config/src/public-api.ts" ||
      path === "packages/config/test/public-api.test.ts",
    classification: publicApiContractGates,
  },
  {
    matches: (path) =>
      sharedSafetyPath(path) ||
      deploymentScriptPath(path) ||
      path === "scripts/ci-changes.ts" ||
      path === "scripts/ci-changes.test.ts",
    classification: everyGate,
  },
  {
    matches: (path) => path.startsWith("apps/web/"),
    classification: webGates,
  },
  {
    matches: sharedEconomicProtocolPath,
    classification: everyGate,
  },
  {
    matches: (path) => path.startsWith("packages/protocol/"),
    classification: protocolSourceGates,
  },
  {
    matches: (path) =>
      path.startsWith("scripts/") || path.startsWith("packages/config/test/"),
    classification: protocolScriptGates,
  },
  {
    matches: (path) => path === ".env.example",
    classification: integratedRuntimeEnvironmentGates,
  },
];

const classificationForPath = (path: string): CiClassification =>
  pathRules.find((rule) => rule.matches(path))?.classification ?? everyGate;

const mergeClassifications = (
  left: CiClassification,
  right: CiClassification,
): CiClassification =>
  Object.fromEntries(
    CI_GATE_NAMES.map((name) => [name, left[name] || right[name]]),
  ) as unknown as CiClassification;

export const classifyChangedPaths = (
  paths: readonly string[],
): CiClassification =>
  paths
    .map((path) => path.trim())
    .filter((path) => path.length !== 0)
    .map(classificationForPath)
    .reduce(mergeClassifications, noHeavyGates);

const profiles: Readonly<Record<CiProfile, CiClassification>> = {
  web: webGates,
  full: everyGate,
};

export const classifyCiProfile = (profile: CiProfile): CiClassification =>
  profiles[profile];

export const formatGithubOutputs = (classification: CiClassification): string =>
  `${CI_GATE_NAMES.map(
    (name) => `${name}=${classification[name] ? "true" : "false"}`,
  ).join("\n")}\n`;

const readChangedPaths = async (): Promise<string[]> => {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.join("").split("\n");
};

const selectedClassification = async (): Promise<CiClassification> => {
  const profile = process.env.CI_PROFILE;
  if (profile === "web" || profile === "full") {
    return classifyCiProfile(profile);
  }
  if (profile !== undefined && profile !== "auto") {
    throw new Error(`Unknown CI profile: ${profile}`);
  }
  return classifyChangedPaths(await readChangedPaths());
};

const run = async (): Promise<void> => {
  const classification = await selectedClassification();
  const output = formatGithubOutputs(classification);
  process.stdout.write(output);
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined) appendFileSync(githubOutput, output);
};

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  void run().catch((cause: unknown) => {
    process.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  });
}
