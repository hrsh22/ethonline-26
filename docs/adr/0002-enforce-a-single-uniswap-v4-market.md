# Enforce the canonical Uniswap v4 market

The protocol will register one Liquid Token/WETH Uniswap v4 pool on Base as the Canonical Market. A custom hook and dedicated router will authorize that pool's PoolManager settlements and collect the 3% WETH-side Trading Fee; configured venue code hashes will block the alternative venues named in that deployment's blocked-venue inventory, while ordinary wallet-to-wallet transfers remain available. This matches QUOTRONS' enforceable guarantee, but it cannot mathematically exclude every novel transfer-mediated venue without also restricting ordinary transfers. Aerodrome remains a separate downstream venue where reward WETH is converted through USDC into Coinbase tokenized stocks; it is not a supported market for the Liquid Token.

## Scope of the blocked-venue inventory

The guarantee is bounded by what a deployment actually configures, so this ADR
no longer claims that "known alternative AMM implementations" are blocked in
general.

Each deployment declares its inventory in its deployment inputs
(`BLOCKED_VENUE_INVENTORY_PATH`, shape in `deployments/blocked-venue-schema.json`).
Every entry carries the address it was observed at, where that address came
from, how the contract's identity was confirmed, and why blocking it is the
right unit -- a bare codehash is not reviewable. The deployment writes every
entry, records the complete list in the manifest as `blockedVenues` with each
label, and health fails on a mismatch between the manifest and runtime state.

Four limits are load-bearing.

1. **The inventory is frozen at launch.** `setBlockedVenueCodehash` reverts once
   the token is launched, so whatever is configured at deployment is the final
   inventory for that deployment. Adding an entry later requires a new checked
   deployment, not an in-place change.
2. **A codehash blocklist cannot reach a Uniswap V3 style pool.** V3 pools embed
   `token0`, `token1`, `fee`, `tickSpacing`, and `maxLiquidityPerTick` in their
   runtime bytecode as immutables, so every pool has a different codehash. There
   is no "V3 pool implementation codehash" to configure. Enumerating the pools
   instead is also impossible: the counter-asset is unbounded, so anyone can
   create a pool this deployment never named. The same applies to V3 forks --
   PancakeSwap V3 on Base Sepolia was checked and behaves identically. What an
   inventory _can_ block is the **singleton routers** that are the practical
   path into those pools, which is what the Base Sepolia inventory does.
3. **A codehash blocklist cannot reach a Uniswap V4 pool either, and must not
   try.** All V4 pools live inside one `PoolManager`, which is the canonical
   market's own venue -- blocking its codehash would break the product. Non-
   canonical V4 markets are excluded by `CanonicalMarketRegistry.isAuthorizedFuelSettlement`,
   which `FuelCore._enforceTransferPolicy` applies to every transfer touching
   the PoolManager. That is a different mechanism from this inventory, and it is
   the one doing the work for V4.
4. **Novel transfer-mediated venues cannot be universally excluded** without
   also restricting ordinary transfers, which the protocol will not do. A
   purpose-written contract that calls a pool directly is not covered by any
   entry here.

The Base Sepolia inventory is `deployments/84532.blocked-venues.json`. It blocks
the Uniswap V3 swap router, position manager, and migrator; the universal router
and swap proxy; the two public V4 test routers; the liquidity launcher; and the
PancakeSwap V3 swap router. Uniswap V2 was checked and is not deployed on Base
Sepolia, nor are Aerodrome, SushiSwap, or BaseSwap, so no shared-implementation
pair codehash exists on this chain to configure.

The claim for that deployment is therefore exactly: the sealed-route test venue
and the enumerated singleton routers above are blocked, and the canonical V4
market is enforced separately by settlement authorization. It is not a claim
that every third-party AMM market is impossible.
