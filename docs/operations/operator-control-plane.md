# Operator lifecycle control plane

See [ADR 0012](../adr/0012-operator-lifecycle-control-plane.md) for the decision
and its safety properties.

## What the operator can be asked to do

| Command            | Effect                                                |
| ------------------ | ----------------------------------------------------- |
| `stop`             | Stop starting new runs, and discard any queued pass   |
| `enable-dry-run`   | Recurring runs that plan and simulate, never sign     |
| `enable-live`      | Recurring runs that may sign eligible transactions    |
| `request-dry-run`  | One planning pass, then return to the standing policy |
| `request-live-run` | One bounded pass that may sign, then return           |

That is the whole vocabulary. No request can name an executable, a shell
fragment, a path, an environment override, an RPC URL, or a key.

## Surfaces

- `GET /v1/admin/operator/state` — the console read. Requires an authenticated
  admin session.
- `POST /v1/admin/operator/command` — a mutation. Requires an authenticated
  session, the keeper capability, a CSRF token, and a client-generated command
  id. `enable-live` and `request-live-run` additionally require a wallet
  signature bound to actor, command, chain, deployment, nonce, and expiry.

The browser reaches both through the web app's same-origin admin relay
(`/api/admin/operator/*`): the admin session cookie is `SameSite=Strict`, so a
direct browser call to the API origin would arrive unauthenticated. The public
API then proxies to a **loopback-only, token-authorized** control surface that
the operator watch process hosts for its own lifetime. That surface is never
publicly routed. `OPERATOR_CONTROL_URL` must be a root `http://127.0.0.1` URL
and the API refuses anything else.

The watch starts the surface only when `OPERATOR_CONTROL_HOST`,
`OPERATOR_CONTROL_PORT`, `OPERATOR_CONTROL_API_TOKEN`, and
`NEXT_PUBLIC_APP_URL` are configured together alongside the control ledger; a
partial configuration is refused at startup rather than running a console that
cannot work. `NEXT_PUBLIC_APP_URL` matters here because signed commands are
domain-bound to the web origin the operator's wallet displays, and the surface
must expect the same host the browser signs.

## Configuration

| Variable                          | Where      | Purpose                                 |
| --------------------------------- | ---------- | --------------------------------------- |
| `OPERATOR_CONTROL_DATABASE_PATH`  | operator   | Durable policy, audit, lease, heartbeat |
| `OPERATOR_CONTROL_HOST` / `_PORT` | operator   | Loopback control surface                |
| `OPERATOR_CONTROL_API_TOKEN`      | both       | Shared service token, 32+ characters    |
| `OPERATOR_CONTROL_URL`            | public API | Loopback control surface to proxy to    |

`OPERATOR_EXECUTE` becomes a **startup default only**. Once a control ledger is
configured, the stored desired policy governs every cycle, and the startup
announcement says so rather than claiming a mode the policy will override.

## Reading the state honestly

Four facts are reported separately, because they fail independently:

- **execution policy** — the durable desired mode plus any queued pass;
- **service liveness** — the observed supervisor heartbeat;
- **dependency readiness** — the existing readiness checks;
- **work eligibility** — onchain protocol state.

A `live` policy with no heartbeat is an **offline service**. Liveness is never
inferred from policy, and a green data plane still does not imply a running
operator.

## Safety you can rely on

- A fresh ledger, a wiped ledger, and a restart all read `stopped`.
- Only the durable writer-lease holder may cross a signing boundary, so two
  supervisors sharing a ledger cannot both broadcast. The lease survives a
  restart.
- A retried command with the same id returns the stored result instead of
  applying twice. Reusing an id for a _different_ command is rejected.
- A stop arriving mid-cycle prevents the next signing boundary, including for an
  already-claimed one-shot live pass. A transaction already broadcast is still
  reported.
- Signing keys never leave the operator process.

## Audit

Every command appends a row recording actor, role, command, previous and new
policy, result, and time, plus a public transaction hash where one applies. Rows
are never updated or deleted. Back the control ledger up with the rest of the
operator state; deleting it is a security-sensitive policy reset, not routine
recovery, because it discards the audit trail along with the policy.

## Recovery

- **Supervisor outage** — the lease expires and another supervisor takes over.
  Until then no cycle runs, and the console reports the service offline.
- **Stale heartbeat** — reported as degraded, then offline. Policy is unchanged;
  the operator simply is not running.
- **Unknown state** — issue `stop`. It is always safe, always applies, and
  discards any queued pass.
