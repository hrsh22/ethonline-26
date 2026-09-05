import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";

import { readFundingHealth } from "./health-funding.ts";

const serviceUrl = "http://127.0.0.1:8790";

const respond = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    })) as unknown as typeof fetch;

const service = (
  state: "ready" | "disabled" | "inventory-empty",
  alert?: "normal" | "elevated" | "critical",
) => ({
  apiVersion: 1,
  service: {
    chainId: 84_532,
    state,
    ...(alert === undefined
      ? {}
      : {
          budget: {
            alert,
            grantLimit: 20,
            grantsUsed: 19,
            usedRatio: 0.95,
            windowResetsAt: 1_700_000_000_000,
          },
        }),
  },
});

const read = (fetcher: typeof fetch) =>
  Effect.runPromise(
    readFundingHealth({ apiToken: undefined, fetcher, serviceUrl }),
  );

describe("testnet funding health", () => {
  it("fails the gate on an empty faucet and on a critically depleted budget", async () => {
    // An empty faucet onboards nobody. It was previously only discoverable by
    // clicking the faucet and waiting.
    await expect(
      read(respond(service("inventory-empty"))),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("empty"),
    });
    await expect(
      read(respond(service("ready", "critical"))),
    ).resolves.toMatchObject({ ok: false });
  });

  it("treats a deliberately disabled faucet as healthy", async () => {
    // Disabled is an operator decision, not a deployment fault.
    await expect(read(respond(service("disabled")))).resolves.toMatchObject({
      ok: true,
      state: "disabled",
    });
    await expect(
      read(respond(service("ready", "elevated"))),
    ).resolves.toMatchObject({ alert: "elevated", ok: true });
  });

  it("fails closed when the worker cannot be read", async () => {
    // The gate must not read an unreachable or malformed worker as healthy;
    // `rpc` carries the detail on the cause.
    for (const [fetcher, detail] of [
      [respond({}, 503), "responded 503"],
      [respond({ apiVersion: 1 }), "must contain public state or an error"],
      [
        respond({ apiVersion: 1, error: { code: "funding-disabled" } }),
        "omitted its service result",
      ],
    ] as const) {
      const failure = await Effect.runPromise(
        Effect.either(
          readFundingHealth({ apiToken: undefined, fetcher, serviceUrl }),
        ),
      );
      expect(Either.isLeft(failure)).toBe(true);
      const cause = Either.isLeft(failure) ? failure.left : undefined;
      expect(String((cause as { readonly cause?: unknown })?.cause)).toContain(
        detail,
      );
    }
  });
});
