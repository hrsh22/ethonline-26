# Base Sepolia self-service test funding

The public `/start` route can request bounded valueless test WETH and Base Sepolia ETH from a
separate inventory-only worker. The worker is an independent Effect TypeScript process. `pnpm dev`
starts only the web application and never starts, supervises, or restarts this signer.

This service is for Base Sepolia proof-of-concept use only. It is not a faucet for assets with
value and is not suitable for mainnet.

## Security boundary and threat model

The funding signer may only transfer assets already in its wallet. It must not be the deployer,
owner, guardian, recovery signer, keeper, liquidity executor, creator, WETH operator, USDC
operator, or any other protocol authority. Startup reads the checked `deployments/84532.json`,
checks every manifest role, resolves the sender of the first recorded deployment transaction,
verifies the signer is an externally owned account, reads both token operators, and refuses to
listen if any privileged binding matches.

The old deployer-powered `fund:user:base-sepolia` path was removed. Public requests cannot mint
WETH, choose an amount, or obtain the signing key. The web application knows only the loopback
worker URL and an independent bearer token.

### Wallet-control proof

A funding request must carry proof that the caller controls the recipient wallet. The collector
requests a challenge from `GET /v1/funding/challenge?recipient=…`, signs it, and submits the
signature with the request. The challenge is a SIWE message bound to the configured domain, the
chain, the exact recipient, the funding purpose, a single-use nonce, and a five-minute expiry.
Deployment-bound fields are checked before any signature work, and the nonce is consumed
atomically, so a tampered or replayed proof is rejected deterministically.

`TESTNET_FUNDING_PROOF_DOMAIN` sets the domain a proof is valid for; it falls back to the host of
`NEXT_PUBLIC_APP_URL`. An enabled service refuses to start without one, because a proof that is not
bound to a domain can be replayed from another site. A disabled service issues no challenges and
needs no binding.

### What counts as delivered

A grant is delivered when its transfers confirm on Base Sepolia. The worker still reads the
recipient balance afterwards and reports `retainedTargets`, but it no longer decides the outcome
from it: an account that forwards what it receives -- an EIP-7702 delegate, a smart account with a
sweeping hook -- confirms every transfer and never gains a balance, which left those requests
executing forever while every retry blamed a healthy RPC. The reconciliation window still absorbs a
balance read lagging its own confirmed transfer, and reports `funding-confirming` while it does;
`funding-rpc-unavailable` now means only that the node could not be reached. A wallet that does not
retain a top-up still spends its cooldown, lifetime allowance, and the daily budget, because the
inventory really did leave.

### One request at a time, and how it clears

The signer serves one request at a time so a nonce cannot be double-spent. That
makes an unresolved request a gate on every wallet behind it, so any caller may
finish one: the transfers are already signed, and driving them is the same work
with the same bytes whoever asks. A request is settled from its own receipts,
completed when they all confirmed and failed when one reverted, and only a
transfer genuinely still in flight keeps the lock. A caller that arrives while
that is true is refused with `funding-busy`, which reaches the browser rather
than being masked as a general outage.

A signed transfer whose nonce is already behind the signer is treated as dead
rather than in flight. The node rejects it as `nonce too low` and no receipt
will ever exist, so reading it as pending parked its request forever and
refused every other wallet. Any nonce gap produces it: a crash between signing
and broadcast, a dropped mempool transaction, or a second process sharing the
signer. The request fails, the queue moves on, and the recipient's next attempt
is a fresh request with a current nonce. Never run two workers against one
signer key.

Leaving that resolution to the request's own recipient made the gate permanent:
a transfer that had confirmed hours earlier still read as `broadcast` in the
ledger because nothing ever looked, and every other wallet was refused with an
opaque error.

Every decision that moves inventory or refuses to is logged — funded, refused,
settled, and each per-recipient denial — because a faucet that answered with a
browser error and an empty terminal cannot be operated.

### Service-wide bounds

Per-recipient cooldowns and lifetime limits cannot stop one actor cycling fresh addresses, so the
service also enforces:

- a daily WETH/ETH budget and a daily grant count, accumulated per fixed 24-hour window;
- funding-specific per-client throttling, on top of the generic per-IP request limiter in the
  public API, which is far too permissive to bound funding on its own;
- an operator alert that reports depletion velocity as `normal`, `elevated`, or `critical` with a
  used-ratio, and never exposes the signer address, signer balance, or key material.

All of these are persisted in the funding ledger, so a restart does not hand an attacker a fresh
budget or a cleared throttle. The inventory-only signer and the protected reserve floor are
unchanged.

`pnpm funding:worker` starts a minimal launcher that reads the dedicated `.env.testnet-funding`, constructs
an allowlisted child environment, removes all other variables from its own environment, and starts
the signer worker without deployer, operator, recovery, or other privileged keys. The worker does
not load the shared root `.env`. `scripts/staging-web.ts` independently constructs an exact positive
allowlist of reviewed browser-public variables before starting Next.js.

Controls limit accidental and basic automated depletion:

- exact top-up targets of `0.1` test WETH and `0.01` Base Sepolia ETH;
- a 24-hour per-address cooldown and lifetime caps of `0.2` WETH and `0.02` ETH;
- finite inventory reserves of `0.1` WETH and `0.01` ETH that are never offered;
- one global signer request at a time, with a persistent lease and pending-request recovery;
- a two-minute post-confirmation reconciliation bound; a recipient that drains confirmed assets
  cannot keep the global request active indefinitely;
- a 2 KiB request limit, nonzero EVM address validation, loopback binding, and authenticated proxy;
- transfer simulation, explicit sequential nonces, durable raw signed transactions before
  broadcast, receipt checks, final balance checks, and idempotent retries.

Per-address limits and the recipient field do not stop a caller from nominating many addresses or
funding addresses it does not control. Keep inventory small, monitor depletion, and disable the
worker when it is not needed. The SQLite file contains signed raw transactions and is therefore
sensitive even though it does not contain the private key. The worker creates it with mode `0600`;
protect its parent directory, backups, and host access.

## Configure

Copy `.env.testnet-funding.example` to the ignored `.env.testnet-funding`, or supply the same
allowlisted variables through a dedicated process-manager environment:

```dotenv
RPC_URL=https://your-dedicated-base-sepolia-read-write-endpoint.example
TESTNET_FUNDING_ENABLED=false
TESTNET_FUNDING_SIGNER_ADDRESS=0xDedicatedInventoryOnlySigner
TESTNET_FUNDING_SIGNER_PRIVATE_KEY=dedicated-secret-key
TESTNET_FUNDING_API_TOKEN=at-least-32-random-characters
TESTNET_FUNDING_DATABASE_PATH=.data/testnet-funding.sqlite
TESTNET_FUNDING_HOST=127.0.0.1
TESTNET_FUNDING_PORT=8790
```

`RPC_URL` falls back to `BASE_SEPOLIA_RPC_URL`. Contract addresses and protocol roles are not
environment variables; they come from the schema-checked deployment manifest. The signer address
is duplicated beside its secret key so the persistent ledger remains bound to an explicit public
identity and key/address mismatches fail before startup.

Configure `TESTNET_FUNDING_SERVICE_URL` and the same `TESTNET_FUNDING_API_TOKEN` in the root
environment consumed by `apps/api`. The service URL and bearer token cross only the VM loopback
adapter; neither reaches the browser or Vercel. `TESTNET_FUNDING_ENV_PATH` may point the launcher at another dedicated file,
but that path itself is not passed to the signer process.

Generate the API token with a cryptographically secure password manager or secret manager. Do not
prefix the worker token, URL, signer key, or database path with `NEXT_PUBLIC_`.

On a deployed host, run the worker as a dedicated `orbit-funding` user or container and store these
values in owner-only `0600` `/etc/orbit/funding.env` (or an equivalently isolated secret-manager
binding). The funding identity must not be able to read API, history, operator, or deployer files.
Keep its database directory owner-only because the ledger contains signed raw transactions. Do not
deploy the combined root `.env`; remove `DEPLOYER_PRIVATE_KEY` from the host after deployment.
See [Runtime environment isolation](runtime-environments.md).

## Automatic replenishment

`pnpm funding:replenisher` is a separate bounded process that tops the funding
signer up when its inventory falls below a configured minimum. It is not part of
the worker, and that separation is the point: the worker is the one funding
component reachable from the internet, so giving it the ability to pull more
funds would turn a compromise of it into a compromise of whatever it pulls from.

- The treasury key lives only in the ignored `.env.testnet-funding-treasury`,
  projected through its own launcher allowlist. Nothing in that allowlist
  overlaps the funding signer's, and the replenisher owns no listener and
  answers no request.
- Startup binds the treasury address to its key and refuses a treasury that is a
  contract, matches any manifest role, deployment sender, or token operator, or
  is the funding signer itself. It never mints.
- Each top-up is a fixed configured amount, never one derived from a request,
  and is capped by a per-window ceiling persisted in its own SQLite ledger, so a
  restart loop cannot walk past the day's allowance. Transfers are persisted
  before broadcast and resumed rather than re-signed, and one transfer is in
  flight at a time.
- A reverted transfer stops counting against the window: its nonce was consumed
  but nothing moved.
- An exhausted treasury is reported every cycle, because it is the one outcome
  that needs a human.

`pnpm backend` supervises it alongside the other services. With no treasury
configured it logs that it is disabled and idles, because any child exit stops
the whole group.

`pnpm health:base-sepolia` fails when the faucet reports `inventory-empty` or a
critical depletion alert, and passes a deliberately disabled faucet. Before
this, an empty faucet was only discoverable by clicking it.

## Provision inventory

Provisioning and replenishment are controlled operator actions, not worker behavior:

1. Generate a new key dedicated only to funding inventory and record its public address.
2. Compare the address with every role and contract operator in `deployments/84532.json`.
3. Using a separately authorized test-asset operator, mint a deliberately small WETH inventory to
   the funding signer. Send a deliberately small amount of Base Sepolia ETH for recipient gas and
   the signer's transfer gas.
4. Start with `TESTNET_FUNDING_ENABLED=false` and run the worker. Confirm the disabled status
   through the VM public API endpoint.
5. Set the flag to `true`, restart, and confirm startup validation, finite available inventory, and
   zero unexpected historical metrics before exposing `/start`.

Never give the inventory key mint authority to avoid a replenishment step. Replenishment must be
reviewed separately, use a bounded amount, and leave the configured reserves intact. No live key
generation, role change, mint, ETH transfer, or replenishment is performed by repository tests.

## Run locally

Use separate terminals:

```bash
# Terminal 1: history worker required by aggregate API readiness
pnpm history:worker

# Terminal 2: signer worker
pnpm funding:worker

# Terminal 3: VM public API
pnpm api:serve

# Terminal 4: web only
pnpm dev
```

Then open `/start`, connect a fresh wallet, switch to Base Sepolia, request test assets, buy enough
FUEL to cross the next whole-unit Discovery Draw boundary, inspect Pending Discovery and the Grounded Craft in My
Fleet, and review the irreversible Launch dialog. On Base Sepolia the acquisition records only a
Pending Discovery. Chainlink VRF assigns and mints the Grounded Craft in a later verified callback,
so wallet simulation cannot reveal a token ID that the buyer can reject and retry.

## States and operational evidence

The browser-facing VM `GET /v1/funding/status?recipient=…` reports sanitized service
availability and the destination wallet's eligibility, fixed targets, cooldown, balances, and
remaining top-up. `POST /v1/funding/fund` reports only that wallet's pending or confirmed outcome
and confirmed totals. The VM binds the returned address to the request and never exposes signer
inventory, global counters, policy ledgers, internal request IDs, transaction hashes,
prepared/broadcast/retry command state, or raw worker errors. Those remain loopback operational
evidence. The `/start` UI still distinguishes disconnected, wrong-network,
unavailable/retryable, funding-pending, discovery-pending, Grounded Craft, and permanent Orbiter
states.

Alert on:

- worker startup failure or repeated `funding-unavailable` responses;
- nonzero or increasing failed/pending counts;
- inventory approaching its protected reserve;
- a request remaining pending longer than the ten-minute lease;
- a confirmed request that exhausts the two-minute final-balance reconciliation window;
- database backup or permission failures;
- any onchain role/operator change involving the funding address.

Back up the SQLite database and restore it together with the same chain ID and signer address.
Deleting it erases cooldown, lifetime, daily-budget, throttle, and nonce evidence and must be
treated as a security-sensitive policy reset, not routine recovery. The abuse-control tables are
additive, so an existing ledger opens unchanged after this upgrade.

## Emergency disable and rotation

For an immediate halt, `POST /v1/control/disable` on the token-authorized worker port. The flag is
persisted, so it takes effect without a restart and survives one; `POST /v1/control/enable` lifts
it. While halted, both funding and challenge issuance refuse with `funding-disabled`. This
complements `TESTNET_FUNDING_ENABLED=false`, which is read once at boot and still requires a
restart. The control port is never publicly routed - the public API proxies only funding status,
the challenge, and the funding request.

Disabled mode serves an honest disabled state without touching the RPC or signer. If the key may be compromised, disable the service,
move remaining inventory to a newly reviewed inventory-only signer, update the address/key pair,
and start with a new explicitly retained ledger. Do not reuse a database bound to another signer;
metadata validation rejects that mismatch.
