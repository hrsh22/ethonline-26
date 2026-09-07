import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { resolveTestnetFundingEnvironment } from "./testnet-funding/runtime-configuration.ts";
import { evaluateTestnetFundingPolicy } from "./testnet-funding/policy.ts";

const recipient = "0x2000000000000000000000000000000000000002" as const;
const { policy } = resolveTestnetFundingEnvironment(
  {
    TESTNET_FUNDING_API_TOKEN: "test-token-000000000000000000000000",
    TESTNET_FUNDING_SIGNER_ADDRESS:
      "0x3000000000000000000000000000000000000003",
  },
  "/tmp/orbit-policy-test",
);
const input = {
  activeRecipient: undefined,
  nowMilliseconds: 2 * 86_400_000,
  recipient,
  recipientBalance: { ethWei: 0n, wethWei: 0n },
  recipientHistory: {
    confirmedEthWei: parseEther("2"),
    confirmedWethWei: parseEther("2"),
    lastConfirmedAt: 86_400_000,
  },
  signerBalance: { ethWei: parseEther("2"), wethWei: parseEther("2") },
};

describe("daily testing faucet policy", () => {
  it("allows a spent wallet to return the next day without a lifetime cutoff", () => {
    const result = evaluateTestnetFundingPolicy(policy, input);
    expect(result.recipientState).toBe("eligible");
    expect(result.deficit).toEqual({
      ethWei: parseEther("0.01"),
      wethWei: parseEther("0.01"),
    });
  });
  it("sends only each asset's shortfall, never a fresh allowance on top", () => {
    const result = evaluateTestnetFundingPolicy(policy, {
      ...input,
      recipientBalance: {
        ethWei: parseEther("0.006"),
        wethWei: parseEther("0.008"),
      },
    });
    expect(result.deficit).toEqual({
      ethWei: parseEther("0.004"),
      wethWei: parseEther("0.002"),
    });
  });
  it("does not fund a wallet already at or above the balance targets", () => {
    const result = evaluateTestnetFundingPolicy(policy, {
      ...input,
      recipientBalance: {
        ethWei: parseEther("0.01"),
        wethWei: parseEther("0.02"),
      },
    });
    expect(result.recipientState).toBe("already-funded");
    expect(result.deficit).toEqual({ ethWei: 0n, wethWei: 0n });
  });
  it("blocks a drained wallet until 24 hours after its last successful grant", () => {
    const result = evaluateTestnetFundingPolicy(policy, {
      ...input,
      nowMilliseconds: input.nowMilliseconds - 1,
    });
    expect(result.recipientState).toBe("rate-limited");
    expect(result.nextEligibleAt).toBe(input.nowMilliseconds);
  });
});
