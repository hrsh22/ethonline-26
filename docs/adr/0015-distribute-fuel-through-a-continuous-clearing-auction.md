# Distribute fresh FUEL through a Continuous Clearing Auction

## Decision

The next development deployment distributes a fresh 4,444-unit FUEL supply through Uniswap's
Continuous Clearing Auction and seeds the Canonical Market from the successful auction's discovered
price. It replaces the one-sided Genesis Liquidity launch described by
[ADR 0004](./0004-launch-the-entire-supply-through-locked-liquidity.md). ADR 0004 remains the record of the
earlier deployed POC; its fixed opening tick, all-supply genesis vault, and immediate trading launch
do not apply to schema-v3 deployments.

This decision is limited to the ETHOnline Base Sepolia phase. Production economics require a
separate review. Every project contract is deployed fresh, the collection starts with no holders,
collectibles, rewards, or historical activity, and no state or liquidity moves from an earlier
deployment.

## Supply and auction custody

The development defaults allocate 4,000 FUEL to the auction and 444 FUEL to the locked-liquidity
reserve. There is no team allocation. The deployment manifest records the exact auction supply,
reserve, floor, price spacing, minimum raise, start, end, claim, and migration blocks and the encoded
issuance schedule. The default values live in
[`docs/economics/cca-testnet-defaults.json`](../economics/cca-testnet-defaults.json).

The deployment uses the pinned official CCA factory and `LBPStrategy` accounting. Fresh FUEL moves
through the official Liquidity Launcher existing-token flow: Permit2 deposit and strategy
distribution execute in one multicall, and the launcher must end with no FUEL balance or residual
strategy allowance. Auction bids use WETH. The project configures no additional auction fee.

Every bid owner is a deterministic `CcaBidEscrow` fixed to the wallet that paid for the bid. The CCA
validation hook requires that payer/beneficiary relationship. CCA claims and refunds land in the
escrow. Currency refunds can leave immediately; purchased FUEL leaves only after the Canonical
Market opens and in transfers of at most 64 FUEL so FuelCore's discovery-mutation bound remains in
force. Infrastructure custody is Discovery-exempt and protected before auction funding.

## Pool handoff and launch gate

The official LBP strategy alone initializes the announced hooked, dynamic-fee FUEL/WETH PoolKey in
the normal path. `CanonicalFeeHook.beforeInitialize` checks the exact initializer and PoolKey, which
prevents an outsider from pre-initializing the announced pool at a different price. The resulting v4
position is sent to `PermanentPositionRecipient`, which exposes no transfer, approval, withdrawal,
ownership, or arbitrary-call path. It records a position only when the official PositionManager
still reports this recipient as its owner, the PoolId is canonical, and liquidity is nonzero.

`CcaLaunchCoordinator` temporarily owns FuelCore. It cannot call `FuelCore.launch` until the sealed
registry, strategy authorization, initialized PoolKey, and permanent canonical position are all
verified onchain. Activation then opens FUEL movement and offers FuelCore ownership to the recorded
governance address. A successful transaction receipt from `LBPStrategy.migrate` is not readiness:
the strategy catches internal migration failures and emits failure events.

## Terminal migration recovery

The stock strategy consumes its pool reservation even when its internal migration fails. Its fixed
recovery recipient is therefore `CcaRecoverySeeder`. The hook names that contract as the only
secondary initializer before the registry is sealed. This does not grant a general administrative
override.

Anyone may retry `recoverAndSeed`, but only after the recorded migration block, after the official
strategy has consumed the exact PoolId reservation, while the canonical pool is still
uninitialized, and when the contract holds the recorded reserve plus the successful auction's net
WETH. The call atomically initializes the same PoolKey, mints a full-range position to the same
permanent recipient, and registers the position. If PositionManager execution fails, initialization
and asset transfers revert together and the operation remains retryable. Unsold FUEL, excess funds,
and rounding dust remain in this fixed no-withdrawal custody.

An auction that does not meet its minimum raise does not open the market. Its bids exit through the
CCA refund path and bidder escrows. The recovery seeder cannot use unsuccessful-auction accounting
as a successful liquidity budget.

## Preserved economics and collection behavior

After activation, the Canonical Market keeps ADR 0001's permanent 3% WETH-side fee: 2% Stock
Rewards, 0.85% Protocol-Owned Liquidity, and 0.15% creator. FUEL acquisition still creates Pending
Discoveries, Discovery still follows ADR 0014's single-batch randomness and ordered finalization,
and Commitment still turns a Grounded Craft into an Orbiter. Auction participation does not create
an equal or retroactive Stock Reward right; the first ordinary Permanent Collectible in a Reward
Track still receives that track's Unclaimed Track Pot.

Auction bids, exits, allocations, claims, migration, recovery, activation, and bounded delivery are
indexed as their own lifecycle. They are not represented as Canonical Market swaps or hook fees.
Current eligibility remains a block-pinned contract read; indexed history is for presentation and
recovery across sessions.
