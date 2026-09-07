import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_AUTH_PATHS,
  ADMIN_DIAGNOSTIC_PATHS,
  type AdminCapabilityFlags,
} from "@orbit/config/admin-auth";
import { OPERATOR_CONTROL_PATHS } from "@orbit/config/operator-control";
import { PUBLIC_API_PATHS } from "@orbit/config/public-api";

import type { PublicApiConfiguration } from "../src/configuration.js";
import {
  acquirePublicApiServer,
  type PublicApiRateLimiters,
} from "../src/http-server.js";
import type { RequestRateLimiter } from "../src/rate-limiter.js";
import {
  createAdminAuthService,
  type AdminAuthService,
  type AdminAuthorityReader,
} from "../src/admin-auth.js";
import { openAdminAuthStore } from "../src/admin-auth-store.js";

const allowedOrigin = "https://orbit.example";
const adminAddress = "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5";
const deploymentFingerprint = `0x${"11".repeat(32)}` as const;
const bindingsFingerprint = `0x${"22".repeat(32)}` as const;
const observedBlock = {
  hash: `0x${"33".repeat(32)}` as const,
  number: 12_345n,
};

const keeperCapabilities: AdminCapabilityFlags = {
  creator: false,
  guardian: false,
  keeper: true,
  liquidityExecutor: false,
  owners: {
    converter: false,
    liquidToken: false,
    liquidity: false,
    rewards: false,
  },
  recovery: false,
};

const adminAuthorityReader = (
  overrides: Partial<AdminAuthorityReader> = {},
): AdminAuthorityReader => ({
  observe: async () => observedBlock,
  read: async () => ({
    bindingsFingerprint,
    block: observedBlock,
    capabilities: keeperCapabilities,
    consoleRoles: ["keeper"],
  }),
  verify: async () => true,
  ...overrides,
});

const testAdminAuth = (
  authorityReader: AdminAuthorityReader = adminAuthorityReader(),
) => {
  const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
  const randomValues = [0xab, 0xcd, 0xef];
  return {
    close: () => store.close(),
    service: createAdminAuthService({
      appOrigin: allowedOrigin,
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-08-31T08:00:00.000Z"),
      randomBytes: () => {
        const value = randomValues.shift();
        if (value === undefined) throw new Error("Random sequence exhausted");
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    }),
  };
};
const configuration = (): PublicApiConfiguration => ({
  adminAuth: {
    appOrigin: allowedOrigin,
    challengeTtlMilliseconds: 300_000,
    databasePath: ":memory:",
    manifestPath: "deployments/84532.json",
    rpcUrl: new URL("https://sepolia.base.org"),
    sessionTtlMilliseconds: 900_000,
  },
  allowedOrigins: new Set([allowedOrigin]),
  fundingApiToken: "funding-token".repeat(3),
  fundingServiceUrl: new URL("http://127.0.0.1:8790"),
  historyReadApiToken: "history-read-token".repeat(3),
  historyServiceUrl: new URL("http://127.0.0.1:8787"),
  host: "127.0.0.1",
  operatorControl: undefined,
  maximumRequestBodyBytes: 2_048,
  port: 0,
  rateLimit: {
    maximumClients: 100,
    maximumRequests: 100,
    windowMilliseconds: 60_000,
  },
  trustProxy: false,
  upstreamTimeoutMilliseconds: 1_000,
});

type ObservedRequest = {
  readonly body: string | undefined;
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
};

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

const historyManifest = {
  canonicalPool: {
    currency0: "0x0000000000000000000000000000000000000001",
    currency1: "0x0000000000000000000000000000000000000002",
    poolId: `0x${"44".repeat(32)}`,
  },
  chainId: 84_532,
  commitment: `0x${"55".repeat(32)}`,
  fingerprint: deploymentFingerprint,
  launchBlock: "10",
  network: "base-sepolia",
  sources: {
    canonicalFeeHook: "0x0000000000000000000000000000000000000003",
    epochConverter: "0x0000000000000000000000000000000000000004",
    fuelCore: "0x0000000000000000000000000000000000000005",
    poolManager: "0x0000000000000000000000000000000000000006",
    protocolLiquidityVault: "0x0000000000000000000000000000000000000007",
    rewardLedger: "0x0000000000000000000000000000000000000008",
  },
} as const;

const operationsHistoryResponse = {
  items: [
    {
      blockHash: `0x${"66".repeat(32)}`,
      blockNumber: "123",
      blockTimestamp: "456",
      eventName: "reward-epoch-opened",
      logIndex: 1,
      parentHash: `0x${"77".repeat(32)}`,
      payload: {
        epochNumber: "1",
        equalTrackShare: "10",
        finalTrackRemainder: "0",
        openedAmount: "40",
      },
      removed: false,
      sourceAddress: "0x0000000000000000000000000000000000000004",
      transactionHash: `0x${"88".repeat(32)}`,
      transactionIndex: 2,
    },
  ],
  manifest: historyManifest,
  page: { hasMore: false },
  snapshot: {
    blockHash: `0x${"66".repeat(32)}`,
    blockNumber: "123",
    canonicalRevision: 0,
    generation: "generation-1",
  },
  status: {
    coverage: {
      fromBlock: "10",
      indexedThroughBlock: "123",
      indexedThroughTime: "456",
    },
    head: { lagBlocks: "0", observedBlock: "123" },
    requested: { fromBlock: "10", toBlock: "123" },
    state: "complete",
  },
} as const;

const keeperHistoryResponse = {
  evidence: {
    coverage: {
      1: "complete",
      2: "complete",
      3: "complete",
      4: "complete",
    },
    freshness: {
      ageSeconds: "1",
      maximumAgeSeconds: "300",
      observedAt: "456",
      recordedAt: "457",
    },
    generation: "generation-1",
    source: "keeper-attempt-journal",
    state: "fresh",
    tracks: {
      1: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 1,
        },
        state: "fresh",
      },
      2: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 2,
        },
        state: "fresh",
      },
      3: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 3,
        },
        state: "fresh",
      },
      4: {
        latest: {
          actionKind: "reward-track",
          observedAt: "456",
          observedBlock: "123",
          outcome: "not-required",
          track: 4,
        },
        state: "fresh",
      },
    },
  },
  manifest: historyManifest,
} as const;

const protectedHistoryFixture = (url: string): Response | undefined => {
  if (url.includes(":8787/v1/protocol/operations")) {
    return jsonResponse(operationsHistoryResponse);
  }
  if (url.includes(":8787/v1/protocol/keeper-attempts")) {
    return jsonResponse(keeperHistoryResponse);
  }
  return undefined;
};

const publicFundingFixture = (
  url: string,
  body: BodyInit | null | undefined,
): Response | undefined => {
  if (url.includes(":8790/v1/status") && !url.includes("recipient=")) {
    return jsonResponse({
      apiVersion: 1,
      service: {
        chainId: 84_532,
        state: "ready",
        targets: { wethWei: "100", ethWei: "10" },
        inventory: {
          state: "available",
          wethWei: "100",
          ethWei: "10",
        },
      },
    });
  }
  if (url.includes(":8790/v1/status?recipient=")) {
    const recipient = new URL(url).searchParams.get("recipient");
    return jsonResponse({
      apiVersion: 1,
      service: {
        chainId: 84_532,
        state: "ready",
        targets: { wethWei: "100", ethWei: "10" },
      },
      recipient: {
        address: recipient,
        balances: { wethWei: "0", ethWei: "0" },
        remaining: { wethWei: "100", ethWei: "10" },
        state: "eligible",
      },
    });
  }
  if (url.endsWith(":8790/v1/fund")) {
    const request = JSON.parse(String(body)) as {
      recipient: string;
      proof?: unknown;
    };
    // The real worker fails closed without a proof, so a gateway that drops
    // it cannot pass this fixture.
    if (request.proof === undefined) {
      return jsonResponse(
        {
          apiVersion: 1,
          error: { code: "funding-proof-required" },
        },
        400,
      );
    }
    return jsonResponse({
      apiVersion: 1,
      recipient: {
        address: request.recipient,
        balances: { wethWei: "100", ethWei: "10" },
        state: "funded",
      },
    });
  }
  if (url.includes(":8790/v1/challenge")) {
    const recipient =
      new URL(url).searchParams.get("recipient") ??
      "0x0000000000000000000000000000000000000000";
    return jsonResponse({
      apiVersion: 1,
      challenge: {
        chainId: 84_532,
        domain: "orbit.test",
        expiresAt: "2026-09-01T01:00:00.000Z",
        issuedAt: "2026-09-01T00:55:00.000Z",
        message: "orbit.test wants you to sign in with your Ethereum account:",
        nonce: `0x${"cd".repeat(16)}`,
        recipient,
        uri: "https://orbit.test/faucet",
      },
    });
  }
  return undefined;
};

const observingFetcher = (requests: ObservedRequest[]): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url,
    });
    if (url.endsWith("/readyz")) return jsonResponse({ state: "ready" });
    const funding = publicFundingFixture(url, init?.body);
    if (funding !== undefined) return funding;
    const history = protectedHistoryFixture(url);
    if (history !== undefined) return history;
    return jsonResponse({ ok: true });
  }) as typeof fetch;

const withServer = async (
  options: Parameters<typeof acquirePublicApiServer>[0],
  run: (url: string) => Promise<void>,
): Promise<void> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* acquirePublicApiServer(options);
        yield* Effect.tryPromise({
          try: () => run(server.url),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        });
      }),
    ),
  );

const allRateLimiters = (
  limiter: RequestRateLimiter,
): PublicApiRateLimiters => ({
  adminChallenge: limiter,
  adminProtected: limiter,
  adminSession: limiter,
  adminVerify: limiter,
  public: limiter,
});

const signInAdmin = async (
  url: string,
): Promise<{
  readonly cookie: string;
  readonly csrfToken: string;
}> => {
  const challengeResponse = await fetch(`${url}${ADMIN_AUTH_PATHS.challenge}`, {
    body: JSON.stringify({ address: adminAddress }),
    headers: { "content-type": "application/json", origin: allowedOrigin },
    method: "POST",
  });
  const challenge = (await challengeResponse.json()) as {
    readonly challenge: { readonly message: string };
  };
  const verifyResponse = await fetch(`${url}${ADMIN_AUTH_PATHS.verify}`, {
    body: JSON.stringify({
      message: challenge.challenge.message,
      signature: "0x1234",
    }),
    headers: { "content-type": "application/json", origin: allowedOrigin },
    method: "POST",
  });
  const verified = (await verifyResponse.json()) as {
    readonly session: { readonly csrfToken: string };
  };
  return {
    cookie:
      (verifyResponse.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "",
    csrfToken: verified.session.csrfToken,
  };
};

/**
 * The gateway does not verify the proof - the funding worker does - but it now
 * forwards it, so request fixtures must carry one.
 */
const fundingProof = {
  message: "orbit.test wants you to sign in with your Ethereum account:",
  signature: `0x${"ab".repeat(65)}`,
} as const;

describe("operator control proxy", () => {
  const controlConfiguration = (): PublicApiConfiguration => ({
    ...configuration(),
    operatorControl: {
      token: "operator-control-token".repeat(2),
      url: new URL("http://127.0.0.1:8791"),
    },
  });

  const controlState = {
    audit: [],
    desired: { mode: "dry-run", oneShot: "none" },
    service: "online",
  };

  it("proxies the state read under the API envelope and the shared token", async () => {
    const requests: ObservedRequest[] = [];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
        url,
      });
      if (url.includes(":8791/v1/state")) {
        // An upstream apiVersion must not override the envelope's.
        return jsonResponse({ apiVersion: 99, state: controlState });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: controlConfiguration(),
          fetcher,
        },
        async (baseUrl) => {
          const session = await signInAdmin(baseUrl);
          const response = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.state}`,
            { headers: { cookie: session.cookie, origin: allowedOrigin } },
          );
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            apiVersion: number;
            state?: { service?: string };
          };
          expect(body.apiVersion).toBe(1);
          expect(body.state?.service).toBe("online");
        },
      );
    } finally {
      adminAuth.close();
    }
    const upstream = requests.find((request) =>
      request.url.includes(":8791/v1/state"),
    );
    expect(upstream?.headers.get("authorization")).toBe(
      `Bearer ${"operator-control-token".repeat(2)}`,
    );
    expect(upstream?.headers.get("x-operator-actor")).toBeTruthy();
  });

  it("reads the state without an Origin header and still guards the command", async () => {
    /* A browser sends no Origin on a same-origin GET. Every fixture here used
       to supply one anyway, so the origin guard on the read looked healthy
       while the real console got a 403 -- and read it as a dead session. */
    const fetcher = (async () =>
      jsonResponse({ state: controlState })) as typeof fetch;
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: controlConfiguration(),
          fetcher,
        },
        async (baseUrl) => {
          const session = await signInAdmin(baseUrl);
          const read = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.state}`,
            {
              headers: { cookie: session.cookie },
            },
          );
          expect(read.status).toBe(200);

          const command = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.command}`,
            {
              body: JSON.stringify({
                command: "stop",
                commandId: "b".repeat(32),
              }),
              headers: {
                "content-type": "application/json",
                cookie: session.cookie,
                "x-csrf-token": session.csrfToken,
              },
              method: "POST",
            },
          );
          expect(command.status).toBe(403);
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("refuses a command without a CSRF token and an unauthenticated read", async () => {
    const fetcher = (async () =>
      jsonResponse({ state: controlState })) as typeof fetch;
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: controlConfiguration(),
          fetcher,
        },
        async (baseUrl) => {
          const anonymous = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.state}`,
            { headers: { origin: allowedOrigin } },
          );
          expect(anonymous.status).toBe(401);

          const session = await signInAdmin(baseUrl);
          const missingCsrf = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.command}`,
            {
              body: JSON.stringify({
                command: "stop",
                commandId: "a".repeat(32),
              }),
              headers: {
                "content-type": "application/json",
                cookie: session.cookie,
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          expect(missingCsrf.status).toBe(403);
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("rejects an oversized or non-JSON control-plane response instead of relaying it", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(":8791/v1/state")) {
        return new Response("<html>not json</html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: controlConfiguration(),
          fetcher,
        },
        async (baseUrl) => {
          const session = await signInAdmin(baseUrl);
          const response = await fetch(
            `${baseUrl}${OPERATOR_CONTROL_PATHS.state}`,
            { headers: { cookie: session.cookie, origin: allowedOrigin } },
          );
          expect(response.status).toBe(503);
        },
      );
    } finally {
      adminAuth.close();
    }
  });
});

describe("VM-owned public API", () => {
  it("exposes only read-only delivery evidence without requiring an admin session", async () => {
    const delivery = {
      apiVersion: 1,
      chainId: 84532,
      deploymentFingerprint: `0x${"f".repeat(64)}`,
      observedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_030_000,
      policy: { mode: "live", oneShot: "none" },
      liveness: { state: "offline" },
      dependencyReadiness: "unknown",
      workEligibility: "unknown",
    };
    const requests: string[] = [];
    await withServer(
      {
        configuration: {
          ...configuration(),
          operatorControl: {
            token: "secret-control-token",
            url: new URL("http://127.0.0.1:8791"),
          },
        },
        fetcher: (async (input, init) => {
          requests.push(String(input));
          expect(init?.method).toBe("GET");
          return jsonResponse({
            ...delivery,
            audit: [{ actor: "private-actor" }],
            key: "private-key",
            command: "enable-live",
            diagnostic: "https://rpc.invalid/secret",
          });
        }) as typeof fetch,
      },
      async (url) => {
        const response = await fetch(`${url}/v1/delivery/status`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(delivery);
        expect(
          (await fetch(`${url}/v1/delivery/status`, { method: "POST" })).status,
        ).toBe(405);
        expect(
          (await fetch(`${url}/v1/delivery/status?command=enable-live`)).status,
        ).toBe(400);
        expect(
          (await fetch(`${url}/v1/delivery/command`, { method: "POST" }))
            .status,
        ).toBe(404);
      },
    );
    expect(requests).toEqual(["http://127.0.0.1:8791/v1/delivery-status"]);
  });

  it("serves liveness without touching a dependency", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/healthz`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          state: "alive",
        });
      },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks history and funding readiness in parallel with private credentials", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(`${url}/readyz`, {
          headers: { origin: allowedOrigin },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          allowedOrigin,
        );
        await expect(response.json()).resolves.toMatchObject({
          dependencies: { funding: "ready", history: "ready" },
          state: "ready",
        });
      },
    );
    expect(
      requests.map((request) => new URL(request.url).pathname).sort(),
    ).toEqual(["/readyz", "/v1/status"]);
    expect(
      requests.map((request) => request.headers.get("authorization")).sort(),
    ).toEqual(
      [
        "Bearer funding-tokenfunding-tokenfunding-token",
        "Bearer history-read-tokenhistory-read-tokenhistory-read-token",
      ].sort(),
    );
  });

  it.each(["disabled", "inventory-empty"] as const)(
    "reports %s funding as unavailable even when the worker responds",
    async (fundingState) => {
      const fetcher = (async (input: string | URL | Request) => {
        const url = String(input);
        return url.endsWith("/readyz")
          ? jsonResponse({ state: "ready" })
          : jsonResponse({
              apiVersion: 1,
              service: { chainId: 84_532, state: fundingState },
            });
      }) as typeof fetch;
      await withServer(
        { configuration: configuration(), fetcher },
        async (url) => {
          const response = await fetch(`${url}/readyz`);
          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toMatchObject({
            dependencies: { funding: fundingState, history: "ready" },
            state: "unavailable",
          });
        },
      );
    },
  );

  it("reports a malformed funding status as unavailable", async () => {
    const fetcher = (async (input: string | URL | Request) =>
      String(input).endsWith("/readyz")
        ? jsonResponse({ state: "ready" })
        : jsonResponse({ service: { state: "ready" } })) as typeof fetch;
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/readyz`);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          dependencies: { funding: "unavailable", history: "ready" },
          state: "unavailable",
        });
      },
    );
  });

  it("reports funding marked ready without usable inventory as unavailable", async () => {
    const fetcher = (async (input: string | URL | Request) =>
      String(input).endsWith("/readyz")
        ? jsonResponse({ state: "ready" })
        : jsonResponse({
            apiVersion: 1,
            service: {
              chainId: 84_532,
              state: "ready",
              targets: { wethWei: "100", ethWei: "10" },
              inventory: {
                state: "available",
                wethWei: "99",
                ethWei: "10",
              },
            },
          })) as typeof fetch;
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/readyz`);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          dependencies: { funding: "unavailable", history: "ready" },
          state: "unavailable",
        });
      },
    );
  });

  it("maps safe history reads and forwards only the history credential", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(
          `${url}/v1/history/market/swaps?fromBlock=10&toBlock=20&limit=5&order=desc`,
          { headers: { origin: allowedOrigin } },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          allowedOrigin,
        );
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://127.0.0.1:8787/v1/market/swaps?fromBlock=10&toBlock=20&limit=5&order=desc",
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer history-read-tokenhistory-read-tokenhistory-read-token",
    );
  });

  it("maps the credential-free public candle route to the private history worker", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(
          `${url}${PUBLIC_API_PATHS.history.marketCandles}`,
        );
        expect(response.status).toBe(200);
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:8787/v1/market/candles");
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer history-read-tokenhistory-read-tokenhistory-read-token",
    );
  });

  it("retires detailed public feeds and authenticates their exact diagnostic replacements", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const publicOperations = await fetch(
          `${url}${PUBLIC_API_PATHS.history.operations}`,
        );
        const publicKeeperAttempts = await fetch(
          `${url}${PUBLIC_API_PATHS.history.keeperAttempts}`,
        );
        const protectedOperations = await fetch(
          `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
        );
        const protectedKeeperAttempts = await fetch(
          `${url}${ADMIN_DIAGNOSTIC_PATHS.keeperAttempts}`,
        );

        expect(publicOperations.status).toBe(404);
        expect(publicKeeperAttempts.status).toBe(404);
        for (const response of [protectedOperations, protectedKeeperAttempts]) {
          expect(response.status).toBe(401);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(response.headers.get("vary")).toBe("Cookie");
          await expect(response.json()).resolves.toEqual({
            apiVersion: 1,
            error: {
              code: "admin-session-required",
              message: "An authenticated admin session is required",
            },
          });
        }
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("returns only an exact manifest-bound protected history DTO", async () => {
    const adminAuth = testAdminAuth();
    let redirect: RequestRedirect | undefined;
    const fetcher = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      redirect = init?.redirect;
      return jsonResponse({
        ...operationsHistoryResponse,
        ignoredTopLevel: "must not cross the admin boundary",
        items: operationsHistoryResponse.items.map((item) => ({
          ...item,
          ignoredItem: "must be stripped",
          payload: {
            ...item.payload,
            ignoredPayloadField: "must also be stripped",
          },
        })),
        manifest: {
          ...historyManifest,
          canonicalPool: {
            ...historyManifest.canonicalPool,
            ignoredPoolField: true,
          },
          ignoredManifestField: true,
        },
        page: { ...operationsHistoryResponse.page, ignoredPageField: true },
        snapshot: {
          ...operationsHistoryResponse.snapshot,
          ignoredSnapshotField: true,
        },
        status: {
          ...operationsHistoryResponse.status,
          coverage: {
            ...operationsHistoryResponse.status.coverage,
            ignoredCoverageField: true,
          },
          ignoredStatusField: true,
        },
      });
    }) as typeof fetch;

    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher,
        },
        async (url) => {
          const signedIn = await signInAdmin(url);
          const response = await fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}?fromBlock=10&limit=5`,
            { headers: { cookie: signedIn.cookie } },
          );

          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          await expect(response.json()).resolves.toEqual(
            operationsHistoryResponse,
          );
          expect(redirect).toBe("error");
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("rechecks authorization after buffering protected history", async () => {
    const adminAuth = testAdminAuth();
    let releaseUpstream: (response: Response) => void = () => undefined;
    const upstream = new Promise<Response>((resolve) => {
      releaseUpstream = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async () => upstream);

    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher,
        },
        async (url) => {
          const signedIn = await signInAdmin(url);
          const diagnostic = fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
            { headers: { cookie: signedIn.cookie } },
          );
          await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

          const logout = await fetch(`${url}${ADMIN_AUTH_PATHS.logout}`, {
            headers: {
              cookie: signedIn.cookie,
              origin: allowedOrigin,
              "x-csrf-token": signedIn.csrfToken,
            },
            method: "POST",
          });
          expect(logout.status).toBe(204);

          releaseUpstream(jsonResponse(operationsHistoryResponse));
          const response = await diagnostic;
          expect(response.status).toBe(401);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          await expect(response.json()).resolves.toEqual({
            apiVersion: 1,
            error: {
              code: "admin-session-required",
              message: "An authenticated admin session is required",
            },
          });
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("returns only an exact manifest-bound keeper-attempt DTO", async () => {
    const adminAuth = testAdminAuth();
    const fetcher = (async () =>
      jsonResponse({
        ...keeperHistoryResponse,
        evidence: {
          ...keeperHistoryResponse.evidence,
          ignoredEvidenceField: true,
          freshness: {
            ...keeperHistoryResponse.evidence.freshness,
            ignoredFreshnessField: true,
          },
          tracks: Object.fromEntries(
            Object.entries(keeperHistoryResponse.evidence.tracks).map(
              ([track, evidence]) => [
                track,
                {
                  ...evidence,
                  ignoredTrackField: true,
                  latest: {
                    ...evidence.latest,
                    ignoredAttemptField: true,
                  },
                },
              ],
            ),
          ),
        },
        ignoredTopLevel: true,
      })) as typeof fetch;

    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher,
        },
        async (url) => {
          const signedIn = await signInAdmin(url);
          const response = await fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.keeperAttempts}`,
            { headers: { cookie: signedIn.cookie } },
          );

          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          await expect(response.json()).resolves.toEqual(keeperHistoryResponse);
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it.each([
    [
      "non-200 status",
      (async () =>
        jsonResponse(operationsHistoryResponse, 201)) as typeof fetch,
    ],
    [
      "deployment mismatch",
      (async () =>
        jsonResponse({
          ...operationsHistoryResponse,
          manifest: {
            ...historyManifest,
            fingerprint: `0x${"99".repeat(32)}`,
          },
        })) as typeof fetch,
    ],
    [
      "malformed DTO",
      (async () =>
        jsonResponse({
          manifest: historyManifest,
          items: "not-an-array",
        })) as typeof fetch,
    ],
    [
      "redirect",
      (async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.redirect === "error")
          throw new TypeError("redirect rejected");
        return jsonResponse(operationsHistoryResponse);
      }) as typeof fetch,
    ],
    [
      "oversized DTO",
      (async () =>
        jsonResponse({
          ...operationsHistoryResponse,
          ignoredPadding: "x".repeat(1_048_576),
        })) as typeof fetch,
    ],
  ] as const)(
    "maps protected history %s to one fixed private 503",
    async (_, fetcher) => {
      const adminAuth = testAdminAuth();
      try {
        await withServer(
          {
            adminAuth: adminAuth.service,
            configuration: configuration(),
            fetcher,
          },
          async (url) => {
            const signedIn = await signInAdmin(url);
            const response = await fetch(
              `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
              { headers: { cookie: signedIn.cookie } },
            );

            expect(response.status).toBe(503);
            expect(response.headers.get("cache-control")).toBe(
              "private, no-store",
            );
            expect(response.headers.get("vary")).toBe("Cookie");
            await expect(response.json()).resolves.toEqual({
              apiVersion: 1,
              error: {
                code: "admin-authority-unavailable",
                message: "Admin authority is unavailable",
              },
            });
          },
        );
      } finally {
        adminAuth.close();
      }
    },
  );

  it("creates and introspects one safe cookie-backed admin session", async () => {
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher([]),
        },
        async (url) => {
          const challengeResponse = await fetch(
            `${url}${ADMIN_AUTH_PATHS.challenge}`,
            {
              body: JSON.stringify({ address: adminAddress }),
              headers: {
                "content-type": "application/json",
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          expect(challengeResponse.status).toBe(200);
          expect(challengeResponse.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(challengeResponse.headers.get("vary")).toBe("Cookie, Origin");
          const challengeBody = (await challengeResponse.json()) as {
            readonly challenge: {
              readonly expiresAt: string;
              readonly message: string;
            };
          };

          const verifyResponse = await fetch(
            `${url}${ADMIN_AUTH_PATHS.verify}`,
            {
              body: JSON.stringify({
                message: challengeBody.challenge.message,
                signature: "0x1234",
              }),
              headers: {
                "content-type": "application/json",
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          expect(verifyResponse.status).toBe(200);
          expect(verifyResponse.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(verifyResponse.headers.get("vary")).toBe("Cookie, Origin");
          const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
          expect(setCookie).toContain("orbit_admin_session=" + "cd".repeat(32));
          expect(setCookie).toContain("Path=/");
          expect(setCookie).toContain("HttpOnly");
          expect(setCookie).toContain("SameSite=Strict");
          expect(setCookie).toContain("Max-Age=900");
          expect(setCookie).toContain("Secure");
          expect(setCookie).not.toContain("Domain=");

          const verifyBody = (await verifyResponse.json()) as {
            readonly session: Readonly<Record<string, unknown>> & {
              readonly csrfToken: string;
              readonly observedBlock: {
                readonly hash: string;
                readonly number: string;
              };
            };
          };
          expect(verifyBody.session).toMatchObject({
            address: adminAddress,
            chainId: 84_532,
            deploymentFingerprint,
            expiresAt: "2026-08-31T08:15:00.000Z",
            issuedAt: "2026-08-31T08:00:00.000Z",
            observedBlock: {
              hash: observedBlock.hash,
              number: "12345",
            },
            roles: ["keeper"],
          });
          expect(verifyBody.session).not.toHaveProperty("capabilities");

          const sessionCookie = setCookie.split(";", 1)[0] ?? "";
          const sessionResponse = await fetch(
            `${url}${ADMIN_AUTH_PATHS.session}`,
            { headers: { cookie: sessionCookie } },
          );
          expect(sessionResponse.status).toBe(200);
          expect(sessionResponse.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(sessionResponse.headers.get("vary")).toBe("Cookie");
          await expect(sessionResponse.json()).resolves.toEqual({
            apiVersion: 1,
            session: verifyBody.session,
          });
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("reauthorizes diagnostics and actions, enforces Origin and CSRF, and revokes on logout", async () => {
    const requests: ObservedRequest[] = [];
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher(requests),
        },
        async (url) => {
          const signedIn = await signInAdmin(url);
          const diagnostic = await fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}?fromBlock=10&limit=5&order=desc`,
            { headers: { cookie: signedIn.cookie } },
          );
          expect(diagnostic.status).toBe(200);
          expect(diagnostic.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(diagnostic.headers.get("vary")).toBe("Cookie");
          await expect(diagnostic.json()).resolves.toEqual(
            operationsHistoryResponse,
          );

          const actionBody = JSON.stringify({ type: "open-reward-epoch" });
          const missingOrigin = await fetch(
            `${url}${ADMIN_AUTH_PATHS.actionAuthorization}`,
            {
              body: actionBody,
              headers: {
                "content-type": "application/json",
                cookie: signedIn.cookie,
                "x-csrf-token": signedIn.csrfToken,
              },
              method: "POST",
            },
          );
          const missingCsrf = await fetch(
            `${url}${ADMIN_AUTH_PATHS.actionAuthorization}`,
            {
              body: actionBody,
              headers: {
                "content-type": "application/json",
                cookie: signedIn.cookie,
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          expect(missingOrigin.status).toBe(403);
          expect(missingCsrf.status).toBe(403);
          for (const response of [missingOrigin, missingCsrf]) {
            await expect(response.json()).resolves.toEqual({
              apiVersion: 1,
              error: {
                code: "admin-forbidden",
                message: "The authenticated principal is not authorized",
              },
            });
          }

          const action = await fetch(
            `${url}${ADMIN_AUTH_PATHS.actionAuthorization}`,
            {
              body: actionBody,
              headers: {
                "content-type": "application/json",
                cookie: signedIn.cookie,
                origin: allowedOrigin,
                "x-csrf-token": signedIn.csrfToken,
              },
              method: "POST",
            },
          );
          expect(action.status).toBe(200);
          expect(action.headers.get("cache-control")).toBe("private, no-store");
          expect(action.headers.get("vary")).toBe("Cookie, Origin");
          await expect(action.json()).resolves.toEqual({
            apiVersion: 1,
            authorization: {
              action: { type: "open-reward-epoch" },
              authorized: true,
              observedBlock: {
                hash: observedBlock.hash,
                number: "12345",
              },
            },
          });

          const rejectedLogout = await fetch(
            `${url}${ADMIN_AUTH_PATHS.logout}`,
            {
              headers: {
                cookie: signedIn.cookie,
                origin: "https://attacker.example",
                "x-csrf-token": signedIn.csrfToken,
              },
              method: "POST",
            },
          );
          expect(rejectedLogout.status).toBe(403);

          const logout = await fetch(`${url}${ADMIN_AUTH_PATHS.logout}`, {
            headers: {
              cookie: signedIn.cookie,
              origin: allowedOrigin,
              "x-csrf-token": signedIn.csrfToken,
            },
            method: "POST",
          });
          expect(logout.status).toBe(204);
          expect(logout.headers.get("cache-control")).toBe("private, no-store");
          expect(logout.headers.get("vary")).toBe("Cookie, Origin");
          const clearedCookie = logout.headers.get("set-cookie") ?? "";
          expect(clearedCookie).toContain("orbit_admin_session=");
          expect(clearedCookie).toContain("Max-Age=0");
          expect(clearedCookie).toContain("HttpOnly");
          expect(clearedCookie).toContain("SameSite=Strict");
          expect(clearedCookie).toContain("Secure");

          const revoked = await fetch(`${url}${ADMIN_AUTH_PATHS.session}`, {
            headers: { cookie: signedIn.cookie },
          });
          expect(revoked.status).toBe(401);
        },
      );
    } finally {
      adminAuth.close();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://127.0.0.1:8787/v1/protocol/operations?fromBlock=10&limit=5&order=desc",
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer history-read-tokenhistory-read-tokenhistory-read-token",
    );
    expect(requests[0]?.headers.get("cookie")).toBeNull();
  });

  it("requires the exact app Origin before issuing or verifying a challenge", async () => {
    const adminAuth = testAdminAuth();
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher([]),
        },
        async (url) => {
          const requestChallenge = (origin?: string) =>
            fetch(`${url}${ADMIN_AUTH_PATHS.challenge}`, {
              body: JSON.stringify({ address: adminAddress }),
              headers: {
                "content-type": "application/json",
                ...(origin === undefined ? {} : { origin }),
              },
              method: "POST",
            });
          const missingOrigin = await requestChallenge();
          const attackerOrigin = await requestChallenge(
            "https://attacker.example",
          );
          expect(missingOrigin.status).toBe(403);
          expect(attackerOrigin.status).toBe(403);
          for (const response of [missingOrigin, attackerOrigin]) {
            expect(response.headers.get("cache-control")).toBe(
              "private, no-store",
            );
            await expect(response.json()).resolves.toEqual({
              apiVersion: 1,
              error: {
                code: "admin-forbidden",
                message: "The authenticated principal is not authorized",
              },
            });
          }

          const challengeResponse = await requestChallenge(allowedOrigin);
          const challenge = (await challengeResponse.json()) as {
            readonly challenge: { readonly message: string };
          };
          const rejectedVerify = await fetch(
            `${url}${ADMIN_AUTH_PATHS.verify}`,
            {
              body: JSON.stringify({
                message: challenge.challenge.message,
                signature: "0x1234",
              }),
              headers: {
                "content-type": "application/json",
                origin: "https://attacker.example",
              },
              method: "POST",
            },
          );
          expect(rejectedVerify.status).toBe(403);
          expect(rejectedVerify.headers.get("set-cookie")).toBeNull();
          await expect(rejectedVerify.json()).resolves.toMatchObject({
            error: { code: "admin-forbidden" },
          });
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("returns a fixed 401 for an invalid signature without setting a session", async () => {
    const adminAuth = testAdminAuth(
      adminAuthorityReader({ verify: async () => false }),
    );
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher([]),
        },
        async (url) => {
          const challengeResponse = await fetch(
            `${url}${ADMIN_AUTH_PATHS.challenge}`,
            {
              body: JSON.stringify({ address: adminAddress }),
              headers: {
                "content-type": "application/json",
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          const challenge = (await challengeResponse.json()) as {
            readonly challenge: { readonly message: string };
          };
          const response = await fetch(`${url}${ADMIN_AUTH_PATHS.verify}`, {
            body: JSON.stringify({
              message: challenge.challenge.message,
              signature: "0x1234",
            }),
            headers: {
              "content-type": "application/json",
              origin: allowedOrigin,
            },
            method: "POST",
          });

          expect(response.status).toBe(401);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(response.headers.get("set-cookie")).toBeNull();
          await expect(response.json()).resolves.toEqual({
            apiVersion: 1,
            error: {
              code: "admin-session-required",
              message: "An authenticated admin session is required",
            },
          });
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("maps authority failures to one fixed 503 without leaking their cause", async () => {
    const adminAuth = testAdminAuth(
      adminAuthorityReader({
        read: async () => {
          throw new Error(
            "private RPC https://user:secret@rpc.example was unavailable",
          );
        },
      }),
    );
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher([]),
        },
        async (url) => {
          const challengeResponse = await fetch(
            `${url}${ADMIN_AUTH_PATHS.challenge}`,
            {
              body: JSON.stringify({ address: adminAddress }),
              headers: {
                "content-type": "application/json",
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          const challenge = (await challengeResponse.json()) as {
            readonly challenge: { readonly message: string };
          };
          const response = await fetch(`${url}${ADMIN_AUTH_PATHS.verify}`, {
            body: JSON.stringify({
              message: challenge.challenge.message,
              signature: "0x1234",
            }),
            headers: {
              "content-type": "application/json",
              origin: allowedOrigin,
            },
            method: "POST",
          });
          expect(response.status).toBe(503);
          const serialized = JSON.stringify(await response.json());
          expect(serialized).toBe(
            JSON.stringify({
              apiVersion: 1,
              error: {
                code: "admin-authority-unavailable",
                message: "Admin authority is unavailable",
              },
            }),
          );
          expect(serialized).not.toContain("secret");
          expect(serialized).not.toContain("rpc.example");
          expect(response.headers.get("set-cookie")).toBeNull();
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("keeps rate-limited admin errors private and variant-safe", async () => {
    const adminAuth = testAdminAuth();
    const rateLimiter: RequestRateLimiter = {
      consume: () => ({ allowed: false, retryAfterSeconds: 7 }),
    };
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: configuration(),
          fetcher: observingFetcher([]),
          rateLimiters: allRateLimiters(rateLimiter),
        },
        async (url) => {
          const response = await fetch(`${url}${ADMIN_AUTH_PATHS.challenge}`, {
            body: JSON.stringify({ address: adminAddress }),
            headers: {
              "content-type": "application/json",
              origin: allowedOrigin,
            },
            method: "POST",
          });
          expect(response.status).toBe(429);
          expect(response.headers.get("cache-control")).toBe(
            "private, no-store",
          );
          expect(response.headers.get("vary")).toBe("Cookie, Origin");
          expect(response.headers.get("retry-after")).toBe("7");
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("isolates auth, session, protected, and public rate-limit budgets", async () => {
    const adminAuth = testAdminAuth();
    const isolatedConfiguration = {
      ...configuration(),
      rateLimit: {
        maximumClients: 100,
        maximumRequests: 1,
        windowMilliseconds: 60_000,
      },
    };
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: isolatedConfiguration,
          fetcher: observingFetcher([]),
        },
        async (url) => {
          const signedIn = await signInAdmin(url);
          const exhaustedAuth = await fetch(
            `${url}${ADMIN_AUTH_PATHS.challenge}`,
            {
              body: JSON.stringify({ address: adminAddress }),
              headers: {
                "content-type": "application/json",
                origin: allowedOrigin,
              },
              method: "POST",
            },
          );
          expect(exhaustedAuth.status).toBe(429);

          const malformedSession = await fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
            { headers: { cookie: "orbit_admin_session=not-a-handle" } },
          );
          expect(malformedSession.status).toBe(429);

          const session = await fetch(`${url}${ADMIN_AUTH_PATHS.session}`, {
            headers: { cookie: signedIn.cookie },
          });
          expect(session.status).toBe(200);

          const protectedHistory = await fetch(
            `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
            { headers: { cookie: signedIn.cookie } },
          );
          expect(protectedHistory.status).toBe(200);

          const publicHistory = await fetch(`${url}/v1/history/status`);
          expect(publicHistory.status).toBe(200);
        },
      );
    } finally {
      adminAuth.close();
    }
  });

  it("does not let rotating fake session handles bypass protected limits", async () => {
    const adminAuth = testAdminAuth();
    const fetcher = vi.fn<typeof fetch>();
    const limitedConfiguration = {
      ...configuration(),
      rateLimit: {
        maximumClients: 2,
        maximumRequests: 2,
        windowMilliseconds: 60_000,
      },
    };
    try {
      await withServer(
        {
          adminAuth: adminAuth.service,
          configuration: limitedConfiguration,
          fetcher,
        },
        async (url) => {
          const statuses: number[] = [];
          for (const octet of ["aa", "bb", "cc"]) {
            const response = await fetch(
              `${url}${ADMIN_DIAGNOSTIC_PATHS.operations}`,
              {
                headers: {
                  cookie: `orbit_admin_session=${octet.repeat(32)}`,
                },
              },
            );
            statuses.push(response.status);
          }
          expect(statuses).toEqual([401, 401, 429]);
        },
      );
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      adminAuth.close();
    }
  });

  it("keeps pre-routing admin request errors private", async () => {
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher([]) },
      async (url) => {
        const response = await fetch(`${url}/v1/admin/${"x".repeat(8_192)}`);

        expect(response.status).toBe(414);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toBe("Cookie");
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          error: {
            code: "request-url-too-long",
            message: "Request URL is too long",
          },
        });
      },
    );
  });

  it("validates and sanitizes funding requests before forwarding", async () => {
    const requests: ObservedRequest[] = [];
    const recipient = "0x2000000000000000000000000000000000000002";
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "faucet",
            proof: fundingProof,
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });
        expect(response.status).toBe(200);
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      // The proof must survive the hop -- the worker rejects a proof-less
      // request with funding-proof-required. `source` must not survive it.
      body: JSON.stringify({ proof: fundingProof, recipient }),
      method: "POST",
      url: "http://127.0.0.1:8790/v1/fund",
    });
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer funding-tokenfunding-tokenfunding-token",
    );
  });

  it("forwards whether the wallet kept the grant, and why it is still settling", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const notRetained = async () =>
      jsonResponse({
        apiVersion: 1,
        recipient: {
          address: recipient,
          balances: { wethWei: "100", ethWei: "0" },
          retainedTargets: false,
          state: "funded",
        },
      });
    await withServer(
      { configuration: configuration(), fetcher: notRetained },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "faucet",
            proof: fundingProof,
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });
        // Dropping this leaves the browser unable to tell a delivered grant
        // the wallet forwarded from one it kept.
        await expect(response.json()).resolves.toMatchObject({
          recipient: { retainedTargets: false, state: "funded" },
        });
      },
    );

    const confirming = async () =>
      jsonResponse(
        { apiVersion: 1, error: { code: "funding-confirming" } },
        503,
      );
    await withServer(
      { configuration: configuration(), fetcher: confirming },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "faucet",
            proof: fundingProof,
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });
        // Masking this as generic unavailability is what made a settling
        // balance read look like a broken faucet.
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "funding-confirming" },
        });
      },
    );
  });

  it("passes a funding challenge through instead of rejecting it as malformed", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const requests: ObservedRequest[] = [];
    const fetcher = observingFetcher(requests);
    await withServer(
      { configuration: configuration(), fetcher },
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/v1/funding/challenge?recipient=${recipient}`,
          { headers: { origin: allowedOrigin } },
        );
        // A successful challenge has no recipient or error result; routing it
        // through the collector-result projection returned 502 on every
        // success, so the browser could never obtain a challenge to sign.
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          apiVersion: number;
          challenge?: { message?: string; recipient?: string };
        };
        expect(body.apiVersion).toBe(1);
        expect(body.challenge?.message).toContain("sign in");
        expect(body.challenge?.recipient).toBe(recipient);
      },
    );
    expect(requests[0]?.url).toBe(
      `http://127.0.0.1:8790/v1/challenge?recipient=${recipient}`,
    );
  });

  it("projects funding status to the exact collector-safe aggregate", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const fetcher = (async () =>
      jsonResponse({
        apiVersion: 1,
        service: {
          chainId: 84_532,
          cooldownSeconds: 120,
          limits: {
            lifetime: {
              ethWei: "20000000000000000",
              wethWei: "200000000000000000",
            },
            dailyBudget: {
              ethWei: "200000000000000000",
              wethWei: "2000000000000000000",
            },
            dailyGrantLimit: 20,
            clientWindowSeconds: 3600,
            clientWindowLimit: 5,
          },
          inventory: {
            ethWei: "9000000000000000000",
            state: "available",
            wethWei: "8000000000000000000",
          },
          metrics: {
            failed: 3,
            pending: 2,
            rateLimited: 1,
            successful: 40,
          },
          policyLedger: { lifetimeFunded: 40 },
          state: "ready",
          targets: {
            ethWei: "10000000000000000",
            wethWei: "1000000000000000000",
          },
        },
        recipient: {
          address: recipient,
          balances: {
            ethWei: "5000000000000000",
            wethWei: "250000000000000000",
          },
          nextEligibleAt: null,
          policyLedger: { attempts: 3 },
          remaining: {
            ethWei: "5000000000000000",
            wethWei: "750000000000000000",
          },
          state: "eligible",
        },
        request: {
          id: "internal-request-id",
          state: "pending",
          transactions: [
            {
              hash: `0x${"11".repeat(32)}`,
              kind: "weth",
              state: "prepared",
            },
          ],
        },
        rawError: "private funding-worker diagnostic",
      })) as typeof fetch;

    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(
          `${url}/v1/funding/status?recipient=${recipient}`,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          request: {
            id: "internal-request-id",
            state: "pending",
            transactions: [{ kind: "weth", state: "prepared" }],
          },
          recipient: {
            address: recipient,
            balances: {
              ethWei: "5000000000000000",
              wethWei: "250000000000000000",
            },
            nextEligibleAt: null,
            remaining: {
              ethWei: "5000000000000000",
              wethWei: "750000000000000000",
            },
            state: "eligible",
          },
          service: {
            chainId: 84_532,
            cooldownSeconds: 120,
            limits: {
              lifetime: {
                ethWei: "20000000000000000",
                wethWei: "200000000000000000",
              },
              dailyBudget: {
                ethWei: "200000000000000000",
                wethWei: "2000000000000000000",
              },
              dailyGrantLimit: 20,
              clientWindowSeconds: 3600,
              clientWindowLimit: 5,
            },
            state: "ready",
            targets: {
              ethWei: "10000000000000000",
              wethWei: "1000000000000000000",
            },
          },
        });
      },
    );
  });

  it("projects a confirmed grant identity and safe per-asset progress", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const fetcher = (async () =>
      jsonResponse({
        apiVersion: 1,
        recipient: {
          address: recipient,
          balances: {
            ethWei: "10000000000000000",
            wethWei: "1000000000000000000",
          },
          state: "funded",
        },
        request: {
          id: "internal-request-id",
          state: "funded",
          transactions: [
            {
              hash: `0x${"22".repeat(32)}`,
              kind: "weth",
              state: "confirmed",
            },
            {
              hash: `0x${"33".repeat(32)}`,
              kind: "eth",
              state: "confirmed",
            },
          ],
        },
        workerAudit: { leaseOwner: "funding-worker-1" },
      })) as typeof fetch;

    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "faucet",
            proof: fundingProof,
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          request: {
            id: "internal-request-id",
            state: "funded",
            transactions: [
              {
                kind: "weth",
                hash: `0x${"22".repeat(32)}`,
                state: "confirmed",
              },
              { kind: "eth", hash: `0x${"33".repeat(32)}`, state: "confirmed" },
            ],
          },
          recipient: {
            address: recipient,
            balances: {
              ethWei: "10000000000000000",
              wethWei: "1000000000000000000",
            },
            state: "funded",
          },
        });
      },
    );
  });

  it("preserves accepted progress without exposing unbroadcast transaction hashes", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const fetcher = (async () =>
      jsonResponse(
        {
          apiVersion: 1,
          recipient: { address: recipient, state: "pending" },
          request: {
            id: "internal-request-id",
            state: "pending",
            transactions: [
              {
                hash: `0x${"44".repeat(32)}`,
                kind: "weth",
                state: "broadcast",
              },
              {
                hash: `0x${"55".repeat(32)}`,
                kind: "eth",
                state: "prepared",
              },
            ],
          },
        },
        202,
      )) as typeof fetch;

    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "onboarding",
            proof: fundingProof,
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          request: {
            id: "internal-request-id",
            state: "pending",
            transactions: [
              {
                kind: "weth",
                hash: `0x${"44".repeat(32)}`,
                state: "broadcast",
              },
              { kind: "eth", state: "prepared" },
            ],
          },
          recipient: { address: recipient, state: "pending" },
        });
      },
    );
  });

  it("rejects a funding worker response larger than 16 KiB", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const fetcher = (async () =>
      jsonResponse({
        apiVersion: 1,
        padding: "x".repeat(16_385),
        recipient: { address: recipient, state: "eligible" },
        service: { chainId: 84_532, state: "ready" },
      })) as typeof fetch;

    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const status = await fetch(
          `${url}/v1/funding/status?recipient=${recipient}`,
        );
        const fund = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            recipient,
            source: "faucet",
            proof: fundingProof,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });

        for (const response of [status, fund]) {
          expect(response.status).toBe(502);
          await expect(response.json()).resolves.toEqual({
            apiVersion: 1,
            error: {
              code: "upstream-unavailable",
              message: "The backend dependency is unavailable",
            },
          });
        }
      },
    );
  });

  it("fails closed when the worker result is malformed or changes recipient", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const otherRecipient = "0x3000000000000000000000000000000000000003";
    const mismatched = (async () =>
      jsonResponse({
        apiVersion: 1,
        recipient: { address: otherRecipient, state: "eligible" },
        service: { chainId: 84_532, state: "ready" },
      })) as typeof fetch;
    const malformed = (async () =>
      jsonResponse({
        apiVersion: 1,
        recipient: {
          address: recipient,
          balances: { ethWei: "-1", wethWei: "0" },
          state: "eligible",
        },
      })) as typeof fetch;

    for (const fetcher of [mismatched, malformed]) {
      await withServer(
        { configuration: configuration(), fetcher },
        async (url) => {
          const status = await fetch(
            `${url}/v1/funding/status?recipient=${recipient}`,
          );
          const fund = await fetch(`${url}/v1/funding/fund`, {
            body: JSON.stringify({
              recipient,
              source: "onboarding",
              proof: fundingProof,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          for (const response of [status, fund]) {
            expect(response.status).toBe(502);
            await expect(response.json()).resolves.toMatchObject({
              error: { code: "upstream-unavailable" },
            });
          }
        },
      );
    }
  });

  it("collapses operational funding failures to sanitized unavailability", async () => {
    const recipient = "0x2000000000000000000000000000000000000002";
    const fetcher = (async () =>
      jsonResponse(
        {
          apiVersion: 1,
          error: {
            code: "funding-configuration-invalid",
            message: "signer inventory does not match policy ledger 7",
          },
        },
        503,
      )) as typeof fetch;

    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(
          `${url}/v1/funding/status?recipient=${recipient}`,
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          error: { code: "funding-unavailable" },
        });
      },
    );
  });

  it("forwards recipient-free funding service status without recipient data", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(`${url}/v1/funding/status`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("set-cookie")).toBeNull();
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          service: {
            chainId: 84_532,
            state: "ready",
            targets: { wethWei: "100", ethWei: "10" },
          },
        });
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:8790/v1/status");
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer funding-tokenfunding-tokenfunding-token",
    );
  });

  it("checksums an optional funding-status recipient before forwarding", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const response = await fetch(
          `${url}/v1/funding/status?recipient=0x8d01188806aa960f95a3fe4a343dfc26a8a7e6b5`,
        );
        expect(response.status).toBe(200);
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://127.0.0.1:8790/v1/status?recipient=0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5",
    );
  });

  it("rejects malformed or ambiguous funding-status queries before forwarding", async () => {
    const requests: ObservedRequest[] = [];
    const recipient = "0x2000000000000000000000000000000000000002";
    const other = "0x3000000000000000000000000000000000000003";
    const invalidQueries = [
      {
        query: "?recipient=bad",
        code: "funding-invalid-request",
        message: "A valid nonzero wallet address is required",
      },
      {
        query: "?recipient=",
        code: "funding-invalid-request",
        message: "A valid nonzero wallet address is required",
      },
      {
        query: "?recipient=0x0000000000000000000000000000000000000000",
        code: "funding-invalid-request",
        message: "A valid nonzero wallet address is required",
      },
      {
        query: `?recipient=${recipient}&recipient=${other}`,
        code: "invalid-query",
        message: "Query parameter recipient is not supported or is repeated",
      },
      {
        query: "?admin=true",
        code: "invalid-query",
        message: "Query parameter admin is not supported or is repeated",
      },
      {
        query: `?recipient=${recipient}&admin=true`,
        code: "invalid-query",
        message: "Query parameter admin is not supported or is repeated",
      },
    ] as const;
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        for (const invalid of invalidQueries) {
          const response = await fetch(
            `${url}/v1/funding/status${invalid.query}`,
          );
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toEqual({
            apiVersion: 1,
            error: { code: invalid.code, message: invalid.message },
          });
        }
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("handles exact CORS preflight and rejects untrusted origins", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const preflight = await fetch(`${url}/v1/funding/fund`, {
          headers: {
            "access-control-request-headers": "content-type",
            "access-control-request-method": "POST",
            origin: allowedOrigin,
          },
          method: "OPTIONS",
        });
        const rejected = await fetch(`${url}/v1/history/status`, {
          headers: { origin: "https://attacker.example" },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-methods")).toBe(
          "POST",
        );
        expect(rejected.status).toBe(403);
        expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("does not expose ingestion, unknown routes, or wrong methods", async () => {
    const requests: ObservedRequest[] = [];
    await withServer(
      { configuration: configuration(), fetcher: observingFetcher(requests) },
      async (url) => {
        const ingestion = await fetch(`${url}/internal/v1/keeper-attempts`, {
          method: "POST",
        });
        const unknown = await fetch(
          `${url}/v1/history/internal/v1/keeper-attempts`,
        );
        const wrongMethod = await fetch(`${url}/v1/history/status`, {
          method: "POST",
        });
        expect(ingestion.status).toBe(404);
        expect(unknown.status).toBe(404);
        expect(wrongMethod.status).toBe(405);
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects unsupported queries, media types, fields, and oversized bodies", async () => {
    const requests: ObservedRequest[] = [];
    const smallConfiguration = {
      ...configuration(),
      maximumRequestBodyBytes: 256,
    };
    await withServer(
      {
        configuration: smallConfiguration,
        fetcher: observingFetcher(requests),
      },
      async (url) => {
        const query = await fetch(`${url}/v1/history/status?admin=true`);
        const media = await fetch(`${url}/v1/funding/fund`, {
          body: "{}",
          method: "POST",
        });
        const fields = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({
            amount: "1000000000000000000",
            recipient: "0x2000000000000000000000000000000000000002",
            source: "faucet",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const large = await fetch(`${url}/v1/funding/fund`, {
          body: JSON.stringify({ value: "x".repeat(300) }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        expect(query.status).toBe(400);
        expect(media.status).toBe(415);
        expect(fields.status).toBe(400);
        expect(large.status).toBe(413);
      },
    );
    expect(requests).toHaveLength(0);
  });

  it("lets a decoder-maximum verify body reach only the verification route", async () => {
    const verify = vi.fn<AdminAuthService["verify"]>(async () => ({
      ok: false,
      reason: "unauthenticated",
    }));
    const adminAuth: AdminAuthService = {
      authorize: async () => ({ ok: false, reason: "unauthenticated" }),
      issueChallenge: () => {
        throw new Error("challenge should not be reached");
      },
      logout: () => ({ ok: false, reason: "unauthenticated" }),
      verify,
    };
    const smallConfiguration = {
      ...configuration(),
      maximumRequestBodyBytes: 256,
    };
    await withServer(
      { adminAuth, configuration: smallConfiguration },
      async (url) => {
        const input = {
          message: "m".repeat(8_192),
          signature: `0x${"ab".repeat(4_096)}` as const,
        };
        const verification = await fetch(`${url}${ADMIN_AUTH_PATHS.verify}`, {
          body: JSON.stringify(input),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });
        expect(verification.status).toBe(401);
        expect(verify).toHaveBeenCalledOnce();
        expect(verify).toHaveBeenCalledWith(input);

        const challenge = await fetch(`${url}${ADMIN_AUTH_PATHS.challenge}`, {
          body: JSON.stringify({
            address: adminAddress,
            padding: "x".repeat(300),
          }),
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
          },
          method: "POST",
        });
        expect(challenge.status).toBe(413);

        const oversizedVerification = await fetch(
          `${url}${ADMIN_AUTH_PATHS.verify}`,
          {
            body: JSON.stringify({
              message: "m".repeat(20_480),
              signature: "0xab",
            }),
            headers: {
              "content-type": "application/json",
              origin: allowedOrigin,
            },
            method: "POST",
          },
        );
        expect(oversizedVerification.status).toBe(413);
        expect(verify).toHaveBeenCalledOnce();
      },
    );
  });

  it("preserves safe upstream status and Retry-After without forwarding other headers", async () => {
    const fetcher = (async () =>
      jsonResponse(
        {
          apiVersion: 1,
          error: {
            code: "funding-rate-limited",
            message: "private policy ledger says attempt 4 exceeded bucket 7",
            nextEligibleAt: 1_788_155_200_000,
            policyBucket: 7,
          },
        },
        429,
        { "retry-after": "60", "set-cookie": "secret=true" },
      )) as typeof fetch;
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(
          `${url}/v1/funding/status?recipient=0x2000000000000000000000000000000000000002`,
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(response.headers.get("set-cookie")).toBeNull();
        await expect(response.json()).resolves.toEqual({
          apiVersion: 1,
          error: {
            code: "funding-rate-limited",
            nextEligibleAt: 1_788_155_200_000,
          },
        });
      },
    );
  });

  it("drops an unsafe upstream Retry-After value", async () => {
    // Exercised through funding: history no longer passes non-200 statuses
    // through at all, because upstream 400/401 bodies carried index internals
    // and credential-rotation failures to the public.
    const fetcher = (async () =>
      jsonResponse(
        {
          apiVersion: 1,
          error: { code: "funding-rate-limited" },
        },
        429,
        { "retry-after": "not-a-delay" },
      )) as typeof fetch;
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(
          `${url}/v1/funding/status?recipient=0x2000000000000000000000000000000000000002`,
          { headers: { origin: allowedOrigin } },
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBeNull();
      },
    );
  });

  it("collapses a non-success history upstream to a generic 502", async () => {
    const fetcher = (async () =>
      jsonResponse(
        { error: "unauthorized", snapshot: { indexedThrough: 123 } },
        401,
      )) as typeof fetch;
    await withServer(
      { configuration: configuration(), fetcher },
      async (url) => {
        const response = await fetch(`${url}/v1/history/status`);
        expect(response.status).toBe(502);
        const body = (await response.json()) as {
          error?: { code?: string };
          snapshot?: unknown;
        };
        // A rotated-out-of-step read credential is an internal condition; the
        // worker's 401 body and index snapshot must not reach the public.
        expect(body.error?.code).toBe("upstream-unavailable");
        expect(body.snapshot).toBeUndefined();
      },
    );
  });

  it("returns fixed unavailable and timeout responses", async () => {
    const unavailable = (async () => {
      throw new Error("credential-bearing upstream diagnostic");
    }) as typeof fetch;
    const timedOut = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    for (const [fetcher, status, code] of [
      [unavailable, 502, "upstream-unavailable"],
      [timedOut, 504, "upstream-timeout"],
    ] as const) {
      await withServer(
        { configuration: configuration(), fetcher },
        async (url) => {
          const response = await fetch(`${url}/v1/history/status`);
          expect(response.status).toBe(status);
          const body = (await response.json()) as {
            readonly error: { readonly code: string };
          };
          expect(body.error.code).toBe(code);
          expect(JSON.stringify(body)).not.toContain("credential-bearing");
        },
      );
    }
  });

  it("returns a bounded 429 before touching an upstream", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const rateLimiter: RequestRateLimiter = {
      consume: () => ({ allowed: false, retryAfterSeconds: 7 }),
    };
    await withServer(
      {
        configuration: configuration(),
        fetcher,
        rateLimiters: allRateLimiters(rateLimiter),
      },
      async (url) => {
        const response = await fetch(`${url}/v1/history/status`);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("7");
      },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
