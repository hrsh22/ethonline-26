import { describe, expect, it } from "vitest";

import {
  MAXIMUM_OPERATOR_DIAGNOSTIC_LENGTH,
  operatorDiagnostic,
} from "./base-sepolia-operator-diagnostic.ts";

describe("Base Sepolia operator diagnostics", () => {
  it("redacts URLs, credentials, JWTs, and long hex payloads within a bound", () => {
    const secret = "sentinel-provider-secret";
    const jwt = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
    const payload = `0x${"12".repeat(96)}`;
    const result = operatorDiagnostic(
      new Error(
        `RPC failed at https://rpc.example.test/v2/${secret} authorization=Bearer ${secret} jwt ${jwt} payload ${payload} ${"x".repeat(4_096)}`,
      ),
    );

    expect(result).toContain("RPC failed at [REDACTED_URL]");
    expect(result).toContain("authorization=[REDACTED]");
    expect(result).toContain("[REDACTED_JWT]");
    expect(result).toContain("[REDACTED_HEX]");
    expect(result).not.toContain(secret);
    expect(result).not.toContain("rpc.example.test");
    expect(result).not.toContain(jwt);
    expect(result).not.toContain(payload);
    expect(result.length).toBeLessThanOrEqual(
      MAXIMUM_OPERATOR_DIAGNOSTIC_LENGTH,
    );
  });

  it("reads only fixed allowlisted fields once per cause and follows bounded causes", () => {
    const reads = new Map<string, number>();
    const getter = (name: string, value: unknown) => () => {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return value;
    };
    const nested = {};
    Object.defineProperties(nested, {
      shortMessage: { get: getter("nested.shortMessage", undefined) },
      message: { get: getter("nested.message", "socket unavailable") },
      cause: { get: getter("nested.cause", undefined) },
    });
    const outer = {};
    Object.defineProperties(outer, {
      shortMessage: { get: getter("outer.shortMessage", "request failed") },
      message: { get: getter("outer.message", "ignored context") },
      cause: { get: getter("outer.cause", nested) },
      stack: {
        get: () => {
          throw new Error("stack must not be read");
        },
      },
    });

    expect(operatorDiagnostic(outer)).toBe(
      "request failed: socket unavailable",
    );
    expect(Object.fromEntries(reads)).toEqual({
      "outer.shortMessage": 1,
      "outer.message": 1,
      "outer.cause": 1,
      "nested.shortMessage": 1,
      "nested.message": 1,
      "nested.cause": 1,
    });
  });

  it("never escapes throwing, cyclic, hostile-coercion, or revoked values", () => {
    const cycle: { cause?: unknown; message?: string } = {
      message: "cyclic provider failure",
    };
    cycle.cause = cycle;
    const throwing = Object.create(null);
    Object.defineProperties(throwing, {
      shortMessage: {
        get: () => {
          throw new Error("short getter");
        },
      },
      message: {
        get: () => {
          throw new Error("message getter");
        },
      },
      cause: {
        get: () => {
          throw new Error("cause getter");
        },
      },
      [Symbol.toPrimitive]: {
        value: () => {
          throw new Error("coercion must not run");
        },
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(operatorDiagnostic(cycle)).toBe("cyclic provider failure");
    expect(operatorDiagnostic(throwing)).toBe("Operator run failed");
    expect(operatorDiagnostic(revoked.proxy)).toBe("Operator run failed");
    expect(operatorDiagnostic(42)).toBe("Operator run failed");
    expect(operatorDiagnostic(Symbol("provider"))).toBe("Operator run failed");
  });

  it("bounds attacker-controlled nesting and includes safe string causes", () => {
    let cause: unknown = "deepest secret";
    for (let depth = 0; depth < 100; depth += 1) {
      cause = { cause, message: `level-${depth}` };
    }

    expect(operatorDiagnostic(cause)).toBe(
      "level-99: level-98: level-97: level-96",
    );
    expect(operatorDiagnostic({ message: "outer", cause: "inner" })).toBe(
      "outer: inner",
    );
  });
});
