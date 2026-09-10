# ETHOnline 2026 integrations

The integration combines a canonical Uniswap v4 market, Privy wallet onboarding,
and Graph-indexed reward funding on Base Sepolia. All tokens are valueless test
assets. Web and API verification runs locally; only the subgraph is deployed to
free Studio. This document records implementation evidence, not an award claim.

## Uniswap: trade activity funds rewards

The canonical router settles through Uniswap v4 and the custom hook charges
3% on the WETH side: 2% for Stock Rewards, 0.85% for locked liquidity, and 0.15%
for the creator. The application quotes and executes that canonical route.

- [Hook fee callbacks](../../packages/contracts/src/market/CanonicalFeeHook.sol#L111)
- [Router settlement](../../packages/contracts/src/market/CanonicalRouter.sol#L230)
- [Per-track conversion](../../packages/contracts/src/conversion/EpochConverter.sol)
- [Checked deployment](../../deployments/84532.json)
- [Developer feedback](../../FEEDBACK.md)

## Privy: email and external wallets

The ETHOnline 26 Privy application enables email login and normal Ethereum
wallet connections. An email login creates an embedded EOA for a user without
a wallet; connecting an external wallet does not create a second mandatory
embedded account. The same wagmi account signs the faucet proof, token approval,
canonical trade, Launch, and claim. Privy owns connector restoration and the app
waits for SDK wallet readiness before interpreting a disconnected session.

Gas sponsorship is disabled. The existing bounded testnet faucet supplies
both gas ETH and test WETH; paid onramps are not part of the journey. The SDK
transaction view displays native amounts, and explorer links use Base Sepolia.
Disconnect logs out of Privy and disconnects every restored wagmi connector; admin session teardown occurs
first. No Privy app secret is needed in the browser.

Set `NEXT_PUBLIC_PRIVY_APP_ID` in the ignored root `.env`. Enable email/external
wallet login, automatic Ethereum wallets for users without wallets, and
`http://localhost:3000` / `http://127.0.0.1:3000` in Privy's allowed domains.
The runtime launcher projects only this public ID into the browser process.
The compatible adapter pair is `@privy-io/wagmi@4.0.16` and `viem@2.55.10`:
viem 2.56 removes a Tempo export still imported by the current wagmi version.

## The Graph: inspect shared reward funding

Open Rewards → Where rewards came from → Load funding activity. The disclosure
shows exact hook allocations, WETH consumed by completed conversions, and recent
standardized market swaps. Funding is pooled: it does not claim a swap-to-claim
or swap-to-epoch causal link.

The subgraph extends Messari DEX AMM 1.3.2 and uses standard pool/token/swap
fields in the live application query. Its own [README](../../subgraphs/orbit-market/README.md)
records schema provenance, adaptations, tests, deployment and reproducible queries.

The [live Studio endpoint](https://api.studio.thegraph.com/query/85163/orbit-market/0.1.3) is deployed as `QmXBGqF3KLdY1P9osp4xVZ8e3eaAQNKHGuEmfE2MhtvnbC`. Captured [API evidence](../audits/2026-09-08-sponsor-integration/reward-funding-api.json) includes the embedded-wallet trade.

The API's fixed `GET /v1/analytics/reward-funding` response validates the pool
identity and split totals, rejects indexing errors, includes the indexed block,
and uses a shared two-minute cache. A persistent SQLite counter limits attempted
provider requests to 2,000/day, including failed calls. The browser makes no
background Graph polls. Quota exhaustion, unavailable providers, and a not-yet-
indexed summary have distinct honest states.

Set `GRAPH_STUDIO_QUERY_URL` to the versioned Studio endpoint in the ignored
root `.env`. `GRAPH_API_KEY` is server-only; `GRAPH_STUDIO_DEPLOY_KEY` is available
only to deployment tooling and never projected into runtime services. The
existing historical index, operator journals, receipt recovery and block-pinned
claim/ownership reads remain independent of Graph availability.

## Live verification

A live Chrome session created an embedded wallet through Privy email login,
signed the faucet wallet-control proof, and received bounded ETH/WETH funding.
It then approved WETH and bought FUEL through the canonical router:

| Step               | Onchain evidence                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Test WETH top-up   | [Funding transaction](https://sepolia.basescan.org/tx/0xa1f1786aad54df5979bcc9dbe14d0fd41a14cc972513036467d9eae5b2c3f3a4)                |
| WETH approval      | [Approval transaction](https://sepolia.basescan.org/tx/0x2f5e8c6cc42dc843eb327201ab3a0a6f98084f17a203f1ba78909011f2c477ef)               |
| Canonical purchase | [Swap transaction](https://sepolia.basescan.org/tx/0x86b97644279a23a0c281d51807cff93dc305c5d094e140ae6d6ba51fc2ebb928), block 46,526,067 |

The purchase spent 0.007 test WETH and received 1.171360501692246067 FUEL,
crossing one whole-unit Discovery threshold. Its 0.00021 WETH hook charge is
observable independently in the Graph event projection.

A separate, unmocked WalletConnect check paired a real ephemeral WalletKit peer
through Privy's wallet picker, verified connection and disconnect, and then
closed the peer. That probe disabled signing and transactions.

The embedded wallet launched identity #3444 as an Orbiter in
[transaction 0xcd592e…36249](https://sepolia.basescan.org/tx/0xcd592e1dcb98937a8d89a3aa2c5356ff1f9a234fca7d35a4dc7384376ff36249),
burning exactly one FUEL. The browser was deliberately reloaded after Privy's
success screen but before “All Done” returned the hash to the app. This exposed
the interrupted-prompt recovery case and exercised the new saved-call evidence.

New attempts record the expected wallet, chain, target, calldata hash, value,
and preflight block before opening the wallet. The recovery field accepts only
a mined transaction matching that evidence, validates canonical block identity,
and revalidates before confirming after refresh. It never resubmits. Older
attempts without saved call evidence cannot use this matching path.

Live recovery rejected the unrelated purchase hash, then accepted the exact
Launch hash and restored “Launch complete” without another submission. The same
wallet then claimed **0.996651576817566284 AAPLc** in
[transaction 0xa87d86…34198](https://sepolia.basescan.org/tx/0xa87d862898cdec0756530d37d784109ceafed2d023b8e78ee77d743335134198),
block 46,526,494. The decoded [claim event](../audits/2026-09-08-sponsor-integration/privy-claim.json)
binds that amount to identity #3444 and its current owner.

The production harness separately checks external-wallet fixtures. Its Privy
iframe fixture acknowledges transport readiness and rejects embedded operations;
it does not simulate successful email authentication. Live email, signing,
funding, swap, Launch, recovery, and claim evidence above comes from the actual
Privy service and Base Sepolia.

Validation results are recorded in the [final audit](../audits/2026-09-08-sponsor-integration/README.md) alongside the browser report.

## Submission material still requiring the entrant

Prepare a two-to-four-minute, human-narrated demo showing email onboarding,
funding, canonical trade/Discovery, Launch/claim, and the live funding disclosure.
Include public repository and contract references, the live Studio query, and
accurate AI-assistance attribution. Select the three intended sponsor partners.
The Uniswap feedback form and ETHGlobal project submission remain entrant actions;
no external form has been submitted by this implementation task.
