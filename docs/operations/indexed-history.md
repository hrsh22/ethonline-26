# Indexed history operations

The history service is a read-only TypeScript/Effect worker. It indexes the canonical Base Sepolia
market and protocol events into one manifest-bound SQLite file. It also owns a separate
manifest-bound keeper-attempt journal populated by authenticated operator milestones and reconciled
against canonical receipts. It serves deterministic domain pages to the web application and has no
wallet client, private key, transaction preparation, or signing capability.

`pnpm dev`, `pnpm api:serve`, `pnpm history:worker`, and `pnpm operator:watch` are independent lifecycles:

- `pnpm dev` runs only the Next.js application;
- `pnpm api:serve` runs the browser-facing VM public API;
- `pnpm history:worker` runs one read-only index writer and HTTP API;
- `pnpm operator:watch` explicitly runs the transaction-signing operator in dry-run or execute
  mode.

## Requirements

- Node 24.15.0 or newer within major version 24. The worker verifies that bundled SQLite is at
  least 3.51.3 before enabling WAL.
- A dedicated Base Sepolia RPC in deployed environments. Base's public endpoint is rate-limited
  and is not a production index source.
- One process replica and one same-host persistent volume. Do not put the SQLite database on NFS or
  another network filesystem and do not run active-active writers.
- The checked `deployments/84532.json`. Addresses, Pool ID, currency order, chain, and launch block
  are never copied into environment variables.

## Configuration

For local development, place configuration in the ignored root `.env`. The history launcher
projects only history configuration before startup, and the worker does not reload the combined
file. First generate and export two independent credentials. The `printf` output is the pair of
literal lines to paste into `.env`; do not paste the shell expressions themselves:

```bash
export HISTORY_READ_API_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
export HISTORY_INGEST_API_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
printf 'HISTORY_READ_API_TOKEN=%s\nHISTORY_INGEST_API_TOKEN=%s\n' \
  "$HISTORY_READ_API_TOKEN" "$HISTORY_INGEST_API_TOKEN"
```

Then create the ignored root `.env` with the printed values in place of the literal placeholders:

```dotenv
BASE_SEPOLIA_RPC_URL=https://your-read-provider.example
HISTORY_MANIFEST_PATH=deployments/84532.json
HISTORY_DATABASE_PATH=.data/history/base-sepolia.sqlite
KEEPER_ATTEMPT_DATABASE_PATH=.data/history/base-sepolia-keeper-attempts.sqlite
KEEPER_ATTEMPT_MAXIMUM_AGE_SECONDS=900
HISTORY_HOST=127.0.0.1
HISTORY_PORT=8787
HISTORY_INDEX_URL=http://127.0.0.1:8787
HISTORY_READ_API_TOKEN=paste-generated-read-credential-here
HISTORY_INGEST_API_TOKEN=paste-generated-ingestion-credential-here
HISTORY_POLL_SECONDS=15
HISTORY_BATCH_BLOCKS=2000
HISTORY_CONFIRMATION_BLOCKS=2
HISTORY_REORG_OVERLAP_BLOCKS=64
HISTORY_RPC_CONCURRENCY=4
HISTORY_RETRY_MAXIMUM_ATTEMPTS=5
HISTORY_RETRY_BASE_DELAY_MILLISECONDS=250
HISTORY_MAXIMUM_PAGE_SIZE=100
HISTORY_CURSOR_SNAPSHOT_RETENTION=10000
UNISWAP_V4_SUBGRAPH_URL=https://your-base-sepolia-v4-subgraph.example/graphql
UNISWAP_V4_SUBGRAPH_BEARER_TOKEN=
UNISWAP_V4_SUBGRAPH_TIMEOUT_MILLISECONDS=10000
UNISWAP_V4_SUBGRAPH_CACHE_SECONDS=60
```

The four `UNISWAP_V4_SUBGRAPH_*` values are optional. Configure them only with a working Base
Sepolia deployment of the official Uniswap v4 subgraph schema. The checked repository does not
hard-code a provider endpoint because Uniswap publishes the network source configuration
separately from any provider-specific deployment URL. A The Graph gateway API key authenticates
queries; it does not deploy a subgraph or cause an Indexer to allocate to an unindexed deployment.
Do not set the bearer token by itself: startup rejects a credential without a working URL. A URL
must be HTTPS (loopback HTTP is accepted for tests), must not contain URL credentials, a query, or a
fragment, and may carry a provider API key in its path. If the provider supports bearer
authentication, keep the token in `UNISWAP_V4_SUBGRAPH_BEARER_TOKEN` in the root `.env`; it is
projected only into the history worker. The adapter caches one bounded response for
`UNISWAP_V4_SUBGRAPH_CACHE_SECONDS` and coalesces concurrent requests. Provider errors never remove
the chart: they select the canonical indexed-Swap source.

`HISTORY_BATCH_BLOCKS` must be greater than `HISTORY_REORG_OVERLAP_BLOCKS`; startup rejects an
equal or smaller batch before opening the worker. This ensures one atomic range replacement always
covers the full mutable tail plus at least one new block, so it cannot move a checkpoint backward
or replace the snapshot of an otherwise stable append-only cursor.

`HISTORY_RPC_URL` takes precedence when set; otherwise the worker uses `RPC_URL`, then
`BASE_SEPOLIA_RPC_URL`. `HISTORY_INDEX_URL` and `HISTORY_READ_API_TOKEN` are consumed by
`apps/api`, backend readiness, and `pnpm health:base-sepolia` for history GETs. The one-shot operator
uses `HISTORY_INDEX_URL` with `HISTORY_INGEST_API_TOKEN` only for server-to-server Keeper-attempt
POSTs. The two values must be independently generated and rotated: a read credential cannot ingest,
an ingestion credential cannot read, and the legacy shared `HISTORY_API_TOKEN` has no compatibility
fallback. Never rename either credential to a `NEXT_PUBLIC_` variable.

The database stores its chain, launch block, schema version, full manifest fingerprint, and the
active served-generation ID. Every successful database open rotates that ID before the HTTP
listener can start. Normal worker restarts, backup restores, and newly created databases are
therefore visible to in-memory consumers. A different manifest or chain fails at startup instead
of mixing histories.

Schema version 3 adds Fuel Core `Committed` history. A version 2 database cannot contain the older
commitments, so startup rejects it instead of pretending its coverage is complete. Preserve it as
a backup and follow the reset procedure below to rebuild from launch.

## Local backfill and steady state

Run the one-shot launch-to-confirmed-tip backfill:

```bash
pnpm history:backfill
```

The command resumes a valid existing checkpoint and exits after reaching the confirmed target. It
may split configured batches when an RPC rejects a range. Finite exponential retries handle
timeouts and throttling; a range commits only after all eight canonical event reads and retained
headers succeed. Every batch also pins and rechecks its terminal canonical block before and after
the source reads and after commit, so a chain change during a batch fails and is replayed instead
of mixing branches.

Start the long-running worker and query API:

```bash
pnpm history:worker
```

In a second terminal, start the VM public API:

```bash
pnpm api:serve
```

In a third terminal, start the web application:

```bash
pnpm dev
```

Only after the worker reports ready, run the Base Sepolia health check in another terminal:

```bash
curl --fail-with-body --header 'Authorization: Bearer <token>' http://127.0.0.1:8787/readyz

pnpm health:base-sepolia
```

Keep `pnpm history:worker` running for the entire health command. The health reader does not fall
back to direct RPC event scans when indexed history or keeper-attempt evidence is unavailable.

Starting the frontend never starts the public API, history worker, or signing operator. A stopped indexer is
therefore visible as indexed-history unavailable/partial rather than hidden by browser scans.
The worker does not open its HTTP listener until its first synchronization succeeds. Retryable RPC
or temporary canonicality failures retry with finite backoff; wrong-chain, configuration, decode,
persistence, and deep-reorg failures terminate so the process supervisor can alert and restart
only after the cause is corrected.

## Inspect status and pages

`HISTORY_READ_API_TOKEN` is required; include `Authorization: Bearer <read-token>` on every read.
The read
credential belongs only on the worker, public API, backend readiness, and health tooling. The
operator receives only `HISTORY_INGEST_API_TOKEN`; neither credential reaches browser JavaScript.

Both credentials must be distinct canonical unpadded base64url encodings of 32 to 384 random bytes
(43 to 512 encoded characters); startup also rejects repeated-byte material. Rotate the read token by
updating and restarting the worker and read consumers together; rotate the ingestion token by
stopping the operator, updating and restarting the worker and operator together, then draining the
durable outbox. Never place either token in a URL, command-line argument, browser environment, or
log. The operator accepts only the exact root `http://127.0.0.1:<port>` URL before attaching its
ingestion credential, preventing forwarding to another host or path.

Each list response includes:

- `snapshot.generation`, `snapshot.canonicalRevision`, and its checkpoint block/hash;
- `requested.fromBlock` and `requested.toBlock`;
- `coverage.fromBlock`, `indexedThroughBlock`, and `indexedThroughTime`;
- `head.observedBlock` and `lagBlocks`;
- `state: complete | partial | error`;
- stable `hasMore` and `nextCursor` pagination.

The first page pins its checkpoint, observed head, and canonical revision. Every continuation cursor
is also bound to the database generation, exact snapshot, and query. New append-only batches do not
change an in-progress page walk. A canonical rewind or database replacement invalidates old
cursors explicitly; restart pagination from the first page instead of combining facts from two
branches. Snapshot metadata is bounded to the latest
`HISTORY_CURSOR_SNAPSHOT_RETENTION` committed checkpoints (10,000 by default, about 42 hours at a
15-second poll). A cursor older than that retention is rejected explicitly with the same restart
instruction; snapshot rows do not grow without bound.

Available routes are `/v1/market/candles`, `/v1/market/swaps`, `/v1/market/fees`,
`/v1/protocol/liquidity-cycles`, `/v1/protocol/permanent-commitments`,
`/v1/protocol/rewards`, `/v1/protocol/operations`, and the non-paginated
`/v1/protocol/keeper-attempts`. List routes accept `fromBlock`, `toBlock`, `limit`, `cursor`, and
`order=asc|desc`.

The keeper-attempt response identifies its served generation, freshness window, coverage, and exact
state for all four Reward Tracks. `fresh`, `retryable`, and `unknown` are evidence states, not
guesses. A dry-run simulation proves only that preflight passed; because it submitted nothing, its
execution outcome remains unresolved. Missing, stale, incomplete, simulated, pending, reorged,
malformed, or RPC-unreconciled evidence is reported as unknown. Safe failure classes and transaction hashes may be public; raw RPC errors,
revert payloads, headers, credentials, and private keys are never stored in or returned from this
boundary. The authenticated `/internal/v1/keeper-attempts` write route has no mapping in the
VM-owned public API.

Operator ingestion accepts only pre-submission milestones and submitted hashes. It cannot assert a
success, revert, reorg, or receipt; only the non-signing worker can derive those outcomes by
comparing the RPC receipt with the canonical block header. The public projection omits operator
run/attempt identifiers. Its freshness exposes chain `observedAt`, server `recordedAt`, and an age
computed conservatively from whichever timestamp is older, so delayed delivery cannot make old
chain evidence look current.

The worker rechecks every pending or reorged hash and every receipt still inside
`HISTORY_CONFIRMATION_BLOCKS`. Once a successful or reverted receipt crosses that same canonical
confirmation boundary, it is final for this read model and no longer consumes an RPC request on
every poll. This keeps reconciliation bounded as the journal grows without weakening the indexer's
documented finality policy. Each poll reconciles at most 100 eligible receipts with the configured
`HISTORY_RPC_CONCURRENCY`; unresolved rows rotate by their last reconciliation time instead of
starving newer submissions.

## Dashboard series semantics

The Market reads `${NEXT_PUBLIC_API_URL}/v1/history/status` on entry, after a stale tab regains
focus or reconnects, and when the user explicitly retries. It never polls while the page is idle.
The independent history worker refreshes only its mutable 10,000-block tail. The browser does not
depend on the direct-RPC health event window and never runs `eth_getLogs`.

Any failed status or page read invalidates every in-memory market-history cache. Every logical
market read requires one database generation and canonical revision across status, swaps, fees,
liquidity cycles, and a final status check. A changed lineage restarts at the manifest launch
block. Checkpoints must never move backward during the read, and equal-height checkpoints must
retain the same hash. An index restart, restore, rebuild, or deep-reorg recovery therefore cannot
combine stale facts with new canonical history.

The dashboard retains and explicitly labels previously verified observations stale only when the
worker reports the typed `history-rpc-unavailable` state. A canonicality failure, malformed or
mixed snapshot, stopped/unreachable worker, proxy failure, or unknown error hides the charts and
fails closed. Stale POL observations never receive a projection from a newer live queue.

Connected wallet reads use the durable `Committed` facts only to enumerate the bounded permanent
identity candidate set. The protocol reader pins balances and collectible checks to the index
checkpoint, then verifies current `ownerOf` and permanence directly onchain. A fresh browser never
reconstructs ownership with launch-to-tip `eth_getLogs` scans.

Protocol-Owned Liquidity growth uses every ordered `ProtocolLiquidityAdded` fact from launch. Each
actual observation retains its cycle number, block time, consumed WETH, remaining queue, tick
range, raw liquidity units, and cumulative permanently locked WETH. The optional dashed endpoint
is a projection of the current live locked balance plus queued WETH; it is not another completed
cycle.

Canonical Market candles use one-minute UTC intervals from the canonical PoolManager `Swap` events.
Only minutes containing real swaps are emitted; the chart does not invent carried-forward prices or
render hundreds of empty buckets around sparse testnet activity. When an optional Uniswap v4
subgraph feed is configured and healthy, its hourly `PoolHourData` supplies OHLC and its `Swap`
entities prove the swap count. (`PoolHourData.txCount` is deliberately not used because it also
counts pool-liquidity events.) The adapter verifies the manifest Pool ID and both currencies,
normalizes Uniswap's token0-per-token1 OHLC into WETH per Liquid Token without floating-point
arithmetic, and discards a possibly truncated oldest raw-Swap hour. The browser receives neither the
subgraph URL nor its credential. If this feed is unconfigured, unavailable, malformed, or points at
a different pool, the reader uses the canonical Swap events in SQLite.

In both source modes, price is normalized to WETH per Liquid Token from the manifest's checked
currency ordering and the protocol's sealed token decimals. The source-specific accounting is:

- in canonical-event mode, open, high, low, and close are the first, maximum, minimum, and last
  ordered post-swap `sqrtPriceX96` prices in each traded minute. Gross volume and protocol fee come
  only from the same ordinal `FeeAccrued` event in the same transaction. `FeeAccrued` precedes
  `Swap` when WETH is the specified leg and follows it when WETH is the unspecified leg; unequal
  per-transaction event counts are reported as partial instead of guessed;
- in official-feed mode, `PoolHourData` supplies OHLC while gross volume and protocol fee remain
  exact sums of this hook's locally indexed `FeeAccrued` events in the same UTC hour. The raw
  subgraph `Swap` count is compared with the local fee-event count; any mismatch marks that hour
  and the aggregate matching state partial;
- the PoolManager dynamic-fee field is not treated as the Canonical Fee Hook's 3% protocol fee;
- no-trade intervals are omitted and no price is carried forward;
- unmatched swaps or fees mark volume as partial rather than silently estimating it.

Both charts expose exact tables. The public completeness label and indexed-through block/time come
from the index status. A partial index may still show confirmed observations, but it is never
presented as complete.

## Reorg behavior

Before every update, the worker compares the persisted checkpoint hash with the RPC's canonical
block at that number. A matching checkpoint still replays the configured mutable overlap so a
recent replacement or removed log is corrected idempotently.

On a mismatch, the worker walks retained headers backward, finds the highest common ancestor,
atomically deletes later facts, rewinds, and replays. If the reorg is deeper than retained history,
the process exits with `DeepReorgError`; it does not serve the stale tail as complete or guess an
ancestor. Readiness and list routes fail immediately after the mismatch is observed, before any
potentially slow ancestor lookup begins, so a known orphaned tail is never served during recovery.

If a canonicality or retryable RPC failure is detected after any commit, readiness and every list
route fail closed until a later synchronization succeeds. The HTTP service never serves the last
known page as if it were ready while the worker is waiting to retry.

If the RPC's confirmed target falls behind the persisted checkpoint, the worker also fails closed
without deleting facts or changing the canonical revision. This can happen during an RPC head
regression or after increasing the confirmation setting. Existing cursors remain intact, and
indexing resumes only after the confirmed target catches up. Public error messages are fixed and
sanitized; provider diagnostics and credential-bearing RPC URLs are never returned by the API.

## Backup and restore

SQLite WAL state consists of the database plus its `-wal` and `-shm` companions. Never copy only
the main file while the worker is live.

For this POC, use a stopped backup:

1. Stop `pnpm history:worker` with `Ctrl-C` or `SIGTERM` and wait for exit.
2. Resolve and verify the exact `HISTORY_DATABASE_PATH` and `KEEPER_ATTEMPT_DATABASE_PATH`, plus a
   separate backup destination.
3. Copy only those two database files and any existing same-name `-wal` and `-shm` companions into
   the backup destination. Do not archive the containing directory unless it is a verified
   dedicated history volume.
4. Restart the worker and verify `/readyz`, manifest fingerprint, checkpoint, and lag.

Restore only a backup whose manifest fingerprint and chain match the checked deployment. Keep the
pre-restore directory until a fresh sync and integrity check have succeeded. The backup contains
its old served-generation ID, but the first successful worker open replaces it before serving any
request, so consumers cannot confuse restored pages with their earlier cache lineage.

## Reset and deep-reorg recovery

Reset is an explicit recoverable operation:

1. Stop the worker.
2. Resolve and verify the exact `HISTORY_DATABASE_PATH`; never target the repository root, home
   directory, a parent directory, or an unresolved variable. Create and verify a separate ignored
   `.scratch/` backup directory.
3. Move only the resolved database file and any existing same-name `-wal` and `-shm` companions
   into that backup directory. Do not move the containing directory unless it is a verified
   dedicated history volume, and do not delete the backup.
4. Run `pnpm history:backfill` and wait for the one-shot process to exit successfully.
5. Start `pnpm history:worker`; the one-shot backfill intentionally has no HTTP listener.
6. Inspect `/readyz` and `/v1/status`, then leave the worker running. Retain the backup until the
   rebuilt index is complete and its manifest, checkpoint, and lag are verified.

The rebuilt database has a new generation ID. Consumers clear any retained lineage and rescan from
the manifest launch block even if the rebuilt checkpoint and canonical revision happen to equal the
old database.

Resetting event history does not require resetting keeper attempts. Reset the exact
`KEEPER_ATTEMPT_DATABASE_PATH` only for a manifest/schema mismatch or failed integrity check, and
preserve a stopped backup first. Its first reopened generation is intentionally different. A lost
attempt journal is shown as unavailable until a new complete operator cycle; balances or successful
events are never used to fabricate the missing failures.

Use the same procedure for a deep reorg, failed integrity check, incompatible schema migration, or
operator-approved full rebuild. RPC rotation normally requires no reset.

## Deployment

Run one worker container/process beside a persistent local volume. Pin Node 24.15.0 or a reviewed
newer 24.x patch, use a restart policy, send `SIGTERM` with enough grace for the active synchronous
transaction to complete or roll back, and keep the worker private behind the loopback-only
VM public API. Expose the public API's `/healthz` for liveness and `/readyz` for aggregate readiness.

Run it as a dedicated `orbit-history` user or container with an owner-only `0600`
`/etc/orbit/history.env` and a history-owned persistent volume. Install only the history variables
shown above. The account and container must have no operator, funding-signer, or deployer private
key and no read access to their environment files or volumes. Do not leave the combined root `.env`
on a deployed runtime host. See [Runtime environment isolation](runtime-environments.md).

Base mainnet must use a separately reviewed mainnet manifest and a new empty database. Never point
a mainnet worker at the Base Sepolia SQLite file.

## Monitoring and alerts

Alert on:

- liveness or readiness failure;
- growing `lagBlocks` or a stale `indexedThroughTime`;
- repeated RPC retry exhaustion or adaptive splitting down to a failing single block;
- `DeepReorgError`, decode failure, manifest mismatch, or SQLite integrity/journal failure;
- disk pressure, failed stopped backups, or unexpected WAL growth;
- more than one writer replica.

An empty event page with `state=complete` is valid. An empty page with `state=partial` or `error`
requires investigation and must never be presented as complete history.
