import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  createProtocolReader,
  ProtocolQueryError,
  type ContractReadRequest,
  type ContractReadResult,
  type ContractReadResults,
  type ProtocolReadTransport,
} from "../src/reader.js";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const identity = selectIdentityConfiguration("orbit-4444");
const owner = "0x0000000000000000000000000000000000000123" as const;
type StockContractName = "mockAaplc" | "mockGooglc" | "mockMetac" | "mockNvdac";

class StockBalanceTransport implements ProtocolReadTransport {
  chainId: number = manifest.chainId;
  block = {
    hash: `0x${"12".repeat(32)}` as const,
    number: 55_321n,
    timestamp: 1_725_000_123n,
  };
  balances = new Map<StockContractName, bigint>([
    ["mockAaplc", 123_456_789_000_000_000n],
    ["mockGooglc", 98_765_432n],
    ["mockMetac", 777_000_001n],
    ["mockNvdac", 42n],
  ]);
  decimals = new Map<StockContractName, number>([
    ["mockAaplc", 18],
    ["mockGooglc", 6],
    ["mockMetac", 8],
    ["mockNvdac", 0],
  ]);
  failures = new Set<string>();
  getBlockCalls = 0;
  readCalls: {
    requests: readonly ContractReadRequest[];
    blockNumber: bigint;
  }[] = [];

  async getChainId() {
    return this.chainId;
  }

  async getBlock() {
    this.getBlockCalls += 1;
    return this.block;
  }

  async readMany<const Requests extends readonly ContractReadRequest[]>(
    requests: Requests,
    blockNumber: bigint,
  ): Promise<ContractReadResults<Requests>> {
    this.readCalls.push({ requests, blockNumber });
    return requests.map((request): ContractReadResult => {
      const key = `${request.contract}.${request.functionName}`;
      if (this.failures.has(key)) {
        return { status: "failure", error: new Error(`${key} failed`) };
      }
      const contract = request.contract as StockContractName;
      if (request.functionName === "balanceOf") {
        return { status: "success", value: this.balances.get(contract) };
      }
      if (request.functionName === "decimals") {
        return { status: "success", value: this.decimals.get(contract) };
      }
      throw new Error(`Unexpected read ${key}`);
    }) as ContractReadResults<Requests>;
  }

  async getBytecode(): Promise<`0x${string}` | undefined> {
    throw new Error("unused");
  }

  async permanentIdentityIds(): Promise<readonly number[]> {
    throw new Error("unused");
  }

  async quoteExactInput(): Promise<readonly [bigint, bigint]> {
    throw new Error("unused");
  }

  async canonicalMarketState(): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    protocolFee: number;
    lpFee: number;
    activeLiquidity: bigint;
  }> {
    throw new Error("unused");
  }
}

const createReader = (transport: StockBalanceTransport) =>
  createProtocolReader({ manifest, identity, transport });

describe("stock balance reader", () => {
  it("reads each stock-token balance and decimals for the owner at one pinned block", async () => {
    const transport = new StockBalanceTransport();

    const snapshot = await createReader(transport).readStockBalances(owner);

    expect(snapshot).toEqual({
      owner,
      observedBlock: transport.block.number,
      observedAt: Number(transport.block.timestamp),
      balances: [
        {
          track: "AAPLc",
          trackId: 1,
          tokenAddress: manifest.contracts.mockAaplc,
          status: "observed",
          rawTokenUnits: 123_456_789_000_000_000n,
          decimals: 18,
        },
        {
          track: "GOOGLc",
          trackId: 2,
          tokenAddress: manifest.contracts.mockGooglc,
          status: "observed",
          rawTokenUnits: 98_765_432n,
          decimals: 6,
        },
        {
          track: "METAc",
          trackId: 3,
          tokenAddress: manifest.contracts.mockMetac,
          status: "observed",
          rawTokenUnits: 777_000_001n,
          decimals: 8,
        },
        {
          track: "NVDAc",
          trackId: 4,
          tokenAddress: manifest.contracts.mockNvdac,
          status: "observed",
          rawTokenUnits: 42n,
          decimals: 0,
        },
      ],
    });
    expect(transport.getBlockCalls).toBe(1);
    expect(transport.readCalls).toHaveLength(1);
    expect(transport.readCalls[0]?.blockNumber).toBe(transport.block.number);
    expect(transport.readCalls[0]?.requests).toHaveLength(8);
    expect(
      transport.readCalls[0]?.requests
        .filter((request) => request.functionName === "balanceOf")
        .map((request) => request.args?.[0]),
    ).toEqual([owner, owner, owner, owner]);
  });

  it("reports a successful zero balance as observed", async () => {
    const transport = new StockBalanceTransport();
    transport.balances.set("mockAaplc", 0n);

    const snapshot = await createReader(transport).readStockBalances(owner);

    expect(snapshot.balances[0]).toMatchObject({
      status: "observed",
      rawTokenUnits: 0n,
      decimals: 18,
    });
  });

  it("keeps failed balance or decimals reads unavailable with stable track metadata", async () => {
    const transport = new StockBalanceTransport();
    transport.failures.add("mockGooglc.balanceOf");
    transport.failures.add("mockMetac.decimals");

    const snapshot = await createReader(transport).readStockBalances(owner);

    expect(snapshot.balances[0]?.status).toBe("observed");
    expect(snapshot.balances[1]).toEqual({
      track: "GOOGLc",
      trackId: 2,
      tokenAddress: manifest.contracts.mockGooglc,
      status: "unavailable",
      rawTokenUnits: undefined,
      decimals: undefined,
    });
    expect(snapshot.balances[2]).toEqual({
      track: "METAc",
      trackId: 3,
      tokenAddress: manifest.contracts.mockMetac,
      status: "unavailable",
      rawTokenUnits: undefined,
      decimals: undefined,
    });
    expect(snapshot.balances[3]?.status).toBe("observed");
  });

  it("rejects the read before observing a block on the wrong chain", async () => {
    const transport = new StockBalanceTransport();
    transport.chainId = 1;

    await expect(
      createReader(transport).readStockBalances(owner),
    ).rejects.toBeInstanceOf(ProtocolQueryError);
    expect(transport.getBlockCalls).toBe(0);
    expect(transport.readCalls).toHaveLength(0);
  });
});
