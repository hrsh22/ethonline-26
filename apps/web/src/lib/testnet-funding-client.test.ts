import { describe, expect, it, vi } from "vitest";

import {
  readTestnetFundingChallenge,
  readTestnetFundingStatus,
  requestTestnetFunding,
} from "./testnet-funding-client";

const address = "0x2000000000000000000000000000000000000002" as const;

const proof = {
  message: "orbit.test funding proof",
  signature: `0x${"ab".repeat(65)}`,
} as const;

describe("versioned testnet funding client", () => {
  it("reads public recipient status from the VM public API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        apiVersion: 1,
        service: { chainId: 84_532, state: "ready" },
        recipient: { address, state: "eligible" },
      }),
    );

    await expect(
      readTestnetFundingStatus(address, fetcher),
    ).resolves.toMatchObject({
      recipient: { state: "eligible" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/v1/funding/status?recipient=" + address,
    );
  });

  it("submits the recipient, a non-secret UI source, and the wallet proof", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        apiVersion: 1,
        recipient: { address, state: "funded" },
      }),
    );

    await requestTestnetFunding(address, "faucet", proof, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/v1/funding/fund",
      {
        body: JSON.stringify({ proof, recipient: address, source: "faucet" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
  });

  it("reads a challenge message for the requested recipient", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ challenge: { message: "sign me" } }));

    await expect(readTestnetFundingChallenge(address, fetcher)).resolves.toBe(
      "sign me",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8800/v1/funding/challenge?recipient=" + address,
    );
  });

  it("rejects a challenge response without a message", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ challenge: {} }));

    await expect(readTestnetFundingChallenge(address, fetcher)).rejects.toThrow(
      "could not be read",
    );
  });

  it("rejects a response outside the versioned public schema", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ privateKey: "must-not-pass" }));

    await expect(readTestnetFundingStatus(address, fetcher)).rejects.toThrow();
  });
});
