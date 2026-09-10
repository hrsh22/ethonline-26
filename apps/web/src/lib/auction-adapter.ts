import { ccaAbis } from "@orbit/protocol/contracts";
import { createProtocolReader } from "@orbit/protocol/reader";
import { makeViemProtocolTransport } from "@orbit/protocol/viem-transport";
import {
  encodeFunctionData,
  formatUnits,
  parseAbi,
  type Abi,
  type AbiEvent,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { getWalletClient } from "wagmi/actions";

import {
  protocolDeploymentFingerprint,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { applicationCopy, identity } from "@/lib/identity";
import { executeProtocolTransaction } from "@/lib/transaction-execution";
import {
  createProtocolReadClient,
  currentWalletConnection,
  protocolChain,
  protocolTransactionClient,
  wagmiConfig,
} from "@/lib/wagmi";

import type {
  AuctionAction,
  AuctionTransactionRecord,
  CollectorAuctionSnapshot,
} from "./auction-state";
import type { TransactionState } from "./transaction-state";

export interface AuctionAdapter {
  readonly configured: boolean;
  readonly deploymentKey: string;
  read(
    account: Address,
    signal: AbortSignal,
  ): Promise<CollectorAuctionSnapshot>;
  execute(
    account: Address,
    action: AuctionAction,
    onState: (state: TransactionState) => void,
  ): Promise<{ readonly blockNumber: bigint; readonly hash: Hash }>;
  recover(
    record: AuctionTransactionRecord,
    onState: (state: TransactionState) => void,
  ): Promise<{ readonly blockNumber: bigint }>;
}

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const Q96 = 1n << 96n;
const DISPLAY_SCALE = 10n ** 18n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const PERMIT2_LIFETIME_SECONDS = 24n * 60n * 60n;
const PRICE_DISPLAY_DECIMALS = 6;
const LOG_BLOCK_WINDOW = 9_999n;

const unavailable = (): never => {
  throw new Error(
    "The auction contract is not published in this deployment yet. Refresh after the CCA manifest is available.",
  );
};

const q96Price = (value: bigint): string =>
  formatUnits(
    (value * 10n ** BigInt(PRICE_DISPLAY_DECIMALS) + Q96 / 2n) / Q96,
    PRICE_DISPLAY_DECIMALS,
  );

export const snapAuctionPriceQ96 = (
  value: string,
  floor: bigint,
  spacing: bigint,
): bigint => {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,18})?$/u.test(normalized))
    throw new RangeError("Enter a maximum price with at most 18 decimals.");
  const [whole, fraction = ""] = normalized.split(".") as [string, string?];
  const decimal = BigInt(`${whole}${fraction.padEnd(18, "0")}`);
  const requested = (decimal * Q96) / DISPLAY_SCALE;
  if (spacing <= 0n) throw new RangeError("Auction tick spacing is invalid.");
  if (requested <= floor) return floor + spacing;
  const delta = requested - floor;
  const completeTicks = delta / spacing;
  const remainder = delta % spacing;
  // Decimal input cannot spell most Q96 grid points exactly. Treat a
  // sub-wei display difference as the intended tick; otherwise preserve the
  // user's ceiling by rounding upward.
  const subDisplayWeiTolerance = Q96 / DISPLAY_SCALE;
  const ticks =
    remainder === 0n || remainder <= subDisplayWeiTolerance
      ? completeTicks
      : completeTicks + 1n;
  return floor + (ticks === 0n ? 1n : ticks) * spacing;
};

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const asAddress = (value: string): Address => value as Address;

const actionLabel = (action: AuctionAction): string => {
  switch (action.type) {
    case "deploy-escrow":
      return "Prepare auction account";
    case "approve-token":
      return "Approve Permit2";
    case "approve-auction":
      return "Set auction allowance";
    case "bid":
      return "Place bid";
    case "finalize":
      return "Finalize auction";
    case "exit":
      return `Settle bid ${action.bidId}`;
    case "claim":
      return `Claim bid ${action.bidId}`;
    case "withdraw-currency":
      return "Withdraw WETH refund";
    case "deliver-fuel":
      return "Deliver FUEL";
  }
};

const assertCcaManifest = () => {
  if (
    protocolDeploymentManifest === undefined ||
    protocolDeploymentManifest.schemaVersion !== 3
  )
    return unavailable();
  return protocolDeploymentManifest;
};

const readerFor = (signal?: AbortSignal) => {
  const manifest = assertCcaManifest();
  const client =
    signal === undefined
      ? protocolTransactionClient
      : createProtocolReadClient(signal);
  return createProtocolReader({
    manifest,
    identity,
    transport: makeViemProtocolTransport(
      client as unknown as Parameters<typeof makeViemProtocolTransport>[0],
      manifest,
      identity,
      undefined,
      signal,
    ),
  });
};

const readAuctionLogs = async (
  client: ReturnType<typeof createProtocolReadClient>,
  address: Address,
  event: AbiEvent,
  owner: Address | undefined,
  fromBlock: bigint,
  toBlock: bigint,
) => {
  if (fromBlock > toBlock) return [];
  const logs: unknown[] = [];
  for (
    let start = fromBlock;
    start <= toBlock;
    start += LOG_BLOCK_WINDOW + 1n
  ) {
    const end =
      start + LOG_BLOCK_WINDOW < toBlock ? start + LOG_BLOCK_WINDOW : toBlock;
    logs.push(
      ...(await client.getLogs({
        address,
        event,
        ...(owner === undefined ? {} : { args: { owner } }),
        fromBlock: start,
        toBlock: end,
      } as never)),
    );
  }
  return logs;
};

const readAuction = async (
  account: Address,
  signal: AbortSignal,
): Promise<CollectorAuctionSnapshot> => {
  const manifest = assertCcaManifest();
  const client = createProtocolReadClient(signal);
  const reader = readerFor(signal);
  const [auction, escrow, readiness] = await Promise.all([
    reader.readCcaAuction(),
    reader.readCcaEscrow(account),
    reader.readCcaReadiness(),
  ]);
  if (!auction.supported || !escrow.supported || !readiness.supported)
    return unavailable();
  if (!auction.configurationMatchesManifest)
    throw new Error(
      "The auction contract does not match its published configuration.",
    );

  const observedBlock = [
    auction.observedBlock,
    escrow.observedBlock,
    readiness.observedBlock,
  ].reduce((minimum, block) => (block < minimum ? block : minimum));
  const [
    walletCurrencyBalance,
    maximumFuelWithdrawal,
    block,
    submitted,
    claimed,
  ] = await Promise.all([
    client.readContract({
      address: asAddress(manifest.contracts.weth),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber: observedBlock,
    }),
    escrow.deployed
      ? client.readContract({
          address: escrow.escrow,
          abi: ccaAbis.bidEscrow,
          functionName: "MAX_FUEL_WITHDRAWAL",
          blockNumber: observedBlock,
        })
      : Promise.resolve(64n * 10n ** 18n),
    client.getBlock({ blockNumber: observedBlock }),
    readAuctionLogs(
      client,
      asAddress(manifest.contracts.continuousClearingAuction),
      ccaAbis.continuousClearingAuction.find(
        (item) => item.type === "event" && item.name === "BidSubmitted",
      ) as AbiEvent,
      escrow.escrow,
      auction.startBlock,
      observedBlock,
    ),
    readAuctionLogs(
      client,
      asAddress(manifest.contracts.continuousClearingAuction),
      ccaAbis.continuousClearingAuction.find(
        (item) => item.type === "event" && item.name === "TokensClaimed",
      ) as AbiEvent,
      escrow.escrow,
      auction.startBlock,
      observedBlock,
    ),
  ]);
  signal.throwIfAborted();
  const bidIds = [
    ...new Set(
      submitted.flatMap((log) => {
        const args = (log as { readonly args?: { readonly id?: bigint } }).args;
        return args?.id === undefined ? [] : [args.id];
      }),
    ),
  ];
  const claimedIds = new Set(
    claimed.flatMap((log) => {
      const args = (log as { readonly args?: { readonly bidId?: bigint } })
        .args;
      return args?.bidId === undefined ? [] : [args.bidId.toString()];
    }),
  );
  const bidReads = await Promise.all(
    bidIds.map((bidId) => reader.readCcaBid(bidId)),
  );
  const bids = bidReads.flatMap((result) => {
    if (!result.supported) return [];
    const bid = result.bid;
    const exited = bid.exitedBlock !== 0n;
    return [
      {
        bidId: result.bidId,
        committedCurrency: bid.amountQ96 >> 96n,
        maxPriceFormatted: q96Price(bid.maxPrice),
        exited,
        claimableTokens:
          exited && !claimedIds.has(result.bidId.toString())
            ? bid.tokensFilled
            : 0n,
      },
    ];
  });
  return {
    auctionAddress: asAddress(manifest.contracts.continuousClearingAuction),
    observedBlock,
    startBlock: auction.startBlock,
    endBlock: auction.endBlock,
    claimBlock: auction.claimBlock,
    finalized: auction.finalized,
    graduated: auction.graduated,
    currency: {
      address: asAddress(manifest.contracts.weth),
      symbol: "WETH",
      decimals: 18,
    },
    token: { symbol: "$FUEL", decimals: 18 },
    totalTokens: BigInt(manifest.cca.economics.auctionSupply),
    tokensSold: auction.tokensCleared,
    currencyRaised: auction.currencyRaised,
    clearingPriceFormatted: q96Price(auction.clearingPriceQ96),
    floorPriceFormatted: q96Price(BigInt(manifest.cca.economics.floorPriceQ96)),
    walletCurrencyBalance,
    tokenAllowance: escrow.wethPermit2Allowance,
    auctionAllowance:
      escrow.permit2AuctionAllowance.expiration >= block.timestamp
        ? escrow.permit2AuctionAllowance.amount
        : 0n,
    escrow: {
      address: escrow.escrow,
      deployed: escrow.deployed,
      readyToBid: escrow.escrowReady,
      currencyBalance: escrow.currencyBalance,
      fuelBalance: escrow.fuelBalance,
      maximumFuelWithdrawal,
    },
    marketOpen: readiness.marketOpen,
    bids,
  };
};

const encodeCall = (
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Hex => encodeFunctionData({ abi, functionName, args } as never);

const bidExitHints = async (bid: {
  readonly startBlock: bigint;
  readonly maxPrice: bigint;
}) => {
  const manifest = assertCcaManifest();
  const auction = await readerFor().readCcaAuction();
  if (!auction.supported) return unavailable();
  const logs = await readAuctionLogs(
    protocolTransactionClient as unknown as ReturnType<
      typeof createProtocolReadClient
    >,
    asAddress(manifest.contracts.continuousClearingAuction),
    ccaAbis.continuousClearingAuction.find(
      (item) => item.type === "event" && item.name === "CheckpointUpdated",
    ) as AbiEvent,
    undefined,
    bid.startBlock,
    auction.observedBlock,
  );
  const checkpoints = logs.flatMap((log) => {
    const args = (
      log as {
        readonly args?: {
          readonly blockNumber?: bigint;
          readonly clearingPriceQ96?: bigint;
        };
      }
    ).args;
    return args?.blockNumber === undefined ||
      args.clearingPriceQ96 === undefined
      ? []
      : [{ block: args.blockNumber, price: args.clearingPriceQ96 }];
  });
  const lastFullyFilled = checkpoints
    .filter(
      ({ block: checkpointBlock, price }) =>
        checkpointBlock >= bid.startBlock && price < bid.maxPrice,
    )
    .at(-1);
  const outbid = checkpoints.find(
    ({ block: checkpointBlock, price }) =>
      checkpointBlock >= bid.startBlock && price > bid.maxPrice,
  );
  if (lastFullyFilled === undefined)
    throw new Error("The bid's settlement checkpoint could not be located.");
  return {
    lastFullyFilled: lastFullyFilled.block,
    outbid: outbid?.block ?? 0n,
  };
};

// The discriminated action union is intentionally resolved in one place so
// every wallet path shares the same address and calldata review boundary.
/* eslint-disable complexity */
const preparedCall = async (
  account: Address,
  action: AuctionAction,
): Promise<{
  readonly to: Address;
  readonly data: Hex;
  readonly label: string;
}> => {
  const manifest = assertCcaManifest();
  const label = actionLabel(action);
  if (action.type === "deploy-escrow")
    return {
      to: asAddress(manifest.contracts.ccaBidEscrowFactory),
      data: encodeCall(ccaAbis.bidEscrowFactory, "deployEscrow", [account]),
      label,
    };
  if (action.type === "approve-token")
    return {
      to: asAddress(manifest.contracts.weth),
      data: encodeCall(erc20Abi, "approve", [
        manifest.contracts.permit2,
        action.amount,
      ]),
      label,
    };
  if (action.type === "approve-auction") {
    if (action.amount > MAX_UINT160)
      throw new RangeError("Bid amount exceeds Permit2's limit.");
    const block = await protocolTransactionClient.getBlock();
    return {
      to: asAddress(manifest.contracts.permit2),
      data: encodeCall(ccaAbis.permit2, "approve", [
        manifest.contracts.weth,
        manifest.contracts.continuousClearingAuction,
        action.amount,
        block.timestamp + PERMIT2_LIFETIME_SECONDS,
      ]),
      label,
    };
  }
  if (action.type === "bid") {
    if (action.amount > MAX_UINT128)
      throw new RangeError("Bid amount exceeds the auction's limit.");
    const reader = readerFor();
    const [escrow, auction] = await Promise.all([
      reader.readCcaEscrow(account),
      reader.readCcaAuction(),
    ]);
    if (
      !escrow.supported ||
      !auction.supported ||
      !escrow.deployed ||
      !escrow.escrowReady
    )
      throw new Error(
        "Prepare the registered auction delivery account before bidding.",
      );
    const price = snapAuctionPriceQ96(
      action.maxPriceFormatted,
      BigInt(manifest.cca.economics.floorPriceQ96),
      BigInt(manifest.cca.economics.tickSpacingQ96),
    );
    if (price <= auction.clearingPriceQ96)
      throw new RangeError(
        "Set a maximum price above the latest clearing price.",
      );
    return {
      to: asAddress(manifest.contracts.continuousClearingAuction),
      data: encodeCall(ccaAbis.continuousClearingAuction, "submitBid", [
        price,
        action.amount,
        escrow.escrow,
        "0x",
      ]),
      label,
    };
  }
  if (action.type === "finalize")
    return {
      to: asAddress(manifest.contracts.continuousClearingAuction),
      data: encodeCall(ccaAbis.continuousClearingAuction, "checkpoint"),
      label,
    };
  if (action.type === "exit") {
    const reader = readerFor();
    const [auction, bidRead, escrow] = await Promise.all([
      reader.readCcaAuction(),
      reader.readCcaBid(action.bidId),
      reader.readCcaEscrow(account),
    ]);
    if (!auction.supported || !bidRead.supported || !escrow.supported)
      return unavailable();
    if (!sameAddress(bidRead.bid.owner, escrow.escrow))
      throw new Error(
        "This bid is not assigned to the connected wallet's escrow.",
      );
    if (!auction.graduated || bidRead.bid.maxPrice > auction.clearingPriceQ96)
      return {
        to: asAddress(manifest.contracts.continuousClearingAuction),
        data: encodeCall(ccaAbis.continuousClearingAuction, "exitBid", [
          action.bidId,
        ]),
        label,
      };
    const hints = await bidExitHints(bidRead.bid);
    return {
      to: asAddress(manifest.contracts.continuousClearingAuction),
      data: encodeCall(
        ccaAbis.continuousClearingAuction,
        "exitPartiallyFilledBid",
        [action.bidId, hints.lastFullyFilled, hints.outbid],
      ),
      label,
    };
  }
  if (action.type === "claim")
    return {
      to: asAddress(manifest.contracts.continuousClearingAuction),
      data: encodeCall(ccaAbis.continuousClearingAuction, "claimTokens", [
        action.bidId,
      ]),
      label,
    };
  const escrow = await readerFor().readCcaEscrow(account);
  if (!escrow.supported || !escrow.deployed)
    throw new Error("The auction delivery account is not deployed.");
  return {
    to: escrow.escrow,
    data: encodeCall(
      ccaAbis.bidEscrow,
      action.type === "withdraw-currency" ? "withdrawCurrency" : "withdrawFuel",
    ),
    label,
  };
};
/* eslint-enable complexity */

const execute = async (
  account: Address,
  action: AuctionAction,
  onState: (state: TransactionState) => void,
) => {
  const call = await preparedCall(account, action);
  const wallet = await getWalletClient(wagmiConfig, {
    chainId: protocolChain.id,
  });
  if (
    wallet.account === undefined ||
    !sameAddress(wallet.account.address, account)
  )
    throw new Error("The connected wallet changed before submission.");
  const request = { account, to: call.to, data: call.data } as const;
  const failureStep = { current: "auction transaction preflight" };
  const result = await executeProtocolTransaction({
    estimateGas: () => protocolTransactionClient.estimateGas(request),
    failureStep,
    label: call.label,
    onState,
    outcomeUnknownMessage: applicationCopy.transaction.outcomeUnknownMessage,
    simulate: async () => {
      await protocolTransactionClient.call(request);
    },
    submit: (gas) =>
      wallet.sendTransaction({ ...request, chain: protocolChain, gas }),
    waitForReceipt: (hash, onReplacement) =>
      protocolTransactionClient.waitForTransactionReceipt({
        hash,
        timeout: 30_000,
        retryCount: 1,
        pollingInterval: 4_000,
        onReplaced: ({ transaction, reason }) =>
          onReplacement(transaction.hash, reason),
      }),
  });
  if (result.state.status !== "confirmed")
    throw new Error("The auction transaction confirmation was not retained.");
  return { blockNumber: result.blockNumber, hash: result.state.hash };
};

const configured = protocolDeploymentManifest?.schemaVersion === 3;
export const auctionAdapter: AuctionAdapter = {
  configured,
  deploymentKey: protocolDeploymentFingerprint ?? "cca-unpublished",
  read: readAuction,
  execute,
  recover: async (record, onState) => {
    const manifest = assertCcaManifest();
    const connection = currentWalletConnection();
    if (
      connection.chainId !== protocolChain.id ||
      connection.address === undefined ||
      !sameAddress(connection.address, record.account)
    )
      throw new Error(
        "Reconnect the wallet that submitted the saved auction transaction.",
      );
    if (
      !sameAddress(
        record.auctionAddress,
        manifest.contracts.continuousClearingAuction,
      )
    )
      throw new Error(
        "The saved transaction belongs to a different auction deployment.",
      );
    const receipt = await protocolTransactionClient.waitForTransactionReceipt({
      hash: record.hash,
      timeout: 30_000,
      retryCount: 1,
      pollingInterval: 4_000,
    });
    if (receipt.status !== "success")
      throw new Error("The saved auction transaction reverted.");
    onState({
      status: "confirmed",
      label: actionLabel(record.action),
      hash: record.hash,
    });
    return { blockNumber: receipt.blockNumber };
  },
};

export const pendingAuctionAdapter: AuctionAdapter = {
  configured: false,
  deploymentKey: "cca-pending",
  read: async () => unavailable(),
  execute: async () => unavailable(),
  recover: async () => unavailable(),
};
