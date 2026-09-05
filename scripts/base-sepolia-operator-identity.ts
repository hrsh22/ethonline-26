import { getAddress, type Address } from "viem";

export type OperatorAuthorization = "keeper" | "liquidity-executor";

export interface OperatorAccountIdentity {
  readonly address: Address;
}

export interface OperatorAccounts {
  readonly keeper: OperatorAccountIdentity | undefined;
  readonly "liquidity-executor": OperatorAccountIdentity | undefined;
}

export interface LiveOperatorRoles {
  readonly keeper: Address;
  readonly liquidityExecutor: Address;
}

export type OperatorActors = Readonly<Record<OperatorAuthorization, Address>>;

export const bindOperatorActors = ({
  accounts,
  execute,
  liveRoles,
}: {
  readonly accounts: OperatorAccounts;
  readonly execute: boolean;
  readonly liveRoles: LiveOperatorRoles;
}): OperatorActors => {
  const keeper = getAddress(liveRoles.keeper);
  const liquidityExecutor = getAddress(liveRoles.liquidityExecutor);
  if (execute) {
    if (accounts.keeper === undefined) {
      throw new Error("Execute mode has no configured Keeper account");
    }
    if (getAddress(accounts.keeper.address) !== keeper) {
      throw new Error(
        "The configured Keeper account does not hold the live Keeper role",
      );
    }
    if (accounts["liquidity-executor"] === undefined) {
      throw new Error(
        "Execute mode has no configured liquidity-executor account",
      );
    }
    if (
      getAddress(accounts["liquidity-executor"].address) !== liquidityExecutor
    ) {
      throw new Error(
        "The configured liquidity-executor account does not hold the live liquidity-executor role",
      );
    }
  }
  return {
    keeper,
    "liquidity-executor": liquidityExecutor,
  };
};
