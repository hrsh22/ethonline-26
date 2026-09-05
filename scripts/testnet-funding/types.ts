import type { Effect } from "effect";
import type { Address, Hex } from "viem";

export interface TestnetFundingAssetAmounts {
  readonly wethWei: bigint;
  readonly ethWei: bigint;
}

export interface TestnetFundingLedgerIdentity {
  readonly chainId: number;
  readonly signer: Address;
}

export interface PreparedTestnetFundingTransfer {
  readonly amountWei: bigint;
  readonly hash: Hex;
  readonly kind: "weth" | "eth";
  readonly rawTransaction: Hex;
}

export interface TestnetFundingChainInspection {
  readonly chainId: number;
  readonly signer: Address;
  readonly signerCode: Hex;
  readonly deploymentSender: Address;
  readonly wethOperator: Address;
  readonly usdcOperator: Address;
  readonly signerBalance: TestnetFundingAssetAmounts;
  readonly recipientBalance: TestnetFundingAssetAmounts;
}

export type TestnetFundingReceiptState =
  "pending" | "confirmed" | "reverted" | "unavailable";

export interface TestnetFundingChain {
  readonly inspect: (
    recipient: Address,
  ) => Effect.Effect<TestnetFundingChainInspection, unknown>;
  readonly prepare: (input: {
    readonly recipient: Address;
    readonly amounts: TestnetFundingAssetAmounts;
  }) => Effect.Effect<readonly PreparedTestnetFundingTransfer[], unknown>;
  readonly broadcast: (rawTransaction: Hex) => Effect.Effect<Hex, unknown>;
  /**
   * The signer's next nonce. A signed transfer whose nonce is already behind it
   * can never land, and without this the worker cannot tell that apart from one
   * still waiting in the mempool.
   */
  readonly signerNonce: () => Effect.Effect<number, unknown>;
  readonly receipt: (
    hash: Hex,
  ) => Effect.Effect<TestnetFundingReceiptState, unknown>;
}
