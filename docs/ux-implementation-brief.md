# ORBIT UX implementation brief

Status: implemented following the user's 8 September 2026 authorization. **B · Hangar** uses one featured craft with a selector. The packages below record the implementation contract; verification results are recorded at the end.

## Work packages and dependencies

### 1. Adopt the design and route contract

Use the chosen Hangar composition: one featured craft with a selector, with a clear selected state and usable mobile placement. Revise the collector-specific parts of `docs/design-foundations.md` during implementation. Preserve protocol terminology/identity separation in ADR 0005. Set the route contract before redirecting pages:

| Entry                          | Proposed canonical experience | Compatibility requirement                                                                        |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `/fleet`                       | My Fleet → Collection         | Preserve existing `state`, `track`, `rewards`, `id`, and `page` query keys and Back restoration  |
| `/rewards`                     | `/fleet?view=rewards`         | Deep link directly to claims; use an additive subview parameter                                  |
| `/start`                       | Fixed redirect to `/fleet`    | Translate legacy `/exchange?returnTo=/start` links without loops; no wallet-dependent routing    |
| `/fleet/[identityId]`          | Shared craft detail           | Preserve URL; a validated origin (Explore or Fleet) selects back navigation, defaulting to Fleet |
| `/market`                      | Trade → Market                | Keep a shareable Market view and compatible direct entry                                         |
| `/relics`                      | Explore → Relics              | Retain a direct entry to the relic group                                                         |
| `/status`, `/learn`, `/faucet` | Secondary utilities           | Remain accessible, including without a wallet                                                    |

Implementation: `apps/web/src/components/fleet/fleet-panel.tsx`, `apps/web/src/components/fleet/fleet-views.tsx`, and `apps/web/src/components/start/collector-return-link.tsx`. The additive `selected` query key preserves the featured craft through detail and Rewards navigation.

Verify redirects and query preservation before retiring entry-page presentations.

### 2. Collector foundations and shell

Depends on package 1. Introduce the compact collector header, three-destination mobile navigation, readable typography, and quieter composition. Preserve the operator rail and layout: `AdminShell` currently reuses `ShellRail` and sidebar dimensions (`apps/web/src/components/shell/admin-shell.tsx:20`).

Scope collector typography/layout changes explicitly; global `:root` token changes currently affect admin and wallet surfaces too. Keep common semantic status colors, focus, reduced motion, and 44px target rules. Reuse wallet controls and accessible menu mechanics.

Adapt shell/navigation assertions; retain admin boundaries, wallet states, keyboard focus, Escape/outside-click behavior, and mobile bottom-padding checks. Do not remove useful tests merely because old labels/layouts change.

### 3. Remove onboarding orchestration and simplify My Fleet

Depends on packages 1–2. Delete the Fund → Discover → Launch journey and its next-action orchestration, not just the step indicators. Do not introduce a replacement wallet-stage classifier, onboarding completion flag, or first-Orbiter goal. Retire journey-only code and tests after tracing consumers; retain or extract any shared transaction checks that still have real callers.

My Fleet shows the collection, or a simple empty collection with fixed Explore and Trade links. Its empty-state action does not change with funding or fractional balances. Display actual balances as facts; explain whole-unit discovery effects in Trade. Launch remains an optional craft action, never a recommended next step toward completion.

Concrete removal boundary: `collector-journey.ts`, `components/start/collector-next-action.tsx`, and `onboarding-panel.tsx`; remove their Fleet/Start consumers and guided-journey links on Home/Learn/recovery. Keep generic validated origin navigation only where useful, translating legacy `/start` returns to the fixed Fleet destination. Page-local wallet and protocol data already supply operational facts; do not recreate the deleted journey helpers under a new name.

Retain operational state where it belongs: connection/network access at the wallet boundary, insufficient balance and gas checks in the attempted transaction, pending/delayed discovery beside the relevant holdings, and fresh ownership/reward checks on their actions. Keep the faucet as a testnet utility, optionally linked from Trade when funds are insufficient. None of these facts feeds a cross-page user progression model.

Keep filtering, URL validation and Back restoration; reuse discovery progress/outcomes and stale-holdings action locks. Never treat a failed holdings read as an empty wallet that needs another purchase.

Replace journey-only presentation tests with checks for direct route entry, fixed empty-state navigation across balances, and absence of onboarding gates. Retain transaction funding/gas decisions, thresholds, delayed discovery, partial reads, and wrong-network distinctions.

### 4. Rewards integration

Depends on package 3. Add Collection/Rewards subviews to My Fleet and a compact claim shortcut. Use one provider-owned wallet/access state for both; page composition must not independently reinterpret connection status.

Reuse per-token aggregation, eligibility checks, 64-identity claim batches, and review invalidation in `apps/web/src/components/rewards/rewards-panel.tsx`. Keep per-craft attribution and distinct wallet-held token balances. Protocol conversion queues remain separate from personal rewards.

Retain tests for claims spanning four assets, the 64+1 batch boundary, unread identities, changing reward amounts, loss of ownership, and pending transaction locks (`rewards-review.test.tsx`, `rewards-panel.test.tsx`). A claim shortcut must never imply one transaction covers an undisclosed remainder.

### 5. Detail and Trade presentation

Depends on package 2 and the settled route/state contract. Recompose the UI around existing transaction intent, quote, ownership, and execution functions.

Craft detail must preserve the exact identity, current owner, FUEL burn balance, Launch acknowledgement, and scope changes that invalidate an open review. Transfer requires the full validated recipient, network, and grounded/permanent consequences. Claim review retains its asset/identity/batch facts.

Trade displays the chart and form together by default: side by side on desktop and compact chart above the form on mobile, following the user's explicit choice. It keeps explicit settlement selection, pay/receive amounts, minimum received, fee, meaningful price impact, and actual collection-boundary effects. Asset suggestion may use the existing empty-input logic; never silently change the pay asset after input/review. Preserve quote cancellation, expiration, account scope, discovery limits, approval versus swap, and unknown transaction outcome handling.

Relevant seams: `apps/web/src/lib/exchange-state.ts`, `apps/web/src/components/trade/exchange-panel.tsx:638`, `apps/web/src/components/fleet/craft-detail-panel.tsx:583`.

Retain craft-review and rewards-review invalidation tests, exact reviewed quote/min-output tests, native-ETH versus WETH approval behavior, transaction recovery, rejected signatures, and wallet/account changes during review. Visual refinement must not make an old review executable after its facts change.

### 6. Home, Explore, utilities, and cross-state verification

Complete after the new shell and personal flows. Remove Home accounting boards and duplicate explanations, preserve the identity adapter, and add a clear public catalog. Editorial art, published previews, and current onchain identity state must remain distinguishable. No individual catalog card promises that buying FUEL yields its identity.

Move existing public census/accounting to Status, economics to Help/Learn, and test funding to secondary utilities while retaining utility URLs. Home has direct Explore/Trade navigation and concise product copy, not a sequential tutorial. Do not expand public API payloads to include authenticated diagnostic data.

Run appropriate existing component checks and the production browser matrix for the changed routes/states. At desktop and 390×844, visually inspect populated, empty, disconnected, connecting/restoring, wrong-network, partial/stale, pending/delayed discovery, transaction review, rejection, unknown outcome, and synchronized success. Preserve keyboard navigation, focus restoration, reduced motion, contrast, and overflow checks. A live populated-wallet walkthrough remains necessary; the design prototype cannot establish those results.

## Scope limits

These packages change presentation and navigation and remove the collector journey/next-action model. They do not redesign contracts, rewards economics, randomness, transaction execution, the authenticated admin boundary, or identity immutability. The prototype is reference material and will be rewritten through the existing application seams rather than copied into production.

## Implementation notes and verification

The shipped composition uses the existing identity-specific `CraftArt`, wallet provider, indexed market history, and transaction components. No simulated prototype ledger was copied into the application. The featured craft and selector lead My Fleet; the token-separated claim shortcut follows the craft, with Rewards always available through its subview. Advanced filters are collapsed unless active. Selected identity and filters survive detail and Rewards navigation.

The collector header and Barlow typography are scoped to the collector shell; the protected operator layout remains separate. Home uses existing identity-owned editorial artwork. Explore explicitly labels published previews instead of presenting them as live inventory. Trade loads indexed history on direct entry and shows chart and order form together, with honest loading, empty, failed, and stale states.

Validation includes the web and configuration suites, lint, TypeScript, a production build, and the production browser matrix. Browser transaction flows use test-only wallet/RPC fixtures through the real application providers; no external signature, live trade, Launch, transfer, or claim was performed. Screenshots were inspected for populated mobile/desktop Hangar and desktop Home/Trade. A real populated-wallet walkthrough remains a follow-up, not a claim established by these fixtures.

Final checks on 8 September 2026: 906 web tests and 137 configuration tests passed; lint, formatting, production TypeScript/build, and browser-harness self-tests passed. The final full browser run passed 120/121 cases; `/start` at desktop timed out closing the Privy wallet modal. A focused rerun of that case and the earlier invalid-detail modal timeout passed all five cases. The intermittent modal timeout is unresolved and should be watched in subsequent release runs. The four focused Hangar, direct Trade history/transaction-stage, and mobile 200%-text checks passed. No deterministic layout, selection, or transaction-flow failure remained in the final run.

The Astra Team workflow used Sol workers for shell, Fleet, and Trade, with an Astra High read-only review and main-agent integration. Review findings fixed direct-entry chart loading and selected-craft/filter restoration; browser checks drove mobile artwork placement and enlarged-text overflow fixes.
