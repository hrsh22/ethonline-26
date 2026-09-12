import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";

const reads = vi.hoisted(() => ({
  auction: vi.fn(),
  readiness: vi.fn(),
  escrow: vi.fn(),
  bid: vi.fn(),
  logs: vi.fn(),
  balance: vi.fn(),
  contract: vi.fn(),
  block: vi.fn(),
}));

vi.mock("@/lib/deployment", async () => {
  const { protocolDeploymentManifests } =
    await import("@/generated/deployment-manifests");
  return {
    protocolDeploymentManifest: protocolDeploymentManifests.staging,
    protocolDeploymentFingerprint: "public-auction-regression",
  };
});
vi.mock("@orbit/protocol/reader", () => ({
  createProtocolReader: () => ({
    readCcaAuction: reads.auction,
    readCcaReadiness: reads.readiness,
    readCcaEscrow: reads.escrow,
    readCcaBid: reads.bid,
  }),
}));
vi.mock("@orbit/protocol/viem-transport", () => ({
  makeViemProtocolTransport: () => ({}),
}));
vi.mock("@/lib/wagmi", () => ({
  createProtocolReadClient: () => ({
    getLogs: reads.logs,
    getBalance: reads.balance,
    readContract: reads.contract,
    getBlock: reads.block,
  }),
  currentWalletConnection: vi.fn(),
  protocolChain: {},
  protocolTransactionClient: {},
  wagmiConfig: {},
}));

import { auctionAdapter } from "./auction-adapter";

beforeEach(() => {
  vi.resetAllMocks();
  reads.auction.mockResolvedValue({
    supported: true,
    configurationMatchesManifest: true,
    observedBlock: 30_000n,
    startBlock: 100n,
    endBlock: 200n,
    claimBlock: 201n,
    finalized: true,
    graduated: true,
    tokensCleared: 4_000n * 10n ** 18n,
    currencyRaised: 20n * 10n ** 18n,
    clearingPriceQ96: (1n << 96n) / 200n,
  });
  reads.readiness.mockResolvedValue({
    supported: true,
    observedBlock: 30_000n,
    marketOpen: true,
  });
  reads.escrow.mockRejectedValue(
    new Error("InvalidConfiguration: zero beneficiary"),
  );
  reads.block.mockResolvedValue({ timestamp: 1_800_000_000n });
  reads.logs.mockResolvedValue([
    {
      args: {
        id: 0n,
        owner: "0x0000000000000000000000000000000000000001",
        amount: 20n * 10n ** 18n,
      },
    },
  ]);
});

describe("public auction results", () => {
  it("loads real results without asking contracts for a disconnected bidder", async () => {
    const result = await auctionAdapter.read(
      zeroAddress,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      finalized: true,
      marketOpen: true,
      currencyCommitted: 20n * 10n ** 18n,
      bids: [],
    });
    expect(reads.escrow).not.toHaveBeenCalled();
    expect(reads.balance).not.toHaveBeenCalled();
    expect(reads.contract).not.toHaveBeenCalled();
    expect(reads.bid).not.toHaveBeenCalled();
    expect(reads.logs).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        fromBlock: 100n,
        toBlock: 200n,
        event: expect.objectContaining({ name: "BidSubmitted" }),
      }),
    );
  });

  it("stops an ongoing auction history at the observed block", async () => {
    const ended = await reads.auction();
    reads.auction.mockResolvedValue({ ...ended, observedBlock: 150n });
    await auctionAdapter.read(zeroAddress, new AbortController().signal);
    expect(reads.logs).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fromBlock: 100n, toBlock: 150n }),
    );
  });
});
