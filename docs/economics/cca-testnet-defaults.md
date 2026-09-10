# Fresh CCA testnet defaults

These values are executable defaults for the ETHOnline Base Sepolia demo. They are not a
production recommendation. A live deployment must record the reviewed values in its schema-v3
manifest before any bid is accepted.

The fresh 4,444 FUEL supply is split into 4,000 FUEL for the auction and 444 FUEL reserved for
locked liquidity. There is no team allocation and no additional project auction fee. The pinned
CCA factory is configured without a protocol fee controller, so the entire net WETH raise is
available to the locked v4 position.

The proposed demo floor is approximately `0.005 WETH/FUEL`, encoded as
`396140812571321687967719750` in Q96. It is exactly five steps on the integer Q96 price grid of
`79228162514264337593543950` (approximately `0.001 WETH/FUEL`), and graduation requires
at least `10 WETH`. A fully cleared auction at the floor raises at least `20 WETH` before integer
rounding. These values keep the demo close to the earlier reference benchmark while allowing CCA,
rather than the deployment script, to select the final price.

The auction starts 300 Base blocks after configuration and runs for 43,200 blocks. Its two issuance
steps sum exactly to CCA's 10,000,000 millionths: `232 × 20,800 + 231 × 22,400 = 10,000,000`.
Assuming roughly two-second Base blocks, this is about one day; block height remains the contract's
source of truth.

Auction inventory, unsold inventory, reserve, proceeds, and dust always have fixed destinations.
Successful migration sends the LP NFT to `PermanentPositionRecipient`. The recovery seeder is both
the unsold-token destination and the migration-failure recipient. It can only seed the exact sealed
pool after the official strategy consumes its reservation, the pool remains uninitialized, and the
recorded reserve plus successful-auction WETH are present. It exposes no withdrawal or arbitrary
call.

The secondary market keeps the dynamic-fee pool at tick spacing 60 and the existing 3% WETH-side
fee split: 2% Stock Rewards, 0.85% Protocol-Owned Liquidity, and 0.15% creator.
