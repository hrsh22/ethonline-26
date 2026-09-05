# Launch the entire supply through locked liquidity

## Decision

The protocol places all 4,444 Liquid Tokens into one permanently locked, one-sided Genesis Liquidity position. It begins with Liquid Tokens and no WETH. Buyers move Liquid Tokens into circulation by supplying WETH through the Canonical Market; there is no presale, treasury token allocation, or collectible mint sale.

The deployed Base Sepolia POC uses absolute tick `51,600` because it reproduces the earlier QUOTRONS reference benchmark of approximately `0.005743 WETH/Liquid Token`. This is a deliberate reference choice. It is not an oracle result, auction outcome, treasury valuation, independently discovered fair value, or production launch-price decision.

No parameter in this ADR or its model changes the deployed POC. Selecting a final production opening tick and range remains an explicit human economic and product decision.

## Exact deployed construction

Uniswap v4 stores the marginal `currency1/currency0` price as:

```text
sqrtPriceX96² / 2¹⁹²
```

In the checked Base Sepolia pool, WETH is `currency0` and Liquid Token is `currency1`. Therefore tick `51,600` gives:

- opening `sqrtPriceX96`: `1045450144060342713734433280827`;
- marginal `Liquid Token/WETH`: `174.119529966238895231` at 18-decimal display precision;
- marginal `WETH/Liquid Token`: `0.005743181136509477` at 18-decimal display precision;
- marginal fully diluted value at 4,444 Liquid Tokens: `25.522696970648119980 WETH`;
- range: `[-887220, 51600]` at tick spacing `60`;
- active liquidity: `336783113201300883150`;
- Liquid Tokens settled into PoolManager: `4443.999999999999999998`;
- conservative v4 liquidity-rounding dust retained by the sealed vault: `2 wei` of Liquid Token.

If Liquid Token is `currency0`, the deployment mirrors the construction to opening tick `-51,600` and range `[-51600, 887220]`. The integer model proves that the economic WETH/Liquid Token results and two-wei dust remain the same under either currency order.

## Terms that must not be conflated

- **Reference benchmark**: the human-selected POC target that led to absolute tick `51,600`.
- **Spot or marginal price**: the price of the next infinitesimal unit at the pool's current square-root price. It changes after swaps.
- **Average execution price**: exact WETH paid or received divided by exact Liquid Token received or paid for one trade. It differs from the marginal price because the trade moves along the curve.
- **WETH-side fee**: 3% of gross WETH volume, routed as 2% Stock Reward, 0.85% Protocol-Owned Liquidity, and 0.15% creator funds. The model reports it separately from WETH entering the AMM position.
- **Actual WETH raised into Genesis Liquidity**: cumulative net WETH delivered to the pool by buys. It is observable pool inventory, not an opening deposit, general treasury balance, or guaranteed realizable proceeds.
- **Marginal fully diluted value**: current marginal WETH/Liquid Token multiplied by all 4,444 economic units. It is a hypothetical marginal multiplication, not pool TVL, treasury value, or the proceeds obtainable by selling every unit.
- **Protocol-Owned Liquidity**: later, separate WETH-only positions funded from the 0.85% fee route. It is not the one-sided Genesis Liquidity position and must not be added to an opening FDV as though they were the same quantity.

For example, buying exactly 1 Liquid Token from the untouched curve requires `0.005744473772371848 WETH` to enter the pool. The hook charges `0.000177664137289850 WETH`, so the trader supplies `0.005922137909661698 WETH`. The difference from `0.005743181136509477` is explained by curve movement, integer rounding, and the separately reported fee—not by a changed opening benchmark.

## Deterministic model

Run the checked Base Sepolia scenario with:

```bash
pnpm model:genesis-curve
pnpm model:genesis-curve --json
```

Pass an alternative validated input without changing source code:

```bash
pnpm model:genesis-curve --config path/to/scenario.json
```

The versioned input at [`docs/economics/genesis-curve-base-sepolia.json`](../economics/genesis-curve-base-sepolia.json) takes supply, currency order, tick spacing, opening tick, range, fee numerator/denominator, exact-output Liquid Token checkpoints, exact-input WETH checkpoints, and sensitivity scenarios. Decimal amounts accept at most 18 fractional digits and become integers before modeling. Assertions never use JavaScript floating-point arithmetic.

The TypeScript implementation ports the relevant v4 `TickMath`, Genesis Liquidity, `SqrtPriceMath`, amount-delta, and rounding behavior. Its fixed vectors are independently exercised through the local Solidity PoolManager, Canonical Router, and fee hook. The default command fails unless the checked deployment manifest matches currency order, tick spacing, opening square-root price, and active liquidity. A custom `--config` remains runnable when it intentionally differs and reports each comparison flag in JSON.

The report includes exact-input and exact-output amounts, pool WETH, fee WETH, trader WETH, average pre-fee and post-fee execution prices, price impact from the opening marginal price, end marginal price, cumulative pool WETH, and remaining liquid-token supply.

## POC sensitivity, not a production recommendation

The following exact-output costs include the 3% WETH-side fee. Every candidate is tick-aligned and satisfies the current vault's two-wei maximum rounding-dust invariant. They show how deployable inputs affect the curve; they do not select a production price.

| Scenario                            |   Tick | Range              | Opening marginal WETH/Liquid Token |               Marginal FDV |     Buy 100 Liquid Tokens |    Buy 1,000 Liquid Tokens |     Buy 4,000 Liquid Tokens |
| ----------------------------------- | -----: | ------------------ | ---------------------------------: | -------------------------: | ------------------------: | -------------------------: | --------------------------: |
| Higher opening benchmark            | 48,060 | `[-887220, 48060]` |               0.008182482289571836 | 36.362951294857241395 WETH | 0.862973725932136313 WETH | 10.884895079701510290 WETH | 337.725933824252265202 WETH |
| Moderately higher opening benchmark | 49,920 | `[-887220, 49920]` |               0.006793762163921355 | 30.191479056466506036 WETH | 0.716510960881379365 WETH |  9.037525011813913945 WETH | 280.407532798983059675 WETH |
| Deployed POC reference              | 51,600 | `[-887220, 51600]` |               0.005743181136509477 | 25.522696970648119980 WETH | 0.605710375981282869 WETH |  7.639970596000850120 WETH | 237.045574167810160487 WETH |
| Moderately lower opening benchmark  | 52,860 | `[-887220, 52860]` |               0.005063305654311934 | 22.501330327762235630 WETH | 0.534006624322735368 WETH |  6.735553937450529721 WETH | 208.984214059275895137 WETH |
| Lower opening benchmark             | 54,960 | `[-887220, 54960]` |               0.004104278887746348 | 18.239415377144771260 WETH | 0.432861901642857817 WETH |  5.459791233265314624 WETH | 169.401090156448140244 WETH |
| Same opening, shorter tail          | 51,600 | `[-599400, 51600]` |               0.005743181136509477 | 25.522696970648119980 WETH | 0.605710375981282767 WETH |  7.639970596000833886 WETH | 237.045574167794531529 WETH |

The table makes two important effects visible. A lower numerical tick is a higher WETH/Liquid Token opening benchmark in this deployed currency order. Shortening only the far tail barely changes early checkpoints but does change exact liquidity and deep-curve execution. Neither observation is sufficient to choose a production curve without explicit product goals, liquidity-risk analysis, demand assumptions, and human approval.
