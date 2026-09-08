import { describe, expect, it } from "vitest";

import {
  getProtocolHealthReadScope,
  shouldLoadMarketHistory,
  shouldLoadPublicStatus,
} from "./protocol-read-scope";

describe("protocol health route scope", () => {
  it("keeps detailed operational history inside admin routes", () => {
    expect(getProtocolHealthReadScope("/exchange")).toEqual({
      includeBytecodeInventory: false,
      includeConnectedWallet: true,
      includeOperationalHistory: false,
      includeRewardHistory: false,
    });
    expect(getProtocolHealthReadScope("/admin")).toEqual({
      includeBytecodeInventory: true,
      includeConnectedWallet: true,
      includeOperationalHistory: true,
      includeRewardHistory: false,
    });
    expect(getProtocolHealthReadScope("/admin/diagnostics")).toEqual({
      includeBytecodeInventory: true,
      includeConnectedWallet: true,
      includeOperationalHistory: true,
      includeRewardHistory: true,
    });
    expect(getProtocolHealthReadScope("/status")).toEqual({
      includeBytecodeInventory: false,
      includeConnectedWallet: false,
      includeOperationalHistory: false,
      includeRewardHistory: true,
    });
  });

  it("loads indexed market history for the chart on both Trade and Market", () => {
    expect([
      shouldLoadMarketHistory("/market"),
      shouldLoadMarketHistory("/exchange"),
      shouldLoadMarketHistory("/status"),
    ]).toEqual([true, true, false]);
  });

  it("shares the sanitized status projection with public evidence routes", () => {
    expect([
      shouldLoadPublicStatus("/"),
      shouldLoadPublicStatus("/learn"),
      shouldLoadPublicStatus("/admin/sign-in"),
      shouldLoadPublicStatus("/status"),
      shouldLoadPublicStatus("/market"),
      shouldLoadPublicStatus("/status/private"),
      shouldLoadPublicStatus("/admin/diagnostics"),
      shouldLoadPublicStatus("/exchange"),
      shouldLoadPublicStatus("/faucet"),
      shouldLoadPublicStatus("/fleet"),
      shouldLoadPublicStatus("/rewards"),
    ]).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
