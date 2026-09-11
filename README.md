# ORBIT 4444

ORBIT 4444 is a Base-native collectible economy that combines liquid ownership, irreversible collectible commitment, and tokenized-stock rewards. This repository contains the protocol documentation and Base Sepolia implementation workspace.

Every Base Sepolia asset used by this project is a valueless test asset. Nothing in the POC represents a live stock, a financial claim, or production liquidity.

## Toolchain

- Node.js 24.15 or newer within major version 24
- pnpm 11.22.0, installed directly with `npm install --global pnpm@11.22.0`
- Next.js 16.3.3 and React 19.2.8
- shadcn/ui with Tailwind CSS 4
- Effect 3 for typed services, errors, and configuration decoding
- Privy, viem, and wagmi for external wallets and email-created embedded wallets on Base Sepolia
- Foundry with Solidity 0.8.26

Dependencies are exact in package manifests and resolved by the committed `pnpm-lock.yaml`.

## Workspace

```text
apps/api/              VM-owned Effect public API
apps/web/              Next.js App Router application
packages/config/       Validated protocol and chain configuration
packages/protocol/     Effect services and typed chain boundaries
packages/contracts/    Foundry contracts, tests, and scripts
scripts/history-indexer/ Read-only Effect indexer and SQLite/HTTP adapters
scripts/testnet-funding/ Inventory-only Effect funding worker and SQLite policy ledger
deployments/           Schema-validated per-chain manifests
docs/                  Research, domain guidance, and ADRs
```

The public API, read-only history worker, funding signer, and transaction-signing operator have
explicit independent lifecycles. The bounded Base Sepolia operator is a one-shot Effect program
that an external scheduler can invoke. The history worker owns one persistent manifest-bound
SQLite index and no signing capability. Starting the web application starts none of these
processes.

## Commands

```bash
pnpm install
pnpm check
pnpm test
NEXT_PUBLIC_APP_URL=https://orbit.example pnpm build
pnpm api:serve
pnpm backend
pnpm backend:staging
pnpm dev
pnpm dev:local
pnpm dev:staging
pnpm funding:worker
pnpm funding:replenisher
pnpm health:base-sepolia
pnpm health:base-sepolia:staging
pnpm model:genesis-curve
pnpm history:backfill
pnpm history:worker
pnpm operator:base-sepolia
pnpm operator:watch
RPC_URL=http://127.0.0.1:8545 pnpm deploy:protocol
pnpm deploy:cca-protocol -- --local-test
pnpm --dir packages/config generate:manifest
```

Production builds require `NEXT_PUBLIC_APP_URL` to be the canonical HTTPS
origin (for example, `NEXT_PUBLIC_APP_URL=https://orbit.example pnpm build`).
The production build guard rejects missing, non-HTTPS, and localhost origins.
Development commands do not run that build-only guard.

`pnpm check` runs formatting verification, TypeScript and Solidity linting, and strict type checking from the repository root.

`pnpm model:genesis-curve` reports the checked one-sided Genesis Liquidity benchmark, exact-input and exact-output execution, WETH-side fees, cumulative pool WETH, remaining Liquid Tokens, and alternative tick/range sensitivity using v4-compatible integer math. Add `--json` for a machine-readable report or `--config path/to/scenario.json` to validate an alternative input without changing the deployed POC; custom scenarios retain explicit comparison flags against that deployment. See the [Genesis Liquidity ADR](docs/adr/0004-launch-the-entire-supply-through-locked-liquidity.md).

Use the [targeted local-validation matrix](docs/agents/local-validation.md) while developing. It
maps changed paths to the same gates as CI and reserves the full invariant/deployment suite for
finished contract, manifest, hook, deployment, or shared-economic changes.

`pnpm health:base-sepolia` loads `BASE_SEPOLIA_RPC_URL`, the optional `DEPLOYER_ADDRESS`,
`HEALTH_EVIDENCE_PATH`, `HISTORY_INDEX_URL` (defaulting to `http://127.0.0.1:8787`), and the
required read-only `HISTORY_READ_API_TOKEN` from the ignored root `.env`. Explicit shell values
take precedence.
Start `pnpm history:worker` and wait for its `/readyz` endpoint before running the health command;
the check reads indexed protocol history and keeper-attempt evidence and fails closed when that
worker is stopped, unreachable, or rejects its token. The example evidence path is under ignored
`.scratch/`, so routine health checks do not modify checked deployment evidence.

`pnpm history:backfill` resumes the checked deployment from its persistent checkpoint and exits at
the confirmed chain tip. `pnpm history:worker` runs the same bounded Effect sync continuously and
serves the narrow authenticated API consumed through the VM-owned public API. It derives
every source address, Pool ID, currency order, chain, and launch block from the checked manifest;
it requires no private key. Run it independently from `pnpm dev`. See
[`docs/operations/indexed-history.md`](docs/operations/indexed-history.md) for local startup,
coverage, reorg, backup, reset/recovery, deployment, and monitoring.

`pnpm operator:base-sepolia` loads its RPC, signing, slippage, Protocol-Owned Liquidity budget, and
evidence settings from the same ignored root `.env`. It reads, quotes, and simulates eligible Reward
Epoch, Reward Track/retry, and Protocol-Owned Liquidity actions but submits nothing by default.
Execute mode requires the explicit `OPERATOR_EXECUTE=true` gate and a private key that resolves to
the configured keeper and liquidity executor. See
[`docs/operations/base-sepolia-automation.md`](docs/operations/base-sepolia-automation.md) before
scheduling it.

`pnpm api:serve` starts the loopback-only public HTTP application used directly by browser clients.
It exposes an exact versioned history/funding route table, authenticates to the two private
loopback workers, and owns CORS, body, timeout, and request-rate policy. Its only RPC dependency is
the read-only Base Sepolia client used to verify live administrator roles and wallet signatures;
it never receives a wallet client or private key. Run it independently from the web and workers.
See
[`docs/operations/public-api.md`](docs/operations/public-api.md) for local and Vercel/VM topology.

`pnpm operator:watch` is the explicit local recurring scheduler. It runs the same bounded command
sequentially at `OPERATOR_INTERVAL_SECONDS`, defaults to dry-run through `OPERATOR_EXECUTE=false`,
and stops an in-flight child cleanly on `Ctrl-C` or `SIGTERM`. `pnpm dev` is web-only even when the
ignored environment contains operator execution settings.

`pnpm backend` is the local all-in-one supervisor for the history worker, funding worker, public
API, and operator watch. It builds shared packages once, starts the three serving processes, waits
for authenticated history readiness, and then starts the operator so its first scheduled pass is
not lost to a startup race. Any unexpected child exit stops the complete group, and `Ctrl-C`
shuts every child down. Every line is tagged with the service that wrote it and the time it
arrived, with `stderr` marked, so five children sharing one terminal stay readable; colour is used
only on a TTY and never under `CI`, `NO_COLOR`, or `TERM=dumb`. Run exactly one copy; `OPERATOR_EXECUTE=true` permits the included operator
to sign eligible Base Sepolia transactions. Start the web separately with `pnpm dev`.

`pnpm funding:replenisher` is the separate bounded process that tops the funding signer up from a dedicated treasury when its inventory falls below a configured minimum. It is deliberately not part of the worker: the worker is the internet-reachable component, so it must not be able to pull more funds. The treasury key lives only in the ignored `.env.testnet-funding-treasury`, created from [`config/env/replenisher.env.example`](config/env/replenisher.env.example); each top-up is a fixed amount under a persisted per-window ceiling, and startup refuses a treasury that holds any protocol role. `pnpm backend` supervises it and it idles when no treasury is configured. See [`docs/operations/testnet-funding.md`](docs/operations/testnet-funding.md).

`pnpm deploy:protocol` is the fail-closed composition entry point for chain IDs `31337` and `84532`. On an empty Anvil chain it deploys local infrastructure and the complete protocol, seeds all six pools, seals every immutable boundary, launches, records confirmed transaction hashes in `deployments/31337.json`, and verifies an idempotent rerun without broadcasting. Base Sepolia reuses the confirmed self-funded WETH-like/USDC-like venue and official v4 PoolManager, then deploys the complete protocol. A single development wallet may hold the deployer, guardian, keeper, liquidity-executor, and creator roles for this valueless POC; threshold recovery still requires a distinct cosigner, and the four mutable modules are owned by a governance Safe after the scripted handover in [docs/operations/module-governance.md](docs/operations/module-governance.md). The command never prints the deployment private key.

`pnpm deploy:cca-protocol -- --local-test` starts an isolated Anvil chain and rehearses the fresh CCA replacement end to end. It deploys new local v4 and launch infrastructure, every project-owned module, a new 4,444 FUEL supply, conversion pools, deterministic bidder custody, and a funded auction. It then checks the uninitialized canonical PoolKey, module ownership and seals, contiguous successful receipts, and an exact schema-v3 manifest. For Base Sepolia, provide the reviewed JSON input through `CCA_DEPLOYMENT_INPUT`, choose a new `CCA_MANIFEST_OUTPUT`, and run without `--broadcast` first. The simulation writes only a composition sidecar. Adding `-- --broadcast` is the explicit transaction gate; it refuses to overwrite an existing manifest and publishes the canonical manifest only after every setup receipt and onchain postcondition passes. The auction remains pending until settlement, permissionless pool seeding, and coordinator activation.

Public contract addresses live in checked deployment configuration, never in `.env`: `development`
selects `deployments/31337.json`, `development-sepolia` selects the current developer deployment in
`deployments/84532.json`, and `staging` reserves `deployments/84532.staging.json` for the separately
deployed VM demo. Staging remains unavailable until that manifest is reviewed and published;
`production` likewise has no address manifest until a reviewed Base mainnet deployment exists.
Because the two remote targets share chain 84532, Base Sepolia deployment commands require an
explicit `DEPLOYMENT_ENVIRONMENT` and fail instead of inferring an identity from the chain.
`pnpm dev` selects developer Base Sepolia from `.env`, `pnpm dev:staging` selects staging from
`.env.staging`, and `pnpm dev:local` selects Anvil. This deployment target is independent of
Next.js development mode. RPC URLs, signing keys, and connector credentials remain in the ignored
root or service-specific environment files described below; do not create an `apps/web/.env*` file.

`pnpm funding:worker` starts the separate loopback-only self-service funding service used by the public `/start` route through `apps/api`. A minimal launcher gives the signer process only variables from the dedicated ignored `.env.testnet-funding`, created from [`config/env/funding.env.example`](config/env/funding.env.example); deployer and operator keys from the shared environment are not inherited. The service uses a finite, inventory-only signer that transfers existing valueless test WETH and Base Sepolia gas; it cannot mint or hold any protocol role. Signed transactions are persisted before broadcast, while cooldowns, lifetime limits, pending recovery, and receipts survive restarts in a private SQLite ledger. `pnpm dev` never starts this worker. See [`docs/operations/testnet-funding.md`](docs/operations/testnet-funding.md) before provisioning inventory or enabling it.

## Identity and collection assignment

The selected product identity is the single `selectedIdentityKey` input in `packages/config/src/identity.ts`. ORBIT 4444 and a neutral test identity provide the complete token names, terminology, navigation, disclosure, and placeholder-asset configuration consumed by deployment, onchain metadata, and the application. The deployment wrapper builds and injects that selected adapter before the one-way launch seal; identity values are not independently overridden through the environment.

`packages/config/collection/manifest.json` is the checked-in 4,444-identity assignment. Its provenance records the seed, `keccak256-sort-v1` assignment algorithm, fixed-width canonical serialization, code tables, and manifest commitment. `manifest.bin` is the same assignment in the canonical onchain byte format. Regenerate both artifacts with the manifest command above; the configuration and Foundry tests reject any byte or hash drift.

## Environment

For the combined local stack, copy the slim integration template plus the two isolated signer
templates:

```bash
cp .env.example .env
cp .env.staging.example .env.staging # workstation staging rehearsal only
cp config/env/funding.env.example .env.testnet-funding
cp config/env/replenisher.env.example .env.testnet-funding-treasury
cp .env.testnet-funding.staging.example .env.testnet-funding.staging
cp .env.testnet-funding-treasury.staging.example .env.testnet-funding-treasury.staging
```

The authoritative per-process staging templates are in [`config/env/`](config/env/): web, API, history,
operator, funding, replenisher, and one-shot deployment. They document defaults and advanced knobs;
the root example intentionally contains only the cross-service values needed for local integration.
Never commit funded keys or credential-bearing RPC URLs.

Local launchers preserve explicit-shell-over-root-file precedence and project exact API, history,
funding, operator, replenisher, and web allowlists before starting a child. Funding and replenisher
dedicated files then override the combined root values for their respective child. Do not create
any `apps/web/.env*` file: every official Next.js lifecycle rejects it because Next would otherwise
reload it after environment projection. The guarded child also denies app-root `.env*` reads, so
development hot reload cannot introduce a file after the startup check. The web uses Privy and
receives only reviewed `NEXT_PUBLIC_` values; server bearer tokens stay on the VM.

For deployment, install only the relevant service template as a separate owner-only `0600` file
for each service user or container. Keep `config/env/deployment.env.example` and populated copies
away from runtime hosts, then remove `DEPLOYER_PRIVATE_KEY` after the one-shot deployment. See
[Runtime environment isolation](docs/operations/runtime-environments.md).

## Base Sepolia infrastructure

Chain ID: `84532`

| Contract                   | Address                                      |
| -------------------------- | -------------------------------------------- |
| WETH9                      | `0x4200000000000000000000000000000000000006` |
| Circle test USDC           | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Uniswap v4 PoolManager     | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| Uniswap v4 PositionManager | `0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80` |
| Uniswap v4 StateView       | `0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4` |
| Uniswap v4 Quoter          | `0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba` |
| Universal Router           | `0x8B844f885672f333Bc0042cB669255f93a4C1E6b` |
| Permit2                    | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

The official addresses remain reference infrastructure and the official v4 `PoolManager` is used. The deployed POC settlement addresses come from `deployments/84532.json`; its clearly labelled WETH-like and USDC-like assets are project-owned test fixtures, not the official tokens listed above. The checked-in values are decoded through Effect Schema in `packages/config` before use.

## ETHOnline integrations

See the [integration runbook](docs/operations/ethonline-2026-integrations.md) for Privy setup, live Uniswap transaction evidence, the standardized Graph subgraph, and the free-service boundary. Uniswap developer feedback is in [FEEDBACK.md](FEEDBACK.md).
