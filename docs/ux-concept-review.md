# ORBIT concept review

Decision: the user selected **B · Hangar** on 8 September 2026: one featured craft with a selector. This supersedes the earlier Gallery recommendation. The user subsequently authorized production implementation; see `ux-implementation-brief.md`. This document records the earlier prototype review. All concept balances, identities, rewards, wallet actions, and transactions are sample scenarios.

## Open the concepts

The current local-network preview is [Gallery](http://192.168.1.5:3107/fleet?variant=A), [Hangar](http://192.168.1.5:3107/fleet?variant=B), or [Manifest](http://192.168.1.5:3107/fleet?variant=C). [Trade](http://192.168.1.5:3107/exchange?variant=A) shows chart and form together, per the user's preference. [Home](http://192.168.1.5:3107/?variant=A) introduces the visual direction.

The source lives in isolated worktree `/tmp/orbit-ux-concepts.EdLeZX/checkout`, branch `design/orbit-ux-concepts-20260908`, under `apps/web/prototypes/`. Run `node apps/web/prototypes/serve-orbit-ux-prototype.mjs` from that checkout for loopback access; use `ORBIT_PROTOTYPE_HOST=0.0.0.0` for a browser on the local network. The network address may change; this is not a public deployment.

Use Design review controls for pages and scenarios. Layout arrows switch A/B/C. All outcomes remain in memory; reload or Reset scenario restores the starting data.

## What the three concepts test

| Concept      | Organization                                                        | Best hypothesis                                               | Main risk                                              |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| A · Gallery  | Collection artwork visible together; compact account/reward context | Makes collecting enjoyable and comparisons easy               | Long fleets may need filtering and paging              |
| B · Hangar   | One craft dominates; other craft form a selector                    | Gives a small personal collection a strong sense of ownership | Too many selection steps when managing many craft      |
| C · Manifest | Inventory rows with a selected object/detail area                   | Fast scanning of state, token, and actions for repeat users   | Can drift back toward the dashboard feel being removed |

All three retain Explore, Trade, My Fleet and the same safety/ownership semantics. This is a comparison of composition, not competing protocol designs.

## Review in this order

1. Open My Fleet populated at desktop width and compare A/B/C. Find a grounded craft and the claimable rewards without reading a tutorial.
2. Repeat at 390px. The wallet's collection or access state must appear before any global explanation; the review toolbar is not part of the proposed application.
3. Switch to disconnected, empty, and pending scenarios. Empty collections keep the same Explore/Trade links regardless of balance; there is no next-step ladder. Pending discovery is transaction feedback, not onboarding progress, and must not imply a failed purchase or a craft selected in advance.
4. Open a grounded craft, review Launch, then cancel. Confirm that optionality, the exact craft, permanent FUEL burn, and variable rewards are clear. Simulate confirmation and check that the identity is unchanged while its state changes.
5. Open Rewards and review a claim. Confirm amounts are separate by token and wallet-held tokens are not described as unclaimed rewards.
6. Open Trade, change an amount, and review. Check the form's focus and whether collection consequences are understandable. Simulate a purchase and inspect the pending state.
7. Open Home and Explore. Decide whether the object presentation makes ORBIT feel distinctive, and verify that catalog browsing never suggests you can select a random Discovery result.

## Content decisions already recommended

- Put personal objects first; remove collection-wide census and tier weights from My Fleet.
- Keep a visible claim shortcut within My Fleet; use its Rewards subview for full detail.
- Remove onboarding entirely: no faucet → trade → Launch ladder, wallet-stage classifier, or first-Orbiter completion goal. Launch is an optional craft action.
- Keep exact trade and irreversible-action consequences at review; relocate routine technical context.
- Use a consistent compact network/testnet indicator and one authoritative wallet state.
- Show chart and trade form together by default, per the user's preference: side by side on desktop, compact chart above the form on mobile. Detailed history remains secondary.
- Keep the art specific to ORBIT; use readable body type and quiet surrounding controls.

## What this stage cannot validate

Simulations demonstrate presentation and interaction only. They do not validate live quotes, allowance handling, wallet reconnection, discovery randomness, current ownership, transaction confirmation, claim batching, transfer execution, backend readiness, or production performance. Those stay in the implementation verification plan.

The selected design must also receive a real populated-wallet walkthrough during implementation. Redesigning the wallet shell requires preserving its complete state contract, not reproducing the disconnected mock state alone.

## Findings from the concept pass

The user chose Hangar for its one-featured-craft composition and selector. Preserve that hierarchy in the implementation design. The earlier Gallery recommendation favored earlier mobile artwork and direct comparison; those remain useful checks for Hangar's mobile selector and spacing, not reasons to substitute a grid. These are design observations, not user-testing results.

The pass corrected missing tablet navigation, inert selectors/filters, inconsistent sample state across Rewards and detail, claim amounts that disagreed between screens, stale grounded labels after Launch, and detail artwork that overflowed mobile width. Claims and Launch now use one in-memory sample ledger. A newly launched craft does not instantly invent accrued rewards.

Checked actual browser interactions for selection/focus, disconnected Rewards, Launch acknowledgement and same-identity outcome, one-identity claims and wallet credit, and edited trade amounts leading to pending discovery. DOM geometry checks at 390/768/1024/1280px covered Home, Fleet variants, Trade and craft detail without page overflow, with primary navigation present.

Screenshot and recording export failed in the collaborative preview tool. The interactive preview and DOM/interaction checks work, but a screenshot-based visual review is incomplete. No production wallet transaction or application implementation was performed.
