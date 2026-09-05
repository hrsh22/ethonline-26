import {
  createPublicClient,
  defineChain,
  http,
  TransactionReceiptNotFoundError,
  type PublicClient,
} from "viem";

import type { HistoryIndexConfiguration } from "./configuration.ts";
import type { DecodedHistoryLog, HistoryPublicClient } from "./rpc-source.ts";
import type { KeeperReceiptSource } from "./keeper-attempt-store.ts";

const requireBlock = (block: Awaited<ReturnType<PublicClient["getBlock"]>>) => {
  if (block.number === null || block.hash === null) {
    throw new Error("History RPC returned an unmined block");
  }
  return {
    blockNumber: block.number,
    blockHash: block.hash,
    parentHash: block.parentHash,
    blockTimestamp: block.timestamp,
  } as const;
};

export const createViemHistoryPublicClient = (
  rpcUrl: string,
  configuration: HistoryIndexConfiguration,
): HistoryPublicClient & KeeperReceiptSource => {
  const chain = defineChain({
    id: configuration.chainId,
    name: configuration.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }),
  });
  return {
    getChainId: () => client.getChainId(),
    getBlock: async (parameters = {}) =>
      requireBlock(
        parameters.blockNumber === undefined
          ? await client.getBlock()
          : await client.getBlock({ blockNumber: parameters.blockNumber }),
      ),
    getLogs: async (request) => {
      const logs = await client.getLogs({
        address: request.address,
        event: request.event,
        ...(request.indexedArguments === undefined
          ? {}
          : { args: request.indexedArguments }),
        fromBlock: request.fromBlock,
        toBlock: request.toBlock,
        strict: true,
      } as never);
      return logs.map((log) => {
        const decoded = log as unknown as DecodedHistoryLog;
        if (
          decoded.blockHash === null ||
          decoded.blockNumber === null ||
          decoded.transactionHash === null ||
          decoded.transactionIndex === null ||
          decoded.logIndex === null
        ) {
          throw new Error(`Unmined ${request.eventName} log was returned`);
        }
        return decoded;
      });
    },
    getReceipt: async (transactionHash) => {
      try {
        const receipt = await client.getTransactionReceipt({
          hash: transactionHash,
        });
        return {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
        };
      } catch (cause) {
        if (cause instanceof TransactionReceiptNotFoundError) return undefined;
        throw cause;
      }
    },
    getHeader: async (blockNumber) =>
      requireBlock(await client.getBlock({ blockNumber })),
  };
};
