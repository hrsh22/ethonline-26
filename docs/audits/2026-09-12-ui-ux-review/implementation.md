# Orbit UI/UX implementation — 12 September 2026

Implemented for the `main` release. Frontend publication follows the repository deployment pipeline. The authorized Privy branding change is saved in the live project: **ORBIT 4444**, accent `#FF7A30`.

## What changed

The collecting experience now leads with the object and the next action. Explore, Trade and My Fleet are the primary navigation; funding, help and diagnostics are utilities. Navy surfaces, readable Barlow prose, larger artwork and quieter panel headers replace much of the repeated console chrome. Precise amounts retain monospace formatting.

| Audit finding                              | Implementation                                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Wallet signing can stall after mining | A bounded wallet wait changes to an honest unresolved state. Exact-call receipt recovery checks chain evidence automatically, keeps the operation locked, and accepts a late wallet hash without resubmitting. Manual recovery remains available.               |
| 02 · Misleading cross-tab recovery         | Other tabs follow scoped transaction records and confirmations. Opening a second tab no longer claims the original app closed.                                                                                                                                  |
| 03 · Destructive sales                     | The review highlights cancellation/dissolution counts in a dedicated consequence block.                                                                                                                                                                         |
| 04 · Mobile order position                 | Amount entry and review precede market context on narrow screens.                                                                                                                                                                                               |
| 05 · Repeated Trade information            | A compact review shows the collection consequence, minimum, fee and price impact. Detailed terms and route evidence are expandable. The simple price history is the default; the advanced chart is optional.                                                    |
| 06 · Lost trade context                    | Input is restored by deployment and wallet. Quotes are refreshed; the accepted quote remains visible while signing. Stored drafts never authorize transactions.                                                                                                 |
| 07 · Purchase handoff                      | Confirmation includes the updated balance and a direct View Fleet action.                                                                                                                                                                                       |
| 08 · Discovery processing log              | One delivery state and useful next step lead; request mechanics and references are expandable. Delays and unavailable service data stay distinct from healthy delivery.                                                                                         |
| 09 · Rewards hierarchy                     | Personal claimable amounts and the claim action come first. Per-identity rows, conversion progress, wallet balances and eligibility rules are expandable. Confirmation is shown inline.                                                                         |
| 10 · Sample-only Explore                   | All 4,444 identities can be browsed with track/tier filters, pagination and search. Cards read actual identity state. Browsing context survives inspection.                                                                                                     |
| 11 · Identity detail                       | Artwork, traits and relevant owner actions lead. Support and provenance move below them. Public identities have a random-discovery acquisition explanation and direct next step.                                                                                |
| 12 · Ended Auction                         | The completed phase shows results instead of a bidding form. Disconnected visitors no longer trigger an invalid zero-address escrow read; bid-history reads stop at the auction end block. Auction is promoted in navigation only for an observed active phase. |
| 13 · Artwork and presentation commentary   | Ordinary artwork is shared across Home, Explore, Fleet, detail, Launch and social cards. Relics retain distinct silhouettes. Routine preview/implementation labels are removed. **Existing NFT metadata remains unchanged by request; see below.**              |
| 14 · Wallet brand                          | Privy project name saved as ORBIT 4444. A fresh WalletConnect session passed an exact ORBIT 4444 peer-name check. Frontend connection presentation uses the same identity.                                                                                      |
| 15 · Navigation overload                   | Three persistent collector destinations, visible mobile branding and a compact account menu. Testnet context stays in the account menu/footer and relevant decisions.                                                                                           |
| 16 · Home introduction                     | A concise Buy → Discover → Launch sequence explains the collecting loop; rewards link to rules.                                                                                                                                                                 |
| 17 · Fleet management                      | Launch/reward actions are available from the selected craft. Larger collections default to a grid with an optional hangar view. A single holding avoids a redundant selector.                                                                                   |
| 18 · Amount correction                     | Available balance sits beside entry, including known zero balances. Max retains the native gas reserve; a zero spendable balance does not offer a zero-value Max action. Empty funded balances offer the funding route.                                         |
| 19 · Discovery target                      | Enough for 1 Discovery calculates a fresh exact-output target that accounts for the protected minimum. The review labels the outcome as expected and warns if minimum output supports fewer Discoveries.                                                        |
| 20 · Faucet                                | Top-up amounts and the request/onward action lead. Cooldown uses relative time; budgets and other limits are expandable.                                                                                                                                        |
| 21 · Relics                                | Larger artwork, immediate appearance controls and readable per-track allocation. Cards reflow at enlarged text sizes.                                                                                                                                           |
| 22 · Learn                                 | Indexed Getting started, Rules, Help and Technical sections; contract addresses do not precede onboarding.                                                                                                                                                      |
| 23 · Visual hierarchy                      | Shared type, color, spacing, button and panel refinements; browser checks cover contrast, focus, overflow and reduced motion.                                                                                                                                   |
| 24 · Vocabulary and formatting             | Spaced units, consistent amount precision and relative times with exact timestamps available. Known zero remains distinct from unavailable data. A claimed identity says No unclaimed rewards.                                                                  |
| 25 · Search and return flow                | Whitespace, `#` and padded numbers normalize to canonical identity URLs. Explore stays active during public inspection. Invalid identity recovery retains the attempted value in search.                                                                        |
| 26 · Human-readable status                 | Current service condition and observation age lead. Onchain health is explicitly scoped so it cannot imply healthy delivery. Exact protocol checks and funding mechanics are expandable; stale observations remain explicitly stale.                            |
| 27 · Launch and transfer                   | Launch keeps the one-FUEL burn and acknowledgement, with matching before/after artwork and a clear completion handoff. Transfer entry is expandable and its review preserves full recipient and consequences.                                                   |

## Live testnet verification

Eight fresh Base Sepolia accounts used the normal faucet, with no faucet bypass. This exercise performed **156 successful swaps**, **two Launches**, **two reward claims**, and **two collectible transfers**. The bulk trading exercise stopped when the reward pot reached **0.041029206623095379 WETH**. One initial harness swap reverted; replay isolated insufficient gas headroom in the harness. The application's existing 25% gas margin was already correct, and the harness was corrected before continuing.

The live operator initially reported a failed run, then opened epoch 1 and drained all four conversion queues. SSH inspection of `orbit-milesvm` confirmed the conversion completed at 11:35 UTC. Later intermittent failures came from inconsistent transaction confirmation boundaries; see the operator repair below.

| Verification                    | Observed result                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launches                        | Orbiter #3687 and Orbiter #1172 confirmed onchain.                                                                                                                                                                  |
| Claim through mobile UI         | #3687 credited exactly **0.835237018420278860 AAPLc** to the current owner. Pending rewards then read zero.                                                                                                         |
| Transfer with unclaimed rewards | #1172 moved from test account 2 to account 1 with **0.834385623854519611 GOOGLc** unchanged. A claim simulation from the former owner was rejected.                                                                 |
| Claim by recipient through UI   | The receiving account claimed the transferred GOOGLc entitlement. Its wallet balance matched the receipt; the identity's pending rewards read zero.                                                                 |
| Transfer through UI             | #3687 transferred back to test account 2 after full recipient/network review. Ownership refreshed correctly.                                                                                                        |
| Sale through UI                 | Selling 0.4 FUEL showed cancellation of one pending Discovery, ran approval and sale, and confirmed **0.916012613200434547 FUEL** remaining with zero pending Discoveries. The permanent Orbiter remained in Fleet. |

Receipt hashes, public account addresses and observations are in [transaction evidence](after/transactions.json). Keys and pairing links are excluded. The local browser reads live public data through a temporary loopback read proxy because the production API correctly rejects the localhost origin; production origin policy was not changed.

## Browser and automated checks

- Chrome verification used live staging data and a fresh WalletConnect test wallet. It covered mobile claim review, positive claims, recipient eligibility after transfer, transfer review, sale consequences, success handoff, wallet branding, search normalization, back navigation and invalid identity recovery.
- Unit/component coverage includes bounded wallet recovery, late hash handling, cross-tab scope/receipt synchronization, isolated draft restoration, blocked storage and protected Discovery thresholds.
- [Production browser report](after/browser-matrix.json).
- **1,012 frontend tests passed** across 119 files. **142 production browser cases passed**, and the browser harness passed **22 self-checks** that deliberately inject regressions.
- `pnpm check:ci` passed formatting, lint, schemas, manifest synchronization and repository type checks. **606 script tests passed**, including the operator receipt-to-reconciliation regression test.
- A near-current observation displays Just now rather than a future countdown caused by the clock update interval.
- Share-card rendering was repaired by using SVG path lettering supported by the image renderer. Ordinary and relic share images both return PNG successfully.

## Navigation hydration repair

A cached auction observation could reach `ContextNavigation` before its Suspense boundary hydrated. The server rendered Explore / Trade / My Fleet, while the client's first render inserted Auction. This produced the reported recoverable hydration errors in both desktop and mobile navigation.

The navigation now uses React's hydration snapshot to keep its initial tree identical to the server. It applies the observed auction state after hydration and still updates normally when an auction ends. A regression test uses `renderToString` and `hydrateRoot`, reproduces both original text mismatches before the fix, and verifies zero recoverable errors after it. It also verifies subsequent auction updates and the Explore return context. Chrome desktop and 390px mobile reloads report no hydration errors.

## Staging operator repair

The VM's PM2 `orbit-operator` process was reachable through `ssh orbit-milesvm`. Its saved policy was live, its supervisor was online, and all four reward queues were already clear. The logs identified recurring signing gates: the runner waited for two viem confirmations (inclusion plus one block), while durable reconciliation required two blocks **after** inclusion. A cached block-number read could compound that mismatch.

The repair preserves the existing two-block safety boundary, shares it across reward, Discovery and CCA receipt waits, and bypasses the block-number cache during reconciliation. A regression test drives the receipt wait and reconciliation together: the former implementation stops at block 13 for a receipt in block 12 and cannot proceed; the repaired implementation waits to block 14 and passes the unchanged safety check.

Only these runtime scripts were patched on the VM: `base-sepolia-operator.ts`, `discovery-maintenance.ts`, `cca-maintenance.ts` and the new shared `operator-confirmation.ts`. Their deployed starting revisions matched the local originals. Backups are under `/home/orbit-api/.local/state/orbit/patches/2026-09-12-confirmations/backup`. The idle watch was restarted and retained its live policy; its first patched cycle completed at **12:34:47 UTC**. No ledger, queue, key, contract, or role was reset.

A further 0.0008 ETH test buy created one Discovery. The patched scheduled cycle completed at **12:39:59 UTC**; the account then held **Grounded Craft #1794 with zero pending Discoveries**. The buy receipt and final onchain delivery observation are included with the transaction evidence. [VM repair evidence](after/operator-repair.json) records the service state, maintenance actions and patched file hashes.

## NFT metadata retained by request

The existing onchain metadata for #3687 still has a placeholder description and `placeholder://orbit-4444/orbiter` image URI. This is **not repairable with a frontend deployment**: `FuelCore.setMetadataRenderer` rejects changes once the collection has launched, and the deployed renderer exposes no update method. Current deployment launch state is true.

The user explicitly chose to retain this deployed NFT metadata. No renderer, metadata URL or description, contract, or ownership migration is part of this release. Frontend artwork and generated share cards are updated independently. The UI mentions the limitation only in relevant wallet-artwork help.

Privy branding and the narrowly scoped staging operator repair are live. The `main` handoff includes the frontend changes and synchronizes the VM checkout with the committed operator repair. No contract redeployment or production-value transaction was performed.

## Visual evidence

- [Home](after/home-desktop.jpg)
- [Mobile Trade](after/trade-mobile.png)
- [Mobile sale consequence](after/sell-consequence-mobile.png)
- [Fleet](after/fleet-desktop.jpg)
- [Full collection, relic filter](after/explore-relic-filter-desktop.jpg)
- [Relics on mobile](after/relics-mobile.png)
- [Transferred rewards](after/transferred-rewards-desktop.jpg)
- [Claimed balances](after/claimed-balances-desktop.jpg)
- [Transfer review](after/transfer-review-desktop.jpg)
- [Wallet branding](after/wallet-branding.jpg)

- [Public auction results](after/auction-results-desktop.jpg)
- [Delivery and onchain status](after/status-desktop.jpg)
