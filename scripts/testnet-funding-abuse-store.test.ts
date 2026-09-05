import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTestnetFundingStore } from "./testnet-funding/sqlite-store.ts";

const identity = {
  chainId: 84_532,
  signer: "0x1000000000000000000000000000000000000001" as const,
};

const recipient = "0x2000000000000000000000000000000000000002" as const;
const other = "0x3000000000000000000000000000000000000003" as const;
const nonce = "a".repeat(32);

describe("durable funding abuse controls", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "orbit-funding-abuse-"));
    path = join(directory, "funding.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it("consumes a wallet-control nonce exactly once", () => {
    const store = openTestnetFundingStore(path, identity);
    store.recordNonce({
      nonce,
      recipient,
      issuedAt: 1_000,
      expiresAt: 300_000,
    });

    expect(
      store.consumeNonce({ nonce, recipient, nowMilliseconds: 2_000 }),
    ).toEqual({ ok: true });
    expect(
      store.consumeNonce({ nonce, recipient, nowMilliseconds: 3_000 }),
    ).toEqual({ ok: false, reason: "consumed" });
    store.close();
  });

  it("refuses an unknown, expired, or foreign-recipient nonce", () => {
    const store = openTestnetFundingStore(path, identity);
    expect(
      store.consumeNonce({ nonce, recipient, nowMilliseconds: 1_000 }),
    ).toEqual({ ok: false, reason: "unknown" });

    store.recordNonce({
      nonce,
      recipient,
      issuedAt: 1_000,
      expiresAt: 2_000,
    });
    expect(
      store.consumeNonce({ nonce, recipient, nowMilliseconds: 5_000 }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      store.consumeNonce({ nonce, recipient: other, nowMilliseconds: 1_500 }),
    ).toEqual({ ok: false, reason: "expired" });
    store.close();
  });

  it("keeps a consumed nonce unusable across a restart", () => {
    const first = openTestnetFundingStore(path, identity);
    first.recordNonce({
      nonce,
      recipient,
      issuedAt: 1_000,
      expiresAt: 300_000,
    });
    expect(
      first.consumeNonce({ nonce, recipient, nowMilliseconds: 2_000 }),
    ).toEqual({ ok: true });
    first.close();

    const restarted = openTestnetFundingStore(path, identity);
    expect(
      restarted.consumeNonce({ nonce, recipient, nowMilliseconds: 3_000 }),
    ).toEqual({ ok: false, reason: "consumed" });
    restarted.close();
  });

  it("prunes only expired nonces", () => {
    const store = openTestnetFundingStore(path, identity);
    store.recordNonce({ nonce, recipient, issuedAt: 1_000, expiresAt: 2_000 });
    store.recordNonce({
      nonce: "b".repeat(32),
      recipient,
      issuedAt: 1_000,
      expiresAt: 900_000,
    });
    store.pruneNonces(5_000);

    expect(
      store.consumeNonce({ nonce, recipient, nowMilliseconds: 6_000 }),
    ).toEqual({ ok: false, reason: "unknown" });
    expect(
      store.consumeNonce({
        nonce: "b".repeat(32),
        recipient,
        nowMilliseconds: 6_000,
      }),
    ).toEqual({ ok: true });
    store.close();
  });

  it("accumulates window spend and survives a restart", () => {
    const first = openTestnetFundingStore(path, identity);
    first.recordBudgetSpend({ windowStart: 100, wethWei: 5n, ethWei: 2n });
    first.recordBudgetSpend({ windowStart: 100, wethWei: 7n, ethWei: 3n });
    expect(first.readBudgetUsage(100)).toEqual({
      windowStart: 100,
      wethWei: 12n,
      ethWei: 5n,
      grants: 2,
    });
    first.close();

    // A restart must not hand an attacker a fresh budget.
    const restarted = openTestnetFundingStore(path, identity);
    expect(restarted.readBudgetUsage(100)).toEqual({
      windowStart: 100,
      wethWei: 12n,
      ethWei: 5n,
      grants: 2,
    });
    expect(restarted.readBudgetUsage(200)).toEqual({
      windowStart: 200,
      wethWei: 0n,
      ethWei: 0n,
      grants: 0,
    });
    restarted.close();
  });

  it("counts client attempts per window and survives a restart", () => {
    const first = openTestnetFundingStore(path, identity);
    expect(
      first.recordClientAttempt({ clientKey: "1.2.3.4", windowStart: 10 }),
    ).toBe(1);
    expect(
      first.recordClientAttempt({ clientKey: "1.2.3.4", windowStart: 10 }),
    ).toBe(2);
    expect(
      first.recordClientAttempt({ clientKey: "5.6.7.8", windowStart: 10 }),
    ).toBe(1);
    first.close();

    const restarted = openTestnetFundingStore(path, identity);
    expect(
      restarted.recordClientAttempt({ clientKey: "1.2.3.4", windowStart: 10 }),
    ).toBe(3);
    expect(
      restarted.recordClientAttempt({ clientKey: "1.2.3.4", windowStart: 20 }),
    ).toBe(1);
    restarted.close();
  });

  it("persists the emergency halt across a restart and can lift it", () => {
    const first = openTestnetFundingStore(path, identity);
    expect(first.readServiceDisabledAt()).toBeUndefined();
    first.setServiceDisabled(4_242);
    expect(first.readServiceDisabledAt()).toBe(4_242);
    first.close();

    const restarted = openTestnetFundingStore(path, identity);
    expect(restarted.readServiceDisabledAt()).toBe(4_242);
    restarted.setServiceDisabled(undefined);
    expect(restarted.readServiceDisabledAt()).toBeUndefined();
    restarted.close();
  });
});
