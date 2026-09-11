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

Do not use an exact `10 WETH` bid as a graduation demonstration. CCA decides graduation from its
final fixed-point checkpoint accounting, so exact-minimum scenarios can lose equality to integer
rounding. The executable defaults encode a `1 wei` safety margin: the smallest demonstration bid is
`10.000000000000000001 WETH`. A regression test checkpoints that intentionally over-threshold bid
at the end of the default schedule and proves that the auction graduates.

The auction starts 300 Base blocks after configuration and runs for 10,800 blocks. Its two issuance
steps sum exactly to CCA's 10,000,000 millionths: `926 × 10,000 + 925 × 800 = 10,000,000`.
Assuming roughly two-second Base blocks, this is about six hours; block height remains the contract's
source of truth.

Auction inventory, unsold inventory, reserve, proceeds, and dust always have fixed destinations.
Successful migration sends the LP NFT to `PermanentPositionRecipient`. The recovery seeder is both
the unsold-token destination and the migration-failure recipient. It can only seed the exact sealed
pool after the official strategy consumes its reservation, the pool remains uninitialized, and the
recorded reserve plus successful-auction WETH are present. It exposes no withdrawal or arbitrary
call.

The secondary market keeps the dynamic-fee pool at tick spacing 60 and the existing 3% WETH-side
fee split: 2% Stock Rewards, 0.85% Protocol-Owned Liquidity, and 0.15% creator.
