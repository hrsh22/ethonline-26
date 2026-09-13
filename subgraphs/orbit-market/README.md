# Orbit canonical market subgraph

A live Graph Studio analytics source for the Base Sepolia FUEL / test WETH Uniswap v4 market. It preserves every field/type and enum value in the [Messari DEX AMM 1.3.2 schema](vendor/dex-amm-1.3.2.graphql), with explicit v4, testnet and collectible reward extensions. Standard token, protocol, pool, native swap/deposit and daily/hourly metrics are populated; custom funding entities explain where Stock Rewards came from.

[Free Studio staging endpoint](https://api.studio.thegraph.com/query/85163/orbit-market/0.1.6) · [Studio project](https://thegraph.com/studio/subgraph/orbit-market)

## Reproduce

```sh
cd subgraphs/orbit-market
npm ci --ignore-scripts
npm run codegen
npm test
npm run build
node scripts/query-proof.mjs https://api.studio.thegraph.com/query/85163/orbit-market/0.1.6
```

This is an isolated npm package; generated code, WASM, test binaries and dependencies are ignored. `npm test` runs schema/manifest compatibility checks and native Matchstick AssemblyScript mapping tests. The Graph CLI dependency tree is development tooling and is not bundled into the web/API runtime.

To deploy another free Studio version, place `GRAPH_STUDIO_DEPLOY_KEY` in the ignored repository-root `.env.deployment.local`, update the package version, then run `npm run deploy:studio`. The script only targets Studio; it never publishes onchain or configures paid billing. Studio currently permits [3,000 development queries/day](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/). The application caches server-side and budgets requests. No key is embedded in the public URL. Studio can archive earlier versions when replacing a deployment, so consumers must use the version recorded here.

## Standard and extensions

The vendored source is pinned to [Messari commit `5e308b5232c66cb87aaf7a26f8cfb670d3018060`](https://github.com/messari/subgraphs/blob/5e308b5232c66cb87aaf7a26f8cfb670d3018060/schema-dex-amm.graphql), SHA-256 `38a80d70d9dbe66d77d643a1521e292367f5d0540376c186d1b08059f2639e30`, under its included [MIT license](vendor/LICENSE). The implemented schema removes Messari documentation-only polling/snapshot annotations, makes mutable `@entity` declarations explicit for Graph Node, and adds fields/entities and `BASE_SEPOLIA`. The compatibility test guarantees no upstream field/type or enum value was removed or changed. [The Graph describes standards as a base that permits protocol-specific extensions](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/).

The same [standard market query](queries/standard-market.graphql) uses only shared fields; it has no ORBIT-specific selections. Optional `Block_height` supports an explicit historical comparison. This demonstrates a reusable query shape; successful execution against a second provider is a separate evidence claim, recorded below rather than assumed.

| Field or entity         | Methodology                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LiquidityPool.id`      | The canonical bytes32 v4 PoolId, **not a contract address**. `poolManager` and `chainId` identify the singleton and chain. A consumer must not cast this ID to an EVM address.                                                                                                                                                                                                                                                      |
| `Token`                 | Actual deployed metadata: `ORBIT Fuel` / `FUEL`, and `WETH MOCK TEST Self-Funded` / `MOCK-WETH-TEST`; both 18 decimals.                                                                                                                                                                                                                                                                                                             |
| USD fields              | Exactly zero because all these test assets have no economic USD value. There is no oracle estimate or fake mainnet WETH price. Native amounts are the useful testnet metrics.                                                                                                                                                                                                                                                       |
| `Swap`                  | PoolManager event deltas **before hook adjustment**: negative delta is token in, positive delta token out. Amounts are raw token units. `from`/`to` denote the v4 settlement caller (the canonical router), not an inferred ultimate beneficiary. `HookFeeAccrual.trader` supplies the contract-reported trader.                                                                                                                    |
| Pool fee                | Fixed 3%, explicitly applied to `feeBasisToken` (test WETH) turnover. It is not a second 3% on FUEL input. Canonical LP fee is zero; hook fees are outside the PoolManager Swap delta. Exact integer amounts come from `FeeAccrued`, never recomputed from floating point percentages.                                                                                                                                              |
| Pool balances           | Genesis `liquidTokenAmount` plus protocol `consumedWeth`, minus canonical Swap deltas, in input-token order. Genesis rounding dust remains in its vault and is excluded. **Never uses the singleton's token balance**.                                                                                                                                                                                                              |
| `inventoryComplete`     | Any donation or liquidity modification from outside the two known locked vaults invalidates native inventory permanently. Then `inputTokenBalances=[]`, subsequent `Swap.reserveAmounts` is absent, and snapshots carry `inventoryComplete=false`. Empty means unavailable, never zero. The funding/swap stream continues. Token private `_totalSupply` retains its last known canonical inventory with the same completeness flag. |
| `inputTokenWeights`     | Empty: fixed portfolio weights do not apply to this concentrated-liquidity pool. `weightMethodology` explains this. It is not a fabricated 50/50 inventory split.                                                                                                                                                                                                                                                                   |
| `Deposit`               | Exact permanently locked genesis and protocol-vault deposits. It is a supported-vault activity projection; third-party deposits/withdrawals are not reconstructed. An untracked change invalidates inventory as above.                                                                                                                                                                                                              |
| `Account` / usage       | Unique transaction initiators for supported swaps/deposits; transaction counts deduplicate multiple events in one transaction. These are onchain sender counts, not verified unique people. Other contract events do not inflate DEX transaction counts.                                                                                                                                                                            |
| Pool snapshots          | Event-driven daily/hourly native token volume and last observed inventory. USD fields stay zero. Empty periods are absent. Inventory completeness accompanies each snapshot.                                                                                                                                                                                                                                                        |
| LP output/reward tokens | Absent. v4 positions are not an ERC20 pool share, and collectible Stock Rewards are not LP mining emissions.                                                                                                                                                                                                                                                                                                                        |

This is a meaningful standard projection with documented limits, not a claim to reconstruct every possible third-party v4 position, withdrawal, or donor fee collection. The native reserve completeness extension exists because v4 hook permission flags do not prevent every unsolicited WETH-only liquidity change.

## Reward provenance

`RewardFundingSummary` has the canonical PoolId as its singleton ID. All `*Weth` fields are raw 18-decimal integers; counts are GraphQL `Int`. Totals are cumulative historical inflows/spend, **not current pot balances or an individual's claimable reward**.

- `HookFeeAccrual` preserves exact WETH volume and 2% reward / 0.85% liquidity / 0.15% creator allocation amounts, including integer rounding.
- `RewardEpoch` records numbered budget openings.
- `RewardConversion` records successful `TrackExecuted` events: measured WETH spend, measured stock output and the remaining reserved track budget. Track enum values are 1 AAPLc, 2 GOOGLc, 3 METAc, 4 NVDAc. A reverted attempt has no event and cannot be inferred from this stream.
- `RewardDistribution` and `RewardClaim` preserve actual ledger events, including allocation classes, identity and current owner.

Fee logs may occur before or after a Swap in the same receipt. There is no arbitrary one-to-one transaction-hash join. `TrackExecuted` has no epoch number; retained budgets can span epochs. Therefore this source demonstrates **pooled funding**, not a fictitious exact swap → epoch → individual claim causal chain.

## Sources, coverage and operational boundary

Contract addresses and PoolId come from the public demo's [`deployments/84532.staging.json`](../../deployments/84532.staging.json). Event ABIs are extracted from the compiled canonical Solidity artifacts. Market, auction and escrow-factory sources begin at the CCA start block 46,690,000; migration and activation sources begin at block 46,700,801. Only the exact canonical PoolId is accepted from PoolManager.

`subgraph.yaml` and `src/constants.ts` are generated from that explicit staging manifest by `pnpm generate`, and `pnpm check:manifest` rejects drift. Pass another v2 or v3 manifest path directly to `scripts/generate-manifest-config.mjs` for an intentional alternate generation. V3 generation binds market, auction and escrow-factory sources to `cca.lifecycle.startBlock`, and migration and activation sources to `cca.lifecycle.migrationBlock`. Factory events create dynamic escrow data sources, so only registered CCA escrows can produce `CcaEscrowWithdrawal` records.

CCA bid submissions, exits, token claims, migration failure, recovered funds, Fuel activation, and escrow withdrawals have dedicated entities. The current Studio index intentionally omits the strategy's successful `Migrated` event because its indexed tuple is not supported by the hosted Graph Node; the PoolManager and activation sources still capture the resulting market and activation. These records do not contribute to standardized `Swap` or fee entities. [`queries/cca-lifecycle.graphql`](queries/cca-lifecycle.graphql) reads the lifecycle records directly.

Graph Node handles event ordering and reorg rollback. Read `_meta.hasIndexingErrors`, indexed block/hash/timestamp and deployment identity before accepting a response; an empty result while backfilling is not proof of no fees. This subgraph provides sponsor analytics through the API adapter. The SQLite Historical Read Model and direct block-pinned balances, roles, ownership and transaction recovery keep their existing responsibilities.

## Evidence

Studio version **0.1.6**, deployment `QmPwMqYxUm5F1MRBDcJ9SzoM8R4JYgxiW1BcNCgZ96dDnX`, indexes the same staging contracts used by [orbit.gamified.trade](https://orbit.gamified.trade). The checked responses are pinned to finalized Base Sepolia block **46,765,498**, hash `0x967c62ea5b813e05d9d7bbd9d2b2b19bcf153b178bf31492313d86aa4145a345`, and require `hasIndexingErrors=false`.

At that block the [funding response](evidence/reward-funding.json) contains 184 hook-fee events and 8 successful conversions. It records exactly 0.128048266397806156 test WETH in fees: 0.085365510931870743 for rewards, 0.036280342146045022 for locked liquidity, and 0.006402413319890391 for the creator. The [standard response](evidence/standard-market.json) identifies the staging PoolId and both deployed tokens.

The [staging trade response](evidence/staging-trade.json) matches transaction `0xaa43abc1d1fecb522317bf656ff276770686135b90306963bd59f9bb53d4358b`: 0.006 test-WETH turnover, a 0.00018 test-WETH hook charge, 0.00582 test-WETH net input, and 1.160956411569668706 FUEL output. The [lifecycle response](evidence/cca-lifecycle.json) records the staging bid, activation, and both registered CCA escrows. The hosted index deliberately omits only the strategy's successful `Migrated` log because Graph Node cannot decode its indexed tuple; PoolManager and `FuelActivated` events independently capture the resulting live market.

`node scripts/query-proof.mjs` fetches these four live, key-free responses and rejects a wrong deployment, block/hash, pool, token, trade, lifecycle record, aggregate, or indexing-error state. Mapping tests cover canonical pool filtering, signed native deltas, exact fee rounding/multiple logs, successful conversion spend versus retained budget, and conservative inventory invalidation without stopping funding history.

Reference provider attempts use IDs from [Messari's deployment registry](https://github.com/messari/subgraphs/blob/master/deployment/deployment.json). The initial SushiSwap Ethereum gateway response was an indexer availability error ([captured response](evidence/reference-query.json)); historical retries, Uniswap v3, Balancer and PancakeSwap also timed out. This does not establish successful cross-provider execution. No account billing change was made to bypass those errors.
