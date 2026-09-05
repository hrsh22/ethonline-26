import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { collectionManifestHash } from "../src/collection-manifest.ts";

const schemaPath = fileURLToPath(
  new URL("../../../deployments/schema.json", import.meta.url),
);
const source = readFileSync(schemaPath, "utf8");
const schema = JSON.parse(source) as {
  $defs: {
    identity: {
      properties: {
        manifestHash: Record<string, unknown>;
      };
    };
    transactions: Record<string, unknown>;
  };
};

schema.$defs.identity.properties.manifestHash = {
  const: collectionManifestHash,
};

schema.$defs.transactions.dependentRequired = Object.fromEntries(
  Array.from({ length: 999 }, (_, index) => {
    const current = `step${(index + 1).toString().padStart(3, "0")}`;
    const previous = `step${index.toString().padStart(3, "0")}`;
    return [current, [previous]];
  }),
);

const generated = await format(JSON.stringify(schema), { parser: "json" });

if (process.argv.includes("--check")) {
  if (source !== generated) {
    throw new Error(
      "The deployment schema is stale; run pnpm --filter @orbit/config generate:deployment-schema",
    );
  }
  process.stdout.write("Deployment schema generated invariants are current\n");
} else {
  writeFileSync(schemaPath, generated);
  process.stdout.write(`Generated ${schemaPath}\n`);
}
