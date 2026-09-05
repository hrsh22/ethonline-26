import {
  getAddress,
  isAddressEqual,
  parseAbi,
  sha256,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import {
  adminConsoleRoles,
  type AdminCapabilityFlags,
  type AdminConsoleRoleId,
} from "@orbit/config/admin-auth";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";

export interface AdminAuthorityBlock {
  readonly hash: Hash;
  readonly number: bigint;
}

export interface AdminRoleBindings {
  readonly owners: {
    readonly liquidToken: Address;
    readonly rewards: Address;
    readonly converter: Address;
    readonly liquidity: Address;
  };
  readonly guardian: Address;
  readonly recoveryAuthority: Address;
  readonly recoverySigners: readonly [Address, Address];
  readonly keeper: Address;
  readonly liquidityExecutor: Address;
  readonly creator: Address;
}

export interface AdminAuthoritySnapshot {
  readonly bindings: AdminRoleBindings;
  readonly bindingsFingerprint: Hex;
  readonly block: AdminAuthorityBlock;
  readonly capabilities: AdminCapabilityFlags;
  readonly consoleRoles: readonly AdminConsoleRoleId[];
}

interface BlockResult {
  readonly hash: Hash | null;
  readonly number: bigint | null;
}

interface ContractRead {
  readonly abi: Abi | readonly unknown[];
  readonly address: Address;
  readonly blockHash: Hash;
  readonly functionName: string;
  readonly requireCanonical: true;
}

export interface AdminRoleReaderClient {
  readonly getBlock: (parameters: {
    readonly blockTag: "latest";
  }) => Promise<BlockResult>;
  readonly getChainId: () => Promise<number>;
  readonly readContract: (parameters: ContractRead) => Promise<unknown>;
  readonly verifySiweMessage: (parameters: {
    readonly address: Address;
    readonly blockHash: Hash;
    readonly message: string;
    readonly requireCanonical: true;
    readonly signature: Hex;
  }) => Promise<boolean>;
}

export class AdminAuthorityUnavailableError extends Error {
  override readonly name = "AdminAuthorityUnavailableError";

  constructor(cause?: unknown) {
    super("Admin authority is unavailable", { cause });
  }
}

const recoveryAuthorityAbi = parseAbi([
  "function signerOne() view returns (address)",
  "function signerTwo() view returns (address)",
]);

const addressResult = (value: unknown): Address => {
  if (typeof value !== "string")
    throw new TypeError("Role read was not an address");
  return getAddress(value);
};

const roleBindingFingerprint = (bindings: AdminRoleBindings): Hex =>
  sha256(
    stringToHex(
      JSON.stringify({
        owners: {
          liquidToken: bindings.owners.liquidToken.toLowerCase(),
          rewards: bindings.owners.rewards.toLowerCase(),
          converter: bindings.owners.converter.toLowerCase(),
          liquidity: bindings.owners.liquidity.toLowerCase(),
        },
        guardian: bindings.guardian.toLowerCase(),
        recoveryAuthority: bindings.recoveryAuthority.toLowerCase(),
        recoverySigners: bindings.recoverySigners.map((address) =>
          address.toLowerCase(),
        ),
        keeper: bindings.keeper.toLowerCase(),
        liquidityExecutor: bindings.liquidityExecutor.toLowerCase(),
        creator: bindings.creator.toLowerCase(),
      }),
    ),
  );

const capabilitiesFor = (
  subject: Address,
  bindings: AdminRoleBindings,
): AdminCapabilityFlags => ({
  owners: {
    liquidToken: isAddressEqual(subject, bindings.owners.liquidToken),
    rewards: isAddressEqual(subject, bindings.owners.rewards),
    converter: isAddressEqual(subject, bindings.owners.converter),
    liquidity: isAddressEqual(subject, bindings.owners.liquidity),
  },
  guardian: isAddressEqual(subject, bindings.guardian),
  recovery: bindings.recoverySigners.some((signer) =>
    isAddressEqual(subject, signer),
  ),
  keeper: isAddressEqual(subject, bindings.keeper),
  liquidityExecutor: isAddressEqual(subject, bindings.liquidityExecutor),
  creator: isAddressEqual(subject, bindings.creator),
});

export interface AdminRoleReader {
  readonly observe: () => Promise<AdminAuthorityBlock>;
  readonly read: (
    address: Address,
    block: AdminAuthorityBlock,
  ) => Promise<AdminAuthoritySnapshot>;
  readonly verify: (input: {
    readonly address: Address;
    readonly block: AdminAuthorityBlock;
    readonly message: string;
    readonly signature: Hex;
  }) => Promise<boolean>;
}

export const createAdminRoleReader = ({
  client,
  manifest,
}: {
  readonly client: AdminRoleReaderClient;
  readonly manifest: ProtocolDeploymentManifest;
}): AdminRoleReader => {
  const contracts = createProtocolContracts(manifest);
  const observe = async (): Promise<AdminAuthorityBlock> => {
    try {
      if ((await client.getChainId()) !== manifest.chainId) {
        throw new Error("Admin RPC is connected to the wrong chain");
      }
      const observed = await client.getBlock({ blockTag: "latest" });
      if (observed.number === null || observed.hash === null) {
        throw new Error("Admin RPC returned an incomplete block");
      }
      return {
        hash: observed.hash,
        number: observed.number,
      };
    } catch (cause) {
      throw cause instanceof AdminAuthorityUnavailableError
        ? cause
        : new AdminAuthorityUnavailableError(cause);
    }
  };
  const read = async (
    subject: Address,
    block: AdminAuthorityBlock,
  ): Promise<AdminAuthoritySnapshot> => {
    try {
      const atBlock = <T>(parameters: {
        readonly abi: Abi | readonly unknown[];
        readonly address: Address;
        readonly functionName: string;
      }): Promise<T> =>
        client.readContract({
          ...parameters,
          blockHash: block.hash,
          requireCanonical: true,
        }) as Promise<T>;
      const [
        liquidTokenOwner,
        guardian,
        recoveryAuthority,
        rewardsOwner,
        converterOwner,
        keeper,
        liquidityOwner,
        liquidityExecutor,
        creator,
      ] = await Promise.all([
        atBlock<Address>({ ...contracts.fuelCore, functionName: "owner" }),
        atBlock<Address>({ ...contracts.fuelCore, functionName: "guardian" }),
        atBlock<Address>({
          ...contracts.fuelCore,
          functionName: "recoveryAuthority",
        }),
        atBlock<Address>({ ...contracts.rewardLedger, functionName: "owner" }),
        atBlock<Address>({
          ...contracts.epochConverter,
          functionName: "owner",
        }),
        atBlock<Address>({
          ...contracts.epochConverter,
          functionName: "keeper",
        }),
        atBlock<Address>({
          ...contracts.protocolLiquidityVault,
          functionName: "owner",
        }),
        atBlock<Address>({
          ...contracts.protocolLiquidityVault,
          functionName: "executor",
        }),
        atBlock<Address>({
          ...contracts.canonicalFeeHook,
          functionName: "creatorDestination",
        }),
      ]);
      const checkedRecoveryAuthority = addressResult(recoveryAuthority);
      const [signerOne, signerTwo] = await Promise.all([
        atBlock<Address>({
          abi: recoveryAuthorityAbi,
          address: checkedRecoveryAuthority,
          functionName: "signerOne",
        }),
        atBlock<Address>({
          abi: recoveryAuthorityAbi,
          address: checkedRecoveryAuthority,
          functionName: "signerTwo",
        }),
      ]);
      const bindings: AdminRoleBindings = {
        owners: {
          liquidToken: addressResult(liquidTokenOwner),
          rewards: addressResult(rewardsOwner),
          converter: addressResult(converterOwner),
          liquidity: addressResult(liquidityOwner),
        },
        guardian: addressResult(guardian),
        recoveryAuthority: checkedRecoveryAuthority,
        recoverySigners: [addressResult(signerOne), addressResult(signerTwo)],
        keeper: addressResult(keeper),
        liquidityExecutor: addressResult(liquidityExecutor),
        creator: addressResult(creator),
      };
      const capabilities = capabilitiesFor(getAddress(subject), bindings);
      return {
        bindings,
        bindingsFingerprint: roleBindingFingerprint(bindings),
        block,
        capabilities,
        consoleRoles: adminConsoleRoles(capabilities),
      };
    } catch (cause) {
      throw cause instanceof AdminAuthorityUnavailableError
        ? cause
        : new AdminAuthorityUnavailableError(cause);
    }
  };
  const verify: AdminRoleReader["verify"] = async (input) => {
    try {
      return await client.verifySiweMessage({
        address: input.address,
        blockHash: input.block.hash,
        message: input.message,
        requireCanonical: true,
        signature: input.signature,
      });
    } catch (cause) {
      throw new AdminAuthorityUnavailableError(cause);
    }
  };
  return { observe, read, verify };
};
