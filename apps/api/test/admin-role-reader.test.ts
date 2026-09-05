import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hash, type Hex } from "viem";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";

import {
  AdminAuthorityUnavailableError,
  createAdminRoleReader,
  type AdminRoleReaderClient,
} from "../src/admin-role-reader.js";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/84532.json", "utf8")) as unknown,
);
const contracts = createProtocolContracts(manifest);
const roleAddress = (suffix: string): Address =>
  getAddress(`0x${suffix.padStart(40, "0")}`);
const block = {
  hash: `0x${"ab".repeat(32)}` as Hash,
  number: 123n,
};

interface RoleValues {
  readonly converterOwner: Address;
  readonly creator: Address;
  readonly executor: Address;
  readonly fuelOwner: Address;
  readonly guardian: Address;
  readonly keeper: Address;
  readonly ledgerOwner: Address;
  readonly liquidityOwner: Address;
  readonly recoveryAuthority: Address;
  readonly signerOne: Address;
  readonly signerTwo: Address;
}

const values = (): RoleValues => ({
  fuelOwner: roleAddress("1"),
  ledgerOwner: roleAddress("2"),
  converterOwner: roleAddress("3"),
  liquidityOwner: roleAddress("4"),
  guardian: roleAddress("5"),
  recoveryAuthority: roleAddress("6"),
  signerOne: roleAddress("7"),
  signerTwo: roleAddress("8"),
  keeper: roleAddress("9"),
  executor: roleAddress("10"),
  creator: roleAddress("11"),
});

const client = (
  roles: RoleValues = values(),
  chainId = 84_532,
): AdminRoleReaderClient => {
  const contractByAddress = new Map([
    [contracts.fuelCore.address.toLowerCase(), "fuelCore"],
    [contracts.rewardLedger.address.toLowerCase(), "rewardLedger"],
    [contracts.epochConverter.address.toLowerCase(), "epochConverter"],
    [
      contracts.protocolLiquidityVault.address.toLowerCase(),
      "protocolLiquidityVault",
    ],
    [contracts.canonicalFeeHook.address.toLowerCase(), "canonicalFeeHook"],
    [roles.recoveryAuthority.toLowerCase(), "recoveryAuthority"],
  ]);
  return {
    getBlock: vi.fn(async () => block),
    getChainId: vi.fn(async () => chainId),
    readContract: vi.fn(async ({ address, functionName }) => {
      const contract = contractByAddress.get(address.toLowerCase());
      const key = `${contract}:${functionName}`;
      const results: Readonly<Record<string, Address>> = {
        "fuelCore:owner": roles.fuelOwner,
        "fuelCore:guardian": roles.guardian,
        "fuelCore:recoveryAuthority": roles.recoveryAuthority,
        "rewardLedger:owner": roles.ledgerOwner,
        "epochConverter:owner": roles.converterOwner,
        "epochConverter:keeper": roles.keeper,
        "protocolLiquidityVault:owner": roles.liquidityOwner,
        "protocolLiquidityVault:executor": roles.executor,
        "canonicalFeeHook:creatorDestination": roles.creator,
        "recoveryAuthority:signerOne": roles.signerOne,
        "recoveryAuthority:signerTwo": roles.signerTwo,
      };
      const result = results[key];
      if (result === undefined) throw new Error(`unexpected read ${key}`);
      return result;
    }),
    verifySiweMessage: vi.fn(async () => true),
  };
};

describe("block-pinned admin role reader", () => {
  it.each([
    ["fuel owner", values().fuelOwner, ["liquid-token-owner"]],
    ["ledger owner", values().ledgerOwner, ["reward-ledger-owner"]],
    ["converter owner", values().converterOwner, ["converter-owner"]],
    ["liquidity owner", values().liquidityOwner, ["liquidity-owner"]],
    ["guardian", values().guardian, ["guardian"]],
    ["recovery signer one", values().signerOne, ["recovery"]],
    ["recovery signer two", values().signerTwo, ["recovery"]],
    ["keeper", values().keeper, ["keeper"]],
    ["liquidity executor", values().executor, ["liquidity-executor"]],
    // The creator reaches the console for its own fee withdrawal only.
    ["creator only", values().creator, ["creator"]],
    ["recovery contract itself", values().recoveryAuthority, []],
    ["ordinary wallet", roleAddress("99"), []],
  ] as const)(
    "derives exact console roles for %s",
    async (_, address, expected) => {
      const reader = createAdminRoleReader({ client: client(), manifest });
      await expect(reader.read(address, block)).resolves.toMatchObject({
        block,
        consoleRoles: expected,
      });
    },
  );

  it("pins every role read to one canonical EIP-1898 block hash", async () => {
    const publicClient = client();
    const reader = createAdminRoleReader({ client: publicClient, manifest });
    const observed = await reader.observe();
    await reader.read(values().keeper, observed);

    expect(publicClient.readContract).toHaveBeenCalledTimes(11);
    for (const [request] of vi.mocked(publicClient.readContract).mock.calls) {
      expect(request).toMatchObject({
        blockHash: block.hash,
        requireCanonical: true,
      });
      expect(request).not.toHaveProperty("blockNumber");
    }
    expect(publicClient.getBlock).toHaveBeenCalledOnce();
    expect(publicClient.getBlock).toHaveBeenCalledWith({
      blockTag: "latest",
    });
  });

  it("changes the binding fingerprint when any live authority rotates", async () => {
    const original = await createAdminRoleReader({
      client: client(),
      manifest,
    }).read(values().keeper, block);
    const rotatedValues = { ...values(), guardian: roleAddress("88") };
    const rotated = await createAdminRoleReader({
      client: client(rotatedValues),
      manifest,
    }).read(values().keeper, block);
    expect(original.bindingsFingerprint).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(rotated.bindingsFingerprint).not.toBe(original.bindingsFingerprint);
  });

  it("verifies EOA and ERC-1271 SIWE signatures at the pinned canonical hash", async () => {
    const publicClient = client();
    const reader = createAdminRoleReader({ client: publicClient, manifest });
    const signature = `0x${"cd".repeat(65)}` as Hex;
    await expect(
      reader.verify({
        address: values().keeper,
        block,
        message: "canonical message",
        signature,
      }),
    ).resolves.toBe(true);
    expect(publicClient.verifySiweMessage).toHaveBeenCalledWith({
      address: values().keeper,
      blockHash: block.hash,
      message: "canonical message",
      requireCanonical: true,
      signature,
    });
  });

  it("fails closed for the wrong chain and partial or noncanonical reads", async () => {
    const wrongChain = createAdminRoleReader({
      client: client(values(), 1),
      manifest,
    });
    await expect(wrongChain.observe()).rejects.toBeInstanceOf(
      AdminAuthorityUnavailableError,
    );

    const partialClient = client();
    vi.mocked(partialClient.readContract).mockRejectedValueOnce(
      new Error("private RPC detail"),
    );
    await expect(
      createAdminRoleReader({ client: partialClient, manifest }).read(
        values().keeper,
        block,
      ),
    ).rejects.toMatchObject({ message: "Admin authority is unavailable" });

    const noncanonicalClient = client();
    vi.mocked(noncanonicalClient.readContract).mockRejectedValueOnce(
      new Error("header is not canonical"),
    );
    await expect(
      createAdminRoleReader({ client: noncanonicalClient, manifest }).read(
        values().keeper,
        block,
      ),
    ).rejects.toBeInstanceOf(AdminAuthorityUnavailableError);
  });
});
