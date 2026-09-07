# ETHOnline 2026 sponsor integration plan

Plan date: 8 September 2026. Status: proposed implementation, with technical gates below. Target **Uniswap Foundation + The Graph + Privy**, on **Base Sepolia**, using **free tiers only**. Start Fresh is confirmed by the user. Allow four to five focused development days; both service accounts need setup.

The product story is one complete collecting loop: **sign in → receive test funds → buy FUEL → discover a Craft → review and Launch → understand and claim rewards**. Privy removes the wallet-installation requirement, Uniswap powers the market and fee allocation, and The Graph makes the funding history inspectable. Every new dependency must improve that journey.

## Prize targets and evidence

| Sponsor and target                                                                         | Published qualification requirements relevant to this plan                                                                                                                                            | Evidence we will deliver                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniswap: Best Uniswap Stack Contribution, up to three $1,000 awards                        | Build on the Uniswap stack; public open-source repository; `FEEDBACK.md`; developer feedback form linking that file; README links to relevant contracts and code lines.                               | A live canonical v4 trade, actual hook-fee allocation and downstream reward/liquidity evidence; contract/address links; reproducible integration notes and useful developer feedback. |
| The Graph: Best Use of Composable or Standardized Graph Products, $2,500 / $1,500 / $1,000 | Meaningfully use a standardized schema **or** compose at least two Graph products; consume live provider data; explain the benefit of standardization; public repository and two-to-four-minute demo. | A deployed standardized DEX subgraph with hook/reward extensions, a visible product view consuming it, and the identical standard query working against a second live protocol.       |
| Privy: Best financial flow, $2,500                                                         | Privy is core; at least one Privy wallet; a functional financial flow using a generally available feature; working demo/source; clear UX benefit.                                                     | Email-created embedded wallet completing a real Base Sepolia purchase and reward claim, with funding, review, receipt and recovery states demonstrated.                               |

The second-protocol query and the full buy-to-claim journey are proposed competitive evidence, beyond the minimum wording of those prizes. Gas sponsorship is not a stated Privy requirement. The published criteria guide implementation; passing our checks does not guarantee a prize. Sources: [Uniswap](https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation), [The Graph](https://ethglobal.com/events/ethonline2026/prizes/the-graph), [Privy](https://ethglobal.com/events/ethonline2026/prizes/privy).

## Scope decisions

- Keep Base Sepolia and the manifest-bound Canonical Market. All demonstrated assets remain clearly labelled valueless test assets.
- Use Privy email onboarding plus external wallets, with one explicit active wallet. Use an embedded EOA for the baseline and the existing faucet for native test ETH and test WETH.
- Use a managed Studio subgraph for standard market activity and a new reward-funding explanation. Preserve the existing Historical Read Model for its current responsibilities.
- Allocate effort to the existing v4 hook's presentation, reusable integration evidence and feedback. Change contracts only if a demonstrated correctness defect requires it.
- ENS, another chain, AI features, paid onramps and paid gas sponsorship are outside this implementation scope.

## 1. Prove the two new dependencies first

Timebox the first day to account setup and small working integrations. These checks precede a full wallet migration or analytics UI.

### Privy proof

Create a Developer app; configure localhost and the actual staging origin, email login, embedded Ethereum wallets and Base Sepolia. Verify the installed SDK's React/wagmi peer compatibility before choosing pinned versions.

From a fresh browser session, create an embedded wallet, sign the existing faucet ownership challenge, receive native test ETH and test WETH, approve the canonical spender, and buy FUEL through the existing router. Save the actual receipt and verify the resulting holdings using the current protocol reader. Refresh and reconnect to the same address. Also connect an existing external wallet and verify that selecting it changes the transaction account explicitly.

**Pass:** a real Privy-created wallet completes that purchase on the official Base Sepolia deployment without introducing a new custody address, manual external funding requirement, or broken receipt recovery. Email login alone does not pass.

### Graph proof

Create a free Studio account. Generate the data-source configuration from the checked deployment manifest and verified pool initialization block, including exact PoolManager, PoolId, hook and protocol addresses. Deploy a minimal mapping that indexes one real canonical swap and its fee event. Inspect `_meta`, indexing health and the live result.

Start the schema review with **Messari DEX AMM 1.3.2**, pin its upstream revision, and assess every required field before adopting it. This is a candidate until its v4 and test-asset semantics pass review. Specifically:

- A v4 pool is identified by a PoolId within a PoolManager; it has no individual pool contract address. Preserve that identity explicitly and document its adaptation to the standard ID.
- Required USD fields cannot silently treat an unavailable price as zero or value test WETH at mainnet WETH prices. Use real token-native quantities. If a declared zero-value test deployment cannot preserve the standard's meanings, revise the schema choice before implementation proceeds.
- Standard LP rewards and LP fee revenue cannot describe the collectible Stock Reward allocation. Represent these with separate extensions.
- Pool inventory cannot be inferred from the singleton PoolManager's total token balances, and a concentrated-liquidity position does not imply a 50/50 inventory split.
- Select a live compatible reference protocol from Graph Explorer and run the identical token-and-swap query against both endpoints. Record the schema version, endpoint, variables and successful responses. The reference endpoint is still unverified.

**Pass:** live indexing, correct event amounts, a defensible field-mapping document, and a working shared query. Compilation or matching entity names alone does not pass. If this is not feasible within the timebox, retain the product's working history and reassess The Graph slot; an ordinary custom subgraph would not satisfy this target prize.

The technical sources, proposed shared query and known schema limitations are in [integration feasibility](../research/ethonline-2026-integration-feasibility.md). The [Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph) explicitly permits authoring or extending standardized subgraphs.

## 2. Make Privy the collector's working wallet

### User experience

The connect control opens one chooser offering email and an existing wallet. A new email user gets an embedded wallet when ready to interact. The funding step shows what the faucet supplies, requests the existing ownership proof, and reports its actual outcome. It then returns the collector to their intended purchase.

Keep the transaction review, price/slippage information, allowance review and explicit irreversible Launch confirmation. After buying, Pending Discovery remains visible until the real draw is delivered. Once an Orbiter has a positive claim, the same embedded wallet can claim to its own address and inspect the receipt. Trading and claims remain usable when analytics is unavailable.

### Implementation seam

Use `PrivyProvider → QueryClientProvider → WagmiProvider`, with `createConfig` and `WagmiProvider` supplied by `@privy-io/wagmi`. Preserve the existing public-read and transaction-RPC separation. Privy owns connector configuration; the app owns the selected collector account and existing transaction lifecycle. See [Privy's wagmi integration](https://docs.privy.io/wallets/connectors/ethereum/integrations/wagmi).

Primary edit targets:

- `apps/web/src/providers/wallet-provider.tsx` and `apps/web/src/lib/wagmi.ts`: provider, supported chain and connector integration.
- `apps/web/src/components/connect-wallet-action.tsx`, `wallet-control.tsx` and `wallet-connection-action.tsx`: one login chooser, active-wallet controls and focus restoration.
- `apps/web/src/providers/wallet-restoration.tsx` and `protocol-client-provider.tsx`: distinguish SDK loading, signed-in/no-wallet, active wallet, wrong chain and disconnection; invalidate account-bound reads and admin sessions correctly.
- Existing funding and transaction modules: adapt only where required by the wallet provider, keeping hash-based receipt recovery and submitted-action persistence.

Do not silently switch a connected collector to a newly created embedded address. Switching wallets must not move NFTs, allowances or pending transaction records between accounts. A Privy login grants no application admin role. Preserve external-wallet signing and funding-challenge verification.

### Free-tier boundary

The baseline uses the Developer plan and the existing testnet faucet. At setup, verify how the account handles free-tier limits, enable the available abuse controls, and keep paid upgrades and overages disabled. Privy's free wallet plan does not establish free native gas sponsorship. Sponsorship is an optional final enhancement only if the new dashboard verifies no-charge credits, a hard spending cap, and a recoverable transaction-submission path. It is not on the critical path. [Privy pricing](https://www.privy.io/pricing), [gas documentation](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview).

## 3. Make The Graph explain the market and reward funding

### Visible product improvement

Add a compact **Where rewards came from** disclosure to the Rewards view. It shows, at a stated indexed block:

1. Recent Canonical Market swaps, through the standard schema.
2. The actual WETH-side fees and their reward, liquidity and creator allocations.
3. Reward Epoch openings, completed conversions and emitted deferred-budget evidence by Reward Track.
4. Reward notifications and completed claims, with transaction links and exact test-token amounts.

Use concise labels and existing visual components. Show freshness and a useful loading/error state. The main claim amount still comes from current block-pinned contract reads. Delayed analytics must never disable a valid claim or imply that an Orbiter has no rewards.

This is aggregate funding provenance. Fees are pooled; `TrackExecuted` contains no epoch number and deferred budgets can span openings. Do not fabricate a one-to-one claim that a particular swap funded a particular collector payout, or infer a failed Keeper attempt from the absence of a success event.

### Data model and correctness

Implement the standard protocol/token/pool/swap/liquidity fields that the accepted schema requires. Add narrowly scoped hook-fee, epoch, conversion, notification and claim entities. Derive fees from `FeeAccrued`, including integer rounding; do not reconstruct them with floating-point percentages. Separate actual emitted allocations from current contract balances.

Use PoolManager `Swap` events filtered by the exact PoolId and the first-party events `FeeAccrued`, `PotPulled`, `ProtocolLiquidityAdded`, `RewardEpochOpened`, `TrackExecuted`, `RewardNotified` and `RewardClaimed`. Link events using receipt identity, source address and log order. A transaction can contain more than one swap: never zip swap and fee arrays or join solely by transaction hash without proving the contract's ordering invariant. Leave ambiguous links explicit.

Every response is bound to the expected chain, deployment, subgraph version and indexed block. Pin all pages to one supported Graph block snapshot, use bounded deterministic pagination, and reject incompatible deployment metadata. Inspect indexing errors and compare the returned block hash with the chain where supported. Distinguish partial/stale history from an empty successful query. Reorgs or a deployment change invalidate cached aggregates.

### Small interfaces and hosting

Proposed modules and paths:

| Location                                             | Responsibility                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `subgraphs/orbit-market/`                            | Pinned standard schema, explicit extensions, manifest-derived configuration, mappings, methodology and reusable sample queries. |
| `apps/api/src/graph-analytics.ts`                    | Server-side Graph client, bounded fixed queries, deployment validation, shared cache and quota handling.                        |
| `packages/config/src/public-api.ts`                  | One typed, bounded read endpoint for reward-funding analytics, proposed as `GET /v1/analytics/reward-funding`.                  |
| `packages/protocol/src/reward-funding.ts`            | Provider-independent response decoding and view data; no wallet write permissions.                                              |
| `apps/web/src/components/rewards/reward-funding.tsx` | Disclosure using the existing Rewards layout and transaction-link components.                                                   |

Use the existing VM public API. Keep any Graph API key server-side, allow only fixed query shapes, and reuse the API's origin/rate/timeout controls. Studio's development endpoint allows 3,000 queries/day; the free Network allowance is separate. Deploying to Studio is sufficient for this prize's live-provider requirement, so paid publication is unnecessary. [Studio limits](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/).

Start with on-demand fetching, a shared two-minute cache for the public aggregate, no background polling on hidden pages, and a provider-call budget of at most 2,000/day including retries and pagination. Enforce the budget across worker restarts and expose cached age when serving retained data. This leaves capacity for proof queries and judging; the actual account quota is checked during setup. A single cache refresh should combine the standard and extension selections in one Graph request where possible.

### Existing architecture decision

[ADR 0009](../adr/0009-own-a-typescript-sqlite-historical-read-model.md) makes the project-owned Historical Read Model authoritative for historical presentation; [ADR 0010](../adr/0010-expose-a-vm-owned-public-api.md) owns the public API boundary. Adding Graph-backed analytics is a proposed extension to those decisions and must be recorded explicitly during implementation.

The SQLite worker retains its current history endpoints, shared checkpoint and offchain Keeper-attempt journal. It also provides a parity reference for overlapping onchain events. This plan does not assume that Graph can reconstruct unbroadcast intents, failed attempts or application receipt-recovery state. Replacing the complete indexer would exceed the available scope and carries no additional qualification benefit by itself.

## 4. Present the Uniswap contribution clearly

The Canonical Fee Hook already supplies the product's central market mechanism. Focus its submission on observable behavior and a reusable explanation:

- Link the canonical PoolManager, PoolId, router and hook from the manifest to verified source. Explain the WETH-side 3% allocation: 2% rewards, 0.85% locked liquidity and 0.15% creator, including rounding and direction handling.
- Show a real buy or sell receipt, its hook event, a completed reward conversion and a claim. Show a liquidity-cycle receipt when available. Explain why the immutable market and destinations matter to collectors.
- Provide a short integration walkthrough and reproducible queries/tests that help another v4 developer understand the fee accounting.
- Write `FEEDBACK.md` from actual integration findings, linking concrete reproduction steps and relevant code. Prepare the required [feedback form](https://developers.uniswap.org/hackathon-feedback) with the public file URL for the submission owner.

Keep swaps on the existing canonical route. Privy supplies the wallet; it does not select a generic swap route that bypasses the hook. The Graph describes emitted behavior; it does not control settlement.

## Delivery sequence

| Day              | Deliverable                                                                                                   | Exit condition                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — 8 September  | Account setup, Privy purchase proof, Graph mapping/schema/reference-query proof; capture current UX baseline. | Both new integrations have a working free path and the Graph schema gate has a defensible resolution.                                  |
| 2 — 9 September  | Complete Privy provider migration and collector funding flow.                                                 | Embedded and external wallet journeys pass; account switching and refresh preserve correct ownership and transaction state.            |
| 3 — 10 September | Complete standard mappings, extension queries and bounded API; reconcile live receipts.                       | Real activity powers the Rewards disclosure and identical standard query works on the reference protocol.                              |
| 4 — 11 September | Focused failure tests, production browser matrix, performance comparison and submission evidence.             | Full embedded-wallet buy → Discovery → Launch → positive claim proof; Graph lag/outage states and external-wallet regression verified. |
| 5 — 12 September | Fixes, final demo recording, README/feedback links and submission preparation.                                | Public source, deployed demo, all evidence links and sponsor-specific requirements checked.                                            |

Treat the dates as a proposed allocation of the available focused days. If only three days remain, keep one email method, one analytics disclosure and the required proofs; cut optional sponsorship and extra visualizations. Do not save time by dropping recovery behavior or the shared-schema evidence. The event submission deadline is **13 September 2026, 21:30 IST**. [Event details](https://ethglobal.com/events/ethonline2026/info/details).

## Validation and quality gates

Before wallet changes, record the current production bundle and representative browser measurements. After integration, repeat the same scenarios and separately time live email onboarding. Compare successful completion, required user actions and failure recovery, not just appearance. Existing performance numbers in [collector performance](./collector-performance.md) are fixture measurements, not a live-user baseline.

Required wallet checks: fresh email user, returning user, external wallet, explicit active-wallet switch, wrong-chain recovery, rejected signature, faucet cooldown/unavailability, allowance-and-reload, submitted-transaction reload, account change during a pending action, delayed Discovery and a positive reward claim. Confirm the faucet's signed proof works with the embedded wallet.

Required Graph checks: exact swap/fee amounts in both trade directions, event correlation, duplicate handling, deterministic pagination, indexing lag, provider failure/quota exhaustion, manifest mismatch and reorg/cache invalidation. Reconcile a fixed block range with chain receipts and the existing indexed events. Missing coverage must not be reported as zero activity.

Follow [targeted local validation](../agents/local-validation.md): focused tests during edits, then `pnpm check`, API/protocol/web suites as selected by changed paths, and the web production gate. Add subgraph codegen/build and mapping or fixture-replay checks. Run the relevant browser slice while working and the full [production matrix](./browser-matrix.md) once before release. Use Chrome and its documented connection recovery when preview is unavailable.

## Demo and submission package

Prepare one coherent video of roughly three minutes, within the two-to-four-minute requirement:

- **0:00–0:25:** Explain the collecting loop and that the demo uses Base Sepolia test assets.
- **0:25–1:15:** Email login, funding and a canonical v4 purchase from the embedded wallet; show the resulting Discovery state and receipt.
- **1:15–1:50:** Review and Launch a delivered Craft, then claim a positive reward from a prepared eligible Orbiter. Clearly identify the prepared state rather than implying rewards arrive instantly.
- **1:50–2:35:** Open reward-funding history; connect emitted fees, completed conversions and claims. Show the identical standard query on ORBIT and the reference protocol.
- **2:35–3:00:** Explain the reusable v4/schema contribution and measured onboarding improvement; show source and evidence links.

Use actual footage and a human voice, export at 720p or higher, and edit out waiting without speeding up playback. Prepare enough test ETH, test WETH, delivered Crafts and a positive claim before recording so external settlement latency does not consume the video. Keep live refresh and working endpoints available to judges. [ETHGlobal demo requirements](https://ethglobal.com/events/ethonline2026/info/details).

Completion artifacts: public repository and app URL; deployment and transaction links; Graph endpoint/version and shared-query responses; schema methodology; Privy setup instructions containing no secrets; before/after UX evidence with measurement limits; `FEEDBACK.md`; prepared feedback-form content; AI-assistance attribution identifying relevant files and any required specs/prompts; and a README mapping each sponsor to exact implementation paths and final commit line anchors. Account login, email verification, human voice recording and final external submissions need the relevant account owner when those steps arise.

## Ready-to-start decisions

The chain, three sponsor targets, free-only budget and onboarding approach are resolved. The remaining technical questions are the day-one Graph schema semantics/reference endpoint and the real account limits. Native sponsorship may remain disabled throughout. No implementation, account creation, deployment or external submission is represented as complete by this plan.
