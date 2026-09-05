# Expose a VM-owned public API

Status: accepted on 30 August 2026 for the Base Sepolia proof of concept.

Amended on 31 August 2026: funding status accepts no recipient for service-only inventory state and
an optional recipient for wallet-specific eligibility. The exact query-parameter name allowlist
remains unchanged.

## Context

The Historical Read Model, Keeper, and testnet-funding signer already have lifecycles that are
independent of the web application. The first browser adapter nevertheless used dynamic Next.js
route handlers to attach private worker credentials and forward every request. That topology was
appropriate while all processes shared one host, but it makes a split Vercel/VM deployment pay
for a second HTTP hop and retain Vercel functions solely as credential-bearing pass-throughs.

ADR 0009 required browsers to call a same-origin Next.js route and relied on that route's
allowlist to hide Keeper-attempt ingestion. This decision deliberately supersedes those two
requirements. It does not change ADR 0009's manifest, persistence, canonicality, cursor, or
single-writer requirements.

## Options considered

### Keep the Next.js Backend-for-Frontend

This keeps CORS unnecessary and worker URLs private, but deploys dynamic web functions only to
forward bytes. Every request crosses Vercel and the VM, and worker credentials must be installed
in both deployment control planes.

### Expose each worker directly

This removes the extra hop, but leaks process topology into browser callers and puts public CORS,
routing, and abuse controls inside persistence and signing processes. It also risks exposing the
authenticated Keeper-ingestion interface beside public history reads.

### Add one VM-owned public API application

A narrow public application can own the browser interface while the history and funding workers
remain loopback-only. It authenticates to those workers, exposes only safe routes, applies one
origin/method/body/timeout policy, and gives the web application one versioned base URL.

## Decision

Add `apps/api`, a TypeScript/Effect application with this public interface:

- `GET /healthz` for process liveness;
- `GET /readyz` for bounded dependency readiness;
- `GET /v1/history/status`;
- `GET /v1/history/market/swaps` and `GET /v1/history/market/fees`;
- `GET /v1/history/protocol/liquidity-cycles`;
- `GET /v1/history/protocol/permanent-commitments`;
- `GET /v1/history/protocol/rewards`;
- `GET /v1/history/protocol/operations`;
- `GET /v1/history/protocol/keeper-attempts`;
- `GET /v1/funding/status`, optionally with exactly one `?recipient=...`; and
- `POST /v1/funding/fund` with a validated recipient and request source.

No wildcard forwarding is permitted. Keeper-attempt ingestion, raw worker health routes, signer
controls, operator controls, and unknown paths have no public mapping.

The public application and both upstream workers bind to loopback. A same-host reverse proxy
terminates TLS and forwards only to the public application. The public application accepts exact
configured browser origins, handles preflight, bounds methods, bodies, upstream time, and request
rate, and emits fixed gateway errors. It forwards server-only bearer credentials to loopback
workers and never returns them.

The browser receives `NEXT_PUBLIC_API_URL` and calls this interface directly. It receives no
history token, funding token, operator key, deployer key, or funding-signer key. Next.js history
and funding route handlers are deleted without compatibility aliases or redirects.

Vercel may still execute Next.js rendering for dynamic pages. That rendering lifecycle is a web
concern and is not the protocol's backend interface.

## Consequences

The Vercel deployment no longer stores VM worker credentials or runs pass-through API functions.
Browser requests make one application hop before the owning worker, and the VM has one explicit
public HTTP seam. CORS and reverse-proxy configuration become deployment requirements. The API
process, history worker, funding worker, and operator remain independently supervised, with one
replica each where persistence or signing requires it.

A future move from SQLite or split of the public interface does not change browser callers while
the versioned interface remains stable. Base mainnet still requires a separate reviewed
deployment manifest and operational decision.
