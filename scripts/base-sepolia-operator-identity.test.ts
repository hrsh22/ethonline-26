import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import { bindOperatorActors } from "./base-sepolia-operator-identity.ts";

const KEEPER = "0x1000000000000000000000000000000000000001" as Address;
const LIQUIDITY_EXECUTOR =
  "0x2000000000000000000000000000000000000002" as Address;
const WRONG_ACCOUNT = "0x3000000000000000000000000000000000000003" as Address;
const REPLACEMENT_KEEPER =
  "0x4000000000000000000000000000000000000004" as Address;
const REPLACEMENT_LIQUIDITY_EXECUTOR =
  "0x5000000000000000000000000000000000000005" as Address;

describe("Base Sepolia operator live-role identity binding", () => {
  it("binds distinct signing accounts to their live operational roles", () => {
    expect(
      bindOperatorActors({
        accounts: {
          keeper: { address: KEEPER },
          "liquidity-executor": { address: LIQUIDITY_EXECUTOR },
        },
        execute: true,
        liveRoles: {
          keeper: KEEPER,
          liquidityExecutor: LIQUIDITY_EXECUTOR,
        },
      }),
    ).toEqual({
      keeper: KEEPER,
      "liquidity-executor": LIQUIDITY_EXECUTOR,
    });
  });

  it("rejects a signing account that does not hold the live Keeper role", () => {
    expect(() =>
      bindOperatorActors({
        accounts: {
          keeper: { address: WRONG_ACCOUNT },
          "liquidity-executor": { address: LIQUIDITY_EXECUTOR },
        },
        execute: true,
        liveRoles: {
          keeper: KEEPER,
          liquidityExecutor: LIQUIDITY_EXECUTOR,
        },
      }),
    ).toThrow(/configured Keeper account does not hold the live Keeper role/u);
  });

  it("rejects a signing account that does not hold the live liquidity-executor role", () => {
    expect(() =>
      bindOperatorActors({
        accounts: {
          keeper: { address: KEEPER },
          "liquidity-executor": { address: WRONG_ACCOUNT },
        },
        execute: true,
        liveRoles: {
          keeper: KEEPER,
          liquidityExecutor: LIQUIDITY_EXECUTOR,
        },
      }),
    ).toThrow(
      /configured liquidity-executor account does not hold the live liquidity-executor role/u,
    );
  });

  it("uses both live role actors for a keyless dry-run", () => {
    expect(
      bindOperatorActors({
        accounts: {
          keeper: undefined,
          "liquidity-executor": undefined,
        },
        execute: false,
        liveRoles: {
          keeper: KEEPER,
          liquidityExecutor: LIQUIDITY_EXECUTOR,
        },
      }),
    ).toEqual({
      keeper: KEEPER,
      "liquidity-executor": LIQUIDITY_EXECUTOR,
    });
  });

  it("rotates the Keeper independently of the liquidity executor", () => {
    const liveRoles = {
      keeper: REPLACEMENT_KEEPER,
      liquidityExecutor: LIQUIDITY_EXECUTOR,
    } as const;

    expect(() =>
      bindOperatorActors({
        accounts: {
          keeper: { address: KEEPER },
          "liquidity-executor": { address: LIQUIDITY_EXECUTOR },
        },
        execute: true,
        liveRoles,
      }),
    ).toThrow(/configured Keeper account does not hold the live Keeper role/u);
    expect(
      bindOperatorActors({
        accounts: {
          keeper: { address: REPLACEMENT_KEEPER },
          "liquidity-executor": { address: LIQUIDITY_EXECUTOR },
        },
        execute: true,
        liveRoles,
      }),
    ).toEqual({
      keeper: REPLACEMENT_KEEPER,
      "liquidity-executor": LIQUIDITY_EXECUTOR,
    });
  });

  it("rotates the liquidity executor independently of the Keeper", () => {
    const liveRoles = {
      keeper: KEEPER,
      liquidityExecutor: REPLACEMENT_LIQUIDITY_EXECUTOR,
    } as const;

    expect(() =>
      bindOperatorActors({
        accounts: {
          keeper: { address: KEEPER },
          "liquidity-executor": { address: LIQUIDITY_EXECUTOR },
        },
        execute: true,
        liveRoles,
      }),
    ).toThrow(
      /configured liquidity-executor account does not hold the live liquidity-executor role/u,
    );
    expect(
      bindOperatorActors({
        accounts: {
          keeper: { address: KEEPER },
          "liquidity-executor": {
            address: REPLACEMENT_LIQUIDITY_EXECUTOR,
          },
        },
        execute: true,
        liveRoles,
      }),
    ).toEqual({
      keeper: KEEPER,
      "liquidity-executor": REPLACEMENT_LIQUIDITY_EXECUTOR,
    });
  });
});
