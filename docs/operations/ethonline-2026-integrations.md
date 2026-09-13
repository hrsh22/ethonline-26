# ETHOnline 2026 integrations

Orbit's deployed demo combines a canonical Uniswap v4 market, Privy wallet onboarding, and Graph-indexed reward funding on Base Sepolia. The web app is live at [orbit.gamified.trade](https://orbit.gamified.trade), its API is live at [api.orbit.gamified.trade](https://api.orbit.gamified.trade), and every token is a valueless test asset.

## Uniswap: every trade funds the game

Orbit routes purchases and sales through the Base Sepolia Uniswap v4 PoolManager. Its custom hook charges 3% on WETH-side volume and divides it onchain: 2% funds collectible stock-token rewards, 0.85% adds permanently locked liquidity, and 0.15% goes to the creator.

- [Canonical fee hook](../../packages/contracts/src/market/CanonicalFeeHook.sol#L111)
- [Uniswap v4 settlement router](../../packages/contracts/src/market/CanonicalRouter.sol#L230)
- [Deployed staging contracts and PoolId](../../deployments/84532.staging.json)
- [Verified live trade](https://sepolia.basescan.org/tx/0xaa43abc1d1fecb522317bf656ff276770686135b90306963bd59f9bb53d4358b)

The verified trade used 0.006 test WETH and returned 1.160956411569668706 FUEL. Its hook allocated 0.00012 WETH to rewards, 0.000051 WETH to locked liquidity, and 0.000009 WETH to the creator.

## Privy: wallet onboarding and signing

Privy supplies Orbit's login, embedded-wallet, external-wallet, and WalletConnect experience. The connected Privy/wagmi account signs faucet control proofs, approvals, canonical trades, Discovery, Launch, and reward claims. Orbit verifies expected wallet, chain, contract, calldata, value, and canonical receipt before it accepts a restored transaction after a reload.

The deployed app uses Base Sepolia and displays transaction amounts plus Basescan links. Gas sponsorship and paid onramps are disabled; the bounded faucet supplies test ETH and test WETH. No Privy secret is exposed in the browser.

- [Privy provider integration](../../apps/web/src/providers/wallet-provider.tsx)
- [Wallet session integration](../../apps/web/src/providers/privy-wallet-session.tsx)
- [Deployed app](https://orbit.gamified.trade)

A live WalletConnect wallet completed purchases, sales, Discovery, and Launch through Privy's wallet picker. The recorded release transactions include the [Graph-proven WETH purchase](https://sepolia.basescan.org/tx/0xaa43abc1d1fecb522317bf656ff276770686135b90306963bd59f9bb53d4358b), a [FUEL sale](https://sepolia.basescan.org/tx/0xc4c3c29ee29a89d973c971e3e7ed6c68d321960205dab5617c0406aefbfa288b), [Discovery](https://sepolia.basescan.org/tx/0xbebfbdcb774606126a42119f1fdafba45e9509933ed193c92281c3fcc0b38c7c), and [Launch](https://sepolia.basescan.org/tx/0x812a803e63ccf989ee8cd729be99d920b5668bd3e5b69171dd68c259b1e9e649).

## The Graph: transparent reward provenance

The Graph indexes the deployed staging PoolManager, fee hook, conversion engine, rewards ledger, CCA, and escrow lifecycle. It extends the Messari DEX AMM 1.3.2 schema with Orbit-specific reward-funding entities while retaining standard protocol, token, pool, swap, deposit, and interval fields.

- [Studio endpoint 0.1.6](https://api.studio.thegraph.com/query/85163/orbit-market/0.1.6)
- Deployment CID: `QmPwMqYxUm5F1MRBDcJ9SzoM8R4JYgxiW1BcNCgZ96dDnX`
- [Subgraph methodology and reproducible query](../../subgraphs/orbit-market/README.md)
- [Pinned funding evidence](../../subgraphs/orbit-market/evidence/reward-funding.json)
- [Pinned trade evidence](../../subgraphs/orbit-market/evidence/staging-trade.json)
- [Pinned lifecycle evidence](../../subgraphs/orbit-market/evidence/cca-lifecycle.json)

The proof responses are pinned to finalized Base Sepolia block 46,765,498, hash `0x967c62ea5b813e05d9d7bbd9d2b2b19bcf153b178bf31492313d86aa4145a345`, and require a healthy index. At that block the index records 184 fee events and 8 successful reward conversions. The live API exposes the same source at `GET /v1/analytics/reward-funding`, using a two-minute server cache and a persistent daily query budget; the browser never receives a Graph key.

In the demo, open **Protocol status → Where rewards came from** to show how Uniswap trades accumulated funding and how much WETH successful stock-token conversions consumed. Funding is pooled, so Orbit does not claim a direct swap-to-user-reward relationship.
