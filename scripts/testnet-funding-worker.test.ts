import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireTestnetFundingHttpServer,
  type RunningTestnetFundingHttpServer,
  type TestnetFundingConfiguration,
  type TestnetFundingHttpServerOptions,
} from "./testnet-funding/http-server.ts";
import { resolveTestnetFundingEnvironment } from "./testnet-funding/runtime-configuration.ts";
import type {
  PreparedTestnetFundingTransfer,
  TestnetFundingAssetAmounts,
  TestnetFundingChain,
  TestnetFundingChainInspection,
} from "./testnet-funding/types.ts";

const signer = "0x1000000000000000000000000000000000000001" as const;
const recipient = "0x2000000000000000000000000000000000000002" as const;
const otherRecipient = "0x2000000000000000000000000000000000000003" as const;
const deployer = "0x5000000000000000000000000000000000000005" as const;
const wethHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const ethHash =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-funding-"));
  temporaryDirectories.push(directory);
  return join(directory, "funding.sqlite");
};

const withFundingServer = <A, E>(
  options: TestnetFundingHttpServerOptions,
  verify: (server: RunningTestnetFundingHttpServer) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(acquireTestnetFundingHttpServer(options), verify),
    ),
  );

const configuration = (
  overrides: Partial<TestnetFundingConfiguration> = {},
): TestnetFundingConfiguration => ({
  enabled: false,
  chainId: 84_532,
  signer,
  privilegedAddresses: new Set(["0x3000000000000000000000000000000000000003"]),
  policy: {
    target: {
      wethWei: 100_000_000_000_000_000n,
      ethWei: 10_000_000_000_000_000n,
    },
    reserve: {
      wethWei: 100_000_000_000_000_000n,
      ethWei: 10_000_000_000_000_000n,
    },
    lifetimeLimit: {
      wethWei: 200_000_000_000_000_000n,
      ethWei: 20_000_000_000_000_000n,
    },
    cooldownMilliseconds: 86_400_000,
    reconciliationTimeoutMilliseconds: 120_000,
    requestLeaseMilliseconds: 600_000,
  },
  abusePolicy: {
    dailyBudget: {
      wethWei: 2_000_000_000_000_000_000n,
      ethWei: 200_000_000_000_000_000n,
    },
    dailyGrantLimit: 20,
    clientWindowMilliseconds: 3_600_000,
    clientWindowLimit: 5,
    elevatedUsageRatio: 0.6,
    criticalUsageRatio: 0.9,
  },
  proofDomain: "orbit.test",
  ...overrides,
});

const unavailableChain: TestnetFundingChain = {
  inspect: () => Effect.die("disabled service must not inspect the chain"),
  prepare: () => Effect.die("disabled service must not prepare transfers"),
  broadcast: () => Effect.die("disabled service must not broadcast"),
  receipt: () => Effect.die("disabled service must not read receipts"),
  signerNonce: () => Effect.die("disabled service has no signer"),
};

const inspection = (
  overrides: Partial<TestnetFundingChainInspection> = {},
): TestnetFundingChainInspection => ({
  chainId: 84_532,
  signer,
  signerCode: "0x",
  deploymentSender: deployer,
  wethOperator: "0x4000000000000000000000000000000000000004",
  usdcOperator: "0x4000000000000000000000000000000000000004",
  signerBalance: {
    wethWei: 1_000_000_000_000_000_000n,
    ethWei: 200_000_000_000_000_000n,
  },
  recipientBalance: {
    wethWei: 20_000_000_000_000_000n,
    ethWei: 1_000_000_000_000_000n,
  },
  ...overrides,
});

class FakeFundingChain implements TestnetFundingChain {
  readonly prepared = new Map<
    Hex,
    {
      readonly amountWei: bigint;
      readonly hash: Hex;
      readonly kind: "weth" | "eth";
      readonly recipient: Address;
    }
  >();
  readonly broadcasted = new Set<Hex>();
  recipientWethWei = 20_000_000_000_000_000n;
  recipientEthWei = 1_000_000_000_000_000n;

  inspect: TestnetFundingChain["inspect"] = (recipientAddress: Address) => {
    void recipientAddress;
    return Effect.succeed(
      inspection({
        recipientBalance: {
          wethWei: this.recipientWethWei,
          ethWei: this.recipientEthWei,
        },
      }),
    );
  };

  prepare = ({
    recipient: target,
    amounts,
  }: {
    readonly recipient: Address;
    readonly amounts: TestnetFundingAssetAmounts;
  }) =>
    Effect.sync(() => {
      const transfers: PreparedTestnetFundingTransfer[] = [];
      const nextRawTransaction = (): Hex =>
        `0x${(this.prepared.size + 1).toString(16).padStart(2, "0")}`;
      if (amounts.wethWei > 0n) {
        const rawTransaction = nextRawTransaction();
        const hash =
          this.prepared.size < 2
            ? wethHash
            : (`0x${rawTransaction.slice(2).padStart(64, "0")}` as Hex);
        this.prepared.set(rawTransaction, {
          amountWei: amounts.wethWei,
          hash,
          kind: "weth",
          recipient: target,
        });
        transfers.push({
          amountWei: amounts.wethWei,
          hash,
          kind: "weth",
          rawTransaction,
        });
      }
      if (amounts.ethWei > 0n) {
        const rawTransaction = nextRawTransaction();
        const hash =
          this.prepared.size < 2
            ? ethHash
            : (`0x${rawTransaction.slice(2).padStart(64, "0")}` as Hex);
        this.prepared.set(rawTransaction, {
          amountWei: amounts.ethWei,
          hash,
          kind: "eth",
          recipient: target,
        });
        transfers.push({
          amountWei: amounts.ethWei,
          hash,
          kind: "eth",
          rawTransaction,
        });
      }
      return transfers;
    });

  broadcast: TestnetFundingChain["broadcast"] = (rawTransaction: Hex) =>
    Effect.sync(() => {
      const transfer = this.prepared.get(rawTransaction);
      if (transfer === undefined) throw new Error("unknown signed transfer");
      if (!this.broadcasted.has(rawTransaction)) {
        this.broadcasted.add(rawTransaction);
        if (transfer.kind === "weth") {
          this.recipientWethWei += transfer.amountWei;
        } else {
          this.recipientEthWei += transfer.amountWei;
        }
      }
      return transfer.hash;
    });

  receipt(
    hash: Hex,
  ): Effect.Effect<
    "pending" | "confirmed" | "reverted" | "unavailable",
    unknown
  > {
    void hash;
    return Effect.succeed(
      [...this.broadcasted].some((raw) => this.prepared.get(raw)?.hash === hash)
        ? ("confirmed" as const)
        : ("pending" as const),
    );
  }

  signerNonce: TestnetFundingChain["signerNonce"] = () => Effect.succeed(0);
}

class PendingFundingChain extends FakeFundingChain {
  readonly settled = new Set<Hex>();
  receiptState: "pending" | "confirmed" = "pending";

  override broadcast: TestnetFundingChain["broadcast"] = (
    rawTransaction: Hex,
  ) =>
    Effect.sync(() => {
      const transfer = this.prepared.get(rawTransaction);
      if (transfer === undefined) throw new Error("unknown signed transfer");
      this.broadcasted.add(rawTransaction);
      return transfer.hash;
    });

  override receipt(
    hash: Hex,
  ): Effect.Effect<
    "pending" | "confirmed" | "reverted" | "unavailable",
    unknown
  > {
    return Effect.sync(() => {
      if (
        this.receiptState === "pending" ||
        ![...this.broadcasted].some(
          (raw) => this.prepared.get(raw)?.hash === hash,
        )
      )
        return "pending" as const;
      const transfer = [...this.prepared.values()].find(
        (candidate) => candidate.hash === hash,
      );
      if (transfer === undefined) throw new Error("unknown transaction hash");
      if (!this.settled.has(hash)) {
        this.settled.add(hash);
        if (transfer.kind === "weth") {
          this.recipientWethWei += transfer.amountWei;
        } else {
          this.recipientEthWei += transfer.amountWei;
        }
      }
      return "confirmed" as const;
    });
  }
}

class ReceiptRpcOutageChain extends PendingFundingChain {
  receiptAvailable = false;

  override receipt(
    hash: Hex,
  ): Effect.Effect<
    "pending" | "confirmed" | "reverted" | "unavailable",
    unknown
  > {
    return this.receiptAvailable
      ? super.receipt(hash)
      : Effect.succeed("unavailable" as const);
  }
}

class FinalInspectionOutageChain extends FakeFundingChain {
  finalInspectionAvailable = false;

  override inspect: TestnetFundingChain["inspect"] = (
    recipientAddress: Address,
  ) => {
    void recipientAddress;
    const targetsReached =
      this.recipientWethWei >= 100_000_000_000_000_000n &&
      this.recipientEthWei >= 10_000_000_000_000_000n;
    return targetsReached && !this.finalInspectionAvailable
      ? Effect.fail(new Error("RPC unavailable after confirmation"))
      : Effect.succeed(
          inspection({
            recipientBalance: {
              wethWei: this.recipientWethWei,
              ethWei: this.recipientEthWei,
            },
          }),
        );
  };
}

class FinalBalanceLagChain extends FakeFundingChain {
  finalBalanceVisible = false;

  override inspect: TestnetFundingChain["inspect"] = (
    recipientAddress: Address,
  ) => {
    void recipientAddress;
    const targetsReached =
      this.recipientWethWei >= 100_000_000_000_000_000n &&
      this.recipientEthWei >= 10_000_000_000_000_000n;
    const recipientBalance =
      targetsReached && !this.finalBalanceVisible
        ? {
            wethWei: 20_000_000_000_000_000n,
            ethWei: 1_000_000_000_000_000n,
          }
        : {
            wethWei: this.recipientWethWei,
            ethWei: this.recipientEthWei,
          };
    return Effect.succeed(inspection({ recipientBalance }));
  };
}

class DrainingRecipientChain extends FakeFundingChain {
  readonly balances = new Map<string, TestnetFundingAssetAmounts>();

  constructor(private readonly drainingRecipient: Address) {
    super();
  }

  private balance(recipientAddress: Address): TestnetFundingAssetAmounts {
    return (
      this.balances.get(recipientAddress.toLowerCase()) ?? {
        wethWei: 20_000_000_000_000_000n,
        ethWei: 1_000_000_000_000_000n,
      }
    );
  }

  override inspect: TestnetFundingChain["inspect"] = (
    recipientAddress: Address,
  ) =>
    Effect.succeed(
      inspection({ recipientBalance: this.balance(recipientAddress) }),
    );

  override broadcast: TestnetFundingChain["broadcast"] = (
    rawTransaction: Hex,
  ) =>
    Effect.sync(() => {
      const transfer = this.prepared.get(rawTransaction);
      if (transfer === undefined) throw new Error("unknown signed transfer");
      if (!this.broadcasted.has(rawTransaction)) {
        this.broadcasted.add(rawTransaction);
        const current = this.balance(transfer.recipient);
        const funded =
          transfer.kind === "weth"
            ? { ...current, wethWei: current.wethWei + transfer.amountWei }
            : { ...current, ethWei: current.ethWei + transfer.amountWei };
        const visible =
          transfer.recipient.toLowerCase() ===
          this.drainingRecipient.toLowerCase()
            ? this.balance(transfer.recipient)
            : funded;
        this.balances.set(transfer.recipient.toLowerCase(), visible);
      }
      return transfer.hash;
    });
}

class LostBroadcastResponseChain extends FakeFundingChain {
  override broadcast: TestnetFundingChain["broadcast"] = (
    rawTransaction: Hex,
  ) =>
    Effect.sync(() => {
      const transfer = this.prepared.get(rawTransaction);
      if (transfer === undefined) throw new Error("unknown signed transfer");
      if (!this.broadcasted.has(rawTransaction)) {
        this.broadcasted.add(rawTransaction);
        if (transfer.kind === "weth") {
          this.recipientWethWei += transfer.amountWei;
        } else {
          this.recipientEthWei += transfer.amountWei;
        }
      }
      throw new Error("RPC lost the broadcast response");
    });
}

/**
 * The funding boundary requires a signed wallet-control proof, so a test that
 * exercises later policy must first obtain a challenge. Signature verification
 * itself is covered by its own cases.
 */
/** Each challenge must issue a distinct nonce, as production does. */
let testNonceCounter = 0;
const nextTestNonce = (): string => {
  testNonceCounter += 1;
  return testNonceCounter.toString(16).padStart(32, "0");
};

const fundWithProof = async (
  server: { readonly url: string },
  target: string,
  requestHeaders: Record<string, string>,
): Promise<Response> => {
  const challenge = await fetch(
    `${server.url}/v1/challenge?recipient=${target}`,
    { headers: requestHeaders },
  );
  const body = (await challenge.json()) as {
    readonly challenge?: { readonly message?: string };
  };
  // A refused challenge is left to the fund route to report, so tests that
  // assert a disabled or throttled service still observe its own response.
  return fetch(`${server.url}/v1/fund`, {
    body: JSON.stringify({
      proof: {
        message: body.challenge?.message ?? "",
        signature: `0x${"ab".repeat(65)}`,
      },
      recipient: target,
    }),
    headers: { ...requestHeaders, "content-type": "application/json" },
    method: "POST",
  });
};

describe("testnet funding HTTP interface", () => {
  it("returns the durable acceptance before attempting a broadcast", async () => {
    const chain = new FakeFundingChain();
    chain.broadcast = () => Effect.fail(new Error("RPC unavailable"));
    await withFundingServer(
      {
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: temporaryDatabasePath(),
        host: "127.0.0.1",
        nowMilliseconds: Date.now,
        port: 0,
        requestId: () => "accepted-before-broadcast",
        nonce: nextTestNonce,
        verifySignature: async () => true,
        processingIntervalMilliseconds: 60_000,
      },
      (server) =>
        Effect.promise(async () => {
          const response = await fundWithProof(server, recipient, {});
          expect(response.status).toBe(202);
          expect(await response.json()).toMatchObject({
            request: { id: "accepted-before-broadcast", state: "pending" },
          });
          expect(chain.broadcasted.size).toBe(0);
        }),
    );
  });

  it("finishes one accepted grant after a restart without another proof or status-triggered send", async () => {
    const chain = new PendingFundingChain();
    const options = {
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: Date.now,
      port: 0,
      requestId: () => "durable-grant",
      nonce: nextTestNonce,
      verifySignature: async () => true,
      processingIntervalMilliseconds: 20,
    };
    await withFundingServer(options, (server) =>
      Effect.promise(async () => {
        const accepted = await fundWithProof(server, recipient, {});
        expect(accepted.status).toBe(202);
        expect(await accepted.json()).toMatchObject({
          request: { id: "durable-grant", state: "pending" },
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }),
    );
    chain.receiptState = "confirmed";
    await withFundingServer(options, (server) =>
      Effect.promise(async () => {
        // No browser request drives the worker.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const status = await fetch(
          `${server.url}/v1/status?recipient=${recipient}`,
        ).then((response) => response.json());
        expect(status).toMatchObject({
          request: {
            id: "durable-grant",
            state: "funded",
            transactions: [
              { kind: "weth", state: "confirmed" },
              { kind: "eth", state: "confirmed" },
            ],
          },
        });
        expect(chain.broadcasted.size).toBe(2);
        expect(chain.prepared.size).toBe(2);
      }),
    );
  });

  it("reconciles a persisted prepared hash before rebroadcasting after a lost send response", async () => {
    const chain = new PendingFundingChain();
    let sends = 0;
    const broadcast = chain.broadcast;
    chain.broadcast = (raw) =>
      broadcast(raw).pipe(
        Effect.flatMap(() => {
          sends += 1;
          return Effect.fail(new Error("lost broadcast response"));
        }),
      );
    const options = {
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: Date.now,
      port: 0,
      requestId: () => "lost-response-grant",
      nonce: nextTestNonce,
      verifySignature: async () => true,
      processingIntervalMilliseconds: 20,
      receiptSettleMilliseconds: 0,
    };
    await withFundingServer(options, (server) =>
      Effect.promise(async () => {
        expect((await fundWithProof(server, recipient, {})).status).toBe(202);
      }),
    );
    chain.receiptState = "confirmed";
    await withFundingServer(options, (server) =>
      Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const status = await fetch(
          `${server.url}/v1/status?recipient=${recipient}`,
        ).then((response) => response.json());
        expect(status).toMatchObject({ request: { state: "funded" } });
        expect(sends).toBe(2);
      }),
    );
  });

  it("reports the emergency-disabled state without touching the signer or exposing the service token", async () => {
    const secret = "funding-service-secret";
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: secret,
        chain: unavailableChain,
        configuration: configuration(),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-disabled",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const headers = { authorization: `Bearer ${secret}` };
          const status = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status?recipient=${recipient}`, {
              headers,
            }),
          );
          const statusText = yield* Effect.promise(() => status.text());
          expect(status.status).toBe(200);
          expect(JSON.parse(statusText)).toMatchObject({
            service: { state: "disabled", chainId: 84_532 },
            recipient: { address: recipient, state: "unavailable" },
          });
          expect(statusText).not.toContain(secret);

          const funding = yield* Effect.promise(() =>
            fundWithProof(server, recipient, {
              ...headers,
              "content-type": "application/json",
            }),
          );
          expect(funding.status).toBe(503);
          const fundingBody = yield* Effect.promise(() => funding.json());
          expect(fundingBody).toMatchObject({
            error: { code: "funding-disabled" },
          });
        }),
    );
  });

  it("reports enabled service capacity without requiring a recipient", async () => {
    const chain = new FakeFundingChain();
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-service-status",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status`),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.json())).toEqual({
            apiVersion: 1,
            service: {
              state: "ready",
              chainId: 84_532,
              targets: {
                wethWei: "100000000000000000",
                ethWei: "10000000000000000",
              },
              cooldownSeconds: 86_400,
              inventory: {
                state: "available",
                wethWei: "900000000000000000",
                ethWei: "190000000000000000",
              },
              metrics: {
                successful: 0,
                pending: 0,
                failed: 0,
                rateLimited: 0,
              },
              // Depletion velocity for the operator alert. No signer address,
              // signer balance, or key material appears here.
              budget: {
                windowResetsAt: 1_700_006_400_000,
                grantsUsed: 0,
                grantLimit: 20,
                usedRatio: 0,
                alert: "normal",
              },
              halted: false,
            },
          });
        }),
    );
  });

  it("reports exact eligible deficits, finite inventory, policy, and empty persistent metrics", async () => {
    const chain = new FakeFundingChain();
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-eligible",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status?recipient=${recipient}`),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.json())).toEqual({
            apiVersion: 1,
            observedAt: 1_700_000_000_000,
            service: {
              state: "ready",
              chainId: 84_532,
              targets: {
                wethWei: "100000000000000000",
                ethWei: "10000000000000000",
              },
              cooldownSeconds: 86_400,
              inventory: {
                state: "available",
                wethWei: "900000000000000000",
                ethWei: "190000000000000000",
              },
              metrics: {
                successful: 0,
                pending: 0,
                failed: 0,
                rateLimited: 0,
              },
              budget: {
                windowResetsAt: 1_700_006_400_000,
                grantsUsed: 0,
                grantLimit: 20,
                usedRatio: 0,
                alert: "normal",
              },
              halted: false,
            },
            recipient: {
              address: recipient,
              state: "eligible",
              balances: {
                wethWei: "20000000000000000",
                ethWei: "1000000000000000",
              },
              remaining: {
                wethWei: "80000000000000000",
                ethWei: "9000000000000000",
              },
              nextEligibleAt: null,
            },
          });
        }),
    );
  });

  it("reports service capacity independently from a smaller recipient deficit", async () => {
    const chain: TestnetFundingChain = {
      ...unavailableChain,
      inspect: () =>
        Effect.succeed(
          inspection({
            signerBalance: {
              wethWei: 180_000_000_000_000_000n,
              ethWei: 19_000_000_000_000_000n,
            },
            recipientBalance: {
              wethWei: 90_000_000_000_000_000n,
              ethWei: 9_000_000_000_000_000n,
            },
          }),
        ),
    };
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-partial-capacity",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status?recipient=${recipient}`),
          );
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            service: {
              state: "inventory-empty",
              inventory: { state: "empty" },
            },
            recipient: {
              state: "eligible",
              remaining: {
                wethWei: "10000000000000000",
                ethWei: "1000000000000000",
              },
            },
          });
        }),
    );
  });

  it("rejects unauthenticated and malformed public funding requests without exposing credentials", async () => {
    const secret = "funding-service-secret";
    const chain = new FakeFundingChain();
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: secret,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-validation",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const unauthorized = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/status?recipient=${recipient}`),
          );
          const unauthorizedText = yield* Effect.promise(() =>
            unauthorized.text(),
          );
          expect(unauthorized.status).toBe(401);
          expect(unauthorizedText).not.toContain(secret);

          const malformed = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/fund`, {
              body: JSON.stringify({ recipient: "not-an-address" }),
              headers: {
                authorization: `Bearer ${secret}`,
                "content-type": "application/json",
              },
              method: "POST",
            }),
          );
          expect(malformed.status).toBe(400);
          expect(yield* Effect.promise(() => malformed.json())).toEqual({
            apiVersion: 1,
            error: {
              code: "funding-invalid-request",
              message: "A valid nonzero wallet address is required",
            },
          });
          expect(chain.prepared.size).toBe(0);

          const oversized = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/fund`, {
              body: JSON.stringify({ recipient: "x".repeat(3_000) }),
              headers: {
                authorization: `Bearer ${secret}`,
                "content-type": "application/json",
              },
              method: "POST",
            }),
          );
          expect(oversized.status).toBe(400);
          expect(yield* Effect.promise(() => oversized.json())).toMatchObject({
            error: { code: "funding-invalid-request" },
          });
        }),
    );
  });

  it("refuses empty inventory and any signer with a privileged protocol role or deployment sender", async () => {
    const emptyChain: TestnetFundingChain = {
      ...unavailableChain,
      inspect: () =>
        Effect.succeed(
          inspection({
            signerBalance: {
              wethWei: 100_000_000_000_000_000n,
              ethWei: 10_000_000_000_000_000n,
            },
          }),
        ),
    };
    const privilegedChain: TestnetFundingChain = {
      ...unavailableChain,
      inspect: () => Effect.succeed(inspection({ wethOperator: signer })),
    };
    const deployerChain: TestnetFundingChain = {
      ...unavailableChain,
      inspect: () => Effect.succeed(inspection({ deploymentSender: signer })),
    };
    const serverOptions = (chain: TestnetFundingChain) => ({
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: ":memory:",
      host: "127.0.0.1" as const,
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => "request-refused",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    });
    await withFundingServer(serverOptions(emptyChain), (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(response.status).toBe(503);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          error: { code: "funding-inventory-empty" },
        });
      }),
    );
    await expect(
      Effect.runPromise(
        Effect.scoped(
          acquireTestnetFundingHttpServer(serverOptions(privilegedChain)),
        ),
      ),
    ).rejects.toThrow(/startup validation/iu);
    await expect(
      Effect.runPromise(
        Effect.scoped(
          acquireTestnetFundingHttpServer(serverOptions(deployerChain)),
        ),
      ),
    ).rejects.toThrow(/startup validation/iu);
  });

  it("funds only current deficits and preserves cooldown across a worker restart", async () => {
    const chain = new FakeFundingChain();
    const databasePath = temporaryDatabasePath();
    let now = 1_700_000_000_000;
    let requestNumber = 0;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath,
      host: "127.0.0.1",
      nowMilliseconds: () => now,
      port: 0,
      requestId: () => `request-funded-${++requestNumber}`,
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          request: {
            id: "request-funded-1",
            state: "funded",
            transactions: [
              { kind: "weth", hash: wethHash, state: "confirmed" },
              { kind: "eth", hash: ethHash, state: "confirmed" },
            ],
          },
          recipient: {
            address: recipient,
            state: "funded",
            nextEligibleAt: 1_700_086_400_000,
            balances: {
              wethWei: "100000000000000000",
              ethWei: "10000000000000000",
            },
          },
        });
      }),
    );

    now += 60_000;
    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const retry = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(retry.status).toBe(200);
        expect(yield* Effect.promise(() => retry.json())).toMatchObject({
          recipient: {
            state: "already-funded",
            nextEligibleAt: 1_700_086_400_000,
            balances: {
              wethWei: "100000000000000000",
              ethWei: "10000000000000000",
            },
          },
        });
        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        expect(yield* Effect.promise(() => status.json())).toMatchObject({
          recipient: { nextEligibleAt: 1_700_086_400_000 },
          service: {
            metrics: {
              successful: 1,
              pending: 0,
              failed: 0,
              rateLimited: 0,
            },
          },
        });

        now = 1_700_086_400_001;
        chain.recipientWethWei = 105_000_000_000_000_000n;
        const stillFunded = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {}),
        );
        expect(yield* Effect.promise(() => stillFunded.json())).toMatchObject({
          recipient: { state: "already-funded", nextEligibleAt: null },
        });
        expect(chain.prepared.size).toBe(2);
        expect(chain.broadcasted.size).toBe(2);

        chain.recipientEthWei = 9_000_000_000_000_000n;
        const gasOnly = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {}),
        );
        expect(yield* Effect.promise(() => gasOnly.json())).toMatchObject({
          recipient: {
            state: "funded",
            nextEligibleAt: 1_700_172_800_001,
            balances: {
              ethWei: "10000000000000000",
              wethWei: "105000000000000000",
            },
          },
          request: { transactions: [{ kind: "eth", state: "confirmed" }] },
        });
        expect([...chain.prepared.values()].at(-1)).toMatchObject({
          kind: "eth",
          amountWei: 1_000_000_000_000_000n,
        });
        expect(chain.broadcasted.size).toBe(3);
      }),
    );
    expect(chain.recipientWethWei).toBe(105_000_000_000_000_000n);
    expect(chain.recipientEthWei).toBe(10_000_000_000_000_000n);
  });

  it("persists cooldown and lifetime limits even when a funded wallet drains its balances", async () => {
    const chain = new FakeFundingChain();
    const databasePath = temporaryDatabasePath();
    let now = 1_700_000_000_000;
    let requestNumber = 0;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath,
      host: "127.0.0.1",
      nowMilliseconds: () => now,
      port: 0,
      requestId: () => `request-policy-${++requestNumber}`,
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string) =>
      fundWithProof({ url }, recipient, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        expect(
          (yield* Effect.promise(() => requestFunding(server.url))).status,
        ).toBe(200);

        chain.recipientWethWei = 20_000_000_000_000_000n;
        chain.recipientEthWei = 1_000_000_000_000_000n;
        now += 3_600_000;
        const cooldown = yield* Effect.promise(() =>
          requestFunding(server.url),
        );
        expect(cooldown.status).toBe(429);
        expect(yield* Effect.promise(() => cooldown.json())).toEqual({
          apiVersion: 1,
          error: {
            code: "funding-rate-limited",
            message: "This wallet is still in its testnet funding cooldown",
            nextEligibleAt: 1_700_086_400_000,
          },
        });

        now = 1_700_086_400_000;
        expect(
          (yield* Effect.promise(() => requestFunding(server.url))).status,
        ).toBe(200);

        chain.recipientWethWei = 20_000_000_000_000_000n;
        chain.recipientEthWei = 1_000_000_000_000_000n;
        now += 86_400_000;
        const exhausted = yield* Effect.promise(() =>
          requestFunding(server.url),
        );
        expect(exhausted.status).toBe(429);
        expect(yield* Effect.promise(() => exhausted.json())).toMatchObject({
          error: {
            code: "funding-lifetime-limit",
            message:
              "This wallet has reached its lifetime testnet funding limit",
          },
        });

        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        expect(yield* Effect.promise(() => status.json())).toMatchObject({
          service: { metrics: { successful: 2, rateLimited: 2 } },
        });
      }),
    );
  });

  it("resumes one pending request after restart and serializes the funding signer", async () => {
    const chain = new PendingFundingChain();
    const databasePath = temporaryDatabasePath();
    let requestNumber = 0;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath,
      host: "127.0.0.1",
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => `request-pending-${++requestNumber}`,
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string, target: Address = recipient) =>
      fundWithProof({ url }, target, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          requestFunding(server.url),
        );
        expect(response.status).toBe(202);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          request: { id: "request-pending-1", state: "pending" },
          recipient: { address: recipient, state: "pending" },
        });
      }),
    );

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const persisted = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        expect(yield* Effect.promise(() => persisted.json())).toMatchObject({
          recipient: { address: recipient, state: "pending" },
          request: { id: "request-pending-1", state: "pending" },
        });
        const retry = yield* Effect.promise(() => requestFunding(server.url));
        expect(retry.status).toBe(202);
        expect(yield* Effect.promise(() => retry.json())).toMatchObject({
          request: { id: "request-pending-1", state: "pending" },
        });
        expect(chain.prepared.size).toBe(2);

        const busy = yield* Effect.promise(() =>
          requestFunding(server.url, otherRecipient),
        );
        expect(busy.status).toBe(409);
        expect(yield* Effect.promise(() => busy.json())).toMatchObject({
          error: { code: "funding-busy" },
        });

        chain.receiptState = "confirmed";
        const completed = yield* Effect.promise(() =>
          requestFunding(server.url),
        );
        expect(completed.status).toBe(200);
        expect(yield* Effect.promise(() => completed.json())).toMatchObject({
          request: { id: "request-pending-1", state: "funded" },
          recipient: { address: recipient, state: "funded" },
        });
      }),
    );
    expect(requestNumber).toBe(1);
  });

  it("serializes two concurrently eligible recipients at the persistent lease", async () => {
    const chain = new PendingFundingChain();
    let requestNumber = 0;
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: temporaryDatabasePath(),
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => `request-concurrent-${++requestNumber}`,
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const requestFunding = (target: Address) =>
            fundWithProof(server, target, {
              "content-type": "application/json",
            });
          const responses = yield* Effect.promise(() =>
            Promise.all([
              requestFunding(recipient),
              requestFunding(otherRecipient),
            ]),
          );
          expect(responses.map(({ status }) => status).sort()).toEqual([
            202, 409,
          ]);
        }),
    );
    expect(chain.prepared.size).toBe(2);
    expect(requestNumber).toBeGreaterThanOrEqual(1);
  });

  it("keeps confirmed transfers retryable without calling an RPC outage transaction-pending", async () => {
    const chain = new FinalInspectionOutageChain();
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => "request-final-read",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const first = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(first.status).toBe(503);
        expect(yield* Effect.promise(() => first.json())).toMatchObject({
          request: { id: "request-final-read", state: "retryable" },
          error: { code: "funding-rpc-unavailable" },
        });
        chain.finalInspectionAvailable = true;
        const pendingStatus = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        expect(yield* Effect.promise(() => pendingStatus.json())).toMatchObject(
          {
            service: { metrics: { pending: 1, failed: 0 } },
          },
        );
        const retry = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(retry.status).toBe(200);
        expect(yield* Effect.promise(() => retry.json())).toMatchObject({
          request: { id: "request-final-read", state: "funded" },
        });
      }),
    );
  });

  it("reconciles confirmed transfers after the final balance read catches up", async () => {
    const chain = new FinalBalanceLagChain();
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => "request-final-balance-lag",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string) =>
      fundWithProof({ url }, recipient, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const first = yield* Effect.promise(() => requestFunding(server.url));
        expect(first.status).toBe(503);
        expect(yield* Effect.promise(() => first.json())).toMatchObject({
          request: {
            id: "request-final-balance-lag",
            state: "retryable",
            transactions: [
              { kind: "weth", hash: wethHash, state: "confirmed" },
              { kind: "eth", hash: ethHash, state: "confirmed" },
            ],
          },
          // The node answered every call; only the balance read lagged its own
          // confirmed transfer. Reporting that as an unavailable RPC pointed
          // operators at a healthy node.
          error: { code: "funding-confirming" },
        });

        chain.finalBalanceVisible = true;
        const retry = yield* Effect.promise(() => requestFunding(server.url));
        expect(retry.status).toBe(200);
        expect(yield* Effect.promise(() => retry.json())).toMatchObject({
          request: {
            id: "request-final-balance-lag",
            state: "funded",
            transactions: [
              { kind: "weth", hash: wethHash, state: "confirmed" },
              { kind: "eth", hash: ethHash, state: "confirmed" },
            ],
          },
          recipient: {
            state: "funded",
            balances: {
              wethWei: "100000000000000000",
              ethWei: "10000000000000000",
            },
          },
        });

        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        expect(yield* Effect.promise(() => status.json())).toMatchObject({
          service: {
            metrics: { successful: 1, pending: 0, failed: 0 },
          },
        });
      }),
    );
  });

  it("completes a grant whose recipient never retains it, and says so", async () => {
    // An EIP-7702 delegate that forwards incoming ETH confirms every transfer
    // and never gains a balance. Judging delivery by that balance left the
    // request executing forever, so the console sat on "pending" while the
    // inventory was already spent.
    const chain = new DrainingRecipientChain(recipient);
    let now = 1_700_000_000_000;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({
        enabled: true,
        policy: {
          ...configuration().policy,
          reconciliationTimeoutMilliseconds: 1_000,
        },
      }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => now,
      port: 0,
      requestId: () => "request-never-retained",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string) =>
      fundWithProof({ url }, recipient, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const first = yield* Effect.promise(() => requestFunding(server.url));
        expect(first.status).toBe(503);
        expect(yield* Effect.promise(() => first.json())).toMatchObject({
          error: { code: "funding-confirming" },
        });

        now += 1_001;
        const settled = yield* Effect.promise(() => requestFunding(server.url));
        expect(settled.status).toBe(200);
        expect(yield* Effect.promise(() => settled.json())).toMatchObject({
          request: { id: "request-never-retained", state: "funded" },
          recipient: { state: "funded", retainedTargets: false },
        });

        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`),
        );
        // The grant is spent, so the wallet is in cooldown rather than stuck
        // behind its own unresolved request.
        expect(yield* Effect.promise(() => status.json())).toMatchObject({
          recipient: { state: "rate-limited" },
          service: { metrics: { successful: 1, pending: 0, failed: 0 } },
        });
      }),
    );
  });

  it("expires unresolved post-confirmation reconciliation before serving another recipient", async () => {
    const chain = new DrainingRecipientChain(recipient);
    let now = 1_700_000_000_000;
    let requestNumber = 0;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({
        enabled: true,
        policy: {
          ...configuration().policy,
          reconciliationTimeoutMilliseconds: 1_000,
        },
      }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => now,
      port: 0,
      requestId: () => `request-drain-${++requestNumber}`,
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string, target: Address) =>
      fundWithProof({ url }, target, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const drained = yield* Effect.promise(() =>
          requestFunding(server.url, recipient),
        );
        expect(drained.status).toBe(503);
        expect(yield* Effect.promise(() => drained.json())).toMatchObject({
          request: { state: "retryable" },
        });

        now += 1_001;
        const nextRecipient = yield* Effect.promise(() =>
          requestFunding(server.url, otherRecipient),
        );
        expect(nextRecipient.status).toBe(200);
        expect(yield* Effect.promise(() => nextRecipient.json())).toMatchObject(
          {
            recipient: { address: otherRecipient, state: "funded" },
          },
        );

        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${otherRecipient}`),
        );
        // Both grants were delivered: the draining recipient's transfers
        // confirmed, so settling its request completes it rather than filing a
        // failure against a signer that did exactly what it was asked.
        expect(yield* Effect.promise(() => status.json())).toMatchObject({
          service: { metrics: { successful: 2, pending: 0, failed: 0 } },
        });
      }),
    );
  });

  it("fails a transfer that can never be broadcast instead of waiting on it forever", async () => {
    // The live failure: a transfer signed with nonce 5 while the signer had
    // moved to 7. The node rejects it as `nonce too low`, no receipt ever
    // appears, and reading that as "pending" left one request holding the
    // queue and every other wallet refused.
    const strandedKey =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
    const strandedAccount = privateKeyToAccount(strandedKey);
    const strandedTransaction = await strandedAccount.signTransaction({
      chainId: 84_532,
      gas: 21_000n,
      maxFeePerGas: 1_000_000n,
      maxPriorityFeePerGas: 1_000n,
      nonce: 5,
      to: recipient,
      type: "eip1559",
      value: 1n,
    });

    class StrandedChain extends FakeFundingChain {
      // Only the gas top-up is outstanding, so the request is exactly the one
      // signed transfer that can never land.
      override recipientWethWei = 100_000_000_000_000_000n;

      override broadcast: TestnetFundingChain["broadcast"] = () =>
        Effect.fail(new Error("nonce too low: next nonce 7, tx nonce 5"));

      override receipt(): Effect.Effect<
        "pending" | "confirmed" | "reverted" | "unavailable",
        unknown
      > {
        return Effect.succeed("pending" as const);
      }

      override signerNonce: TestnetFundingChain["signerNonce"] = () =>
        Effect.succeed(7);

      override prepare = ({
        amounts,
      }: {
        readonly recipient: Address;
        readonly amounts: TestnetFundingAssetAmounts;
      }) =>
        Effect.succeed([
          {
            amountWei: amounts.ethWei,
            hash: ethHash,
            kind: "eth" as const,
            rawTransaction: strandedTransaction,
          },
        ]);
    }

    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain: new StrandedChain(),
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => "request-stranded-nonce",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const stranded = yield* Effect.promise(() =>
          fundWithProof({ url: server.url }, recipient, {
            "content-type": "application/json",
          }),
        );
        // Answered as an upstream failure rather than parked; the collector's
        // next click starts a fresh request with a current nonce.
        expect(stranded.status).toBe(502);

        // The queue must be free: the request was resolved rather than parked.
        const status = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${otherRecipient}`),
        );
        const body = (yield* Effect.promise(() => status.json())) as {
          readonly recipient?: { readonly state?: string };
          readonly service?: {
            readonly metrics?: { readonly pending?: number };
          };
        };
        // Nothing is left holding the queue, so the next wallet is servable.
        expect(body.service?.metrics?.pending).toBe(0);
        expect(body.recipient?.state).not.toBe("pending");
      }),
    );
  });

  it("waits out a block rather than making the collector click twice", async () => {
    // Base Sepolia produces a block every two seconds, so a single look after
    // broadcast almost always reports "pending" and hands the collector a
    // retry for work that was about to finish on its own.
    const chain = new PendingFundingChain();
    const options = {
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: Date.now,
      port: 0,
      receiptSettleMilliseconds: 3_000,
      requestId: () => "request-settle-window",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        // The receipt appears a beat after the request starts, exactly as a
        // block landing mid-request would.
        setTimeout(() => {
          chain.receiptState = "confirmed";
        }, 600);
        const funded = yield* Effect.promise(() =>
          fundWithProof({ url: server.url }, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(funded.status).toBe(200);
        expect(yield* Effect.promise(() => funded.json())).toMatchObject({
          request: { state: "funded" },
        });
      }),
    );
  });

  it("does not let a broadcast transfer nobody observed block every other wallet", async () => {
    // The live failure: a transfer confirmed on chain hours earlier still read
    // as `broadcast` in the ledger because only its own recipient's retry ever
    // looked, so one abandoned request refused every other wallet forever with
    // an opaque error and no log line.
    const chain = new PendingFundingChain();
    const logged: string[] = [];
    let now = 1_700_000_000_000;
    let requestNumber = 0;
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      log: (message: string) => logged.push(message),
      nowMilliseconds: () => now,
      port: 0,
      requestId: () => `request-stranded-${++requestNumber}`,
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    const requestFunding = (url: string, target: Address) =>
      fundWithProof({ url }, target, {
        "content-type": "application/json",
      });

    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const stranded = yield* Effect.promise(() =>
          requestFunding(server.url, recipient),
        );
        expect(stranded.status).toBe(202);

        // Another wallet arrives while the first request is still open and the
        // receipt is not yet visible: refused, and said so.
        const blocked = yield* Effect.promise(() =>
          requestFunding(server.url, otherRecipient),
        );
        expect(blocked.status).toBe(409);
        expect(yield* Effect.promise(() => blocked.json())).toMatchObject({
          error: { code: "funding-busy" },
        });
        expect(logged.some((line) => line.includes("Refused"))).toBe(true);

        // The receipt becomes visible. Nobody has to come back for the first
        // wallet for the queue to clear.
        chain.receiptState = "confirmed";
        now += 1_000;
        const served = yield* Effect.promise(() =>
          requestFunding(server.url, otherRecipient),
        );
        expect(served.status).toBe(200);
        expect(yield* Effect.promise(() => served.json())).toMatchObject({
          recipient: { address: otherRecipient },
        });
        expect(logged.some((line) => line.includes("Settled a previous"))).toBe(
          true,
        );
      }),
    );
  });

  it("distinguishes receipt RPC outages from onchain-pending transactions and resumes safely", async () => {
    const chain = new ReceiptRpcOutageChain();
    const options = {
      receiptSettleMilliseconds: 0,
      apiToken: undefined,
      chain,
      configuration: configuration({ enabled: true }),
      databasePath: temporaryDatabasePath(),
      host: "127.0.0.1",
      nowMilliseconds: () => 1_700_000_000_000,
      port: 0,
      requestId: () => "request-receipt-outage",
      nonce: nextTestNonce,
      verifySignature: async () => true,
    } as const;
    await withFundingServer(options, (server) =>
      Effect.gen(function* () {
        const unavailable = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(unavailable.status).toBe(503);
        expect(yield* Effect.promise(() => unavailable.json())).toMatchObject({
          request: { state: "retryable" },
          recipient: { state: "pending" },
          error: { code: "funding-rpc-unavailable" },
        });

        chain.receiptAvailable = true;
        chain.receiptState = "confirmed";
        const resumed = yield* Effect.promise(() =>
          fundWithProof(server, recipient, {
            "content-type": "application/json",
          }),
        );
        expect(resumed.status).toBe(200);
        expect(yield* Effect.promise(() => resumed.json())).toMatchObject({
          request: { id: "request-receipt-outage", state: "funded" },
        });
      }),
    );
    expect(chain.prepared.size).toBe(2);
  });

  it("reconciles a known transaction hash when the broadcast response is lost", async () => {
    const chain = new LostBroadcastResponseChain();
    await withFundingServer(
      {
        receiptSettleMilliseconds: 0,
        apiToken: undefined,
        chain,
        configuration: configuration({ enabled: true }),
        databasePath: ":memory:",
        host: "127.0.0.1",
        nowMilliseconds: () => 1_700_000_000_000,
        port: 0,
        requestId: () => "request-lost-response",
        nonce: nextTestNonce,
        verifySignature: async () => true,
      },
      (server) =>
        Effect.gen(function* () {
          const response = yield* Effect.promise(() =>
            fundWithProof(server, recipient, {
              "content-type": "application/json",
            }),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            request: { id: "request-lost-response", state: "funded" },
          });
        }),
    );
    expect(chain.broadcasted.size).toBe(2);
  });
});

describe("testnet funding worker configuration", () => {
  it("derives bounded defaults and keeps the dedicated signer separate from public configuration", () => {
    const privateKey =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const signerAddress = privateKeyToAccount(privateKey).address;
    const resolved = resolveTestnetFundingEnvironment(
      {
        BASE_SEPOLIA_RPC_URL: "https://fallback.invalid",
        RPC_URL: "https://base-sepolia.invalid",
        TESTNET_FUNDING_API_TOKEN: "a".repeat(32),
        TESTNET_FUNDING_ENABLED: "true",
        TESTNET_FUNDING_PROOF_DOMAIN: "orbit.test",
        TESTNET_FUNDING_SIGNER_ADDRESS: signerAddress,
        TESTNET_FUNDING_SIGNER_PRIVATE_KEY: privateKey,
      },
      "/repository",
    );
    expect(resolved).toMatchObject({
      apiToken: "a".repeat(32),
      databasePath: "/repository/.data/testnet-funding.sqlite",
      enabled: true,
      host: "127.0.0.1",
      port: 8_790,
      privateKey,
      rpcUrl: "https://base-sepolia.invalid",
      signer: signerAddress,
      policy: {
        target: {
          wethWei: 100_000_000_000_000_000n,
          ethWei: 10_000_000_000_000_000n,
        },
        cooldownMilliseconds: 86_400_000,
      },
    });
    expect(
      JSON.stringify(resolved, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("NEXT_PUBLIC");
  });

  it("fails closed for weak credentials, signer mismatches, and non-loopback binding", () => {
    const privateKey =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const base = {
      RPC_URL: "https://base-sepolia.invalid",
      TESTNET_FUNDING_API_TOKEN: "a".repeat(32),
      TESTNET_FUNDING_ENABLED: "true",
      TESTNET_FUNDING_PROOF_DOMAIN: "orbit.test",
      TESTNET_FUNDING_SIGNER_ADDRESS: privateKeyToAccount(privateKey).address,
      TESTNET_FUNDING_SIGNER_PRIVATE_KEY: privateKey,
    };
    expect(() =>
      resolveTestnetFundingEnvironment(
        { ...base, TESTNET_FUNDING_API_TOKEN: "weak" },
        "/repository",
      ),
    ).toThrow(/API token/iu);
    expect(() =>
      resolveTestnetFundingEnvironment(
        { ...base, TESTNET_FUNDING_SIGNER_ADDRESS: recipient },
        "/repository",
      ),
    ).toThrow(/does not match/iu);
    expect(() =>
      resolveTestnetFundingEnvironment(
        { ...base, TESTNET_FUNDING_HOST: "0.0.0.0" },
        "/repository",
      ),
    ).toThrow(/loopback/iu);
  });
});

describe("public funding abuse controls", () => {
  const secret = "funding-service-secret";
  const headers = { authorization: `Bearer ${secret}` };
  const jsonHeaders = { ...headers, "content-type": "application/json" };
  const signature = `0x${"ab".repeat(65)}` as const;

  const abuseOptions = (
    overrides: Partial<Parameters<typeof withFundingServer>[0]> = {},
  ) => ({
    receiptSettleMilliseconds: 0,
    apiToken: secret,
    chain: new FakeFundingChain(),
    configuration: configuration({ enabled: true }),
    databasePath: ":memory:",
    host: "127.0.0.1",
    nowMilliseconds: () => 1_700_000_000_000,
    port: 0,
    requestId: () => "request-abuse",
    nonce: nextTestNonce,
    verifySignature: async () => true,
    ...overrides,
  });

  const challengeMessage = async (server: { readonly url: string }) => {
    const response = await fetch(
      `${server.url}/v1/challenge?recipient=${recipient}`,
      { headers },
    );
    const body = (await response.json()) as {
      readonly challenge: { readonly message: string };
    };
    return body.challenge.message;
  };

  it("refuses to fund without a wallet-control proof", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/fund`, {
            body: JSON.stringify({ recipient }),
            headers: jsonHeaders,
            method: "POST",
          }),
        );
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          error: { code: "funding-proof-required" },
        });
      }),
    );
  });

  it("refuses a proof whose signature does not match the recipient", async () => {
    await withFundingServer(
      abuseOptions({ verifySignature: async () => false }),
      (server) =>
        Effect.gen(function* () {
          const message = yield* Effect.promise(() => challengeMessage(server));
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/fund`, {
              body: JSON.stringify({
                proof: { message, signature },
                recipient,
              }),
              headers: jsonHeaders,
              method: "POST",
            }),
          );
          expect(response.status).toBe(401);
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            error: { code: "funding-proof-invalid" },
          });
        }),
    );
  });

  it("refuses a proof bound to a different recipient", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const message = yield* Effect.promise(() => challengeMessage(server));
        const response = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/fund`, {
            body: JSON.stringify({
              proof: { message, signature },
              recipient: "0x9000000000000000000000000000000000000009",
            }),
            headers: jsonHeaders,
            method: "POST",
          }),
        );
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          error: { code: "funding-proof-invalid" },
        });
      }),
    );
  });

  it("refuses a replayed proof after its nonce is consumed", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const message = yield* Effect.promise(() => challengeMessage(server));
        const send = () =>
          fetch(`${server.url}/v1/fund`, {
            body: JSON.stringify({
              proof: { message, signature },
              recipient,
            }),
            headers: jsonHeaders,
            method: "POST",
          });
        yield* Effect.promise(send);
        const replay = yield* Effect.promise(send);
        expect(replay.status).toBe(409);
        expect(yield* Effect.promise(() => replay.json())).toMatchObject({
          error: { code: "funding-proof-replayed" },
        });
      }),
    );
  });

  it("throttles a client that exceeds its funding window", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        let status = 0;
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const response = yield* Effect.promise(() =>
            fetch(`${server.url}/v1/fund`, {
              body: JSON.stringify({ recipient }),
              headers: jsonHeaders,
              method: "POST",
            }),
          );
          status = response.status;
          yield* Effect.promise(() => response.text());
        }
        expect(status).toBe(429);
      }),
    );
  });

  it("reports the depletion alert without exposing signer detail", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/status?recipient=${recipient}`, { headers }),
        );
        const text = yield* Effect.promise(() => response.text());
        expect(JSON.parse(text)).toMatchObject({
          service: {
            budget: { alert: "normal", grantsUsed: 0 },
            halted: false,
          },
        });
        expect(text).not.toContain(secret);
        expect(text).not.toContain(signer.toLowerCase());
      }),
    );
  });

  it("halts funding immediately through the operator kill switch", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const halt = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/control/disable`, {
            headers: jsonHeaders,
            method: "POST",
          }),
        );
        expect(halt.status).toBe(200);
        expect(yield* Effect.promise(() => halt.json())).toMatchObject({
          service: { disabled: true },
        });

        const blocked = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/fund`, {
            body: JSON.stringify({ recipient }),
            headers: jsonHeaders,
            method: "POST",
          }),
        );
        expect(blocked.status).toBe(503);
        expect(yield* Effect.promise(() => blocked.json())).toMatchObject({
          error: { code: "funding-disabled" },
        });

        const challenge = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/challenge?recipient=${recipient}`, {
            headers,
          }),
        );
        expect(challenge.status).toBe(503);

        const lifted = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/control/enable`, {
            headers: jsonHeaders,
            method: "POST",
          }),
        );
        expect(yield* Effect.promise(() => lifted.json())).toMatchObject({
          service: { disabled: false },
        });
      }),
    );
  });

  it("keeps the control plane behind the service token", async () => {
    await withFundingServer(abuseOptions(), (server) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(`${server.url}/v1/control/disable`, { method: "POST" }),
        );
        expect(response.status).toBe(401);
        yield* Effect.promise(() => response.text());
      }),
    );
  });
});
