import { describe, expect, it } from "vitest";

import { isTransientPreSubmissionRpcFailure } from "./pre-submission-rpc";

describe("pre-submission RPC failure classification", () => {
  it("recognizes a numeric rate-limit response as transient", () => {
    expect(
      isTransientPreSubmissionRpcFailure({
        code: 429,
        message: "request rejected",
        name: "RpcRequestError",
      }),
    ).toBe(true);
  });

  it("recognizes a flattened rate-limit message without a retained code", () => {
    expect(
      isTransientPreSubmissionRpcFailure({
        message: "RPC Request failed. Details: over rate limit",
        name: "RpcRequestError",
      }),
    ).toBe(true);
  });

  it("does not let a transient-looking message override invalid params", () => {
    expect(
      isTransientPreSubmissionRpcFailure({
        code: -32_602,
        message: "upstream timed out while validating parameters",
        name: "RpcRequestError",
      }),
    ).toBe(false);
  });

  it("does not let a nested transport error override a contract revert", () => {
    expect(
      isTransientPreSubmissionRpcFailure({
        cause: {
          code: 429,
          message: "too many requests",
          name: "RpcRequestError",
        },
        name: "ContractFunctionRevertedError",
      }),
    ).toBe(false);
  });
});
