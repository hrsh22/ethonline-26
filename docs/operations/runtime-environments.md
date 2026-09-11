# Runtime environment isolation

Every long-running process has an exact environment allowlist in
`scripts/runtime-environment.ts`. The authoritative examples are the seven files in `config/env/`:
one for each runtime service and one for one-shot deployment. They document defaults and advanced
settings without turning the root file into a shared production secret bundle.

Local launchers may read the combined root `.env`, but they project a service-specific environment
before spawning a child and scrub their own environment before waiting. Explicit shell values take
precedence over the root file. The funding and replenisher launchers then apply their dedicated
files as service-specific overrides. The API and history entry points do not load `.env`
themselves. Adding a variable to any source therefore does not make it available to a service
unless its reviewed allowlist also names it.

The root `.env.example` is deliberately slim. Its `.env` copy selects the developer Base Sepolia
deployment for `pnpm backend` plus a separately started `pnpm dev` web process. The checked
`.env.staging.example` can be copied to the ignored `.env.staging` for a workstation rehearsal of
the demo deployment with `pnpm backend:staging` and `pnpm dev:staging`. Neither combined file is a
deployment secret bundle. The detailed templates remain authoritative when a default or optional
knob is not repeated there; deployed services have independent lifecycles and identities.

`development` remains the Anvil target used by `pnpm dev:local`. `development-sepolia` selects the
current checked `deployments/84532.json`. `staging` reserves
`deployments/84532.staging.json` and remains unavailable to runtime consumers until that separately
deployed manifest is reviewed and published. Because both remote targets use chain 84532, every
deployment command must name the environment explicitly; chain ID alone is intentionally
ambiguous.

## Deployment boundaries

Use a separate operating-system user or container and a separate environment file or secret-manager
policy for every service:

| Process             | Template                             | Suggested identity               | Suggested environment file     | Credentials it may hold                                                                                                       |
| ------------------- | ------------------------------------ | -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Public API          | `config/env/api.env.example`         | `orbit-api`                      | `/etc/orbit/api.env`           | History-read, funding, and operator-control tokens, read-only auth RPC, and durable auth-session state                        |
| History worker      | `config/env/history.env.example`     | `orbit-history`                  | `/etc/orbit/history.env`       | Separate history read and ingestion tokens, a read-only RPC credential, and optional v4-subgraph bearer token; no private key |
| Funding worker      | `config/env/funding.env.example`     | `orbit-funding`                  | `/etc/orbit/funding.env`       | Inventory-only funding signer key and funding bearer token                                                                    |
| Funding replenisher | `config/env/replenisher.env.example` | `orbit-replenisher`              | `/etc/orbit/replenisher.env`   | Treasury-only signer key; no listener, funding-signer key, or protocol role                                                   |
| Operator            | `config/env/operator.env.example`    | `orbit-operator`                 | `/etc/orbit/operator.env`      | Dedicated shared operator key, or keeper and liquidity-executor keys, plus only the history-ingestion token                   |
| Web                 | `config/env/web.env.example`         | `orbit-web` or frontend platform | `/etc/orbit/web.env`           | No secret; every `NEXT_PUBLIC_` value is browser-visible                                                                      |
| One-shot deployment | `config/env/deployment.env.example`  | Isolated deploy system           | Not installed on runtime hosts | Deployer key, deployment role assignment, and deploy-only Graph credential                                                    |

Create each file as owner-only and keep its parent directory non-writable by the service:

```bash
sudo install -d -o root -g root -m 0755 /etc/orbit
sudo install -o orbit-api -g orbit-api -m 0600 /dev/null /etc/orbit/api.env
sudo install -o orbit-history -g orbit-history -m 0600 /dev/null /etc/orbit/history.env
sudo install -o orbit-funding -g orbit-funding -m 0600 /dev/null /etc/orbit/funding.env
sudo install -o orbit-replenisher -g orbit-replenisher -m 0600 /dev/null /etc/orbit/replenisher.env
sudo install -o orbit-operator -g orbit-operator -m 0600 /dev/null /etc/orbit/operator.env
```

Do not give one service user read access to another service's file or persistent volume. Set a
`0077` umask for history, funding, replenisher, and operator state. In systemd, pair `User=`, `Group=`,
`EnvironmentFile=`, `UMask=0077`, and `NoNewPrivileges=true`; use one unit per service. In a
container deployment, use one container and one secret mount or secret-manager identity per
service. Do not bake environment files into an image or reuse one Compose `env_file` across
containers.

The service launch commands still enforce the code allowlist when a process manager injects extra
host variables. Treat that filtering as defense in depth, not as permission to give every service
the combined secret file. A variable repeated across templates is an explicit handoff: generate one
credential and provision it independently to both consumers. In particular, API/history share only
the history-read token, history/operator share only the history-ingestion token, API/funding share
only the funding token, and API/operator share only the operator-control token.

`config/env/web.env.example` is the staging public boundary. Its `NEXT_PUBLIC_` values are compiled into or
sent to browser code; none is a secret. Runtime templates may hold only the credentials named in the
table. `config/env/deployment.env.example` is a separate one-shot authority boundary and must never
be reused as a runtime service file.

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
The launcher rejects every loadable `apps/web/.env*` file without reading or printing its values;
the reserved, non-loaded `.env.example` filename remains ignored by the guard, but the old package
template was removed so there is only one authoritative web template. The launcher marks the pinned
Next environment loader as already processed before spawning the child. Each official Next child
also starts with a read guard for app-root `.env*` paths, preventing the development watcher from
force-loading a file created after startup. A blocked read reports only the filename, never its
contents.

Put reviewed developer browser-public values in the root `.env`; use `.env.staging` only for a
workstation staging rehearsal. On the VM, inject only the documented web
allowlist from a production process manager. `config/env/web.env.example` enumerates every
browser-public binding the application reads, and a test fails if the application reads a binding
the launcher does not project or the authoritative template does not document. Wallet onboarding
uses Privy, so configure `NEXT_PUBLIC_PRIVY_APP_ID`; `NEXT_PUBLIC_REOWN_PROJECT_ID` is not a web
runtime binding.

## Deployment-key lifecycle

`OPERATOR_PRIVATE_KEY` may serve both operational roles when one dedicated identity holds both.
For split identities, leave it unset and provide both `OPERATOR_KEEPER_PRIVATE_KEY` and
`OPERATOR_LIQUIDITY_EXECUTOR_PRIVATE_KEY`. These are operator-only credentials.

`DEPLOYER_PRIVATE_KEY` is a deployment-time credential. It is not allowed in API, history,
funding, replenisher, operator, or web runtime environments and must not be copied into their
files. Once a deployment is confirmed, its manifest is checked, and runtime roles are provisioned, remove the
deployer key and any combined deployment `.env` from the runtime host. Keep a deployment credential
only in the separately controlled deployment system or offline custody required by the deployment
procedure.

The only exception is the documented local-development fallback in `pnpm backend`: with
`DEPLOYMENT_ENVIRONMENT=development-sepolia`, `SELF_FUNDED_TEST_ASSETS=true`, and
`OPERATOR_EXECUTE=true`, and no
dedicated operator key configured, the supervisor maps the local deployer key only into the
operator child as `OPERATOR_PRIVATE_KEY`. This fallback does not apply to separately launched or
staging/production services and does not change any runtime allowlist.

## Publishing staging and initializing VM state

Deploy staging contracts from a trusted workstation or isolated CI runner using the one-shot
deployment template. Set `DEPLOYMENT_ENVIRONMENT=staging` and write the verified result to
`deployments/84532.staging.json`; do not overwrite the developer manifest. The deployer key remains
outside the VM. Publishing staging is a reviewed release change: add the manifest, mark the staging
target configured, regenerate the web binding, and deploy that exact revision.

SQLite does not require contract deployment to run on the VM. Provision fresh staging paths in the
service-specific environment files, start the history worker, and let it backfill from the new
manifest's launch block. Do not copy the developer history, administrator sessions, operator
outbox/control state, or funding ledgers. The history database is manifest-bound and reconstructible;
the other databases contain environment-specific operational state. Wait for history readiness and
catch-up before enabling operator execution or opening the demo.

Process-manager units should invoke the API, history, and operator launcher with `--no-env-file`
so the unit's isolated `EnvironmentFile=` is the only source. The health command supports the same
flag; `pnpm health:base-sepolia:staging` is the workstation convenience that reads `.env.staging`.

Before starting services, verify that the runtime account, its environment file, its process-manager
configuration, and its container secret set contain no deployer key. Rotate a runtime credential by
stopping only the affected service, changing only its owner-only file or secret-manager binding, and
restarting that service. Never print an environment file or secret value into logs or diagnostic
evidence.
