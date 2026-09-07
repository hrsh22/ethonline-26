# User-facing application audit — 6 September 2026

The largest remaining problems are continuity and accuracy: pending work can lose its visible tracking, unavailable data can become a definitive zero, and some recovery still depends on another user action. Public release also needs a stronger collection experience: show what people can collect, guide their next action, and make delivery, Launch, and rewards understandable without reading protocol documentation.

This audits the current working tree, including today's operator persistence, RPC reduction, automatic Fleet recovery, and post-Launch ownership fixes. Those fixes are not counted again as outstanding work. No application source changes, wallet signatures, or onchain submissions were made for this audit.

Published as [24 implementation specs](https://github.com/hrsh22/ethonline-26/issues/57), each labeled `ready-for-agent`, with a linked implementation index and dependencies.

## Scope and evidence

- Inspected every collector route: `/`, `/start`, `/exchange`, `/fleet`, `/fleet/1639`, `/relics`, `/rewards`, `/market`, `/status`, `/learn`, and `/faucet`; also checked the global 404, mobile navigation, and wallet connection dialogs.
- Exercised the running app at desktop and phone widths, including 1440 × 900 and 390 × 844. No page-level horizontal overflow was observed in the routes measured. This is desktop Chromium with resized viewports, not physical-device or mobile-wallet verification.
- Traced wallet reads, quotes, transaction preparation/submission/reconciliation, funding request persistence, ownership completeness, and reward presentation in source.
- Ran seven targeted characterization checks. They reproduced the defects described below; passing these checks means the defects were demonstrated, not fixed. Temporary test files were removed afterward.
- The latest validation from the preceding fixes passed `pnpm check` and the production browser matrix's 101 cases. That baseline was inspected, not rerun as part of this read-only audit. Its coverage limits are described in item 12.
- Rechecked the public page for Orbiter #1639: it displayed the permanent state and owner `0xD490…C269`. Connected failure states in this audit were tested with controlled component/provider inputs, not another live trade or Launch.
- Reviewed the previous product audit and live-wallet verification. GitHub returned no open issues at audit time. No issues were created.
- Extended the audit with a public-site comparison of QUOTRONS on 6 September 2026: Home, My Desk, Exchange, Rewards, Relics, OTC, About, Docs, and the V1 migration record. Inspected rendered public content in Chrome and observed reads settle before interpreting availability. The site's legal acknowledgement remained unaccepted; no connected-wallet, transaction, or gated interaction was exercised. This establishes public presentation patterns, not the reliability of their transaction processing. Its mobile wallet experience was not tested.
- Items 1–12 are the original reliability/usability findings. Items 13–24 add product and UX work; they are recommendations grounded in the current UI and source, not twelve further reproduced bugs.

**Priority:** Address P1 before broader public testing. P2 belongs in the following reliability and usability pass. No new P0 was established by this audit; this is not a contract-security certification or a mainnet readiness assessment.

## 1. P1 — Preserve submitted transactions across reloads and show progress across routes

**Spec:** [#33](https://github.com/hrsh22/ethonline-26/issues/33)

**Verified:** The provider stores transaction state, the execution lock, and submission phase only in React state/refs. A controlled Launch submission returned a hash, then its receipt read failed. Unmounting and remounting the provider changed `outcome-unknown` to `idle`; action eligibility became enabled again. Only one mocked submission was made in the reproduction.

Within a mounted session, an unknown outcome retains its lock correctly. However, reconciliation starts through `retry()`, and transaction status is rendered inside Trade, craft detail, and Rewards rather than the persistent collector shell. Visiting Fleet can hide the progress needed to understand a pending action.

**Fix:** Persist the submitted hash, action label, submission phase, and wallet/chain/deployment scope. Restore matching pending work on startup and reconcile receipts automatically with bounded read retries. Put one compact activity/status surface in the collector shell. Preserve the existing rule that a known hash is reconciled, never blindly resubmitted. Receipt replacement/reversion must settle the same record; wallet switching must not expose another wallet's activity.

**Acceptance:** Submit → receipt timeout → navigate → reload → eventual confirmation retains the original hash and produces one wallet submission. Progress stays reachable on Fleet. Closing the tab after an approval does not automatically authorize the following swap.

**Source:** `apps/web/src/providers/protocol-client-provider.tsx:1313`, `:1952`; `apps/web/src/components/transaction-status.tsx`; `apps/web/src/components/shell/collector-shell.tsx`.

## 2. P1 — Let the funding service finish accepted grants without another signature

**Spec:** [#34](https://github.com/hrsh22/ethonline-26/issues/34)

**Verified:** A pending faucet response maps to `retry-funding`. The status query does not poll. Retrying funding requests a new challenge and signature. The server's status handler observes the active request but does not drive its receipts/transfers; resumption happens on the funding request path. An active request can also hold up another recipient.

This already has durable request/transfer storage and duplicate-send protections. The missing piece is autonomous progress after acceptance, not a reason to add Redis or another queue service.

**Fix:** Drive accepted work from the existing SQLite records with the existing lease/nonce protections, receipt reconciliation, bounded backoff, and restart recovery. Return a request ID promptly. Have the UI follow that request while it is pending and show which transfer is confirming. A user proof authorizes the grant once; service recovery should not require repeated proofs. Bound HTTP read waits so an unavailable endpoint cannot leave “Requesting the top-up” indefinitely.

**Acceptance:** Accept a grant, close the page, delay a receipt, restart the backend, and reopen. The same request completes, the ETH/WETH legs are each sent at most once, and no additional proof is required. A stalled request has an explicit service state rather than an endless Busy loop.

**Source:** `apps/web/src/hooks/use-testnet-funding.ts:29`, `:74`; `apps/web/src/lib/testnet-funding-view.ts:115`; `scripts/testnet-funding/http-server.ts:887`, `:982`; `apps/web/src/lib/testnet-funding-client.ts`.

## 3. P1 — Apply ownership completeness consistently to onboarding and Relics

**Spec:** [#35](https://github.com/hrsh22/ethonline-26/issues/35)

**Verified:** Supplying a loaded wallet with empty identity arrays and `permanentHoldingsStatus: "unavailable"` produces:

- Onboarding: `progressState: "ready"`, current phase Fund, and an Open Faucet action.
- Relics: four definitive `not-held` cards, followed by an empty-state acquisition action.

Fleet now recognizes that this input can mean the index is catching up. These sibling screens still treat absence from a partial list as proof of non-ownership.

**Fix:** Use the existing completeness field in both views. Show known holdings, but leave missing ownership/progress unknown while updating. Do not reset the journey or suggest another purchase because an index/read is incomplete.

**Acceptance:** The same delayed post-Launch snapshot shows “Updating your collection” consistently across Fleet, Get Started, Relics, and Rewards. A genuinely complete empty wallet still gets the normal onboarding path.

**Source:** `apps/web/src/lib/collector-journey.ts:110`, `:177`; `apps/web/src/components/fleet/relics-panel.tsx:63`, `:188`.

## 4. P1 — Never turn a failed reward read into “No claimable rewards”

**Spec:** [#36](https://github.com/hrsh22/ethonline-26/issues/36)

**Verified:** A wallet with complete ownership and an Orbiter whose `pendingRewardsStatus` is `unavailable` renders the empty “No claimable rewards” state. The reader deliberately records unavailable reward evidence; Rewards filters only the reward values and ownership completeness. This discards that distinction. Failed eligibility reads also need to remain distinct from a confirmed denial.

**Fix:** Respect reward and eligibility evidence separately from ownership. Display known amounts per track and mark unread amounts unavailable. Do not include an unread identity in an apparently complete claim total. Existing background wallet recovery can update the view.

**Acceptance:** Failing `pendingAll` for one identity shows partial/unavailable rewards for that identity, never an observed zero. Healthy identities retain their correctly labeled amounts. A confirmed zero remains an ordinary empty state.

**Source:** `packages/protocol/src/reader.ts:1091`; `apps/web/src/components/rewards/rewards-panel.tsx:50`, `:443`.

## 5. P2 — Keep the last verified Fleet visible during a failed refresh

**Spec:** [#37](https://github.com/hrsh22/ethonline-26/issues/37)

**Verified:** `deriveWalletRead` returns `failed` before considering an existing snapshot. The reproduction supplied a known Orbiter and a background RPC error; the resulting view contained no snapshot. Consumers consequently remove previously visible cards while recovery runs.

**Fix:** Preserve the wallet-scoped last successful snapshot for display, with its time/block and an “Updating” or “Connection interrupted” notice. Keep mutation eligibility dependent on sufficiently fresh evidence. Reuse the public views' existing distinction between last-known display and current authorization.

**Acceptance:** After a successful Fleet read, interrupt RPC access. The same cards remain visible with stale status, unsafe actions are unavailable, and recovery updates them without another user transaction. Switching wallets clears the previous wallet's display.

**Source:** `apps/web/src/providers/protocol-client-provider.tsx:391`.

## 6. P2 — Make the header's health label honest about age and delivery status

**Spec:** [#38](https://github.com/hrsh22/ethonline-26/issues/38)

**Verified:** `LivePulse` renders `healthy` even when supplied a public snapshot explicitly marked `stale`. It reads only health and block. Unlike the Status page's detailed board, it neither displays freshness nor ages the observation. Health queries are not continuously refreshed.

The Status page correctly explains that its onchain snapshot does not prove an offchain worker is running. That distinction is missing from the global signal a collector sees while waiting for delivery.

**Fix:** Reuse the existing freshness calculation and label old observations “Last checked …” or stale. Add a small public delivery-service status derived from the operator's existing heartbeat/backlog evidence, with its own observation time. Keep contract checks and delivery readiness distinct. This does not require restoring expensive full-health polling.

**Acceptance:** A cached healthy snapshot ages visibly without generating RPC requests. If delivery processing stops, a pending collector sees a delivery-service delay even while the onchain checks remain healthy.

**Source:** `apps/web/src/components/shell/live-pulse.tsx:47`; `apps/web/src/components/status/status-panel.tsx:60`; `apps/web/src/providers/protocol-client-provider.tsx:1421`.

## 7. P2 — Cancel obsolete quote/detail reads and give them the shared recovery budget

**Spec:** [#39](https://github.com/hrsh22/ethonline-26/issues/39)

**Source-confirmed gap:** The quote and known-collectible query functions do not consume the query cancellation signal. They call the long-lived reader directly. The provider's wallet/public queries already use a scoped reader and an overall read lifetime. Changing an amount after its debounce or leaving a craft can therefore leave obsolete reads running; an initially failed detail read has no interval recovery.

The earlier RPC pass reduced the same health + wallet + craft read sequence from 43 HTTP RPC requests to 16, excluding native-balance reads. This audit does not establish that a provider rate limit caused the reported MetaMask submission failure. Request count alone does not prove a 429.

**Fix:** Reuse the scoped-reader/deadline path for quotes and detail reads, cancel superseded work, and use bounded recovery for visible failed reads. Measure concurrent requests during rapid edits/navigation. Add a small endpoint concurrency limit only if that measurement still shows bursts after cancellation; prioritize receipt/preflight reads over background work. Do not add unconditional polling to every screen.

**Acceptance:** Rapid edits and route changes stop obsolete work. Each logical read has a bounded request budget and deadline; 429 cooldown is shared; no retry path repeats wallet submission. Settled idle screens remain quiet.

**Source:** `apps/web/src/components/trade/exchange-panel.tsx:274`; `apps/web/src/hooks/use-collectible-read.ts:30`; `apps/web/src/lib/web-rpc-policy.ts`; `apps/web/src/providers/protocol-client-provider.tsx:1533`.

## 8. P2 — Replace stale faucet mutation responses with newer request status

**Spec:** [#40](https://github.com/hrsh22/ethonline-26/issues/40)

**Source-confirmed:** `mutationResponse ?? fundingStatus.response` gives an old mutation response permanent precedence until another mutation or wallet change resets it. Refreshing status can succeed while the rendered state still comes from the old response. Inventory-empty, cooldown, and funded-not-retained responses all have status-refresh paths affected by this ordering.

**Fix:** Store the accepted response in the existing query cache, then let newer status for that wallet/request supersede it. Keep request identity and observed time explicit. Reset stale mutation errors when status proves the request's outcome.

**Acceptance:** Return inventory-empty from funding, replenish inventory, and refresh status. The view becomes eligible without another funding POST. A later confirmed response replaces pending state for the same request.

**Source:** `apps/web/src/hooks/use-testnet-funding.ts:115`; `apps/web/src/lib/testnet-funding-view.ts:135`.

## 9. P2 — Show claim amounts by token, never as a sum of different stocks

**Spec:** [#41](https://github.com/hrsh22/ethonline-26/issues/41)

**Verified:** A Station with 1 AAPLc, 1 GOOGLc, 1 METAc, and 1 NVDAc, included in a multi-identity claim, renders `#4441 4` in the review. The dialog contains none of the four token labels. `claimTotalsFor` adds raw units across reward tracks and the review passes the sum to an unlabeled Amount.

**Fix:** List each identity's positive amounts with their token names, or show per-token batch totals with expandable identity detail. Retain the existing 64-identity limit and say when a claim covers only the next batch. One-identity claims should also have understandable amounts at the decision point.

**Acceptance:** The example displays four labeled amounts. A claim spanning ordinary Orbiters from different tracks never presents their sum as a single asset or value.

**Source:** `apps/web/src/components/rewards/rewards-panel.tsx:125`, `:196`, `:267`; `packages/protocol/src/transactions.ts:15`.

## 10. P2 — Identify exactly what leaves the wallet in Launch and transfer reviews

**Spec:** [#42](https://github.com/hrsh22/ethonline-26/issues/42)

**Improvement, source-confirmed:** Launch has a useful irreversible-burn checkbox, but its dialog does not name the selected identity number. Transfer validates the destination, including zero/self-address rejection, then goes directly to execution without a final application review. The user must infer the selected identity and the Grounded Craft backing effect from the surrounding page/disclosure.

**Fix:** Add the identity number to the existing Launch dialog. Use the existing review component pattern for transfers, naming the identity, full recipient, network, and any accompanying FUEL movement. This can be a small review step; it needs no new transaction framework.

**Acceptance:** The final review remains understandable with the underlying page obscured. A user can verify the identity, destination, and exact asset consequence before opening the wallet prompt.

**Source:** `apps/web/src/components/fleet/craft-detail-panel.tsx:386`, `:559`.

## 11. P2 — Remove operator instructions and contradictory guidance from collector copy

**Spec:** [#43](https://github.com/hrsh22/ethonline-26/issues/43)

**Observed/source-confirmed examples:**

- Market failure tells the collector to “Start or repair the history worker.” That recovery belongs to the operator.
- Disconnected Get Started shows a warning-style “Live wallet progress unavailable” before its normal Connect action. A new visitor has not experienced a read failure.
- Faucet says ETH is “Gas only” and “not a trading asset in this application,” while Trade explicitly supports buying with native ETH.
- Learn claims every wallet prompt names the exact FUEL amount it moves. Funding proofs and WETH approvals do not satisfy that promise; wallet decoding also varies.
- Expected receipt-reconciliation RPC failures still call `console.error`, which can recreate the development error overlay that the initial submission path now avoids.

**Fix:** Use collector actions and plain outcomes: “Market history is temporarily unavailable; we'll check again,” ordinary Connect guidance, and accurate ETH/WETH explanations. Distinguish normal quote expiry (“Update quote”) from actual failures. Offer a compact support detail containing request/hash, chain, last update, and error reference for service failures. Keep raw worker diagnostics in admin views.

**Acceptance:** Every recovery instruction can be performed by the collector or explicitly says the service is handling it. Disconnected is not styled as failure. Expected network failures stay within the app's status presentation.

**Source:** `packages/config/src/identity.ts:406`, `:1041`; `apps/web/src/components/start/onboarding-panel.tsx`; `apps/web/src/app/(collector)/learn/page.tsx:202`; `apps/web/src/providers/protocol-client-provider.tsx:777`.

## 12. P2 — Test complete asynchronous journeys in the browser

**Spec:** [#44](https://github.com/hrsh22/ethonline-26/issues/44)

**Verified coverage gap:** The current 101-case matrix covers routes, accessibility/layout, connection/funding states, and bounded read recovery. Its wallet explicitly refuses signing and sending, and its general RPC fixtures do not establish healthy collector ownership. It therefore cannot catch several of the transitions reported today. Provider/component tests cover many transaction rules but do not replace an integrated journey.

**Fix:** Extend the existing harness with a deterministic transaction-capable test wallet and controlled receipts/index lag. Keep it isolated from real wallets and networks. Add a small set of journeys instead of multiplying every state across every route:

1. Fund → buy → delayed randomness → delivery, including backend restart.
2. Grounded Craft → Launch → delayed history → Orbiter, including navigation and reload.
3. Submitted hash → RPC failure → automatic receipt recovery, with exactly one submission.
4. Ownership available + rewards unavailable → recovered per-token claim review.
5. Rapid amount edits + route changes + 429, with cancellation and request-budget assertions.

Keep the existing viewport, keyboard, and accessibility checks. Add a real mobile wallet smoke check before calling mobile support verified.

**Source:** `apps/web/browser/fixtures.ts:65`; `apps/web/browser/matrix.ts`; `docs/operations/browser-matrix.md`.

## What to learn from QUOTRONS

QUOTRONS makes the object, its transformation, and the surrounding collection visible before asking visitors to participate. Its public pages connect artwork, history, acquisition, reward explanations, and verification. These are useful patterns for ORBIT's orbital theme and existing mechanics.

| Observed public pattern                                                                                                                                                                                                                                 | Application to ORBIT                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The [home page](https://www.quotrons.cash/) includes a machine brochure, sample gallery, collection census, and contract links.                                                                                                                         | Put a small, browsable selection of craft and a clear collection explanation ahead of the detailed protocol metrics. |
| [Relics](https://www.quotrons.cash/relics) have individual artwork, names, historical stories, scarcity, and a control to preview their committed state.                                                                                                | Give each Station and the Observatory an original story and useful state preview alongside its actual allocation.    |
| The [Exchange](https://www.quotrons.cash/exchange) places spend/receive terms together and offers public token-ID inspection.                                                                                                                           | Keep ORBIT's existing trade review; add easier amount selection and an obvious public identity lookup.               |
| [Rewards](https://www.quotrons.cash/rewards) pairs company names with tickers and explains how conversion and eligible ownership relate.                                                                                                                | Explain ORBIT's four tracks using recognizable names, and lead the connected view with what this wallet can claim.   |
| The [OTC desk](https://www.quotrons.cash/otc) makes the object, state, attached rewards, filters, and pagination visible together.                                                                                                                      | Improve Fleet's collection cards and browsing. An additional marketplace is unnecessary for this usability work.     |
| [About](https://www.quotrons.cash/about) names an operator and contact. [Docs](https://www.quotrons.cash/docs) offers verification resources; the [V1 record](https://www.quotrons.cash/v1) distinguishes historical distribution from current actions. | Make ORBIT's actual support, deployment, incident information, and current operating limits easy to find.            |

The comparison also exposes friction to avoid: an obstructive first-visit legal wall, crowded top-level navigation, dense capitalized text, and unusually high slippage choices. Their brand, artwork, ten-track economics, and mainnet valuations are not ORBIT requirements. Base Sepolia screens must continue to describe valueless test assets accurately.

Several useful pieces already exist in ORBIT: Start Collecting is the home page's primary action; the before/after specimen is implemented; craft drawings vary deterministically; Relics have distinct drawings; Fleet has state filters; Trade has Max, a gas reserve, quotes, and a review; public identity pages work without connecting; Learn contains a glossary, contract links, and limitations. Build on these rather than listing them as missing or replacing the application shell wholesale.

## 13. P1 — Let visitors explore a collection before connecting

**Spec:** [#49](https://github.com/hrsh22/ethonline-26/issues/49)

**Current gap:** The homepage's specimen explains the transformation, but visitors have little collection variety to explore before encountering protocol totals. The existing public identity route is useful but not exposed through an obvious lookup or gallery.

**Improvement:** Add six to twelve selected examples using existing craft art and public detail links. Show identity number, Grounded/Orbiter state when verified, and a short explanation of the four reward tracks. Put “Explore the collection” beside the existing Start Collecting action. Add an ID field that opens the existing canonical identity route with its existing validation. Label illustrative previews explicitly if their current ownership/state has not been read.

**Acceptance:** A disconnected visitor can inspect a craft and explain discovery versus Launch without opening Learn. The gallery does not issue a full wallet/health read per card; static previews and public detail reads suffice.

**Source:** `apps/web/src/components/home/home-boards.tsx`; `apps/web/src/app/(collector)/fleet/[identityId]/page.tsx`.

## 14. P1 — Keep one clear next action through first use and return visits

**Spec:** [#45](https://github.com/hrsh22/ethonline-26/issues/45)

**Current gap:** Get Started tracks Fund, Discover, and Launch, but completing the journey still involves moving between Faucet, Trade, Fleet, and detail screens. A returning collector needs different guidance from an empty wallet; partial reads can also reset the journey incorrectly, as item 3 demonstrates.

**Improvement:** Reuse the existing journey model to show a compact next-action card in Get Started and Fleet: fund the test wallet, buy enough FUEL for the next discovery, follow an accepted discovery, inspect the delivered craft, or review Launch. Preserve the destination when connecting or switching networks. Explain funding in the current step and offer a direct return from Faucet/Trade. Keep advanced navigation available; do not force a tour. Once onboarding is complete, prioritize Fleet and claimable rewards over repeating introductory tasks.

**Acceptance:** A first-time tester can complete the path without guessing which menu item comes next. A returning wallet opens its collection, while incomplete evidence shows updating instead of a reset. Every step distinguishes an optional choice from a prerequisite.

**Source:** `apps/web/src/lib/collector-journey.ts`; `apps/web/src/components/start/onboarding-panel.tsx`; `apps/web/src/components/fleet/fleet-panel.tsx`.

## 15. P1 — Show discovery and delivery as visible work with a clear owner

**Spec:** [#46](https://github.com/hrsh22/ethonline-26/issues/46)

**Current gap:** A pending discovery is mainly a count and a notice. A collector cannot easily tell what has completed, whether anything is required, or why delivery has taken longer than expected. This is the product presentation of the persistence and service work in items 1, 2, and 6, not a separate queue implementation.

**Improvement:** Use the persistent activity surface for evidence-backed stages: purchase confirmed → discovery recorded → randomness received → collectible delivered. Show elapsed time and the last successful check, with a transaction/request link when available. In Fleet, show a pending discovery card without inventing its future identity. Say when the service is processing and no wallet action is required. When a known delivery delay exists, show that condition and a useful support reference. Explain cancellation when FUEL backing is removed.

**Acceptance:** At one minute and one hour, the user can tell what is known, what is waiting, and who must act. A pending wallet is never presented as an ordinary empty collection with another purchase as the sole action. No fabricated percentage, guaranteed ETA, or retry button on a normal waiting state.

**Source:** `apps/web/src/components/transaction-status.tsx`; `apps/web/src/components/shell/collector-shell.tsx`; `apps/web/src/components/fleet/fleet-panel.tsx`.

## 16. P2 — Give delivery and Launch an unmistakable completion state

**Spec:** [#47](https://github.com/hrsh22/ethonline-26/issues/47)

**Current gap:** The art already has Grounded and Orbiter appearances, but the confirmed transformation lacks a distinct, lasting explanation of what the user now owns. The reported temporary disappearance makes this transition particularly important.

**Improvement:** After verified delivery, replace the pending card with the received craft. After confirmed Launch, retain that identity in place, explain that 1 FUEL was burned, and show its permanent state and reward track. A brief 300–600 ms transition can connect the two appearances; reduced-motion users get an immediate update. Provide View Orbiter and a persistent activity entry if the user has left the page. Keep receipt confirmation distinct from collection synchronization until the latter is verified.

**Acceptance:** A confirmation remains understandable after navigation or reload. Animation runs once for a newly observed completion, never on each poll, and does not block interaction. No premature ownership claim or screen-covering celebration.

**Source:** `apps/web/src/components/ui/craft-art.tsx`; `apps/web/src/components/fleet/craft-detail-panel.tsx`; `apps/web/src/components/transaction-status.tsx`.

## 17. P1 — Finish the collectible's visual identity and Relic stories

**Spec:** [#48](https://github.com/hrsh22/ethonline-26/issues/48)

**Current gap:** The current deterministic SVG generator provides varied hulls and a useful state change, but its own source describes the collection artwork as a placeholder. Learn also records presentation/metadata limitations. Relics have distinct geometry and names, but little narrative beyond their mechanical allocation.

**Improvement:** Develop the existing craft families into recognizable finished objects with stronger silhouettes, readable detail at card size, and a consistent Grounded/Orbiter relationship. Give the three Stations and Observatory short original orbital stories and before/after previews. Separate illustrative visual traits from actual protocol properties; do not imply an invented trait changes reward weight. Check web art against token metadata and wallet/explorer rendering before presenting it as the collectible's official appearance. Respect the sealed deployment's metadata boundary; any canonical metadata change needs its actual supported deployment path.

**Acceptance:** People can distinguish several craft and all four Relics at thumbnail size. The same identity is recognizable in Fleet, detail, and its verified metadata rendering. Any remaining web-only preview difference is disclosed. Copy explains both the object's character and its real function.

**Source:** `apps/web/src/components/ui/craft-art.tsx`; `apps/web/src/components/fleet/relics-panel.tsx`; `apps/web/src/app/(collector)/learn/page.tsx`; `CONTEXT.md`.

## 18. P2 — Make Fleet easy to scan as the collection grows

**Spec:** [#50](https://github.com/hrsh22/ethonline-26/issues/50)

**Current gap:** All/Grounded/Orbiter filters exist, but each card devotes considerable space to tabular facts. There is no identity search or reward-track filter, and the experience does not distinguish a small collection from dozens of items.

**Improvement:** Lead cards with larger art, identity, state, reward track, and one useful action. Move secondary facts into detail or an accessible disclosure. Add local ID search and a track filter using the already-loaded collection. Add claimable filtering only when reward evidence is complete enough to make that claim. Preserve filters and position when returning from detail; show “No matches” separately from an empty wallet. Paginate or progressively reveal cards once collection size warrants it.

**Acceptance:** In a seeded 50-item wallet, a tester can find a known ID and inspect an Orbiter from a chosen track without waiting for new RPC reads. Unknown ownership/rewards remain marked unknown. Back returns to the same collection position.

**Source:** `apps/web/src/components/fleet/fleet-panel.tsx`; `apps/web/src/components/fleet/craft-detail-panel.tsx`.

## 19. P1 — Put the wallet's rewards ahead of allocation reference tables

**Spec:** [#51](https://github.com/hrsh22/ethonline-26/issues/51)

**Current gap:** Rewards leads with four repeated allocation panels before the connected claim experience. Track symbols, weights, conversion, and claimable amounts require too much interpretation for someone who has just launched a craft.

**Improvement:** For connected wallets, lead with labeled per-token claimable amounts and the eligible identities. Pair symbols with recognizable company names while identifying the actual test tokens. Add a short “Why is this zero?” explanation based on verified state: no Orbiter yet, no accrued rewards, or a known processing stage. Treat unavailable evidence as unavailable, as item 4 requires. Keep fee/allocation reference material below or collapsed. A compact fees → conversion → rewards attached → claim diagram can explain the process without suggesting every pending conversion belongs to this wallet.

**Acceptance:** A new Orbiter owner can tell whether there is anything to claim and why. Four different tokens never become one unlabeled balance or implied dollar value. Claim review remains accurate for mixed tracks and batch limits.

**Source:** `apps/web/src/components/rewards/rewards-panel.tsx`; `CONTEXT.md`.

## 20. P1 — Reduce wallet and trade friction while preserving informed decisions

**Spec:** [#52](https://github.com/hrsh22/ethonline-26/issues/52)

**Current gap:** Connect opens an application preamble and then a second wallet chooser. Trade already has Max and a careful review, but choosing a useful amount and distinguishing approval from purchase still require explanation across several surfaces.

**Improvement:** Open the existing wallet chooser directly and keep connection explanations available inline. Show network-switch progress and the required gas balance. Add 25% and 50% beside Max using the existing spendable-balance calculation. Offer an amount estimate for the next discovery only if the quote/minimum-received rules can support it; do not promise a discovery from a rounded estimate. Present approval and swap as distinct steps, with the same reviewed spend, minimum received, fee, and network carried into execution. Explain native ETH versus WETH only where the user's choice matters.

**Acceptance:** Connecting reaches provider selection without redundant confirmation. A tester can explain whether the next wallet prompt grants an allowance, buys FUEL, or launches a specific craft. Approval completion never causes a later trade to execute without its required authorization; slippage or changed terms trigger the existing review rules.

**Source:** `apps/web/src/components/wallet-connection-action.tsx`; `apps/web/src/components/trade/exchange-instrument.tsx`; `apps/web/src/components/trade/exchange-panel.tsx`; `apps/web/src/components/trade/exchange-review-checklist.tsx`.

## 21. P2 — Make the frequent mobile destinations reachable without a drawer

**Spec:** [#53](https://github.com/hrsh22/ethonline-26/issues/53)

**Current gap:** The responsive shell fits the checked phone viewport, but the collector routes live behind a menu. Moving between Trade, Fleet, and Rewards requires repeated drawer interaction during the core journey.

**Improvement:** Use a compact mobile navigation bar for Fleet, Trade, Rewards, and More; keep Get Started prominent for a new wallet through its next-action card. Reuse existing links and active-route handling. Keep pending activity reachable without adding another large banner. Reserve space for the bar and device safe areas, and handle the on-screen keyboard so it cannot cover amount inputs or confirmation controls.

**Acceptance:** Core destinations are one tap away, browser Back works, menu focus returns correctly, and content remains reachable at narrow widths and enlarged text. Verify with a real mobile wallet before claiming support; resized desktop checks alone do not establish it.

**Source:** `apps/web/src/components/shell/collector-shell.tsx`; `docs/operations/browser-matrix.md`.

## 22. P1 — Make help, service status, and verification easy to find at the problem

**Spec:** [#54](https://github.com/hrsh22/ethonline-26/issues/54)

**Current gap:** Learn contains substantial safety and deployment information, but a waiting or confused collector has to leave the task and search through it. It also openly records the absence of some production support arrangements; links alone cannot supply those arrangements.

**Improvement:** Add a consistent Help entry using the existing Learn content and contextual links: pending discovery, failed wallet prompt, missing collectible in a wallet, no rewards, and transaction submitted with an unknown outcome. Show the active network and verified contract/explorer links near consequential actions. For delayed work, provide a copyable support summary with public request/hash, stage, and timestamps. Link the actual maintained support channel and incident/status information; establish ownership before promising response times or uptime. Keep technical worker controls in the operator app.

**Acceptance:** A user can find an explanation and report reference from the affected screen in two actions. Support details exclude secrets and unrelated wallet history. Claims about who operates the service, what is supported, and current availability match reality.

**Source:** `apps/web/src/app/(collector)/learn/page.tsx`; `apps/web/src/components/status/status-panel.tsx`; `apps/web/src/components/shell/collector-shell.tsx`; `apps/web/src/components/transaction-status.tsx`.

## 23. P2 — Make a collectible useful outside the open application tab

**Spec:** [#55](https://github.com/hrsh22/ethonline-26/issues/55)

**Current gap:** Public craft pages already have identity-specific titles, but their description is generic owner-action copy and they inherit generic social imagery. There is no clear collector sharing flow or explanation of why wallet NFT displays may lag the app.

**Improvement:** Add Copy Link and native sharing where supported, with a normal copy fallback. Give public detail pages identity-specific descriptions and a static share image derived from verified identity/art metadata. Avoid embedding a live claimable balance or unverified owner/state in a long-lived image. Provide concise wallet-display guidance with the exact network, collection address, ID, and explorer link when known; distinguish wallet indexing delay from verified ownership. Use the existing public route rather than introducing profile accounts.

**Acceptance:** A shared link opens the same craft without connecting and displays useful identity artwork in a link preview. Repeated share-preview requests use cached/static metadata rather than full health or wallet reads. Copying works without requiring native-share support.

**Source:** `apps/web/src/app/(collector)/fleet/[identityId]/page.tsx`; `apps/web/src/app/layout.tsx`; `apps/web/src/components/fleet/craft-detail-panel.tsx`.

## 24. P2 — Improve reading comfort and verify the completed journey with new users

**Spec:** [#56](https://github.com/hrsh22/ethonline-26/issues/56)

**Current gap:** Body text defaults to 14 px and secondary text to 13 px, with monospace throughout. The style suits instrument labels, but long explanations, dense tables, and error notices are harder to read on a phone. Existing layout/accessibility checks establish a useful baseline, not comprehension.

**Improvement:** Use approximately 16 px for mobile explanations and error copy, comfortable line height, shorter sentences, and sentence case for prose. Retain monospace where aligned numbers and compact labels benefit. Keep touch targets, keyboard focus, contrast, reduced motion, and screen-reader status announcements intact. Announce meaningful state changes once, not every poll. Test the core journey with five unfamiliar users and record where they hesitate, misunderstand a wallet prompt, or think a pending asset is missing.

**Acceptance:** Users can explain what they are buying, what Launch consumes, what is pending, and what can be claimed. Check enlarged text and keyboard/screen-reader navigation. Measure initial page rendering and request counts on a constrained connection as art is added; reserve image space, defer below-fold images, and prevent one read per preview card. Address observed failures before adding more decorative motion.

**Source:** `apps/web/src/app/styles/foundations.css`; `apps/web/browser/matrix.ts`; `apps/web/src/components/transaction-status.tsx`.

## Execution order

1. **Keep balances, assets, and submitted work trustworthy:** fix partial/unknown display rules (3, 4, 5), persist transactions (1), finish autonomous funding (2, 8), and complete read cancellation (7). Add the matching integrated journeys from item 12 as each fix lands.
2. **Finish the first collector journey:** implement the shared activity/delivery presentation (6, 15), contextual next action (14), understandable reviews and recovery copy (9, 10, 11, 20), and connected reward hierarchy (19). These changes should share the existing transaction/query state.
3. **Prepare the public collection:** finish the artwork/metadata presentation decision (17), add the public gallery and lookup (13), and make actual help/verification reachable (22). Test these together before inviting unfamiliar collectors.
4. **Polish repeat use and mobile:** add completion feedback (16), collection browsing improvements (18), mobile navigation (21), sharing (23), and reading/interaction refinements (24). Include real mobile-wallet checks and the five-person comprehension test; use the results to reorder this pass.

Use the existing SQLite stores for server work, the current query cache for read state, and the current transaction reader for receipts. A second queue product or application state framework is not justified by these findings. The public UX work also does not require an OTC exchange, user accounts, a new token economy, a notification service, or a full visual framework replacement.

## Documentation follow-up

ADR 0013 still says the current Base Sepolia deployment must be replaced for its old claim gate. The checked deployment manifest now records `claimPolicy.mode: "always-allow"` and a zero administrator. Update the ADR's historical wording after confirming the relevant deployment boundary; do not treat the stale sentence as evidence that another redeployment is required.
