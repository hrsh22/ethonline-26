import { isAddress, isHash, type Address } from "viem";

import type { AuctionAction, AuctionTransactionRecord } from "./auction-state";

const KEY = "orbit.collector.auction-transaction.v1";
const amountActions = new Set(["approve-token", "approve-auction"]);
const bidIdActions = new Set(["exit", "claim"]);
const parameterlessActions = new Set([
  "deploy-escrow",
  "finalize",
  "withdraw-currency",
  "deliver-fuel",
]);

const isAction = (value: unknown): value is AuctionAction => {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;
  if (amountActions.has(candidate.type))
    return typeof candidate.amount === "bigint";
  if (candidate.type === "bid")
    return (
      typeof candidate.amount === "bigint" &&
      typeof candidate.maxPriceFormatted === "string"
    );
  if (bidIdActions.has(candidate.type))
    return typeof candidate.bidId === "bigint";
  return parameterlessActions.has(candidate.type);
};

const encode = (record: AuctionTransactionRecord): string =>
  JSON.stringify(record, (_, value: unknown) =>
    typeof value === "bigint" ? { $bigint: value.toString() } : value,
  );

const decode = (raw: string): AuctionTransactionRecord | undefined => {
  try {
    const value: unknown = JSON.parse(raw, (_, candidate: unknown) => {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "$bigint" in candidate &&
        typeof candidate.$bigint === "string"
      )
        return BigInt(candidate.$bigint);
      return candidate;
    });
    if (typeof value !== "object" || value === null) return undefined;
    const candidate = value as Record<string, unknown>;
    const fieldsValid = [
      candidate.version === 1,
      typeof candidate.account === "string" && isAddress(candidate.account),
      typeof candidate.auctionAddress === "string" &&
        isAddress(candidate.auctionAddress),
      typeof candidate.hash === "string" && isHash(candidate.hash),
      typeof candidate.createdAt === "number",
      isAction(candidate.action),
    ].every(Boolean);
    return fieldsValid
      ? (candidate as unknown as AuctionTransactionRecord)
      : undefined;
  } catch {
    return undefined;
  }
};

export const writeAuctionTransaction = (
  storage: Pick<Storage, "setItem">,
  record: AuctionTransactionRecord,
): void => storage.setItem(KEY, encode(record));

export const readAuctionTransaction = (
  storage: Pick<Storage, "getItem" | "removeItem">,
  account: Address,
  auctionAddress: Address,
): AuctionTransactionRecord | undefined => {
  const raw = storage.getItem(KEY);
  if (raw === null) return undefined;
  const record = decode(raw);
  if (
    record === undefined ||
    record.account.toLowerCase() !== account.toLowerCase() ||
    record.auctionAddress.toLowerCase() !== auctionAddress.toLowerCase()
  ) {
    storage.removeItem(KEY);
    return undefined;
  }
  return record;
};

export const clearAuctionTransaction = (
  storage: Pick<Storage, "removeItem">,
): void => storage.removeItem(KEY);
