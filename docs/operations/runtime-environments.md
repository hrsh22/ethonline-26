# Runtime environment isolation

Every long-running process has an exact environment allowlist in
`scripts/runtime-environment.ts`. Launchers may read the combined root `.env` for local
development, but they project a service-specific environment before spawning a child and scrub
their own environment before waiting. The API and history entry points do not load `.env`
themselves. Adding a variable to `.env` therefore does not make it available to a service unless
its reviewed allowlist also names it.

The root `.env` is a local integration convenience, not a deployment secret bundle. `pnpm backend`
is suitable for one-developer Base Sepolia testing; deployed services should have independent
lifecycles and identities.

## Deployment boundaries

Use a separate operating-system user or container and a separate environment file or secret-manager
policy for every service:

| Process        | Suggested identity               | Suggested environment file | Credentials it may hold                                                                                                       |
| -------------- | -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Public API     | `orbit-api`                      | `/etc/orbit/api.env`       | History read and funding loopback tokens, read-only auth RPC, and durable auth-session state                                  |
| History worker | `orbit-history`                  | `/etc/orbit/history.env`   | Separate history read and ingestion tokens, a read-only RPC credential, and optional v4-subgraph bearer token; no private key |
| Funding worker | `orbit-funding`                  | `/etc/orbit/funding.env`   | Inventory-only funding signer key and funding bearer token                                                                    |
| Operator       | `orbit-operator`                 | `/etc/orbit/operator.env`  | Dedicated shared operator key, or keeper and liquidity-executor keys, plus only the history ingestion token                   |
| Web            | `orbit-web` or the frontend host | `/etc/orbit/web.env`       | No secret; every allowed `NEXT_PUBLIC_` value is browser-visible                                                              |

Create each file as owner-only and keep its parent directory non-writable by the service:

```bash
sudo install -d -o root -g root -m 0755 /etc/orbit
sudo install -o orbit-api -g orbit-api -m 0600 /dev/null /etc/orbit/api.env
sudo install -o orbit-history -g orbit-history -m 0600 /dev/null /etc/orbit/history.env
sudo install -o orbit-funding -g orbit-funding -m 0600 /dev/null /etc/orbit/funding.env
sudo install -o orbit-operator -g orbit-operator -m 0600 /dev/null /etc/orbit/operator.env
```

Do not give one service user read access to another service's file or persistent volume. Set a
`0077` umask for history, funding, and operator state. In systemd, pair `User=`, `Group=`,
`EnvironmentFile=`, `UMask=0077`, and `NoNewPrivileges=true`; use one unit per service. In a
container deployment, use one container and one secret mount or secret-manager identity per
service. Do not bake environment files into an image or reuse one Compose `env_file` across
containers.

The service launch commands still enforce the code allowlist when a process manager injects extra
host variables. Treat that filtering as defense in depth, not as permission to give every service
the combined secret file.

The public API also owns the administrator authentication boundary. Its environment may contain
`ADMIN_AUTH_APP_ORIGIN`, `ADMIN_AUTH_RPC_URL`, `ADMIN_AUTH_MANIFEST_PATH`,
`ADMIN_AUTH_DATABASE_PATH`, `ADMIN_AUTH_CHALLENGE_TTL_SECONDS`, and
`ADMIN_AUTH_SESSION_TTL_SECONDS`. These values never enter the web process. The API creates only a
read-only chain client; it receives no wallet client, operator key, deployer key, funding-signer
key, or history-ingest credential. Keep the auth database and its WAL/SHM files owner-only (`0600`)
and back them up with the VM's other durable state. Its path must be an absolute `.sqlite` file
beneath a dedicated directory; the API rejects root-level, relative, in-memory, and symlinked
state paths before opening SQLite.

Changing the checked deployment fingerprint invalidates outstanding challenges and sessions.
Rotating a live onchain role invalidates the affected session before its next protected read or
action. Worker read-token rotation is independent and must not alter end-user sessions.

Every official Next.js development, local-development, build, typecheck, start, and accessibility
command uses the same guarded web launcher. Next.js normally reloads mode-specific files such as
`apps/web/.env.local` after a parent process starts it, which would bypass parent-only projection.
The launcher therefore rejects every `apps/web/.env*` file (except the non-loaded reference
`.env.example`) without reading or printing its values, and marks the pinned Next environment
loader as already processed before spawning the child. Each official Next child also starts with a
read guard for app-root `.env*` paths, preventing the development watcher from force-loading a file
created after startup. A blocked read reports only the filename, never its contents. Put local
reviewed browser-public values in the root `.env`; inject only the documented web allowlist from a
production process manager. The root `.env.example` enumerates every browser-public binding the web
application reads, and a test fails if the application reads one the launcher does not project or
that file does not document, so a missing binding surfaces there rather than as a rejected
`apps/web/.env.local`.

## Deployment-key lifecycle

`OPERATOR_PRIVATE_KEY` may serve both operational roles when one dedicated identity holds both.
For split identities, leave it unset and provide both `OPERATOR_KEEPER_PRIVATE_KEY` and
`OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY`. These are operator-only credentials.

`DEPLOYER_PRIVATE_KEY` is a deployment-time credential. It is not allowed in API, history,
funding, operator, or web runtime environments and must not be copied into any file above. Once a
deployment is confirmed, its manifest is checked, and runtime roles are provisioned, remove the
deployer key and any combined deployment `.env` from the runtime host. Keep a deployment credential
only in the separately controlled deployment system or offline custody required by the deployment
procedure.

Before starting services, verify that the runtime account, its environment file, its process-manager
configuration, and its container secret set contain no deployer key. Rotate a runtime credential by
stopping only the affected service, changing only its owner-only file or secret-manager binding, and
restarting that service. Never print an environment file or secret value into logs or diagnostic
evidence.
