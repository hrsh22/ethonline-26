import { Effect } from "effect";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import type {
  PreparedTestnetFundingTransfer,
  TestnetFundingAssetAmounts,
  TestnetFundingChain,
  TestnetFundingChainInspection,
} from "./types.ts";

const fundingTokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "operator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "operator", type: "address" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

export interface ViemTestnetFundingChainOptions {
  readonly deploymentTransactionHash: Hex;
  readonly rpcUrl: string;
  readonly privateKey: Hex;
  readonly weth: Address;
  readonly usdc: Address;
}

const operational = <Value>(operation: () => Promise<Value>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => cause });

export const createViemTestnetFundingChain = (
  options: ViemTestnetFundingChainOptions,
): TestnetFundingChain => {
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl, {
    retryCount: 0,
    retryDelay: 250,
    timeout: 5_000,
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport,
  });

  const inspect = (
    recipient: Address,
  ): Effect.Effect<TestnetFundingChainInspection, unknown> =>
    operational(async () => {
      const [
        chainId,
        signerCode,
        deploymentTransaction,
        wethOperator,
        usdcOperator,
        signerWethWei,
        signerEthWei,
        recipientWethWei,
        recipientEthWei,
      ] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getCode({ address: account.address }),
        publicClient.getTransaction({
          hash: options.deploymentTransactionHash,
        }),
        publicClient.readContract({
          address: options.weth,
          abi: fundingTokenAbi,
          functionName: "operator",
        }),
        publicClient.readContract({
          address: options.usdc,
          abi: fundingTokenAbi,
          functionName: "operator",
        }),
        publicClient.readContract({
          address: options.weth,
          abi: fundingTokenAbi,
          functionName: "balanceOf",
          args: [account.address],
        }),
        publicClient.getBalance({ address: account.address }),
        publicClient.readContract({
          address: options.weth,
          abi: fundingTokenAbi,
          functionName: "balanceOf",
          args: [recipient],
        }),
        publicClient.getBalance({ address: recipient }),
      ]);
      return {
        chainId,
        signer: account.address,
        signerCode: signerCode ?? "0x",
        deploymentSender: getAddress(deploymentTransaction.from),
        wethOperator: getAddress(wethOperator),
        usdcOperator: getAddress(usdcOperator),
        signerBalance: {
          wethWei: signerWethWei,
          ethWei: signerEthWei,
        },
        recipientBalance: {
          wethWei: recipientWethWei,
          ethWei: recipientEthWei,
        },
      };
    });

  const prepare = (input: {
    readonly recipient: Address;
    readonly amounts: TestnetFundingAssetAmounts;
  }): Effect.Effect<readonly PreparedTestnetFundingTransfer[], unknown> =>
    operational(async () => {
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      const transfers: PreparedTestnetFundingTransfer[] = [];
      let nonceOffset = 0;
      if (input.amounts.wethWei > 0n) {
        const data = encodeFunctionData({
          abi: fundingTokenAbi,
          functionName: "transfer",
          args: [input.recipient, input.amounts.wethWei],
        });
        const simulation = await publicClient.simulateContract({
          account,
          address: options.weth,
          abi: fundingTokenAbi,
          functionName: "transfer",
          args: [input.recipient, input.amounts.wethWei],
        });
        if (!simulation.result) {
          throw new Error("Test WETH transfer simulation returned false");
        }
        const request = await walletClient.prepareTransactionRequest({
          account,
          data,
          nonce: nonce + nonceOffset,
          to: options.weth,
        });
        const rawTransaction = await walletClient.signTransaction(request);
        transfers.push({
          amountWei: input.amounts.wethWei,
          hash: keccak256(rawTransaction),
          kind: "weth",
          rawTransaction,
        });
        nonceOffset += 1;
      }
      if (input.amounts.ethWei > 0n) {
        await publicClient.call({
          account: account.address,
          to: input.recipient,
          value: input.amounts.ethWei,
        });
        const request = await walletClient.prepareTransactionRequest({
          account,
          nonce: nonce + nonceOffset,
          to: input.recipient,
          value: input.amounts.ethWei,
        });
        const rawTransaction = await walletClient.signTransaction(request);
        transfers.push({
          amountWei: input.amounts.ethWei,
          hash: keccak256(rawTransaction),
          kind: "eth",
          rawTransaction,
        });
      }
      return transfers;
    });

  const signerNonce = (): Effect.Effect<number, unknown> =>
    operational(() =>
      publicClient.getTransactionCount({
        address: account.address,
        blockTag: "latest",
      }),
    );

  const broadcast = (rawTransaction: Hex): Effect.Effect<Hex, unknown> =>
    operational(() =>
      publicClient.sendRawTransaction({
        serializedTransaction: rawTransaction,
      }),
    );

  const receipt = (
    hash: Hex,
  ): Effect.Effect<
    "pending" | "confirmed" | "reverted" | "unavailable",
    unknown
  > =>
    operational(async () => {
      try {
        const transactionReceipt = await publicClient.getTransactionReceipt({
          hash,
        });
        return transactionReceipt.status === "success"
          ? ("confirmed" as const)
          : ("reverted" as const);
      } catch (cause) {
        return cause instanceof TransactionReceiptNotFoundError
          ? ("pending" as const)
          : ("unavailable" as const);
      }
    });

  return { inspect, prepare, broadcast, receipt, signerNonce };
};
