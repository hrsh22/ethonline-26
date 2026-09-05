import { describe, expect, it } from "vitest";

import {
  adminConsoleCapabilityRoles,
  getAdminAccessState,
} from "./admin-access";

const noCapabilities = {
  owner: false,
  keeper: false,
  liquidityExecutor: false,
  guardian: false,
  recovery: false,
  creator: false,
} as const;

describe("admin access boundary", () => {
  it("keeps wallet and protocol prerequisites ahead of role checks", () => {
    expect(getAdminAccessState({ accessState: "disconnected" })).toBe(
      "disconnected",
    );
    expect(getAdminAccessState({ accessState: "wrong-network" })).toBe(
      "wrong-network",
    );
    expect(getAdminAccessState({ accessState: "deployment-pending" })).toBe(
      "deployment-pending",
    );
    expect(
      getAdminAccessState({ accessState: "ready", healthPending: true }),
    ).toBe("loading");
    expect(
      getAdminAccessState({
        accessState: "ready",
        healthError: new Error("rpc unavailable"),
      }),
    ).toBe("read-failed");
  });

  it("does not expose the console to an ordinary connected wallet", () => {
    expect(
      getAdminAccessState({
        accessState: "ready",
        capabilities: noCapabilities,
      }),
    ).toBe("unauthorized");
  });

  it("uses the authenticated server role for console entry", () => {
    expect(
      getAdminAccessState({
        accessState: "ready",
        authenticatedRoles: ["recovery"],
        capabilities: noCapabilities,
      }),
    ).toBe("authorized");
  });

  it("fails closed when a retained capability snapshot outlives the live health read", () => {
    expect(
      getAdminAccessState({
        accessState: "ready",
        capabilities: { ...noCapabilities, owner: true },
        healthError: new Error("rpc unavailable"),
      }),
    ).toBe("read-failed");
    expect(
      getAdminAccessState({
        accessState: "ready",
        capabilities: { ...noCapabilities, owner: true },
        healthPending: true,
      }),
    ).toBe("loading");
  });

  it.each([
    "owner",
    "keeper",
    "liquidityExecutor",
    "guardian",
    "recovery",
  ] as const)("authorizes an observed %s capability", (capability) => {
    expect(
      getAdminAccessState({
        accessState: "ready",
        capabilities: { ...noCapabilities, [capability]: true },
      }),
    ).toBe("authorized");
  });

  it("admits the creator so accrued fees can be withdrawn", () => {
    // The creator needs the console for its own withdrawal. Scoping keeps the
    // rest of the console hidden, and the server still authorizes every action
    // against its exact capability.
    expect(
      getAdminAccessState({
        accessState: "ready",
        capabilities: { ...noCapabilities, creator: true },
      }),
    ).toBe("authorized");
  });

  it("scopes a creator-only wallet to the creator capability alone", () => {
    expect(
      adminConsoleCapabilityRoles({
        capabilities: { ...noCapabilities, creator: true },
      }),
    ).toEqual(["creator"]);
  });

  it("prefers authenticated session roles over observed capabilities", () => {
    expect(
      adminConsoleCapabilityRoles({
        authenticatedRoles: ["creator"],
        capabilities: { ...noCapabilities, keeper: true, owner: true },
      }),
    ).toEqual(["creator"]);
  });

  it("grants no scoped role without a session or capabilities", () => {
    expect(adminConsoleCapabilityRoles({})).toEqual([]);
  });

  it("expands an owner capability to every module owner role", () => {
    expect(
      adminConsoleCapabilityRoles({
        capabilities: { ...noCapabilities, owner: true },
      }),
    ).toEqual([
      "liquid-token-owner",
      "reward-ledger-owner",
      "converter-owner",
      "liquidity-owner",
    ]);
  });
});
