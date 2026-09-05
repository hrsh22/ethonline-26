import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { parseEther, type Address, type Hex } from "viem";

import type {
  PreparedReplenishment,
  ReplenishChain,
  ReplenishChainInspection,
  ReplenishReceiptState,
} from "./testnet-funding-replenisher/chain.ts";
import {
  resolveReplenisherEnvironment,
  type ReplenishAmounts,
  type ReplenishPolicy,
} from "./testnet-funding-replenisher/configuration.ts";
import {
  openReplenishLedger,
  replenishWindowStart,
  type ReplenishLedger,
} from "./testnet-funding-replenisher/ledger.ts";
import {
  planReplenishment,
  runReplenishCycle,
  validateReplenishInspection,
  type ReplenishGuard,
} from "./testnet-funding-replenisher/replenish.ts";

const treasury = "0x1000000000000000000000000000000000000001" as Address;
const signer = "0x2000000000000000000000000000000000000002" as Address;
const outsider = "0x3000000000000000000000000000000000000003" as Address;
const treasuryKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-replenisher-"));
  temporaryDirectories.push(directory);
  return join(directory, "replenisher.sqlite");
};

const amounts = (weth: string, eth: string): ReplenishAmounts => ({
  ethWei: parseEther(eth),
  wethWei: parseEther(weth),
});

const policy: ReplenishPolicy = {
  dailyLimit: amounts("4", "0.4"),
  minimum: amounts("0.2", "0.02"),
  topUp: amounts("2", "0.2"),
};

const guard: ReplenishGuard = {
  chainId: 84_532,
  privilegedAddresses: new Set([outsider]),
  signer,
  treasury,
};

const inspection = (
  overrides: Partial<ReplenishChainInspection> = {},
): ReplenishChainInspection => ({
  chainId: 84_532,
  deploymentSender: outsider,
  signerBalance: amounts("0", "0"),
  treasury,
  treasuryBalance: amounts("100", "10"),
  treasuryCode: "0x",
  usdcOperator: outsider,
  wethOperator: outsider,
  ...overrides,
});

interface FakeChainOptions {
  readonly broadcastFails?: boolean;
  readonly receipts?: Readonly<Record<string, ReplenishReceiptState>>;
  readonly signerBalance?: ReplenishAmounts;
  readonly treasuryBalance?: ReplenishAmounts;
}

interface FakeChain extends ReplenishChain {
  readonly broadcasts: Hex[];
  readonly prepared: PreparedReplenishment[];
}

const fakeChain = (options: FakeChainOptions = {}): FakeChain => {
  const broadcasts: Hex[] = [];
  const prepared: PreparedReplenishment[] = [];
  let sequence = 0;
  return {
    broadcasts,
    prepared,
    broadcast: (rawTransaction) => {
      broadcasts.push(rawTransaction);
      return options.broadcastFails === true
        ? Effect.fail(new Error("broadcast rejected"))
        : Effect.succeed(rawTransaction);
    },
    inspect: () =>
      Effect.succeed(
        inspection({
          ...(options.signerBalance === undefined
            ? {}
            : { signerBalance: options.signerBalance }),
          ...(options.treasuryBalance === undefined
            ? {}
            : { treasuryBalance: options.treasuryBalance }),
        }),
      ),
    prepare: ({ amountWei, asset }) => {
      sequence += 1;
      const hash = `0x${sequence.toString(16).padStart(64, "0")}` as Hex;
      const replenishment: PreparedReplenishment = {
        amountWei,
        asset,
        hash,
        rawTransaction: hash,
      };
      prepared.push(replenishment);
      return Effect.succeed(replenishment);
    },
    receipt: (hash) =>
      Effect.succeed(options.receipts?.[hash] ?? ("confirmed" as const)),
  };
};

let replenishmentSequence = 0;

const cycleOptions = (
  chain: ReplenishChain,
  ledger: ReplenishLedger,
  nowMilliseconds: number,
) => ({
  chain,
  guard,
  ledger,
  nowMilliseconds: () => nowMilliseconds,
  policy,
  replenishmentId: () => {
    replenishmentSequence += 1;
    return `replenishment-${replenishmentSequence}`;
  },
});

const ledgerIdentity = { chainId: 84_532, signer, treasury } as const;

describe("funding replenisher policy", () => {
  it("tops up only what is below its minimum, by a fixed amount", () => {
    expect(
      planReplenishment(policy, {
        signerBalance: amounts("0.1", "1"),
        treasuryBalance: amounts("100", "10"),
        windowUsage: amounts("0", "0"),
      }),
    ).toEqual([
      { amountWei: parseEther("2"), asset: "weth", outcome: "due" },
      { amountWei: 0n, asset: "eth", outcome: "sufficient" },
    ]);
  });

  it("refuses to exceed the window ceiling or empty the treasury", () => {
    // The ceiling is what stops a restart loop from draining the treasury one
    // "first" top-up at a time.
    expect(
      planReplenishment(policy, {
        signerBalance: amounts("0", "0"),
        treasuryBalance: amounts("100", "10"),
        windowUsage: amounts("3", "0.3"),
      }).map(({ outcome }) => outcome),
    ).toEqual(["daily-limit", "daily-limit"]);
    expect(
      planReplenishment(policy, {
        signerBalance: amounts("0", "0"),
        treasuryBalance: amounts("1", "0.1"),
        windowUsage: amounts("0", "0"),
      }).map(({ outcome }) => outcome),
    ).toEqual(["treasury-exhausted", "treasury-exhausted"]);
  });

  it("keeps enough ETH in the treasury to pay for its own transfers", () => {
    // 0.2005 covers the top-up but leaves less than the gas reserve behind, so
    // sending it would strand the treasury unable to send the next one.
    expect(
      planReplenishment(policy, {
        signerBalance: amounts("10", "0"),
        treasuryBalance: amounts("100", "0.2005"),
        windowUsage: amounts("0", "0"),
      })[1],
    ).toMatchObject({ asset: "eth", outcome: "treasury-exhausted" });
    expect(
      planReplenishment(policy, {
        signerBalance: amounts("10", "0"),
        treasuryBalance: amounts("100", "0.202"),
        windowUsage: amounts("0", "0"),
      })[1],
    ).toMatchObject({ asset: "eth", outcome: "due" });
  });
});

describe("funding replenisher guard", () => {
  it("refuses a treasury that is anything more than a disposable float", () => {
    expect(() =>
      validateReplenishInspection(guard, inspection({ chainId: 8_453 })),
    ).toThrow(/wrong chain/u);
    expect(() =>
      validateReplenishInspection(guard, inspection({ treasuryCode: "0x60" })),
    ).toThrow(/externally owned/u);
    // A treasury holding a protocol role would turn a compromise of this
    // process into a compromise of the deployment.
    expect(() =>
      validateReplenishInspection(
        { ...guard, privilegedAddresses: new Set([treasury]) },
        inspection(),
      ),
    ).toThrow(/privileged protocol role/u);
    expect(() =>
      validateReplenishInspection(
        guard,
        inspection({ wethOperator: treasury }),
      ),
    ).toThrow(/privileged protocol role/u);
    expect(() =>
      validateReplenishInspection({ ...guard, signer: treasury }, inspection()),
    ).toThrow(/cannot replenish itself/u);
  });
});

describe("funding replenisher configuration", () => {
  it("is disabled until it is armed, and fails closed once it is", () => {
    // Disabled has to be a state rather than a startup failure: the supervisor
    // stops the whole backend group when any child exits.
    expect(resolveReplenisherEnvironment({}, "/repo")).toEqual({
      enabled: false,
    });
    expect(() =>
      resolveReplenisherEnvironment(
        { TESTNET_FUNDING_REPLENISH_ENABLED: "true" },
        "/repo",
      ),
    ).toThrow(/TESTNET_FUNDING_TREASURY_PRIVATE_KEY is required/u);
    expect(() =>
      resolveReplenisherEnvironment(
        {
          RPC_URL: "https://sepolia.example",
          TESTNET_FUNDING_REPLENISH_ENABLED: "true",
          TESTNET_FUNDING_SIGNER_ADDRESS: signer,
          TESTNET_FUNDING_TREASURY_ADDRESS: treasury,
          TESTNET_FUNDING_TREASURY_PRIVATE_KEY: treasuryKey,
        },
        "/repo",
      ),
    ).toThrow(/does not match its private key/u);
  });

  it("rejects bounds that could never behave", () => {
    const base = {
      RPC_URL: "https://sepolia.example",
      TESTNET_FUNDING_REPLENISH_ENABLED: "true",
      TESTNET_FUNDING_SIGNER_ADDRESS: signer,
      TESTNET_FUNDING_TREASURY_ADDRESS:
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      TESTNET_FUNDING_TREASURY_PRIVATE_KEY: treasuryKey,
    };
    expect(resolveReplenisherEnvironment(base, "/repo")).toMatchObject({
      enabled: true,
    });
    // A top-up below its own minimum would run on every cycle forever, and one
    // above its ceiling could never be sent at all.
    expect(() =>
      resolveReplenisherEnvironment(
        { ...base, TESTNET_FUNDING_REPLENISH_TOPUP_ETH: "0.01" },
        "/repo",
      ),
    ).toThrow(/TOPUP_ETH must exceed its minimum/u);
    expect(() =>
      resolveReplenisherEnvironment(
        { ...base, TESTNET_FUNDING_REPLENISH_TOPUP_WETH: "5" },
        "/repo",
      ),
    ).toThrow(/TOPUP_WETH exceeds its daily limit/u);
  });
});

describe("funding replenisher cycle", () => {
  it("persists a transfer before broadcasting it", async () => {
    const ledger = openReplenishLedger(":memory:", ledgerIdentity);
    const chain = fakeChain({ signerBalance: amounts("0", "1") });
    const report = await Effect.runPromise(
      runReplenishCycle(cycleOptions(chain, ledger, 1_700_000_000_000)),
    );
    expect(report.submitted).toHaveLength(1);
    expect(report.submitted[0]).toMatchObject({
      amountWei: parseEther("2"),
      asset: "weth",
      state: "broadcast",
    });
    expect(chain.broadcasts).toEqual([chain.prepared[0]?.rawTransaction]);
    ledger.close();
  });

  it("keeps the window ceiling across a restart", async () => {
    const path = temporaryDatabasePath();
    const now = 1_700_000_000_000;
    const first = openReplenishLedger(path, ledgerIdentity);
    await Effect.runPromise(
      runReplenishCycle(
        cycleOptions(
          fakeChain({ signerBalance: amounts("0", "1") }),
          first,
          now,
        ),
      ),
    );
    first.close();

    // A ceiling held only in memory would let a crash loop send one "first"
    // top-up per restart until the treasury was empty.
    const second = openReplenishLedger(path, ledgerIdentity);
    expect(second.readWindowUsage(replenishWindowStart(now))).toEqual({
      ethWei: 0n,
      wethWei: parseEther("2"),
    });
    second.close();
  });

  it("rebroadcasts a transfer that was persisted but never sent", async () => {
    const path = temporaryDatabasePath();
    const now = 1_700_000_000_000;
    const crashing = openReplenishLedger(path, ledgerIdentity);
    const failing = fakeChain({
      broadcastFails: true,
      signerBalance: amounts("0", "1"),
    });
    await expect(
      Effect.runPromise(
        runReplenishCycle(cycleOptions(failing, crashing, now)),
      ),
    ).rejects.toThrow(/broadcast rejected/u);
    crashing.close();

    const resumed = openReplenishLedger(path, ledgerIdentity);
    expect(resumed.readUnsettled()).toHaveLength(1);
    const chain = fakeChain({ signerBalance: amounts("10", "10") });
    const report = await Effect.runPromise(
      runReplenishCycle(cycleOptions(chain, resumed, now)),
    );
    // Its nonce is already burned, so the only way forward is to send the
    // transaction that was signed, not to sign a new one.
    expect(chain.broadcasts).toHaveLength(1);
    expect(chain.prepared).toHaveLength(0);
    expect(report.settled).toBe(1);
    expect(resumed.readUnsettled()).toHaveLength(0);
    resumed.close();
  });

  it("stops charging the window for a transfer that reverted", async () => {
    const path = temporaryDatabasePath();
    const now = 1_700_000_000_000;
    const ledger = openReplenishLedger(path, ledgerIdentity);
    const submitting = fakeChain({ signerBalance: amounts("0", "1") });
    await Effect.runPromise(
      runReplenishCycle(cycleOptions(submitting, ledger, now)),
    );
    const hash = submitting.prepared[0]?.hash ?? "0x";
    expect(ledger.readWindowUsage(replenishWindowStart(now))).toMatchObject({
      wethWei: parseEther("2"),
    });

    await Effect.runPromise(
      runReplenishCycle(
        cycleOptions(
          fakeChain({
            receipts: { [hash]: "reverted" },
            signerBalance: amounts("10", "10"),
          }),
          ledger,
          now,
        ),
      ),
    );
    // Its nonce was consumed but nothing moved, so charging the day for it
    // would silently shrink the real allowance.
    expect(ledger.readWindowUsage(replenishWindowStart(now))).toEqual({
      ethWei: 0n,
      wethWei: 0n,
    });
    ledger.close();
  });

  it("plans nothing while a transfer is still in flight", async () => {
    const path = temporaryDatabasePath();
    const now = 1_700_000_000_000;
    const ledger = openReplenishLedger(path, ledgerIdentity);
    const submitting = fakeChain({ signerBalance: amounts("0", "1") });
    await Effect.runPromise(
      runReplenishCycle(cycleOptions(submitting, ledger, now)),
    );
    const hash = submitting.prepared[0]?.hash ?? "0x";

    const pending = fakeChain({
      receipts: { [hash]: "pending" },
      signerBalance: amounts("0", "1"),
    });
    const report = await Effect.runPromise(
      runReplenishCycle(cycleOptions(pending, ledger, now)),
    );
    // Signing against the same pending nonce would replace the in-flight
    // transfer rather than add to it.
    expect(report).toMatchObject({
      decisions: [],
      submitted: [],
      unsettled: 1,
    });
    expect(pending.prepared).toHaveLength(0);
    ledger.close();
  });

  it("binds its ledger to one treasury and destination", () => {
    const path = temporaryDatabasePath();
    openReplenishLedger(path, ledgerIdentity).close();
    // Inheriting another pair's window ceiling would hand a fresh treasury a
    // spent day, or a spent one a fresh day.
    expect(() =>
      openReplenishLedger(path, { ...ledgerIdentity, treasury: outsider }),
    ).toThrow(/treasury does not match/u);
  });
});
