# Fresh CCA deployment

The CCA deployment command creates new valueless test assets, conversion pools, attributes, VRF subscription and discovery adapter, FUEL and its mirror, recovery authority, claim policy, rewards, metadata, conversion routes, and CCA launch contracts. It stops with the auction funded and FUEL unlaunched. It does not consume an existing protocol manifest or mint a legacy genesis position.

## Local rehearsal

From the repository root:

```sh
pnpm deploy:cca-protocol -- --local-test
```

This starts an isolated Anvil instance, installs the pinned local Permit2 runtime at its canonical address, deploys compatible PoolManager and PositionManager contracts, and sends all setup transactions to that local instance. It uses the checked [testnet economic defaults](../economics/cca-testnet-defaults.json), with 1,000 blocks of setup lead. The instance stops after verification. No public-network transaction is sent.

The command prints an ignored `deployments/.local-deployment-test-cca-*/` directory containing:

- `input.json`: the exact roles, identity, VRF funding, external infrastructure and auction parameters used.
- `infrastructure.json`: the local external-contract equivalents.
- `composition.json`: all deployment addresses, codehashes, complete auction schedule and salt, configuration identity, and the confirmed VRF subscription ID.
- `31337.json`: a checked canonical schema-v3 manifest with receipt-derived transaction history, actual module owners and pending owners, conversion-pool snapshots, and a zero-liquidity pending canonical pool.

The local rehearsal verifies confirmed receipt success, sender identity, contiguous nonces, required contract creations, module seals, the single atomic funding transaction, coordinator ownership, and the pending auction state. The Solidity lifecycle suite separately exercises successful migration and activation, failed minimum-raise refunds, terminal migration failure and recovery, and bounded token delivery.

## Base Sepolia input and simulation

Copy [the example input](cca-deployment-input.example.json) into a new directory under `deployments/`. Replace every zero role address. The recovery cosigner must be distinct from the deployment owner. Set absolute `startBlock`, `endBlock`, `claimBlock`, and `migrationBlock`: the included issuance schedule lasts 10,800 blocks (about six hours at the documented two-second Base assumption); claim and migration are one block after the end. Allow ample setup lead: the local composition currently takes 133 transactions, and public-network inclusion takes additional time. The Solidity 128-block minimum is a validation floor, not an inclusion-time estimate.

The example uses the checked testnet economic values and visibly valueless, newly minted test assets. Review those inputs and set `testnetEconomicsConfirmed` to `true` to enable the Base Sepolia path. VRF native funding is explicit. Additional blocked venue codehashes belong in `blockedVenueCodehashes`; the newly deployed conversion venue is included automatically.

Set these environment variables without putting signing keys in command arguments:

```sh
export RPC_URL=https://sepolia.base.org
export DEPLOYMENT_ENVIRONMENT=staging
export CCA_DEPLOYMENT_INPUT="$PWD/deployments/my-cca/input.json"
# Supply DEPLOYER_PRIVATE_KEY through your local secret environment.
pnpm deploy:cca-protocol
```

The explicit deployment identity is mandatory because developer and staging both use chain 84532.
Staging defaults to `deployments/84532.staging.json`; an explicit `CCA_MANIFEST_OUTPUT` may select a
review directory inside `deployments/`, but it must never overwrite `deployments/84532.json`.

With no `--broadcast`, Forge simulates the whole deployment and writes only the output-adjacent
`*.composition.json` sidecar. It does not create a canonical manifest or claim confirmed
transactions. A later explicitly authorized broadcast uses:

```sh
pnpm deploy:cca-protocol -- --broadcast
```

The command refuses to overwrite an existing canonical output. Input and output paths must stay inside `deployments/`, matching Foundry's filesystem policy. The CCA command is separate from the retained legacy `deploy:protocol` command.

Base Sepolia uses the existing official CCA factory, LiquidityLauncher, LBPStrategy, PoolManager, PositionManager, and Permit2 addresses in the example. Solidity verifies their pinned runtime codehashes and immutable bindings before setup; the factory must have no protocol fee controller. Only local deployments create CCA factory/launcher/strategy copies and `ccaCreate2Deployer`. The read-only fork tests also exercise complete fresh setup and atomic funding against the actual Base Sepolia instances.

## Pending-manifest semantics

The Base Sepolia operator maintains schema-v3 launches through the existing operator control lease and keeper signing account. Each cycle reconciles prior durable signed submissions before observing CCA state, and performs at most one lifecycle action: end-block checkpoint, migration, recovery seeding, permanent-position registration, or activation. Simulation mode reports the same next action without signing. Reward and protocol-liquidity work starts on a subsequent cycle only after both coordinator activation and FUEL launch are observed.

Failed graduation stops launch maintenance; participants can use the auction refund path. Successful graduation waits until the on-chain migration block. A successful migration receipt is not proof of launch: the next pinned observation checks the strategy reservation and actual pool state. A consumed reservation with an uninitialized pool selects `recoverAndSeed()`. Simulation failures leave the action retryable on the next cycle.

When migration initializes the pool but the PositionManager mint bypasses receiver callbacks, maintenance scans PositionManager transfers to the permanent recipient from the setup block, using bounded block ranges. Before registration it verifies current NFT ownership, exact canonical pool identity, nonzero liquidity, and absence of prior registration. Coordinator activation is selected only when the readiness contract returns true. Unknown submission outcomes stop the cycle and remain in the existing local signed outbox for reconciliation; restarting does not advance the lifecycle based on a receipt alone. Lifecycle observations and the selected next action are written to the configured operator evidence file.

Schema v3 uses `phase: "cca"`. Its `launch` field records the terminal **setup** receipt because that field must reference the last recorded transaction; it is not evidence that FUEL trading was activated. The canonical pool remains uninitialized with zero price and liquidity. Auction settlement, permissionless migration, permanent-position registration and coordinator activation are subsequent lifecycle actions.

The canonical manifest contains the collection commitment, metadata identity, all supported contract bindings, complete setup transaction hashes, role and module ownership records, CCA source provenance, economics and lifecycle blocks. The composition sidecar additionally retains the full issuance bytes, distribution salt, VRF bootstrap/coordinator/subscription, configuration hash, and external runtime hashes. The wrapper refreshes block-derived values from confirmed chain state before delivering these artifacts.

Verification commands:

```sh
pnpm exec vitest run scripts/deploy-cca-protocol.test.ts
cd packages/contracts
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test \
  --match-contract 'CcaLaunchDeploymentTest|CcaBaseSepoliaInfrastructureTest|CcaFreshLifecycleTest' -vv
```
