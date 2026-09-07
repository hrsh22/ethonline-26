# VM-owned public API

The public API is the only browser-facing backend process. It is a TypeScript/Effect application
under apps/api. It exposes a small versioned interface while the Historical Read Model and
testnet-funding signer remain authenticated loopback workers.

The web application calls the public data and funding routes directly. Exact, credential-free
same-origin Next.js route handlers relay only the authenticated admin interface so the app-origin
host-only session cookie can gate the console. Vercel does not store worker bearer tokens.

## Process topology

```text
Browser
  ├─ Base Sepolia RPC for current block-pinned reads and wallet transactions
  ├─ HTTPS public data and funding routes ─┐
  └─ same-origin admin relays ────────┤
                                      └─ VM public API process
                                           ├─ authenticated loopback history worker
                                           └─ authenticated loopback funding worker

Operator
  ├─ Base Sepolia transactions
  └─ authenticated loopback Keeper-attempt ingestion
```

The public API, history worker, funding worker, and operator are independent lifecycles. Starting
the web application starts none of them.

## Browser framing boundary

Every Next.js application page and same-origin admin relay response sends
`Content-Security-Policy: frame-ancestors 'none'` and the legacy
`X-Frame-Options: DENY` fallback. The catch-all web response policy also covers public and admin
pages, protected-route redirects, and authentication errors. A browser must therefore refuse to
embed the collector or operator interface in any parent frame, including a same-origin frame.
This prevents an attacker-controlled overlay from presenting wallet prompts, authenticated reads,
or admin controls as part of another page.

This is deliberately a framing-only CSP. It does not set `default-src`, `frame-src`, `connect-src`,
or another child-resource directive, so it does not constrain Privy's connection modal, wallet
popups, fonts, RPC requests, analytics, or Next.js assets. It also does not make public onchain
evidence confidential or replace the admin session, CSRF, live-role, contract-authorization, and
wallet-confirmation checks. The deployed CDN or reverse proxy must preserve both response headers.

## Public interface

The allowlist is exact. There is no wildcard proxy:

- GET /healthz
- GET /readyz
- GET /v1/history/status
- GET /v1/history/market/candles
- GET /v1/history/market/swaps
- GET /v1/history/market/fees
- GET /v1/history/protocol/liquidity-cycles
- GET /v1/history/protocol/permanent-commitments
- GET /v1/history/protocol/rewards
- GET /v1/funding/status, optionally with exactly one `?recipient=...`
- GET /v1/funding/challenge with exactly one `?recipient=...`
- POST /v1/funding/fund

Keeper-attempt ingestion, worker administration, operator controls, signing operations, and
unknown paths have no public mapping. The funding request accepts exactly recipient, the bounded
faucet or onboarding source, and the signed wallet-control proof obtained from the challenge
route. The API forwards the recipient and the proof -- the worker, not the gateway, verifies the
signature -- and removes source, which is a browser-side field the worker must never trust. A
successful challenge response carries only the challenge to sign; it is passed through after
schema validation rather than being forced into the collector-result shape.

Funding responses are not transparent worker proxies. The VM reads at most 16 KiB, decodes the
worker schema, requires any returned recipient to match the requested wallet, and constructs an
exact collector DTO. Status may include sanitized service availability, chain ID, fixed funding
targets, cooldown, configured lifetime caps and shared service limits (daily asset budgets,
grant count, and client request window), and that recipient's balances, remaining top-up, eligibility state, and next
eligible time. Fund responses contain only the recipient outcome and confirmed destination
totals. Signer inventory, global metrics, policy ledgers, internal request IDs, transaction hashes
and preparation/broadcast/retry state, unknown fields, and worker error messages never cross the
public boundary. Malformed, oversized, or recipient-mismatched responses fail closed as the same
fixed upstream-unavailable response. All public responses remain `no-store`.

A recipient-free funding-status request returns exactly `apiVersion` and that sanitized service
projection. Supplying one recipient adds recipient-specific eligibility after the API validates
the nonzero address, normalizes it to checksum form, and forwards only that canonical query.
Malformed or zero addresses and unknown, repeated, or additional query parameters are rejected
before the funding worker is called.

## Authenticated admin interface

The admin allowlist is also exact:

- POST /v1/admin/auth/challenge
- POST /v1/admin/auth/verify
- GET /v1/admin/auth/session
- POST /v1/admin/auth/logout
- POST /v1/admin/actions/authorize
- GET /v1/admin/diagnostics/operations
- GET /v1/admin/diagnostics/keeper-attempts
- GET /v1/admin/operator/state
- POST /v1/admin/operator/command

Challenge and verification requests, plus every state-changing request, require the exact
configured app Origin. State-changing requests also require the session's CSRF token. The API
parses and emits the host-only admin session cookie through its reviewed cookie policy, rechecks
live onchain authority for every read or action authorization, and exposes diagnostics to the
history worker only after that check succeeds. Every admin response is `private, no-store` and
varies on `Cookie` (and `Origin` when present). Session responses contain the address, role names,
deployment fingerprint, timestamps, CSRF token, and block evidence only; internal capability
flags are not serialized.

Protected history reads reject redirects, accept only an exact upstream `200`, and read at most
1 MiB of decoded JSON. The shared `@orbit/config/admin-history` decoder reconstructs the bounded
operations or Keeper-attempt envelope, discards unknown fields, and requires the upstream
manifest fingerprint to exactly equal the fingerprint in the freshly authorized session.
Redirects, non-200 responses, oversized or malformed JSON, and fingerprint drift all become the
same private `503 admin-authority-unavailable` response; no partial upstream body crosses the
admin boundary.

`PUBLIC_API_MAXIMUM_REQUEST_BODY_BYTES` remains the narrow limit for public funding, challenge,
and action-authorization bodies. Verification alone has a 20,480-byte ceiling so the maximum
message and ERC-1271 signature accepted by the shared request decoder can reach signature
verification. Logout and session reads accept no body.

## Local configuration

For combined local testing, the ignored root `.env` supplies the public process and its private
upstream credentials. The API launcher passes only the reviewed API variables; the API entry point
does not reload the combined file. Generate and export the read credential first. The `printf`
output is the literal line to paste into `.env`; do not paste the shell expression itself:

```bash
export HISTORY_READ_API_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
printf 'HISTORY_READ_API_TOKEN=%s\n' "$HISTORY_READ_API_TOKEN"
```

Then put the printed value in place of the literal placeholder:

```dotenv
HISTORY_INDEX_URL=http://127.0.0.1:8787
HISTORY_READ_API_TOKEN=paste-generated-read-credential-here
TESTNET_FUNDING_SERVICE_URL=http://127.0.0.1:8790
TESTNET_FUNDING_API_TOKEN=the-token-from-.env.testnet-funding

PUBLIC_API_HOST=127.0.0.1
PUBLIC_API_PORT=8800
PUBLIC_API_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PUBLIC_API_TRUST_PROXY=false
PUBLIC_API_UPSTREAM_TIMEOUT_MILLISECONDS=10000
PUBLIC_API_MAXIMUM_REQUEST_BODY_BYTES=2048
PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS=60
PUBLIC_API_RATE_LIMIT_MAXIMUM_REQUESTS=120
PUBLIC_API_RATE_LIMIT_MAXIMUM_CLIENTS=10000

ADMIN_AUTH_APP_ORIGIN=http://localhost:3000
ADMIN_AUTH_DATABASE_PATH=/var/lib/orbit/admin-auth/admin-auth.sqlite
ADMIN_AUTH_MANIFEST_PATH=deployments/84532.json
ADMIN_AUTH_RPC_URL=https://your-private-read-provider.example
ADMIN_AUTH_CHALLENGE_TTL_SECONDS=300
ADMIN_AUTH_SESSION_TTL_SECONDS=900

NEXT_PUBLIC_API_URL=http://127.0.0.1:8800
```

`HISTORY_READ_API_TOKEN` must be a canonical unpadded base64url encoding of 32 to 384 random bytes
(43 to 512 encoded characters). `TESTNET_FUNDING_API_TOKEN` must contain at least 32 characters. They are
server-only. The public API never receives `HISTORY_INGEST_API_TOKEN`. Never prefix any credential
with NEXT_PUBLIC_.

Only HTTPS origins are accepted outside local loopback development. Origins are exact; paths,
credentials, wildcards, queries, and fragments are rejected. Upstream worker URLs must be root
HTTP URLs on 127.0.0.1. The admin database must be an absolute `.sqlite` path beneath a dedicated,
non-symlinked directory; relative, root-level, and in-memory paths are rejected.

## Run locally

For local product and team testing, start the complete backend in one terminal and the web in a
second terminal:

```bash
# Terminal 1: history + funding + API + recurring operator
pnpm backend

# Terminal 2: web
pnpm dev
```

The combined backend waits for authenticated history readiness before starting operator watch,
so the operator's immediate first pass cannot race the history worker. `Ctrl-C` stops the entire
backend group. Starting `pnpm backend` in another terminal gracefully stops the existing supervisor
and its workers before the new supervisor starts them. This keeps the funding signer, history
writer, and operator watch single-replica. With `OPERATOR_EXECUTE=true`, the included operator will
sign eligible Base Sepolia transactions.

The four processes can still be run in separate terminals when debugging their individual
lifecycles: `pnpm history:worker`, `pnpm funding:worker`, `pnpm api:serve`, and
`pnpm operator:watch`, in that order.

The public API is ready when both checks succeed. `/readyz` returns `200` only
when indexed history is ready and the enabled funding worker has enough
post-reserve WETH and ETH inventory for at least one complete fresh-wallet
top-up; disabled, inventory-empty, malformed, and unreachable funding states
return `503` with the dependency state instead of a false-ready response.

```bash
curl --fail-with-body http://127.0.0.1:8800/healthz
curl --fail-with-body http://127.0.0.1:8800/readyz
```

The frontend opens at http://localhost:3000. A stopped API is visible as unavailable history,
funding, and admin authority; the browser never falls back to block-range scanning. The
same-origin admin relays are a fixed allowlist, not a wildcard proxy.

## VM deployment

Build once, then supervise each long-running process independently:

```bash
pnpm install --frozen-lockfile
NEXT_PUBLIC_APP_URL=https://orbit.example pnpm build
pnpm --filter @orbit/api start
pnpm history:worker
pnpm funding:worker
pnpm operator:watch
```

Use systemd, Docker Compose, or an equivalent process supervisor. Run one history writer, one
funding signer, one operator watcher, and one public API process. Persist the history, Keeper
attempt, operator outbox, funding ledger, and operator evidence paths described in their operation
guides. Do not deploy the combined root `.env`. Give the API its own `orbit-api` user or container
and owner-only `0600` `/etc/orbit/api.env` containing only the API variables above. The API account
must not be able to read history, funding, operator, or deployer secret files. Apply the equivalent
separation to every worker as described in
[Runtime environment isolation](runtime-environments.md).

`DEPLOYER_PRIVATE_KEY` is never an API runtime input. Remove it and any combined deployment
environment from the runtime host after the deployment manifest and runtime roles are verified.

The Node process intentionally binds only 127.0.0.1. Terminate TLS in a same-host reverse proxy.
A minimal Caddy shape is:

```caddyfile
api.example.com {
  reverse_proxy 127.0.0.1:8800 {
    header_up X-Forwarded-For {remote_host}
  }
}
```

Set PUBLIC_API_TRUST_PROXY=true only when that trusted loopback reverse proxy overwrites
X-Forwarded-For with the connecting client address. Do not bind port 8800 publicly. Restrict
inbound traffic to HTTPS and monitor 429, 502, 503, and 504 responses.

The application rate limiter is a bounded in-memory safety control that fails closed at capacity:
when a map is full of live windows, new client keys are refused for at most one window rather than
evicting an existing client's state -- eviction-on-full let a flood of fresh keys reset its own
budget on demand. Public, admin challenge, admin verification, authenticated
session-introspection, and protected admin traffic (including operator control) use independent
maps, so challenge floods cannot spend an established session's budget. Each map is keyed by the
trusted effective client address. A syntactically valid cookie selects the session/protected
class before any store lookup, so a single address can draw on each class's budget once; the
cookie never becomes a client key, so rotating client-supplied handles cannot
bypass limits or fill one map entry per fake handle. The funding worker's durable per-recipient
cooldown and any configured lifetime limits remain authoritative. A deployment may add edge rate-limiting, but
it must not weaken the worker policy.

## Vercel deployment

Vercel receives only browser-public configuration:

```dotenv
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://your-public-read-provider.example
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT=staging
```

Set PUBLIC_API_ALLOWED_ORIGINS on the VM to the exact deployed web origin. Add each preview origin
explicitly if previews need live API access; wildcard Vercel origins are intentionally unsupported.

Do not install HISTORY_READ_API_TOKEN, HISTORY_INGEST_API_TOKEN,
TESTNET_FUNDING_API_TOKEN, OPERATOR_PRIVATE_KEY, OPERATOR_KEEPER_PRIVATE_KEY,
OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or
TESTNET_FUNDING_SIGNER_PRIVATE_KEY in Vercel.

Next.js may still use Vercel compute to render a dynamic page such as a craft-detail route. That is
frontend rendering and is independent of the backend interface.

## Failure and rotation

Public routes preserve safe status codes returned by a worker, plus Retry-After, after applying
their exact public projections. Protected history routes use the stricter fixed private `503`
boundary described above. The API never forwards cookies or arbitrary upstream headers.
Unreachable, malformed, oversized, and timed-out public dependencies become fixed 502 or 504
responses without raw diagnostics.

To rotate the history read credential:

1. Stop the public API and history worker.
2. Change only `HISTORY_READ_API_TOKEN` in the worker and public API environments.
3. Restart the worker and verify its loopback readiness.
4. Restart the public API and verify /readyz.

Rotate `HISTORY_INGEST_API_TOKEN` independently by stopping the operator and history worker,
changing only their ingestion credential, restarting history, and then restarting the operator.
Neither rotation requires changing the other credential.

No Vercel redeployment is required for a worker-token rotation.

## Reviewed limits, deliberately kept

Recorded so the next audit treats these as decisions rather than misses.

- **`OPTIONS` preflights, `/healthz`, and origin-rejected requests run before
  the rate limiter.** Each is a cheap constant-cost response; metering
  preflights breaks browsers, and metering the liveness probe breaks monitors.
  If any of the three ever grows a nontrivial cost, move `applyRateLimit`
  ahead of it.
- **Each admin request re-reads onchain authority twice** — once to authorize
  and once inside the diagnostics proxy after the upstream body is buffered.
  The second read is what makes revocation-after-buffering effective (a test
  proves it), at roughly 24 RPC calls per diagnostics page. Coalescing the two
  reads is an optimization, not a correctness fix, and it must not weaken the
  post-buffering recheck.
- **A syntactically valid fake session cookie selects the session/protected
  rate class before any store lookup**, so one address can draw on each
  class's budget once (five bounded budgets rather than one). Validating the
  handle against the store before classification would turn the limiter into
  a store-read amplifier, which is the worse trade.
