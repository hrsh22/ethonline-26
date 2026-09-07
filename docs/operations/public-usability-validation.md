# Public collector validation

Implementation record for specs #53 and #56, 6 September 2026.

The collector app now has Fleet, Trade, Rewards, and More in a persistent mobile navigation bar. The existing drawer handles More, Escape, and focus restoration. The page reserves the bar's height and bottom safe area. The bar remains stable when focus moves from an input to an action; hiding it on input focus caused it to reappear over the submit button between pointerdown and pointerup. Virtual-keyboard behavior on a physical device remains a manual acceptance check. Phone body and explanatory text use 16 px tokens with 1.6 line height; numeric form controls use explicit 16 px text. Desktop layout, tabular monospace, reduced motion, and native browser Back remain in place.

Component checks exercise primary links, active routes, More/Escape focus restoration, menu keyboard containment, and URL-backed Fleet filters. These are automated desktop DOM checks. The production browser matrix separately covers rendered narrow layouts, control sizing, contrast, keyboard navigation, and reduced motion. The implementation does not establish support for every wallet or mobile browser.

## Validation still required

No unfamiliar-user session, physical-device wallet handoff, or manual screen-reader session is recorded as completed by this implementation.

| Check                                                        | Status        | Record when performed                                                                                                           |
| ------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Five unfamiliar collectors complete the journey              | Not performed | Anonymous participant ID, date, observed misunderstandings and fixes                                                            |
| Physical mobile wallet connection and return                 | Not performed | Device, OS, browser, wallet versions, connection method and observed result                                                     |
| Physical virtual keyboard and text enlargement               | Not performed | Device/browser, amount entry, final action reachability, and navigation overlap                                                 |
| Manual screen reader                                         | Not performed | Screen reader/browser, focus order, meaningful announcements and repeated announcements                                         |
| Comparable constrained-network measurements before and after | Partial       | [Recorded for one-craft Fleet and idle Trade](./collector-performance.md); public exploration and 50 holdings remain unmeasured |

## Session tasks

Give each participant a fresh browser session and valueless test assets only. Do not explain the terminology before observing their first attempt.

1. Explore publicly and explain what is bought when buying FUEL.
2. Connect, obtain test funding, and return to the next step.
3. Review a purchase and explain the wallet request. Observe any confusion between a proof, allowance, and transaction.
4. Encounter a delayed Discovery and identify the current stage, who is handling it, and where to return for progress.
5. Inspect a craft and review the optional Launch. Ask what happens to exactly one FUEL and whether Launch can be reversed. The participant need not submit it.
6. Inspect verified-zero, claimable, and unavailable reward examples. Ask which tokens can be claimed and why an unavailable amount differs from zero.
7. Find contextual help and copy the public support reference. Confirm no secret or unrelated wallet history is required.

Record hesitation and misunderstood prompts in the participant's words. Mark a task complete only after observing it. Fix material comprehension problems before public sign-off, and rerun the affected task with a participant who has not learned the previous interface.

## Measurement procedure

Use the same build mode, seeded wallet and collection size for each comparable run. Fix viewport and network conditions, reset caches consistently, and measure public exploration, Fleet with 50 holdings, and Trade before any transaction is clicked. Record initial rendering, layout shifts, request counts by endpoint, and RPC methods. Local filters, preview toggles and pagination must not add RPC calls. A measurement made only after the changes is a current measurement, not evidence of an improvement over an unmeasured baseline.

## Integrated browser coverage

The final production matrix passed 109 cases, including the seven [collector journeys](collector-journeys.md). The mobile public-lookup journey also proves that navigation remains stable between input focus and submit; its regression failed before the focus-driven hiding rule was removed and passed afterward.

Whole-journey request counts include navigation, confirmation and reconciliation. Use the [controlled startup comparison](collector-performance.md) for the comparable idle-load RPC and rendering measurements; they have a different measurement window.
