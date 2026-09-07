import type { Page } from "playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  toHex,
  toFunctionSelector,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import { protocolDeploymentManifests } from "../src/generated/deployment-manifests.ts";
import { historyFixtureResponse } from "./fixtures.ts";

const manifest = protocolDeploymentManifests.staging;
const contracts = createProtocolContracts(manifest);
export const COLLECTOR_WALLET = "0x2000000000000000000000000000000000000002";
export const COLLECTOR_HASH = `0x${"d".repeat(64)}` as Hex;
export const COLLECTOR_VRF_REQUEST = 10n ** 76n + 42n;
const HASH = `0x${"a".repeat(64)}`;
const unit = 10n ** 18n;
type RpcCall = { id: number; method: string; params?: unknown[] };

/** Test-only chain state, read through real ABI/RPC and history transports. */
export class CollectorFixture {
  permanent = false;
  delivered = true;
  pending = false;
  funded = true;
  fundingPending = false;
  fundingRequests = 0;
  fundingFailures = 0;
  indexed = false;
  partialRewards = false;
  rewardsClaimed = false;
  rejectNextSubmission = false;
  allowance = 100n * unit;
  receiptAvailable = false;
  receiptFailures = 0;
  holdNextQuote = false;
  quoteRateLimits = 0;
  quoteRequests = 0;
  quoteAborts = 0;
  submissions: { data: Hex; to: Hex }[] = [];
  rpcRequests = 0;
  readonly methods: string[] = [];
  readonly unsupported = new Set<string>();
  blockNumber = BigInt(manifest.launch.blockNumber) + 100n;
  readonly timestamp = BigInt(Math.floor(Date.now() / 1000));
  readonly identityIds = [42];

  confirm() {
    this.permanent = true;
    this.receiptAvailable = true;
    this.blockNumber += 1n;
  }
  block() {
    return {
      hash: HASH,
      number: toHex(this.blockNumber),
      timestamp: toHex(this.timestamp),
      transactions: [],
      gasLimit: toHex(30_000_000),
      gasUsed: "0x0",
      baseFeePerGas: "0x1",
    };
  }

  // ABI dispatch stays explicit so unsupported reads fail visibly.
  // eslint-disable-next-line complexity
  value(contract: string, fn: string, args: readonly unknown[]): unknown {
    const mine =
      String(args[0]).toLowerCase() === COLLECTOR_WALLET.toLowerCase();
    if (fn === "balanceOf") {
      if (!mine) return contract === "fuelCore" ? 4000n * unit : 0n;
      if (contract === "fuelCore")
        return this.permanent ? 0n : this.delivered || this.pending ? unit : 0n;
      if (contract === "weth") return this.funded ? 5n * unit : 0n;
      if (contract === "fuelMirror")
        return this.delivered ? BigInt(this.identityIds.length) : 0n;
      return 0n;
    }
    if (fn === "transientCount")
      return this.delivered && !this.permanent
        ? BigInt(this.identityIds.length)
        : 0n;
    if (fn === "pendingDiscoveryCount") return this.pending ? 1n : 0n;
    if (fn === "pendingDiscoveryAt") return COLLECTOR_HASH;
    if (fn === "vrfRequestForProtocolRequest") return COLLECTOR_VRF_REQUEST;
    if (fn === "requestSequence") return 1n;
    if (fn === "isDelayed") return true;
    if (fn === "requestStatus")
      return [1, this.timestamp - 3600n, 0n, 1n, 0n, true];
    if (fn === "transientIdentityAt")
      return BigInt(this.identityIds[Number(args[1])]!);
    if (fn === "ownerOf") return COLLECTOR_WALLET;
    if (fn === "isPermanentIdentity" || fn === "isActive")
      return this.permanent;
    if (fn === "attributeOf") {
      const e = collectionManifestArtifact.entries[Number(args[0]) - 1]!;
      return [e.track, e.tier, e.weight, e.collectibleKind];
    }
    if (fn === "pendingAll") {
      if (!this.partialRewards || this.rewardsClaimed) return [0n, 0n, 0n, 0n];
      if (Number(args[0]) === 45)
        throw new Error("Reward read temporarily unavailable for #45");
      return Number(args[0]) === 42
        ? [0n, 0n, 0n, 2n * unit]
        : [0n, 0n, 3n * unit, 0n];
    }
    if (fn === "allowance") return this.allowance;
    if (fn === "isDiscoveryExempt") return !mine;
    if (fn === "quoteExactInput")
      return [
        BigInt(args[1] as bigint) * 100n,
        (BigInt(args[1] as bigint) * 3n) / 100n,
      ];
    if (fn === "totalSupply")
      return (
        (4444n - (this.permanent ? BigInt(this.identityIds.length) : 0n)) * unit
      );
    if (fn === "permanentCount")
      return this.permanent ? this.identityIds.length : 0;
    if (fn === "totalTransientCount")
      return this.delivered && !this.permanent ? this.identityIds.length : 0;
    if (fn === "totalPendingDiscoveryCount") return this.pending ? 1n : 0n;
    if (fn === "availableIdentityCount")
      return (
        4444 - (this.delivered ? this.identityIds.length : this.pending ? 1 : 0)
      );
    if (
      [
        "launched",
        "seeded",
        "registered",
        "isSealed",
        "configurationSealed",
        "isClaimAllowed",
      ].includes(fn)
    )
      return true;
    if (["paused", "rewardNotificationsPaused", "isFrozen"].includes(fn))
      return false;
    if (fn === "TOTAL_FEE_BPS") return 300n;
    if (fn === "manifestCommitment") return manifest.identity.manifestHash;
    if (fn === "poolId") return manifest.canonicalPool.poolId;
    const stocks = [
      "mockAaplc",
      "mockGooglc",
      "mockMetac",
      "mockNvdac",
    ] as const;
    const adapters = [
      "aaplcConversionAdapter",
      "googlcConversionAdapter",
      "metacConversionAdapter",
      "nvdacConversionAdapter",
    ] as const;
    const index = Math.max(
      0,
      adapters.indexOf(contract as (typeof adapters)[number]),
    );
    if (fn === "rewardToken")
      return manifest.contracts[stocks[Number(args[0]) - 1]!];
    if (fn === "trackConfiguration")
      return [
        manifest.contracts[stocks[Number(args[0]) - 1]!],
        manifest.contracts[adapters[Number(args[0]) - 1]!],
      ];
    if (fn === "configuredTrack") return index + 1;
    if (fn === "stockToken") return manifest.contracts[stocks[index]!];
    if (fn === "venue") return manifest.contracts.testConversionVenue;
    if (fn === "wethUsdcPoolId")
      return manifest.conversionPools.wethUsdc?.poolId;
    if (fn === "usdcStockPoolId")
      return manifest.conversionPools[
        ["aaplc", "googlc", "metac", "nvdac"][index] as "aaplc"
      ].poolId;
    if (fn === "executor") return manifest.roles.liquidityExecutor;
    if (fn === "isBlockedVenueCodehash") return true;
    if (fn === "extsload") return toHex(2n ** 96n, { size: 32 });
    if (fn === "pendingOwner") return zeroAddress;
    if (fn in manifest.roles)
      return manifest.roles[fn as keyof typeof manifest.roles];
    const bindings: Record<string, string> = {
      core: "fuelCore",
      fuel: "fuelCore",
      liquidToken: "fuelCore",
      manager: "uniswapV4PoolManager",
      registry: "canonicalMarketRegistry",
      converter: "epochConverter",
      hook: "canonicalFeeHook",
      router: "canonicalRouter",
      rewardDestination: "epochConverter",
      liquidityDestination: "protocolLiquidityVault",
    };
    const key = bindings[fn] ?? fn;
    if (key in manifest.contracts)
      return manifest.contracts[key as keyof typeof manifest.contracts];
    if (fn === "creatorDestination") return manifest.roles.creator;
    if (
      [
        "rewardEpochCount",
        "lastRewardEpochAt",
        "rewardPot",
        "liquidityPot",
        "creatorPot",
        "queuedWeth",
        "permanentlyLockedWeth",
        "liquidityCycleCount",
        "trackQueue",
        "totalLiability",
        "totalActiveWeight",
        "unclaimedTrackPot",
      ].includes(fn)
    )
      return 0n;
    throw new Error(`Unsupported fixture read ${contract}.${fn}`);
  }

  decodeSubmission(index = this.submissions.length - 1) {
    const submission = this.submissions[index]!;
    const contract = Object.values(contracts).find(
      (value) => value.address.toLowerCase() === submission.to.toLowerCase(),
    );
    if (contract === undefined) throw new Error("Unknown submitted contract");
    return decodeFunctionData({
      abi: contract.abi as Abi,
      data: submission.data,
    });
  }

  call(to: Hex, data: Hex): Hex {
    if (to.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11") {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      if (decoded.functionName === "getEthBalance")
        return encodeFunctionResult({
          abi: multicall3Abi,
          functionName: "getEthBalance",
          result: this.funded ? 5n * unit : 0n,
        });
      if (decoded.functionName !== "aggregate3")
        throw new Error(`Unsupported multicall ${decoded.functionName}`);
      const results = decoded.args[0].map((entry) => {
        try {
          return {
            success: true,
            returnData: this.call(entry.target, entry.callData),
          };
        } catch (error) {
          this.unsupported.add(String(error));
          return { success: false, returnData: "0x" as Hex };
        }
      });
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: results,
      });
    }
    const contract = Object.entries(contracts).find(
      ([, value]) => value.address.toLowerCase() === to.toLowerCase(),
    );
    if (!contract) throw new Error(`Unknown fixture contract ${to}`);
    const abi = contract[1].abi as Abi;
    const decoded = decodeFunctionData({ abi, data });
    if (
      ["commit", "swapExactInput", "claim", "claimMany", "approve"].includes(
        decoded.functionName,
      )
    )
      return "0x";
    const result = this.value(
      contract[0],
      decoded.functionName,
      decoded.args ?? [],
    );
    return encodeFunctionResult({
      abi,
      functionName: decoded.functionName,
      result,
    });
  }

  // Each JSON-RPC method is an independent external boundary.
  // eslint-disable-next-line complexity
  rpc(call: RpcCall): unknown {
    this.methods.push(call.method);
    const envelope = { id: call.id, jsonrpc: "2.0" };
    try {
      let result: unknown;
      if (call.method === "eth_chainId") result = toHex(manifest.chainId);
      else if (call.method === "eth_getBlockByNumber") result = this.block();
      else if (call.method === "eth_blockNumber")
        result = toHex(this.blockNumber);
      else if (call.method === "eth_getBalance")
        result = toHex(this.funded ? 5n * unit : 0n);
      else if (call.method === "eth_getCode") result = "0x01";
      else if (call.method === "eth_estimateGas") result = "0x493e0";
      else if (call.method === "eth_getTransactionByHash")
        result = {
          hash: call.params?.[0],
          from: COLLECTOR_WALLET,
          to: manifest.contracts.fuelCore,
          blockHash: this.receiptAvailable ? HASH : null,
          blockNumber: this.receiptAvailable ? toHex(this.blockNumber) : null,
          transactionIndex: "0x0",
          nonce: "0x0",
          gas: "0x493e0",
          gasPrice: "0x1",
          value: "0x0",
          input: this.submissions[0]?.data ?? "0x",
          type: "0x0",
          v: "0x1b",
          r: "0x1",
          s: "0x1",
        };
      else if (call.method === "eth_getTransactionReceipt") {
        if (this.receiptFailures-- > 0)
          throw new Error("Temporary receipt RPC failure");
        result = this.receiptAvailable
          ? {
              transactionHash: call.params?.[0],
              transactionIndex: "0x0",
              blockHash: HASH,
              blockNumber: toHex(this.blockNumber),
              from: COLLECTOR_WALLET,
              to: manifest.contracts.fuelCore,
              cumulativeGasUsed: "0x10000",
              gasUsed: "0x10000",
              effectiveGasPrice: "0x1",
              contractAddress: null,
              logs: [],
              logsBloom: `0x${"0".repeat(512)}`,
              status: "0x1",
              type: "0x2",
            }
          : null;
      } else if (call.method === "eth_call") {
        const request = call.params?.[0] as { to: Hex; data: Hex };
        result = this.call(request.to, request.data);
      } else throw new Error(`Unsupported fixture RPC ${call.method}`);
      return { ...envelope, result };
    } catch (error) {
      this.unsupported.add(String(error));
      return { ...envelope, error: { code: -32000, message: String(error) } };
    }
  }

  async install(page: Page) {
    const quoteSelector = toFunctionSelector(
      "quoteExactInput(bool,uint256)",
    ).slice(2);
    page.on("requestfailed", (request) => {
      if (request.postData()?.includes(quoteSelector)) this.quoteAborts += 1;
    });
    await page.route(
      "https://browser-matrix.invalid/transaction",
      async (route) => {
        if (this.rejectNextSubmission) {
          this.rejectNextSubmission = false;
          await route.fulfill({
            json: {
              error: {
                code: 4001,
                message: "User rejected the fixture wallet request",
              },
            },
          });
          return;
        }
        this.submissions.push(route.request().postDataJSON());
        const decoded = this.decodeSubmission();
        if (decoded.functionName === "approve" && this.receiptAvailable)
          this.allowance = BigInt(decoded.args![1] as bigint);
        const hash =
          this.submissions.length === 1
            ? COLLECTOR_HASH
            : `0x${this.submissions.length.toString(16).padStart(64, "0")}`;
        await route.fulfill({ json: { hash } });
      },
    );
    await page.route(
      (url) =>
        url.protocol.startsWith("http") &&
        /rpc|infura|alchemy|base/iu.test(url.host),
      async (route) => {
        if (route.request().method() !== "POST") return route.abort();
        this.rpcRequests += 1;
        if (route.request().postData()?.includes(quoteSelector)) {
          this.quoteRequests += 1;
          if (this.holdNextQuote) {
            this.holdNextQuote = false;
            return;
          }
          if (this.quoteRateLimits > 0) {
            this.quoteRateLimits -= 1;
            await route.fulfill({
              status: 429,
              headers: { "Retry-After": "1" },
              json: { error: { code: 429, message: "Fixture rate limit" } },
            });
            return;
          }
        }
        const calls = route.request().postDataJSON() as RpcCall | RpcCall[];
        await route.fulfill({
          json: Array.isArray(calls)
            ? calls.map((call) => this.rpc(call))
            : this.rpc(calls),
        });
      },
    );
    // Funding wire responses deliberately cover each service state in one fixture.
    // eslint-disable-next-line complexity
    await page.route("**/v1/funding/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("challenge")) {
        await route.fulfill({
          json: {
            challenge: {
              message: "Browser matrix isolated funding proof. No real assets.",
            },
          },
        });
        return;
      }
      if (pathname.endsWith("fund")) {
        this.fundingRequests += 1;
        this.fundingPending = true;
      }
      if (pathname.endsWith("status") && this.fundingFailures > 0) {
        this.fundingFailures -= 1;
        await route.fulfill({
          status: 503,
          json: { apiVersion: 1, error: { code: "funding-rpc-unavailable" } },
        });
        return;
      }
      const amount = this.funded ? String(5n * unit) : "0";
      await route.fulfill({
        json: {
          apiVersion: 1,
          observedAt: Date.now(),
          service: {
            chainId: manifest.chainId,
            state: "ready",
            targets: { ethWei: String(5n * unit), wethWei: String(5n * unit) },
          },
          recipient: {
            address: COLLECTOR_WALLET,
            state: this.funded
              ? "funded"
              : this.fundingPending
                ? "pending"
                : "eligible",
            balances: { ethWei: amount, wethWei: amount },
            remaining: {
              ethWei: this.funded ? "0" : String(5n * unit),
              wethWei: this.funded ? "0" : String(5n * unit),
            },
          },
          ...(this.fundingRequests === 0
            ? {}
            : {
                request: {
                  id: "collector-fixture-grant",
                  state: this.funded ? "funded" : "pending",
                  transactions: [
                    {
                      kind: "eth",
                      hash: COLLECTOR_HASH,
                      state: this.funded ? "confirmed" : "broadcast",
                    },
                    {
                      kind: "weth",
                      hash: COLLECTOR_HASH,
                      state: this.funded ? "confirmed" : "broadcast",
                    },
                  ],
                },
              }),
        },
      });
    });
    await page.route("**/v1/history/**", async (route) => {
      const response = historyFixtureResponse(new URL(route.request().url()));
      const json = await response.json();
      if (
        this.indexed &&
        new URL(route.request().url()).pathname.endsWith(
          "permanent-commitments",
        )
      ) {
        json.items = this.identityIds.map((identityId, index) => ({
          blockNumber: String(BigInt(manifest.launch.blockNumber) + 50n),
          blockHash: HASH,
          parentHash: HASH,
          blockTimestamp: String(this.timestamp),
          transactionHash: COLLECTOR_HASH,
          transactionIndex: 0,
          logIndex: index,
          sourceAddress: manifest.contracts.fuelCore,
          eventName: "permanent-commitment",
          removed: false,
          payload: { identityId },
        }));
      }
      await route.fulfill({ status: response.status, json });
    });
  }
}
