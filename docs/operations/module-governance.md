# Module governance and ownership handover

The Base Sepolia proof of concept concentrated owner, guardian, keeper,
executor, and creator in one EOA, and the mutable module owners could not be
transferred at all. A compromised or lost key therefore permanently held pause
and role-rotation authority, and recovery could not replace it.

## What changed

The four mutable modules — Reward Ledger, Epoch Converter, Protocol Liquidity
Vault, and Canonical Market Registry — plus the liquid token now share one
`TwoStepOwnable` base:

- handover is two steps. The current owner **nominates**, and the nominee must
  **accept** from the very key that will hold the role;
- `GOVERNANCE_OWNER_ADDRESS` names the intended governance signer, which may be
  a Safe or other multisig and is separate from the hot keeper and executor keys.
  The deployment **nominates** that address for the four mutable modules; it does
  not make it the owner.

The second step is the point. A single-step transfer fixes the immutability
problem but introduces a worse one: a mistyped address hands governance to an
address nobody controls, irrecoverably. Requiring the nominee to accept proves
the new key works before the old one loses authority. `FuelCore` previously had
exactly that single-step hazard; it no longer does.

## What state a governed deployment ends in

**The deployer still owns every module when the deployment finishes.** Each of
the four is constructed deployer-owned, because every configuration and sealing
call the deployment makes on them is `onlyOwner`; the nomination is issued last,
just before launch. So a fresh governed deployment ends with

- `owner()` = the deployer on all five modules, which is what `moduleOwners`
  records, and
- `pendingOwner()` = `GOVERNANCE_OWNER_ADDRESS` on the four mutable modules.

Setting `GOVERNANCE_OWNER_ADDRESS` therefore does **not** by itself remove the
deployer's authority. Governance is not in place until step 3 of the drill below
has been executed from the multisig, and until then the deployer key is still a
single point of compromise. Treat the deployment as ungoverned until the drill
is recorded.

`FuelCore` is never nominated. It holds the launch, pause, and discovery
authority the deployment itself needs, so it stays on `roles.owner`.

That is a deployment-time constraint, not a permanent one. After launch every
FuelCore configuration setter is dead (`TradingLocked`), so the owner's only
surviving powers are `setPaused` -- the protocol-wide halt -- and
`transferOwnership`. Concentrating the kill switch on the deployer EOA is the
accepted POC posture; when it should move, the same two-step handover works
post-launch: nominate the Safe from the deployer, accept through the Safe, then
re-record `moduleOwners.liquidToken` and `modulePendingOwners.liquidToken` in
the manifest. Health and rerun verification fail during the window where the
chain and the manifest disagree, which is the same intended re-record signal as
for the other four modules.

## Handover drill

Run this on a fork before running it anywhere real.

1. From the current owner, call `transferOwnership(newOwner)` on each module.
   Ownership does not move; `pendingOwner()` is set and the current owner still
   governs. A deployment run with `GOVERNANCE_OWNER_ADDRESS` has already done
   this step for the four mutable modules; start at step 2 in that case.
2. Verify `pendingOwner()` on every module. A partial nomination is visible here
   and is the moment to stop if anything looks wrong.
3. From the new owner, call `acceptOwnership()` on each module. For a Safe this
   is a Safe transaction, which also proves the Safe can execute.
4. Verify each module's `owner()`, and verify the **old** owner is now rejected
   for one governed operation per module.
5. Re-run `pnpm health:base-sepolia`. Each module's owner is checked against its
   own recorded owner, so a partial handover fails the check rather than passing
   on a nominal match.

`cancelOwnershipTransfer()` withdraws a nomination that has not been accepted.

### Running the drill with the scripted path

Two scripts cover the Base Sepolia case end to end.

```
pnpm governance:safe     # deploys a Safe and prints GOVERNANCE_OWNER_ADDRESS
pnpm governance:accept   # steps 2-5 above, then re-records the manifest
```

`pnpm governance:safe` deploys a Safe v1.4.1 proxy through the canonical factory
with the deployer as sole owner and a threshold of 1, verifies every Safe
contract has code on the connected chain first, reads the deployed Safe back,
and writes `deployments/84532-governance-safe.json`. Raise
`GOVERNANCE_SAFE_SALT_NONCE` to deploy a second, distinct Safe.

**A 1-of-1 Safe owned by the deployer is not yet a separation of duties.** It
does not stop a compromised deployer key from governing, and losing that key
still loses governance. What it does buy is that the loss stops being permanent:
Safe owners and threshold are mutable, so signers can be added and the threshold
raised at any time with no further protocol deployment. Migrating from an EOA
owner to a multisig, by contrast, needs a whole new checked deployment.

`pnpm governance:accept` refuses to act unless each module's `pendingOwner()`
already names the Safe, executes `acceptOwnership()` through the Safe, and then
reads `owner()` and `pendingOwner()` back for each module. Reading back matters:
Safe reports an inner revert as a failure event rather than reverting
`execTransaction`, so a successful receipt alone is not proof the handover
happened. It signs with a pre-validated Safe signature (`v = 1`), which needs no
off-chain signing because the caller is the owner. Finally it re-records
`moduleOwners` and `modulePendingOwners` in the manifest, which otherwise leaves
health failing until someone remembers to hand-edit it. Commit that manifest
change, then run `pnpm health:base-sepolia`.

## Compromised-key recovery

While the compromised key still functions, nominate the replacement and have it
accept. Once accepted, the compromised key has no authority — including no
ability to nominate anyone else. If the key is already lost rather than
compromised, ownership cannot be moved, which is why the handover to a multisig
should happen before a deployment carries value.

## What the manifest now records

`moduleOwners` records each mutable module's actual owner separately,
`modulePendingOwners` records each outstanding nomination, and
`roles.governanceOwner` records the intended governance signer. A single nominal
owner hid that these are independent, so health, diagnostics, and runbooks could
not verify them.

`modulePendingOwners` exists because `owner()` alone cannot tell a handover that
was never offered from one offered to an address no review ever approved — and
whoever holds a nomination takes the module by accepting it. Health checks the
recorded nomination against chain state, and an absent record expects no
nomination, so a surprise offer fails rather than passing quietly.

The two differ on purpose while a handover is outstanding: `moduleOwners` is who
can act now, `roles.governanceOwner` is who is meant to. Once the multisig
accepts, `owner()` no longer matches the recorded `moduleOwners`, and both the
deployment's rerun verification and `pnpm health:base-sepolia` fail until the
manifest is re-recorded. That failure is the intended signal — the checked
manifest has to state who actually governs — so re-record it as part of the
handover rather than treating it as a regression.

## Immutable modules

Some live modules have no owner to rotate. Migrating those is a **new checked
deployment**, not an in-place rotation, and this document will not pretend
otherwise. The existing Base Sepolia deployment stays labelled as a proof of
concept.

## Before any value-bearing deployment

- every mutable module owned by a reviewed multisig, verified by the drill above;
- keeper and executor on dedicated hot keys, separate from governance;
- a completed fork handover drill recorded with date, addresses, and outcome;
- health, manifest, and diagnostics agreeing on every module's owner.

## Deployment inputs added by this work

| Variable                       | Default      | Purpose                                                     |
| ------------------------------ | ------------ | ----------------------------------------------------------- |
| `GOVERNANCE_OWNER_ADDRESS`     | the deployer | Nominated owner of the four mutable modules; a multisig     |
| `BLOCKED_VENUE_INVENTORY_PATH` | unset        | Alternative-venue inventory, final at launch (see ADR 0002) |

Both environment variables are optional. Claim eligibility is not a governance
input: new deployments bind the fixed always-allow policy described in
[claim policy](./claim-policy.md).
