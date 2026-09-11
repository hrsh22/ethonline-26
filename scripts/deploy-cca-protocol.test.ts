import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex, PublicClient } from "viem";
import {
  canonicalContracts,
  reconcileBroadcasts,
  resolveCcaDeploymentEnvironment,
  selectedCcaIdentity,
  validateCcaInput,
} from "./deploy-cca-protocol.ts";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const hashes = [1, 2].map(
  (value) => `0x${value.toString(16).padStart(64, "0")}` as Hex,
);
const directories: string[] = [];

describe("CCA deployment environment selection", () => {
  it("requires an explicit identity for Base Sepolia", () => {
    expect(() => resolveCcaDeploymentEnvironment(84_532, undefined)).toThrow(
      "DEPLOYMENT_ENVIRONMENT is required",
    );
  });

  it("keeps developer and staging Base Sepolia outputs separate", () => {
    expect(
      resolveCcaDeploymentEnvironment(84_532, "development-sepolia")
        ?.manifestPath,
    ).toBe("deployments/84532.json");
    expect(
      resolveCcaDeploymentEnvironment(84_532, "staging")?.manifestPath,
    ).toBe("deployments/84532.staging.json");
  });

  it("rejects a deployment identity for the wrong chain", () => {
    expect(() =>
      resolveCcaDeploymentEnvironment(84_532, "development"),
    ).toThrow("does not match chain 84532");
  });
});

afterEach(() => {
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cca-receipts-"));
  directories.push(directory);
  const path = join(directory, "broadcast.json");
  const artifact = {
    transactions: hashes.map((hash) => ({ hash })),
    receipts: hashes.map((transactionHash) => ({
      transactionHash,
      status: "0x1",
    })),
  };
  writeFileSync(path, JSON.stringify(artifact));
  const transactions = hashes.map((hash, i) => ({
    hash,
    from: owner,
    nonce: i + 4,
    blockNumber: BigInt(i + 10),
  }));
  const receipts = hashes.map((transactionHash, i) => ({
    transactionHash,
    status: "success",
    blockNumber: BigInt(i + 10),
    contractAddress: i === 0 ? other : null,
  }));
  const client = {
    getTransaction: vi.fn(
      async ({ hash }: { hash: Hex }) => transactions[hashes.indexOf(hash)],
    ),
    getTransactionReceipt: vi.fn(
      async ({ hash }: { hash: Hex }) => receipts[hashes.indexOf(hash)],
    ),
  } as unknown as PublicClient;
  return { path, artifact, transactions, receipts, client };
}

describe("CCA broadcast reconciliation", () => {
  it("uses confirmed receipt blocks and deployment addresses", async () => {
    const f = fixture();
    const result = await reconcileBroadcasts(f.client, [f.path], owner);
    expect(result.hashes).toEqual(hashes);
    expect(result.terminalBlock).toBe(11n);
    expect(result.creations.has(other)).toBe(true);
  });
  it("rejects an incomplete artifact before trusting RPC data", async () => {
    const f = fixture();
    f.artifact.receipts.pop();
    writeFileSync(f.path, JSON.stringify(f.artifact));
    await expect(
      reconcileBroadcasts(f.client, [f.path], owner),
    ).rejects.toThrow("missing or unsuccessful receipts");
  });
  it("rejects a mined transaction from a different sender", async () => {
    const f = fixture();
    f.transactions[1]!.from = other;
    await expect(
      reconcileBroadcasts(f.client, [f.path], owner),
    ).rejects.toThrow("sender mismatch");
  });
  it("rejects a transaction history with a nonce gap", async () => {
    const f = fixture();
    f.transactions[1]!.nonce += 1;
    await expect(
      reconcileBroadcasts(f.client, [f.path], owner),
    ).rejects.toThrow("not contiguous");
  });
  it("rejects a reverted onchain receipt even when artifact claims success", async () => {
    const f = fixture();
    f.receipts[1]!.status = "reverted";
    await expect(
      reconcileBroadcasts(f.client, [f.path], owner),
    ).rejects.toThrow("reverted");
  });
  it("rejects a mismatched transaction returned by RPC", async () => {
    const f = fixture();
    f.transactions[1]!.hash = hashes[0]!;
    await expect(
      reconcileBroadcasts(f.client, [f.path], owner),
    ).rejects.toThrow("hash mismatch");
  });
});

it("canonicalizes CCA addresses without introducing a genesis vault", () => {
  const raw = {
    contracts: {
      liquidToken: owner,
      collectible: other,
      ccaFactory: owner,
      ccaAuction: other,
      lbpStrategy: owner,
      ccaEscrowFactory: other,
    },
    infrastructure: {
      poolManager: owner,
      positionManager: other,
      permit2: owner,
    },
    freshInfrastructure: {
      weth: owner,
      usdc: other,
      testConversionVenue: owner,
    },
    stockTokens: [owner, other, owner, other],
    conversionAdapters: [other, owner, other, owner],
  } satisfies Parameters<typeof canonicalContracts>[0];
  const result = canonicalContracts(raw);
  expect(result.fuelCore).toBe(owner);
  expect(result.continuousClearingAuction).toBe(other);
  expect(result.mockAaplc).toBe(owner);
  expect(result.nvdacConversionAdapter).toBe(owner);
  expect(result).not.toHaveProperty("genesisLiquidityVault");
  expect(result).not.toHaveProperty("ccaCreate2Deployer");
});

function validInput() {
  const example = JSON.parse(
    readFileSync(
      new URL(
        "../docs/operations/cca-deployment-input.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  return {
    ...example,
    infrastructure: example.infrastructure as Record<string, string>,
    identity: selectedCcaIdentity(),
    roles: {
      deploymentOwner: owner,
      governanceOwner: other,
      creator: owner,
      guardian: owner,
      keeper: owner,
      liquidityExecutor: owner,
      recoveryCosigner: other,
    },
    auction: {
      ...(example.auction as Record<string, unknown>),
      startBlock: 1000,
      endBlock: 11800,
      claimBlock: 11801,
      migrationBlock: 11801,
      testnetEconomicsConfirmed: true,
    },
  };
}
it("accepts the exact selected identity and official Base infrastructure", () => {
  expect(validateCcaInput(validInput(), 84532, 1n).identity).toEqual(
    selectedCcaIdentity(),
  );
});
it.each(["liquidTokenName", "metadataDescription", "transientImage"])(
  "rejects substituted selected-identity field %s before Forge",
  (field) => {
    const input = validInput();
    input.identity[field] = "substituted";
    expect(() => validateCcaInput(input, 84532, 1n)).toThrow(
      `identity.${field}`,
    );
  },
);
it("rejects a substituted official Base strategy before Forge", () => {
  const input = validInput();
  input.infrastructure = { ...input.infrastructure, lbpStrategy: other };
  expect(() => validateCcaInput(input, 84532, 1n)).toThrow(
    "infrastructure.lbpStrategy",
  );
});
