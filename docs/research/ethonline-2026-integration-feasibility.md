# ETHOnline 2026: Graph and Privy integration feasibility

Research date: 2026-09-08. Scope: technical implementation and prize evidence for the current Base Sepolia product. At the time of this research, both service accounts needed setup. The user's constraint is **free tiers only**. This note preserves the documentation research and proposed acceptance gates. Current implementation and live verification are recorded in [the integration runbook](../operations/ethonline-2026-integrations.md).

## Recommended scope

Keep Uniswap as the existing protocol integration. Give The Graph and Privy one working proof each before committing the remaining development time. Graph should supply reusable trading history and explain how trading funds rewards. Privy should make the complete purchase/collector journey work from an embedded wallet.

The Graph's composition prize accepts meaningful standardized-schema work as an alternative to combining multiple Graph products; a custom query alone is insufficient. Live Studio data is accepted. Privy's financial-flow prize requires an actual Privy wallet and completed financial operation, with a clear UX improvement; native gas sponsorship is not stated as mandatory. These routes therefore do not inherently require paid services. [Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph), [Privy prize](https://ethglobal.com/events/ethonline2026/prizes/privy).

## Free service boundary

| Service                      | Documented free path                                                                                                  | Integration decision                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph Studio                 | Free plan includes the Studio testing environment and 100,000 monthly Network queries.                                | Use Studio for the new subgraph and a free Network API key for a reference protocol if needed. Do not upgrade to Growth.                                                    |
| Graph development endpoint   | 3,000 queries/day; three deployed unpublished subgraphs per account. Deployment and onchain publication are distinct. | Cache historical results, avoid continuous public polling, show quota/outage states, and retain a deployment URL for judging. Network publication is outside this baseline. |
| Privy Developer              | Published free tier covers 0–499 MAU, 50,000 signatures and $1 million monthly transaction volume.                    | Embedded onboarding and ordinary wallet operations are the baseline. Check the new dashboard against these published limits.                                                |
| Privy native gas sponsorship | Documentation says the app pays gas plus a convenience fee. No unconditional free credit amount was verified.         | Default off. Enable only if the actual account provides sufficient no-charge credits and a verifiable spending cap. Never infer free gas from the free wallet plan.         |

[Graph plans](https://thegraph.com/docs/en/subgraphs/providers/subgraph-studio/introduction/), [Studio deployment limits](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/), [Privy pricing](https://www.privy.io/pricing), [Privy gas overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview).

## Graph: a bounded standardized implementation

Use **Messari DEX AMM 1.3.2** as the initial base, with a pinned upstream revision recorded during implementation. The Graph currently documents **DEX AMM Extended 4.0.1** for ticks and positions. The smaller base is a scope proposal, not a claim that concentrated-liquidity semantics can be ignored. Keep `schemaVersion`, `subgraphVersion`, and `methodologyVersion` distinct; document every adaptation. Extensions are supported when the shared entities, fields and metric meanings remain usable. [Standardized Subgraphs](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/).

The base models tokens, a DEX protocol, pools, fees, swaps, liquidity events and snapshots. Several pool USD totals, balances and weights are required; LP output-token fields are optional. Its pool ID documentation assumes a contract address, whereas ORBIT's v4 market needs its canonical PoolId. Standard `rewardTokens` describe LP incentive emissions, so ORBIT collectible reward funding needs a separate extension. Review the exact schema before implementation rather than copying a few field names. [DEX AMM 1.3.2 schema](https://github.com/messari/subgraphs/blob/master/schema-dex-amm.graphql), [Extended 4.0.1 schema](https://github.com/messari/subgraphs/blob/master/schema-dex-amm-extended.graphql).

Proposed extension: one immutable hook-fee record per emitted log, linked to its standard swap/pool and transaction, recording actual token amounts and the observed protocol/reward destinations. Additional reward funding and claim records can join the collector's history. Derive these from the contract ABI and events; do not label a funding transfer a completed collector payout. Pool identity should include chain plus canonical PoolId with PoolManager as explicit metadata. Filter the shared PoolManager to the canonical market, and initialize from the deployment's real start block.

Base Sepolia is listed as supported by managed Studio. The official Uniswap v4 repository provides useful v4 event/schema references, but its own schema does not establish Messari conformance. Review its GPL-3.0 license before copying implementation. A standards adapter is new work. [Base Sepolia support](https://thegraph.com/docs/en/supported-networks/base-sepolia/), [official v4 subgraph](https://github.com/Uniswap/v4-subgraph).

### Test assets and financial semantics

The deployment uses valueless test assets. Report precise token-native amounts, pool state and fee splits. Do not treat test-WETH as priced mainnet WETH, assume a dollar peg, or present simulated USD revenue as financial activity. A declared zero-value test fixture may use zero USD values only with an explicit methodology and a visible testnet label; zero must never silently mean an unavailable price. If this cannot preserve the chosen schema's semantics, expose the limitation and reconsider the schema before claiming conformance. Sponsor acceptance of this specific test fixture remains unverified.

Calculate swap volume once, classify fees by their actual beneficiary, and derive balances/weights correctly for the concentrated-liquidity pool. Do not assume 50/50 inventory or use the singleton PoolManager's entire token balance as ORBIT's pool TVL. Standard LP supply-side revenue must not absorb rewards paid to a different class of recipient. These are implementation acceptance conditions; an entity compiling successfully is insufficient evidence.

### Shared-query proof

Messari's Uniswap-forks reference includes Uniswap v2 and Sushi implementations sharing a schema. Select a currently indexed deployment with matching fields in Graph Explorer, verify its schema version and endpoint, and save the successful response. A live comparator URL was **not** verified in this research. [Messari reference implementations](https://github.com/messari/subgraphs/blob/master/subgraphs/uniswap-forks/README.md).

The following is a proposed common query; execute the identical document against both endpoints, changing only the endpoint and pool ID. It deliberately compares token metadata and real swap amounts without comparing test assets to real USD markets.

```graphql
query PoolActivity($pool: ID!) {
  liquidityPool(id: $pool) {
    id
    inputTokens {
      id
      symbol
      decimals
    }
    swaps(first: 5, orderBy: timestamp, orderDirection: desc) {
      hash
      timestamp
      tokenIn {
        symbol
      }
      amountIn
      tokenOut {
        symbol
      }
      amountOut
    }
  }
}
```

The product should consume the standard query for trading history and an extension query for reward-funding context. Demonstrate indexing lag, pagination, unavailable data, and a stable link from a swap to its receipt. Keep the SQLite worker's offchain attempt journals and receipt/recovery responsibilities; a successful-event subgraph cannot recreate unbroadcast or failed operator intents. [Historical Read Model decision](../adr/0009-own-a-typescript-sqlite-historical-read-model.md).

## Privy: working onboarding first, sponsorship conditional

Use `PrivyProvider`, then `QueryClientProvider`, then `WagmiProvider`; import `createConfig` and `WagmiProvider` from `@privy-io/wagmi`. Existing ordinary read/write hooks remain from `wagmi`. Match Privy's supported chains and wagmi chain configuration. Explicitly select the intended active wallet when embedded and external wallets coexist; `useSetActiveWallet` is the documented adapter. Do not assume the first connected wallet is the collector's intended wallet. [Privy wagmi integration](https://docs.privy.io/wallets/connectors/ethereum/integrations/wagmi).

Configure Base Sepolia (`84532`) as the deployment chain. Prove email onboarding, embedded-wallet creation, reconnect, external-wallet selection and wallet/chain changes. Then exercise the existing native-ETH funding and test-WETH faucet, canonical router purchase, Discovery Draw, and a valid claim path. Preserve the explicit irreversible Launch review. Native sponsorship, even when enabled, does not supply the trade's test-WETH. [Privy EVM network configuration](https://docs.privy.io/basics/react/advanced/configuring-evm-networks), [gas coverage](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview), [current product domain](../../CONTEXT.md).

### If no-charge sponsorship is available

Privy's native EVM service uses EIP-7702 without requiring a new ERC-4337 account address. Setup requires TEE execution, dashboard **App pays**, enabled chains, and **Allow transactions from client** for client submissions. The documented React path is `useSendTransaction` from `@privy-io/react-auth`, calling `sendTransaction(transaction, { sponsor: true })`. Encode contract calldata for that path. The ordinary wagmi integration guide does not prove existing `writeContract` calls automatically request sponsorship. [Native gas setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup).

EVM backend responses can initially contain a Privy `transaction_id` and `user_operation_hash` without an onchain transaction hash. Recover the real transaction hash through transaction lookup or status webhooks. Client SDK methods wait for confirmation before returning. Preserve a pending application intent across reloads; do not submit a duplicate merely because a client promise was lost, or pass a user-operation hash to ordinary receipt polling. Prove the chosen SDK's recovery path before enabling sponsorship. [Transaction handling](https://docs.privy.io/wallets/gas-and-asset-management/gas/transaction-handling).

After 7702 delegation the same wallet address has code. Contracts using ERC-1271 may require Privy's `signatureOptions: { type: 'erc1271' }`; raw ECDSA-format signatures can fail those paths. Validate every actual Permit2/typed-signature/auth path the application uses. Apply documented spending limits, per-user controls and simulation to the narrowly scoped sponsorship path. [ERC-1271 signatures](https://docs.privy.io/recipes/evm/erc-1271-signatures), [sponsorship security](https://docs.privy.io/wallets/gas-and-asset-management/gas/security).

## First-day pass/fail gates

| Gate                   | Pass evidence                                                                                                                                                                               | If it fails                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Graph free hosting     | New free account, successfully indexed canonical deployment events, live Studio query, visible indexing status and quota.                                                                   | Do not commit to the Graph prize until a free managed endpoint works.                                                     |
| Graph shared semantics | Schema/version documented; one real swap reconciles to its receipt; correct quantities and fee beneficiaries; explicit test-asset methodology; same query succeeds on a verified reference. | Cut scope or abandon the standardized prize route; do not claim conformance from matching names.                          |
| Graph product value    | A collector can follow trade → reward funding through live history, with lag/error states.                                                                                                  | A standalone playground query does not earn the integration's scope.                                                      |
| Privy baseline         | New embedded wallet completes funding → purchase and a collector action; reconnect and external-wallet regression checks pass.                                                              | Preserve the working wallet path and defer Privy.                                                                         |
| Privy sponsorship      | Dashboard verifies free credit and spending cap; one zero-native-ETH transaction confirms; reload recovery and any signature paths pass.                                                    | Leave sponsorship disabled and use free testnet funding. This does not independently disqualify the financial-flow prize. |

No service accounts were created, deployments made, sponsor endpoints validated live, or contract transactions sent during this research.
