# Own a TypeScript and SQLite historical read model

Status: accepted for the Base Sepolia proof of concept.

The same-origin Next.js proxy requirements in this ADR are superseded by
[`ADR 0010`](./0010-expose-a-vm-owned-public-api.md). The Historical Read Model itself and every
manifest, persistence, canonicality, cursor, ingestion, and single-writer requirement remain in
force.

## Context

The application originally reconstructed protocol history in each browser/runtime through bounded
`eth_getLogs` scans and process-local caches. Live use disproved the assumption that this was a
durable POC boundary: older events aged out of the 50,000-block operational window, fresh clients
repeated launch-to-tip work, and provider range/rate limits appeared to users as missing history.

Historical reads have different correctness and operating requirements from point-in-time reads.
Balances, pause state, roles, bytecode, the current pool slot, and quotes are cheap and strongest
when pinned directly to one observed block. Swaps, fees, Protocol-Owned Liquidity cycles, Reward
Epochs, conversions, notifications, and claims need persistence, a shared checkpoint, reorg replay,
deterministic pagination, and explicit coverage.

The detailed primary-source comparison and operational evidence live in
[`docs/research/durable-historical-read-model.md`](../research/durable-historical-read-model.md).

## Options considered

### Project-owned Uniswap v4 subgraph

A fork of the official v4 subgraph is technically compatible with the Base and Base Sepolia
PoolManagers. Graph Node provides durable PostgreSQL storage, reversible entity history, GraphQL,
indexing status, and mature metrics.

For this deployment it is operationally oversized. Self-hosting adds Graph Node, PostgreSQL, IPFS,
an EVM provider, AssemblyScript mappings, and a second application schema for one pool and five
first-party event-source addresses. A domain adapter would still be required to express requested
coverage as complete, partial, or error. Forking the GPL-3.0 Uniswap subgraph would also require a
license decision.

### Project-owned TypeScript indexer

A small TypeScript service can reuse the repository's Effect, viem, manifest, testing, and
operational conventions. A file-backed SQLite database provides atomic range/checkpoint commits,
restart persistence, local fixtures, and deterministic SQL pagination. The project owns the domain
HTTP contract and can later replace only the storage adapter.

This option requires first-party reorg, retry, migration, backup, and monitoring behavior. SQLite
also sets an explicit deployment boundary: one writer and a same-host persistent volume. It is not
an active-active or network-filesystem database.

### Managed Envio HyperIndex

Envio supports Base Sepolia, arbitrary EVM events, TypeScript handlers, hosted persistence,
rollback, GraphQL, monitoring, and a Uniswap v4 reference. It is the preferred managed fallback if
the project later needs an SLA or much larger backfills.

For the POC it adds recurring production cost, hosted query limits, Docker/Hasura local tooling,
and a non-OSI license boundary. Custom hook and protocol handlers are still project work, and a
domain adapter remains necessary.

## Decision

Use a project-owned TypeScript/Effect indexer backed by Node's built-in SQLite and expose a narrow
read-only HTTP API.

The following boundaries are mandatory:

- The checked deployment manifest is the only source for chain ID, launch block, PoolManager,
  canonical Pool ID, currency order, Canonical Fee Hook, Protocol Liquidity Vault, Epoch Converter,
  and Reward Ledger addresses.
- One database is bound to one chain and complete manifest fingerprint. Startup refuses a database
  with a different schema, chain, launch block, or manifest.
- Each successful database open rotates a random served-generation ID before the HTTP listener can
  start. Status, page, and structured error responses identify that generation, the canonical
  revision, and the pinned checkpoint. A restarted or restored database therefore cannot be
  mistaken for an earlier in-memory cache lineage.
- The worker indexes `Swap` filtered by the exact Pool ID, `FeeAccrued`,
  `ProtocolLiquidityAdded`, Fuel Core `Committed`, `RewardEpochOpened`, `TrackExecuted`,
  `RewardNotified`, and `RewardClaimed`.
- A range's events, retained canonical headers, observed head, and checkpoint commit in one SQLite
  transaction. The checkpoint never advances after a partial source read.
- Every update verifies the persisted checkpoint hash and replays a configurable overlap. A hash
  mismatch rewinds atomically to the highest retained common ancestor. If none exists, indexing
  fails closed for explicit recovery.
- `(chainId, blockHash, logIndex)` is the immutable fact identity. Query order and keyset cursors use
  `(blockNumber, transactionIndex, logIndex, blockHash)` and fetch `limit + 1`; no endpoint silently
  truncates. Continuation cursors also bind the exact checkpoint, observed head, canonical revision,
  and query. Append-only progress preserves a page walk within a bounded retained-snapshot window;
  snapshot expiry or a canonical rewind invalidates the cursor explicitly with a restart response.
- Every page reports requested range, indexed-through block/time, observed head/lag, and
  `complete | partial | error` state. Empty and incomplete are distinct states.
- A consumer that composes multiple endpoints pins one generation and canonical revision, checks
  every page against it, and checks status again after the logical read. Checkpoints must progress
  monotonically, and equal-height checkpoints must have the same hash. It discards all cached facts
  and restarts from launch if that contract changes; append-only checkpoint progress within the
  same revision remains valid.
- A synchronization failure after startup changes readiness and list routes to error until a later
  successful canonical synchronization. Previously committed facts are not served through a known
  canonicality failure.
- A browser may label previously verified observations stale only for the worker's typed
  `history-rpc-unavailable` state. Canonicality, revision, malformed-response, proxy, and unknown
  failures hide historical facts and fail closed.
- A confirmed target behind the persisted checkpoint fails closed without truncating history or
  changing cursor state. Only a verified canonical rewind may delete a committed tail and bump its
  revision.
- RPC requests use finite Effect retries, adaptive block-range splitting, and bounded concurrency.
  Decode, configuration, persistence, RPC, reorg, HTTP, and interruption failures remain typed at
  the Node boundary.
- The configured batch is strictly larger than the mutable overlap, so every append commit covers
  the overlap plus a new block rather than moving a checkpoint backward or replacing its snapshot.
- The history worker is independent of `pnpm dev` and the signing operator. It has no private key
  and cannot submit a transaction.
- Browsers call a same-origin Next.js route. `HISTORY_INDEX_URL` and required
  `HISTORY_READ_API_TOKEN` are server-only and never use a `NEXT_PUBLIC_` prefix.
- Public readiness, status, and list failures expose fixed error codes/messages rather than raw RPC
  diagnostics that may contain provider credentials.
- `MarketHistoryReader` and `ProtocolHistoryReader` insulate consumers from SQLite and the HTTP
  implementation. Public web history uses the indexed reader for canonical successful-event
  history. Safety-relevant failed transaction attempts cannot be reconstructed from logs. The
  operator therefore sends authenticated, idempotent lifecycle milestones to a separate
  manifest-bound SQLite journal owned by the non-signing history worker. A submitted transaction
  hash is first retained in a manifest-bound local outbox. Journal delivery acknowledgement and
  canonical resolution are separate states: acknowledgement never removes the local signing gate.
  Before a later bounded run can observe eligibility or sign, the operator reconciles each retained
  hash directly through exact receipt/header identity and the confirmation floor, without receiving
  broad history-read credentials. Only canonical success, revert, or a proven canonical nonce replacement removes the exact local row;
  receipt loss, replacement, revert, reorg, and later recovery are explicit states. The public
  projection contains only bounded action kinds, track IDs, hashes, block/time evidence, and safe
  failure classes. Submitted hashes are rechecked until their receipt crosses the configured
  confirmation boundary; pending and reorged hashes remain eligible for recovery. Missing, stale,
  incomplete, malformed, or unavailable evidence remains unknown.
  On 2026-09-07, the operator also recovers an exact signed submission whose nonce was
  consumed by a different transaction. It binds the persisted signed bytes to their hash,
  recovered sender, and deployment chain; finds the nonce-consuming transaction with a
  bounded canonical account-history search; verifies its receipt and inclusion after two
  confirmations; and rechecks the canonical headers. Pending/latest nonce alone cannot
  remove the gate. Missing signed bytes, unavailable archive evidence, and reorg uncertainty
  remain unresolved. Before clearing the exact row, the operator persists the original hash, replacement hash,
  and canonical block in the existing manifest-bound outbox metadata (latest 20 proofs).
  Failed proof persistence keeps the signing gate. These proofs survive restart and appear
  in the existing structured run evidence; no raw signed bytes enter that evidence. This is replacement evidence, never success
  of the original action: existing public attempt history may retain that original as unknown
  until its own receipt is available. The next Discovery or Keeper plan must observe at least
  the proven block and reevaluate current eligibility; it never blindly retries the old intent.
  `ProtocolHistoryReader` composes that direct source with successful event history; failure-source
  outages never hide already indexed successes. Other direct RPC history remains only as an
  explicit diagnostic fallback for non-browser tooling while it is retired.
- The attempt ingestion route requires the server-only `HISTORY_INGEST_API_TOKEN` and is never
  exposed by the Next.js route allowlist. History GET routes accept only the independent
  `HISTORY_READ_API_TOKEN`; there is no shared-token compatibility path. Ingestion cannot provide
  canonical receipt outcomes; those are worker-owned.
  Browsers can read only the safe same-origin projection. Attempt-source
  freshness/coverage/generation, event-index status, and offchain process liveness are three
  separate diagnostic claims. Public freshness distinguishes chain observation from server
  recording and uses the older timestamp conservatively.
- Current balances, roles, pauses, bytecode, quotes, and the canonical market slot remain direct
  reads pinned to an exact block number, hash, and timestamp. Multi-read operator snapshots are
  accepted only after the selected height's canonical identity is revalidated. Reward Track quote
  legs use the planning identity; each signing boundary uses and records a separate canonical
  preflight identity no older than planning, simulates at that block, and revalidates it before
  signing. The planning/quote identity is also revalidated after preflight acquisition and at the
  signing boundary. Invalidated roles, routes, eligibility, quote protection, or call requests fail
  closed and require replanning.
  Wallet permanent-identity candidates come from durable `Committed` history and previously
  observed wallet identities. Current ownership, permanence, rewards, and collectible balance
  are verified at the wallet's current block. Enumeration is complete only when the verified
  identities match the onchain collectible count. This keeps a just-committed identity visible
  while the index catches up, and prevents index lag from appearing as an empty wallet.

SQLite runs in WAL mode with `synchronous=FULL`, a busy timeout, one writer, and a local persistent
volume. Node is pinned to at least 24.15.0 because its bundled SQLite 3.51.3 contains the WAL-reset
corruption fix. Startup also verifies the actual SQLite version and journal mode.

## Consequences

Historical state survives web and worker restarts and is shared by every client. Provider limits
slow or pause indexing visibly instead of turning valid history into an empty dashboard. The
dependent liquidity-growth and OHLCV work can consume one stable boundary without introducing a
new scanner.

The deployment now operates one additional read-only process and persistent volume. It must be
backed up, monitored, and run as a single writer. Multi-region writers, horizontal SQLite replicas,
network filesystems, broader multi-chain history, or a vendor SLA trigger a new ADR to move the
storage adapter to PostgreSQL or reconsider Envio. Base mainnet receives a new checked manifest and
database; it never reuses the Base Sepolia file.

This ADR narrows the old POC statement that direct RPC is sufficient: direct RPC remains
authoritative for current point-in-time state, but it is no longer the application's durable
historical read model.

### 6 September 2026: collector Discovery evidence

The same canonical event index also tracks FuelCore `DiscoveryRequested`,
`DiscoveryFulfilled`, and `DiscoveryCancelled`. Correlation uses the per-unit
bytes32 protocol request ID, not the adapter's numeric VRF batch ID. The requested
event's transaction hash identifies the acquisition; fulfilment provides the exact
identity and cancellation provides the explicit lost-backing outcome. Indexed
delivery evidence does not establish current NFT ownership.

The existing bounded page boundary adds `/v1/protocol/discoveries` with a validated
account filter included in the SQL predicate and cursor query identity. The
collector consumes at most 100 recent events in one page, exposes truncation, and
verifies current holdings before showing a delivered card. It does not interpret
absence from a bounded or partial page as cancellation or delivery.

A persisted tracked-event revision distinguishes databases built before these
events were indexed. After metadata/integrity validation, an old revision atomically
invalidates its checkpoint and query snapshots, increments the canonical revision
when a checkpoint existed, and marks the new event revision. The existing
synchronizer then replays from the manifest launch block in its normal bounded
ranges. Coverage remains partial until replay catches up. Opening a current store
does not replay it again. Cursor generations rotate as before; old continuations
cannot cross this migration. This authorized derived-history migration makes no
contract change and does not manually reset a running service's database.

### 8 September 2026: managed Graph funding analytics

The Rewards page may query a second, read-only analytics projection deployed to
free Subgraph Studio. This narrows the earlier rejection of a project-owned
subgraph: managed Studio removes the self-hosting burden for this bounded
explanatory view, but does not replace the Historical Read Model.

`subgraphs/orbit-market` extends the Messari DEX AMM standard with exact hook fee
splits and pooled Reward conversion events. The API exposes one fixed bounded
query through `/v1/analytics/reward-funding`, including the index checkpoint and
indexing errors. A persistent daily request budget and shared two-minute cache
keep the free service bounded. The browser requests it only after an explicit
user action; account restoration and the claim workflow do not wait for it.

The projection explains where shared reward funding came from. It cannot prove
that a particular swap funded a particular claim, and it never reports a missing
summary as a zero reward balance. Test-asset USD values are zero, not a market
valuation. Standard pool swap amounts describe pool deltas before the separate
WETH-side hook fee. Unsupported pool inventory changes invalidate the inventory
projection rather than borrowing the singleton PoolManager's total balances.

All existing manifest binding, canonicality, coverage, cursor, operator journal,
and receipt recovery requirements above continue to apply to the Historical
Read Model. Current holdings, eligibility, balances, and quotes remain pinned
onchain reads. Graph downtime affects only the explanatory disclosure.
