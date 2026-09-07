import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOperatorSupervisor } from "./runtime.ts";
import { openOperatorControlStore } from "./store.ts";

const NOW = 1_800_000_000_000;

describe("operator supervisor", () => {
  let directory: string;
  let path: string;
  let now = NOW;

  const supervisor = (id: string) => {
    const store = openOperatorControlStore(path);
    return {
      store,
      supervisor: createOperatorSupervisor({
        leaseMilliseconds: 60_000,
        now: () => now,
        store,
        supervisorId: id,
      }),
    };
  };

  beforeEach(() => {
    now = NOW;
    directory = mkdtempSync(join(tmpdir(), "orbit-operator-runtime-"));
    path = join(directory, "control.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it("skips every cycle while the policy is stopped", () => {
    const first = supervisor("supervisor-1");
    const grant = first.supervisor.beginCycle();
    expect(grant?.authority).toBe("skip");
    expect(grant?.maySignNow()).toBe(false);
    expect(first.store.readLatestRun()).toBeUndefined();
    first.store.close();
  });

  it("records a heartbeat even for a skipped cycle", () => {
    const first = supervisor("supervisor-1");
    first.supervisor.beginCycle();
    expect(first.store.readHeartbeat()).toMatchObject({
      observedMode: "stopped",
      supervisor: "supervisor-1",
    });
    first.store.close();
  });

  it("plans without signing under a dry-run policy", () => {
    const first = supervisor("supervisor-1");
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "enable-dry-run",
      commandId: "a".repeat(32),
      nextMode: "dry-run",
      nextOneShot: "none",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    const grant = first.supervisor.beginCycle();
    expect(grant?.authority).toBe("dry-run");
    expect(grant?.maySignNow()).toBe(false);
    expect(first.store.readLatestRun()).toMatchObject({
      authority: "dry-run",
      outcome: "running",
    });
    first.store.close();
  });

  const enableLive = (store: ReturnType<typeof openOperatorControlStore>) => {
    store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "enable-live",
      commandId: "b".repeat(32),
      nextMode: "live",
      nextOneShot: "none",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
  };

  it("permits the signing boundary under a live policy", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle();
    expect(grant?.authority).toBe("execute");
    expect(grant?.maySignNow()).toBe(true);
    first.store.close();
  });

  it.each([0, -1_000, 1_000])(
    "prevents signing after Stop with a %i ms clock change",
    (clockChange) => {
      const first = supervisor("supervisor-1");
      enableLive(first.store);
      const grant = first.supervisor.beginCycle();
      expect(grant?.maySignNow()).toBe(true);

      now += clockChange;
      first.store.applyCommand({
        actor: "0x1",
        appliedAt: now,
        command: "stop",
        commandId: "c".repeat(32),
        nextMode: "stopped",
        nextOneShot: "none",
        previousMode: "live",
        previousOneShot: "none",
        result: "applied",
        role: "keeper",
        transactionHash: undefined,
      });
      expect(grant?.maySignNow()).toBe(false);
      first.store.close();
    },
  );

  it("still reports a transaction already broadcast before the stop", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle();
    const hash = `0x${"ab".repeat(32)}`;
    grant?.finish({ outcome: "completed", transactionHash: hash });
    expect(first.store.readLatestRun()).toMatchObject({
      outcome: "completed",
      transactionHash: hash,
    });
    first.store.close();
  });

  it("claims a queued live pass once and does not replay it after a restart", () => {
    const first = supervisor("supervisor-1");
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "request-live-run",
      commandId: "d".repeat(32),
      nextMode: "stopped",
      nextOneShot: "live",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    const grant = first.supervisor.beginCycle();
    expect(grant?.authority).toBe("execute");
    // Consuming the pass must not read as an operator's stop.
    expect(grant?.maySignNow()).toBe(true);
    grant?.finish({ outcome: "completed" });
    first.supervisor.release();
    first.store.close();

    const restarted = supervisor("supervisor-1");
    expect(restarted.supervisor.beginCycle()?.authority).toBe("skip");
    restarted.store.close();
  });

  it.each(["none", "live"] as const)(
    "resumes an authorized live policy after a restart with queued pass %s",
    (oneShot) => {
      const first = supervisor("supervisor-1");
      expect(first.supervisor.initialize("deployment-a")).toBe(true);
      enableLive(first.store);
      if (oneShot === "live")
        first.store.applyCommand({
          actor: "0x1",
          appliedAt: now,
          command: "request-live-run",
          commandId: "queued-pass",
          nextMode: "live",
          nextOneShot: "live",
          previousMode: "live",
          previousOneShot: "none",
          result: "applied",
          role: "keeper",
          transactionHash: undefined,
        });
      first.store.close();
      const restarted = supervisor("supervisor-2");
      expect(restarted.supervisor.initialize("deployment-a")).toBe(true);
      expect(restarted.store.readPolicy()).toEqual({ mode: "live", oneShot });
      expect(restarted.supervisor.beginCycle()?.maySignNow()).toBe(true);
      expect(restarted.store.readPolicy().oneShot).toBe("none");
      restarted.supervisor.release();
      restarted.store.close();
    },
  );

  it("keeps an explicit Stop across restarts and requires new authorization for a changed deployment", () => {
    const first = supervisor("supervisor-1");
    first.supervisor.initialize("deployment-a");
    enableLive(first.store);
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "stop",
      commandId: "stop",
      nextMode: "stopped",
      nextOneShot: "none",
      previousMode: "live",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    first.supervisor.initialize("deployment-a");
    expect(first.store.readPolicy().mode).toBe("stopped");
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "enable-live",
      commandId: "resume",
      nextMode: "live",
      nextOneShot: "none",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    first.store.close();
    const restarted = supervisor("supervisor-2");
    restarted.supervisor.initialize("deployment-b");
    expect(restarted.supervisor.beginCycle()?.maySignNow()).toBe(false);
    expect(restarted.store.readPolicy()).toEqual({
      mode: "stopped",
      oneShot: "none",
    });
    restarted.supervisor.release();
    restarted.store.close();
  });

  it("does not reset the policy when another supervisor still owns the lease", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle()!;
    const second = supervisor("supervisor-2");
    expect(second.supervisor.initialize("deployment-a")).toBe(false);
    expect(grant.maySignNow()).toBe(true);
    second.store.close();
    first.store.close();
  });

  it("blocks a claimed live pass when a stop arrives before signing", () => {
    const first = supervisor("supervisor-1");
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "request-live-run",
      commandId: "e".repeat(32),
      nextMode: "stopped",
      nextOneShot: "live",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    const grant = first.supervisor.beginCycle();
    now += 1_000;
    first.store.applyCommand({
      actor: "0x1",
      appliedAt: now,
      command: "stop",
      commandId: "f".repeat(32),
      nextMode: "stopped",
      nextOneShot: "none",
      previousMode: "stopped",
      previousOneShot: "none",
      result: "applied",
      role: "keeper",
      transactionHash: undefined,
    });
    expect(grant?.maySignNow()).toBe(false);
    first.store.close();
  });

  it("refuses a second supervisor while the lease is held", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    expect(first.supervisor.beginCycle()).toBeDefined();

    const second = supervisor("supervisor-2");
    expect(second.supervisor.beginCycle()).toBeUndefined();
    second.store.close();
    first.store.close();
  });

  it("renews an active run exclusively and cannot revive an expired grant", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle()!;
    now += 40_000;
    expect(grant.renew()).toBe(true);
    now += 40_000;
    const second = supervisor("supervisor-2");
    expect(second.supervisor.beginCycle()).toBeUndefined();
    expect(grant.maySignNow()).toBe(true);
    now += 20_001;
    expect(grant.maySignNow()).toBe(false);
    expect(grant.renew()).toBe(false);
    expect(second.supervisor.beginCycle()).toBeDefined();
    first.supervisor.release();
    expect(second.store.readWriterLease()?.holder).toBe("supervisor-2");
    second.store.close();
    first.store.close();
  });

  it("stops the boundary if the lease is lost to another supervisor", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle();
    expect(grant?.maySignNow()).toBe(true);

    // A supervisor outage lets the lease expire and another take over.
    now += 120_000;
    const second = supervisor("supervisor-2");
    expect(second.supervisor.beginCycle()).toBeDefined();
    expect(grant?.maySignNow()).toBe(false);
    second.store.close();
    first.store.close();
  });

  it("records a sanitized failure without leaking transport detail", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle();
    grant?.finish({ outcome: "failed", sanitizedFailure: "RPC unavailable" });
    expect(first.store.readLatestRun()).toMatchObject({
      outcome: "failed",
      sanitizedFailure: "RPC unavailable",
    });
    first.store.close();
  });

  it("reports the observed mode in the heartbeat after the run", () => {
    const first = supervisor("supervisor-1");
    enableLive(first.store);
    const grant = first.supervisor.beginCycle();
    grant?.finish({ outcome: "completed" });
    expect(first.store.readHeartbeat()).toMatchObject({
      observedMode: "live",
      supervisor: "supervisor-1",
    });
    first.store.close();
  });
});
