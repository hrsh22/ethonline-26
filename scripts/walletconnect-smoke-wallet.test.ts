import { readFileSync } from "node:fs";
import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createFundingProofChallenge } from "@orbit/config/funding-proof";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  recoverMessageAddress,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  sendTransaction: vi.fn().mockResolvedValue(`0x${"a".repeat(64)}`),
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

vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createWalletClient: () => ({ sendTransaction: wallet.sendTransaction }),
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
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "");
  vi.stubEnv("SMOKE_WALLET_TRANSFER_RECIPIENT", undefined);
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

const recipient = "0x2000000000000000000000000000000000000002";
const mirror = getAddress(
  decodeProtocolDeploymentManifest(
    JSON.parse(
      readFileSync(
        new URL("../deployments/84532.json", import.meta.url),
        "utf8",
      ),
    ),
  ).contracts.fuelMirror!,
);
const transferAbi = parseAbi([
  "function safeTransferFrom(address from,address to,uint256 identityId)",
]);
const transferData = (
  from = account.address,
  to = recipient,
  identityId = 42n,
) =>
  encodeFunctionData({
    abi: transferAbi,
    functionName: "safeTransferFrom",
    args: [from, getAddress(to), identityId],
  });
const requestTransaction = async (transaction: object) => {
  await wallet.handlers.get("session_request")?.({
    id: 3,
    topic: "smoke-session",
    params: {
      chainId: "eip155:84532",
      request: { method: "eth_sendTransaction", params: [transaction] },
    },
  });
  return wallet.respondSessionRequest.mock.lastCall?.[0].response;
};

it("sends only an enabled transfer from its own account to the configured recipient", async () => {
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "transfer");
  vi.stubEnv("SMOKE_WALLET_TRANSFER_RECIPIENT", recipient);
  await connect();
  const transaction = {
    from: account.address,
    to: mirror,
    data: transferData(),
    value: "0x0",
  };
  expect(await requestTransaction(transaction)).toMatchObject({
    result: `0x${"a".repeat(64)}`,
  });
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
  expect(wallet.sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ to: mirror, data: transferData(), value: 0n }),
  );
  for (const rejected of [
    { ...transaction, from: recipient },
    { ...transaction, to: recipient },
    { ...transaction, data: transferData(getAddress(recipient)) },
    { ...transaction, data: transferData(account.address, account.address) },
    { ...transaction, data: transferData(account.address, recipient, 0n) },
    { ...transaction, data: transferData(account.address, recipient, 4445n) },
    { ...transaction, value: "0x1" },
    {
      ...transaction,
      data: encodeFunctionData({
        abi: parseAbi([
          "function setApprovalForAll(address operator,bool approved)",
        ]),
        functionName: "setApprovalForAll",
        args: [recipient, true],
      }),
    },
  ]) {
    expect(await requestTransaction(rejected)).toMatchObject({
      error: { code: -32_000 },
    });
  }
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
});

it("does not send a transfer when only trading actions are enabled", async () => {
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "trade");
  vi.stubEnv("SMOKE_WALLET_TRANSFER_RECIPIENT", recipient);
  await connect();
  expect(
    await requestTransaction({
      from: account.address,
      to: mirror,
      data: transferData(),
      value: "0x0",
    }),
  ).toMatchObject({ error: { code: -32_000 } });
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
});

it.each([undefined, "0x0000000000000000000000000000000000000000", "invalid"])(
  "refuses transfer pairing without a valid nonzero recipient (%s)",
  async (configuredRecipient) => {
    const previousExitCode = process.exitCode;
    const diagnostic = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
      vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
      vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "transfer");
      vi.stubEnv("SMOKE_WALLET_TRANSFER_RECIPIENT", configuredRecipient);
      await import("./walletconnect-smoke-wallet.ts");
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
      expect(diagnostic).toHaveBeenCalledWith(
        expect.stringContaining("SMOKE_WALLET_TRANSFER_RECIPIENT"),
      );
      expect(wallet.pair).not.toHaveBeenCalled();
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
      diagnostic.mockRestore();
    }
  },
);
