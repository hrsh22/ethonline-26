import { createFundingProofChallenge } from "@orbit/config/funding-proof";
import { recoverMessageAddress, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => Promise<void>>(),
  approveSession: vi.fn(async () => ({ topic: "smoke-session" })),
  rejectSession: vi.fn(),
  pair: vi.fn(async () => undefined),
  getActiveSessions: () => ({}),
  respondSessionRequest: vi
    .fn<
      (request: {
        response: { result?: Hex; error?: { code: number } };
      }) => Promise<void>
    >()
    .mockResolvedValue(undefined),
}));

vi.mock("@walletconnect/core", () => ({ Core: class {} }));
vi.mock("@reown/walletkit", () => ({
  WalletKit: {
    init: async () => ({
      ...wallet,
      on: (name: string, handler: (event: unknown) => Promise<void>) =>
        wallet.handlers.set(name, handler),
    }),
  },
}));

const privateKey = `0x${"1".repeat(64)}` as const;
const account = privateKeyToAccount(privateKey);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  wallet.handlers.clear();
  vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "smoke-policy-test");
  vi.stubEnv("WALLETCONNECT_URI", "wc:smoke-policy-test");
  vi.stubEnv("SMOKE_WALLET_PRIVATE_KEY", privateKey);
  vi.stubEnv("SMOKE_WALLET_ALLOW_ADMIN_SIGN_IN", "false");
  vi.stubEnv("SMOKE_WALLET_ALLOW_FUNDING_PROOF", undefined);
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "false");
});

afterEach(() => vi.unstubAllEnvs());

const connect = async () => {
  await import("./walletconnect-smoke-wallet.ts");
  await vi.waitFor(() => expect(wallet.pair).toHaveBeenCalled());
  await wallet.handlers.get("session_proposal")?.({
    id: 1,
    params: {
      proposer: {
        metadata: { name: "ORBIT 4444", url: "http://localhost:3000" },
      },
      requiredNamespaces: {
        eip155: {
          chains: ["eip155:84532"],
          methods: ["personal_sign"],
          events: [],
        },
      },
      optionalNamespaces: {},
    },
  });
  expect(wallet.approveSession).toHaveBeenCalled();
};

const requestSignature = async (message: string) => {
  await wallet.handlers.get("session_request")?.({
    id: 2,
    topic: "smoke-session",
    params: {
      chainId: "eip155:84532",
      request: {
        method: "personal_sign",
        params: [stringToHex(message), account.address],
      },
    },
  });
  return wallet.respondSessionRequest.mock.lastCall?.[0].response;
};

const challenge = (
  overrides: Partial<Parameters<typeof createFundingProofChallenge>[0]> = {},
) =>
  createFundingProofChallenge({
    chainId: 84532,
    domain: "localhost:3000",
    issuedAtMilliseconds: Date.now(),
    nonce: "a".repeat(32),
    recipient: account.address,
    uri: "https://localhost:3000/faucet",
    ...overrides,
  }).message;

it("signs only current, site-bound faucet proofs when explicitly enabled", async () => {
  vi.stubEnv("SMOKE_WALLET_ALLOW_FUNDING_PROOF", "true");
  await connect();
  const message = challenge();
  const response = await requestSignature(message);
  expect(response?.result).toBeDefined();
  expect(
    await recoverMessageAddress({ message, signature: response!.result! }),
  ).toBe(account.address);

  for (const rejected of [
    challenge({ uri: "https://evil.test/faucet" }),
    challenge({ domain: "evil.test" }),
    challenge({ chainId: 1 }),
    challenge({ recipient: "0x2000000000000000000000000000000000000002" }),
    challenge({ issuedAtMilliseconds: Date.now() - 600_000 }),
    challenge({ issuedAtMilliseconds: Date.now() + 600_000 }),
    "Authorize unlimited spending",
  ]) {
    expect(await requestSignature(rejected)).toMatchObject({
      error: { code: -32_000 },
    });
  }
});

it("leaves faucet signing disabled by default", async () => {
  await connect();
  expect(await requestSignature(challenge())).toMatchObject({
    error: { code: 4001 },
  });
});
