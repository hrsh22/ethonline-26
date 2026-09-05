# Base Sepolia infrastructure for the ORBIT 4444 POC

_Verified 26 August 2026 against official primary sources._

## Confirmed Uniswap v4 deployment

Base Sepolia uses chain ID `84532` and has an official Uniswap v4 deployment:

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| PoolManager             | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| PositionManager         | `0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80` |
| StateView               | `0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4` |
| V4Quoter                | `0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba` |
| Universal Router v2.1.1 | `0x8B844f885672f333Bc0042cB669255f93a4C1E6b` |
| Permit2                 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Sources: [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), [Universal Router SDK constants](https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts#L2254-L2283)

Uniswap v4 permits a pool to attach a custom hook at initialization. Swap callbacks and custom accounting can implement the canonical-market fee logic, provided the hook is deployed to a CREATE2 address whose permission bits match its callbacks. The POC needs its own interface and dedicated router because Uniswap's web interface does not support Base Sepolia and the protocol must preserve the real trader identity through its fee path. [Uniswap hook concepts](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks), [hook deployment guide](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment), [custom accounting](https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting)

## Test settlement assets

- Base Sepolia WETH9: `0x4200000000000000000000000000000000000006`. [Base Sepolia predeploys](https://docs.base.org/base-chain/network-information/base-contracts#base-testnet-sepolia)
- Circle test USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, six decimals and without financial value. [Circle testnet addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

## Aerodrome limitation

Aerodrome does not publish or support an official Base Sepolia deployment. Base's maintained integration and Aerodrome's deployment artifacts list Base mainnet but no Base Sepolia contracts, so the POC must not depend on unaffiliated test deployments. [Base Aerodrome integration](https://github.com/base/skills/blob/master/skills/base-mcp/plugins/aerodrome.md#L200-L225), [Aerodrome contracts](https://github.com/aerodrome-finance/contracts/blob/main/README.md#deployment), [Slipstream artifacts](https://github.com/aerodrome-finance/slipstream/tree/main/script/constants/output)

## Feasible POC topology

The real infrastructure path can use Base Sepolia, the official Uniswap v4 contracts, the project's custom 3% fee hook and canonical `$FUEL`/WETH pool, Base WETH9, Circle test USDC, and the complete collectible/reward/epoch contracts. Four project-owned mock stock tokens can stand in for AAPLc, GOOGLc, METAc, and NVDAc.

For downstream conversions, project-seeded Uniswap v4 `WETH/USDC` and four `USDC/MockStock` pools can exercise real two-hop swaps, isolated route failures, and slippage behavior. The epoch converter should call a replaceable conversion adapter so this Base Sepolia adapter can later be replaced by an Aerodrome adapter for mainnet without altering reward accounting.
