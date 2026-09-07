# Durable historical read model for ORBIT 4444

_Verified against official primary sources and repository state at `598f00c`._

This is an architecture research note for issue #43, not the decision record. The follow-up ADR should make the final choice and supersede any earlier assumption that browser-local bounded log scans are a durable history source.

## Recommendation

Build a **project-owned TypeScript indexer backed by a file-based SQLite database and a narrow read-only HTTP API** for the current Base Sepolia proof of concept.

That choice is proportionate to this protocol's historical surface: one canonical pool and a small, fixed set of first-party contracts from one checked launch block. It reuses the repository's Node 24, TypeScript, Effect, and viem stack; gives the application explicit coverage and failure semantics; requires no browser credential; and avoids operating Graph Node, PostgreSQL, and IPFS or accepting a managed indexer's recurring cost and license boundary.

This recommendation has a deliberate limit: run exactly one index writer on one host with a persistent local volume. SQLite WAL is not a network-filesystem or multi-region database. Move the storage adapter to PostgreSQL or reconsider a managed indexer if the service needs active-active writers, horizontal query replicas, multi-region failover, substantially broader chain history, or a vendor SLA. SQLite documents that WAL readers and writers must share a host and that WAL permits concurrent readers but only one writer. [SQLite WAL documentation](https://sqlite.org/wal.html)

## Repository-specific requirements

The checked [Base Sepolia deployment manifest](../../deployments/84532.json) is the only configuration source the indexer should accept. It currently establishes:

- chain ID `84532` and launch block `46217340`;
- PoolManager `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`;
- canonical Pool ID `0x4000bcdff70b03abb40b8cf387f90b25378c838162db223eef92d9a46da0f599`;
- canonical currency ordering `Liquid Token 0x0833…16dd` as `currency0` and `WETH-like 0x4fB7…B8fc`
  as `currency1` -- the ordering is a function of the deployed addresses, not a fixed choice, and it
  reversed at the subsequent redeployment;
- the Canonical Fee Hook, Fuel Core, Protocol Liquidity Vault, Epoch Converter, and Reward Ledger
  event-source addresses.

Every value above comes from the manifest at read time. The indexer must not pin any of them: its
databases fail closed on a deployment fingerprint mismatch precisely so a redeployment forces a
rebuild rather than silently serving another deployment's history.

The durable boundary must index, from that launch block:

- PoolManager `Swap`, filtered by the exact canonical Pool ID;
- Canonical Fee Hook `FeeAccrued`;
- Protocol Liquidity Vault `ProtocolLiquidityAdded`;
- Fuel Core `Committed`;
- Epoch Converter `RewardEpochOpened` and `TrackExecuted`;
- Reward Ledger `RewardNotified` and `RewardClaimed`.

The original [viem transport](../../packages/protocol/src/viem-transport.ts) split `eth_getLogs` into
10,000-block calls, limited operational history to 50,000 blocks, kept only process-local caches,
and rescanned a 12-block overlap. The client provider constructed that transport in a client
component, so every fresh browser was an independent history reader. Direct RPC remains useful for
bounded point-in-time verification, but candidate discovery and other historical facts require the
shared durable boundary.

## Option comparison

| Concern                         | Project-owned Uniswap v4 subgraph / Graph Node                                                                                                                                                                                                 | Project-owned TypeScript + SQLite                                                                                                                                                                                                   | Managed Envio HyperIndex                                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base Sepolia and custom v4 pool | Strong. Uniswap's official v4 subgraph already lists the official Base Sepolia PoolManager and handles `Initialize`, `ModifyLiquidity`, and `Swap`; the project must add its own hook and protocol contracts and filter the canonical Pool ID. | Strongest control. Decode the same checked ABIs and filter the Pool ID before persistence. No generic DEX model is required.                                                                                                        | Strong. HyperSync explicitly supports Base Sepolia `84532`, HyperIndex accepts arbitrary EVM contracts/events, and Envio publishes a TypeScript Uniswap v4 reference. Its reference says custom hook integration is still in progress, so first-party hook handlers are still required. |
| Persistence and restart         | PostgreSQL stores subgraph data and Graph Node resumes it; Graph Node also needs IPFS and an EVM provider.                                                                                                                                     | A transactionally updated checkpoint and event rows live in a SQLite file on a persistent local volume. Restart/resume behavior is completely testable in this repository.                                                          | Hosted PostgreSQL/GraphQL persistence is managed in production. Local development uses Docker and Hasura. The free development plan can auto-delete deployments.                                                                                                                        |
| Reorg behavior                  | Graph Node maintains reversible entity history and a reorg threshold; its maintenance tools can rewind deployments and repair a poisoned block cache.                                                                                          | Must be implemented explicitly: retain recent canonical block hashes, verify the checkpoint hash, rewind atomically to the common ancestor, and rescan an overlap. A deeper-than-retained reorg fails closed and requires recovery. | Built-in rollback is enabled by default. HyperSync-backed detection is documented as guaranteed; the current default maximum reorg depth is 200 blocks. External side effects are not rolled back.                                                                                      |
| Query status                    | GraphQL `_meta` exposes indexed block/hash/timestamp and indexing errors; the status API and Prometheus endpoint add operator detail. A domain adapter must still express requested coverage as complete/partial/error.                        | The HTTP contract can natively return indexed-through block/time, requested range, manifest identity, lag, and complete/partial/error without translating a generic schema.                                                         | `_meta` exposes indexing progress. A domain adapter must still normalize coverage and errors for the application.                                                                                                                                                                       |
| Deterministic pagination        | Supported when the schema defines a stable unique entity ID and clients use attribute/keyset pagination. The Graph warns that large `skip` pagination performs poorly.                                                                         | Straightforward composite keyset cursor over canonical `(blockNumber, transactionIndex, logIndex, blockHash)`, with a hard page maximum, `limit + 1`, `hasMore`, and an opaque next cursor.                                         | Hasura supports filtering, sorting, and keyset-style queries, but the project must define and enforce a unique sequential event key. Hosted query-rate limits still apply.                                                                                                              |
| RPC limits and retries          | Graph Node chunks/provider-manages ingestion, supports multiple providers, retry backoff for nondeterministic failures, and exposes extensive metrics.                                                                                         | Effect schedules, bounded concurrency, adaptive range splitting, and typed retryable/permanent errors are first-party code. A dedicated production RPC remains necessary.                                                           | HyperSync removes most RPC-range handling for supported chains. HyperIndex has an RPC fallback, built-in reorg processing, managed monitoring, and plan-level query limits.                                                                                                             |
| Local development               | Heaviest: Graph Node + PostgreSQL + IPFS + RPC, plus graph-cli and AssemblyScript mappings.                                                                                                                                                    | Lightest: one Node process and one disposable SQLite file; fixtures can run entirely in process.                                                                                                                                    | Docker is required; local HyperIndex brings up its indexer database and Hasura and requires an Envio/HyperSync API token unless configured for RPC.                                                                                                                                     |
| Deployment and operations       | Highest self-hosted burden, although mature: back up PostgreSQL/IPFS metadata, operate Graph Node, RPCs, status API, Prometheus, and versioned subgraph deployments.                                                                           | One container/process plus a persistent same-host volume, a read-only API, health/readiness endpoints, backups, and a dedicated RPC. The project owns recovery correctness.                                                         | Lowest production burden on Envio Cloud: backups, static endpoint, zero-downtime deploys, alerts, and monitoring are sold as managed features. Self-hosting is possible from the generated Dockerfile.                                                                                  |
| Cost and lock-in                | No Graph Node license fee; Graph Node is MIT/Apache-2.0. The project pays for PostgreSQL, IPFS, RPC, compute, backups, and operator time. A fork of Uniswap's v4 subgraph is GPL-3.0.                                                          | No framework or database fee. The project pays for one small persistent service, backups, and a production RPC. Schema and domain API are entirely project-owned.                                                                   | Current small-production hosting starts at `$70/month` and includes up to 250 GraphQL queries/minute in the estimator. The free plan is explicitly non-production. HyperIndex is public but uses a non-OSI EULA; self-hosting is allowed, while competing hosted use is restricted.     |
| Base mainnet migration          | Generate a Base manifest and redeploy/resync. Uniswap's official v4 subgraph already lists the Base PoolManager.                                                                                                                               | Point a new service/database at a checked Base mainnet manifest; chain ID and manifest hash prevent accidental cross-chain reuse. Domain interfaces stay unchanged.                                                                 | Base mainnet has first-class HyperSync support; change chain/config and backfill a new deployment. Domain interfaces still insulate the UI from Envio.                                                                                                                                  |

### Option 1: project-owned Uniswap v4 subgraph

This is technically sound but operationally oversized for the current scope.

The Graph can self-host any EVM-compatible network. A basic Graph Node needs one Graph Node instance, PostgreSQL, IPFS, and one or more network clients; it can later split indexing and query roles and shard databases. [Graph Node operations](https://thegraph.com/docs/en/indexing/tooling/graph-node/), [supported networks](https://thegraph.com/docs/en/supported-networks/)

Compatibility is not speculative. Uniswap's current v4 subgraph contains Base Sepolia and Base PoolManager deployments, and its manifest handles the singleton PoolManager's `Swap` event. A fork could therefore index this custom-hook pool by Pool ID and add the project's own contract event sources. [Uniswap v4 network configuration](https://github.com/Uniswap/v4-subgraph/blob/main/networks.json), [Uniswap v4 subgraph manifest](https://github.com/Uniswap/v4-subgraph/blob/main/subgraph.yaml)

The trade-off is a second application model and runtime. Subgraph manifests bind contracts/events to WebAssembly/AssemblyScript mappings, data is exposed through GraphQL, and operational status is exposed through a separate indexing API and Prometheus. The project would still need a server-side domain adapter for `MarketHistoryReader` and `ProtocolHistoryReader`. The Graph recommends keyset/attribute pagination rather than large `skip` values and exposes `_meta` for block and error status. [Subgraph manifests](https://thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/), [GraphQL API](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/)

Graph Node is mature and openly licensed, but the official Uniswap subgraph itself is GPL-3.0. A project fork therefore needs license review before code reuse. [Graph Node repository and licenses](https://github.com/graphprotocol/graph-node), [Uniswap v4 subgraph repository and license](https://github.com/Uniswap/v4-subgraph)

### Option 2: project-owned TypeScript indexer with SQLite

This option best matches the domain boundary and the repository's engineering constraints.

The service should remain deliberately narrow:

1. Load and validate the checked deployment manifest; calculate a manifest identity/hash and refuse to open a database belonging to a different chain or manifest.
2. Backfill only the required addresses/topics from the manifest launch block, filter PoolManager swaps by the exact Pool ID, decode strictly, and persist raw canonical event facts plus derived domain rows.
3. Run a steady-state poll loop independently from `pnpm dev`; commit a range's rows, recent block hashes, aggregates, and checkpoint in one database transaction.
4. Serve a read-only domain HTTP API. The web application calls it through same-origin server routes so RPC credentials or an optional service token never reach browser JavaScript.
5. Leave current balance, bytecode, role, pause, quote, and other point-in-time reads on the direct block-pinned protocol reader.

The Ethereum JSON-RPC API permits log filters by block range or by a specific block hash. EIP-234 explains why block-hash-bound log retrieval and a locally maintained recent chain are necessary to recover reliably from disconnects and reorgs. [Ethereum `eth_getLogs`](https://ethereum.org/developers/docs/apis/json-rpc/#eth_getlogs), [EIP-234](https://eips.ethereum.org/EIPS/eip-234)

Base Sepolia is chain `84532`, but Base explicitly marks its public RPC as rate-limited and unsuitable for production. The indexer therefore needs a configured dedicated provider in deployed environments, bounded request concurrency, finite exponential-backoff retries with jitter, and adaptive range splitting for provider range/response-size errors. It must only advance a checkpoint after every event-source read for the range succeeds. [Base connection documentation](https://docs.base.org/base-chain/quickstart/connecting-to-base)

#### SQLite and Node 24 status

The repository currently permits Node `>=24.0.0 <25`. Node's built-in `node:sqlite` module was added in Node 22.5, left the feature flag in 22.13/23.4, and became **Stability 1.2 (release candidate)** in Node 24.15. Its `DatabaseSync` API is synchronous and supports file-backed databases, prepared statements, configurable busy timeout, backup, and BigInt reads. [Node 24 `node:sqlite` documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

The checked workstation is Node `v24.15.0` with SQLite `3.51.3`. That SQLite version matters: SQLite disclosed a rare WAL reset corruption bug affecting 3.7.0 through 3.51.2 under concurrent write/checkpoint conditions and fixed it in 3.51.3 (with selected backports). If WAL is used, the implementation should require a fixed bundled SQLite version rather than relying on the repository's current broad `>=24.0.0` engine range. [SQLite WAL reset advisory](https://sqlite.org/wal.html#the_wal_reset_bug)

Recommended database posture:

- one writer process and one local persistent volume;
- `PRAGMA journal_mode=WAL`, verified on startup;
- `PRAGMA synchronous=FULL` for durable checkpoints, accepting the small write-latency cost;
- short transactions, bounded HTTP page sizes, prepared statements, foreign keys, and a busy timeout;
- backups through SQLite's supported backup path or a stopped/checkpointed database, never by copying only the main file while live because the WAL is part of persistent state;
- startup checks for schema version, chain ID, manifest hash, SQLite version, integrity, and checkpoint/header consistency.

SQLite documents atomic commit/rollback, WAL snapshot isolation for readers, persistence of WAL mode, checkpoint behavior, and the requirement to keep the database and its WAL together. [SQLite transactions](https://sqlite.org/lang_transaction.html), [SQLite WAL behavior](https://sqlite.org/wal.html)

#### Checkpoint and reorg algorithm

Persist both a processed checkpoint and enough recent canonical headers to find a common ancestor:

1. On startup and before each update, fetch the checkpoint block by number and compare its hash.
2. If it matches, rescan a configured mutable overlap before advancing. Idempotent event keys make duplicates harmless.
3. If it differs, walk the retained `(number, hash, parentHash)` window backwards until a common ancestor is found.
4. In one SQLite transaction, delete canonical events and derived aggregates after that ancestor, rewind the checkpoint, and then replay canonical blocks.
5. Treat an RPC log with `removed: true` as a request to remove/replace that exact fact, even though ordinary range backfills usually discover removal through hash mismatch instead.
6. If no common ancestor exists inside the retained window, stop with a typed deep-reorg/corruption error. Do not guess or present stale data as complete; the recovery runbook resets from a known safe block or performs a full rebuild.

Base describes increasing finality stages: an L2 block at roughly two seconds has near-zero reorg probability and an L1-batched transaction at roughly two minutes has effectively zero reorg probability. The indexer can expose a low-latency provisional tail while marking only the configured confirmation boundary as complete; the mutable overlap remains necessary because “near zero” is not zero. [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)

#### Deterministic storage and pagination

Use immutable raw facts and rebuildable projections:

- raw event identity: `(chainId, blockHash, logIndex)` with transaction hash/index, block number/time, source address, event type, and decoded payload;
- canonical ordering: `(blockNumber, transactionIndex, logIndex, blockHash)`;
- one checkpoint row per chain/manifest;
- domain projections for swaps/candles, fees, Protocol-Owned Liquidity cycles, Reward Epochs, track conversions, notifications, and claims;
- precomputed candle buckets and cumulative counters updated in the same transaction as their source events.

Every list endpoint should use the canonical tuple as an opaque keyset cursor, order explicitly, cap `limit`, fetch `limit + 1`, and return `hasMore` plus `nextCursor`. Never infer completeness from “fewer rows than requested” without also returning coverage. This avoids offset drift and silent server truncation.

Each response should include a status envelope such as:

```text
state: complete | partial | error
requested: { fromBlock, toBlock }
coverage: { fromBlock, indexedThroughBlock, indexedThroughTime }
head: { observedBlock, lagBlocks }
manifest: { chainId, manifestHash }
error: typed public error or null
```

`complete` means the full requested range is inside confirmed indexed coverage. `partial` must say exactly which subrange is present. `error` must not return a normal-looking empty history.

#### Effect boundary

Use Effect for first-party Node concerns rather than hiding them behind ambient globals:

- manifest, RPC, database path, poll interval, batch size, concurrency, overlap, and HTTP settings as validated configuration;
- RPC client, clock, database, checkpoint store, event decoder, index loop, and HTTP server as replaceable services/layers;
- typed configuration, RPC, decode, persistence, reorg, coverage, and interruption failures;
- retry schedules only for explicitly retryable provider errors, with bounded attempts/backoff/jitter;
- scoped database/server resources and interruptible polling so shutdown finishes or rolls back the active transaction cleanly.

No signing key belongs in this service. It needs read-only RPC access and, if the HTTP API is private, a server-to-server credential held only by the web server. Browser code should call a same-origin `/api/history/...` boundary.

### Option 3: managed Envio HyperIndex

Envio is the strongest managed representative found for this exact chain and protocol shape.

Its current supported-network table lists both Base Sepolia `84532` and Base `8453` with HyperSync and HyperRPC endpoints. HyperIndex accepts arbitrary EVM contract/event configuration, TypeScript handlers, a GraphQL API, local Docker development, and hosted or self-hosted deployment. [HyperIndex supported networks](https://docs.envio.dev/docs/HyperIndex/supported-networks), [HyperIndex overview](https://docs.envio.dev/docs/HyperIndex/overview), [configuration](https://docs.envio.dev/docs/HyperIndex/configuration-file)

Reorg handling is a genuine advantage: rollback is on by default, entities read/written by handlers are reverted, HyperSync-backed detection is documented as guaranteed, and the depth is configurable. Side effects outside the indexer database are not reverted. [HyperIndex reorg support](https://docs.envio.dev/docs/HyperIndex/reorgs-support)

Envio also publishes a TypeScript Uniswap v4 indexer reference that tracks pool metrics, swaps, and liquidity. Its documentation explicitly labels hook/event integration as in progress, so this project's fee-hook and reward events still require dedicated handlers and tests. [Envio Uniswap v4 reference](https://docs.envio.dev/docs/HyperIndex/example-uniswap-v4-multi-chain-indexer)

The managed trade-off is material for this POC. As checked, production hosting is `$70–$800/month`; the small tier estimator shows `$70/month` and up to 250 GraphQL queries/minute, while the free tier has no backups, may have downtime, and auto-deletes based on age, event/storage limits, or inactivity. [Envio hosting pricing](https://envio.dev/pricing/hosting)

There is also a nonstandard license boundary. Envio says HyperIndex is public but **not OSI-recognized**, permits project self-hosting or RPC bypass, and restricts offering the generated software as a competing hosted service. That is less lock-in than a closed API, but more legal/product dependency than first-party TypeScript and SQLite. [HyperIndex licensing](https://docs.envio.dev/docs/HyperIndex/licensing)

If the team later values managed backups, zero-downtime deployments, large backfills, and an SLA more than minimizing dependencies and cost, Envio is the first option to re-evaluate. Keep the UI behind the two domain readers so such a migration does not rewrite presentation code.

## Implementation shape for the ADR

The ADR should select the TypeScript/SQLite approach with these non-negotiable boundaries:

- `MarketHistoryReader`: deterministic pages of swaps/candles/volume/fees plus coverage status.
- `ProtocolHistoryReader`: deterministic pages of Protocol-Owned Liquidity cycles, Reward Epochs, conversions, notifications, and claims plus coverage status.
- A separate worker command owns indexing; `pnpm dev` remains the frontend command.
- One manifest-derived index configuration; no copied addresses, Pool IDs, launch blocks, or currency-order booleans.
- One persistent database per chain and manifest identity.
- One writer, same-host persistent storage, no SQLite database on a network filesystem.
- A same-origin server adapter between browser clients and the history service.
- Direct block-pinned reads remain the source for current balances, roles, pauses, quote state, and other point-in-time health.
- Every empty history is distinguishable from incomplete or failed coverage.

## Required operational proof

Before issue #43 is considered complete, exercise these cases against fixtures and a real process boundary:

1. launch-to-tip backfill with sparse blocks and provider-enforced small ranges;
2. clean restart/resume without refetching completed history;
3. overlap rescan with duplicate logs and idempotent projections;
4. a replaced recent block, a `removed` log, and rollback/replay of candles and cumulative totals;
5. a reorg deeper than retained history that fails closed;
6. 429/timeout/response-too-large behavior with bounded concurrency and finite retry/split behavior;
7. interruption during fetch and during a database transaction;
8. deterministic multi-page reads while new blocks arrive;
9. a web-server restart that sees the same indexed history and status;
10. manifest/chain mismatch refusal, reset/recovery, backup/restore, and a fresh Base-mainnet-shaped manifest fixture.

Runbooks should cover local disposable data, one-shot backfill, steady-state worker, status inspection, graceful stop, backup, reset with explicit target confirmation, deep-reorg recovery, deployment with a persistent volume, RPC rotation, schema migration, and alerts for stale checkpoint, growing lag, retry exhaustion, disk pressure, integrity failure, and manifest mismatch.

## Primary source index

- [Base RPC/network information](https://docs.base.org/base-chain/quickstart/connecting-to-base)
- [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)
- [Ethereum JSON-RPC `eth_getLogs`](https://ethereum.org/developers/docs/apis/json-rpc/#eth_getlogs)
- [EIP-234 block-hash log filtering](https://eips.ethereum.org/EIPS/eip-234)
- [Uniswap v4 subgraph](https://github.com/Uniswap/v4-subgraph)
- [Graph Node operations](https://thegraph.com/docs/en/indexing/tooling/graph-node/)
- [The Graph query API](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/)
- [Node 24 `node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [SQLite WAL](https://sqlite.org/wal.html)
- [Envio HyperIndex documentation](https://docs.envio.dev/docs/HyperIndex/overview)
- [Envio hosting pricing](https://envio.dev/pricing/hosting)
- [Envio licensing](https://docs.envio.dev/docs/HyperIndex/licensing)
