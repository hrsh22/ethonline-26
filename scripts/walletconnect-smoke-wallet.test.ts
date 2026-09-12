import { readFileSync } from "node:fs";
import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createFundingProofChallenge } from "@orbit/config/funding-proof";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEther,
  recoverMessageAddress,
  stringToHex,
  type Address,
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
  vi.stubEnv("SMOKE_WALLET_DELAY_FIRST_APPROVAL_RESPONSE_MS", undefined);
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
const stagingDeployment = decodeProtocolDeploymentManifest(
  JSON.parse(
    readFileSync(
      new URL("../deployments/84532.staging.json", import.meta.url),
      "utf8",
    ),
  ),
);
if (stagingDeployment.schemaVersion !== 3) {
  throw new Error("Staging deployment must use the CCA manifest schema");
}
const stagingWeth = getAddress(stagingDeployment.contracts.weth!);
const stagingPermit2 = getAddress(stagingDeployment.contracts.permit2!);
const stagingAuction = getAddress(
  stagingDeployment.contracts.continuousClearingAuction!,
);
const stagingEscrowFactory = getAddress(
  stagingDeployment.contracts.ccaBidEscrowFactory!,
);
const stagingRouter = getAddress(stagingDeployment.contracts.canonicalRouter!);
const stagingFuel = getAddress(stagingDeployment.contracts.fuelCore!);
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
const approvalAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const approvalData = (spender: Address, amount: bigint) =>
  encodeFunctionData({
    abi: approvalAbi,
    functionName: "approve",
    args: [spender, amount],
  });
const auctionPolicyAbi = parseAbi([
  "function deployEscrow(address beneficiary) returns (address escrow)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const tradeAbi = parseAbi([
  "function swapExactInput((bool fuelForWeth,uint256 amountIn,uint256 amountOutMinimum,address recipient,uint256 deadline,bool useNative) params) payable returns (uint256 amountOut)",
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

it("recognizes the staging WETH address and authorizes its exact Permit2 approval", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "auction-approve");
  await connect();
  const amount = 2n * 10n ** 18n;
  const data = approvalData(stagingPermit2, amount);
  expect(
    await requestTransaction({
      from: account.address,
      to: stagingWeth,
      data,
      value: "0x0",
    }),
  ).toMatchObject({ result: `0x${"a".repeat(64)}` });
  expect(wallet.sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ to: stagingWeth, data, value: 0n }),
  );
});

it("rejects unrelated staging approval spenders and targets", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "auction-approve");
  await connect();
  for (const transaction of [
    {
      from: account.address,
      to: stagingWeth,
      data: approvalData(getAddress(recipient), 1n),
      value: "0x0",
    },
    {
      from: account.address,
      to: getAddress(recipient),
      data: approvalData(stagingPermit2, 1n),
      value: "0x0",
    },
  ]) {
    expect(await requestTransaction(transaction)).toMatchObject({
      error: { code: -32_000 },
    });
  }
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
});

it("allows only self escrow preparation when explicitly enabled", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "auction-prepare");
  await connect();
  const transaction = (beneficiary: Address) => ({
    from: account.address,
    to: stagingEscrowFactory,
    data: encodeFunctionData({
      abi: auctionPolicyAbi,
      functionName: "deployEscrow",
      args: [beneficiary],
    }),
    value: "0x0",
  });
  expect(await requestTransaction(transaction(account.address))).toMatchObject({
    result: `0x${"a".repeat(64)}`,
  });
  expect(
    await requestTransaction(transaction(getAddress(recipient))),
  ).toMatchObject({
    error: { code: -32_000 },
  });
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
});

it("allows only bounded nonzero Permit2 allowance for the staging auction", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "auction-approve");
  await connect();
  const permitApproval = (
    token: Address,
    spender: Address,
    amount: bigint,
    expiration: number,
  ) => ({
    from: account.address,
    to: stagingPermit2,
    data: encodeFunctionData({
      abi: auctionPolicyAbi,
      functionName: "approve",
      args: [token, spender, amount, expiration],
    }),
    value: "0x0",
  });
  const expiration = Math.floor(Date.now() / 1_000) + 86_400;
  expect(
    await requestTransaction(
      permitApproval(stagingWeth, stagingAuction, 10n, expiration),
    ),
  ).toMatchObject({ result: `0x${"a".repeat(64)}` });
  for (const rejected of [
    permitApproval(stagingWeth, stagingAuction, 0n, expiration),
    permitApproval(stagingWeth, getAddress(recipient), 10n, expiration),
    permitApproval(stagingWeth, stagingAuction, 10n, expiration + 600),
    permitApproval(
      stagingWeth,
      stagingAuction,
      10n,
      Math.floor(Date.now() / 1_000) - 121,
    ),
  ]) {
    expect(await requestTransaction(rejected)).toMatchObject({
      error: { code: -32_000 },
    });
  }
  expect(wallet.sendTransaction).toHaveBeenCalledOnce();
});

it("supports staging buy and sell approvals only for the canonical router", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "approve,trade");
  await connect();
  for (const token of [stagingWeth, stagingFuel]) {
    expect(
      await requestTransaction({
        from: account.address,
        to: token,
        data: approvalData(stagingRouter, parseEther("0.001")),
        value: "0x0",
      }),
    ).toMatchObject({ result: `0x${"a".repeat(64)}` });
  }
  expect(
    await requestTransaction({
      from: account.address,
      to: stagingWeth,
      data: approvalData(stagingPermit2, 1n),
      value: "0x0",
    }),
  ).toMatchObject({ error: { code: -32_000 } });
  expect(wallet.sendTransaction).toHaveBeenCalledTimes(2);
});

it.each(["-1", "60001", "1.5", "Infinity", "NaN", "1e3", "", " 5 "])(
  "refuses an invalid approval-response delay before pairing (%s)",
  async (configuredDelay) => {
    const previousExitCode = process.exitCode;
    const diagnostic = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      vi.stubEnv(
        "SMOKE_WALLET_DELAY_FIRST_APPROVAL_RESPONSE_MS",
        configuredDelay,
      );
      await import("./walletconnect-smoke-wallet.ts");
      await vi.waitFor(() => expect(process.exitCode).toBe(1), {
        timeout: 100,
      });
      expect(diagnostic).toHaveBeenCalledWith(
        expect.stringContaining(
          "SMOKE_WALLET_DELAY_FIRST_APPROVAL_RESPONSE_MS",
        ),
      );
      expect(wallet.pair).not.toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
      diagnostic.mockRestore();
    }
  },
);

it("delays only the first broadcast ERC20 approval response, leaving trades and later approvals immediate", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
  vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
  vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "approve,trade");
  vi.stubEnv("SMOKE_WALLET_DELAY_FIRST_APPROVAL_RESPONSE_MS", "60000");
  await connect();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const diagnostic = vi
    .spyOn(console, "log")
    .mockImplementation(() => undefined);
  try {
    const trade = {
      from: account.address,
      to: stagingRouter,
      data: encodeFunctionData({
        abi: tradeAbi,
        functionName: "swapExactInput",
        args: [
          {
            fuelForWeth: false,
            useNative: false,
            amountIn: 1n,
            amountOutMinimum: 1n,
            recipient: account.address,
            deadline: BigInt(Math.floor(Date.now() / 1_000) + 600),
          },
        ],
      }),
      value: "0x0",
    };
    expect(await requestTransaction(trade)).toMatchObject({
      result: `0x${"a".repeat(64)}`,
    });
    const approval = {
      from: account.address,
      to: stagingWeth,
      data: approvalData(stagingRouter, 1n),
      value: "0x0",
    };
    // Rejected or failed submissions must not consume the one-shot delay.
    wallet.sendTransaction.mockRejectedValueOnce(
      new Error("Temporary send failure"),
    );
    expect(await requestTransaction(approval)).toMatchObject({
      error: { code: -32_000 },
    });
    let firstCompleted = false;
    const delayed = requestTransaction(approval).then((result) => {
      firstCompleted = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(firstCompleted).toBe(false);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(3);
    expect(wallet.respondSessionRequest).toHaveBeenCalledTimes(2);
    expect(diagnostic).toHaveBeenCalledWith(
      `Broadcast smoke transaction 0x${"a".repeat(64)}`,
    );
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("Delaying first approval response for 60000ms"),
    );
    expect(await requestTransaction(approval)).toMatchObject({
      result: `0x${"a".repeat(64)}`,
    });
    expect(await requestTransaction(trade)).toMatchObject({
      result: `0x${"a".repeat(64)}`,
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(firstCompleted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await delayed).toMatchObject({ result: `0x${"a".repeat(64)}` });
    expect(firstCompleted).toBe(true);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
    diagnostic.mockRestore();
  }
});

it.each([
  { fuelForWeth: false, useNative: false, value: "0x0" },
  {
    fuelForWeth: false,
    useNative: true,
    value: `0x${parseEther("0.001").toString(16)}`,
  },
  { fuelForWeth: true, useNative: false, value: "0x0" },
  { fuelForWeth: true, useNative: true, value: "0x0" },
])(
  "supports the exact $fuelForWeth/$useNative trade envelope",
  async ({ fuelForWeth, useNative, value }) => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT", "staging");
    vi.stubEnv("SMOKE_WALLET_ALLOW_TRANSACTIONS", "true");
    vi.stubEnv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1");
    vi.stubEnv("SMOKE_WALLET_ALLOWED_ACTIONS", "approve,trade");
    await connect();
    const params = {
      fuelForWeth,
      useNative,
      amountIn: parseEther("0.001"),
      amountOutMinimum: 1n,
      recipient: account.address,
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 600),
    };
    const transaction = (
      overrides: Partial<typeof params> = {},
      sentValue = value,
    ) => ({
      from: account.address,
      to: stagingRouter,
      data: encodeFunctionData({
        abi: tradeAbi,
        functionName: "swapExactInput",
        args: [{ ...params, ...overrides }],
      }),
      value: sentValue,
    });
    expect(await requestTransaction(transaction())).toMatchObject({
      result: `0x${"a".repeat(64)}`,
    });
    for (const rejected of [
      transaction({ recipient: getAddress(recipient) }),
      transaction({ amountIn: 0n }),
      transaction({ amountIn: parseEther("3") }),
      transaction({ deadline: params.deadline + 3_600n }),
      transaction({}, value === "0x0" ? "0x1" : "0x0"),
    ]) {
      expect(await requestTransaction(rejected)).toMatchObject({
        error: { code: -32_000 },
      });
    }
    expect(wallet.sendTransaction).toHaveBeenCalledOnce();
  },
);

it("rejects expired pairing links before starting the wallet without exposing their contents", async () => {
  const previousExitCode = process.exitCode;
  const diagnostic = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const pairingUri = `wc:${"c".repeat(64)}@2?relay-protocol=irn&symKey=${"d".repeat(64)}&expiryTimestamp=1`;
  try {
    vi.stubEnv("WALLETCONNECT_URI", pairingUri);
    await import("./walletconnect-smoke-wallet.ts");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(wallet.pair).not.toHaveBeenCalled();
    const output = diagnostic.mock.calls
      .map(([message]) => String(message))
      .join("");
    expect(output).toContain("pairing link has expired");
    expect(output).not.toContain(pairingUri);
    expect(output).not.toContain("d".repeat(64));
  } finally {
    process.exitCode = previousExitCode;
    diagnostic.mockRestore();
  }
});

it("pairs a fresh clipboard link after trimming surrounding whitespace", async () => {
  const expiry = Math.floor(Date.now() / 1_000) + 300;
  const pairingUri = `wc:${"c".repeat(64)}@2?relay-protocol=irn&symKey=${"d".repeat(64)}&expiryTimestamp=${expiry}`;
  vi.stubEnv("WALLETCONNECT_URI", ` ${pairingUri}\n`);
  await connect();
  expect(wallet.pair).toHaveBeenCalledWith({ uri: pairingUri });
});

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
