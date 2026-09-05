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

import type { ReplenishAmounts } from "./configuration.ts";
import type { ReplenishmentAsset } from "./ledger.ts";

const tokenAbi = [
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

export type ReplenishReceiptState =
  "pending" | "confirmed" | "reverted" | "unavailable";

export interface ReplenishChainInspection {
  readonly chainId: number;
  readonly treasury: Address;
  readonly treasuryCode: Hex;
  readonly deploymentSender: Address;
  readonly wethOperator: Address;
  readonly usdcOperator: Address;
  readonly treasuryBalance: ReplenishAmounts;
  readonly signerBalance: ReplenishAmounts;
}

export interface PreparedReplenishment {
  readonly amountWei: bigint;
  readonly asset: ReplenishmentAsset;
  readonly hash: Hex;
  readonly rawTransaction: Hex;
}

export interface ReplenishChain {
  readonly inspect: () => Effect.Effect<ReplenishChainInspection, unknown>;
  readonly prepare: (input: {
    readonly asset: ReplenishmentAsset;
    readonly amountWei: bigint;
  }) => Effect.Effect<PreparedReplenishment, unknown>;
  readonly broadcast: (rawTransaction: Hex) => Effect.Effect<Hex, unknown>;
  readonly receipt: (
    hash: Hex,
  ) => Effect.Effect<ReplenishReceiptState, unknown>;
}

export interface ViemReplenishChainOptions {
  readonly deploymentTransactionHash: Hex;
  readonly privateKey: Hex;
  readonly rpcUrl: string;
  readonly signer: Address;
  readonly usdc: Address;
  readonly weth: Address;
}

const operational = <Value>(operation: () => Promise<Value>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => cause });

export const createViemReplenishChain = (
  options: ViemReplenishChainOptions,
): ReplenishChain => {
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl, {
    retryCount: 3,
    retryDelay: 250,
    timeout: 15_000,
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport,
  });

  const wethBalance = (address: Address) =>
    publicClient.readContract({
      abi: tokenAbi,
      address: options.weth,
      args: [address],
      functionName: "balanceOf",
    });

  const inspect = (): Effect.Effect<ReplenishChainInspection, unknown> =>
    operational(async () => {
      const [
        chainId,
        treasuryCode,
        deploymentTransaction,
        wethOperator,
        usdcOperator,
        treasuryWethWei,
        treasuryEthWei,
        signerWethWei,
        signerEthWei,
      ] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getCode({ address: account.address }),
        publicClient.getTransaction({
          hash: options.deploymentTransactionHash,
        }),
        publicClient.readContract({
          abi: tokenAbi,
          address: options.weth,
          functionName: "operator",
        }),
        publicClient.readContract({
          abi: tokenAbi,
          address: options.usdc,
          functionName: "operator",
        }),
        wethBalance(account.address),
        publicClient.getBalance({ address: account.address }),
        wethBalance(options.signer),
        publicClient.getBalance({ address: options.signer }),
      ]);
      return {
        chainId,
        deploymentSender: getAddress(deploymentTransaction.from),
        signerBalance: { ethWei: signerEthWei, wethWei: signerWethWei },
        treasury: account.address,
        treasuryBalance: { ethWei: treasuryEthWei, wethWei: treasuryWethWei },
        treasuryCode: treasuryCode ?? "0x",
        usdcOperator: getAddress(usdcOperator),
        wethOperator: getAddress(wethOperator),
      };
    });

  const prepareWeth = async (
    amountWei: bigint,
  ): Promise<PreparedReplenishment> => {
    const simulation = await publicClient.simulateContract({
      abi: tokenAbi,
      account,
      address: options.weth,
      args: [options.signer, amountWei],
      functionName: "transfer",
    });
    if (!simulation.result) {
      throw new Error("Treasury WETH transfer simulation returned false");
    }
    const request = await walletClient.prepareTransactionRequest({
      account,
      data: encodeFunctionData({
        abi: tokenAbi,
        args: [options.signer, amountWei],
        functionName: "transfer",
      }),
      to: options.weth,
    });
    const rawTransaction = await walletClient.signTransaction(request);
    return {
      amountWei,
      asset: "weth",
      hash: keccak256(rawTransaction),
      rawTransaction,
    };
  };

  const prepareEth = async (
    amountWei: bigint,
  ): Promise<PreparedReplenishment> => {
    await publicClient.call({
      account: account.address,
      to: options.signer,
      value: amountWei,
    });
    const request = await walletClient.prepareTransactionRequest({
      account,
      to: options.signer,
      value: amountWei,
    });
    const rawTransaction = await walletClient.signTransaction(request);
    return {
      amountWei,
      asset: "eth",
      hash: keccak256(rawTransaction),
      rawTransaction,
    };
  };

  return {
    broadcast: (rawTransaction) =>
      operational(() =>
        publicClient.sendRawTransaction({
          serializedTransaction: rawTransaction,
        }),
      ),
    inspect,
    // One transfer per cycle keeps nonce management out of this process: the
    // next cycle reads a fresh pending nonce rather than tracking offsets
    // across a crash.
    prepare: ({ amountWei, asset }) =>
      operational(() =>
        asset === "weth" ? prepareWeth(amountWei) : prepareEth(amountWei),
      ),
    receipt: (hash) =>
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
      }),
  };
};
