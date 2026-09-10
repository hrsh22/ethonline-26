import type { Address, Hex } from "viem";

export const historyEventNames = [
  "discovery-requested",
  "discovery-fulfilled",
  "discovery-cancelled",
  "swap",
  "fee-accrued",
  "protocol-liquidity-added",
  "permanent-commitment",
  "reward-epoch-opened",
  "track-executed",
  "reward-notified",
  "reward-claimed",
  "auction-bid-submitted",
  "auction-bid-exited",
  "auction-tokens-claimed",
  "cca-migration-succeeded",
  "cca-migration-failed",
  "cca-funds-recovered",
  "cca-activated",
  "cca-escrow-withdrawal",
] as const;

export type HistoryEventName = (typeof historyEventNames)[number];

export type HistoryPayloadValue = string | number | boolean | null;
export type HistoryPayload = Readonly<Record<string, HistoryPayloadValue>>;

export interface CanonicalHeader {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly parentHash: Hex;
  readonly blockTimestamp: bigint;
}

export interface IndexedHistoryEvent extends CanonicalHeader {
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly sourceAddress: Address;
  readonly eventName: HistoryEventName;
  readonly payload: HistoryPayload;
  readonly removed: boolean;
}

export interface HistoryCheckpoint extends CanonicalHeader {
  readonly observedHeadBlock: bigint;
  readonly observedHeadTimestamp: bigint;
}

export interface HistoryQuery {
  readonly account?: string;
  readonly eventNames: readonly HistoryEventName[];
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly limit: number;
  readonly cursor?: string;
  readonly order?: "asc" | "desc";
}

export interface HistoryCoverageStatus {
  readonly state: "complete" | "partial";
  readonly requested: {
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
  };
  readonly coverage: {
    readonly fromBlock: bigint;
    readonly indexedThroughBlock: bigint | undefined;
    readonly indexedThroughTime: bigint | undefined;
  };
  readonly head: {
    readonly observedBlock: bigint | undefined;
    readonly lagBlocks: bigint | undefined;
  };
}

export interface HistoryIndexSnapshot {
  readonly generation: string;
  readonly canonicalRevision: number;
  readonly blockNumber: bigint | undefined;
  readonly blockHash: Hex | undefined;
}

export interface HistoryPage {
  readonly snapshot: HistoryIndexSnapshot;
  readonly items: readonly IndexedHistoryEvent[];
  readonly page: {
    readonly hasMore: boolean;
    readonly nextCursor: string | undefined;
  };
  readonly status: HistoryCoverageStatus;
}

export interface CanonicalRangeReplacement {
  readonly fromBlock: bigint;
  readonly through: CanonicalHeader;
  readonly observedHead: CanonicalHeader;
  readonly retainedHeaders: readonly CanonicalHeader[];
  readonly events: readonly IndexedHistoryEvent[];
}
