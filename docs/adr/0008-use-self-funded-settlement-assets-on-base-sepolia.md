# Use self-funded settlement assets on Base Sepolia

The Base Sepolia POC will reuse the project's already-deployed, visibly valueless WETH-like token, USDC-like token, four MockStocks, `TestConversionVenue`, and five seeded conversion pools. The Canonical Market and conversion pools continue to use the official Uniswap v4 `PoolManager`, and the same WETH-like asset remains sealed across fee capture, Reward Epoch conversion, and Protocol-Owned Liquidity.

This supersedes ADR 0006's choice of faucet-issued Base Sepolia WETH and Circle test USDC. It trades official test-token fidelity for repeatable, faucet-independent execution while preserving the economic and accounting boundaries the POC exists to prove. These assets have no financial value and are not production substitutes; a Base mainnet deployment must select and independently validate its production settlement assets.
