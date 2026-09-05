import { describe, expect, it } from "vitest";

import { getCollectorAccessState } from "./collector-access";

describe("collector access state", () => {
  it("gives a useful next step for every wallet and deployment condition", () => {
    expect(
      getCollectorAccessState({
        connected: false,
        chainId: undefined,
        deploymentAvailable: true,
        expectedChainId: 84_532,
      }),
    ).toBe("disconnected");
    expect(
      getCollectorAccessState({
        connected: true,
        chainId: 1,
        deploymentAvailable: true,
        expectedChainId: 84_532,
      }),
    ).toBe("wrong-network");
    expect(
      getCollectorAccessState({
        connected: true,
        chainId: 84532,
        deploymentAvailable: false,
        expectedChainId: 84_532,
      }),
    ).toBe("deployment-pending");
    expect(
      getCollectorAccessState({
        connected: true,
        chainId: 84532,
        deploymentAvailable: true,
        expectedChainId: 84_532,
      }),
    ).toBe("ready");
  });
});
