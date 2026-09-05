import { describe, expect, it } from "vitest";

import {
  applyOperatorCommand,
  CLOSED_POLICY,
  consumeOneShot,
  cycleAuthority,
  operatorServiceState,
  type OperatorExecutionPolicy,
} from "./policy.ts";

const policy = (
  mode: OperatorExecutionPolicy["mode"],
  oneShot: OperatorExecutionPolicy["oneShot"] = "none",
): OperatorExecutionPolicy => ({ mode, oneShot });

describe("operator execution policy", () => {
  it("starts closed so nothing signs before it is asked to", () => {
    expect(CLOSED_POLICY).toEqual({ mode: "stopped", oneShot: "none" });
    expect(cycleAuthority(CLOSED_POLICY)).toBe("skip");
  });

  it("moves between every standing mode", () => {
    expect(applyOperatorCommand(policy("stopped"), "enable-dry-run")).toEqual({
      next: policy("dry-run"),
      ok: true,
    });
    expect(applyOperatorCommand(policy("dry-run"), "enable-live")).toEqual({
      next: policy("live"),
      ok: true,
    });
    expect(applyOperatorCommand(policy("live"), "enable-dry-run")).toEqual({
      next: policy("dry-run"),
      ok: true,
    });
    expect(applyOperatorCommand(policy("live"), "stop")).toEqual({
      next: policy("stopped"),
      ok: true,
    });
  });

  it("reports a command that would change nothing", () => {
    for (const [current, command] of [
      [policy("stopped"), "stop"],
      [policy("dry-run"), "enable-dry-run"],
      [policy("live"), "enable-live"],
    ] as const) {
      expect(applyOperatorCommand(current, command)).toEqual({
        ok: false,
        reason: "no-change",
      });
    }
  });

  it("queues one pass without changing the standing policy", () => {
    expect(applyOperatorCommand(policy("stopped"), "request-dry-run")).toEqual({
      next: policy("stopped", "dry-run"),
      ok: true,
    });
    expect(applyOperatorCommand(policy("stopped"), "request-live-run")).toEqual(
      { next: policy("stopped", "live"), ok: true },
    );
    expect(applyOperatorCommand(policy("dry-run"), "request-live-run")).toEqual(
      { next: policy("dry-run", "live"), ok: true },
    );
  });

  it("refuses to queue a second pass while one is pending", () => {
    expect(
      applyOperatorCommand(policy("stopped", "dry-run"), "request-live-run"),
    ).toEqual({ ok: false, reason: "one-shot-pending" });
  });

  it("lets stop discard a pass that was queued a moment earlier", () => {
    expect(applyOperatorCommand(policy("live", "live"), "stop")).toEqual({
      next: policy("stopped"),
      ok: true,
    });
  });

  it("keeps a queued pass across a mode change", () => {
    expect(
      applyOperatorCommand(policy("stopped", "live"), "enable-dry-run"),
    ).toEqual({ next: policy("dry-run", "live"), ok: true });
  });

  it("gives a queued pass authority over the standing policy for one cycle", () => {
    expect(cycleAuthority(policy("stopped", "live"))).toBe("execute");
    expect(cycleAuthority(policy("stopped", "dry-run"))).toBe("dry-run");
    expect(cycleAuthority(policy("live", "dry-run"))).toBe("dry-run");
    expect(cycleAuthority(policy("live"))).toBe("execute");
    expect(cycleAuthority(policy("dry-run"))).toBe("dry-run");
  });

  it("consumes a pass whether or not the cycle succeeded", () => {
    expect(consumeOneShot(policy("stopped", "live"))).toEqual(
      policy("stopped"),
    );
    expect(consumeOneShot(policy("dry-run"))).toEqual(policy("dry-run"));
  });
});

describe("operator service state", () => {
  const staleAfterMilliseconds = 60_000;
  const nowMilliseconds = 1_800_000_000_000;

  it("reports offline when no heartbeat was ever observed", () => {
    expect(
      operatorServiceState({
        heartbeatAtMilliseconds: undefined,
        nowMilliseconds,
        staleAfterMilliseconds,
      }),
    ).toBe("offline");
  });

  it("reports online for a fresh heartbeat", () => {
    expect(
      operatorServiceState({
        heartbeatAtMilliseconds: nowMilliseconds - 1_000,
        nowMilliseconds,
        staleAfterMilliseconds,
      }),
    ).toBe("online");
  });

  it("reports degraded for a late heartbeat and offline for an absent one", () => {
    expect(
      operatorServiceState({
        heartbeatAtMilliseconds: nowMilliseconds - 90_000,
        nowMilliseconds,
        staleAfterMilliseconds,
      }),
    ).toBe("degraded");
    expect(
      operatorServiceState({
        heartbeatAtMilliseconds: nowMilliseconds - 600_000,
        nowMilliseconds,
        staleAfterMilliseconds,
      }),
    ).toBe("offline");
  });
});
