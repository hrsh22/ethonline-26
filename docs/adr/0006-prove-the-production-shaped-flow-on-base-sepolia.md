# Prove the production-shaped flow on Base Sepolia

Superseded in part by [ADR 0008](./0008-use-self-funded-settlement-assets-on-base-sepolia.md): the POC keeps the official Uniswap v4 deployment but uses project-deployed, visibly valueless settlement assets instead of faucet-issued WETH and USDC.

The POC will run a complete economic vertical slice on Base Sepolia rather than mocking market behavior. It will use the official Uniswap v4 deployment for the Canonical Market, a real custom fee hook and dedicated router, Base Sepolia WETH, Circle test USDC, four mock stock tokens, and project-seeded conversion pools for `WETH → USDC → MockStock` swaps. All POC assets are valueless test assets.

Aerodrome has no official Base Sepolia deployment, so the downstream converter will sit behind a replaceable interface. The Base Sepolia adapter will execute against project-seeded Uniswap v4 pools; the production adapter will execute the same sealed asset paths against Aerodrome on Base mainnet. This costs more POC work than a mock converter, but it proves WETH-side fee capture, bounded two-hop conversion, independent track settlement, and Deferred Track Budget behavior before the production venue is introduced.
