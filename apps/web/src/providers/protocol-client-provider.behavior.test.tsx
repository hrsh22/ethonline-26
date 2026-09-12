/** @vitest-environment jsdom */

import { selectIdentityConfiguration } from "@orbit/config/identity";
import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";
import { protocolDeploymentManifest } from "@/lib/deployment";
import {
  collectorTransactionStorageKey,
  writeCollectorTransaction,
} from "@/lib/collector-transaction-record";
import { protocolAbis } from "@orbit/protocol/contracts";
import {
  prepareProtocolTransaction,
  type ProtocolAction,
  type TransactionRuntimeContext,
} from "@orbit/protocol/transactions";
import { AdminActionAuthorizationDeniedError } from "@/lib/admin-action-authorization";
import { AccessNotice } from "@/components/access-notice";
import { TransactionStatus } from "@/components/transaction-status";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CallExecutionError,
  encodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  InvalidParamsRpcError,
  RawContractError,
  RpcRequestError,
  TransactionExecutionError,
  UserRejectedRequestError,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const address = "0x0000000000000000000000000000000000000001";
  const hash = `0x${"12".repeat(32)}`;
  const health = {
    deployment: {
      observedBlock: 100n,
      observedAt: 1_000,
      launched: true,
      seals: { conversionRoutes: true, feeDestinations: true },
    },
    pauses: {
      liquidToken: false,
      rewards: false,
      converter: false,
      liquidity: false,
    },
    market: { rewardPotWeth: 0n },
    operations: { nextRewardEpochAt: 0n, trackQueues: [] },
    roles: { owners: {} },
    transactionReadAvailability: {},
  };
  const wallet = {
    observedBlock: 100n,
    collectibles: {
      transient: [],
      permanent: [],
      permanentHoldingsStatus: "complete" as const,
      permanentObservedBlock: 100n,
    },
    partialFailures: [],
  };
  const prepared = {
    abi: [
      {
        type: "function",
        name: "setPause",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [],
      },
    ],
    functionName: "setPause",
    args: [],
    to: address,
    value: 0n,
  };
  const healthQuery = {
    data: health,
    error: null as Error | null,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(async () => ({ data: health })),
  };
  const walletQuery = {
    data: wallet,
    error: null,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(async () => ({ data: wallet })),
  };
  const marketQuery = {
    data: undefined,
    error: null,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(async () => ({ data: undefined })),
  };
  const nativeBalance = {
    observedBlock: 101n,
    formatted: "0.01",
    rawWei: 10_000_000_000_000_000n,
  };
  const nativeBalanceQuery = {
    data: nativeBalance,
    error: null,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(async () => ({ data: nativeBalance })),
  };
  return {
    address,
    hash,
    health,
    healthQuery,
    historyBasePaths: [] as string[],
    prepared,
    wallet,
    walletQuery,
    marketQuery,
    nativeBalance,
    nativeBalanceQuery,
    queryClient: {
      cancelQueries: vi.fn(async () => undefined),
      refetchQueries: vi.fn(async () => undefined),
      invalidateQueries: vi.fn(async () => undefined),
      removeQueries: vi.fn(),
    },
    pathname: "/admin/operations",
    connection: {
      status: "connected",
      address: address as string | undefined,
      chainId: 84_532,
    },
    reader: {
      prepareTransaction: vi.fn<
        (
          action?: ProtocolAction,
          runtime?: TransactionRuntimeContext,
        ) => typeof prepared
      >(() => prepared),
      readExchangeAllowance: vi.fn(async () => ({ amount: 0n })),
      readHealth: vi.fn(async () => health),
      readWallet: vi.fn(async () => wallet),
      quoteExactInput: vi.fn(),
    },
    sendTransaction: vi.fn(async () => hash),
    transactionClient: {
      getBlockNumber: vi.fn(async () => 102n),
      getLogs: vi.fn(
        async () =>
          [] as {
            args: { owner: string; spender: string; value: bigint };
            transactionHash: string;
            removed: boolean;
          }[],
      ),
      readContract: vi.fn(async () => 0n),
      getChainId: vi.fn(async () => 84532),
      getTransaction: vi.fn(async () => ({
        hash,
        from: address,
        to: address,
        input: "0x1234",
        value: 0n,
        blockNumber: 102n,
        blockHash: hash,
      })),
      getTransactionReceipt: vi.fn(async () => ({
        transactionHash: hash,
        blockHash: hash,
        blockNumber: 102n,
        status: "success",
      })),
      call: vi.fn(async () => undefined),
      estimateGas: vi.fn(async () => 100_000n),
      getBlock: vi.fn(async () => ({
        hash: "0x01" as `0x${string}`,
        number: 101n,
        timestamp: 1_001n,
      })),
      waitForTransactionReceipt: vi.fn(async () => ({
        blockNumber: 100n,
        status: "success",
      })),
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => testState.pathname,
}));

vi.mock("wagmi", () => ({
  useConnection: () => testState.connection,
  useWalletClient: () => ({
    data: { sendTransaction: testState.sendTransaction },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => testState.queryClient,
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    switch (options.queryKey[0]) {
      case "protocol-health":
        return testState.healthQuery;
      case "protocol-wallet":
        return testState.walletQuery;
      case "protocol-native-balance":
        return testState.nativeBalanceQuery;
      default:
        return testState.marketQuery;
    }
  },
}));

vi.mock("@orbit/protocol/reader", () => ({
  createProtocolReader: () => testState.reader,
}));

vi.mock("@orbit/protocol/history", () => ({
  createIndexedHistoryReaders: (options: { readonly basePath: string }) => {
    testState.historyBasePaths.push(options.basePath);
    return { protocol: { basePath: options.basePath } };
  },
}));

vi.mock("@orbit/protocol/market-history", () => ({
  createCanonicalMarketHistoryReader: () => ({ readLatest: vi.fn() }),
}));

vi.mock("@orbit/protocol/viem-transport", () => ({
  makeViemProtocolTransport: () => ({}),
}));

vi.mock("@/lib/deployment", () => ({
  deploymentEnvironment: { chainId: 84_532 },
  protocolDeploymentManifest: {
    launch: { transactionHash: testState.hash },
    contracts: {
      fuelCore: testState.address,
      weth: "0x0000000000000000000000000000000000000016",
      canonicalRouter: "0x0000000000000000000000000000000000000014",
    },
  },
}));

vi.mock("@/lib/wagmi", () => ({
  protocolChain: { id: 84_532 },
  protocolReadClient: {},
  createProtocolReadClient: () => ({}),
  protocolTransactionClient: testState.transactionClient,
}));

import {
  composeAdminProtocolHistory,
  ProtocolClientProvider,
  readersForPath,
  useProtocolClient,
} from "./protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type SwapAction = Extract<ProtocolAction, { type: "swap-exact-input" }>;

const marketManager = "0x0000000000000000000000000000000000000003";
const liquidTokenUnit = 10n ** 18n;
const testIdentity = selectIdentityConfiguration("orbit-4444");

const prepareWithActualSwapSemantics = (
  action?: ProtocolAction,
  runtime?: TransactionRuntimeContext,
) => {
  if (action === undefined || runtime === undefined) return testState.prepared;
  return prepareProtocolTransaction(action, {
    ...runtime,
    identity: testIdentity,
    expectedChainId: 84_532,
    maximumQuoteAgeBlocks: 5n,
    canonicalTickSpacing: 60,
    contracts: {
      canonicalFeeHook: "0x0000000000000000000000000000000000000019",
      claimGate: "0x000000000000000000000000000000000000001a",
      fuelCore: "0x0000000000000000000000000000000000000010",
      weth: "0x0000000000000000000000000000000000000016",
      fuelMirror: "0x0000000000000000000000000000000000000011",
      rewardLedger: "0x0000000000000000000000000000000000000012",
      epochConverter: "0x0000000000000000000000000000000000000013",
      canonicalRouter: "0x0000000000000000000000000000000000000014",
      protocolLiquidityVault: "0x0000000000000000000000000000000000000015",
      uniswapV4PoolManager: marketManager,
    },
  });
};

const createSwapDiscovery = ({
  account,
  executable,
  liquidTokenForWeth,
}: {
  readonly account: `0x${string}`;
  readonly executable: boolean;
  readonly liquidTokenForWeth: boolean;
}): SwapAction["quote"]["discovery"] => {
  const mutations = executable ? 0 : 65;
  const walletEvidence = {
    account,
    balance: liquidTokenForWeth ? 4_444n * liquidTokenUnit : 0n,
    discoveryExempt: false,
    mutations,
  } as const;
  const marketEvidence = {
    account: marketManager,
    balance: liquidTokenForWeth ? 0n : 4_444n * liquidTokenUnit,
    discoveryExempt: true,
    mutations: 0,
  } as const;
  return {
    account,
    accountHoldings: {
      pendingDiscoveryCount: 0,
      transientCollectibleCount: liquidTokenForWeth ? 4_444 : 0,
    },
    sender: liquidTokenForWeth ? walletEvidence : marketEvidence,
    recipient: liquidTokenForWeth ? marketEvidence : walletEvidence,
    mutations,
    maximumMutations: 64,
    executable,
    maximumLiquidTokenAmount: liquidTokenForWeth
      ? 64n * liquidTokenUnit
      : 65n * liquidTokenUnit - 1n,
  };
};

const createSwapQuote = ({
  account = testState.address as `0x${string}`,
  amountIn = 10_000n,
  amountOut,
  executable = true,
  liquidTokenForWeth = false,
  observedBlock = 100n,
}: {
  readonly account?: `0x${string}`;
  readonly amountIn?: bigint;
  readonly amountOut?: bigint;
  readonly executable?: boolean;
  readonly liquidTokenForWeth?: boolean;
  readonly observedBlock?: bigint;
} = {}): SwapAction["quote"] => {
  const quotedAmountOut = amountOut ?? amountIn * 2n;
  return {
    observedBlock,
    expiresAtBlock: observedBlock + 5n,
    liquidTokenForWeth,
    amountIn,
    amountOut: quotedAmountOut,
    discovery: createSwapDiscovery({
      account,
      executable,
      liquidTokenForWeth,
    }),
  };
};

const transientRpcFailure = () =>
  new RpcRequestError({
    body: { method: "eth_call" },
    error: { code: -32_005, message: "over rate limit" },
    url: "https://rpc.example",
  });

let currentProtocol: ProtocolClient;

const captureProtocol = (protocol: ProtocolClient): void => {
  currentProtocol = protocol;
};

function ProtocolCapture() {
  const protocol = useProtocolClient();
  useEffect(() => captureProtocol(protocol), [protocol]);
  return null;
}

const saveInterruptedExchangeApproval = (withPrerequisite: boolean) => {
  const token = protocolDeploymentManifest!.contracts.weth as `0x${string}`;
  const spender = protocolDeploymentManifest!.contracts
    .canonicalRouter as `0x${string}`;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, 1_000n],
  });
  const scope = `${deploymentManifestFingerprint(protocolDeploymentManifest!)}:84532:${testState.address}`;
  writeCollectorTransaction(
    scope,
    { status: "simulated", label: "Approve WETH for exchange" },
    { kind: "approval" },
    {
      operationId: "lost-approval",
      actionType: "swap-exact-input",
      identityIds: [],
      affectedIdentityIds: [],
      createdAt: Date.now(),
      preparedCall: {
        chainId: 84532,
        from: testState.address as `0x${string}`,
        to: token,
        value: "0",
        dataHash: keccak256(data),
        afterBlock: "100",
        ...(withPrerequisite ? { approval: { spender, amount: "1000" } } : {}),
      },
    },
    true,
  );
  return { token, spender, data };
};

describe("protocol client transaction coordination", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    testState.pathname = "/admin/operations";
    window.localStorage.clear();
    testState.queryClient.invalidateQueries.mockClear();
    testState.historyBasePaths.length = 0;
    testState.connection.address = testState.address;
    testState.connection.chainId = 84_532;
    testState.connection.status = "connected";
    testState.healthQuery.error = null;
    testState.reader.prepareTransaction
      .mockReset()
      .mockReturnValue(testState.prepared);
    testState.reader.readExchangeAllowance
      .mockReset()
      .mockResolvedValue({ amount: 0n });
    testState.reader.readHealth.mockReset().mockResolvedValue(testState.health);
    testState.reader.readWallet.mockReset().mockResolvedValue(testState.wallet);
    testState.walletQuery.data = testState.wallet;
    testState.nativeBalanceQuery.data = testState.nativeBalance;
    testState.nativeBalanceQuery.refetch
      .mockReset()
      .mockResolvedValue({ data: testState.nativeBalance });
    testState.healthQuery.refetch
      .mockReset()
      .mockResolvedValue({ data: testState.health });
    testState.walletQuery.refetch
      .mockReset()
      .mockResolvedValue({ data: testState.wallet });
    testState.reader.quoteExactInput
      .mockReset()
      .mockImplementation(
        async (
          liquidTokenForWeth: boolean,
          amountIn: bigint,
          account: `0x${string}`,
        ) => createSwapQuote({ account, amountIn, liquidTokenForWeth }),
      );
    testState.sendTransaction.mockReset().mockResolvedValue(testState.hash);
    testState.transactionClient.call.mockReset().mockResolvedValue(undefined);
    testState.transactionClient.getBlockNumber
      .mockReset()
      .mockResolvedValue(102n);
    testState.transactionClient.getLogs.mockReset().mockResolvedValue([]);
    testState.transactionClient.readContract.mockReset().mockResolvedValue(0n);
    testState.transactionClient.estimateGas
      .mockReset()
      .mockResolvedValue(100_000n);
    testState.transactionClient.getBlock
      .mockReset()
      .mockResolvedValue({ hash: "0x01", number: 101n, timestamp: 1_001n });
    testState.transactionClient.waitForTransactionReceipt
      .mockReset()
      .mockResolvedValue({ blockNumber: 100n, status: "success" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("automatically clears the interrupted approval barrier after discovering its exact mined transaction", async () => {
    vi.useFakeTimers();
    await act(async () => root.unmount());
    testState.pathname = "/trade";
    const { token, spender, data } = saveInterruptedExchangeApproval(false);
    testState.transactionClient.getLogs.mockResolvedValue([
      {
        args: { owner: testState.address, spender, value: 1_000n },
        transactionHash: testState.hash,
        removed: false,
      },
    ]);
    testState.transactionClient.getTransaction.mockResolvedValue({
      hash: testState.hash,
      from: testState.address,
      to: token,
      input: data,
      value: 0n,
      blockNumber: 102n,
      blockHash: testState.hash,
    });
    testState.transactionClient.getBlock.mockResolvedValue({
      hash: testState.hash as `0x${string}`,
      number: 102n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    });
    testState.transactionClient.waitForTransactionReceipt.mockResolvedValue({
      transactionHash: testState.hash,
      blockHash: testState.hash,
      blockNumber: 102n,
      status: "success",
    } as Awaited<
      ReturnType<typeof testState.transactionClient.waitForTransactionReceipt>
    >);
    testState.walletQuery.refetch.mockResolvedValue({
      data: {
        ...testState.wallet,
        observedBlock: 102n,
        collectibles: {
          ...testState.wallet.collectibles,
          permanentObservedBlock: 102n,
        },
      },
    });
    testState.nativeBalanceQuery.refetch.mockResolvedValue({
      data: { ...testState.nativeBalance, observedBlock: 102n },
    });
    root = createRoot(container);
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(currentProtocol.transaction).toMatchObject({
      status: "confirmed",
      hash: testState.hash,
    });
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.completedTransactions).toHaveLength(0);
  });

  it.each(["allowance-satisfied", "continue-review", "legacy-review"] as const)(
    "returns an interrupted approval to a fresh quote via %s without submitting a purchase or inventing a receipt",
    async (mode) => {
      vi.useFakeTimers();
      await act(async () => root.unmount());
      testState.pathname = "/trade";
      saveInterruptedExchangeApproval(mode === "allowance-satisfied");
      if (mode === "legacy-review") {
        const key = Object.keys(localStorage).find((key) =>
          key.startsWith("orbit:collector-transaction:"),
        )!;
        const saved = JSON.parse(localStorage.getItem(key)!);
        delete saved.preparedCall;
        localStorage.setItem(key, JSON.stringify(saved));
      }
      testState.transactionClient.readContract.mockResolvedValue(
        mode === "allowance-satisfied" ? 1_000n : 0n,
      );
      root = createRoot(container);
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      expect(currentProtocol.transactionMetadata?.isApproval).toBe(true);
      expect(currentProtocol.transaction).toMatchObject({
        status: "submission-unknown",
        message: "Checking your approval on Base Sepolia…",
      });
      await act(async () => vi.advanceTimersByTimeAsync(0));
      if (mode !== "allowance-satisfied") {
        expect(currentProtocol.transaction.status).toBe("submission-unknown");
        await act(async () => currentProtocol.resumeApproval?.());
      }
      expect(currentProtocol.transaction.status).toBe("idle");
      expect(currentProtocol.exchangeQuoteRevision).toBeGreaterThan(0);
      expect(testState.sendTransaction).not.toHaveBeenCalled();
      expect(currentProtocol.completedTransactions).toHaveLength(0);
    },
  );

  it("never clears another wallet’s pending activity when approval recovery finishes late", async () => {
    vi.useFakeTimers();
    await act(async () => root.unmount());
    testState.pathname = "/trade";
    saveInterruptedExchangeApproval(true);
    let resolveAllowance: (amount: bigint) => void = () => {};
    testState.transactionClient.readContract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAllowance = resolve;
        }),
    );
    root = createRoot(container);
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    testState.connection.address = "0x0000000000000000000000000000000000000002";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    await act(async () => {
      resolveAllowance(1_000n);
    });
    expect(currentProtocol.transaction.status).toBe("idle");
    expect(currentProtocol.exchangeQuoteRevision).toBe(0);
    expect(testState.sendTransaction).not.toHaveBeenCalled();
  });

  it("restores a collector submission after reload and reconciles the original hash automatically", async () => {
    vi.useFakeTimers();
    testState.pathname = "/fleet/1639";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    testState.transactionClient.waitForTransactionReceipt.mockRejectedValueOnce(
      new Error("receipt RPC unavailable"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () => {
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch Grounded Craft #1639",
      );
    });
    expect(currentProtocol.transaction).toMatchObject({
      status: "outcome-unknown",
      hash: testState.hash,
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    testState.pathname = "/fleet";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    expect(currentProtocol.transaction).toMatchObject({
      hash: testState.hash,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    expect(currentProtocol.transaction).toMatchObject({ hash: testState.hash });
  });

  it("bounds confirmed collector activity to its completion route while retaining completed history", async () => {
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );

    await act(async () => {
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch Grounded Craft #1639",
      );
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(currentProtocol.completedTransactions).toHaveLength(1);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    expect(currentProtocol.transaction.status).toBe("idle");
    expect(currentProtocol.completedTransactions).toHaveLength(1);

    await act(async () => {
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1640 },
        "Launch Grounded Craft #1640",
      );
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(currentProtocol.completedTransactions).toHaveLength(2);

    testState.pathname = "/fleet";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    expect(currentProtocol.transaction.status).toBe("idle");
    expect(currentProtocol.completedTransactions).toHaveLength(2);
  });

  it("persists the prepared call before a wallet can mine without returning its hash", async () => {
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    let returnHash: (hash: string) => void = () => {};
    testState.sendTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          returnHash = resolve;
        }),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;
    await act(async () => {
      execution = currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
      await vi.waitFor(() =>
        expect(testState.sendTransaction).toHaveBeenCalledOnce(),
      );
    });
    const storedKey = Object.keys(localStorage).find((key) =>
      key.startsWith("orbit:collector-transaction:"),
    );
    const stored = JSON.parse(localStorage.getItem(storedKey ?? "") ?? "null");
    try {
      expect(stored.state.status).toBe("simulated");
      expect(stored.preparedCall).toMatchObject({
        from: testState.address,
        to: testState.prepared.to,
        chainId: 84532,
        value: "0",
      });
    } finally {
      await act(async () => {
        returnHash(testState.hash);
        await execution;
      });
    }
  });

  it.each(["canonical", "orphan-after-refresh"] as const)(
    "recovers a lost wallet hash only while its receipt remains %s",
    async (evidence) => {
      testState.pathname = "/fleet/1639";
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      let returnHash: (hash: string) => void = () => {};
      testState.sendTransaction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            returnHash = resolve;
          }),
      );
      let execution: ReturnType<ProtocolClient["execute"]> | undefined;
      await act(async () => {
        execution = currentProtocol.execute(
          { type: "commit-collectible", identityId: 1639 },
          "Launch #1639",
        );
        await vi.waitFor(() =>
          expect(testState.sendTransaction).toHaveBeenCalledOnce(),
        );
      });
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      expect(currentProtocol.transaction.status).toBe("submission-unknown");
      expect(currentProtocol.transactionMetadata?.canRecoverHash).toBe(true);
      testState.transactionClient.getTransaction.mockResolvedValue({
        hash: testState.hash,
        from: testState.address,
        to: testState.prepared.to,
        input: encodeFunctionData(testState.prepared),
        value: 0n,
        blockNumber: 102n,
        blockHash: testState.hash,
      });
      testState.transactionClient.getBlock.mockResolvedValue({
        hash: testState.hash as `0x${string}`,
        number: 102n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      });
      testState.transactionClient.waitForTransactionReceipt.mockResolvedValue({
        blockNumber: 102n,
        status: "success",
        transactionHash: testState.hash,
        blockHash: testState.hash,
      } as Awaited<
        ReturnType<typeof testState.transactionClient.waitForTransactionReceipt>
      >);
      if (evidence === "orphan-after-refresh") {
        const canonical = {
          hash: testState.hash as `0x${string}`,
          number: 102n,
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
        };
        testState.transactionClient.getBlock
          .mockResolvedValue({ ...canonical, hash: "0x99" })
          .mockResolvedValueOnce(canonical)
          .mockResolvedValueOnce(canonical);
      }
      try {
        await act(async () => {
          await currentProtocol.recoverTransactionHash?.(testState.hash);
        });
        expect(currentProtocol.transaction).toMatchObject({
          status: evidence === "canonical" ? "confirmed" : "outcome-unknown",
          hash: testState.hash,
        });
        expect(testState.sendTransaction).toHaveBeenCalledOnce();
      } finally {
        await act(async () => {
          returnHash(testState.hash);
          await execution;
        });
      }
    },
  );

  it("allows only one wallet submission while an operation is pending", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;

    await act(async () => {
      const first = currentProtocol.execute(action, "Pause Reward Ledger");
      const second = currentProtocol.execute(action, "Pause Reward Ledger");
      await Promise.all([first, second]);
    });

    expect(testState.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("runs an injected action authorization after preparation and before wallet submission", async () => {
    const order: string[] = [];
    testState.reader.prepareTransaction.mockImplementation(() => {
      order.push("prepare");
      return testState.prepared;
    });
    testState.sendTransaction.mockImplementation(async () => {
      order.push("submit");
      return testState.hash;
    });
    const authorize = vi.fn(async () => {
      order.push("authorize");
    });
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger", authorize);
    });

    expect(authorize).toHaveBeenCalledWith(action);
    expect(order).toEqual(["prepare", "authorize", "submit"]);
  });

  it("fails closed before wallet submission when action authorization is denied", async () => {
    const authorize = vi.fn(async () => {
      throw new Error("session denied");
    });
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger", authorize);
    });

    expect(authorize).toHaveBeenCalledWith(action);
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("retriable");
    consoleError.mockRestore();
  });

  it("treats an exact action-role denial as non-retriable", async () => {
    const authorize = vi.fn(async () => {
      throw new AdminActionAuthorizationDeniedError({
        type: "open-reward-epoch",
      });
    });
    const action = { type: "open-reward-epoch" } as const;
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Open Reward Epoch", authorize);
    });

    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction).toMatchObject({
      status: "failed",
      message: expect.stringContaining("not authorized"),
    });
    await act(async () => {
      await currentProtocol.retry(authorize);
    });
    expect(authorize).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("creates an exact cookie-bearing history reader for admin operations", () => {
    expect(testState.historyBasePaths).toContain("/api/admin/history");
  });

  it("refreshes wallet balances without refetching protocol health", async () => {
    testState.pathname = "/exchange";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    testState.healthQuery.refetch.mockClear();
    testState.walletQuery.refetch.mockClear();
    testState.marketQuery.refetch.mockClear();

    await act(async () => {
      await currentProtocol.refreshWallet();
    });

    expect(testState.walletQuery.refetch).toHaveBeenCalledOnce();
    expect(testState.nativeBalanceQuery.refetch).toHaveBeenCalledOnce();
    expect(testState.healthQuery.refetch).not.toHaveBeenCalled();
  });

  it.each(["permanent", "native"] as const)(
    "keeps confirmed transactions visibly synchronizing until %s evidence includes their receipt, without resubmitting",
    async (laggingRead) => {
      const action = {
        type: "set-pause",
        module: "rewards",
        paused: true,
      } as const;
      const currentBalances = {
        ...testState.wallet,
        observedBlock: 101n,
        collectibles: {
          ...testState.wallet.collectibles,
          permanentObservedBlock: laggingRead === "permanent" ? 100n : 101n,
        },
      };
      if (laggingRead === "native") {
        const staleNative = { ...testState.nativeBalance, observedBlock: 100n };
        testState.nativeBalanceQuery.data = staleNative;
        testState.nativeBalanceQuery.refetch.mockResolvedValue({
          data: staleNative,
        });
      }
      testState.walletQuery.data = currentBalances;
      testState.walletQuery.refetch.mockResolvedValue({
        data: currentBalances,
      });
      testState.transactionClient.waitForTransactionReceipt.mockResolvedValue({
        blockNumber: 101n,
        status: "success",
      });
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
            <AccessNotice />
          </ProtocolClientProvider>,
        );
        await currentProtocol.execute(action, "Pause Reward Ledger");
      });

      expect(currentProtocol.transaction.status).toBe("confirmed");
      expect(currentProtocol.walletSynchronizing).toBe(true);
      expect(currentProtocol.walletRead).toMatchObject({
        status: "loaded",
        snapshot: {
          collectibles: {
            permanentHoldingsStatus:
              laggingRead === "permanent" ? "unavailable" : "complete",
          },
        },
      });
      expect(currentProtocol.getActionState(action).enabled).toBe(false);
      expect(container.textContent).toContain(
        "Updating wallet data from the confirmed block",
      );

      const caughtUp = {
        ...currentBalances,
        collectibles: {
          ...currentBalances.collectibles,
          permanentObservedBlock: 101n,
        },
      };
      testState.walletQuery.data = caughtUp;
      testState.walletQuery.refetch.mockResolvedValue({ data: caughtUp });
      testState.nativeBalanceQuery.data = testState.nativeBalance;
      testState.nativeBalanceQuery.refetch.mockResolvedValue({
        data: testState.nativeBalance,
      });
      const refresh = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Refresh wallet",
      );
      expect(refresh).toBeUndefined();
      await act(async () => {
        // The real-query integration tests cover automatic polling. This
        // mocked observer receives the next background result here.
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
            <AccessNotice />
          </ProtocolClientProvider>,
        );
      });
      expect(currentProtocol.walletSynchronizing).toBe(false);
      expect(currentProtocol.walletRead).toMatchObject({
        status: "loaded",
        snapshot: { collectibles: { permanentHoldingsStatus: "complete" } },
      });
      expect(currentProtocol.transaction.status).toBe("confirmed");
      expect(testState.sendTransaction).toHaveBeenCalledOnce();
    },
  );

  it("does not launch wallet refresh reads while wallet access is blocked", async () => {
    testState.pathname = "/exchange";
    testState.connection.status = "disconnected";
    testState.connection.address = undefined;
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    testState.healthQuery.refetch.mockClear();
    testState.walletQuery.refetch.mockClear();
    testState.marketQuery.refetch.mockClear();

    await act(async () => {
      await currentProtocol.refreshWallet();
    });

    expect(testState.walletQuery.refetch).not.toHaveBeenCalled();
    expect(testState.marketQuery.refetch).not.toHaveBeenCalled();
    expect(testState.healthQuery.refetch).not.toHaveBeenCalled();
  });

  it("uses public history except for protected operational evidence", async () => {
    const publicReward = vi.fn(async () => undefined as never);
    const publicPermanent = vi.fn(async () => undefined as never);
    const publicOperational = vi.fn(async () => undefined as never);
    const protectedOperational = vi.fn(async () => undefined as never);
    const shared = {
      discoveries: vi.fn(async () => undefined as never),
      liquidityCycles: vi.fn(async () => undefined as never),
      operations: vi.fn(async () => undefined as never),
    };
    const publicHistory = {
      ...shared,
      permanentIdentityCandidates: publicPermanent,
      recentOperationalEvents: publicOperational,
      rewardHistory: publicReward,
    };
    const protectedHistory = {
      ...shared,
      permanentIdentityCandidates: vi.fn(async () => undefined as never),
      recentOperationalEvents: protectedOperational,
      rewardHistory: vi.fn(async () => undefined as never),
    };
    const composed = composeAdminProtocolHistory(
      publicHistory,
      protectedHistory,
    );

    await composed.rewardHistory(1n, 2n);
    await composed.permanentIdentityCandidates(1n, 2n);
    await composed.recentOperationalEvents(1n, 2n, 10);

    expect(publicReward).toHaveBeenCalledOnce();
    expect(publicPermanent).toHaveBeenCalledOnce();
    expect(protectedOperational).toHaveBeenCalledOnce();
    expect(publicOperational).not.toHaveBeenCalled();
  });

  it("keeps public admin sign-in on public readers", () => {
    const publicReader = { id: "public" };
    const adminReader = { id: "admin" };
    const selected = readersForPath(
      {
        adminReader,
        adminTransactionReader: adminReader,
        publicReader,
        publicTransactionReader: publicReader,
      } as never,
      "/admin/sign-in",
    );

    expect(selected.reader).toBe(publicReader);
    expect(selected.transactionReader).toBe(publicReader);
  });

  it("retries one transient transaction simulation failure before wallet submission", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.call
      .mockRejectedValueOnce(transientRpcFailure())
      .mockResolvedValue(undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });

    expect(testState.transactionClient.call).toHaveBeenCalledTimes(2);
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    expect(currentProtocol.transaction.status).toBe("confirmed");
  });

  it("retries one transient gas-estimate failure before wallet submission", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.estimateGas
      .mockRejectedValueOnce(transientRpcFailure())
      .mockResolvedValue(100_000n);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });

    expect(testState.transactionClient.estimateGas).toHaveBeenCalledTimes(2);
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    expect(currentProtocol.transaction.status).toBe("confirmed");
  });

  it("bounds persistent transient simulation failures to one extra attempt", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.call.mockRejectedValue(transientRpcFailure());
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });

    expect(testState.transactionClient.call).toHaveBeenCalledTimes(2);
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("retriable");
    consoleError.mockRestore();
  });

  it("does not retry a deterministic simulation failure", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.call.mockRejectedValue(
      new InvalidParamsRpcError(new Error("invalid transaction parameters")),
    );
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });

    expect(testState.transactionClient.call).toHaveBeenCalledOnce();
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed instead of stranding pending state when a provider rejects with a hostile proxy", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    const hostile = Proxy.revocable(new Error("provider secret"), {});
    hostile.revoke();
    testState.transactionClient.call.mockRejectedValueOnce(hostile.proxy);
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });

    expect(currentProtocol.transaction).toMatchObject({
      status: "retriable",
      message: expect.any(String),
    });
    expect(currentProtocol.transaction.status).not.toBe("pending");
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(JSON.stringify(currentProtocol.transaction)).not.toContain(
      "provider secret",
    );
    consoleError.mockRestore();
  });

  it("abandons a transient retry when its route scope changes", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.call.mockRejectedValueOnce(
      transientRpcFailure(),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;

    await act(async () => {
      execution = currentProtocol.execute(action, "Pause Reward Ledger");
      await vi.waitFor(() =>
        expect(testState.transactionClient.call).toHaveBeenCalledOnce(),
      );
    });

    testState.pathname = "/trade";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    await act(async () => {
      await execution;
    });

    expect(testState.transactionClient.call).toHaveBeenCalledOnce();
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("idle");
  });

  it("never resurrects a deferred simulation after an A-to-B-to-A scope change", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    let finishSimulation: () => void = () => undefined;
    testState.transactionClient.call.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishSimulation = () => resolve(undefined);
        }),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;

    await act(async () => {
      execution = currentProtocol.execute(action, "Pause Reward Ledger");
      await vi.waitFor(() =>
        expect(testState.transactionClient.call).toHaveBeenCalledOnce(),
      );
    });

    testState.pathname = "/trade";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    testState.pathname = "/admin/operations";
    testState.queryClient.invalidateQueries.mockClear();
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });

    await act(async () => {
      finishSimulation();
      await execution;
    });

    expect(testState.transactionClient.call).toHaveBeenCalledOnce();
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("idle");
  });

  it("disables every action while wallet submission is awaiting approval", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    let approveWallet: (hash: `0x${string}`) => void = () => undefined;
    testState.sendTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          approveWallet = resolve;
        }),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;

    await act(async () => {
      execution = currentProtocol.execute(action, "Pause Reward Ledger");
      await vi.waitFor(() =>
        expect(testState.sendTransaction).toHaveBeenCalledOnce(),
      );
    });

    expect(currentProtocol.transaction.status).toBe("simulated");
    expect(currentProtocol.getActionState(action)).toMatchObject({
      enabled: false,
    });

    await act(async () => {
      approveWallet(testState.hash as `0x${string}`);
      await execution;
    });
  });

  it.each(["route", "account", "chain"] as const)(
    "keeps same-wallet route locks and isolates a deferred wallet prompt after a %s change",
    async (scopeChange) => {
      const action = {
        type: "set-pause",
        module: "rewards",
        paused: true,
      } as const;
      let rejectWallet: (cause: unknown) => void = () => undefined;
      testState.sendTransaction.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectWallet = reject;
          }),
      );
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      let execution: ReturnType<ProtocolClient["execute"]> | undefined;

      await act(async () => {
        execution = currentProtocol.execute(action, "Pause Reward Ledger");
        await vi.waitFor(() =>
          expect(testState.sendTransaction).toHaveBeenCalledOnce(),
        );
      });

      if (scopeChange === "route") testState.pathname = "/trade";
      if (scopeChange === "account") {
        testState.connection.address =
          "0x0000000000000000000000000000000000000002";
      }
      if (scopeChange === "chain") testState.connection.chainId = 1;
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });

      const stateDuringPrompt = currentProtocol.transaction.status;
      const actionDuringPrompt = currentProtocol.getActionState(action);
      await act(async () => {
        rejectWallet(
          new Error("wallet connection lost before returning a hash"),
        );
        await execution;
      });

      expect(testState.queryClient.invalidateQueries).not.toHaveBeenCalled();
      expect(stateDuringPrompt).toBe(
        scopeChange === "route" ? "simulated" : "idle",
      );
      expect(actionDuringPrompt.enabled).toBe(scopeChange === "account");
      expect(currentProtocol.transaction.status).toBe(
        scopeChange === "route" ? "submission-unknown" : "idle",
      );
      expect(testState.sendTransaction).toHaveBeenCalledTimes(1);
      consoleError.mockRestore();
    },
  );

  it.each(["route", "account", "chain"] as const)(
    "clears a deferred wallet submission after it settles on the old %s scope",
    async (scopeChange) => {
      const action = {
        type: "set-pause",
        module: "rewards",
        paused: true,
      } as const;
      let submitWallet: (hash: `0x${string}`) => void = () => undefined;
      testState.sendTransaction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            submitWallet = resolve;
          }),
      );
      let execution: ReturnType<ProtocolClient["execute"]> | undefined;

      await act(async () => {
        execution = currentProtocol.execute(action, "Pause Reward Ledger");
        await vi.waitFor(() =>
          expect(testState.sendTransaction).toHaveBeenCalledOnce(),
        );
      });

      if (scopeChange === "route") testState.pathname = "/trade";
      if (scopeChange === "account") {
        testState.connection.address =
          "0x0000000000000000000000000000000000000002";
      }
      if (scopeChange === "chain") testState.connection.chainId = 1;
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });
      const stateDuringPrompt = currentProtocol.transaction.status;

      await act(async () => {
        submitWallet(testState.hash as `0x${string}`);
        await execution;
      });

      if (scopeChange === "route") {
        expect(testState.queryClient.invalidateQueries).toHaveBeenCalledWith({
          queryKey: ["protocol-wallet", testState.hash, testState.address],
          refetchType: "active",
        });
      } else
        expect(testState.queryClient.invalidateQueries).not.toHaveBeenCalled();
      expect(stateDuringPrompt).toBe(
        scopeChange === "route" ? "simulated" : "idle",
      );
      expect(currentProtocol.transaction.status).toBe("idle");
      expect(testState.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        testState.transactionClient.waitForTransactionReceipt,
      ).toHaveBeenCalledOnce();
    },
  );

  it.each(["route", "account", "chain"] as const)(
    "invalidates a deferred stale-quote retry before preflight after a %s change",
    async (scopeChange) => {
      const action: Extract<ProtocolAction, { type: "swap-exact-input" }> = {
        type: "swap-exact-input",
        quote: createSwapQuote({ amountIn: 1n, amountOut: 2n }),
        liquidTokenForWeth: false,
        exactAmountIn: 1n,
        minimumAmountOut: 1n,
        recipient: testState.address as `0x${string}`,
        deadline: 1_600n,
        useNative: true,
      };
      testState.transactionClient.call.mockRejectedValue(
        new Error("stale simulation rpc"),
      );
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });
      expect(currentProtocol.transaction.status).toBe("retriable");
      expect(testState.transactionClient.getBlock).toHaveBeenCalledOnce();
      expect(testState.reader.quoteExactInput).toHaveBeenCalledWith(
        false,
        1n,
        testState.address,
      );
      testState.reader.quoteExactInput.mockClear();

      testState.healthQuery.error = new Error("current health read failed");
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });

      let finishQuote: (quote: typeof action.quote) => void = () => undefined;
      testState.reader.quoteExactInput.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishQuote = resolve;
          }),
      );
      let retry: ReturnType<ProtocolClient["retry"]> | undefined;
      await act(async () => {
        retry = currentProtocol.retry();
        await vi.waitFor(() =>
          expect(testState.reader.quoteExactInput).toHaveBeenCalledOnce(),
        );
      });

      if (scopeChange === "route") testState.pathname = "/trade";
      if (scopeChange === "account") {
        testState.connection.address =
          "0x0000000000000000000000000000000000000002";
      }
      if (scopeChange === "chain") testState.connection.chainId = 1;
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });
      const stateDuringQuote = currentProtocol.transaction.status;
      let finishStalePreflight: (
        health: typeof testState.health,
      ) => void = () => undefined;
      testState.reader.readHealth.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishStalePreflight = resolve;
          }),
      );

      await act(async () => {
        finishQuote({
          ...action.quote,
          observedBlock: 101n,
          expiresAtBlock: 106n,
          amountOut: 3n,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      const stalePreflightCalls = testState.reader.readHealth.mock.calls.length;
      await act(async () => {
        if (stalePreflightCalls > 0) finishStalePreflight(testState.health);
        await retry;
      });

      expect(stateDuringQuote).toBe(
        scopeChange === "route" ? "pending" : "idle",
      );
      expect(currentProtocol.transaction.status).toBe("idle");
      expect(testState.transactionClient.getBlock).toHaveBeenCalledOnce();
      expect(stalePreflightCalls).toBe(0);
      expect(testState.sendTransaction).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
  );

  it.each([
    new Error("receipt rpc timed out"),
    new UserRejectedRequestError(new Error("provider secret")),
  ])(
    "reconciles an unknown submitted outcome without sending it again %#",
    async (receiptFailure) => {
      const action = {
        type: "set-pause",
        module: "rewards",
        paused: true,
      } as const;
      testState.transactionClient.waitForTransactionReceipt
        .mockRejectedValueOnce(receiptFailure)
        .mockResolvedValueOnce({ blockNumber: 100n, status: "success" });
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await act(async () => {
        await currentProtocol.execute(action, "Pause Reward Ledger");
      });

      expect(currentProtocol.transaction).toMatchObject({
        status: "outcome-unknown",
        hash: testState.hash,
      });

      await act(async () => {
        await currentProtocol.retry();
      });

      expect(testState.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        testState.transactionClient.waitForTransactionReceipt,
      ).toHaveBeenCalledTimes(2);
      expect(currentProtocol.transaction).toMatchObject({
        status: "confirmed",
        hash: testState.hash,
      });
      consoleError.mockRestore();
    },
  );

  it("retains a monotonic identity receipt floor only for the current wallet session", async () => {
    expect(currentProtocol.minimumCollectibleBlock).toBeUndefined();
    await act(async () => {
      await currentProtocol.refreshWallet(100n);
    });
    expect(currentProtocol.minimumCollectibleBlock).toBe(100n);
    expect(currentProtocol.walletSynchronizing).toBe(false);
    await act(async () => {
      await currentProtocol.refreshWallet(99n);
    });
    expect(currentProtocol.minimumCollectibleBlock).toBe(100n);
    await act(async () => {
      await currentProtocol.refreshWallet();
    });
    expect(currentProtocol.minimumCollectibleBlock).toBe(100n);

    const oldWalletRefresh = currentProtocol.refreshWallet;
    testState.connection.address = "0x0000000000000000000000000000000000000002";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    expect(currentProtocol.minimumCollectibleBlock).toBeUndefined();
    await act(async () => {
      await oldWalletRefresh(100n);
    });
    expect(currentProtocol.minimumCollectibleBlock).toBeUndefined();
    await act(async () => {
      await currentProtocol.refreshWallet(99n);
    });
    expect(currentProtocol.minimumCollectibleBlock).toBe(99n);

    testState.connection.chainId = 1;
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });
    expect(currentProtocol.minimumCollectibleBlock).toBeUndefined();
  });

  it("keeps reconciliation single-flight and the execution lock owned until refresh settles", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.waitForTransactionReceipt
      .mockRejectedValueOnce(new Error("receipt rpc timed out"))
      .mockResolvedValueOnce({ blockNumber: 100n, status: "success" });
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(currentProtocol.transaction.status).toBe("outcome-unknown");

    let finishRefresh: (result: {
      data: typeof testState.health;
    }) => void = () => undefined;
    testState.healthQuery.refetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    let reconciliation: ReturnType<ProtocolClient["retry"]> | undefined;
    await act(async () => {
      reconciliation = currentProtocol.retry();
      await vi.waitFor(() =>
        expect(testState.healthQuery.refetch).toHaveBeenCalledOnce(),
      );
    });

    expect(currentProtocol.transaction).toMatchObject({
      status: "outcome-unknown",
      reconciling: true,
    });
    expect(currentProtocol.getActionState(action)).toMatchObject({
      enabled: false,
    });
    await act(async () => {
      await Promise.all([
        currentProtocol.retry(),
        currentProtocol.execute(action, "Pause Reward Ledger"),
      ]);
    });
    expect(
      testState.transactionClient.waitForTransactionReceipt,
    ).toHaveBeenCalledTimes(2);
    expect(testState.sendTransaction).toHaveBeenCalledOnce();

    await act(async () => {
      finishRefresh({ data: testState.health });
      await reconciliation;
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("keeps an invalid receipt proxy reconcilable without releasing the submitted lock", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    const hostileReceipt = new Proxy(
      { blockNumber: 100n, status: "success" as const },
      {
        get(target, property, receiver) {
          if (property === "status") throw new Error("hostile status getter");
          return Reflect.get(target, property, receiver);
        },
      },
    );
    testState.transactionClient.waitForTransactionReceipt
      .mockRejectedValueOnce(new Error("receipt rpc timed out"))
      .mockResolvedValueOnce(hostileReceipt)
      .mockResolvedValueOnce({ blockNumber: 100n, status: "success" });
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
      await currentProtocol.retry();
    });

    expect(currentProtocol.transaction).toMatchObject({
      status: "outcome-unknown",
      hash: testState.hash,
    });
    expect(currentProtocol.transaction).not.toMatchObject({
      reconciling: true,
    });
    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(testState.sendTransaction).toHaveBeenCalledOnce();

    await act(async () => {
      await currentProtocol.retry();
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("invalidates a retryable attempt after its wallet and pathname change", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.call.mockRejectedValue(
      new Error("simulation rpc timed out"),
    );
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(currentProtocol.transaction.status).toBe("retriable");

    testState.connection.address = "0x0000000000000000000000000000000000000002";
    testState.pathname = "/trade";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });

    expect(currentProtocol.transaction.status).toBe("idle");
    await act(async () => {
      await currentProtocol.retry();
    });
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("binds a swap recipient to the currently connected wallet", async () => {
    const action = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountIn: 1n, amountOut: 2n }),
      liquidTokenForWeth: false,
      exactAmountIn: 1n,
      minimumAmountOut: 1n,
      recipient: "0x0000000000000000000000000000000000000002",
      deadline: 1_600n,
      useNative: true,
    } as const;

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.quoteExactInput).toHaveBeenCalledWith(
      false,
      1n,
      testState.address,
    );
    expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "swap-exact-input",
        recipient: testState.address,
      }),
      expect.anything(),
    );
  });

  it("uses a wallet-bound requote as the portable cap proof before allowance approval", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 10_000n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    const refreshedQuote = createSwapQuote({
      amountOut: 10_000n,
      observedBlock: 101n,
    });
    testState.reader.quoteExactInput.mockResolvedValue(refreshedQuote);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.quoteExactInput).toHaveBeenCalledWith(
      false,
      10_000n,
      testState.address,
    );
    expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "swap-exact-input",
        quote: refreshedQuote,
        minimumAmountOut: 9_750n,
        recipient: testState.address,
      }),
      expect.anything(),
    );
    expect(
      testState.reader.readExchangeAllowance.mock.invocationCallOrder[0],
    ).toBeLessThan(
      testState.reader.quoteExactInput.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      testState.reader.quoteExactInput.mock.invocationCallOrder[0],
    ).toBeLessThan(
      testState.reader.prepareTransaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      testState.reader.prepareTransaction.mock.invocationCallOrder[0],
    ).toBeLessThan(testState.sendTransaction.mock.invocationCallOrder[0] ?? 0);
  });

  it("preserves the reviewed minimum when the pre-approval output improves", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 10_000n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    testState.reader.quoteExactInput.mockResolvedValue(
      createSwapQuote({ amountOut: 10_001n, observedBlock: 101n }),
    );
    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.readExchangeAllowance).toHaveBeenCalledOnce();
    expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: expect.objectContaining({ amountOut: 10_001n }),
        minimumAmountOut: 9_750n,
      }),
      expect.anything(),
    );
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
    expect(currentProtocol.exchangeQuoteRevision).toBe(0);
    expect(currentProtocol.transaction).toMatchObject({
      status: "confirmed",
    });
  });

  it("requires a fresh review when pinned collectible holdings change without a balance change", async () => {
    const reviewedQuote = createSwapQuote({ amountOut: 10_000n });
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: reviewedQuote,
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    testState.reader.quoteExactInput.mockResolvedValue({
      ...reviewedQuote,
      observedBlock: 101n,
      expiresAtBlock: 106n,
      discovery: {
        ...reviewedQuote.discovery,
        accountHoldings: {
          pendingDiscoveryCount: 1,
          transientCollectibleCount: 0,
        },
      },
    });
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Review"),
    });
    consoleError.mockRestore();
  });

  it("revalidates and reprepares the reviewed swap after approval confirms", async () => {
    const reviewedQuote = createSwapQuote({ amountOut: 10_000n });
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: reviewedQuote,
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_751n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    const preApprovalQuote = createSwapQuote({
      amountOut: 10_000n,
      observedBlock: 101n,
    });
    const postApprovalQuote = createSwapQuote({
      amountOut: 10_001n,
      observedBlock: 102n,
    });
    testState.reader.quoteExactInput
      .mockResolvedValueOnce(preApprovalQuote)
      .mockResolvedValueOnce(postApprovalQuote);
    testState.transactionClient.getBlock
      .mockResolvedValueOnce({ hash: "0x01", number: 101n, timestamp: 1_001n })
      .mockResolvedValueOnce({ hash: "0x02", number: 102n, timestamp: 1_002n });
    testState.transactionClient.waitForTransactionReceipt
      .mockResolvedValueOnce({ blockNumber: 101n, status: "success" })
      .mockResolvedValueOnce({ blockNumber: 102n, status: "success" });
    testState.walletQuery.refetch.mockResolvedValue({
      data: { ...testState.wallet, observedBlock: 102n },
    });

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.quoteExactInput).toHaveBeenCalledTimes(2);
    expect(testState.reader.prepareTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quote: postApprovalQuote,
        minimumAmountOut: 9_751n,
        deadline: 1_600n,
      }),
      expect.anything(),
    );
    expect(
      testState.transactionClient.waitForTransactionReceipt.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      testState.reader.quoteExactInput.mock.invocationCallOrder[1] ?? 0,
    );
    expect(
      testState.reader.quoteExactInput.mock.invocationCallOrder[1],
    ).toBeLessThan(
      testState.transactionClient.call.mock.invocationCallOrder[1] ?? 0,
    );
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
    expect(currentProtocol.transaction.status).toBe("confirmed");
  });

  it("explains wallet submission failures without replaying the wallet request", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    testState.sendTransaction.mockRejectedValueOnce(transientRpcFailure());
    await act(async () => {
      await currentProtocol.execute(
        { type: "set-pause", module: "rewards", paused: true },
        "Pause Reward Ledger",
      );
    });
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    expect(
      testState.transactionClient.waitForTransactionReceipt,
    ).not.toHaveBeenCalled();
    expect(currentProtocol.transaction).toMatchObject({
      status: "submission-unknown",
      message: expect.stringContaining(
        "app did not receive a transaction hash",
      ),
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("reports a cancelled wallet approval as unsubmitted and lets the user retry", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 10_000n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    testState.reader.quoteExactInput.mockResolvedValue(
      createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
    );
    testState.sendTransaction.mockRejectedValueOnce(
      new TransactionExecutionError(
        new UserRejectedRequestError(new Error("provider secret")),
        { account: null },
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });
    expect(currentProtocol.transaction).toMatchObject({
      status: "retriable",
      label: "Approve WETH for exchange",
    });
    expect(
      testState.transactionClient.waitForTransactionReceipt,
    ).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(
      <TransactionStatus
        state={currentProtocol.transaction}
        onRetry={() => void currentProtocol.retry()}
      />,
    );
    expect(html).toContain(
      "The wallet cancelled this request. No transaction was submitted.",
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("provider secret");
    expect(html).not.toContain("protocol read could not be completed");

    await act(async () => {
      await currentProtocol.retry();
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).toHaveBeenCalledTimes(3);
    expect(
      testState.transactionClient.waitForTransactionReceipt,
    ).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "reconciles unknown approval with reload=%s and waits for explicit swap authorization",
    async (reload) => {
      testState.pathname = "/exchange";
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      const action: SwapAction = {
        type: "swap-exact-input",
        quote: createSwapQuote({ amountOut: 10_000n }),
        liquidTokenForWeth: false,
        exactAmountIn: 10_000n,
        minimumAmountOut: 9_750n,
        recipient: testState.address as `0x${string}`,
        deadline: 1_600n,
        useNative: false,
      };
      testState.reader.quoteExactInput.mockResolvedValue(
        createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
      );
      testState.reader.readExchangeAllowance.mockResolvedValueOnce({
        amount: 0n,
      });
      testState.transactionClient.waitForTransactionReceipt
        .mockRejectedValueOnce(new Error("approval receipt rpc timed out"))
        .mockResolvedValueOnce({ blockNumber: 100n, status: "success" })
        .mockResolvedValueOnce({ blockNumber: 101n, status: "success" });
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });

      expect(currentProtocol.transaction).toMatchObject({
        status: "outcome-unknown",
        label: "Approve WETH for exchange",
        hash: testState.hash,
      });
      expect(testState.sendTransaction).toHaveBeenCalledOnce();

      if (reload) {
        vi.useFakeTimers();
        await act(async () => root.unmount());
        root = createRoot(container);
        testState.pathname = "/fleet";
        await act(async () =>
          root.render(
            <ProtocolClientProvider>
              <ProtocolCapture />
            </ProtocolClientProvider>,
          ),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      } else {
        await act(async () => {
          await currentProtocol.retry();
        });
      }

      expect(testState.reader.readExchangeAllowance).toHaveBeenCalledOnce();
      expect(testState.sendTransaction).toHaveBeenCalledOnce();
      expect(
        testState.transactionClient.waitForTransactionReceipt,
      ).toHaveBeenCalledTimes(2);
      expect(currentProtocol.transaction).toMatchObject({
        status: "confirmed",
        label: "Approve WETH for exchange",
        message: expect.stringContaining("no exchange was submitted"),
      });
      expect(currentProtocol.exchangeQuoteRevision).toBe(1);
      vi.useRealTimers();

      testState.reader.readExchangeAllowance.mockResolvedValue({
        amount: action.exactAmountIn,
      });
      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });

      expect(testState.reader.readExchangeAllowance).toHaveBeenCalledTimes(2);
      expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
      expect(
        testState.transactionClient.waitForTransactionReceipt,
      ).toHaveBeenCalledTimes(3);
      expect(currentProtocol.transaction).toMatchObject({
        status: "confirmed",
        label: "Buy $FUEL",
      });
      consoleError.mockRestore();
    },
  );

  it.each(["route", "account", "chain"] as const)(
    "settles a submitted approval on an old %s scope without leaving controls locked",
    async (scopeChange) => {
      const action: SwapAction = {
        type: "swap-exact-input",
        quote: createSwapQuote({ amountOut: 10_000n }),
        liquidTokenForWeth: false,
        exactAmountIn: 10_000n,
        minimumAmountOut: 9_750n,
        recipient: testState.address as `0x${string}`,
        deadline: 1_600n,
        useNative: false,
      };
      testState.reader.quoteExactInput.mockResolvedValue(
        createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
      );
      let confirmApproval: (receipt: {
        readonly blockNumber: bigint;
        readonly status: "success";
      }) => void = () => undefined;
      testState.transactionClient.waitForTransactionReceipt.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirmApproval = resolve;
          }),
      );
      let execution: ReturnType<ProtocolClient["execute"]> | undefined;

      await act(async () => {
        execution = currentProtocol.execute(action, "Buy $FUEL");
        await vi.waitFor(() =>
          expect(
            testState.transactionClient.waitForTransactionReceipt,
          ).toHaveBeenCalledOnce(),
        );
      });
      expect(currentProtocol.transaction.status).toBe("submitted");

      if (scopeChange === "route") testState.pathname = "/trade";
      if (scopeChange === "account") {
        testState.connection.address =
          "0x0000000000000000000000000000000000000002";
      }
      if (scopeChange === "chain") testState.connection.chainId = 1;
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });

      await act(async () => {
        confirmApproval({ blockNumber: 100n, status: "success" });
        await execution;
      });

      expect(currentProtocol.transaction.status).toBe("idle");
      expect(testState.sendTransaction).toHaveBeenCalledOnce();

      testState.pathname = "/admin/operations";
      testState.queryClient.invalidateQueries.mockClear();
      testState.connection.address = testState.address;
      testState.connection.chainId = 84_532;
      testState.reader.readExchangeAllowance.mockResolvedValue({
        amount: action.exactAmountIn,
      });
      await act(async () => {
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        );
      });
      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });

      expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
      expect(currentProtocol.transaction.status).toBe("confirmed");
    },
  );

  it.each([
    [
      "discovery evidence",
      () => {
        const quote = createSwapQuote({
          amountOut: 10_000n,
          observedBlock: 102n,
        });
        return {
          ...quote,
          discovery: {
            ...quote.discovery,
            recipient: {
              ...quote.discovery.recipient,
              balance: quote.discovery.recipient.balance + 1n,
            },
          },
        };
      },
    ],
    [
      "collectible holdings",
      () => {
        const quote = createSwapQuote({
          amountOut: 10_000n,
          observedBlock: 102n,
        });
        return {
          ...quote,
          discovery: {
            ...quote.discovery,
            accountHoldings: {
              pendingDiscoveryCount: 1,
              transientCollectibleCount: 0,
            },
          },
        };
      },
    ],
  ] as const)(
    "does not submit the swap when post-approval %s changes",
    async (_case, createChangedQuote) => {
      const reviewedQuote = createSwapQuote({ amountOut: 10_000n });
      const action: SwapAction = {
        type: "swap-exact-input",
        quote: reviewedQuote,
        liquidTokenForWeth: false,
        exactAmountIn: 10_000n,
        minimumAmountOut: 9_750n,
        recipient: testState.address as `0x${string}`,
        deadline: 1_600n,
        useNative: false,
      };
      testState.reader.quoteExactInput
        .mockResolvedValueOnce(
          createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
        )
        .mockResolvedValueOnce(createChangedQuote());
      testState.transactionClient.getBlock
        .mockResolvedValueOnce({
          hash: "0x01",
          number: 101n,
          timestamp: 1_001n,
        })
        .mockResolvedValueOnce({
          hash: "0x02",
          number: 102n,
          timestamp: 1_002n,
        });
      testState.transactionClient.waitForTransactionReceipt.mockResolvedValue({
        blockNumber: 101n,
        status: "success",
      });
      testState.walletQuery.refetch.mockResolvedValue({
        data: { ...testState.wallet, observedBlock: 102n },
      });
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });

      expect(testState.reader.quoteExactInput).toHaveBeenCalledTimes(2);
      expect(testState.sendTransaction).toHaveBeenCalledOnce();
      expect(testState.transactionClient.call).toHaveBeenCalledOnce();
      expect(currentProtocol.transaction).toMatchObject({
        status: "failed",
        message: expect.stringContaining("Review"),
      });
      consoleError.mockRestore();
    },
  );

  it("preserves a non-divisible reviewed minimum across submit-time refresh", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 101n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 99n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: true,
    };
    const refreshedQuote = createSwapQuote({
      amountOut: 101n,
      observedBlock: 101n,
    });
    testState.reader.quoteExactInput.mockResolvedValue(refreshedQuote);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: refreshedQuote,
        minimumAmountOut: 99n,
      }),
      expect.anything(),
    );
  });

  it.each([
    [
      "over-limit",
      createSwapQuote({
        amountOut: 65n * liquidTokenUnit,
        executable: false,
        observedBlock: 101n,
      }),
      "discovery-mutation-limit",
    ],
    [
      "wallet-mismatched",
      createSwapQuote({
        account: "0x0000000000000000000000000000000000000002",
        observedBlock: 101n,
      }),
      "discovery-evidence-invalid",
    ],
  ] as const)(
    "stops %s refreshed discovery evidence before allowance or submission",
    async (_case, refreshedQuote, failureCode) => {
      const action: SwapAction = {
        type: "swap-exact-input",
        quote: createSwapQuote({ amountOut: 10_000n }),
        liquidTokenForWeth: false,
        exactAmountIn: 10_000n,
        minimumAmountOut: 9_750n,
        recipient: testState.address as `0x${string}`,
        deadline: 1_600n,
        useNative: false,
      };
      testState.reader.quoteExactInput.mockResolvedValue(refreshedQuote);
      testState.reader.prepareTransaction.mockImplementation(
        prepareWithActualSwapSemantics,
      );
      const consoleError = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      await act(async () => {
        await currentProtocol.execute(action, "Buy $FUEL");
      });

      expect(testState.reader.quoteExactInput).toHaveBeenCalledWith(
        false,
        10_000n,
        testState.address,
      );
      expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ quote: refreshedQuote }),
        expect.anything(),
      );
      expect(testState.reader.prepareTransaction).toHaveBeenCalledOnce();
      expect(testState.reader.readExchangeAllowance).toHaveBeenCalledOnce();
      expect(testState.sendTransaction).not.toHaveBeenCalled();
      expect(currentProtocol.transaction.status).toBe("failed");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`(${failureCode})`),
      );
      consoleError.mockRestore();
    },
  );

  it("rejects an adverse submit-time quote without lowering the reviewed minimum output", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 10_000n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: false,
    };
    const adverseQuote = createSwapQuote({
      amountOut: 9_000n,
      observedBlock: 101n,
    });
    testState.reader.quoteExactInput.mockResolvedValue(adverseQuote);
    testState.reader.prepareTransaction.mockImplementation(
      prepareWithActualSwapSemantics,
    );
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });

    expect(testState.reader.prepareTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: adverseQuote,
        minimumAmountOut: 9_750n,
      }),
      expect.anything(),
    );
    expect(testState.reader.readExchangeAllowance).toHaveBeenCalledOnce();
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("retriable");
    consoleError.mockRestore();
  });

  it("keeps transaction-preparation failure labels for non-swap actions", async () => {
    testState.reader.prepareTransaction.mockImplementationOnce(() => {
      throw new Error("preparation failed");
    });
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(
        { type: "set-pause", module: "rewards", paused: true },
        "Pause Reward Ledger",
      );
    });

    expect(testState.reader.quoteExactInput).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("during transaction preparation"),
    );
    consoleError.mockRestore();
  });

  it("surfaces a drifted discovery-limit simulation as actionable UI state", async () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    testState.transactionClient.call.mockRejectedValueOnce(
      new CallExecutionError(
        new RawContractError({
          data: encoded,
          message: "provider request secret should stay hidden",
        }),
        {
          data: "0x",
          to: testState.address as `0x${string}`,
        },
      ),
    );
    testState.reader.quoteExactInput.mockResolvedValue(
      createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
    );
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(
        {
          type: "swap-exact-input",
          quote: createSwapQuote({ amountOut: 10_000n }),
          liquidTokenForWeth: false,
          exactAmountIn: 10_000n,
          minimumAmountOut: 9_750n,
          recipient: testState.address as `0x${string}`,
          deadline: 1_600n,
          useNative: true,
        },
        "Buy $FUEL",
      );
    });

    expect(currentProtocol.transaction).toMatchObject({
      status: "failed",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    });
    expect(JSON.stringify(currentProtocol.transaction)).not.toContain(
      "provider request secret",
    );
    expect(testState.sendTransaction).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refreshes a retried swap without weakening its reviewed minimum output", async () => {
    const action: SwapAction = {
      type: "swap-exact-input",
      quote: createSwapQuote({ amountOut: 10_000n }),
      liquidTokenForWeth: false,
      exactAmountIn: 10_000n,
      minimumAmountOut: 9_750n,
      recipient: testState.address as `0x${string}`,
      deadline: 1_600n,
      useNative: true,
    };
    testState.reader.quoteExactInput.mockResolvedValueOnce(
      createSwapQuote({ amountOut: 10_000n, observedBlock: 101n }),
    );
    testState.transactionClient.call.mockRejectedValueOnce(
      new Error("stale simulation rpc"),
    );
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Buy $FUEL");
    });
    expect(currentProtocol.transaction.status).toBe("retriable");

    testState.reader.quoteExactInput.mockClear();
    const retryQuote = createSwapQuote({
      amountOut: 10_000n,
      observedBlock: 102n,
    });
    testState.reader.quoteExactInput.mockResolvedValueOnce(retryQuote);
    await act(async () => {
      await currentProtocol.retry();
    });

    expect(testState.reader.quoteExactInput).toHaveBeenCalledWith(
      false,
      10_000n,
      testState.address,
    );
    expect(testState.reader.prepareTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "swap-exact-input",
        quote: retryQuote,
        minimumAmountOut: 9_750n,
        recipient: testState.address,
      }),
      expect.anything(),
    );
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    expect(currentProtocol.transaction.status).toBe("confirmed");
    consoleError.mockRestore();
  });

  it("stops an awaiting preflight when the wallet scope changes", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    let finishPreflight: (health: typeof testState.health) => void = () =>
      undefined;
    testState.reader.readHealth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreflight = resolve;
        }),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;

    await act(async () => {
      execution = currentProtocol.execute(action, "Pause Reward Ledger");
      await vi.waitFor(() =>
        expect(testState.reader.readHealth).toHaveBeenCalledOnce(),
      );
    });

    testState.connection.address = "0x0000000000000000000000000000000000000002";
    testState.pathname = "/trade";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });

    await act(async () => {
      finishPreflight(testState.health);
      await execution;
    });

    expect(testState.sendTransaction).not.toHaveBeenCalled();
    expect(currentProtocol.transaction.status).toBe("idle");
  });

  it("hides a previous wallet transaction and allows a separately authorized action in the new wallet", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    testState.transactionClient.waitForTransactionReceipt
      .mockRejectedValueOnce(new Error("receipt rpc timed out"))
      .mockResolvedValueOnce({ blockNumber: 100n, status: "success" });
    const consoleError = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(currentProtocol.transaction.status).toBe("outcome-unknown");

    testState.connection.address = "0x0000000000000000000000000000000000000002";
    testState.pathname = "/trade";
    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });

    expect(currentProtocol.transaction.status).toBe("idle");
    await act(async () => {
      await currentProtocol.retry();
    });
    expect(currentProtocol.transaction.status).toBe("idle");
    expect(
      testState.transactionClient.waitForTransactionReceipt,
    ).toHaveBeenCalledTimes(1);
    expect(testState.sendTransaction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("allows a new session execution before a pre-logout receipt settles", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;
    let finishReceipt: (receipt: {
      readonly blockNumber: bigint;
      readonly status: "success";
    }) => void = () => undefined;
    testState.transactionClient.waitForTransactionReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReceipt = resolve;
        }),
    );
    let execution: ReturnType<ProtocolClient["execute"]> | undefined;

    await act(async () => {
      execution = currentProtocol.execute(action, "Pause Reward Ledger");
      await vi.waitFor(() =>
        expect(
          testState.transactionClient.waitForTransactionReceipt,
        ).toHaveBeenCalledOnce(),
      );
    });
    expect(currentProtocol.transaction.status).toBe("submitted");

    await act(async () => {
      window.dispatchEvent(new Event("orbit:admin-session-ended"));
    });
    expect(currentProtocol.transaction.status).toBe("idle");

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
    expect(currentProtocol.transaction.status).toBe("confirmed");

    await act(async () => {
      finishReceipt({ blockNumber: 102n, status: "success" });
      await execution;
    });

    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).toHaveBeenCalledTimes(2);
  });

  it("fails action preparation closed when a current health read failed", async () => {
    testState.healthQuery.error = new Error("current health read failed");

    await act(async () => {
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      );
    });

    expect(currentProtocol.health).toBeUndefined();
    expect(
      currentProtocol.getActionState({
        type: "set-pause",
        module: "rewards",
        paused: true,
      }),
    ).toMatchObject({ enabled: false });
    expect(testState.reader.prepareTransaction).not.toHaveBeenCalled();
  });

  it("does not replay a confirmed transaction through retry", async () => {
    const action = {
      type: "set-pause",
      module: "rewards",
      paused: true,
    } as const;

    await act(async () => {
      await currentProtocol.execute(action, "Pause Reward Ledger");
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");

    await act(async () => {
      await currentProtocol.retry();
    });

    expect(testState.sendTransaction).toHaveBeenCalledTimes(1);
    expect(currentProtocol.transaction.status).toBe("confirmed");
  });
  it("offers recovery for a stalled wallet response without sending the action twice", async () => {
    vi.useFakeTimers();
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    let complete!: (hash: `0x${string}`) => void;
    testState.sendTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    let execution!: ReturnType<ProtocolClient["execute"]>;
    await act(async () => {
      execution = currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(currentProtocol.transaction.status).toBe("simulated");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    expect(
      currentProtocol.getActionState({
        type: "commit-collectible",
        identityId: 1639,
      }).enabled,
    ).toBe(false);
    await act(async () => {
      complete(testState.hash as `0x${string}`);
      await execution;
    });
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
  });

  it("follows another tab's confirmed receipt without another signature and ignores unrelated scopes", async () => {
    testState.pathname = "/fleet";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    const scope = `${deploymentManifestFingerprint(protocolDeploymentManifest!)}:84532:${testState.address}`;
    const metadata = {
      operationId: "other-tab-launch",
      actionType: "commit-collectible",
      identityIds: [1639],
      affectedIdentityIds: [1639],
      createdAt: Date.now(),
    };
    const key = collectorTransactionStorageKey(scope);
    writeCollectorTransaction(
      scope,
      { status: "simulated", label: "Launch #1639" },
      { kind: "action" },
      metadata,
      true,
    );
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: `${key}:other-wallet`,
          storageArea: localStorage,
        }),
      ),
    );
    expect(currentProtocol.transaction.status).toBe("idle");
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", { key, storageArea: localStorage }),
      ),
    );
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    expect(
      currentProtocol.getActionState({
        type: "commit-collectible",
        identityId: 1639,
      }).enabled,
    ).toBe(false);
    writeCollectorTransaction(
      scope,
      {
        status: "confirmed",
        label: "Launch #1639",
        hash: testState.hash as `0x${string}`,
      },
      { kind: "action" },
      metadata,
    );
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", { key, storageArea: localStorage }),
      ),
    );
    expect(currentProtocol.transaction.status).toBe("confirmed");
    expect(testState.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps uncertain wallet submission locked through navigation and reload", async () => {
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    testState.sendTransaction.mockRejectedValueOnce(transientRpcFailure());
    await act(async () => {
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
    });
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    await act(async () => {
      await currentProtocol.retry();
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
    });
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(container);
    testState.pathname = "/fleet";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    expect(
      currentProtocol.getActionState({
        type: "commit-collectible",
        identityId: 1639,
      }).enabled,
    ).toBe(false);
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
  });

  it("retains submission uncertainty when navigation happens before the wallet RPC fails", async () => {
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    let rejectSubmission!: (cause: unknown) => void;
    testState.sendTransaction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSubmission = reject;
        }),
    );
    let execution!: ReturnType<ProtocolClient["execute"]>;
    await act(async () => {
      execution = currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
      await vi.waitFor(() =>
        expect(testState.sendTransaction).toHaveBeenCalledOnce(),
      );
    });
    testState.pathname = "/fleet";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    await act(async () => {
      rejectSubmission(transientRpcFailure());
      await execution;
    });
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    await act(async () => {
      await currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
    });
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
  });

  it("stores late submission uncertainty only for the submitting wallet", async () => {
    testState.pathname = "/fleet/1639";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    let rejectSubmission!: (cause: unknown) => void;
    testState.sendTransaction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSubmission = reject;
        }),
    );
    let execution!: ReturnType<ProtocolClient["execute"]>;
    await act(async () => {
      execution = currentProtocol.execute(
        { type: "commit-collectible", identityId: 1639 },
        "Launch #1639",
      );
      await vi.waitFor(() =>
        expect(testState.sendTransaction).toHaveBeenCalledOnce(),
      );
    });
    testState.connection.address = "0x0000000000000000000000000000000000000002";
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    await act(async () => {
      rejectSubmission(transientRpcFailure());
      await execution;
    });
    expect(currentProtocol.transaction.status).toBe("idle");
    testState.connection.address = testState.address;
    await act(async () =>
      root.render(
        <ProtocolClientProvider>
          <ProtocolCapture />
        </ProtocolClientProvider>,
      ),
    );
    expect(currentProtocol.transaction.status).toBe("submission-unknown");
    expect(testState.sendTransaction).toHaveBeenCalledOnce();
  });

  it.each(["repriced", "cancelled", "replaced"] as const)(
    "persists a %s replacement before its receipt and restores the correct outcome",
    async (reason) => {
      testState.pathname = "/fleet/1639";
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      const replacementHash = `0x${"ab".repeat(32)}` as `0x${string}`;
      type Replacement = {
        transaction: { hash: `0x${string}` };
        reason: "repriced" | "cancelled" | "replaced";
      };
      let replaced!: (event: Replacement) => void;
      let finishOriginal!: (receipt: {
        blockNumber: bigint;
        status: "success";
      }) => void;
      testState.transactionClient.waitForTransactionReceipt.mockImplementationOnce(
        (...args: unknown[]) => {
          replaced = (args[0] as { onReplaced: (event: Replacement) => void })
            .onReplaced;
          return new Promise((resolve) => {
            finishOriginal = resolve;
          });
        },
      );
      let execution!: ReturnType<ProtocolClient["execute"]>;
      await act(async () => {
        execution = currentProtocol.execute(
          { type: "commit-collectible", identityId: 1639 },
          "Launch #1639",
        );
        await vi.waitFor(() =>
          expect(
            testState.transactionClient.waitForTransactionReceipt,
          ).toHaveBeenCalledOnce(),
        );
      });
      await act(async () => {
        replaced({ transaction: { hash: replacementHash }, reason });
      });
      expect(currentProtocol.transaction).toMatchObject({
        status: "submitted",
        hash: replacementHash,
      });
      vi.useFakeTimers();
      await act(async () => root.unmount());
      root = createRoot(container);
      testState.pathname = "/fleet";
      await act(async () =>
        root.render(
          <ProtocolClientProvider>
            <ProtocolCapture />
          </ProtocolClientProvider>,
        ),
      );
      // A fresh provider sees the replacement before any receipt has resolved.
      expect(currentProtocol.transaction).toMatchObject({
        status: "outcome-unknown",
        hash: replacementHash,
      });
      expect(testState.sendTransaction).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        testState.transactionClient.waitForTransactionReceipt,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({ hash: replacementHash }),
      );
      expect(currentProtocol.transaction).toMatchObject({
        status: reason === "repriced" ? "confirmed" : "failed",
        hash: replacementHash,
      });
      if (reason !== "repriced")
        expect(currentProtocol.transaction).toMatchObject({
          message: expect.stringContaining("original action did not complete"),
        });
      await act(async () => {
        finishOriginal({ blockNumber: 102n, status: "success" });
        await execution;
      });
      expect(currentProtocol.transaction.status).toBe(
        reason === "repriced" ? "confirmed" : "failed",
      );
      expect(testState.sendTransaction).toHaveBeenCalledOnce();
    },
  );
});
