# Protocol invariant and adversarial verification

The default Foundry profile runs each stateful invariant for **64 runs × 32 calls**. The
`show_metrics` output records handler coverage, and Foundry shrinks a failure for up to 5,000
attempts. A failed run prints its fuzz seed and minimized call sequence; rerun the persisted failure
with `forge test --rerun`, or replay the printed seed with:

```sh
forge test --match-path test/ProtocolSystem.invariant.t.sol --fuzz-seed <printed-seed> -vvvv
```

Run the focused stateful gates with `pnpm test:invariants`. The normal package test runs the whole
contract suite and then checks the committed gas snapshots.

## Required invariant matrix

|   # | Required property                                                             | Continuous or regression coverage                                                                                                                                     |
| --: | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Liquid supply plus permanent backing remains 4,444 units                      | `FuelOwnershipInvariantTest`, `ProtocolSystemInvariantTest`                                                                                                           |
|   2 | Every non-exempt wallet has one transient/pending slot per whole Liquid Token | Both stateful handlers; composed handler includes canonical buys, sells, fractional/whole transfers, recovery, pause, and freeze                                      |
| 3–4 | Every identity has one state and at most one owner                            | Both stateful handlers scan the complete identity partition                                                                                                           |
| 5–6 | Permanent identities never dissolve; Commitment burns exactly one whole unit  | Stateful permanence tracking and immediate pre/post Commitment assertions                                                                                             |
|   7 | Token approvals clear on every ownership path                                 | `FuelOwnershipTest`, `FuelAdministrationTest`, and composed direct/recovery/Commitment checks cover transfer, Commitment, dissolution/rematerialization, and recovery |
|   8 | Only the sealed converter can notify rewards                                  | `RewardLedgerTest.testPrivilegedCallbacksRejectEveryUnauthorizedCaller` plus sealed binding assertions                                                                |
|   9 | Pending Rewards and debt follow the identity                                  | Composed transfer/recovery checks and current-owner claim regressions                                                                                                 |
|  10 | A failed track cannot move another queue                                      | Composed handler snapshots all four queues around every success/failure; the deterministic E2E keeps METAc deferred while the other tracks settle                     |
|  11 | Fee-pot assets move only to sealed destinations                               | Composed WETH/pot equality and immutable destination assertions                                                                                                       |
|  12 | Genesis and POL positions have no removal/withdrawal surface                  | Existing locked-liquidity regression suites plus composed seeded/zero-Fuel assertions                                                                                 |
|  13 | Attribute counts and weights match the accepted matrix                        | Composed invariant scans all 4,444 sealed attributes on every run                                                                                                     |
|  14 | No operation can mint above 4,444 units                                       | Stateful economic-unit conservation assertions                                                                                                                        |

## Adversarial and system scenarios

- `ProtocolSystemE2ETest` uses the real local Uniswap v4 PoolManager, canonical hook/router,
  one-sided Genesis vault, RewardLedger, four sealed routes, and POL vault. The scenario runs twice
  from the same clean EVM snapshot and must produce identical final balances and states.
- `ProtocolSystemInvariantHandler` randomly buys/sells, transfers fractional and whole Liquid Token,
  creates/fulfills/cancels discoveries, commits and transfers identities, pauses, freezes, recovers,
  opens epochs, succeeds/fails tracks, claims, advances time, and adds POL.
- Receiver, router, Settlement Asset, mock-stock, decimals, fee-on-transfer, and native-recipient
  adversarial cases live in the focused ownership, canonical-market, conversion, asset, and POL suites.
- Deployment scripts and tests cover launch ordering, idempotent local deployment, and every sealed
  post-launch mutation attempt.

## Bounded user work and gas snapshots

One transfer can perform at most 64 discovery mutations, and one claim can include at most 64
Permanent Collectibles. Wallet-sized ownership removals use indexed swap-and-pop storage plus linked
latest pointers, so arbitrary transfer/fulfillment does not scan a holder's collection. The linked
pointers preserve most-recent pending cancellation and transient dissolution semantics.

Committed named snapshots are in `snapshots/` and the matching test-level baseline is
`.gas-snapshot`. `pnpm test:gas` checks:

- the maximum 64-identity Discovery batch;
- a high-index transient transfer;
- a high-index pending fulfillment; and
- the maximum 64-identity reward claim.
