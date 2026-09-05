import {
  encodeAbiParameters,
  keccak256,
  toHex,
  type Address,
  type PublicClient,
} from "viem";

import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";

import { createProtocolContracts } from "./contracts.js";
import type {
  ContractReadRequest,
  ContractReadResult,
  ContractReadResults,
  ProtocolReadTransport,
} from "./reader.js";

const MULTICALL_READ_BATCH = 250;
const MULTICALL_RETRY_BATCH = 50;
const MULTICALL_READ_ATTEMPTS = 3;
export const publicQuoteCaller =
  "0x0000000000000000000000000000000000004444" as const satisfies Address;

export const makeViemProtocolTransport = (
  client: PublicClient,
  manifest: ProtocolDeploymentManifest,
  identity: IdentityConfiguration,
  quoteCaller: Address = publicQuoteCaller,
  signal?: AbortSignal,
): ProtocolReadTransport => {
  if (identity.key !== manifest.identity.key) {
    throw new RangeError(
      createIdentityProtocolCopy(identity).transactions.identityMismatch(
        identity.key,
        manifest.identity.key,
      ),
    );
  }
  const contracts = createProtocolContracts(manifest);
  const readMany = async <
    const Requests extends readonly ContractReadRequest[],
  >(
    requests: Requests,
    blockNumber: bigint,
  ): Promise<ContractReadResults<Requests>> => {
    signal?.throwIfAborted();
    const calls = requests.map((request) => {
      const contract = contracts[request.contract];
      return {
        address: contract.address,
        abi: contract.abi,
        functionName: request.functionName,
        args: request.args,
      };
    });
    const mappedResults: ContractReadResult[] = [];
    for (
      let offset = 0;
      offset < calls.length;
      offset += MULTICALL_READ_BATCH
    ) {
      signal?.throwIfAborted();
      const callBatch = calls.slice(offset, offset + MULTICALL_READ_BATCH);
      const requestBatch = requests.slice(
        offset,
        offset + MULTICALL_READ_BATCH,
      );
      const results = (await client.multicall({
        allowFailure: true,
        blockNumber,
        contracts: callBatch,
      } as never)) as unknown as Array<
        | { status: "success"; result: unknown }
        | { status: "failure"; error: unknown }
      >;
      signal?.throwIfAborted();
      requestBatch.forEach((_request, index) => {
        const result = results[index];
        mappedResults.push(
          result === undefined
            ? {
                status: "failure",
                error: new Error(
                  "Multicall result missing for requested contract read",
                ),
              }
            : result.status === "success"
              ? { status: "success", value: result.result }
              : { status: "failure", error: result.error },
        );
      });
    }

    for (let attempt = 1; attempt < MULTICALL_READ_ATTEMPTS; attempt += 1) {
      const failedIndexes = mappedResults.flatMap((result, index) =>
        result.status === "failure" ? [index] : [],
      );
      if (failedIndexes.length === 0) break;

      for (
        let offset = 0;
        offset < failedIndexes.length;
        offset += MULTICALL_RETRY_BATCH
      ) {
        signal?.throwIfAborted();
        const retryIndexes = failedIndexes.slice(
          offset,
          offset + MULTICALL_RETRY_BATCH,
        );
        const results = (await client.multicall({
          allowFailure: true,
          blockNumber,
          contracts: retryIndexes.map((index) => calls[index]),
        } as never)) as unknown as Array<
          | { status: "success"; result: unknown }
          | { status: "failure"; error: unknown }
        >;
        signal?.throwIfAborted();
        retryIndexes.forEach((requestIndex, retryIndex) => {
          const result = results[retryIndex];
          mappedResults[requestIndex] =
            result === undefined
              ? {
                  status: "failure",
                  error: new Error(
                    "Multicall result missing for requested contract read",
                  ),
                }
              : result.status === "success"
                ? { status: "success", value: result.result }
                : { status: "failure", error: result.error };
        });
      }
    }
    return mappedResults as ContractReadResults<Requests>;
  };

  const permanentIdentityIds = async (
    owner: Address,
    candidates: readonly number[],
    blockNumber: bigint,
  ) => {
    signal?.throwIfAborted();
    if (
      candidates.length > 4_444 ||
      candidates.some((identityId) => identityId < 1 || identityId > 4_444)
    ) {
      throw new RangeError("Permanent identity candidate set is out of bounds");
    }
    const states = await readMany(
      candidates.flatMap((identityId) => [
        {
          contract: "fuelMirror" as const,
          functionName: "ownerOf" as const,
          args: [BigInt(identityId)] as const,
        },
        {
          contract: "fuelCore" as const,
          functionName: "isPermanentIdentity" as const,
          args: [identityId] as const,
        },
      ]),
      blockNumber,
    );
    signal?.throwIfAborted();
    const failedState = states.find((state) => state?.status === "failure");
    if (failedState?.status === "failure") throw failedState.error;
    return candidates.filter((_identityId, index) => {
      const ownerState = states[index * 2];
      const permanentState = states[index * 2 + 1];
      return (
        ownerState?.status === "success" &&
        typeof ownerState.value === "string" &&
        ownerState.value.toLowerCase() === owner.toLowerCase() &&
        permanentState?.status === "success" &&
        permanentState.value === true
      );
    });
  };

  return {
    getChainId: async () => {
      signal?.throwIfAborted();
      const chainId = await client.getChainId();
      signal?.throwIfAborted();
      return chainId;
    },
    getBlock: async (blockNumber) => {
      signal?.throwIfAborted();
      const block =
        blockNumber === undefined
          ? await client.getBlock()
          : await client.getBlock({ blockNumber });
      signal?.throwIfAborted();
      if (block.hash === null) {
        throw new Error("Canonical block hash is unavailable");
      }
      return {
        hash: block.hash,
        number: block.number,
        timestamp: block.timestamp,
      };
    },
    getBytecode: async (address, blockNumber) => {
      signal?.throwIfAborted();
      const bytecode = await client.getCode({ address, blockNumber });
      signal?.throwIfAborted();
      return bytecode;
    },
    readMany,
    permanentIdentityIds,
    quoteExactInput: async (
      liquidTokenForWeth,
      amountIn,
      blockNumber,
      caller,
    ) => {
      signal?.throwIfAborted();
      const simulation = await client.simulateContract({
        account: caller ?? quoteCaller,
        address: contracts.canonicalRouter.address,
        abi: contracts.canonicalRouter.abi,
        functionName: "quoteExactInput",
        args: [liquidTokenForWeth, amountIn],
        blockNumber,
      } as never);
      signal?.throwIfAborted();
      return simulation.result as unknown as readonly [bigint, bigint];
    },
    quoteConversionHop: async (tokenIn, tokenOut, amountIn, blockNumber) => {
      signal?.throwIfAborted();
      const simulation = await client.simulateContract({
        account: quoteCaller,
        address: contracts.testConversionVenue.address,
        abi: contracts.testConversionVenue.abi,
        functionName: "quoteExactInput",
        args: [tokenIn, tokenOut, amountIn],
        blockNumber,
      } as never);
      signal?.throwIfAborted();
      return simulation.result as unknown as bigint;
    },
    canonicalMarketState: async (poolId, blockNumber) => {
      signal?.throwIfAborted();
      const stateSlot = BigInt(
        keccak256(
          encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }],
            [poolId, 6n],
          ),
        ),
      );
      const [slot0, liquidityWord] = await Promise.all([
        client.readContract({
          address: contracts.uniswapV4PoolManager.address,
          abi: contracts.uniswapV4PoolManager.abi,
          functionName: "extsload",
          args: [toHex(stateSlot, { size: 32 })],
          blockNumber,
        } as never),
        client.readContract({
          address: contracts.uniswapV4PoolManager.address,
          abi: contracts.uniswapV4PoolManager.abi,
          functionName: "extsload",
          args: [toHex(stateSlot + 3n, { size: 32 })],
          blockNumber,
        } as never),
      ]);
      signal?.throwIfAborted();
      const packed = BigInt(slot0 as `0x${string}`);
      const rawTick = Number((packed >> 160n) & 0xff_ffffn);
      return {
        sqrtPriceX96: packed & ((1n << 160n) - 1n),
        tick: rawTick >= 0x80_0000 ? rawTick - 0x100_0000 : rawTick,
        protocolFee: Number((packed >> 184n) & 0xff_ffffn),
        lpFee: Number((packed >> 208n) & 0xff_ffffn),
        activeLiquidity:
          BigInt(liquidityWord as `0x${string}`) & ((1n << 128n) - 1n),
      };
    },
  };
};
