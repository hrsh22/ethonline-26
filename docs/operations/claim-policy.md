# Claim policy on Base Sepolia

Every new protocol deployment binds `AlwaysAllowClaimGate`. The ledger itself
still requires each claimed identity to be permanent, active, and owned by the
caller, so the fixed adapter removes only the second per-wallet approval step.
Launching a Grounded Craft is therefore sufficient to activate its rewards, and
its current owner can claim accrued rewards without an operator transaction.

The deployment manifest records `mode: "always-allow"`, the implementation
codehash, and the zero administrator. Health verifies the deployed codehash
against that record. `DeployProtocol` does not read a claim-policy environment
variable, so a stale host setting cannot reintroduce an administrator.

## Historical configurable deployments

Base Sepolia deployment `84532` bound `ConfigurableClaimGate`, which denies a
wallet until its administrator approves it. The gate address is immutable in
`RewardLedger`; code or frontend changes cannot alter that deployed behavior.
That deployment must be replaced before the self-service claim rule is live.

The configurable implementation, manifest decoding, health checks, and denial
tests remain only so historical evidence can still be inspected and the ledger's
fail-closed behavior stays covered. They are not selectable by new deployments.

## Claim behavior

- Pending Rewards remain attached to the Permanent Collectible until claimed.
- Claim eligibility follows the current owner automatically, including after a
  transfer.
- A previous owner cannot claim after transfer.
- A failed reward-token transfer leaves the entitlement pending.
- No policy administrator approves or revokes individual collector wallets.

## Production boundary

The Base Sepolia assets are valueless test assets. Any production use of
regulated reward assets still requires a separately resolved legal and issuer
eligibility design. That future decision must not silently turn routine claims
into a manual administrator queue.

## Rebinding requires a new deployment

The gate address is `immutable` in `RewardLedger`, and `FuelCore` cannot replace
its ledger after launch. Switching deployment `84532` to the fixed policy
therefore requires a new checked protocol deployment and generated web manifest.
