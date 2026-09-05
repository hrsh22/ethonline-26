import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOperatorCommandMessage } from "@orbit/config/operator-control";

import {
  applyOperatorControlCommand,
  readOperatorControlState,
  type OperatorControlDependencies,
} from "./service.ts";
import { openOperatorControlStore } from "./store.ts";

const ACTOR = "0x1000000000000000000000000000000000000001" as const;
const OTHER = "0x2000000000000000000000000000000000000002" as const;
const FINGERPRINT = `0x${"f".repeat(64)}`;
const SIGNATURE = `0x${"ab".repeat(65)}` as const;
const NOW = 1_800_000_000_000;

const commandId = (seed: number): string => seed.toString(16).padStart(32, "0");

describe("operator control plane", () => {
  let directory: string;
  let path: string;
  let now = NOW;

  const dependencies = (
    overrides: Partial<OperatorControlDependencies> = {},
  ): OperatorControlDependencies => ({
    configuration: {
      chainId: 84_532,
      deploymentFingerprint: FINGERPRINT,
      domain: "orbit.test",
      heartbeatStaleAfterMilliseconds: 60_000,
      intervalMilliseconds: 300_000,
    },
    now: () => now,
    store: openOperatorControlStore(path),
    verifySignature: async () => true,
    ...overrides,
  });

  const signedCommand = (
    command: Parameters<typeof createOperatorCommandMessage>[0]["command"],
    id: string,
    overrides: Partial<Parameters<typeof createOperatorCommandMessage>[0]> = {},
  ) => ({
    message: createOperatorCommandMessage({
      actor: ACTOR,
      chainId: 84_532,
      command,
      commandId: id,
      deploymentFingerprint: FINGERPRINT,
      domain: "orbit.test",
      issuedAtMilliseconds: now,
      uri: "https://orbit.test/admin",
      ...overrides,
    }),
    signature: SIGNATURE,
  });

  const actor = { address: ACTOR, role: "keeper" } as const;

  beforeEach(() => {
    now = NOW;
    directory = mkdtempSync(join(tmpdir(), "orbit-operator-control-"));
    path = join(directory, "control.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it("fails closed on a fresh store", () => {
    const deps = dependencies();
    expect(readOperatorControlState(deps).desired).toEqual({
      mode: "stopped",
      oneShot: "none",
    });
    expect(readOperatorControlState(deps).service).toBe("offline");
    deps.store.close();
  });

  it("applies an unsigned command that cannot lead to a signature", async () => {
    const deps = dependencies();
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-dry-run",
      commandId: commandId(1),
    });
    expect(outcome).toMatchObject({
      applied: true,
      ok: true,
      policy: { mode: "dry-run" },
    });
    deps.store.close();
  });

  it("refuses to enable live execution without a signed command", async () => {
    const deps = dependencies();
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: commandId(2),
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-required",
      ok: false,
      status: 400,
    });
    expect(deps.store.readPolicy().mode).toBe("stopped");
    deps.store.close();
  });

  it("enables live execution with a valid signed command", async () => {
    const deps = dependencies();
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: commandId(3),
      signedCommand: signedCommand("enable-live", commandId(3)),
    });
    expect(outcome).toMatchObject({ applied: true, ok: true });
    expect(deps.store.readPolicy().mode).toBe("live");
    deps.store.close();
  });

  it.each([
    ["another chain", { chainId: 1 }],
    ["another deployment", { deploymentFingerprint: `0x${"e".repeat(64)}` }],
    ["another site", { domain: "evil.test" }],
    ["another actor", { actor: OTHER }],
  ] as const)("rejects a signed command bound to %s", async (_, overrides) => {
    const deps = dependencies();
    const id = commandId(10);
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: id,
      signedCommand: signedCommand("enable-live", id, overrides),
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-invalid",
      ok: false,
    });
    expect(deps.store.readPolicy().mode).toBe("stopped");
    deps.store.close();
  });

  it("rejects a signature that authorizes a different command", async () => {
    const deps = dependencies();
    const id = commandId(11);
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: id,
      signedCommand: signedCommand("request-live-run", id),
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-invalid",
      ok: false,
    });
    deps.store.close();
  });

  it("rejects a signature reused from another command request", async () => {
    const deps = dependencies();
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: commandId(12),
      signedCommand: signedCommand("enable-live", commandId(13)),
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-invalid",
      ok: false,
    });
    deps.store.close();
  });

  it("rejects an expired signed command", async () => {
    const deps = dependencies();
    const id = commandId(14);
    const signed = signedCommand("enable-live", id);
    now += 10 * 60_000;
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: id,
      signedCommand: signed,
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-invalid",
      ok: false,
    });
    deps.store.close();
  });

  it("rejects a signature the wallet did not produce", async () => {
    const deps = dependencies({ verifySignature: async () => false });
    const id = commandId(15);
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: id,
      signedCommand: signedCommand("enable-live", id),
    });
    expect(outcome).toMatchObject({
      code: "operator-signature-invalid",
      ok: false,
      status: 401,
    });
    deps.store.close();
  });

  it("replays a retried command without applying it twice", async () => {
    const deps = dependencies();
    const id = commandId(20);
    const first = await applyOperatorControlCommand(deps, actor, {
      command: "request-dry-run",
      commandId: id,
    });
    const second = await applyOperatorControlCommand(deps, actor, {
      command: "request-dry-run",
      commandId: id,
    });
    expect(first).toMatchObject({ applied: true });
    expect(second).toMatchObject({ applied: false, result: "applied" });
    expect(deps.store.recentCommands(10)).toHaveLength(1);
    expect(deps.store.readPolicy().oneShot).toBe("dry-run");
    deps.store.close();
  });

  it("refuses to reuse a command id for a different command", async () => {
    const deps = dependencies();
    const id = commandId(21);
    await applyOperatorControlCommand(deps, actor, {
      command: "enable-dry-run",
      commandId: id,
    });
    const conflict = await applyOperatorControlCommand(deps, actor, {
      command: "stop",
      commandId: id,
    });
    expect(conflict).toMatchObject({
      code: "operator-command-conflict",
      ok: false,
      status: 409,
    });
    deps.store.close();
  });

  it("records a rejected transition in the audit without changing policy", async () => {
    const deps = dependencies();
    const outcome = await applyOperatorControlCommand(deps, actor, {
      command: "stop",
      commandId: commandId(22),
    });
    expect(outcome).toMatchObject({ applied: false, result: "no-change" });
    expect(deps.store.readPolicy().mode).toBe("stopped");
    expect(deps.store.recentCommands(5)[0]).toMatchObject({
      result: "no-change",
    });
    deps.store.close();
  });

  it("keeps the policy and its audit across a restart", async () => {
    const first = dependencies();
    await applyOperatorControlCommand(first, actor, {
      command: "enable-dry-run",
      commandId: commandId(30),
    });
    first.store.close();

    const restarted = dependencies();
    expect(restarted.store.readPolicy()).toEqual({
      mode: "dry-run",
      oneShot: "none",
    });
    expect(restarted.store.recentCommands(5)).toHaveLength(1);
    // A restart must not resurrect a live mode that was never set.
    expect(restarted.store.readPolicy().mode).not.toBe("live");
    restarted.store.close();
  });

  it("records actor, role, and both policy sides in the audit", async () => {
    const deps = dependencies();
    await applyOperatorControlCommand(
      deps,
      { address: ACTOR, role: "liquidity-executor" },
      { command: "enable-dry-run", commandId: commandId(31) },
    );
    expect(readOperatorControlState(deps).audit[0]).toMatchObject({
      actor: ACTOR.toLowerCase(),
      command: "enable-dry-run",
      next: "dry-run",
      previous: "stopped",
      result: "applied",
      role: "liquidity-executor",
    });
    deps.store.close();
  });

  it("reports service state from the heartbeat, never from the policy", async () => {
    const deps = dependencies();
    await applyOperatorControlCommand(deps, actor, {
      command: "enable-live",
      commandId: commandId(40),
      signedCommand: signedCommand("enable-live", commandId(40)),
    });
    // Live policy, no heartbeat: the service is offline.
    expect(readOperatorControlState(deps).service).toBe("offline");

    deps.store.recordHeartbeat({
      at: now,
      observedMode: "live",
      supervisor: "supervisor-1",
    });
    expect(readOperatorControlState(deps).service).toBe("online");

    now += 120_000;
    expect(readOperatorControlState(deps).service).toBe("degraded");
    now += 600_000;
    expect(readOperatorControlState(deps).service).toBe("offline");
    deps.store.close();
  });

  it("reports the next run from the observed heartbeat and interval", () => {
    const deps = dependencies();
    deps.store.recordHeartbeat({
      at: now,
      observedMode: "dry-run",
      supervisor: "supervisor-1",
    });
    expect(readOperatorControlState(deps).nextRunAt).toBe(now + 300_000);
    deps.store.close();
  });

  it("serialises two supervisors at the durable writer lease", () => {
    const deps = dependencies();
    expect(
      deps.store.acquireWriterLease({
        holder: "supervisor-1",
        leaseMilliseconds: 60_000,
        now,
      }),
    ).toBe(true);
    expect(
      deps.store.acquireWriterLease({
        holder: "supervisor-2",
        leaseMilliseconds: 60_000,
        now,
      }),
    ).toBe(false);
    // The holder may renew its own lease.
    expect(
      deps.store.acquireWriterLease({
        holder: "supervisor-1",
        leaseMilliseconds: 60_000,
        now: now + 1_000,
      }),
    ).toBe(true);
    deps.store.close();
  });

  it("lets another supervisor take over an expired lease", () => {
    const deps = dependencies();
    deps.store.acquireWriterLease({
      holder: "supervisor-1",
      leaseMilliseconds: 1_000,
      now,
    });
    expect(
      deps.store.acquireWriterLease({
        holder: "supervisor-2",
        leaseMilliseconds: 60_000,
        now: now + 5_000,
      }),
    ).toBe(true);
    expect(deps.store.readWriterLease()?.holder).toBe("supervisor-2");
    deps.store.close();
  });

  it("keeps a lease across a restart so a crash cannot double-broadcast", () => {
    const first = dependencies();
    first.store.acquireWriterLease({
      holder: "supervisor-1",
      leaseMilliseconds: 60_000,
      now,
    });
    first.store.close();

    const restarted = dependencies();
    expect(
      restarted.store.acquireWriterLease({
        holder: "supervisor-2",
        leaseMilliseconds: 60_000,
        now: now + 1_000,
      }),
    ).toBe(false);
    restarted.store.close();
  });

  it("reports a sanitized failure and a broadcast hash for the latest run", () => {
    const deps = dependencies();
    deps.store.startRun({
      authority: "execute",
      runId: "run-1",
      startedAt: now,
    });
    deps.store.finishRun({
      finishedAt: now + 5_000,
      outcome: "failed",
      runId: "run-1",
      sanitizedFailure: "RPC unavailable",
      transactionHash: `0x${"cd".repeat(32)}`,
    });
    expect(readOperatorControlState(deps).latestRun).toMatchObject({
      authority: "execute",
      outcome: "failed",
      sanitizedFailure: "RPC unavailable",
      transactionHash: `0x${"cd".repeat(32)}`,
    });
    deps.store.close();
  });

  it("consumes a queued pass exactly once, even across a restart", async () => {
    const first = dependencies();
    await applyOperatorControlCommand(first, actor, {
      command: "request-dry-run",
      commandId: commandId(50),
    });
    first.store.close();

    const restarted = dependencies();
    expect(restarted.store.readPolicy().oneShot).toBe("dry-run");
    expect(restarted.store.consumeOneShot(now)).toEqual({
      mode: "stopped",
      oneShot: "none",
    });
    expect(restarted.store.consumeOneShot(now)).toEqual({
      mode: "stopped",
      oneShot: "none",
    });
    restarted.store.close();
  });

  it("lets a stop discard a queued live pass before it can sign", async () => {
    const deps = dependencies();
    const requestId = commandId(60);
    await applyOperatorControlCommand(deps, actor, {
      command: "request-live-run",
      commandId: requestId,
      signedCommand: signedCommand("request-live-run", requestId),
    });
    expect(deps.store.readPolicy().oneShot).toBe("live");
    await applyOperatorControlCommand(deps, actor, {
      command: "stop",
      commandId: commandId(61),
    });
    expect(deps.store.readPolicy()).toEqual({
      mode: "stopped",
      oneShot: "none",
    });
    deps.store.close();
  });
});
