import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { createPublicClient, http, type PublicClient } from "viem";
import { foundry } from "viem/chains";

import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";

import {
  makeViemProtocolTransport,
  publicQuoteCaller,
} from "../src/viem-transport.js";

const owner = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const manifest = decodeProtocolDeploymentManifest(
  JSON.parse(readFileSync("../../deployments/31337.json", "utf8")) as unknown,
);
const identity = selectIdentityConfiguration("orbit-4444");

describe("bounded collectible ownership derivation", () => {
  it("stops after an aborted HTTP multicall even when viem turns the abort into failed slots", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Read cancelled", "AbortError");
    let requestsAfterAbort = 0;
    const client = createPublicClient({
      chain: foundry,
      batch: { multicall: { deployless: true, batchSize: 0 } },
      transport: http("https://rpc.test", {
        retryCount: 0,
        fetchOptions: { signal: controller.signal },
        fetchFn: async () => {
          if (controller.signal.aborted) requestsAfterAbort += 1;
          controller.abort(reason);
          throw reason;
        },
      }),
    });
    const transport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      undefined,
      controller.signal,
    );
    const requests = Array.from({ length: 251 }, () => ({
      contract: "fuelCore" as const,
      functionName: "balanceOf" as const,
      args: [owner] as const,
    }));

    const failure = await transport.readMany(requests, 10n).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBe(reason);
    expect(requestsAfterAbort).toBe(0);
  });

  it("does not multiply exhausted HTTP retries by replaying failed multicall slots", async () => {
    let requests = 0;
    const client = createPublicClient({
      chain: foundry,
      batch: { multicall: { deployless: true } },
      transport: http("https://rpc.test", {
        retryCount: 0,
        fetchFn: async () => {
          requests += 1;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { code: 429, message: "Too many requests" },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        },
      }),
    });
    const transport = makeViemProtocolTransport(client, manifest, identity);
    const result = await transport.readMany(
      Array.from({ length: 250 }, () => ({
        contract: "fuelCore" as const,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
      10n,
    );
    expect(result[0]?.status).toBe("failure");
    expect(requests).toBe(1);
  });

  it("derives permanent holdings from indexed candidates and current onchain state", async () => {
    const client = {
      getLogs: async () =>
        Promise.reject(new Error("wallet reads must not scan logs")),
      multicall: async ({
        contracts,
      }: {
        contracts: ReadonlyArray<{ readonly functionName: string }>;
      }) =>
        contracts.map((contract) => ({
          status: "success",
          result: contract.functionName === "ownerOf" ? owner : true,
        })),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42], 120n),
    ).resolves.toEqual([42]);
  });

  it("chunks large read batches sequentially and preserves result ordering", async () => {
    const batchSizes: number[] = [];
    let nextResult = 0;
    const client = {
      multicall: async ({ contracts }: { contracts: readonly unknown[] }) => {
        batchSizes.push(contracts.length);
        return contracts.map(() => ({
          status: "success",
          result: BigInt(nextResult++),
        }));
      },
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);
    const requests = Array.from({ length: 501 }, () => ({
      contract: "fuelCore" as const,
      functionName: "balanceOf" as const,
      args: [owner] as const,
    }));

    const results = await transport.readMany(requests, 10n);

    expect(batchSizes).toEqual([250, 250, 1]);
    expect(results).toHaveLength(501);
    expect(results[0]).toEqual({ status: "success", value: 0n });
    expect(results[500]).toEqual({ status: "success", value: 500n });
  });

  it.each([false, true])(
    "only ignores an owner read failure when the candidate is observed non-permanent (permanent=%s)",
    async (permanent) => {
      const failure = new Error(
        "ownerOf: identity returned to the available pool",
      );
      const client = {
        multicall: async () => [
          { status: "failure", error: failure },
          { status: "success", result: permanent },
        ],
      } as unknown as PublicClient;
      const transport = makeViemProtocolTransport(client, manifest, identity);
      const read = transport.permanentIdentityIds(owner, [1639], 120n);
      if (permanent) await expect(read).rejects.toBe(failure);
      else await expect(read).resolves.toEqual([]);
    },
  );

  it("excludes candidates that the wallet does not currently own", async () => {
    const client = {
      multicall: async ({
        contracts,
      }: {
        contracts: ReadonlyArray<{ readonly functionName: string }>;
      }) =>
        contracts.map((contract, index) => ({
          status: "success",
          result:
            contract.functionName === "ownerOf"
              ? index === 0
                ? owner
                : other
              : true,
        })),
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42, 43], 120n),
    ).resolves.toEqual([42]);
  });

  it("fails closed when a permanent-membership multicall omits a result slot", async () => {
    const client = {
      multicall: async () => [],
    } as unknown as PublicClient;
    const transport = makeViemProtocolTransport(client, manifest, identity);

    await expect(
      transport.permanentIdentityIds(owner, [42], 10n),
    ).rejects.toThrow("Multicall result missing");
  });
});

describe("canonical market quote simulation", () => {
  it("uses a nonzero public caller and permits construction-time or per-quote wallet overrides", async () => {
    const observedAccounts: string[] = [];
    const client = {
      simulateContract: async ({ account }: { account: string }) => {
        if (account === zero) throw new Error("InvalidSwapContext");
        observedAccounts.push(account);
        return { result: [97n, 3n] };
      },
    } as unknown as PublicClient;

    const publicTransport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
    );
    const walletTransport = makeViemProtocolTransport(
      client,
      manifest,
      identity,
      owner,
    );

    await expect(
      publicTransport.quoteExactInput(true, 100n, 10n),
    ).resolves.toEqual([97n, 3n]);
    await expect(
      publicTransport.quoteExactInput(true, 100n, 10n, owner),
    ).resolves.toEqual([97n, 3n]);
    await expect(
      walletTransport.quoteExactInput(true, 100n, 10n),
    ).resolves.toEqual([97n, 3n]);
    expect(observedAccounts).toEqual([publicQuoteCaller, owner, owner]);
    expect(publicQuoteCaller).not.toBe(zero);
  });
});

describe("transport identity", () => {
  it("rejects a transport identity that does not match its manifest", () => {
    expect(() =>
      makeViemProtocolTransport(
        {} as PublicClient,
        manifest,
        selectIdentityConfiguration("neutral-test"),
      ),
    ).toThrow("does not match deployment");
  });
});
