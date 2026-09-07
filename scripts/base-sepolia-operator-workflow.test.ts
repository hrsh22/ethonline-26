import { readFileSync } from "node:fs";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { DEFAULT_POL_BUDGET_POLICY } from "@orbit/protocol/pol-planner";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { Hex } from "viem";

import {
  runOperatorWorkflow,
  type OperatorActionEvidence,
  type OperatorActionIntent,
  type OperatorChain,
  type OperatorEnvironment,
  type OperatorSubmissionResolution,
  type OperatorState,
} from "./base-sepolia-operator.ts";
import type {
  KeeperAttemptRecorder,
  KeeperRunCompletedMilestone,
} from "./keeper-attempt-client.ts";
import type {
  KeeperAttemptOutbox,
  PendingKeeperAttemptDelivery,
} from "./keeper-attempt-outbox.ts";

const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("deployments/84532.json", "utf8")) as unknown,
);
const keeper = getAddress(manifest.roles.keeper);
const liquidityExecutor = getAddress(manifest.roles.liquidityExecutor);
const transactionHash = `0x${"ab".repeat(32)}` as Hex;
const runId = "issue-61-track-only-confirmed";
const readyPolWeth = 51_969_758_100_000_000n;
const transactionHashFor = (pair: string): Hex => `0x${pair.repeat(32)}` as Hex;
const blockHash = (number: bigint): Hex =>
  `0x${number.toString(16).padStart(64, "0")}` as Hex;
const blockIdentity = (number: bigint, timestamp: bigint) => ({
  number,
  hash: blockHash(number),
  timestamp,
});
const unresolvedDelivery = (
  hash: Hex,
  attemptId = "prior-run:reward-track-1",
): PendingKeeperAttemptDelivery => ({
  runStarted: {
    type: "run-started",
    runId: "prior-run",
    observedBlock: 700n,
    observedAt: 1_799_999_700n,
  },
  attempt: {
    type: "attempt-observed",
    attemptId,
    runId: "prior-run",
    actionKind: "reward-track",
    track: 1,
    observedBlock: 700n,
    observedAt: 1_799_999_700n,
    outcome: "pending",
    transactionHash: hash,
  },
});
const trackConfigurations = {
  1: {
    stockToken: getAddress(manifest.contracts.mockAaplc!),
    adapter: getAddress(manifest.contracts.aaplcConversionAdapter!),
  },
  2: {
    stockToken: getAddress(manifest.contracts.mockGooglc!),
    adapter: getAddress(manifest.contracts.googlcConversionAdapter!),
  },
  3: {
    stockToken: getAddress(manifest.contracts.mockMetac!),
    adapter: getAddress(manifest.contracts.metacConversionAdapter!),
  },
  4: {
    stockToken: getAddress(manifest.contracts.mockNvdac!),
    adapter: getAddress(manifest.contracts.nvdacConversionAdapter!),
  },
} as const;

const environment = {
  rpcUrl: "https://base-sepolia.example",
  manifestPath: "deployments/84532.json",
  evidencePath: ".scratch/base-sepolia-operator.json",
  execute: true,
  minimumOutputBps: 9_900,
  polPolicy: DEFAULT_POL_BUDGET_POLICY,
  polStaleQueueSeconds: 900n,
  keeperPrivateKey: undefined,
  liquidityExecutorPrivateKey: undefined,
  historyIndexUrl: "http://127.0.0.1:8787",
  historyIngestApiToken: undefined,
  keeperAttemptOutboxPath: ".data/operator-attempts.sqlite",
} satisfies OperatorEnvironment;

type OperatorStateOverrides = Omit<Partial<OperatorState>, "block"> & {
  readonly block?: OperatorState["block"];
  readonly observedBlock?: bigint;
  readonly currentTimestamp?: bigint;
};

const operatorState = (
  overrides: OperatorStateOverrides = {},
): OperatorState => {
  const {
    observedBlock = 200n,
    currentTimestamp = 1_800_000_000n,
    block,
    ...stateOverrides
  } = overrides;
  return {
    block: block ?? {
      number: observedBlock,
      hash: blockHash(observedBlock),
      timestamp: currentTimestamp,
    },
    keeper,
    liquidityExecutor,
    converterConfigurationSealed: true,
    converterPaused: false,
    rewardEpochCount: 1n,
    lastRewardEpochAt: 1_800_000_000n,
    rewardPotWeth: 0n,
    trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
    trackConfigurations,
    liquidityConfigurationSealed: true,
    liquidityPaused: false,
    liquidityPotWeth: 0n,
    queuedLiquidityWeth: 0n,
    currentTick: 0,
    ...stateOverrides,
  };
};

interface ScriptedObservation {
  readonly minimumBlock?: bigint | undefined;
  readonly state: OperatorState;
}

interface ScriptedAttempt {
  readonly evidence:
    | OperatorActionEvidence
    | ((intent: OperatorActionIntent) => OperatorActionEvidence);
  readonly submittedHash?: Hex;
}

const actionLabel = (intent: OperatorActionIntent): string => {
  if (intent.kind === "reward-epoch") return "epoch";
  if (intent.kind === "protocol-liquidity") return "pol";
  return `track-${intent.track}`;
};

const scriptedWorkflow = (input: {
  readonly observations: readonly ScriptedObservation[];
  readonly attempts: readonly ScriptedAttempt[];
  readonly execute?: boolean;
  readonly runId?: string;
  readonly previousPolQueueObservedAt?: bigint;
  readonly unresolved?: readonly PendingKeeperAttemptDelivery[];
  readonly localSubmissions?: ReturnType<
    KeeperAttemptOutbox["localSubmissions"]
  >;
  readonly reconciliations?: readonly OperatorSubmissionResolution[];
  readonly failPendingJournal?: boolean;
  readonly failReplacementProof?: boolean;
  readonly retainedReplacementProofs?: ReturnType<
    KeeperAttemptOutbox["replacements"]
  >;
}) => {
  const observations = [...input.observations];
  const attempts = [...input.attempts];
  const execute = input.execute ?? true;
  const trace: string[] = [];
  const intents: OperatorActionIntent[] = [];
  const planningStates: OperatorState[] = [];
  const reconciliations = [...(input.reconciliations ?? [])];
  const unresolved = [...(input.unresolved ?? [])];
  const localSubmissions = [...(input.localSubmissions ?? [])];
  const reconciledBytes: Array<Hex | undefined> = [];
  const resolvedSubmissions: Array<readonly [string, Hex]> = [];
  const submittedDeliveries: Array<
    Parameters<KeeperAttemptOutbox["enqueue"]>[0]
  > = [];
  let completedRun: KeeperRunCompletedMilestone | undefined;

  const recorder: KeeperAttemptRecorder = {
    startRun: async () => undefined,
    observeAttempt: async (milestone) => {
      if (
        input.failPendingJournal === true &&
        milestone.outcome === "pending"
      ) {
        throw new Error("history ingestion unavailable after broadcast");
      }
    },
    completeRun: async (milestone) => {
      completedRun = milestone;
      trace.push(`recorder:complete:${milestone.observedBlock}`);
    },
  };
  const replacementProofs: Parameters<
    KeeperAttemptOutbox["recordReplacement"]
  >[0][] = [...(input.retainedReplacementProofs ?? [])];
  const outbox: KeeperAttemptOutbox = {
    recordReplacement: (proof) => {
      if (input.failReplacementProof)
        throw new Error("replacement proof persistence failed");
      replacementProofs.push(proof);
    },
    replacements: () => replacementProofs,
    enqueueLocalSubmission: () => undefined,
    localSubmissions: () => localSubmissions,
    resolveLocalSubmission: (hash) => {
      const index = localSubmissions.findIndex(
        (item) => item.transactionHash === hash,
      );
      if (index >= 0) localSubmissions.splice(index, 1);
    },
    enqueue: (delivery) => {
      submittedDeliveries.push(delivery);
    },
    pendingDeliveries: () => [],
    unresolved: () => unresolved,
    acknowledge: () => undefined,
    resolve: (attemptId, hash) => {
      resolvedSubmissions.push([attemptId, hash]);
      const index = unresolved.findIndex(
        ({ attempt }) =>
          attempt.attemptId === attemptId && attempt.transactionHash === hash,
      );
      if (index >= 0) unresolved.splice(index, 1);
    },
    close: () => undefined,
  };
  const chain: OperatorChain = {
    rebroadcastSubmission: async (rawTransaction) => {
      trace.push(`chain:rebroadcast:${rawTransaction}`);
      return transactionHash;
    },
    accounts: {
      keeper: { address: keeper },
      "liquidity-executor": { address: liquidityExecutor },
    },
    getChainId: async () => {
      trace.push("chain:get-chain-id");
      return 84_532;
    },
    reconcileSubmission: async (hash, rawTransaction) => {
      reconciledBytes.push(rawTransaction);
      trace.push(`chain:reconcile:${hash}`);
      const resolution = reconciliations.shift();
      if (resolution === undefined) {
        throw new Error("The workflow requested an unexpected reconciliation");
      }
      return resolution;
    },
    observe: async (request = {}) => {
      const observation = observations.shift();
      if (observation === undefined) {
        throw new Error("The workflow requested an unexpected observation");
      }
      expect(request.minimumBlock).toBe(observation.minimumBlock);
      trace.push(
        `chain:observe:${request.minimumBlock?.toString() ?? "unpinned-floor"}`,
      );
      return observation.state;
    },
    attempt: async (request, observer) => {
      const attempt = attempts.shift();
      if (attempt === undefined) {
        throw new Error(
          `The workflow requested an unexpected ${actionLabel(request.intent)} attempt`,
        );
      }
      expect(request.execute).toBe(execute);
      expect(request.actors).toEqual({
        keeper,
        "liquidity-executor": liquidityExecutor,
      });
      intents.push(request.intent);
      planningStates.push(request.planningState);
      trace.push(`chain:attempt:${actionLabel(request.intent)}`);
      await observer.beforeAttempt();
      if (attempt.submittedHash !== undefined) {
        await observer.submitted(attempt.submittedHash);
      }
      return typeof attempt.evidence === "function"
        ? attempt.evidence(request.intent)
        : attempt.evidence;
    },
  };

  return {
    trace,
    reconciledBytes,
    remainingLocalSubmissions: () => [...localSubmissions],
    intents,
    planningStates,
    submittedDeliveries,
    resolvedSubmissions,
    unresolvedSubmissions: () => [...unresolved],
    get completedRun() {
      return completedRun;
    },
    remainingObservations: () => observations.length,
    remainingAttempts: () => attempts.length,
    run: () =>
      runOperatorWorkflow(
        { ...environment, execute },
        manifest,
        input.previousPolQueueObservedAt,
        {
          chain,
          recorder,
          outbox,
          runId: input.runId ?? "scripted-operator-run",
        },
      ),
  };
};

describe("Base Sepolia operator workflow", () => {
  it("records a proven local replacement and replans at its block before any new intent", async () => {
    const replacementHash = transactionHashFor("77");
    const workflow = scriptedWorkflow({
      execute: true,
      localSubmissions: [{ transactionHash, rawTransaction: "0x0102" }],
      reconciliations: [
        { status: "replaced", blockNumber: 925n, replacementHash },
      ],
      observations: [
        { state: operatorState({ observedBlock: 930n }), minimumBlock: 925n },
        { state: operatorState({ observedBlock: 931n }), minimumBlock: 925n },
      ],
      attempts: [],
    });
    const evidence = await workflow.run();
    expect(workflow.reconciledBytes).toEqual(["0x0102"]);
    expect(workflow.remainingLocalSubmissions()).toEqual([]);
    expect(workflow.intents).toEqual([]);
    expect(evidence.replacements).toEqual([
      { transactionHash, replacementHash, blockNumber: 925n },
    ]);
    expect(
      workflow.trace.some((event) => event.startsWith("chain:rebroadcast:")),
    ).toBe(false);
  });

  it("keeps the exact local signing gate when replacement evidence cannot be persisted", async () => {
    const retained = { transactionHash, rawTransaction: "0x0102" as const };
    const workflow = scriptedWorkflow({
      execute: true,
      failReplacementProof: true,
      localSubmissions: [retained],
      reconciliations: [
        {
          status: "replaced",
          blockNumber: 925n,
          replacementHash: transactionHashFor("77"),
        },
      ],
      observations: [],
      attempts: [],
    });
    await expect(workflow.run()).rejects.toThrow(
      "replacement proof persistence failed",
    );
    expect(workflow.remainingLocalSubmissions()).toEqual([retained]);
    expect(workflow.intents).toEqual([]);
  });

  it("preserves the replacement block floor after a crash following row resolution", async () => {
    const proof = {
      transactionHash,
      replacementHash: transactionHashFor("77"),
      blockNumber: 925n,
    };
    const workflow = scriptedWorkflow({
      retainedReplacementProofs: [proof],
      observations: [
        { state: operatorState({ observedBlock: 930n }), minimumBlock: 925n },
        { state: operatorState({ observedBlock: 931n }), minimumBlock: 925n },
      ],
      attempts: [],
    });
    const evidence = await workflow.run();
    expect(workflow.reconciledBytes).toEqual([]);
    expect(evidence.replacements).toEqual([proof]);
  });

  it("does not begin Keeper work while a discovery transaction is unresolved", async () => {
    const workflow = scriptedWorkflow({
      execute: true,
      observations: [],
      attempts: [],
      localSubmissions: [{ transactionHash, rawTransaction: "0x0102" }],
      reconciliations: [
        {
          status: "submitted-unknown",
          failureClass: "receipt-unavailable",
          reason: "Discovery receipt unavailable",
        },
      ],
    });
    await expect(workflow.run()).rejects.toThrow("signing is gated");
    expect(workflow.intents).toEqual([]);
    expect(workflow.trace).toContain("chain:rebroadcast:0x0102");
  });
  it.each([true, false])(
    "recovers a prepared transaction without planning a new one, execute=%s",
    async (execute) => {
      const workflow = scriptedWorkflow({
        execute,
        observations: [],
        attempts: [],
        unresolved: [
          { ...unresolvedDelivery(transactionHash), rawTransaction: "0x0102" },
        ],
        reconciliations: [
          {
            status: "submitted-unknown",
            failureClass: "receipt-unavailable",
            reason: "Pending receipt",
          },
        ],
      });
      await expect(workflow.run()).rejects.toThrow("signing is gated");
      expect(
        workflow.trace.filter((event) =>
          event.startsWith("chain:rebroadcast:"),
        ),
      ).toEqual(execute ? ["chain:rebroadcast:0x0102"] : []);
      expect(workflow.intents).toEqual([]);
      expect(workflow.unresolvedSubmissions()).toHaveLength(1);
    },
  );
  it("aborts immediately after broadcast when pending journal delivery fails", async () => {
    const hash = transactionHashFor("cf");
    const workflow = scriptedWorkflow({
      observations: [
        {
          state: operatorState({
            observedBlock: 895n,
            currentTimestamp: 1_800_000_000n,
            lastRewardEpochAt: 1_799_999_900n,
            rewardPotWeth: 40_000_000_000_000_000n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 0n,
              3: 0n,
              4: 0n,
            },
          }),
        },
      ],
      attempts: [
        {
          submittedHash: hash,
          evidence: {
            kind: "reward-epoch",
            status: "confirmed",
            reason: "must never be returned",
            transactionHash: hash,
            blockNumber: 896n,
          },
        },
      ],
      failPendingJournal: true,
    });

    await expect(workflow.run()).rejects.toThrow(
      "history ingestion unavailable after broadcast",
    );
    expect(workflow.intents).toEqual([{ kind: "reward-epoch" }]);
    expect(workflow.submittedDeliveries).toHaveLength(1);
    expect(workflow.completedRun).toBeUndefined();
  });

  it("gates a restart before observation or signing while a submitted hash is unresolved", async () => {
    const hash = transactionHashFor("d1");
    const workflow = scriptedWorkflow({
      observations: [],
      attempts: [],
      unresolved: [unresolvedDelivery(hash)],
      reconciliations: [
        {
          status: "submitted-unknown",
          reason: "The receipt is pending.",
          failureClass: "receipt-unavailable",
        },
      ],
    });

    await expect(workflow.run()).rejects.toThrow(
      "gated by 1 unresolved submitted transaction",
    );
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      `chain:reconcile:${hash}`,
    ]);
    expect(workflow.resolvedSubmissions).toEqual([]);
    expect(workflow.completedRun).toBeUndefined();
  });

  it.each(["confirmed", "reverted"] as const)(
    "releases a canonically %s restart gate before fresh eligibility",
    async (status) => {
      const hash = transactionHashFor(status === "confirmed" ? "d2" : "d3");
      const delivery = unresolvedDelivery(hash);
      const fresh = operatorState({
        observedBlock: 930n,
        currentTimestamp: 1_800_000_030n,
        trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
      });
      const final = operatorState({
        observedBlock: 931n,
        currentTimestamp: 1_800_000_031n,
      });
      const workflow = scriptedWorkflow({
        observations: [
          { state: fresh, minimumBlock: 925n },
          { state: final, minimumBlock: 925n },
        ],
        attempts: [],
        unresolved: [delivery],
        reconciliations: [{ status, blockNumber: 925n }],
      });

      const evidence = await workflow.run();

      expect(workflow.resolvedSubmissions).toEqual([
        [delivery.attempt.attemptId, hash],
      ]);
      expect(workflow.intents).toEqual([]);
      expect(evidence.reconciliationStatus).toBe("reconciled");
      expect(workflow.trace).toEqual([
        "chain:get-chain-id",
        `chain:reconcile:${hash}`,
        "chain:observe:925",
        "chain:observe:925",
        "recorder:complete:931",
      ]);
    },
  );

  it("retains a reorged restart gate and releases the same row after canonical recovery", async () => {
    const hash = transactionHashFor("d4");
    const delivery = unresolvedDelivery(hash);
    const reorged = scriptedWorkflow({
      observations: [],
      attempts: [],
      unresolved: [delivery],
      reconciliations: [
        {
          status: "submitted-unknown",
          reason: "The receipt block hash is no longer canonical.",
          failureClass: "canonicality-uncertain",
        },
      ],
    });

    await expect(reorged.run()).rejects.toThrow("unresolved submitted");
    expect(reorged.unresolvedSubmissions()).toEqual([delivery]);

    const recovered = scriptedWorkflow({
      observations: [
        { state: operatorState({ observedBlock: 940n }), minimumBlock: 935n },
        { state: operatorState({ observedBlock: 941n }), minimumBlock: 935n },
      ],
      attempts: [],
      unresolved: reorged.unresolvedSubmissions(),
      reconciliations: [{ status: "confirmed", blockNumber: 935n }],
    });

    await expect(recovered.run()).resolves.toMatchObject({
      reconciliationStatus: "reconciled",
    });
    expect(recovered.resolvedSubmissions).toEqual([
      [delivery.attempt.attemptId, hash],
    ]);
    expect(recovered.unresolvedSubmissions()).toEqual([]);
  });

  it("stops every later signing boundary after an epoch receipt is unknown", async () => {
    const epochHash = transactionHashFor("e1");
    const initial = operatorState({
      observedBlock: 900n,
      currentTimestamp: 1_800_000_000n,
      lastRewardEpochAt: 1_799_999_900n,
      rewardPotWeth: 40_000_000_000_000_000n,
      trackQueues: {
        1: 1_000_000_000_000_000n,
        2: 2_000_000_000_000_000n,
        3: 3_000_000_000_000_000n,
        4: 4_000_000_000_000_000n,
      },
      queuedLiquidityWeth: readyPolWeth,
    });
    const workflow = scriptedWorkflow({
      observations: [
        { state: initial },
        {
          state: operatorState({
            observedBlock: 901n,
            currentTimestamp: 1_800_000_001n,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: epochHash,
          evidence: {
            kind: "reward-epoch",
            status: "submitted-unknown",
            reason: "Receipt timed out.",
            failureClass: "canonicality-uncertain",
            transactionHash: epochHash,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents).toEqual([{ kind: "reward-epoch" }]);
    expect(workflow.remainingAttempts()).toBe(0);
    expect(workflow.completedRun).toBeUndefined();
    expect(evidence).toMatchObject({
      reconciliationStatus: "submitted-unknown",
      actions: [
        expect.objectContaining({
          kind: "reward-epoch",
          status: "submitted-unknown",
          transactionHash: epochHash,
        }),
      ],
    });
  });

  it("stops later tracks and POL after a track receipt is unknown", async () => {
    const trackHash = transactionHashFor("e2");
    const workflow = scriptedWorkflow({
      observations: [
        {
          state: operatorState({
            observedBlock: 910n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 2_000_000_000_000_000n,
              3: 0n,
              4: 0n,
            },
            queuedLiquidityWeth: readyPolWeth,
          }),
        },
        {
          state: operatorState({
            observedBlock: 911n,
            currentTimestamp: 1_800_000_001n,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: trackHash,
          evidence: {
            kind: "reward-track-or-retry",
            track: 1,
            status: "submitted-unknown",
            reason: "Receipt unavailable.",
            failureClass: "receipt-unavailable",
            transactionHash: trackHash,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents).toMatchObject([
      { kind: "reward-track-or-retry", track: 1 },
    ]);
    expect(workflow.completedRun).toBeUndefined();
    expect(evidence.reconciliationStatus).toBe("submitted-unknown");
  });

  it("does not present an unknown POL receipt as a reconciled run", async () => {
    const polHash = transactionHashFor("e3");
    const workflow = scriptedWorkflow({
      observations: [
        {
          state: operatorState({
            observedBlock: 920n,
            queuedLiquidityWeth: readyPolWeth,
            currentTick: -51_601,
          }),
        },
        {
          state: operatorState({
            observedBlock: 921n,
            currentTimestamp: 1_800_000_001n,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: polHash,
          evidence: (intent) => ({
            kind: "protocol-liquidity",
            status: "submitted-unknown",
            reason: "Receipt unavailable.",
            failureClass: "receipt-unavailable",
            transactionHash: polHash,
            ...(intent.kind === "protocol-liquidity"
              ? { liquidityPlan: intent.plan }
              : {}),
          }),
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents).toMatchObject([{ kind: "protocol-liquidity" }]);
    expect(workflow.completedRun).toBeUndefined();
    expect(evidence.reconciliationStatus).toBe("submitted-unknown");
  });

  it("refreshes an invalidated plan before planning any later action", async () => {
    const workflow = scriptedWorkflow({
      observations: [
        {
          state: operatorState({
            observedBlock: 800n,
            trackQueues: { 1: 1_000n, 2: 99_000n, 3: 0n, 4: 0n },
          }),
        },
        {
          state: operatorState({
            observedBlock: 801n,
            currentTimestamp: 1_800_000_001n,
            trackQueues: { 1: 0n, 2: 2_000n, 3: 0n, 4: 0n },
          }),
        },
        {
          state: operatorState({
            observedBlock: 802n,
            currentTimestamp: 1_800_000_002n,
            trackQueues: { 1: 0n, 2: 2_000n, 3: 0n, 4: 0n },
          }),
        },
      ],
      attempts: [
        {
          evidence: {
            kind: "reward-track-or-retry",
            track: 1,
            status: "failed",
            reason: "The preflight route changed; replan required.",
            failureClass: "preflight-rejected",
            replanRequired: true,
          },
        },
        {
          evidence: {
            kind: "reward-track-or-retry",
            track: 2,
            status: "simulated",
            reason: "The replanned request simulated safely.",
          },
        },
      ],
    });

    await workflow.run();

    expect(workflow.intents).toMatchObject([
      { kind: "reward-track-or-retry", track: 1, wethInput: 1_000n },
      { kind: "reward-track-or-retry", track: 2, wethInput: 2_000n },
    ]);
    expect(workflow.planningStates.map(({ block }) => block.number)).toEqual([
      800n,
      801n,
    ]);
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-2",
      "chain:observe:unpinned-floor",
      "recorder:complete:802",
    ]);
  });

  it("refreshes immediately after a confirmed track and completes from a final pinned snapshot", async () => {
    const initialState = operatorState({
      trackQueues: {
        1: 1_000_000_000_000_000n,
        2: 0n,
        3: 0n,
        4: 0n,
      },
    });
    const refreshedState = operatorState({
      observedBlock: 205n,
      currentTimestamp: 1_800_000_005n,
      trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
    });
    const finalQueues = { 1: 11n, 2: 22n, 3: 33n, 4: 44n } as const;
    const finalState = operatorState({
      observedBlock: 210n,
      currentTimestamp: 1_800_000_010n,
      rewardPotWeth: 333n,
      trackQueues: finalQueues,
    });
    const workflow = scriptedWorkflow({
      runId,
      observations: [
        { minimumBlock: undefined, state: initialState },
        { minimumBlock: 205n, state: refreshedState },
        { minimumBlock: 205n, state: finalState },
      ],
      attempts: [
        {
          submittedHash: transactionHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "The Track 1 transaction confirmed.",
            track: 1,
            quotedOutput: 1_000n,
            minimumOutput: 990n,
            transactionHash,
            blockNumber: 205n,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.remainingObservations()).toBe(0);
    expect(workflow.remainingAttempts()).toBe(0);
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:observe:205",
      "chain:observe:205",
      "recorder:complete:210",
    ]);
    expect(
      evidence.actions.filter((action) => action.status === "confirmed"),
    ).toEqual([
      expect.objectContaining({
        kind: "reward-track-or-retry",
        track: 1,
        transactionHash,
        blockNumber: 205n,
      }),
    ]);
    expect(workflow.completedRun).toEqual({
      type: "run-completed",
      runId,
      observedBlock: 210n,
      observedAt: 1_800_000_010n,
    });
    expect(evidence).toMatchObject({
      observedBlock: 210n,
      observedAt: 1_800_000_010n,
      observedState: {
        rewardPotWeth: 333n,
        trackQueues: finalQueues,
      },
    });
  });

  it("refreshes an epoch-only confirmation before later decisions and final evidence", async () => {
    const epochHash = transactionHashFor("01");
    const workflow = scriptedWorkflow({
      runId: "issue-61-epoch-only",
      observations: [
        {
          state: operatorState({
            observedBlock: 100n,
            currentTimestamp: 1_800_000_000n,
            lastRewardEpochAt: 1_799_999_900n,
            rewardPotWeth: 40_000_000_000_000_000n,
          }),
        },
        {
          minimumBlock: 101n,
          state: operatorState({
            observedBlock: 101n,
            currentTimestamp: 1_800_000_001n,
            rewardEpochCount: 2n,
            lastRewardEpochAt: 1_800_000_001n,
            rewardPotWeth: 0n,
          }),
        },
        {
          minimumBlock: 101n,
          state: operatorState({
            observedBlock: 102n,
            currentTimestamp: 1_800_000_002n,
            rewardEpochCount: 2n,
            lastRewardEpochAt: 1_800_000_001n,
            rewardPotWeth: 7n,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: epochHash,
          evidence: {
            kind: "reward-epoch",
            status: "confirmed",
            reason: "The Reward Epoch transaction confirmed.",
            transactionHash: epochHash,
            blockNumber: 101n,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:epoch",
      "chain:observe:101",
      "chain:observe:101",
      "recorder:complete:102",
    ]);
    expect(
      evidence.actions.filter((action) => action.status === "confirmed"),
    ).toEqual([
      expect.objectContaining({
        kind: "reward-epoch",
        transactionHash: epochHash,
        blockNumber: 101n,
      }),
    ]);
    expect(workflow.completedRun).toMatchObject({
      observedBlock: 102n,
      observedAt: 1_800_000_002n,
    });
    expect(evidence).toMatchObject({
      observedBlock: 102n,
      observedAt: 1_800_000_002n,
      observedState: { rewardPotWeth: 7n },
    });
  });

  it("uses each confirmed track refresh to plan the next queued track", async () => {
    const trackOneHash = transactionHashFor("11");
    const trackTwoHash = transactionHashFor("22");
    const trackThreeHash = transactionHashFor("33");
    const finalQueues = { 1: 101n, 2: 202n, 3: 303n, 4: 404n } as const;
    const workflow = scriptedWorkflow({
      runId: "issue-61-multiple-tracks",
      observations: [
        {
          state: operatorState({
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 99_000_000_000_000_000n,
              3: 99_000_000_000_000_000n,
              4: 0n,
            },
          }),
        },
        {
          minimumBlock: 201n,
          state: operatorState({
            observedBlock: 201n,
            currentTimestamp: 1_800_000_001n,
            trackQueues: {
              1: 0n,
              2: 2_000_000_000_000_000n,
              3: 99_000_000_000_000_000n,
              4: 0n,
            },
          }),
        },
        {
          minimumBlock: 203n,
          state: operatorState({
            observedBlock: 203n,
            currentTimestamp: 1_800_000_003n,
            trackQueues: {
              1: 0n,
              2: 0n,
              3: 3_000_000_000_000_000n,
              4: 0n,
            },
          }),
        },
        {
          minimumBlock: 204n,
          state: operatorState({
            observedBlock: 204n,
            currentTimestamp: 1_800_000_004n,
            trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
          }),
        },
        {
          minimumBlock: 204n,
          state: operatorState({
            observedBlock: 205n,
            currentTimestamp: 1_800_000_005n,
            trackQueues: finalQueues,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: trackOneHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "Track 1 confirmed.",
            track: 1,
            transactionHash: trackOneHash,
            blockNumber: 201n,
          },
        },
        {
          submittedHash: trackTwoHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "Track 2 confirmed.",
            track: 2,
            transactionHash: trackTwoHash,
            blockNumber: 203n,
          },
        },
        {
          submittedHash: trackThreeHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "Track 3 confirmed.",
            track: 3,
            transactionHash: trackThreeHash,
            blockNumber: 204n,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents).toEqual([
      {
        kind: "reward-track-or-retry",
        track: 1,
        wethInput: 1_000_000_000_000_000n,
        minimumOutputBps: 9_900,
        deadline: 1_800_000_300n,
      },
      {
        kind: "reward-track-or-retry",
        track: 2,
        wethInput: 2_000_000_000_000_000n,
        minimumOutputBps: 9_900,
        deadline: 1_800_000_301n,
      },
      {
        kind: "reward-track-or-retry",
        track: 3,
        wethInput: 3_000_000_000_000_000n,
        minimumOutputBps: 9_900,
        deadline: 1_800_000_303n,
      },
    ]);
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:observe:201",
      "chain:attempt:track-2",
      "chain:observe:203",
      "chain:attempt:track-3",
      "chain:observe:204",
      "chain:observe:204",
      "recorder:complete:205",
    ]);
    expect(
      evidence.actions.filter((action) => action.status === "confirmed"),
    ).toHaveLength(3);
    expect(evidence).toMatchObject({
      observedBlock: 205n,
      observedAt: 1_800_000_005n,
      observedState: { trackQueues: finalQueues },
    });
  });

  it("uses the post-track snapshot for POL and reconciles both confirmations", async () => {
    const trackHash = transactionHashFor("41");
    const polHash = transactionHashFor("45");
    const workflow = scriptedWorkflow({
      runId: "issue-61-track-plus-pol",
      observations: [
        {
          state: operatorState({
            observedBlock: 400n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 0n,
              3: 0n,
              4: 0n,
            },
            queuedLiquidityWeth: DEFAULT_POL_BUDGET_POLICY.minimumQueueWeth,
            currentTick: -1,
          }),
        },
        {
          minimumBlock: 401n,
          state: operatorState({
            observedBlock: 401n,
            currentTimestamp: 1_800_000_001n,
            trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
            queuedLiquidityWeth: readyPolWeth,
            currentTick: -51_601,
          }),
        },
        {
          minimumBlock: 405n,
          state: operatorState({
            observedBlock: 405n,
            currentTimestamp: 1_800_000_005n,
            trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
            queuedLiquidityWeth: 26_969_758_100_000_000n,
            currentTick: -51_601,
          }),
        },
        {
          minimumBlock: 405n,
          state: operatorState({
            observedBlock: 406n,
            currentTimestamp: 1_800_000_006n,
            trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
            queuedLiquidityWeth: 1_969_758_100_000_000n,
            currentTick: -51_541,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: trackHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "Track 1 confirmed.",
            track: 1,
            transactionHash: trackHash,
            blockNumber: 401n,
          },
        },
        {
          submittedHash: polHash,
          evidence: (intent) => {
            if (intent.kind !== "protocol-liquidity") {
              throw new Error("Expected a Protocol-Owned Liquidity intent");
            }
            return {
              kind: "protocol-liquidity",
              status: "confirmed",
              reason: "The Protocol-Owned Liquidity transaction confirmed.",
              liquidityPlan: intent.plan,
              simulatedConsumptionWeth: intent.plan.expectedConsumptionWeth,
              transactionHash: polHash,
              blockNumber: 405n,
            };
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents[1]).toMatchObject({
      kind: "protocol-liquidity",
      plan: {
        status: "ready",
        availableWeth: readyPolWeth,
        selectedBudgetWeth: 25_000_000_000_000_000n,
      },
    });
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:observe:401",
      "chain:attempt:pol",
      "chain:observe:405",
      "chain:observe:405",
      "recorder:complete:406",
    ]);
    expect(
      evidence.actions.filter((action) => action.status === "confirmed"),
    ).toEqual([
      expect.objectContaining({ kind: "reward-track-or-retry", track: 1 }),
      expect.objectContaining({ kind: "protocol-liquidity" }),
    ]);
    expect(evidence).toMatchObject({
      observedBlock: 406n,
      observedAt: 1_800_000_006n,
      observedState: {
        protocolOwnedLiquidity: {
          queuedWeth: 1_969_758_100_000_000n,
          currentTick: -51_541,
        },
      },
    });
  });

  it("continues safe later work after a pre-submission failure and still refreshes finally", async () => {
    const trackTwoHash = transactionHashFor("52");
    const finalQueues = { 1: 5n, 2: 6n, 3: 7n, 4: 8n } as const;
    const workflow = scriptedWorkflow({
      runId: "issue-61-partial-failure",
      observations: [
        {
          state: operatorState({
            observedBlock: 500n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 2_000_000_000_000_000n,
              3: 0n,
              4: 0n,
            },
          }),
        },
        {
          minimumBlock: 505n,
          state: operatorState({
            observedBlock: 505n,
            currentTimestamp: 1_800_000_005n,
            trackQueues: { 1: 0n, 2: 0n, 3: 0n, 4: 0n },
          }),
        },
        {
          minimumBlock: 505n,
          state: operatorState({
            observedBlock: 506n,
            currentTimestamp: 1_800_000_006n,
            trackQueues: finalQueues,
          }),
        },
      ],
      attempts: [
        {
          evidence: {
            kind: "reward-track-or-retry",
            status: "failed",
            reason: "Track 1 preflight rejected the stale quote.",
            track: 1,
            failureClass: "preflight-rejected",
          },
        },
        {
          submittedHash: trackTwoHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "confirmed",
            reason: "Track 2 confirmed safely.",
            track: 2,
            transactionHash: trackTwoHash,
            blockNumber: 505n,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.intents).toMatchObject([
      { kind: "reward-track-or-retry", track: 1 },
      {
        kind: "reward-track-or-retry",
        track: 2,
        wethInput: 2_000_000_000_000_000n,
        deadline: 1_800_000_300n,
      },
    ]);
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:attempt:track-2",
      "chain:observe:505",
      "chain:observe:505",
      "recorder:complete:506",
    ]);
    expect(workflow.submittedDeliveries).toHaveLength(1);
    expect(workflow.submittedDeliveries[0]?.attempt.transactionHash).toBe(
      trackTwoHash,
    );
    expect(evidence.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reward-track-or-retry",
          track: 1,
          status: "failed",
          failureClass: "preflight-rejected",
        }),
        expect.objectContaining({
          kind: "reward-track-or-retry",
          track: 2,
          status: "confirmed",
          blockNumber: 505n,
        }),
      ]),
    );
    expect(evidence).toMatchObject({
      observedBlock: 506n,
      observedAt: 1_800_000_006n,
      observedState: { trackQueues: finalQueues },
    });
  });

  it("retains a submitted-unknown hash and still takes an unconditional final observation", async () => {
    const unknownHash = transactionHashFor("61");
    const finalQueues = { 1: 60n, 2: 61n, 3: 62n, 4: 63n } as const;
    const workflow = scriptedWorkflow({
      runId: "issue-61-submitted-unknown",
      observations: [
        {
          state: operatorState({
            observedBlock: 600n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 0n,
              3: 0n,
              4: 0n,
            },
          }),
        },
        {
          state: operatorState({
            observedBlock: 605n,
            currentTimestamp: 1_800_000_005n,
            trackQueues: finalQueues,
          }),
        },
      ],
      attempts: [
        {
          submittedHash: unknownHash,
          evidence: {
            kind: "reward-track-or-retry",
            status: "failed",
            reason: "The submitted transaction receipt is unavailable.",
            track: 1,
            failureClass: "receipt-unavailable",
            transactionHash: unknownHash,
          },
        },
      ],
    });

    const evidence = await workflow.run();

    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:track-1",
      "chain:observe:unpinned-floor",
      "recorder:complete:605",
    ]);
    expect(workflow.submittedDeliveries).toHaveLength(1);
    expect(workflow.submittedDeliveries[0]?.attempt.transactionHash).toBe(
      unknownHash,
    );
    expect(evidence.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reward-track-or-retry",
          track: 1,
          status: "failed",
          failureClass: "receipt-unavailable",
          transactionHash: unknownHash,
        }),
      ]),
    );
    expect(evidence).toMatchObject({
      observedBlock: 605n,
      observedAt: 1_800_000_005n,
      observedState: { trackQueues: finalQueues },
    });
  });

  it("keeps dry-run attempts simulated and reports the final pinned snapshot without submission", async () => {
    const finalQueues = { 1: 70n, 2: 71n, 3: 72n, 4: 73n } as const;
    const planningBlock = blockIdentity(700n, 1_800_000_000n);
    const epochPreflight = blockIdentity(701n, 1_800_000_001n);
    const trackPreflight = blockIdentity(702n, 1_800_000_002n);
    const polPreflight = blockIdentity(703n, 1_800_000_003n);
    const workflow = scriptedWorkflow({
      execute: false,
      runId: "issue-61-dry-run",
      observations: [
        {
          state: operatorState({
            observedBlock: 700n,
            lastRewardEpochAt: 1_799_999_900n,
            rewardPotWeth: 40_000_000_000_000_000n,
            trackQueues: {
              1: 1_000_000_000_000_000n,
              2: 0n,
              3: 0n,
              4: 0n,
            },
            queuedLiquidityWeth: readyPolWeth,
            currentTick: -51_601,
          }),
        },
        {
          state: operatorState({
            observedBlock: 710n,
            currentTimestamp: 1_800_000_010n,
            rewardPotWeth: 777n,
            trackQueues: finalQueues,
            queuedLiquidityWeth: 1_000_000_000_000_000n,
            currentTick: -51_541,
          }),
        },
      ],
      attempts: [
        {
          evidence: {
            kind: "reward-epoch",
            status: "simulated",
            reason: "Reward Epoch preflight passed without submission.",
            preflightBlock: epochPreflight,
          },
        },
        {
          evidence: {
            kind: "reward-track-or-retry",
            status: "simulated",
            reason: "Track 1 preflight passed without submission.",
            track: 1,
            quotedOutput: 1_000n,
            minimumOutput: 990n,
            quoteBlock: planningBlock,
            preflightBlock: trackPreflight,
          },
        },
        {
          evidence: (intent) => {
            if (intent.kind !== "protocol-liquidity") {
              throw new Error("Expected a Protocol-Owned Liquidity intent");
            }
            return {
              kind: "protocol-liquidity",
              status: "simulated",
              reason: "POL preflight passed without submission.",
              liquidityPlan: intent.plan,
              simulatedConsumptionWeth: intent.plan.expectedConsumptionWeth,
              preflightBlock: polPreflight,
            };
          },
        },
      ],
    });

    const evidence = await workflow.run();
    const simulated = evidence.actions.filter(
      (action) => action.status === "simulated",
    );

    expect(workflow.intents.map(actionLabel)).toEqual([
      "epoch",
      "track-1",
      "pol",
    ]);
    expect(workflow.intents[2]).toMatchObject({
      kind: "protocol-liquidity",
      plan: { status: "ready", availableWeth: readyPolWeth },
    });
    expect(workflow.trace).toEqual([
      "chain:get-chain-id",
      "chain:observe:unpinned-floor",
      "chain:attempt:epoch",
      "chain:attempt:track-1",
      "chain:attempt:pol",
      "chain:observe:unpinned-floor",
      "recorder:complete:710",
    ]);
    expect(workflow.submittedDeliveries).toHaveLength(0);
    expect(simulated.map((action) => action.kind)).toEqual([
      "reward-epoch",
      "reward-track-or-retry",
      "protocol-liquidity",
    ]);
    expect(
      simulated.every((action) => action.transactionHash === undefined),
    ).toBe(true);
    expect(simulated).toMatchObject([
      { planningBlock, preflightBlock: epochPreflight },
      {
        planningBlock,
        quoteBlock: planningBlock,
        preflightBlock: trackPreflight,
      },
      { planningBlock, preflightBlock: polPreflight },
    ]);
    expect(evidence).toMatchObject({
      schemaVersion: 5,
      mode: "dry-run",
      observation: blockIdentity(710n, 1_800_000_010n),
      observedBlock: 710n,
      observedBlockHash: blockHash(710n),
      observedAt: 1_800_000_010n,
      observedState: {
        rewardPotWeth: 777n,
        trackQueues: finalQueues,
        protocolOwnedLiquidity: {
          queuedWeth: 1_000_000_000_000_000n,
          currentTick: -51_541,
        },
      },
    });
  });
});
