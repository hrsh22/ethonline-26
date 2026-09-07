# Uniswap v4 integration feedback

ORBIT 4444 uses the Base Sepolia v4 PoolManager for its canonical FUEL/WETH
market. A custom hook charges 3% on the WETH side and allocates the exact
integer amounts to Stock Reward conversion, locked liquidity, and the creator.

## What worked

The unlock/callback settlement model lets the router account for the swap and
hook charge in one transaction. Returning hook deltas gives the application a
single WETH-side fee policy for both buy and sell directions. PoolId filtering
also gives the analytics adapter an unambiguous identity inside the singleton
PoolManager.

The relevant implementation is
[`CanonicalFeeHook`](packages/contracts/src/market/CanonicalFeeHook.sol),
[`CanonicalRouter`](packages/contracts/src/market/CanonicalRouter.sol), and
[`ProtocolLiquidityVault`](packages/contracts/src/liquidity/ProtocolLiquidityVault.sol).
The deployment addresses and canonical PoolId are in
[`deployments/84532.json`](deployments/84532.json).

## Where examples would help

1. A complete four-case example for exact input/output in both directions,
   with a fee charged in one chosen currency. Our hook must distinguish the
   specified and unspecified currency and calculate gross WETH for exact-output
   protection. A truth table alongside the callback deltas would make this
   easier to verify.
2. An analytics example that separates PoolManager Swap amounts from the
   wallet's total payment when a hook returns custom deltas. Our Graph adapter
   indexes the standard pool swap and the hook's exact `FeeAccrued` separately;
   treating pool deltas as a user's gross payment would be wrong.
3. A v4 standardized-schema example for the singleton PoolId, custom hook fee
   basis, and concentrated-liquidity inventory. A pool does not have its own
   ERC-20 reserve address, and the PoolManager's token balance includes other
   pools. Our adapter explicitly marks inventory incomplete after unsupported
   liquidity changes or donations.

## Verification and reproduction

The contract suite contains exact-input/output fee and settlement checks.
The local app also completed an embedded Privy-wallet WETH approval and FUEL
purchase on Base Sepolia, with the canonical hook fee and a Discovery request.
See the [integration evidence](docs/operations/ethonline-2026-integrations.md)
for transaction links, live Graph queries, and the validation record.

This file is repository feedback. The separate Uniswap hackathon feedback form
has not been submitted by the agent.
