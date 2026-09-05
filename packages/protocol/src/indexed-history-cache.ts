interface IndexedHistoryCacheItem {
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionIndex: number;
  readonly logIndex: number;
}

export interface IndexedHistoryItemCache<Item extends IndexedHistoryCacheItem> {
  readonly fromBlock: bigint;
  readonly throughBlock: bigint;
  readonly items: readonly Item[];
}

// This matches the worker's maximum accepted HISTORY_REORG_OVERLAP_BLOCKS.
// Refreshing the full supported mutable tail keeps every consumer correct when
// an operator increases the default overlap from 64 blocks.
export const INDEXED_HISTORY_MUTABLE_TAIL_BLOCKS = 10_000n;

export const indexedHistoryScanStart = <Item extends IndexedHistoryCacheItem>(
  cache: IndexedHistoryItemCache<Item> | undefined,
  fromBlock: bigint,
  toBlock: bigint,
): bigint => {
  if (
    cache === undefined ||
    cache.fromBlock !== fromBlock ||
    toBlock < cache.throughBlock ||
    cache.throughBlock < fromBlock
  ) {
    return fromBlock;
  }
  const overlap = cache.throughBlock - INDEXED_HISTORY_MUTABLE_TAIL_BLOCKS + 1n;
  return overlap > fromBlock ? overlap : fromBlock;
};

export const indexedHistoryCoveredThrough = (
  indexedThroughBlock: bigint | undefined,
  requestedToBlock: bigint,
  scanFrom: bigint,
): bigint => {
  if (indexedThroughBlock === undefined) return scanFrom - 1n;
  return indexedThroughBlock < requestedToBlock
    ? indexedThroughBlock
    : requestedToBlock;
};

const compareBigint = (left: bigint, right: bigint): number =>
  left === right ? 0 : left < right ? -1 : 1;

const compareHistoryPosition = (
  left: IndexedHistoryCacheItem,
  right: IndexedHistoryCacheItem,
): number =>
  compareBigint(left.blockNumber, right.blockNumber) ||
  left.transactionIndex - right.transactionIndex ||
  left.logIndex - right.logIndex;

export const mergeIndexedHistoryItems = <Item extends IndexedHistoryCacheItem>({
  cache,
  fresh,
  scanFrom,
  throughBlock,
}: {
  readonly cache: IndexedHistoryItemCache<Item> | undefined;
  readonly fresh: readonly Item[];
  readonly scanFrom: bigint;
  readonly throughBlock: bigint;
}): readonly Item[] => {
  const seen = new Set<string>();
  return [
    ...(cache?.items.filter((item) => item.blockNumber < scanFrom) ?? []),
    ...fresh,
  ]
    .sort(compareHistoryPosition)
    .filter((item) => {
      const key = `${item.blockHash.toLowerCase()}:${item.logIndex}`;
      if (item.blockNumber > throughBlock || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
