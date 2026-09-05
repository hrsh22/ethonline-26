# Base Sepolia reward and liquidity automation

ORBIT's contracts accrue fees automatically during Canonical Market swaps, but they do not wake
themselves up. Ethereum contracts execute only inside transactions. The keeper must therefore open
an eligible Reward Epoch and execute its Reward Tracks, while the liquidity executor must submit
each WETH-only Protocol-Owned Liquidity cycle.

The checked Base Sepolia deployment assigns both roles to one funded development account. The
one-shot Effect runner at `scripts/base-sepolia-operator.ts` automates one bounded pass. The web
application and operator have separate lifecycles: `pnpm dev` starts only the web application, while
an explicitly started `pnpm operator:watch` process invokes the bounded runner on a configurable
interval.

## Reward cadence

Neither QUOTRONS nor ORBIT distributes on a fixed hourly or daily timer:

| Protocol   | Epoch threshold | Per-epoch cap | Minimum interval | Tracks | Actual cadence                      |
| ---------- | --------------: | ------------: | ---------------: | -----: | ----------------------------------- |
| QUOTRONS   |        0.1 WETH |      100 WETH |       60 seconds |     10 | Trading-volume and keeper dependent |
| ORBIT 4444 |       0.04 WETH |       40 WETH |       60 seconds |      4 | Trading-volume and keeper dependent |

ORBIT's threshold is lower because `0.04 WETH / 4` preserves the same `0.01 WETH` minimum share
per track as QUOTRONS' `0.1 WETH / 10`. The interval is only a lower safety bound; an epoch also
needs enough accumulated reward fees and an authorized transaction. The live Base Sepolia evidence
currently records three manually initiated Reward Epochs.

Opening an epoch moves WETH into four isolated queues. Executing a track converts at most 10 WETH,
notifies the Reward Ledger once, and updates reward-per-weight accounting in constant time. It does
not loop over or push tokens to every NFT. Each current NFT owner later pulls the already-accounted
stock-token reward with `claim`; the owner pays that claim's gas.

## What one operator run does

1. Load the Base Sepolia RPC, manifest, and operator policy through the operator's exact runtime
   allowlist (the ignored root `.env` is only a local source).
2. Verify chain `84532`, then build the initial operator state snapshot from one exact block number,
   hash, and timestamp. Pin every state and sealed-track-route read to that number, fetch the same
   header again after the batch, and accept the snapshot only if its complete identity is unchanged.
   A missing header, malformed header, partial read, lagging receipt floor, or same-height reorg
   discards the whole snapshot and retries boundedly from a newly fetched identity. Read the current
   Keeper and liquidity-executor roles from the accepted snapshot and require each configured
   execute-mode account to match its corresponding live role.
3. Open one Reward Epoch if the 0.04 WETH threshold and 60-second interval both pass.
4. After a confirmed epoch, refresh the pinned state snapshot, then handle one bounded chunk for
   each nonempty track. Refresh again after every confirmed track before handling the next action.
5. Pin both `WETH → USDC` and `USDC → stock` quote legs to the planning snapshot's exact identity,
   revalidate that identity after quoting, and apply the configured minimum-output basis points.
   Fetch a separate canonical preflight identity, never older than planning, immediately before
   simulating `executeTrack` at that block. The same call clears a new queue or retries a deferred
   one. Revalidate the planning/quote identity after preflight acquisition and again after
   simulation so an intervening reorg abandons the request before signing.
6. Combine the vault queue and liquidity fee pot, then plan at most one meaningful WETH-only
   Protocol-Owned Liquidity cycle. The planner skips below the configured minimum, selects a target
   bounded by the hard maximum, and derives the greatest safe liquidity for the current tick,
   spacing, and currency ordering. It uses the audited Uniswap v4 TickMath/SqrtPriceMath equations
   and a bounded 127-step binary search. Target underfill may be no larger than the irreducible step
   to the next integer liquidity unit; that next unit must exceed the budget. The resulting call is
   simulated at a separately recorded canonical preflight block, and signing is rejected if actual
   WETH consumption is dust, over budget, or differs at all from the audited calculation. Refresh
   the pinned state snapshot after a confirmed cycle.
7. Persist `preparing`, safe preflight failure, and completed-cycle milestones through the
   authenticated history-worker journal. Prepare and sign locally, then persist the signed
   transaction and its deterministic hash to a local SQLite outbox before any broadcast. The history worker independently
   reconciles submitted hashes to canonical success, revert, pending, reorg, and recovery states.
8. Take one final pinned state snapshot before recording run completion or assembling evidence. Its
   observed block must be at least the block of every confirmed receipt in the run. Then write a
   local debugging snapshot to `.scratch/base-sepolia-operator.json` by default. This file is not
   the dashboard's authoritative attempt source.

Each operator state snapshot reports one block number, hash, and timestamp. All fields are read at
that number, and the post-batch header must still match all three values. Every confirmed write is
followed by a fresh snapshot before the runner continues. If the RPC cannot provide a canonical
final snapshot at least as recent as every confirmed receipt, the run fails instead of completing
with or replacing local evidence with stale final state.

Every candidate transaction records its planning identity and a separate preflight identity. Reward
Track actions also record their quote identity. Preflight cannot regress behind planning. Simulation
is pinned to preflight; planning/quote and preflight canonical identities are checked again
immediately afterward, with preflight checked last, and only that exact simulated request may cross
the signing boundary. A changed role, sealed route, eligibility decision, quote protection, or call
request abandons the action before signing and requires a fresh plan. One run performs at most one
epoch, one chunk per Reward Track, and one liquidity cycle. A queue above its 10 WETH per-call cap is
completed by later scheduled runs. Contract deadlines and minimum outputs continue protecting the
unavoidable interval after preflight.

## Configure and test locally

Generate and export the ingestion credential in the shell that will run the operator. The `printf`
output is the literal line to paste into the ignored root `.env`; do not paste the shell expression
itself into the file:

```bash
export HISTORY_INGEST_API_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
printf 'HISTORY_INGEST_API_TOKEN=%s\n' "$HISTORY_INGEST_API_TOKEN"
```

Put the printed credential and these values in the ignored root `.env`; do not place a funded key
in a checked file or CI log:

```dotenv
BASE_SEPOLIA_RPC_URL=https://your-provider.example
HISTORY_INDEX_URL=http://127.0.0.1:8787
HISTORY_INGEST_API_TOKEN=paste-generated-ingestion-credential-here
KEEPER_ATTEMPT_OUTBOX_PATH=.data/operator/base-sepolia-keeper-attempt-outbox.sqlite
OPERATOR_PRIVATE_KEY=your-funded-development-operator-key
# For split roles, leave OPERATOR_PRIVATE_KEY blank and set both values below instead.
OPERATOR_KEEPER_PRIVATE_KEY=
OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY=
OPERATOR_EVIDENCE_PATH=.scratch/base-sepolia-operator.json
OPERATOR_MINIMUM_OUTPUT_BPS=9900
OPERATOR_INTERVAL_SECONDS=300
OPERATOR_POL_MINIMUM_QUEUE_WETH=0.005
OPERATOR_POL_TARGET_WETH_PER_CYCLE=0.025
OPERATOR_POL_MAXIMUM_WETH_PER_CYCLE=0.05
OPERATOR_POL_STALE_QUEUE_SECONDS=900
OPERATOR_EXECUTE=false
```

Start `pnpm history:worker` before invoking the operator. The operator fails closed before signing
when its initial journal milestone cannot be authenticated or persisted. Submitted hashes are sent
immediately with bounded at-least-once retries; repeated lifecycle deliveries are idempotent. A
journal acknowledgement marks only delivery, not a canonical transaction outcome. The local row
therefore remains an unresolved signing gate after acknowledgement. If journal delivery fails,
broadcast is not attempted and the bounded run aborts without recording completion. Before a later process can observe
eligibility or sign, it replays undelivered rows and reconciles every unresolved hash against an
exact receipt, its canonical block header, and the two-confirmation floor. Pending, missing,
malformed, reorged, or otherwise uncertain outcomes keep the whole run gated; only canonical
success or revert releases the exact row, after which eligibility is observed afresh. The outbox is
bound to the deployment fingerprint. Version 4 also retains signed transaction bytes, including
their nonce, in the owner-only `0600` database. Keep this file private: a signed transaction can be
broadcast by anyone holding it. No private key, RPC credential, provider object, or raw revert
payload is stored. With current live authority, recovery may rebroadcast these exact bytes when
the receipt is unavailable; it never creates a replacement transaction. Dry-run and stopped policy
do not rebroadcast. Old hash-only rows remain gated until canonical resolution.

Discovery maintenance uses the same local signing and recovery gate. Its signed transactions stay
local and do not invent new public Keeper action kinds. An uncertain discovery submission blocks
later Reward Epoch, Reward Track, and Protocol-Owned Liquidity signing too.

The default liquidity policy waits until at least `0.005 WETH` is available, aims to consume
`0.025 WETH` per cycle, and never selects more than `0.05 WETH`. These are public operating-policy
values, not secrets. At the audited `0.0519697581 WETH` queue, two meaningful cycles are currently
executable; the remaining approximately `0.0019697581 WETH` waits for future fees to reach the
minimum instead of creating another dust position.

The root staging command loads this file and forwards `BASE_SEPOLIA_RPC_URL` to the web application.
Do not create `apps/web/.env.local` or another `apps/web/.env*` file: the guarded launcher rejects
them before startup and prevents development hot reload from reading one created later. It starts
no Keeper or liquidity-executor process:

```bash
pnpm dev
```

Browser reads make that RPC URL visible to clients, so use a dedicated read endpoint rather than an
admin-only URL. The web launcher strips every `*_PRIVATE_KEY` binding from the child environment.
Operator interval, execute mode, and signing settings are irrelevant to `pnpm dev`.

Run one safe bounded preflight independently:

```bash
pnpm operator:base-sepolia
```

Inspect `.scratch/base-sepolia-operator.json`. Eligible actions must say `simulated`; clear or
undersized work says `not-eligible`; any eligible quote or preflight problem says `failed` and makes
the command exit unsuccessfully. The Protocol-Owned Liquidity action includes its available queue,
selected budget, derived liquidity, expected and simulated consumption, remainder, cycle estimate,
tick range, and any skip reason. The command summary identifies the final observation number;
evidence records its exact number, hash, and timestamp plus every action's planning, quote when
applicable, and preflight identities. Dry-run mode performs all canonical checks, simulations,
and the final refresh, but never submits a transaction or performs an onchain write, even when a
key is set.

With `OPERATOR_EXECUTE=false`, every eligible action is only simulated. Set it to `true` in the
ignored root `.env` only when an explicitly invoked one-shot or watch process should submit eligible
Base Sepolia transactions. Each signer must have Base Sepolia ETH for gas. With split identities,
each signer must match its corresponding current onchain role; with a shared identity, that one
account must currently hold both roles.
When `OPERATOR_CONTROL_DATABASE_PATH` is configured, start the watch and use an authorized control
command instead. A direct execute-mode child without a supervisor-issued grant is refused, and
every watch restart begins stopped. See [Operator control plane](operator-control-plane.md).

For the explicitly self-funded staging profile, `pnpm backend` reuses `DEPLOYER_PRIVATE_KEY` only
when execute mode is live and no operator-specific key is configured. That fallback is projected
only into the operator child and is disabled outside `DEPLOYMENT_ENVIRONMENT=staging`; the API,
history, funding, replenisher, web, and supervisor environments never receive it. Configure the
dedicated variables above for any deployment that separates operational duties.

Start recurring local checks explicitly:

```bash
pnpm operator:watch
```

The watch prints `DRY-RUN` or a prominent `EXECUTE` warning at startup, runs one pass immediately,
and waits until that pass finishes before starting its interval. Runs within that watch process
therefore never overlap. A failed bounded pass is reported and retried after the interval. `Ctrl-C`
or `SIGTERM` interrupts and terminates an in-flight child before the watch exits. Run exactly one
watch for a deployment, and configure any process manager with a single replica.

Confirmed transaction hashes remain in the local evidence file, while the durable journal retains
the submitted hash and canonical receipt outcome across worker and web restarts.

## Run it outside local development

A five-minute interval is sufficient for this proof of concept: it is comfortably above the
contract's 60-second lower bound, while actual work remains threshold-driven. Local development can
use the explicit watch above. A deployed application must not own the scheduler lifecycle; invoke
the same one-shot command from a managed scheduler or cron:

```cron
*/5 * * * * cd /absolute/path/to/base-quotron && /absolute/path/to/pnpm operator:base-sepolia >> .scratch/operator.log 2>&1
```

Use absolute executable and repository paths because cron has a minimal environment. Prefer a
systemd timer or scheduler that runs as a dedicated `orbit-operator` user/container and injects an
owner-only `0600` `/etc/orbit/operator.env`; do not give that identity another service's file.
Protect the repository and operator state permissions, keep enough testnet ETH for gas, and alert on a nonzero exit, a
stale evidence timestamp, or
`observedState.protocolOwnedLiquidity.eligibleQueueStale = true`. The same object exposes
`eligibleQueueAgeSeconds` and `estimatedCyclesRemaining`. Queue age means time since this evidence
path first observed one continuously eligible queue; it resets when the queue falls below the
minimum or the evidence file is removed, so a managed deployment must persist that file. The
default stale threshold is 900 seconds. Persist the exact `KEEPER_ATTEMPT_OUTBOX_PATH` on the same
single-writer operator volume. Losing it while any submitted row is unresolved removes the local
no-resubmission gate even when the history journal already acknowledged delivery. When upgrading a
pre-v3 outbox, verify the history journal has no previously acknowledged unresolved submission;
rows deleted by the older acknowledgement behavior cannot be reconstructed from that SQLite file.
A managed scheduler/container can run the same command with
its key in a secret manager; it does not need application-server uptime. Disable concurrent
invocations (for example, set the scheduler concurrency policy to `Forbid`) so separate one-shot
processes cannot submit the same eligible action or write the same evidence file at once.

The operator runtime must contain only its dedicated shared `OPERATOR_PRIVATE_KEY`, or both
`OPERATOR_KEEPER_PRIVATE_KEY` and `OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY` for split roles—never
`DEPLOYER_PRIVATE_KEY`.
Remove the deployer key and the combined deployment environment from the runtime host after the
checked manifest and runtime roles are verified. See
[Runtime environment isolation](runtime-environments.md).

For production, use a dedicated least-privilege operator rather than the owner/deployer key. An
onchain coordinator backed by [Chainlink Automation](https://docs.chain.link/chainlink-automation/overview/automation-release-notes)
is a future option—Automation supports Base Sepolia—but it needs a separately reviewed coordinator,
quote policy, funding model, and onchain keeper/executor role transition. Those irreversible role
and scheduler changes are intentionally outside this Base Sepolia increment.

## Pool observability

The Exchange dashboard reads the exact Canonical Pool ID, price, active Uniswap liquidity, three
fee queues, completed `ProtocolLiquidityAdded` observations, and cumulative permanently locked WETH.
Its dashed last point adds the WETH already queued in the vault and liquidity fee pot, while the
exact values remain available as a table.

DEX Screener does not currently index this custom Uniswap v4 pool on Base Sepolia. The dashboard
therefore links to the official Base Sepolia PoolManager on BaseScan and displays the Pool ID needed
to identify the exact pool rather than offering a misleading mainnet chart link.
