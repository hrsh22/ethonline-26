import { describe, expect, it } from "vitest";
import { createWalletClient, custom, keccak256, parseAbi } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  attemptOperatorCall,
  liquidityIsWaitingForFunding,
  reconcileOperatorSubmission,
  type OperatorBlockIdentity,
} from "./base-sepolia-operator.ts";

const ACTOR = "0x0000000000000000000000000000000000000001" as Address;
const LIQUIDITY_EXECUTOR =
  "0x0000000000000000000000000000000000000002" as Address;
const RAW_TRANSACTION = "0x0102";
const HASH = keccak256(RAW_TRANSACTION);
const simulatedRequest = (account = ACTOR) => ({
  account,
  address: ACTOR,
  abi: parseAbi(["function addLiquidityCycle()"]),
  functionName: "addLiquidityCycle",
  args: [],
});
const wallet = (sign: () => void = () => undefined) => ({
  prepareTransactionRequest: async () => ({}),
  signTransaction: async () => {
    sign();
    return RAW_TRANSACTION;
  },
  sendRawTransaction: async () => HASH,
});
const LIQUIDITY_EXECUTOR_KEY = `0x${"44".repeat(32)}` as Hex;
const PLANNING_BLOCK: OperatorBlockIdentity = {
  number: 10n,
  hash: `0x${"10".repeat(32)}` as Hex,
  timestamp: 1_800_000_000n,
};
const PREFLIGHT_BLOCK: OperatorBlockIdentity = {
  number: 11n,
  hash: `0x${"11".repeat(32)}` as Hex,
  timestamp: 1_800_000_001n,
};
const canonicalPublicClient = {
  getBlock: async ({ blockNumber }: { readonly blockNumber?: bigint } = {}) => {
    if (blockNumber === PLANNING_BLOCK.number) return PLANNING_BLOCK;
    if (blockNumber === PREFLIGHT_BLOCK.number) return PREFLIGHT_BLOCK;
    throw new Error(`Unexpected canonical block lookup ${String(blockNumber)}`);
  },
};

const actors = (liquidityExecutor: Address = ACTOR) =>
  ({
    keeper: ACTOR,
    "liquidity-executor": liquidityExecutor,
  }) as unknown as Parameters<typeof attemptOperatorCall>[1];

const operatorCall = (validateSimulation: (result: unknown) => void) => ({
  authorization: "liquidity-executor" as const,
  kind: "protocol-liquidity" as const,
  address: ACTOR,
  abi: [],
  functionName: "addLiquidityCycle",
  args: [],
  planningBlock: PLANNING_BLOCK,
  preflightBlock: PREFLIGHT_BLOCK,
  validateSimulation,
});

describe("Base Sepolia operator contract preflight", () => {
  it("treats only queue races as retryable funding waits", () => {
    expect(liquidityIsWaitingForFunding("QueuedWethExceeded(25, 20)")).toBe(
      true,
    );
    expect(
      liquidityIsWaitingForFunding("available queue changed before preflight"),
    ).toBe(true);
    expect(liquidityIsWaitingForFunding("MaximumWethExceeded(25, 26)")).toBe(
      false,
    );
  });

  it("validates the simulated result before signing the exact request", async () => {
    const events: string[] = [];
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async (request: {
          readonly blockNumber?: bigint;
        }) => {
          events.push("simulate");
          expect(request.blockNumber).toBe(PREFLIGHT_BLOCK.number);
          return { result: 25n, request: simulatedRequest() };
        },
        waitForTransactionReceipt: async () => {
          events.push("confirm");
          return { status: "success", blockNumber: 12n };
        },
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": {
          account: { address: ACTOR },
          walletClient: wallet(() => {
            events.push("sign");
          }),
        },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    const evidence = await attemptOperatorCall(
      clients,
      actors(),
      true,
      operatorCall((result) => {
        events.push(`validate:${String(result)}`);
      }),
      {
        beforeAttempt: async () => {
          events.push("journal:preparing");
        },
        submitted: async (hash) => {
          events.push(`journal:pending:${hash}`);
        },
      },
    );

    expect(evidence.status).toBe("confirmed");
    expect(evidence).toMatchObject({
      planningBlock: PLANNING_BLOCK,
      preflightBlock: PREFLIGHT_BLOCK,
    });
    expect(events).toEqual([
      "journal:preparing",
      "simulate",
      "validate:25",
      "sign",
      `journal:pending:${HASH}`,
      "confirm",
    ]);
  });

  it("uses the role declared by the call for simulation and signing", async () => {
    const events: string[] = [];
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async ({ account }: { account: Address }) => {
          events.push(`simulate:${account}`);
          return { result: 25n, request: simulatedRequest(account) };
        },
        waitForTransactionReceipt: async () => ({
          status: "success",
          blockNumber: 12n,
        }),
      },
      roles: {
        keeper: {
          account: { address: ACTOR },
          walletClient: wallet(() => {
            events.push("sign:keeper");
          }),
        },
        "liquidity-executor": {
          account: { address: LIQUIDITY_EXECUTOR },
          walletClient: wallet(() => {
            events.push("sign:liquidity-executor");
          }),
        },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    const evidence = await attemptOperatorCall(
      clients,
      actors(LIQUIDITY_EXECUTOR),
      true,
      operatorCall(() => undefined),
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence.status).toBe("confirmed");
    expect(events).toEqual([
      `simulate:${LIQUIDITY_EXECUTOR}`,
      "sign:liquidity-executor",
    ]);
  });

  it("signs role-key execution locally before broadcasting", async () => {
    const account = privateKeyToAccount(LIQUIDITY_EXECUTOR_KEY);
    const rpcMethods: string[] = [];
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: custom({
        request: ({ method, params }) => {
          rpcMethods.push(method);
          if (method === "eth_chainId") return Promise.resolve("0x14a34");
          if (
            method === "eth_sendRawTransaction" ||
            method === "eth_sendTransaction"
          ) {
            return Promise.resolve(keccak256((params as readonly Hex[])[0]!));
          }
          return Promise.reject(new Error(`Unexpected RPC method ${method}`));
        },
      }),
    });
    const abi = parseAbi(["function addLiquidityCycle()"]);
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async () => ({
          result: 25n,
          request: {
            account: account.address,
            address: ACTOR,
            abi,
            functionName: "addLiquidityCycle",
            args: [],
            gas: 100_000n,
            nonce: 0,
            maxFeePerGas: 2n,
            maxPriorityFeePerGas: 1n,
          },
        }),
        waitForTransactionReceipt: async () => ({
          status: "success",
          blockNumber: 12n,
        }),
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": { account, walletClient },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    const evidence = await attemptOperatorCall(
      clients,
      actors(account.address),
      true,
      {
        authorization: "liquidity-executor",
        kind: "protocol-liquidity",
        address: ACTOR,
        abi,
        functionName: "addLiquidityCycle",
        args: [],
        planningBlock: PLANNING_BLOCK,
        preflightBlock: PREFLIGHT_BLOCK,
      },
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

    expect(evidence.status).toBe("confirmed");
    expect(rpcMethods).toContain("eth_sendRawTransaction");
    expect(rpcMethods).not.toContain("eth_sendTransaction");
  });

  it("fails closed without signing when simulated economics are invalid", async () => {
    const events: string[] = [];
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async () => {
          events.push("simulate");
          return { result: 1n, request: { account: ACTOR } };
        },
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": {
          account: { address: ACTOR },
          walletClient: {
            writeContract: async () => {
              events.push("sign");
              return HASH;
            },
          },
        },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    const evidence = await attemptOperatorCall(
      clients,
      actors(),
      true,
      operatorCall(() => {
        events.push("validate");
        throw new Error("simulated consumption is outside policy");
      }),
    );

    expect(evidence).toMatchObject({
      status: "failed",
      reason: "simulated consumption is outside policy",
    });
    expect(events).toEqual(["simulate", "validate"]);
  });

  it("redacts provider credentials from persisted failure reasons", async () => {
    const secret = "sentinel-provider-secret";
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async () => {
          throw new Error(
            `RPC request failed at https://rpc.example.test/${secret}`,
          );
        },
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": {
          account: undefined,
          walletClient: undefined,
        },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    const evidence = await attemptOperatorCall(
      clients,
      actors(),
      false,
      operatorCall(() => undefined),
    );

    expect(evidence).toMatchObject({
      status: "failed",
      reason: "RPC request failed at [REDACTED_URL]",
    });
    expect(evidence.reason).not.toContain(secret);
  });

  it("aborts before broadcast when the durable hash journal is unavailable", async () => {
    const events: string[] = [];
    const clients = {
      publicClient: {
        ...canonicalPublicClient,
        simulateContract: async () => ({
          result: 25n,
          request: simulatedRequest(),
        }),
        waitForTransactionReceipt: async () => {
          events.push("confirm");
          return { status: "success", blockNumber: 12n };
        },
      },
      roles: {
        keeper: { account: undefined, walletClient: undefined },
        "liquidity-executor": {
          account: { address: ACTOR },
          walletClient: {
            ...wallet(),
            sendRawTransaction: async () => {
              events.push("broadcast");
              return HASH;
            },
          },
        },
      },
    } as unknown as Parameters<typeof attemptOperatorCall>[0];

    await expect(
      attemptOperatorCall(
        clients,
        actors(),
        true,
        operatorCall(() => undefined),
        {
          beforeAttempt: async () => undefined,
          submitted: async () => {
            events.push("journal-failed");
            throw new Error("outbox delivery failed");
          },
        },
      ),
    ).rejects.toThrow("could not be durably journaled");
    expect(events).toEqual(["journal-failed"]);
  });

  const receiptAttempt = async (receipt: unknown) =>
    attemptOperatorCall(
      {
        publicClient: {
          ...canonicalPublicClient,
          simulateContract: async () => ({
            result: 25n,
            request: simulatedRequest(),
          }),
          waitForTransactionReceipt: async () => receipt,
        },
        roles: {
          keeper: { account: undefined, walletClient: undefined },
          "liquidity-executor": {
            account: { address: ACTOR },
            walletClient: wallet(),
          },
        },
      } as unknown as Parameters<typeof attemptOperatorCall>[0],
      actors(),
      true,
      operatorCall(() => undefined),
      {
        beforeAttempt: async () => undefined,
        submitted: async () => undefined,
      },
    );

  it.each([
    ["foreign status", { status: "0x1", blockNumber: 12n }],
    ["missing status", { blockNumber: 12n }],
    ["negative block", { status: "success", blockNumber: -1n }],
    ["numeric block", { status: "success", blockNumber: 12 }],
  ])(
    "retains the hash for a submitted receipt with %s",
    async (_label, receipt) => {
      await expect(receiptAttempt(receipt)).resolves.toMatchObject({
        status: "submitted-unknown",
        failureClass: "receipt-unavailable",
        transactionHash: HASH,
      });
    },
  );

  it("snapshots each receipt field exactly once before classifying it", async () => {
    let statusReads = 0;
    let blockReads = 0;
    const receipt = {
      get status() {
        statusReads += 1;
        return statusReads === 1 ? "success" : "reverted";
      },
      get blockNumber() {
        blockReads += 1;
        return blockReads === 1 ? 12n : -1n;
      },
    };

    await expect(receiptAttempt(receipt)).resolves.toMatchObject({
      status: "confirmed",
      blockNumber: 12n,
      transactionHash: HASH,
    });
    expect({ statusReads, blockReads }).toEqual({
      statusReads: 1,
      blockReads: 1,
    });
  });

  it.each([
    [
      "throwing status getter",
      {
        get status(): never {
          throw new Error("getter exploded");
        },
        blockNumber: 12n,
      },
    ],
    [
      "throwing block getter",
      {
        status: "success",
        get blockNumber(): never {
          throw new Error("getter exploded");
        },
      },
    ],
    [
      "revoked proxy",
      (() => {
        const { proxy, revoke } = Proxy.revocable(
          { status: "success", blockNumber: 12n },
          {},
        );
        revoke();
        return proxy;
      })(),
    ],
  ])("fails closed for a %s", async (_label, receipt) => {
    await expect(receiptAttempt(receipt)).resolves.toMatchObject({
      status: "submitted-unknown",
      failureClass: "receipt-unavailable",
      transactionHash: HASH,
    });
  });

  it("classifies only an exact reverted receipt as execution-reverted", async () => {
    await expect(
      receiptAttempt({ status: "reverted", blockNumber: 12n }),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "execution-reverted",
      transactionHash: HASH,
      blockNumber: 12n,
    });
  });
});

describe("Base Sepolia submitted transaction reconciliation", () => {
  const receiptHash = `0x${"12".repeat(32)}` as Hex;
  const clients = (overrides: {
    readonly receipt?: unknown;
    readonly headerHash?: Hex;
    readonly head?: bigint;
    readonly receiptFailure?: unknown;
  }) =>
    ({
      publicClient: {
        getTransactionReceipt: async () => {
          if (overrides.receiptFailure !== undefined) {
            throw overrides.receiptFailure;
          }
          return (
            overrides.receipt ?? {
              status: "success",
              blockNumber: 12n,
              blockHash: receiptHash,
            }
          );
        },
        getBlock: async () => ({
          number: 12n,
          hash: overrides.headerHash ?? receiptHash,
          timestamp: 1_800_000_012n,
        }),
        getBlockNumber: async () => overrides.head ?? 14n,
      },
    }) as unknown as Parameters<typeof reconcileOperatorSubmission>[0];

  it.each(["success", "reverted"] as const)(
    "releases an exact canonical %s receipt after two confirmations",
    async (status) => {
      await expect(
        reconcileOperatorSubmission(
          clients({
            receipt: {
              status,
              blockNumber: 12n,
              blockHash: receiptHash,
            },
          }),
          HASH,
        ),
      ).resolves.toEqual({
        status: status === "success" ? "confirmed" : "reverted",
        blockNumber: 12n,
      });
    },
  );

  it("keeps pending transport outcomes gated with bounded redacted diagnostics", async () => {
    const secret = "provider-credential";
    const resolution = await reconcileOperatorSubmission(
      clients({
        receiptFailure: new Error(
          `pending at https://rpc.example.test/${secret}`,
        ),
      }),
      HASH,
    );

    expect(resolution).toMatchObject({
      status: "submitted-unknown",
      failureClass: "receipt-unavailable",
      reason: "pending at [REDACTED_URL]",
    });
    expect("reason" in resolution ? resolution.reason : "").not.toContain(
      secret,
    );
  });

  it("keeps reorged and not-yet-final receipts gated", async () => {
    await expect(
      reconcileOperatorSubmission(
        clients({ headerHash: `0x${"13".repeat(32)}` as Hex }),
        HASH,
      ),
    ).resolves.toMatchObject({
      status: "submitted-unknown",
      failureClass: "canonicality-uncertain",
    });
    await expect(
      reconcileOperatorSubmission(clients({ head: 13n }), HASH),
    ).resolves.toMatchObject({
      status: "submitted-unknown",
      failureClass: "canonicality-uncertain",
    });
  });

  it("keeps malformed and hostile reconciliation receipts gated", async () => {
    const { proxy, revoke } = Proxy.revocable(
      {
        status: "success",
        blockNumber: 12n,
        blockHash: receiptHash,
      },
      {},
    );
    revoke();
    await expect(
      reconcileOperatorSubmission(clients({ receipt: proxy }), HASH),
    ).resolves.toMatchObject({
      status: "submitted-unknown",
      failureClass: "receipt-unavailable",
    });
  });
});
