# Acquiring Coinbase Tokenized Stocks on Base

Research date: 2026-08-25. Onchain observations were made against Base mainnet around chain tip block `50,443,391` (2026-08-25 16:42:09 UTC). Pool-discovery calls used `latest` rather than a pinned block, so the addresses below are reproducible factory lookups, but this is not a historical reserve snapshot.

## Bottom line

The four canonical Coinbase Tokenized Stocks can all be reached through **Aerodrome concentrated-liquidity pools paired with native USDC**. That makes USDC the lowest-friction common acquisition asset:

```text
USDC -> AAPLc
USDC -> GOOGLc
USDC -> METAc
USDC -> NVDAc
```

A direct WETH pool was found for GOOGLc, but not for AAPLc, METAc, or NVDAc in the standard tick spacings checked (`1`, `10`, `50`, `100`, `200`, `2000`). Therefore a reward pot held in WETH normally needs at least:

```text
WETH -> USDC -> stock
```

Native ETH adds wrapping or a native-input router step before the same route. This does **not** by itself settle which asset the project's own canonical market should use, but strictly on stock-conversion friction the ordering is **USDC first, WETH second, native ETH third**. No evidence was found for another common quote asset that improves on USDC.

Base officially says Aerodrome provides the launch liquidity, but Base does not publish the individual pool addresses. The pool addresses below were independently verified by calling Aerodrome's live Slipstream factory on Base. [Base launch announcement](https://blog.base.org/tokenized-stocks), [Base stocks page](https://www.base.org/stocks)

## Canonical stock contracts

Base's public stocks page calls these four the full current Coinbase-issued list and warns users to match addresses before buying. The developer guide publishes the full B20 addresses. [Base stocks page](https://www.base.org/stocks), [Base integration guide](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base#contract-addresses)

| Asset  | B20 address                                  |
| ------ | -------------------------------------------- |
| AAPLc  | `0xb200000000000000000000C2e324d24d7eEcd1fb` |
| GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` |
| METAc  | `0xb2000000000000000000008bC8786B856E61707C` |
| NVDAc  | `0xb20000000000000000000078ee7ce2fE4908108C` |

Common quote assets:

| Asset       | Address                                      |
| ----------- | -------------------------------------------- |
| Native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| WETH        | `0x4200000000000000000000000000000000000006` |

## Verified Aerodrome pools

The current Aerodrome application identifies its active Base Slipstream factory as `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`. Calls to `getPool(tokenA, tokenB, tickSpacing)` returned the following addresses. Each primary pool also returned the expected `token0`/`token1` pair when called directly.

| Stock  | Primary pool                                 | Type                                     | Common route     | Other pool mappings found                                      | Liquidity evidence                                                                                                                                    |
| ------ | -------------------------------------------- | ---------------------------------------- | ---------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| AAPLc  | `0xA3b1E3f9747065e2073722Ff4c9027d3eA4994F0` | Slipstream concentrated, tick spacing 10 | `USDC -> AAPLc`  | AAPLc/USDC CL200: `0x8FeaCB3AAC9499bA4F53aa16e9CD38c36C57765E` | CL10 pool was initialized and returned active in-range `liquidity = 21,278,440,309,678`; `fee() = 500` (0.05%). Token balances/TVL were not captured. |
| GOOGLc | `0xB1987CAD1682841b4b641d50E520777eC5Ab5542` | Slipstream concentrated, tick spacing 10 | `USDC -> GOOGLc` | GOOGLc/WETH CL10: `0xc72153764f7a6c9a4cfa5e0834AFc2A66100c1Aa` | Pool mappings verified; active liquidity and balances remain unverified.                                                                              |
| METAc  | `0xEAF57753BC382E0324a1D43F72E7027705a2273E` | Slipstream concentrated, tick spacing 10 | `USDC -> METAc`  | No WETH pool found in the checked tick spacings                | Pool mapping verified; active liquidity and balances remain unverified.                                                                               |
| NVDAc  | `0x853F5f1B92b16714Fe6CDA67CAad0856B83C7ab9` | Slipstream concentrated, tick spacing 10 | `USDC -> NVDAc`  | NVDAc/USDC CL200: `0x204B5342c46A7E1BE3988E60aCB2b7aaCa2e40AB` | Pool mappings verified; active liquidity and balances remain unverified.                                                                              |

`liquidity()` in a concentrated pool is active in-range liquidity `L`, not a token reserve or a dollar TVL. It should not be interpreted as `$21.3T` or compared across pools without the current price, tick ranges, token decimals, and position distribution.

The CL200 mappings are not automatically usable fallback venues: existence does not prove that a pool is initialized, in range, or sufficiently funded. Likewise, the GOOGLc/WETH mapping proves a direct pool exists, not that it offers an executable quote of useful size. Those are deliberately marked unknown until a pinned-block quoter and balance snapshot is run.

### Reproducible pool check

```bash
cast call \
  0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef \
  'getPool(address,address,int24)(address)' \
  <STOCK_ADDRESS> \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  10 \
  --rpc-url <BASE_RPC_URL>
```

For example, direct inspection of AAPLc's CL10 pool returned:

- `factory()` = `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`
- `token0()` = USDC
- `token1()` = AAPLc
- `tickSpacing()` = `10`
- `fee()` = `500`, conventionally 500 hundredths of a basis point = 0.05%
- initialized `slot0()` and nonzero active liquidity

These are direct Base RPC results, not an assertion copied from a market-data site. The contracts can also be inspected on [BaseScan](https://basescan.org/address/0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef).

## Router and quoter

Aerodrome's current production application configuration exposed these Base addresses at research time:

| Component                    | Address                                      | Relevance                                                                        |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Current Slipstream factory   | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | Creates/finds the stock CL pools                                                 |
| Universal Router             | `0xcAF22ce31298CF2BF1D152862F80216478ad7c67` | Current mixed-route execution surface used by the app                            |
| Quoter                       | `0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555` | Current quote surface used by the app                                            |
| Nonfungible Position Manager | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | LP position management; not needed merely to buy stocks                          |
| Classic Router               | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | Basic stable/volatile pools; do not assume it can execute the new CL stock route |
| Legacy Slipstream factory    | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | Old factory; it does not resolve the new stock pools                             |

Source: the official current [Aerodrome application bundle](https://aerodrome.finance/assets/index-Ba467O3Z.js). Aerodrome's public documentation explains the distinction between stable, volatile, and concentrated pools, while its source documents mixed routes and the quoter model. [Aerodrome liquidity documentation](https://github.com/aerodrome-finance/docs/blob/main/content/liquidity.mdx), [Slipstream mixed-route quoter](https://github.com/aerodrome-finance/slipstream/blob/main/contracts/periphery/lens/MixedRouteQuoterV1.sol)

The application bundle is hash-versioned and may change. Production code should not hard-code these values from this note alone: pin a reviewed Aerodrome release/deployment registry and re-verify each address's bytecode and immutables before deployment.

## Reliable integration route

For a reward converter funded in USDC:

1. Read the stock address from Base's canonical list; never select by ticker alone.
2. Query the current Slipstream factory for the CL10 USDC/stock pool and require it to match the configured pool.
3. Check B20 pause/policy state and the current multiplier before attempting conversion.
4. Quote exact-input USDC through the current Aerodrome quoter.
5. Compare the DEX quote with the stock's Chainlink total-return feed, subject to market-hours, pause, and staleness checks.
6. Approve only the exact USDC input required (or use a tightly scoped allowance policy).
7. Execute through the current Universal Router with a deadline and `amountOutMinimum`.
8. Send output directly to the rewards vault where possible; verify the received raw B20 amount rather than trusting router return data alone.

For a converter funded in WETH, quote both a mixed `WETH -> USDC -> stock` route and any direct WETH/stock pool that actually exists and has active liquidity. Select by executable output, not hop count. Native ETH should be wrapped or accepted through a router path whose unwrap/wrap semantics have been audited.

Aerodrome's official source describes mixed-path encoding and quote behavior; the protocol's classic router source also illustrates that a router can wrap native ETH to WETH internally. [Aerodrome Slipstream quoter](https://github.com/aerodrome-finance/slipstream/blob/main/contracts/periphery/lens/MixedRouteQuoterV1.sol), [Aerodrome classic Router](https://github.com/aerodrome-finance/contracts/blob/main/contracts/Router.sol)

## B20 buying constraints

The stocks support ordinary ERC-20 `approve` and `transferFrom`, but an approval does not guarantee a successful transfer:

- `approve()` itself is not policy-gated; a later transfer can still revert under a B20 policy.
- Token functions can be paused selectively.
- The issuer can apply address policies such as sanctions blocks.
- One raw token does not permanently equal one underlying share. The WAD-scaled multiplier changes for dividends and corporate actions, so reward accounting must distinguish raw token units from scaled share exposure.
- During a corporate action, the token can remain transferable while its Chainlink feed freezes. The feed is also 24/5 and holds its previous value off-hours. A converter must check the feed's `updatedAt` and pause state and use the live DEX quote for actual execution.

These behaviors are specified in Base's official integration guide and B20 specification. [Base integration guide](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base), [B20 specification](https://docs.base.org/base-chain/specs/reference/b20)

Separately, Base says secondary holding/trading is technically permissionless, but the products are only available to eligible non-US users and transfers can still be blocked by issuer policy. A successful swap is not proof that a reward distribution to every possible recipient is legally permitted. [Base compliance documentation](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base#compliance), [Coinbase Tokenize](https://www.coinbase.com/tokenize)

## Settlement-asset comparison, conversion friction only

| Settlement asset for our token fees | Route to all four stocks                                                              | Conversion friction                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| USDC                                | One CL hop per stock                                                                  | Lowest and uniform across all four                                                                        |
| WETH                                | Normally WETH/USDC plus USDC/stock; direct GOOGLc pool exists but depth is unverified | One extra market and more slippage/price-risk surface for three stocks                                    |
| Native ETH                          | Native handling/wrapping plus the WETH/USDC and stock legs                            | Highest contract-path complexity; may save a user-facing wrap transaction but not the internal conversion |
| Another asset                       | No common canonical stock pools verified                                              | Unsupported by the current evidence                                                                       |

This comparison is intentionally narrow. WETH may still be preferable for the project's own trading market because ETH is the natural speculative quote asset on Base; USDC may be preferable because all reward purchases begin there. That product decision should weigh market demand, hook/router design, protocol-owned-liquidity operations, and conversion loss separately.

## Unknowns and required pre-production checks

The interrupted live snapshot did **not** establish the following, so none should be inferred from “deep liquidity” marketing language:

1. Token balances, dollar TVL, active tick ranges, and price impact at the intended epoch sizes for all four primary pools.
2. Whether the GOOGLc/WETH pool and the AAPLc/NVDAc CL200 pools are initialized and meaningfully liquid.
3. Whether additional classic, concentrated, or aggregator routes currently beat the primary CL10 USDC pools.
4. Pinned-block quoter outputs for representative amounts such as 100, 1,000, and 10,000 USDC.
5. Current per-stock multiplier, policy IDs, account authorization results, and pause flags.
6. The current Universal Router command/calldata contract for the new Aerodrome deployment; use its reviewed ABI/source release, not assumptions from the older router.
7. Whether Coinbase's issuer permits an unaffiliated protocol to acquire these tokens and distribute them algorithmically as rewards to pseudonymous NFT holders.

Before implementation, take one pinned-block snapshot containing factory mapping, pool bytecode hash, `slot0`, active liquidity, token balances, fees, quoter results, multiplier, policy/pause state, Chainlink `latestRoundData`, and timestamp for every enabled asset.
