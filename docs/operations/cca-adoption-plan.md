# Fresh CCA development phase for the ETHOnline testnet demo

Date: 2026-09-08. Status: implemented, verified locally and on a Base Sepolia fork, and freshly deployed to Base Sepolia on 2026-09-09. The live setup completed with 125 confirmed transactions; the funded auction is pending at `0x69C48DFee7be220376dF269740Fe943e24D50ab9`. Scope confirmed by the user: complete testnet flow for this hackathon; production later. The implementation starts with a completely fresh deployment of every project contract, including modules whose source did not need changes.

## Clean-start scope

The new phase begins with new contract addresses, a fresh 4,444-unit supply, empty collector ownership and reward state, a new auction, and a new canonical pool. There is no migration of old balances, NFTs, liquidity, rewards, or indexed history; no snapshots, holder compensation, token bridge, or old-address compatibility work. Existing onchain deployments can simply remain unused. A development reset does not require removing their locked liquidity or otherwise modifying them.

Reuse useful source code and tests, but redeploy all project-owned runtime modules. Replace the one-sided GenesisLiquidityVault launch path with the CCA launch subsystem; do not deploy an unused legacy genesis vault merely to preserve an old manifest field. Remove obsolete genesis-only assumptions from the active deployment, readiness checks, UI copy, and economic model. Historical ADRs remain historical records; the new design gets a superseding decision during implementation.

Uniswap uses `migrate()` to mean **seeding the new v4 pool from this new auction's proceeds and reserve**. It never means moving our old deployment into the new one. In this plan, “pool seeding” or “auction-to-pool handoff” describes that operation; upstream API and event names remain exact where technical details matter.

The complete fresh deployment includes:

| Group                      | New deployment/state                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection                 | FuelCore and FuelMirror, AttributeRegistry, metadata renderer, discovery adapter and its request state                                                                                    |
| Market and launch          | CanonicalMarketRegistry, CanonicalFeeHook and its deployer, CanonicalRouter, CCA auction, launch coordinator, bidder-delivery infrastructure, permanent LP custodian and recovery custody |
| Rewards                    | RewardLedger, claim policy, EpochConverter, per-track conversion adapters and ProtocolLiquidityVault                                                                                      |
| Development infrastructure | Project-owned test settlement/reward assets, test conversion venue, recovery authority, and helper contracts required by the chosen deployment                                            |
| Application state          | New manifest/deployment identity, fresh historical-read namespace and subgraph deployment/start blocks, refreshed ABI/address bindings, and reset deployment-specific local receipt state |

Official external infrastructure such as Uniswap PoolManager, PositionManager, Permit2 and VRF services remains a dependency on Base Sepolia; it is not an old ORBIT deployment. The test harness deploys local equivalents where needed. Verify the chosen CCA factory/strategy versions against the pinned source. The user-authorized clean start does not require rewriting or privately cloning external protocols.

## Recommendation

Adopt Uniswap Continuous Clearing Auction (CCA) for initial Liquid Token distribution, subject to proving the auction-to-market handoff first. Preserve FUEL, Craft discovery, irreversible Launch, and the existing reward economy. CCA addresses a real product question: how to discover a launch price instead of selecting the reference opening tick in ADR 0004. It still requires human choices about floor price, supply allocation, release schedule, minimum raise, and liquidity; it does not guarantee demand or a fair valuation.

This is a stronger Uniswap contribution if another developer can reproduce the handoff into our locked, hooked v4 market. The published prize accepts CCA and v4 hooks without stating preferential weighting for either. Improving prize chances is a judgment about execution and usefulness, not a published scoring benefit. See the [official criteria](https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation) and [source investigation](../research/uniswap-cca-adoption.md).

## Proposed collector journey

1. Sign in through the existing Privy flow and receive valueless test funds.
2. Open a clearly named **FUEL auction**, enter a test-WETH budget and maximum price, and review the bid. Keep “Launch” reserved for committing a Craft.
3. Follow auction progress and personal allocation estimates. Explain that estimates change and that CCA clears over time; the final clearing price is not necessarily the average price paid by every bidder.
4. After a successful auction and verified pool seeding, claim purchased FUEL and recover unused bid funds through the supported exit/refund flow.
5. Discover Crafts as delivered FUEL crosses whole-unit boundaries; resolve Pending Discoveries before offering Launch.
6. Trade through the canonical v4 router, Launch a Craft, and claim Stock Rewards using the existing product.

Failed auction, pending pool seeding, token delivery, and refund availability must be distinct states. The UI derives actual eligibility from contracts rather than assuming that a countdown reaching zero enables every action. Bid claims and Stock Reward claims need distinct labels and receipts.

## Architecture and invariants

Use a pinned official CCA implementation for auction accounting. The current stock LBPStrategy supports custom post-auction hooks, subject to its initialization permission, ERC-165 interface, and authorized-initializer checks; our present hook does not meet those requirements. Prefer adapting the new CanonicalFeeHook to this supported path and adding a launch coordinator, bidder-delivery adapter, and permanent position custodian. Prove the exact dynamic-fee PoolKey and lifecycle in the first milestone. A custom migration strategy is a fallback if the stock strategy cannot preserve the remaining invariants, not the default assumption. Do not rewrite the clearing algorithm or remove canonical settlement restrictions. See the pinned source evidence in the [research note](../research/uniswap-cca-adoption.md).

Target sequence: **deploy the complete new stack → configure custody and fixed destinations → fund auction and reserve → auction → seed and lock the new pool → verify and open FUEL trading → deliver bidder FUEL → collecting loop**. Refunds must remain available according to auction rules even if pool seeding is delayed or fails.

- Keep the initial 4,444 economic units. Split them explicitly between auction inventory and liquidity reserve; track sold but unclaimed inventory, unsold inventory, and rounding dust. No new minting or implicit team allocation.
- Prefer test WETH as bid currency to match the existing Canonical Market, fee accounting, and faucet. Native ETH gas remains separately funded. Confirm pinned CCA support and actual token addresses in the spike.
- Auction, migration, claim, and locked-liquidity custody must be Discovery-exempt and protected from recovery before funding and the one-way launch seal. Verify both flags: FuelCore's recovery path can otherwise move custodial FUEL outside the ordinary transfer policy. Holding tokens in infrastructure must not consume collectible identities.
- Preserve the permanent 3% WETH-side secondary-market fee: 2% Stock Rewards, 0.85% Protocol-Owned Liquidity, 0.15% creator. Proposed auction policy: no additional project auction fee; auction receipts are not hook trading volume or reward funding.
- Direct claims gaining more than 64 whole FUEL exceed FuelCore's mutation limit. CCA claims deliver the full bid allocation to the recorded bid owner; its batch claim API does not solve this. Prove a bidder-bound escrow/delivery adapter that owns auction entitlements and releases bounded FUEL amounts to the beneficiary. A validation hook must enforce the supported sender/owner relationship, and token entitlements and currency refunds must both remain attributable to that bidder. Configure the selected escrow custody before accepting its bid and before FuelCore activation; do not rely on a frontend-only bid cap or simply raise the mutation limit.
- Seed liquidity before FUEL trading opens. Current post-launch PoolManager settlement authorization is specific to an active canonical-router swap. Migration must not need an indefinite exemption from that policy.
- Enforce migration-before-activation onchain through coordinator-controlled activation or a narrow immutable launch guard. Current FuelCore.launch checks a sealed registry and recovery threshold, not seeded liquidity; script order and frontend readiness alone cannot prevent premature activation. Test that even the owner cannot activate without verified seeding.
- Preserve permanently locked liquidity with no administrative withdrawal or alternate recipient. Stock migration sends LP positions to a configured recipient; it does not by itself lock them. Use a verified permanent position custodian compatible with our WETH pool. Prove actual ownership and callable paths; “LP recipient configured” alone is insufficient.
- Make successful migration, economic accounting, launch opening, and supported recovery actions safe against duplicate execution. Stock LBP migration is one-shot: a caught initialization/position failure can return a successful transaction with `MigrationFailed` and `FundsRecovered`, transferring proceeds and reserve to the configured recipient without creating liquidity. It cannot simply be retried for that auction. Bind this recipient to protected recovery custody; the first milestone must select and prove an immutable recovery-seeding path or a custom strategy with atomic, retryable migration. Never open trading from receipt status alone, and never leave successful-auction bidders in permanent claim limbo as the recovery policy.
- The current hook only enables swap callbacks; it does not protect pool initialization. Add the stock strategy's required initialization interface and one-time authorized callback, update registry permission bits and hook-address mining, and protect the exact intended liquidity deposit. An outsider must not preinitialize the announced pool at an arbitrary price while bidding runs. Any additional recovery initializer authority must be narrowly tied to the verified terminal-failure state, not a general administrative override.

Build the deployment composition for CCA from the outset. Set custody flags, initializer permissions, supported venue inventory, fixed recipients and lifecycle gates on the new contracts before auction funding. Existing addresses, sealed settings, and balances place no constraints on this design. There is one active CCA deployment path for the new phase, with no dual-mode compatibility requirement.

## Milestones and acceptance gates

### 1. Prove a complete fresh deployment and auction-to-pool handoff

Timebox the first engineering day to the highest-risk integration questions. Pin the upstream commit, verify the listed Base Sepolia deployment bytecode and versions or deploy the pinned source locally, and build a clean deployment test using new instances of our actual FuelCore, registry, router, hook, and discovery adapter. A newly deployed FuelCore uses the launcher's “existing ERC-20” API because we supply our own token implementation; this API name does not imply an old token or old balances. Prove atomic deposit/distribution with the required Permit2 approvals and all transfer endpoints configured; do not leave a deposit stranded in the singleton launcher.

Required evidence:

- Two bidders with different maximum prices; allocation, spent currency, unused funds, and remaining inventory reconcile exactly.
- Auction completion seeds the intended dynamic-fee PoolKey with our hook, using a locked position and the correctly oriented discovered price.
- Migration completes before opening FUEL trading; an ordinary canonical buy and sell then work with the existing fee split.
- One bidder acquires over 64 FUEL and receives the full entitlement through bounded delivery without duplicate, lost, or infrastructure-owned Crafts. Partial balances and multiple bids are covered.
- Failed minimum raise permits the intended refunds; delayed migration, reverted transactions, and the stock strategy's caught terminal failure each have explicit tested outcomes. In particular, a successful receipt carrying `MigrationFailed` must not mark the market ready. Verify recovery custody and the selected recovery-seeding/custom-strategy path as well as bidder entitlements.
- Unexpected pool initialization cannot redirect proceeds or force acceptance of an invalid price.

Exit condition: executable proof of these properties, not a successful auction with a generic ERC-20. If the stock strategy cannot satisfy them, isolate a custom migration strategy around unchanged CCA accounting and re-estimate before expanding the UI work.

### 2. Specify economics and implement the lifecycle

Use an integer scenario model to choose a testnet auction allocation, reserve, minimum raise, floor, duration, tick spacing, and liquidity ranges. Compare low-demand, normal-demand, and high-demand outcomes; account for the difference between cumulative auction proceeds and the final marginal clearing price when determining usable liquidity. A simple reserve/proceeds ratio is not proof that every asset fits the intended position.

Recommended starting policies for evaluation: no team allocation, no additional auction fee, and auction proceeds dedicated to locked liquidity. Specify immutable destinations for unsold tokens, excess proceeds, and dust; these policies are proposals until the model and source behavior are checked. Do not choose production economic values during a testnet integration.

Implement a launch-specific module that owns funding, pool-seeding readiness, locked positions, and delivery coordination. Keep auction settlement and discovery responsibilities separate. Redeploy ProtocolLiquidityVault for later WETH-only fee cycles; its reusable implementation is not a replacement two-asset genesis vault, and a direct WETH transfer does not populate its queued accounting. Explicitly model failed auction and pool-seeding recovery; do not invent a general refund of successful auction purchases if upstream CCA does not provide it.

Specify the ordering of trading, bidder delivery, Discovery finalization, and Commitment. Current rewards give the first ordinary Permanent Collectible in a track the accumulated Unclaimed Track Pot. Preserve that rule explicitly or make a separate product decision; do not promise auction bidders equal or retroactive rewards merely because they bid together.

Revise the deployment scripts, typed manifest, ABIs, health checks, and readiness reader together. Record a superseding ADR for ADR 0004 during implementation and reconcile ADR 0002's blocked-venue inventory. Preserve ADR 0001's supply and secondary-market economics and ADR 0014's discovery fairness guarantees. Update CONTEXT.md only when the replacement design is accepted and implemented.

Exit condition: successful and failure deployment harnesses pass with fixed addresses/destinations verified and no unintended authority to withdraw liquidity or change auction economics after funding.

### 3. Add the auction experience and history

Build the auction route on the existing Privy transaction and receipt-recovery patterns. Include approval, bidding, pending/replaced/reverted transactions, wallet and chain changes, refresh recovery, exit/refund actions, and bounded FUEL delivery. Show a user's total entitlement, delivered amount, and amount still awaiting delivery independently of discovery progress.

Extend the protocol reader and public API with deployment-bound launch state. Preserve block-pinned onchain reads as authority for action eligibility. Index auction events as explicit custom entities alongside the existing standardized market schema; do not encode bids as AMM swaps or auction proceeds as hook fees. Reuse the existing Graph free-service budget and historical read model responsibilities.

Exit condition: both embedded and external wallets complete bidding and delivery, and existing trade, Discovery, Launch, and Stock Reward claim regressions pass. The UI remains usable during indexing lag, refund eligibility, migration delay, and delayed discovery.

### 4. Deploy, verify, and prepare the submission

Deploy the complete fresh stack on Base Sepolia with clearly labelled new test assets and verified source/version/address records. Do not assume that a Base mainnet launchpad address exists on Base Sepolia. Generate a new canonical manifest and bind the frontend, API, operator, faucet and indexers to it. Begin indexing from this deployment's actual start blocks in a fresh namespace; do not import prior activity. Deployment-bound receipt recovery must reject old transaction intents. Retaining old deployment files for reference does not create an operational dependency on them.

Verify the clean start explicitly: supply is 4,444 before commitments, no prior holder allocations exist, no prior collectible ownership or pending discoveries exist, personal and shared reward accounting starts empty, and the canonical pool/auction belong to the new manifest. Project test funds are minted/funded afresh and separately from FUEL allocation. Repeat the deployment in a clean local environment to prove no dependency on old contracts, cached configuration, or databases.

Capture one complete live journey: Privy sign-in → bid → successful auction → locked hooked liquidity → FUEL delivery → Craft discovery → canonical trade → Launch → Stock Reward claim. Capture a separate refund/failure example and a large allocation delivered in batches. Use a short demo auction and an already-completed example so judges can inspect both phases without waiting through a long sale.

Run relevant Foundry lifecycle, accounting, invariant, and discovery tests; local deployment and Base Sepolia fork checks; manifest/schema checks; frontend type/lint/build checks; and browser testing of the changed journey. Follow the repository's Chrome/macOS fallback if preview is unavailable. This planning task does not run implementation tests or send transactions.

Publish a reusable integration explanation and update README and FEEDBACK.md with actual findings. The entrant still submits the feedback form and ETHGlobal entry. Do not claim a listing in the Uniswap app or an upstream contribution unless it actually exists.

## Work areas

| Area                                                                   | Expected changes                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/liquidity/` and new launch module              | Auction migration, immutable custody/destinations, locked liquidity and bounded delivery             |
| `packages/contracts/src/FuelCore.sol`, `market/`                       | Only proven lifecycle/compatibility changes; preserve discovery and canonical settlement protections |
| `packages/contracts/script/`, `scripts/deploy-protocol.ts`             | Auction-aware deployment and staged launch verification                                              |
| `packages/config/src/deployment-manifest.ts`, `packages/protocol/src/` | Versioned auction addresses, lifecycle reads, transaction encoding and readiness                     |
| `apps/web/`, `apps/api/`                                               | Auction UI, receipt recovery, explicit refund/delivery states and bounded queries                    |
| `subgraphs/orbit-market/` and historical read model                    | Auction event projection with separate market accounting and new deployment identity                 |
| Domain docs, launch economics model, README, FEEDBACK.md               | Superseded launch decision, exact economic assumptions and reproducible evidence                     |

## Delivery expectation

This is a contract lifecycle change, not a small auction widget. Provisional planning range: roughly one to two focused engineering weeks for the complete testnet flow, including verification, assuming the first-day spike finds a contained migration and delivery solution. This is an estimate, not measured implementation work. ETHGlobal lists the event as September 4–16, leaving about eight calendar days from this plan's date; the upper end of that estimate does not fit. Verify the exact submission cutoff in the entrant dashboard rather than assuming the event end date is the deadline. [Official event listing](https://ethglobal.com/events).

The aggressive hackathon target is: first-day fresh-deployment feasibility proof; two days for contract lifecycle and accounting; two days for UI/readers and the minimal event projection; then two days for full deployment, end-to-end verification, and submission evidence. Re-estimate immediately after the first milestone. Keep a compact single-auction experience with fixed tested parameters, rather than an auction-creation platform. If time is short, reduce auction analytics and decorative UI before cutting refund, custody, locked-liquidity, or discovery tests. An unresolved contract gate means the complete CCA flow is not ready to present as working. The plan allocates no time to old-state migration or maintaining two launch modes.

Production work remains separate: economic parameter selection, review of custom contracts, durable auction operations, and production discovery/service readiness. Completing the testnet plan is not evidence of production readiness.
