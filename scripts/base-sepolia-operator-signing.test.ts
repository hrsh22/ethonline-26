import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createWalletClient,
  custom,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { attemptOperatorCall } from "./base-sepolia-operator.ts";
import { createOperatorSupervisor } from "./operator-control/runtime.ts";
import { openOperatorControlStore } from "./operator-control/store.ts";
import { openKeeperAttemptOutbox } from "./keeper-attempt-outbox.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

const signingRun = () => {
  const directory = mkdtempSync(join(tmpdir(), "operator-signing-"));
  directories.push(directory);
  const store = openOperatorControlStore(join(directory, "control.sqlite"));
  const childStore = openOperatorControlStore(
    join(directory, "control.sqlite"),
  );
  const now = 1_800_000_000_000;
  const command = (name: "enable-live" | "stop") => {
    const previous = store.readPolicy();
    store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: name,
      commandId: name,
      nextMode: name === "stop" ? "stopped" : "live",
      nextOneShot: "none",
      previousMode: previous.mode,
      previousOneShot: previous.oneShot,
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
  };
  command("enable-live");
  const supervisor = createOperatorSupervisor({
    store,
    now: () => now,
    leaseMilliseconds: 60_000,
  });
  const grant = supervisor.beginCycle()!;
  const account = privateKeyToAccount(`0x${"44".repeat(32)}`);
  const broadcasts: Hex[] = [];
  const fault = { afterPersistence: false, lostBroadcastResponse: false };
  const outboxPath = join(directory, "outbox.sqlite");
  const outboxIdentity = {
    chainId: 84532,
    manifestFingerprint: `0x${"12".repeat(32)}` as Hex,
  };
  const outbox = openKeeperAttemptOutbox(outboxPath, outboxIdentity);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: custom(
      {
        request: async ({ method, params }) => {
          if (method === "eth_chainId") return "0x14a34";
          if (method === "eth_sendRawTransaction") {
            const raw = (params as readonly Hex[])[0]!;
            broadcasts.push(raw);
            if (fault.lostBroadcastResponse)
              throw new Error("RPC response lost after acceptance");
            return keccak256(raw);
          }
          throw new Error(`Unexpected RPC method ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  });
  const abi = parseAbi(["function openRewardEpoch()"]);
  const block = {
    number: 10n,
    hash: `0x${"ab".repeat(32)}` as Hex,
    timestamp: 1_800_000_000n,
  };
  const call = {
    address: account.address,
    abi,
    functionName: "openRewardEpoch",
    args: [],
    authorization: "keeper" as const,
    kind: "reward-epoch" as const,
    planningBlock: block,
    preflightBlock: block,
  };
  const clients = {
    assertMaySign: () => {
      if (!childStore.maySign(grant.runId, now))
        throw new Error("Operator signing authority was revoked");
    },
    publicClient: {
      getBlock: async () => block,
      simulateContract: async () => ({
        result: undefined,
        request: {
          ...call,
          gas: 100_000n,
          nonce: 0,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
        },
      }),
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 11n,
      }),
      sendRawTransaction: walletClient.sendRawTransaction,
    },
    roles: {
      keeper: { account, walletClient },
      "liquidity-executor": { account: undefined, walletClient: undefined },
    },
  };
  const attempt = () =>
    attemptOperatorCall(
      clients as unknown as Parameters<typeof attemptOperatorCall>[0],
      {
        keeper: account.address,
        "liquidity-executor": account.address,
      } as Parameters<typeof attemptOperatorCall>[1],
      true,
      call,
      {
        beforeAttempt: async () => undefined,
        submitted: async (transactionHash, rawTransaction?: Hex) => {
          outbox.enqueue(
            {
              ...(rawTransaction === undefined ? {} : { rawTransaction }),
              runStarted: {
                type: "run-started",
                runId: grant.runId,
                observedBlock: 10n,
                observedAt: 1_800_000_000n,
              },
              attempt: {
                type: "attempt-observed",
                runId: grant.runId,
                attemptId: `${grant.runId}:epoch`,
                actionKind: "reward-epoch",
                observedBlock: 10n,
                observedAt: 1_800_000_000n,
                outcome: "pending",
                transactionHash,
              },
            },
            1_800_000_000n,
          );
          if (fault.afterPersistence)
            throw new Error("Crash after persistence");
        },
      },
    );
  return {
    attempt,
    broadcasts,
    clients,
    fault,
    outboxPath,
    outboxIdentity,
    stop: () => command("stop"),
    close: () => {
      supervisor.release();
      store.close();
      childStore.close();
      outbox.close();
    },
  };
};

describe("operator signing authority across the child ledger connection", () => {
  it("persists a recoverable signed transaction before any broadcast", async () => {
    const run = signingRun();
    run.fault.afterPersistence = true;
    await expect(run.attempt()).rejects.toThrow();
    run.close();
    const restarted = openKeeperAttemptOutbox(
      run.outboxPath,
      run.outboxIdentity,
    );
    try {
      const pending = restarted.unresolved()[0]!;
      expect(pending.rawTransaction).toBeDefined();
      expect(keccak256(pending.rawTransaction!)).toBe(
        pending.attempt.transactionHash,
      );
      expect(run.broadcasts).toEqual([]);
    } finally {
      restarted.close();
    }
  });

  it("keeps an accepted transaction unresolved when the RPC response is lost", async () => {
    const run = signingRun();
    run.fault.lostBroadcastResponse = true;
    const evidence = await run.attempt();
    run.close();
    const restarted = openKeeperAttemptOutbox(
      run.outboxPath,
      run.outboxIdentity,
    );
    try {
      expect(evidence.status).toBe("submitted-unknown");
      expect(restarted.unresolved()[0]?.rawTransaction).toBe(run.broadcasts[0]);
      expect(evidence.transactionHash).toBe(keccak256(run.broadcasts[0]!));
    } finally {
      restarted.close();
    }
  });
  it("does not sign when Stop arrives during simulation", async () => {
    const run = signingRun();
    const simulate = run.clients.publicClient.simulateContract;
    run.clients.publicClient.simulateContract = async () => {
      run.stop();
      return simulate();
    };
    try {
      expect((await run.attempt()).status).toBe("failed");
      expect(run.broadcasts).toEqual([]);
    } finally {
      run.close();
    }
  });

  it("preserves the first broadcast and blocks the next action after Stop", async () => {
    const run = signingRun();
    try {
      expect((await run.attempt()).status).toBe("confirmed");
      run.stop();
      expect((await run.attempt()).status).toBe("failed");
      expect(run.broadcasts).toHaveLength(1);
    } finally {
      run.close();
    }
  });
});
