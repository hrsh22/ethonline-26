# ADR 0012: Separate the operator lifecycle control plane from the data plane

The browser could not truthfully start or stop the operator. Execution mode was
fixed at process startup by `OPERATOR_EXECUTE`, lifecycles were externally
supervised, and public API readiness deliberately did not prove operator
liveness. The admin console could therefore show a green service while nothing
was running.

## Decision

Add a **separate authenticated control plane**. The public API remains a data
plane and gains no ability to run anything; it proxies two admin-authorized
routes to a token-authorized loopback control surface owned by the operator.

The control plane exposes a **fixed command vocabulary**, not a process
interface:

- `stop` — stop starting new runs;
- `enable-dry-run` — recurring runs that plan and simulate but never sign;
- `enable-live` — recurring runs that may sign eligible transactions;
- `request-dry-run` — one planning pass, then return to the standing policy;
- `request-live-run` — one bounded pass that may sign, then return.

Nothing in the request can name an executable, a shell fragment, a path, an
environment override, an RPC URL, or a key. A generic process or shell endpoint
was rejected outright: it would move arbitrary execution behind a web session.

## Four separate facts

The old single flag conflated things that fail independently. They are now
modelled and reported separately:

| Fact                 | Source                                  |
| -------------------- | --------------------------------------- |
| Execution policy     | durable desired mode plus a queued pass |
| Service liveness     | observed supervisor heartbeat           |
| Dependency readiness | the existing readiness checks           |
| Work eligibility     | onchain protocol state                  |

A `live` policy with no heartbeat is an **offline service**, and the console says
so. Liveness is never inferred from policy.

## Safety properties

- **Fail closed.** A fresh store, a wiped store, and a restart all read
  `stopped`. Nothing signs until an operator asks for it.
- **Durable single-writer lease.** Only the lease holder may cross a signing
  boundary, so two supervisors sharing a ledger cannot both broadcast. The lease
  survives a restart, so a crash cannot double-broadcast.
- **Idempotent commands.** Every command carries a client-generated id. A
  retried request returns the stored result instead of applying twice.
- **Stop prevents the next signing boundary.** Signing authority is re-checked
  immediately before signing, not cached at cycle start. A stop arriving
  mid-cycle blocks the boundary, including for an already-claimed one-shot live
  pass. A transaction already broadcast is still reported truthfully.
- **Wallet-signed live commands.** `enable-live` and `request-live-run`
  additionally require a short-lived wallet signature bound to actor, command,
  chain, deployment, nonce, and expiry. An authenticated session alone cannot
  start signing on Base Sepolia.
- **Signing keys stay in the operator process.** The control plane moves policy,
  never key material. The API and the browser never see a key.
- **Append-only audit.** Every command records actor, role, command, previous
  and new policy, result, time, and a public transaction hash where one applies.
  Rows are never updated or deleted.

## One-shot claiming

A queued pass is consumed at the start of the cycle that claims it, so a crash
mid-cycle cannot replay it on restart. The policy revision is captured _after_
that consumption, so claiming a pass is not mistaken for an operator's later
stop.

## Consequences

- `OPERATOR_EXECUTE` becomes a startup default rather than the authority. The
  durable policy governs each cycle.
- The operator needs a writable control ledger alongside its other state.
- The control surface must never be publicly routed. The public API proxies it
  only after its own session, role, and CSRF checks.
- Truthful reporting can now be worse-looking than before: an operator that is
  not running will say so instead of appearing green. That is the point.
