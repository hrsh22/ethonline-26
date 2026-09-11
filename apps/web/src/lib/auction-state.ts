import { formatUnits, parseUnits, type Address, type Hash } from "viem";

export type AuctionPhase =
  | "upcoming"
  | "live"
  | "settling"
  | "refunds"
  | "claim-wait"
  | "claims"
  | "complete";

export interface CollectorAuctionBid {
  readonly bidId: bigint;
  readonly committedCurrency: bigint;
  readonly maxPriceFormatted: string;
  readonly exited: boolean;
  readonly claimableTokens: bigint;
}

export interface CollectorAuctionSnapshot {
  readonly auctionAddress: Address;
  readonly observedBlock: bigint;
  readonly startBlock: bigint;
  readonly endBlock: bigint;
  readonly claimBlock: bigint;
  readonly finalized: boolean;
  readonly graduated: boolean;
  readonly currency: {
    readonly address?: Address | undefined;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly token: { readonly symbol: string; readonly decimals: number };
  readonly totalTokens: bigint;
  readonly tokensSold: bigint;
  readonly currencyCommitted: bigint;
  readonly minimumRaise: bigint;
  readonly currencyRaised: bigint;
  readonly clearingPriceFormatted: string;
  readonly floorPriceFormatted: string;
  readonly walletCurrencyBalance: bigint;
  readonly tokenAllowance: bigint;
  readonly auctionAllowance: bigint;
  readonly escrow: {
    readonly address: Address;
    readonly deployed: boolean;
    readonly readyToBid: boolean;
    readonly currencyBalance: bigint;
    readonly fuelBalance: bigint;
    readonly maximumFuelWithdrawal: bigint;
  };
  readonly marketOpen: boolean;
  readonly bids: readonly CollectorAuctionBid[];
}

export type AuctionAction =
  | { readonly type: "deploy-escrow" }
  | { readonly type: "approve-token"; readonly amount: bigint }
  | { readonly type: "approve-auction"; readonly amount: bigint }
  | {
      readonly type: "bid";
      readonly amount: bigint;
      readonly maxPriceFormatted: string;
    }
  | { readonly type: "finalize" }
  | { readonly type: "exit"; readonly bidId: bigint }
  | { readonly type: "claim"; readonly bidId: bigint }
  | { readonly type: "withdraw-currency" }
  | { readonly type: "deliver-fuel" };

export interface AuctionActionState {
  readonly enabled: boolean;
  readonly condition?: "insufficient-weth" | undefined;
  readonly reason?: string | undefined;
}

export interface AuctionTransactionRecord {
  readonly account: Address;
  readonly action: AuctionAction;
  readonly auctionAddress: Address;
  readonly createdAt: number;
  readonly hash: Hash;
  readonly version: 1;
}

export const auctionPhase = (
  snapshot: CollectorAuctionSnapshot,
): AuctionPhase => {
  if (snapshot.observedBlock < snapshot.startBlock) return "upcoming";
  if (snapshot.observedBlock < snapshot.endBlock) return "live";
  if (!snapshot.finalized) return "settling";
  if (!snapshot.graduated) {
    return snapshot.bids.some((bid) => !bid.exited) ||
      snapshot.escrow.currencyBalance > 0n
      ? "refunds"
      : "complete";
  }
  if (snapshot.observedBlock < snapshot.claimBlock) return "claim-wait";
  return snapshot.bids.some((bid) => bid.claimableTokens > 0n) ||
    snapshot.escrow.fuelBalance > 0n
    ? "claims"
    : "complete";
};

export const auctionProgress = (snapshot: CollectorAuctionSnapshot): number => {
  if (snapshot.observedBlock <= snapshot.startBlock) return 0;
  if (snapshot.observedBlock >= snapshot.endBlock) return 100;
  const elapsed = snapshot.observedBlock - snapshot.startBlock;
  const duration = snapshot.endBlock - snapshot.startBlock;
  return Number((elapsed * 10_000n) / duration) / 100;
};

export const parseAuctionAmount = (
  value: string,
  decimals: number,
): bigint | undefined => {
  try {
    const amount = parseUnits(value.trim(), decimals);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
};

export const bidActionState = (
  snapshot: CollectorAuctionSnapshot,
  amount: bigint | undefined,
  maxPriceFormatted: string,
): AuctionActionState => {
  if (auctionPhase(snapshot) !== "live")
    return { enabled: false, reason: "Bidding is not open." };
  if (amount === undefined)
    return { enabled: false, reason: "Enter a positive bid amount." };
  if (amount > snapshot.walletCurrencyBalance)
    return {
      condition:
        snapshot.currency.symbol === "WETH" ? "insufficient-weth" : undefined,
      enabled: false,
      reason: `Your ${snapshot.currency.symbol} balance is too low.`,
    };
  if (snapshot.escrow.deployed && !snapshot.escrow.readyToBid)
    return {
      enabled: false,
      reason: "Your auction delivery account is not registered for bidding.",
    };
  const maximumPrice = parseAuctionAmount(
    maxPriceFormatted,
    snapshot.currency.decimals,
  );
  if (maximumPrice === undefined)
    return { enabled: false, reason: "Enter a positive maximum price." };
  const clearingPrice = parseAuctionAmount(
    snapshot.clearingPriceFormatted,
    snapshot.currency.decimals,
  );
  if (clearingPrice !== undefined && maximumPrice <= clearingPrice)
    return {
      enabled: false,
      reason: "Set a maximum price above the current clearing price.",
    };
  return { enabled: true };
};

export const nextBidAction = (
  snapshot: CollectorAuctionSnapshot,
  amount: bigint | undefined,
  maxPriceFormatted: string,
): {
  readonly action?: AuctionAction | undefined;
  readonly state: AuctionActionState;
} => {
  const state = bidActionState(snapshot, amount, maxPriceFormatted);
  if (!state.enabled || amount === undefined) return { state };
  if (!snapshot.escrow.deployed) {
    return { action: { type: "deploy-escrow" }, state };
  }
  if (
    snapshot.currency.address !== undefined &&
    snapshot.tokenAllowance < amount
  ) {
    return { action: { type: "approve-token", amount }, state };
  }
  if (
    snapshot.currency.address !== undefined &&
    snapshot.auctionAllowance < amount
  ) {
    return { action: { type: "approve-auction", amount }, state };
  }
  return { action: { type: "bid", amount, maxPriceFormatted }, state };
};

export const formatAuctionAmount = (amount: bigint, decimals: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
    Number(formatUnits(amount, decimals)),
  );

export const auctionPhaseCopy: Record<
  AuctionPhase,
  { readonly label: string; readonly explanation: string }
> = {
  upcoming: {
    label: "Scheduled",
    explanation: "The auction has not reached its opening block.",
  },
  live: {
    label: "Bidding live",
    explanation: "Bids compete at or below each collector’s maximum price.",
  },
  settling: {
    label: "Finalizing",
    explanation:
      "The auction ended and its final clearing result is being recorded.",
  },
  refunds: {
    label: "Refunds ready",
    explanation:
      "The target was not reached. Each bid can recover its committed currency.",
  },
  "claim-wait": {
    label: "Claim scheduled",
    explanation: "The auction cleared. Allocations unlock at the claim block.",
  },
  claims: {
    label: "Claims ready",
    explanation: "Settled token allocations are ready for delivery.",
  },
  complete: {
    label: "Complete",
    explanation: "No refund or token delivery remains for this wallet.",
  },
};
