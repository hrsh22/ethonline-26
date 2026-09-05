import { describe, expect, it } from "vitest";
import {
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeErrorResult,
  parseAbi,
  RawContractError,
  TransactionExecutionError,
  UserRejectedRequestError,
  toFunctionSelector,
  type Hex,
} from "viem";

import { selectIdentityConfiguration } from "@orbit/config/identity";

import { protocolAbis } from "../src/contracts.js";
import { normalizeProtocolError } from "../src/errors.js";

const identity = selectIdentityConfiguration("orbit-4444");
const functionOnlyAbi = parseAbi(["function swap(bytes data)"]);
const nestCause = (cause: unknown, depth: number): unknown => {
  let nested = cause;
  for (let index = 0; index < depth; index += 1) nested = { cause: nested };
  return nested;
};

describe("protocol error normalization", () => {
  it.each([
    { code: 4001, message: "provider secret" },
    new UserRejectedRequestError(new Error("provider secret")),
    new TransactionExecutionError(
      new UserRejectedRequestError(new Error("provider secret")),
      { account: null },
    ),
  ])(
    "recognizes a wallet cancellation without exposing its raw message %#",
    (cause) => {
      expect(normalizeProtocolError(cause, identity)).toEqual({
        code: "wallet-rejected",
        message:
          "The wallet cancelled this request. No transaction was submitted. You can try again.",
      });
    },
  );

  it.each([
    ["TradingLocked", "Trading is not available before ORBIT 4444 launches."],
    [
      "NotIdentityOwner",
      "The connected wallet does not own this ORBIT 4444 Collectibles.",
    ],
    [
      "ClaimDenied",
      "This deployment's legacy claim policy blocked the transaction. The Stock Reward units remain attached to the identity and are not lost.",
    ],
    ["ClaimBatchTooLarge", "This claim contains too many identities."],
    ["RewardNotificationsArePaused", "New Stock Reward accounting is paused."],
    [
      "UnauthorizedKeeper",
      "The connected wallet is not the configured Keeper.",
    ],
    [
      "UnauthorizedExecutor",
      "The connected wallet is not the configured Protocol-Owned Liquidity executor.",
    ],
    [
      "ConfigurationAlreadySealed",
      "This protocol configuration is permanently sealed.",
    ],
    [
      "EmptyTrackQueue",
      "This Reward Track has no Deferred Track Budget to execute.",
    ],
  ])("maps %s to concise domain copy", (signature, expected) => {
    expect(
      normalizeProtocolError(
        { shortMessage: `reverted with ${signature}()` },
        identity,
      ),
    ).toMatchObject({ message: expected });
  });

  it("recognizes typed viem errors nested under their cause", () => {
    expect(
      normalizeProtocolError(
        {
          cause: { errorName: "RewardEpochIntervalPending" },
        },
        identity,
      ),
    ).toEqual({
      code: "epoch-interval-pending",
      message: "The next Reward Epoch interval has not elapsed.",
    });
  });

  it("preserves a canonical domain error carried by a ProtocolQueryError-shaped failure", () => {
    const domainError = {
      code: "epoch-interval-pending",
      message: "The next Reward Epoch interval has not elapsed.",
    };

    expect(
      normalizeProtocolError(
        {
          name: "ProtocolQueryError",
          operation: "Reward Epoch state",
          message: domainError.message,
          domainError,
        },
        identity,
      ),
    ).toEqual(domainError);
  });

  it("preserves a validated discovery-limit domain error across a ProtocolQueryError boundary", () => {
    const domainError = {
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    };

    expect(
      normalizeProtocolError(
        {
          name: "ProtocolQueryError",
          operation: "Canonical Market quote",
          message: domainError.message,
          domainError,
        },
        identity,
      ),
    ).toEqual(domainError);
  });

  it("preserves a validated wrong-chain domain error across a ProtocolQueryError boundary", () => {
    const domainError = {
      code: "wrong-chain",
      message: "Expected chain 84532, received 1.",
    };

    expect(
      normalizeProtocolError(
        {
          name: "ProtocolQueryError",
          operation: "Network",
          message: domainError.message,
          domainError,
        },
        identity,
      ),
    ).toEqual(domainError);
  });

  it.each([
    {
      code: "provider-secret",
      message: "The next Reward Epoch interval has not elapsed.",
    },
    {
      code: "epoch-interval-pending",
      message: "provider request id: secret-123",
    },
    {
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 64 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    },
    {
      code: "wrong-chain",
      message: "Expected chain 84532, received 84532.",
    },
  ])(
    "rejects an untrusted ProtocolQueryError domain payload %#",
    (domainError) => {
      expect(
        normalizeProtocolError(
          {
            name: "ProtocolQueryError",
            operation: "Injected operation",
            message: domainError.message,
            domainError,
          },
          identity,
        ),
      ).toEqual({
        code: "rpc-failure",
        message: "The latest protocol read could not be completed.",
      });
    },
  );

  it("recognizes decoded custom errors nested in Viem error data", () => {
    expect(
      normalizeProtocolError(
        {
          cause: {
            data: {
              errorName: "UnauthorizedKeeper",
              args: ["0x0000000000000000000000000000000000000001"],
            },
          },
        },
        identity,
      ),
    ).toEqual({
      code: "unsupported-role",
      message: "The connected wallet is not the configured Keeper.",
    });
  });

  it("does not trust decoded-lookalike data without authentic revert bytes", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const decoded = decodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      data: encoded,
    });

    expect(
      normalizeProtocolError(
        {
          shortMessage: "execution reverted (provider request id: secret-123)",
          cause: { data: decoded },
        },
        identity,
      ),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("normalizes raw discovery-limit bytes from a real Viem call error", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const callError = new CallExecutionError(
      new RawContractError({ data: encoded }),
      {
        data: "0x",
        to: "0x0000000000000000000000000000000000000001",
      },
    );

    expect(normalizeProtocolError(callError, identity)).toEqual({
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    });
  });

  it("normalizes raw discovery bytes preserved by a Viem contract error", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const reverted = new ContractFunctionRevertedError({
      abi: functionOnlyAbi,
      data: encoded,
      functionName: "swap",
    });
    expect(reverted.data).toBeUndefined();
    expect(reverted.raw).toBe(encoded);
    const execution = new ContractFunctionExecutionError(reverted, {
      abi: functionOnlyAbi,
      args: ["0x"],
      functionName: "swap",
    });

    expect(normalizeProtocolError(execution, identity)).toEqual({
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    });
  });

  it("does not trust a bare discovery-limit error name", () => {
    expect(
      normalizeProtocolError(
        {
          cause: {
            data: { errorName: "DiscoveryMutationLimitExceeded" },
          },
        },
        identity,
      ),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("does not trust a decoded WrappedError without authentic revert bytes", () => {
    const nestedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const wrappedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "WrappedError",
      args: [
        "0x000000000000000000000000000000000000f001",
        toFunctionSelector("transfer(address,uint256)"),
        nestedReason,
        toFunctionSelector("ERC20TransferFailed()"),
      ],
    });
    const decoded = decodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      data: wrappedReason,
    });

    expect(
      normalizeProtocolError(
        {
          cause: {
            data: decoded,
          },
        },
        identity,
      ),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("unwraps raw Uniswap v4 WrappedError bytes from a real Viem call error", () => {
    const nestedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const wrappedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "WrappedError",
      args: [
        "0x000000000000000000000000000000000000f001",
        toFunctionSelector("transfer(address,uint256)"),
        nestedReason,
        toFunctionSelector("ERC20TransferFailed()"),
      ],
    });
    const callError = new CallExecutionError(
      new RawContractError({ data: { data: wrappedReason } }),
      {
        data: "0x",
        to: "0x0000000000000000000000000000000000000001",
      },
    );

    expect(normalizeProtocolError(callError, identity)).toEqual({
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    });
  });

  it("unwraps raw WrappedError bytes preserved by a Viem contract error", () => {
    const nestedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const wrappedReason = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "WrappedError",
      args: [
        "0x000000000000000000000000000000000000f001",
        toFunctionSelector("transfer(address,uint256)"),
        nestedReason,
        toFunctionSelector("ERC20TransferFailed()"),
      ],
    });
    const reverted = new ContractFunctionRevertedError({
      abi: functionOnlyAbi,
      data: wrappedReason,
      functionName: "swap",
    });
    const execution = new ContractFunctionExecutionError(reverted, {
      abi: functionOnlyAbi,
      args: ["0x"],
      functionName: "swap",
    });

    expect(normalizeProtocolError(execution, identity)).toEqual({
      code: "discovery-mutation-limit",
      message:
        "This trade crosses 65 whole-unit discovery boundaries, but one transfer can cross at most 64. Reduce the $FUEL amount and request a new quote.",
    });
  });

  it("rejects target revert bytes with trailing junk", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    const withTrailingJunk = `${encoded}00` as Hex;

    expect(
      normalizeProtocolError(
        { cause: new RawContractError({ data: withTrailingJunk }) },
        identity,
      ),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("rejects semantically impossible discovery-limit bytes", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [64n, 64n],
    });

    expect(
      normalizeProtocolError(
        { cause: new RawContractError({ data: encoded }) },
        identity,
      ),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("bounds raw revert data and nested cause traversal", () => {
    const encoded = encodeErrorResult({
      abi: protocolAbis.canonicalRouter,
      errorName: "DiscoveryMutationLimitExceeded",
      args: [65n, 64n],
    });
    expect(
      normalizeProtocolError(nestCause({ data: encoded }, 8), identity).code,
    ).toBe("discovery-mutation-limit");
    expect(
      normalizeProtocolError(nestCause({ data: encoded }, 9), identity).code,
    ).toBe("rpc-failure");
    expect(
      normalizeProtocolError(nestCause({ code: 4001 }, 8), identity).code,
    ).toBe("wallet-rejected");
    expect(
      normalizeProtocolError(nestCause({ code: 4001 }, 9), identity).code,
    ).toBe("rpc-failure");
    expect(
      normalizeProtocolError(
        { data: `0x${"00".repeat(4_097)}` as Hex },
        identity,
      ).code,
    ).toBe("rpc-failure");
  });

  it("terminates on cyclic provider cause chains", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    expect(normalizeProtocolError(cyclic, identity)).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("sanitizes a provider proxy whose properties throw", () => {
    const providerFailure = new Proxy(
      {},
      {
        get: () => {
          throw new Error("provider request id: secret-123");
        },
      },
    );

    expect(normalizeProtocolError(providerFailure, identity)).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("sanitizes a throwing getter on a ProtocolQueryError-shaped failure", () => {
    const providerFailure = {
      name: "ProtocolQueryError",
      operation: "Canonical Market quote",
      get domainError(): never {
        throw new Error("provider request id: secret-456");
      },
    };

    expect(normalizeProtocolError(providerFailure, identity)).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });

  it("does not expose provider internals for unknown failures", () => {
    expect(
      normalizeProtocolError(new Error("socket details and headers"), identity),
    ).toEqual({
      code: "rpc-failure",
      message: "The latest protocol read could not be completed.",
    });
  });
});
