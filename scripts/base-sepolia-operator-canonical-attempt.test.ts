import { readFileSync } from "node:fs";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import {
  DEFAULT_POL_BUDGET_POLICY,
  planWethOnlyPolCycle,
} from "@orbit/protocol/pol-planner";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { Address, Hex } from "viem";

import {
  createViemOperatorChain,
  type OperatorBlockIdentity,
  type OperatorState,
} from "./base-sepolia-operator.ts";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/84532.json", "utf8")) as unknown,
);
const contracts = createProtocolContracts(manifest);
const keeper = getAddress(manifest.roles.keeper);
const liquidityExecutor = getAddress(manifest.roles.liquidityExecutor);
const hash = (character: string): Hex => `0x${character.repeat(64)}` as Hex;
const planningBlock: OperatorBlockIdentity = {
  number: 400n,
  hash: hash("a"),
  timestamp: 1_800_000_000n,
};
const preflightBlock: OperatorBlockIdentity = {
  number: 405n,
  hash: hash("b"),
  timestamp: 1_800_000_005n,
};

const routes = {
  1: {
    stockToken: contracts.mockAaplc.address,
    adapter: contracts.aaplcConversionAdapter.address,
  },
  2: {
    stockToken: contracts.mockGooglc.address,
    adapter: contracts.googlcConversionAdapter.address,
  },
  3: {
    stockToken: contracts.mockMetac.address,
    adapter: contracts.metacConversionAdapter.address,
  },
  4: {
    stockToken: contracts.mockNvdac.address,
    adapter: contracts.nvdacConversionAdapter.address,
  },
} as const;

const stateAt = (
  block: OperatorBlockIdentity,
  overrides: Partial<OperatorState> = {},
): OperatorState => ({
  block,
  keeper,
  liquidityExecutor,
  converterConfigurationSealed: true,
  converterPaused: false,
  rewardEpochCount: 1n,
  lastRewardEpochAt: block.timestamp,
  rewardPotWeth: 0n,
  trackQueues: { 1: 1_000n, 2: 0n, 3: 0n, 4: 0n },
  trackConfigurations: routes,
  liquidityConfigurationSealed: true,
  liquidityPaused: false,
  liquidityPotWeth: 0n,
  queuedLiquidityWeth: 0n,
  currentTick: 123,
  ...overrides,
});

interface ReadRequest {
  readonly args?: readonly unknown[];
  readonly blockNumber?: bigint;
  readonly functionName: string;
}

const canonicalAttemptHarness = (input: {
  readonly planning?: OperatorState;
  readonly preflight?: OperatorState;
  readonly postSimulationBlock?: OperatorBlockIdentity;
  readonly postQuotePlanningBlock?: OperatorBlockIdentity;
  readonly postPreflightPlanningBlock?: OperatorBlockIdentity;
  readonly postSimulationPlanningBlock?: OperatorBlockIdentity;
  readonly simulationFailure?: string;
  readonly simulationResult?: bigint;
}) => {
  const planning = input.planning ?? stateAt(planningBlock);
  const preflight = input.preflight ?? stateAt(preflightBlock);
  const blockRequests: Array<bigint | "latest"> = [];
  const readBlocks: Array<bigint | undefined> = [];
  const simulations: Array<{
    readonly functionName: string;
    readonly blockNumber?: bigint;
  }> = [];
  let quoteLeg = 0;
  let preflightCanonicalReads = 0;
  let planningCanonicalReads = 0;
  let signed = 0;
  const planningCanonicalHeader = (): OperatorBlockIdentity => {
    planningCanonicalReads += 1;
    if (planningCanonicalReads === 1) return planning.block;
    if (planningCanonicalReads === 2) {
      return input.postQuotePlanningBlock ?? planning.block;
    }
    if (planningCanonicalReads === 3) {
      return (
        input.postPreflightPlanningBlock ??
        input.postQuotePlanningBlock ??
        planning.block
      );
    }
    return (
      input.postSimulationPlanningBlock ??
      input.postPreflightPlanningBlock ??
      input.postQuotePlanningBlock ??
      planning.block
    );
  };
  const preflightCanonicalHeader = (): OperatorBlockIdentity => {
    preflightCanonicalReads += 1;
    return preflightCanonicalReads === 1
      ? preflight.block
      : (input.postSimulationBlock ?? preflight.block);
  };
  const values = new Map<string, unknown>([
    ["keeper", preflight.keeper],
    ["executor", preflight.liquidityExecutor],
    ["configurationSealed", true],
    ["paused", false],
    ["rewardEpochCount", preflight.rewardEpochCount],
    ["lastRewardEpochAt", preflight.lastRewardEpochAt],
    ["rewardPot", preflight.rewardPotWeth],
    ["liquidityPot", preflight.liquidityPotWeth],
    ["queuedWeth", preflight.queuedLiquidityWeth],
  ]);
  const clients = {
    publicClient: {
      getChainId: async () => 84_532,
      getBlock: async (request: { readonly blockNumber?: bigint } = {}) => {
        blockRequests.push(request.blockNumber ?? "latest");
        if (request.blockNumber === planning.block.number) {
          return planningCanonicalHeader();
        }
        if (request.blockNumber === undefined) return preflight.block;
        if (request.blockNumber === preflight.block.number) {
          return preflightCanonicalHeader();
        }
        throw new Error(`Unexpected block ${String(request.blockNumber)}`);
      },
      readContract: async (request: ReadRequest) => {
        readBlocks.push(request.blockNumber);
        if (request.functionName === "extsload") {
          return BigInt(preflight.currentTick) << 160n;
        }
        if (request.functionName === "trackQueue") {
          return preflight.trackQueues[request.args?.[0] as 1 | 2 | 3 | 4];
        }
        if (request.functionName === "trackConfiguration") {
          const route =
            preflight.trackConfigurations[request.args?.[0] as 1 | 2 | 3 | 4];
          return [route.stockToken, route.adapter];
        }
        const value = values.get(request.functionName);
        if (value === undefined) {
          throw new Error(`Unexpected read ${request.functionName}`);
        }
        return value;
      },
      simulateContract: async (request: {
        readonly account?: Address;
        readonly blockNumber?: bigint;
        readonly functionName: string;
      }) => {
        simulations.push({
          functionName: request.functionName,
          ...(request.blockNumber === undefined
            ? {}
            : { blockNumber: request.blockNumber }),
        });
        if (request.functionName === "quoteExactInput") {
          quoteLeg += 1;
          return { result: quoteLeg === 1 ? 2_000n : 1_000n };
        }
        if (request.functionName === "executeTrack") {
          if (input.simulationFailure !== undefined) {
            throw new Error(input.simulationFailure);
          }
          return {
            result: 1_000n,
            request: { account: request.account },
          };
        }
        if (request.functionName === "openRewardEpoch") {
          return { result: 40_000_000_000_000_000n, request };
        }
        if (request.functionName === "addLiquidityCycle") {
          return { result: input.simulationResult, request };
        }
        throw new Error(`Unexpected simulation ${request.functionName}`);
      },
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: preflight.block.number + 1n,
      }),
    },
    roles: {
      keeper: {
        account: { address: keeper },
        walletClient: {
          writeContract: async () => {
            signed += 1;
            return hash("c");
          },
        },
      },
      "liquidity-executor": {
        account: { address: liquidityExecutor },
        walletClient: {
          writeContract: async () => {
            signed += 1;
            return hash("d");
          },
        },
      },
    },
  } as unknown as Parameters<typeof createViemOperatorChain>[0]["clients"];
  return {
    blockRequests,
    chain: createViemOperatorChain({ clients, contracts, manifest }),
    planning,
    readBlocks,
    get signed() {
      return signed;
    },
    simulations,
  };
};

describe("Base Sepolia canonical planning and preflight", () => {
  it("simulates an eligible Reward Epoch at an explicit preflight identity", async () => {
    const planning = stateAt(planningBlock, {
      rewardEpochCount: 1n,
      lastRewardEpochAt: planningBlock.timestamp - 100n,
      rewardPotWeth: 40_000_000_000_000_000n,
    });
    const preflight = stateAt(preflightBlock, {
      rewardEpochCount: 1n,
      lastRewardEpochAt: planningBlock.timestamp - 100n,
      rewardPotWeth: 40_000_000_000_000_000n,
    });
    const harness = canonicalAttemptHarness({ planning, preflight });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: false,
        planningState: planning,
        intent: { kind: "reward-epoch" },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => {
          throw new Error("Dry run must not submit");
        },
      },
    );

    expect(evidence).toMatchObject({
      kind: "reward-epoch",
      status: "simulated",
      planningBlock,
      preflightBlock,
    });
    expect(harness.simulations).toEqual([
      { functionName: "openRewardEpoch", blockNumber: preflightBlock.number },
    ]);
    expect(harness.signed).toBe(0);
  });

  it("pins both quote legs to planning and simulation to a separately recorded preflight", async () => {
    const harness = canonicalAttemptHarness({});

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: false,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => {
          throw new Error("Dry run must not submit");
        },
      },
    );

    expect(evidence).toMatchObject({
      kind: "reward-track-or-retry",
      track: 1,
      status: "simulated",
      quotedOutput: 1_000n,
      minimumOutput: 990n,
      planningBlock,
      quoteBlock: planningBlock,
      preflightBlock,
    });
    expect(harness.simulations).toEqual([
      { functionName: "quoteExactInput", blockNumber: planningBlock.number },
      { functionName: "quoteExactInput", blockNumber: planningBlock.number },
      { functionName: "executeTrack", blockNumber: preflightBlock.number },
    ]);
    expect(harness.readBlocks).toEqual(
      Array.from({ length: 20 }, () => preflightBlock.number),
    );
    expect(harness.blockRequests).toEqual([
      planningBlock.number,
      planningBlock.number,
      "latest",
      preflightBlock.number,
      planningBlock.number,
      planningBlock.number,
      preflightBlock.number,
    ]);
  });

  it("rejects a preflight RPC head that regresses behind planning", async () => {
    const regressedPreflightBlock: OperatorBlockIdentity = {
      number: planningBlock.number - 1n,
      hash: hash("9"),
      timestamp: planningBlock.timestamp - 1n,
    };
    const harness = canonicalAttemptHarness({
      preflight: stateAt(regressedPreflightBlock),
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      reason: `Operator RPC remained behind confirmed block ${planningBlock.number}`,
      failureClass: "preflight-rejected",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
    });
    expect(evidence.preflightBlock).toBeUndefined();
    expect(
      harness.simulations.filter(
        ({ functionName }) => functionName === "executeTrack",
      ),
    ).toHaveLength(0);
    expect(harness.signed).toBe(0);
  });

  it("revalidates a Protocol-Owned Liquidity plan at a separately pinned preflight", async () => {
    const availableWeth = 51_969_758_100_000_000n;
    const planning = stateAt(planningBlock, {
      queuedLiquidityWeth: availableWeth,
      currentTick: -51_601,
    });
    const preflight = stateAt(preflightBlock, {
      queuedLiquidityWeth: availableWeth,
      currentTick: -51_601,
    });
    const plan = planWethOnlyPolCycle({
      currentTick: planning.currentTick,
      tickSpacing: manifest.canonicalPool.tickSpacing,
      wethIsCurrency0:
        getAddress(manifest.canonicalPool.currency0) ===
        getAddress(manifest.contracts.weth!),
      availableWeth,
      currentTimestamp: planning.block.timestamp,
      policy: DEFAULT_POL_BUDGET_POLICY,
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") throw new Error("Expected a ready plan");
    const harness = canonicalAttemptHarness({
      planning,
      preflight,
      simulationResult: plan.expectedConsumptionWeth,
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: false,
        planningState: planning,
        intent: { kind: "protocol-liquidity", plan },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => {
          throw new Error("Dry run must not submit");
        },
      },
    );

    expect(harness.simulations, evidence.reason).toEqual([
      {
        functionName: "addLiquidityCycle",
        blockNumber: preflightBlock.number,
      },
    ]);
    expect(evidence.status, evidence.reason).toBe("simulated");
    expect(evidence).toMatchObject({
      kind: "protocol-liquidity",
      status: "simulated",
      planningBlock,
      preflightBlock,
      liquidityPlan: plan,
      simulatedConsumptionWeth: plan.expectedConsumptionWeth,
    });
    expect(harness.signed).toBe(0);
  });

  it("fails closed before signing when the simulated preflight block is reorged", async () => {
    const harness = canonicalAttemptHarness({
      postSimulationBlock: {
        ...preflightBlock,
        hash: hash("e"),
      },
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "preflight-rejected",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
      preflightBlock,
    });
    expect(evidence.reason).toContain("changed canonical identity");
    expect(harness.signed).toBe(0);
  });

  it("rejects both quote legs when the planning height changes identity", async () => {
    const harness = canonicalAttemptHarness({
      postQuotePlanningBlock: {
        ...planningBlock,
        hash: hash("f"),
      },
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "quote-unavailable",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
    });
    expect(evidence.preflightBlock).toBeUndefined();
    expect(harness.simulations).toEqual([
      { functionName: "quoteExactInput", blockNumber: planningBlock.number },
      { functionName: "quoteExactInput", blockNumber: planningBlock.number },
    ]);
    expect(harness.signed).toBe(0);
  });

  it("abandons a quote when planning is reorged during preflight acquisition", async () => {
    const harness = canonicalAttemptHarness({
      postPreflightPlanningBlock: {
        ...planningBlock,
        hash: hash("7"),
      },
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "preflight-rejected",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
      preflightBlock,
    });
    expect(evidence.reason).toContain("changed canonical identity");
    expect(
      harness.simulations.filter(
        ({ functionName }) => functionName === "executeTrack",
      ),
    ).toHaveLength(0);
    expect(harness.signed).toBe(0);
  });

  it("fails the signing boundary when planning is reorged after simulation", async () => {
    const harness = canonicalAttemptHarness({
      postSimulationPlanningBlock: {
        ...planningBlock,
        hash: hash("8"),
      },
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "preflight-rejected",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
      preflightBlock,
    });
    expect(evidence.reason).toContain("changed canonical identity");
    expect(harness.simulations).toContainEqual({
      functionName: "executeTrack",
      blockNumber: preflightBlock.number,
    });
    expect(harness.signed).toBe(0);
  });

  it.each([
    [
      "Keeper role",
      stateAt(preflightBlock, {
        keeper: "0x0000000000000000000000000000000000000099" as Address,
      }),
      "Keeper role changed",
    ],
    [
      "sealed route",
      stateAt(preflightBlock, {
        trackConfigurations: {
          ...routes,
          1: {
            ...routes[1],
            adapter: "0x0000000000000000000000000000000000000098" as Address,
          },
        },
      }),
      "sealed route changed",
    ],
    [
      "call request",
      stateAt(preflightBlock, {
        trackQueues: { 1: 2_000n, 2: 0n, 3: 0n, 4: 0n },
      }),
      "call request changed",
    ],
  ] as const)(
    "abandons the action when the preflight %s drifts",
    async (_case, preflight, reason) => {
      const harness = canonicalAttemptHarness({ preflight });

      const evidence = await harness.chain.attempt(
        {
          actors: { keeper, "liquidity-executor": liquidityExecutor },
          execute: true,
          planningState: harness.planning,
          intent: {
            kind: "reward-track-or-retry",
            track: 1,
            wethInput: 1_000n,
            minimumOutputBps: 9_900,
            deadline: planningBlock.timestamp + 300n,
          },
        },
        {
          beforeAttempt: async () => undefined,
          submitted: async () => undefined,
        },
      );

      expect(evidence).toMatchObject({
        status: "failed",
        failureClass: "preflight-rejected",
        replanRequired: true,
        planningBlock,
        quoteBlock: planningBlock,
        preflightBlock,
      });
      expect(evidence.reason).toContain(reason);
      expect(harness.signed).toBe(0);
      expect(
        harness.simulations.filter(
          ({ functionName }) => functionName === "executeTrack",
        ),
      ).toHaveLength(0);
    },
  );

  it("fails closed when quote drift makes the pinned preflight simulation fail", async () => {
    const harness = canonicalAttemptHarness({
      simulationFailure: "SlippageExceeded(990, 900)",
    });

    const evidence = await harness.chain.attempt(
      {
        actors: { keeper, "liquidity-executor": liquidityExecutor },
        execute: true,
        planningState: harness.planning,
        intent: {
          kind: "reward-track-or-retry",
          track: 1,
          wethInput: 1_000n,
          minimumOutputBps: 9_900,
          deadline: planningBlock.timestamp + 300n,
        },
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence).toMatchObject({
      status: "failed",
      reason: "SlippageExceeded(990, 900)",
      failureClass: "preflight-rejected",
      replanRequired: true,
      planningBlock,
      quoteBlock: planningBlock,
      preflightBlock,
    });
    expect(harness.signed).toBe(0);
  });
});
