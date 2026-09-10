# Base Sepolia deployment 84532

ORBIT 4444 was redeployed on Base Sepolia as a deliberately
breaking development deployment. It is not a production deployment. The
canonical machine-readable record is
[`deployments/84532.json`](../../deployments/84532.json).

## Launch and authority

- Network: Base Sepolia (`84532`)
- Phase: `launched`
- Launch block: `46254119`
- Launch transaction:
  [`0x7acd27…489b4`](https://sepolia.basescan.org/tx/0x7acd27ddc7aeb87509c19ede5e52b4db913533202acea22a25f773634cf489b4)
- Identity commitment:
  `0x33a4bd1e123ca8ffd826c3faff9f668a60f0a38d7e681a4a75c130befcdd58d3`
- Development operator: `0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214`
- Governance Safe: `0x4325337EcEcE105484A5F0b2e6464d82D5FeBBec`
- Recovery authority: `0xc24422D233c7FEd0129EB6A385FA81f771FB1eC4`

The Reward Ledger, Epoch Converter, Canonical Market Registry, and
Protocol-Owned Liquidity Vault are owned by the governance Safe with no pending
owner. FUEL Core keeps the launch, discovery, and protocol safety authority it
needs. The valueless development environment intentionally consolidates its
funded operational roles; recovery still requires both the operator and the
Safe.

## Claims and rewards

The Reward Ledger is permanently bound to `AlwaysAllowClaimGate` at
`0x0118D8CE10962F7906d9F6Af73Aa8461AE650b14`. Its administrator is the zero
address: no administrator approval, allowlist change, or off-chain credential is
needed for an owner to claim.

A Grounded Craft does not contribute reward weight. Launching converts it into
the permanent Orbiter identity that accrues its configured track and weight.
Accrued Stock Reward units attach to the identity, not the wallet that originally
burned FUEL. The current on-chain owner can claim them, and a previous owner
cannot claim after transfer.

## Native ETH and the 3% market fee

The canonical Uniswap v4 pool is still WETH/FUEL. The router at
`0x5DE07f3Cf73B41Ac60f89DC5810959DC93e3c069` accepts native ETH only as a
convenience: it wraps the exact payable amount into the deployment's WETH at
`0xc827B184AC7DB9D74F40c3833CD88c1Ece7ecBf1` before settling against the
official Base Sepolia PoolManager. PoolManager and the hook therefore always see
WETH/FUEL, whether the user selected ETH or already-held WETH.

The hook measures the WETH-side settlement delta and charges the same 3% fee in
both paths. The protocol split is 2% reward funding, 0.85% protocol-owned
liquidity, and 0.15% permanently locked liquidity. The live smoke quote recorded
`0.0003 WETH` of fee for a `0.01 WETH` input, and the native transaction succeeded:
[`0xabb7a9…260da`](https://sepolia.basescan.org/tx/0xabb7a9ca33389f603fdacbe225d796b6560e0b9f26e40cad78de9b80527260da).

## Contracts

| Contract                  | Address                                      |
| ------------------------- | -------------------------------------------- |
| FUEL Core                 | `0x0507B5EA61E5d1B49Cf062226EDC6433C62DD44B` |
| FUEL Mirror (ERC-721)     | `0x6fe67af9B84Ee9d86755372EdB110A539efee009` |
| Canonical Router          | `0x5DE07f3Cf73B41Ac60f89DC5810959DC93e3c069` |
| Canonical Fee Hook        | `0x3b88dfD2FC4B3Eb09A823B328DCf14603Af040cC` |
| Canonical Market Registry | `0xEC83604EEaFc57024B96F38942343a2c92257D0F` |
| Reward Ledger             | `0x4Df8363FC5119aeB509b69b15E49114470a96F00` |
| Epoch Converter           | `0xD76ebF45c8efdAe2552043b9811aa7FBAc49588F` |
| Claim Gate                | `0x0118D8CE10962F7906d9F6Af73Aa8461AE650b14` |
| Protocol Liquidity Vault  | `0xF7B26B4328739Ee843A08f3EE1f0082067016ede` |
| Genesis Liquidity Vault   | `0x916bB93E4f6031fEE38eca99cAeA004b71AD53C3` |
| Wrapped-native test WETH  | `0xc827B184AC7DB9D74F40c3833CD88c1Ece7ecBf1` |
| Self-funded test USDC     | `0x5F05A80b1734082c712388F2DB3B2B9f4BE57ca4` |
| Official v4 PoolManager   | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |

The canonical WETH/FUEL pool ID is
`0x0a1862edc26e1548e2c435e00355a6f93b25ef401e01bf2be0c310a9530ef8cb`.
All other project and self-funded venue addresses are recorded in the manifest.

## Deployment evidence

[`deployments/84532-evidence.json`](../../deployments/84532-evidence.json)
contains 34 successful transaction receipts for the real-chain smoke flow. It
proves native ETH and WETH trades, discovery and grounding, Launch of Orbiter
`#1109`, post-Launch fee accrual, all four conversion tracks, a direct owner
claim of `0.814971085785385185` AAPLc, and balanced Reward Ledger liabilities.
The economic invariant finished at 4,443 liquid FUEL plus one permanent identity
= 4,444 units.

[`deployments/84532-verification.json`](../../deployments/84532-verification.json)
records exact Sourcify matches for all 26 deployed project/test contracts.
[`deployments/84532-health.json`](../../deployments/84532-health.json) records 167
passing checks at block `46254629`, zero failures, and a ready faucet with a
normal budget. The history indexer was rebuilt from this deployment's launch
block, the signed operator policy is live, and the first post-cutover operator
cycle completed on the new deployment.

## Collectible explorers

The app links each collectible directly to BaseScan and its collection contract
to Blockscout. These are the supported Base Sepolia records for the development
deployment.

## Superseded development contracts

The earlier protocol at
`0x1Ed22fdF0D7Dca9c9a2De6D83c99E6da50706407` used a mintable ERC-20 that did
not implement WETH deposit/withdraw and therefore could not support the native
router path. It and the older deployments remain visible on-chain but
are intentionally absent from the app manifest and runtime indexes. Their NFTs
and balances are development artifacts and are not migrated.
