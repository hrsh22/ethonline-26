# ETHOnline 2026 sponsor selection and prize requirements

Research date: 2026-09-08. Primary sources are the current ETHGlobal event rules and individual sponsor pages, plus Ledger's event guide. This is a recommendation and eligibility audit; no integration or registration was changed.

## Recommendation for ORBIT 4444

For the user's stated **Start Fresh track and 3–5 focused development days**, shortlist **Uniswap Foundation + The Graph + Privy, staying on Base**, subject to the chronology issue below. Uniswap is the anchor; Graph and Privy must earn their scope through an early working proof. With three days, prioritize Uniswap plus whichever new integration proves strongest. With five days, target all three only if the first day proves both additions without reducing core reliability. Published award counts do not establish winning probabilities: competitor counts, submission quality, and sponsor discretion are unknown.

1. **Uniswap: make the existing integration an excellent submission.** The Canonical Market already depends on a custom Uniswap v4 hook and router. Demonstrate how a real buy produces the fee split and advances the collectible economy; show exact contract references, successful transactions, and resulting user-visible state. This directly fits the sponsor's stack-contribution category, with up to three $1,000 awards for the unmarked/general track. Finish its feedback requirements. [Market decision](../adr/0002-enforce-a-single-uniswap-v4-market.md), [deployment evidence](../deployments/base-sepolia-84532.md), [Uniswap prize](https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation).
2. **The Graph: prove a standardized, hook-aware history contribution.** Build a real shared DEX schema with ORBIT-specific fee/reward extensions, serve live hosted data, and use it for a useful collector view connecting trading to reward funding. Demonstrate that a common query works across this schema and another standard implementation. Target the composition/standardization category: **$2,500 / $1,500 / $1,000**. A raw bespoke subgraph or an isolated query is insufficient. Keep operator attempt journals and safety-critical direct reads; scope this as a historical-data contribution rather than an automatic replacement of the entire worker. Details and feasibility limits follow below. [Graph event guide](https://thegraph.com/blog/hackathon-resources/), [Historical Read Model decision](../adr/0009-own-a-typescript-sqlite-historical-read-model.md).
3. **Privy: pursue the $2,500 financial-flow award only if it improves the complete journey.** Proposed proof: email-created wallet → existing test-WETH faucet → Canonical Router purchase → Discovery Draw → optional, explicitly reviewed Launch → reward claim. Preserve external-wallet access, reconnect/session behavior, recovery, and the explicit irreversible Commitment review. The current implementation disables email, social login, and onramp, although README copy mentions email wallets. Reown could also enable email, so swapping login providers alone is insufficient justification. Compare the complete supported financial journey and prove contract/signing compatibility before committing to Privy. [Current wallet provider](../../apps/web/src/providers/wallet-provider.tsx), [domain](../../CONTEXT.md), [Privy prize](https://ethglobal.com/events/ethonline2026/prizes/privy).

Existing VRF alone does not qualify for Chainlink's general confidential-workflow prize. ENS requires ENSv2 on Sepolia, and 1inch requires Aqua rather than a swap API. A chain migration supplies no published Uniswap prize bonus and introduces fresh deployment, asset, oracle, and wallet validation. EVM compatibility alone does not establish compatibility with this complete product. Keep the third slot empty if either addition fails its proof; a reliable, understandable demo is the stronger submission. Qualification details below.

## The Graph and chain compatibility

**The Graph can index the current Base Sepolia deployment through managed Studio.** The supported-networks page's published data lists `base-sepolia` (`84532`) with `Subgraph Studio`, the Studio deployment endpoint, and `full` subgraph support. Base (`8453`) and Unichain (`130`) also have full support; Unichain Sepolia (`1301`, identifier `unichain-testnet`, alias `unichain-sepolia`) has basic hosted support. These are available network capabilities, not evidence that an ORBIT subgraph has already been deployed. [Graph supported networks](https://thegraph.com/docs/en/supported-networks/), [Base Sepolia network](https://thegraph.com/docs/en/supported-networks/base-sepolia/), [Base network](https://thegraph.com/docs/en/supported-networks/base/), [Unichain network](https://thegraph.com/docs/en/supported-networks/unichain/).

Studio hosts deployed subgraphs for testing and staging; a deployment is distinct from publishing to the decentralized network. Its development query URL currently allows **3,000 queries/day**, and an account can have three deployed unpublished subgraphs. API keys, version status, indexing logs, and publishing/billing are managed in Studio. Avoid public polling that exhausts the development quota. Live Studio data is explicitly accepted by this event's Graph bounty; a network-published deployment is not stated as mandatory. [Studio deployment guide](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/), [Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph).

Managed Studio changes the operational comparison in ADR 0009: its rejected Graph option specifically involved self-hosting Graph Node, PostgreSQL, and IPFS. It does **not** eliminate schema/mapping work or the project's canonicality, coverage, pagination, current-ownership, and failure-state requirements. The SQLite worker also retains offchain operator attempts that successful contract events cannot reconstruct. Preserve that journal and its recovery responsibilities. If implementation changes the authoritative Historical Read Model, explicitly update the accepted architecture decision. [ADR 0009](../adr/0009-own-a-typescript-sqlite-historical-read-model.md).

**One subgraph can satisfy the standardization route; two products are not mandatory.** This is an interpretation of the bounty's alternatives: meaningful standardized-schema work **or** composition of multiple Graph products. Authoring/extending a standardized subgraph is expressly in scope. Qualification still requires live data and evidence of the shared schema's value. [Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph).

The Graph defines standardized schemas as shared entities, fields, and metric semantics across protocols. Protocol-specific extensions are explicitly permitted while preserving the base contract. Its documented DEX models include `LiquidityPool`, `Swap`, fees, and snapshots; the concentrated-liquidity extension adds ticks and positions. Thus an ORBIT-specific fee/reward extension can coexist with a real standardized DEX base. Reusing field names without preserving their meanings is not a standards contribution. Do not label valueless test-WETH or test-stock quantities as real USD value merely to fill required metrics. [Standardized schema documentation](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/).

There is useful reference code but no verified drop-in standardized v4 solution: the current Messari repository directory lists Uniswap v2/v3 families and no Uniswap-v4 directory. Uniswap separately maintains an official v4 subgraph with its own schema and Base/Base Sepolia/Unichain network configurations. Its existence does not establish Messari-schema conformance. A standardized adapter or mapping would be new work; review its GPL-3.0 licensing before copying implementation. [Messari implementations](https://github.com/messari/subgraphs/tree/master/subgraphs), [official v4 subgraph](https://github.com/Uniswap/v4-subgraph), [v4 schema](https://github.com/Uniswap/v4-subgraph/blob/main/schema.graphql), [v4 network configuration](https://github.com/Uniswap/v4-subgraph/blob/main/networks.json).

| Network                | Official Uniswap v4 PoolManager              | Graph managed subgraph support |
| ---------------------- | -------------------------------------------- | ------------------------------ |
| Base, 8453             | `0x498581ff718922c3f8e6a244956af099b2652b2b` | Full                           |
| Base Sepolia, 84532    | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | Full                           |
| Unichain, 130          | `0x1f98400000000000000000000000000000000004` | Full                           |
| Unichain Sepolia, 1301 | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | Basic hosted                   |

Uniswap also publishes chain-specific periphery deployments; do not assume identical addresses across EVM chains. The existing Base Sepolia PoolManager matches the official address. A move to Unichain is technically plausible for v4/Graph but unnecessary for these prizes; separate oracle/reward-asset checks remain mandatory before considering a product migration. [Official Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), [Graph support matrix](https://thegraph.com/docs/en/supported-networks/), [current deployment](../deployments/base-sepolia-84532.md).

## Privy feasibility

Privy's native app-paid gas service lists **Base Sepolia**, Base, Unichain, and Unichain Sepolia. On EVM it uses EIP-7702/paymasters and can sponsor an embedded wallet without creating a separate ERC-4337 account. This could remove the separate native-ETH faucet step while retaining the test-WETH purchase flow. It still needs account configuration/credits and a real proof against ORBIT's signatures and contracts; no integration has been tested here. Gas sponsorship does not fund the purchase asset itself. [Privy gas sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview).

Privy's React network configuration documentation also explicitly lists **Base Sepolia (`84532`)** as supported, including Privy RPC support; configure `defaultChain: baseSepolia` and `supportedChains: [baseSepolia]` for this deployment. [Privy EVM network configuration](https://docs.privy.io/basics/react/advanced/configuring-evm-networks).

## ENS alternative: collector callsigns and portable fleet profiles

**ENS is a credible reserve option, but it currently ranks behind a working Privy onboarding improvement and a useful Graph history contribution.** Its strongest fit is a collector-controlled identity/profile, not renaming individual NFTs. The published general ENSv2 awards are **$1,500 / $1,500 / $1,000 / $500**; its explicitly marked Continuity integration award is **$500**. Four general awards do not imply better winning odds without entrant data. A normal name/avatar lookup does not satisfy the requirement that ENSv2 materially improve the product. [ENS prize requirements](https://ethglobal.com/events/ethonline2026/prizes/ens).

Proposed user flow: claim a unique callsign under a team-controlled **test** namespace, choose a representative Craft, and publish a portable fleet profile. Another collector can look up that callsign and view its current Base Sepolia holdings; an optional gifting flow can resolve the recipient without copying an address. Namespace availability and parent control need to be established, not assumed. Make profile discovery, portable records, and controlled editing the feature's purpose; demonstrate real registration and resolution rather than hardcoded names.

ENSv2 Permissioned Registries support owned ERC1155 singleton names and per-name control of resolver/subregistry/renewal/transfer rights. A subname should point to the collector's own Permissioned Resolver, or its owner must receive explicit resolver permissions: owning the registry token alone does not grant permission to write records in a parent's resolver. Document retained parent/administrator rights rather than describing every subname as unconditionally independent. [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/), [app write guidance](https://docs.ens.domains/ensv2/tutorial-app-developers/).

**Scoped profile editing is real ENSv2 functionality.** The collector can delegate only selected text keys such as `avatar` and a fleet-profile URL to a profile editor, then revoke that access. `authorizeTextRoles` scopes permission to one key; `authorizeAddrRoles` independently controls a chain's recipient address. Demonstrate an allowed avatar/profile update, a rejected address change, and a rejected write after revocation. Avoid broad root or name-wide grants for this purpose. These controls make delegation meaningful without handing the editor funds or claim authority. [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/), [Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control/).

**Keep the callsign attached to the collector, independently of Craft ownership.** A Base NFT transfer should update the live fleet display, not trigger an ENS name transfer on Ethereum Sepolia. ENS record data is a profile pointer, never ownership proof; Base contract state remains authoritative for current inventory and claims. If transferring the callsign itself is later supported, treat it as a separate explicit action: registry owner roles move, but grants to other accounts survive a name transfer. Resolver records and delegations need explicit lifecycle handling. This avoids adding crosschain NFT/name synchronization to a 3–5 day build. [Registry transfer semantics](https://docs.ens.domains/ensv2/permissioned-registry/), [resolver record lifecycle](https://docs.ens.domains/ensv2/permissioned-resolver/), [ORBIT domain](../../CONTEXT.md).

**Base Sepolia can stay.** ENSv2 registration/profile writes run on Ethereum Sepolia; use a separate Sepolia client for ENS and the existing Base Sepolia client for protocol actions. Resolve the destination chain's address using `coinType: toCoinType(baseSepolia.id)` rather than assuming the default Ethereum address is correct. Show the resolved address and chain before a voluntary transfer, and never use ENS to redirect Stock Reward claims. Use ENSv2-ready libraries, normalize names, and resolve the active resolver immediately before a write. Reading ENS does not require the user's wallet to switch chains, but signing ENS setup/profile transactions introduces a second-chain flow. [ENSv2 app guide](https://docs.ens.domains/ensv2/tutorial-app-developers/), [multichain integration guidance](https://docs.ens.domains/web/ensv2-readiness/).

For this deadline, **replace Graph with ENS only if the team chooses collector identity/sharing as a real product priority and the Graph proof reveals excessive indexing work**. Prefer Privy over ENS while extension-free acquisition and gas handling are the more immediate user problems. A one-day ENS proof would need registration, live profile lookup, scoped permission/revocation, and the Base Sepolia address path working together. Parent setup, resolver ownership, chain switching, and error handling mean qualifying ENS work is not automatically a quicker integration. Do not expand to four sponsors or add a new social product merely to fit a bounty.

## Time window

| Milestone                     | UTC                 | India time              |
| ----------------------------- | ------------------- | ----------------------- |
| Hacking begins / kickoff      | September 4, 16:00  | September 4, 21:30 IST  |
| Submission deadline           | September 13, 16:00 | September 13, 21:30 IST |
| Round 1, asynchronous judging | September 13, 19:00 | September 14, 00:30 IST |
| Round 2, live judging         | September 14, 16:00 | September 14, 21:30 IST |
| Finale                        | September 16, 16:00 | September 16, 21:30 IST |

Times come from the public event schedule's published entries; deadline also appears in the submission guide as noon EDT. The event end date is not the submission deadline. [Event schedule](https://ethglobal.com/events/ethonline2026#schedule), [submission guide](https://ethglobal.com/events/ethonline2026/info/details).

## Submission and judging

Select at most **three partners** in the final submission step. Multiple eligible tracks within one partner consume one slot; this does not override track restrictions or guarantee several payouts. Partners judge asynchronously. General finalist screening does not determine partner eligibility. Finalist evaluation covers technical sophistication, originality, practicality, usability, and memorable impact; a live session is four minutes of demo plus three minutes of questions. The event guide describes the usual async screening process, not guaranteed odds for this project. [Submission/judging guide](https://ethglobal.com/events/ethonline2026/info/details).

Submit a **2–4 minute video at 720p or better**; the uploader rejects incorrect duration/resolution. Use human narration, without sped-up footage or AI voiceover. Document where AI assisted code/assets. Spec-driven submissions must include their specs, prompts, and planning artifacts; human direction and contribution must be meaningful. Each selected partner needs an integration explanation and feedback. [Submission/judging guide](https://ethglobal.com/events/ethonline2026/info/details).

## All 11 sponsors: actual awards and qualification traps

Amounts below are published **per-team awards**, not the sponsor's marketing total. “Continuity” means explicitly restricted to that track. Other categories are described as unmarked/general where the page does not explicitly label their pool; verify any ambiguous eligibility with organizers.

### Uniswap Foundation

- General stack contribution: up to **3 × $1,000**. Continuity counterpart: **2 × $1,000**.
- v2/v3/v4, hooks, APIs, CCA, protocol improvements, and ecosystem tooling are in scope. A custom v4 hook is expressly included.
- Required: accessible open-source GitHub repository, `FEEDBACK.md`, and completion of the developer feedback form linking that file. README must identify the integration's contracts and code locations.

[ETHGlobal Uniswap requirements](https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation), [feedback form](https://developers.uniswap.org/hackathon-feedback).

### Privy

- Business-finance product: **$2,500**. Financial flow: **$2,500**. Neither is marked Continuity-only; the page does not specify a multi-winner split.
- Both require Privy to be central, at least one Privy wallet, working demonstration, and source access.
- Business category additionally requires an organization use case, a functioning business operation, and a Privy control such as policy/signers/quorum/intents.
- Financial category requires a completed flow using a generally available feature: transfer, bridge, conversion, swap, supported vault/funding action, or similar wallet operation. Explain the UX gain.
- Commercial/guided-onboarding features may be mocked but cannot satisfy the live integration requirement. A mocked Cards experience needs another functioning Privy flow.

[ETHGlobal Privy requirements](https://ethglobal.com/events/ethonline2026/prizes/privy).

### The Graph

- Composable/standardized data: **$2,500 / $1,500 / $1,000**.
- AI tooling/use case has separate fresh and Continuity pools, each **$2,500 / $1,500 / $1,000**.
- Composition category needs at least two Graph products or meaningful standardized-schema use. A lone custom subgraph query is insufficient.
- AI category requires Graph data or tooling to underpin real reasoning, decisions, automation, or natural-language interaction. Tooling entries must be reusable.
- All require live provider data, public code, and a 2–4 minute demonstration. Static, mocked, and local-only datasets fail qualification. AI entrants must select the correct prior-work pool.

[ETHGlobal Graph requirements](https://ethglobal.com/events/ethonline2026/prizes/the-graph).

### Hedera

- Agentic payments: up to **3 × $2,000**. Requires a live Hedera testnet/mainnet x402 service through **Blocky402**, plus a consuming platform/agent completing a paid request.
- Harness tooling: up to **2 × $1,000**. Requires a substantive Harness contribution/PR (merge unnecessary) or directly derived new harness.
- Tokenization: up to **3 × $2,000**. Requires **Asset Tokenization Studio**, Hedera testnet deployment, and asset issuance/configuration plus a lifecycle operation. Applicable contracts must be verified on HashScan.
- Continuity: **$1,000**, for something previously built at a hackathon or already existing on Hedera, with substantial event-period changes; polish/bugfixes alone fail.
- Each requires public repository/PR documentation and a demo no longer than five minutes; use 2–4 minutes to satisfy ETHGlobal's tighter uploader limit.
- Bonus directions include metering, agent identity/discovery and payment audit trails; real asset lifecycle/compliance and upstream contributions strengthen tokenization entries.

[ETHGlobal Hedera requirements](https://ethglobal.com/events/ethonline2026/prizes/hedera).

### Arc

- DeFi/onchain finance: **$1,667**. Agent economy with Circle Agent Stack: **$1,667**. Combined Continuity category: **$1,666**.
- Launch testnet-to-mainnet category: **$2,500 / $1,000**; Continuity counterpart: **$1,500**.
- Finance work needs meaningful Arc/USDC settlement or programmable financial flows. Agent work needs actual USDC transactions and decision logic connected through Circle's Agent Stack.
- Require working frontend/backend, architecture diagram, video plus presentation/documentation, and GitHub/Replit code. Identify the chosen bounty.
- Both launch categories require Arc-mainnet deployment or deployment readiness by **September 30**. Using Circle USDC on Base alone is not the requested Arc integration; migration or crosschain settlement must have actual product value.

[ETHGlobal Arc requirements](https://ethglobal.com/events/ethonline2026/prizes/arc).

### World

- AgentKit **Continuity only**: up to **3 × $1,166**.
- Selfie Check: up to **3 × $1,166**. The published $3,500 category totals round slightly differently from these per-team amounts.
- AgentKit must meaningfully establish human-backed agents; working app, Sandbox App testing, and AgentBook registration/resolution where relevant are required.
- Selfie Check must affect risk, eligibility, fairness, continuity, or abuse prevention through a real credential flow. It is described as low assurance; do not equate it with complete eligibility verification.
- Both require detailed developer feedback covering integration, portal discoverability/debugging, Sandbox states/proofs/errors, and testing gaps.

[ETHGlobal World requirements](https://ethglobal.com/events/ethonline2026/prizes/world).

### 1inch

- Aqua app: **$2,500 / $1,500 / $1,000**. Continuity: **$1,500 / $500**.
- Build a sophisticated DeFi position using official **Aqua/SwapVM contracts**; modified SwapVM redeployment is allowed. SwapVM use earns additional judging credit.
- Show actual token-transfer execution in the final demo; local forks are acceptable. Supply tests or UI demonstrating positions and meaningful commit history.
- An ordinary 1inch aggregation API integration does not satisfy this bounty.

[ETHGlobal 1inch requirements](https://ethglobal.com/events/ethonline2026/prizes/1inch).

### ENS

- ENSv2: **$1,500 / $1,500 / $1,000 / $500**. Existing-project Continuity integration: **$500**.
- Must use **ENSv2 on Ethereum Sepolia**, with its features central to a working product. Conventional `.eth` name/avatar display alone is insufficient.
- Relevant capabilities: hierarchical registries, scoped permissions, permissioned resolvers, and aliasing. Agent namespace/permission use receives favorable attention.
- Require functional non-hardcoded demonstration, video or live link (ideally both), and open code. Continuity must integrate with an existing project's testnet deployment.

[ETHGlobal ENS requirements](https://ethglobal.com/events/ethonline2026/prizes/ens).

### Ledger

- Fresh AI-agent category: **$2,000 / $1,000 / $500**. Continuity: **$1,000 / $500**.
- New work should make hardware-backed trust central; desired secret-broker and remote-host projects specifically use Agent Stack/Key Ring CLI. Payment authorization and meaningful human approval are other directions.
- Continuity examples include hardware signing, protected secret storage, device approval of existing actions, and substantial upstream fixes.
- Branding or generic wallet support alone is weak evidence; demonstrate why Ledger's trust boundary matters and supply runnable code or a recorded walkthrough.

[ETHGlobal Ledger requirements](https://ethglobal.com/events/ethonline2026/prizes/ledger).

Ledger's separate event guide adds **mandatory tooling feedback**, evaluated alongside code: documentation/SDK experience, concrete gaps, and suggested improvements with screenshots or PRs. It also expects clear boundaries between autonomous action and human approval. Confirm access to the necessary device/toolchain before selecting this work. [Ledger event guide](https://developers.ledger.com/ethonline).

### Chainlink

- Confidential workflow: up to **2 × $1,000**. Requires CRE Confidential Workflows, a TEE handler such as `handlerInTee`, and meaningful sensitive processing in the product. Successful CLI simulation or live deployment evidence is accepted. A placeholder or unrelated sample fails.
- Existing-project upgrade, **Continuity only: $500**. CRE, feeds, Data Streams, Proof of Reserve, and **VRF** are eligible, but the integration must cause an onchain state change. Frontend data display alone fails. Sponsor directs builders to CRE instead of Functions/Automation.
- Liquidation-protection challenge: **$500**. Separate confidential simulated ETH/USDC-position challenge on Ethereum Sepolia; register with `join()` between September 8 and submission cutoff, freeze workflow at cutoff, and scenarios run afterward.
- Existing VRF functionality does not qualify a Start Fresh entry for the confidential category. Avoid inventing a privacy feature merely to attach CRE.

[ETHGlobal Chainlink requirements](https://ethglobal.com/events/ethonline2026/prizes/chainlink).

### Bazantic

- Agent usability, **Continuity only**: up to **2 × $500**. Create a gateway and Recipe; demonstrate repeatable improvement with identical prompt/model/settings/API access, changing only the Recipe. Submit both inputs/results and a comparative video.
- Sponsor-API recipe: **$500 / $300 / $200**. Combine the project's gateway with another existing Bazantic service or event-sponsor API; both must materially affect one working outcome.
- New-API recipe: **$500 / $300 / $200**. Add an API absent from Bazantic at kickoff and not available from another event sponsor; create its gateway and a useful paired-service workflow.
- All require a Bazantic account, project **x402/MPP Gateway**, Recipe, recorded proof, and the registration username for attribution. Existing MCP/read APIs alone do not fulfill these platform requirements.

[ETHGlobal Bazantic requirements](https://ethglobal.com/events/ethonline2026/prizes/bazantic).

## Remaining verification before implementation

- Resolve Start Fresh chronology against actual work and deployment history.
- Time-box a first-day Graph proof: hosted Base Sepolia indexing, meaningful standard-schema reuse, accurate hook fees/rewards, and one useful app view. Check indexing lag, canonical block identity, query limits, and compatibility with retained operator journals before expanding scope.
- Prove Privy can perform the complete existing financial flow, including gas handling, required signatures, recovery, and established safety reviews. Measure whether it improves completion friction beyond simply enabling Reown email.
- Recheck prize pages and the Hacker Dashboard near submission; sponsor requirements and availability can change.
- Do not add prizes across mutually exclusive pools or assume an unmarked category accepts Continuity. No public contender counts or defensible numerical winning odds were established.
