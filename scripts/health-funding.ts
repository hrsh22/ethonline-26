import { decodeTestnetFundingResponse } from "@orbit/config/testnet-funding";
import { Effect } from "effect";

import { rpc } from "./effect-runtime.ts";

export interface FundingHealth {
  readonly alert: "normal" | "elevated" | "critical" | undefined;
  readonly ok: boolean;
  readonly reason: string | undefined;
  readonly state: "disabled" | "ready" | "inventory-empty";
}

const authorization = (
  token: string | undefined,
): Readonly<Record<string, string>> =>
  token === undefined ? {} : { authorization: `Bearer ${token}` };

/**
 * A disabled faucet is an operator decision and stays healthy. An empty one is
 * a deployment that silently stopped onboarding anyone, which is exactly what
 * this gate exists to catch.
 */
const evaluate = (
  state: FundingHealth["state"],
  alert: FundingHealth["alert"],
): Pick<FundingHealth, "ok" | "reason"> => {
  if (state === "inventory-empty") {
    return {
      ok: false,
      reason: "Funding inventory is empty; the faucet can onboard nobody",
    };
  }
  if (alert === "critical") {
    return {
      ok: false,
      reason: "Funding budget is critically depleted for this window",
    };
  }
  return { ok: true, reason: undefined };
};

export const readFundingHealth = (input: {
  readonly apiToken: string | undefined;
  readonly fetcher?: typeof fetch;
  readonly serviceUrl: string;
}): Effect.Effect<FundingHealth, unknown> =>
  rpc("Could not read testnet funding health", async () => {
    // The worker's own route, not the public API's `/v1/funding/status`: this
    // gate reads the signer's inventory directly rather than through the
    // gateway that may itself be down.
    const url = new URL("/v1/status", input.serviceUrl);
    const response = await (input.fetcher ?? fetch)(url, {
      headers: { accept: "application/json", ...authorization(input.apiToken) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Funding worker status responded ${String(response.status)}`,
      );
    }
    const decoded = decodeTestnetFundingResponse(await response.json());
    const service = decoded.service;
    if (service === undefined) {
      throw new Error("Funding worker status omitted its service result");
    }
    return {
      alert: service.budget?.alert,
      state: service.state,
      ...evaluate(service.state, service.budget?.alert),
    };
  });
