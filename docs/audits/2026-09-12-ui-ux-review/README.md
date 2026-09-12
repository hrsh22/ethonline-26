# Orbit product UI / UX audit

Reviewed 12 September 2026 on [orbit.gamified.trade](https://orbit.gamified.trade/), with [Quotrons](https://quotrons.cash/) as a visual and flow reference.

The intended product serves both new collectors and experienced users: a simple default, with advanced details available when needed. The standard here is a polished public product. Base Sepolia and the absence of monetary value must remain clear, but should not become the subject of every screen.

**The largest problem is the ordering of information.** Orbit repeatedly presents implementation evidence, support material and protocol mechanics before the action or result a collector came for. Changing fonts and colors alone will leave that problem intact. The landing page is an exception: it is restrained, but does too little to explain the collecting experience. The inner pages need less explanation at once; the home page needs a better introduction to the actual product.

This is a review and proposed backlog, not an implementation. Screenshots capture a changing testnet deployment; balances, phases and service health are observations at review time.

## Evidence and coverage

Browser inspection covered Home, Explore, public identity detail, My Fleet, owned Grounded Craft and Orbiter detail, Trade, Auction, Rewards, Faucet, Relics, Learn, Status, Market data, wallet connection, transaction activity and recovery. Desktop reviews used approximately 1280–1440px widths. Mobile reviews used 390×844; Explore also received 320px and 768px width checks. These were browser viewport tests, not physical-device tests.

Evidence is stored in [browser-evidence.json](browser-evidence.json) and the [screenshots directory](screenshots/). The JSON preserves the initial 25 page captures, visible text and control positions. Later transaction screenshots supplement those captures. Full-page captures can position fixed elements differently from an ordinary viewport, so precise layout findings below use DOM measurements as well as visual inspection.

| Journey                    | What was actually exercised                                                                              | Outcome / limit                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First visit                | Disconnected Home, Explore, Trade, Fleet and Auction; wallet chooser                                     | Public browsing works; Auction withholds useful public phase data behind connection.                                                                                                    |
| Funding                    | Fresh wallet, funding signature, faucet request, pending and funded states                               | Received 0.01 test ETH and 0.01 test WETH. Success includes a useful “Buy $FUEL on Trade” link.                                                                                         |
| Buy                        | Quote, WETH approval, purchase of 0.006 WETH worth of FUEL                                               | Both transactions succeeded. Received 1.149520788814057477 FUEL.                                                                                                                        |
| Discovery                  | Waiting for randomness, randomness received, temporary delivery-status unavailability, eventual delivery | Grounded Craft #2750, NVDAc, Tier I, delivered. Delivery was not permanently blocked.                                                                                                   |
| Sell with collectible loss | Previewed selling 0.2 FUEL before Launch                                                                 | Review correctly calculated dissolution of one Grounded Craft. This destructive preview was not submitted.                                                                              |
| Launch                     | Opened review, cancelled, reopened, acknowledged burn, submitted                                         | Onchain success; exactly 1 FUEL burned, identity #2750 became an Orbiter. Wallet response stalled in the browser; manual hash recovery succeeded.                                       |
| Small fractional sell      | Quoted and submitted 0.05 FUEL after Launch                                                              | Sale succeeded, frontend showed confirmation, Orbiter retained. Final FUEL balance 0.099520788814057477. Approval initially stalled, then cleared after reload and a fresh sell review. |
| Transfer                   | Invalid recipient, valid recipient review, mobile dialog, cancellation                                   | Invalid address blocked; review showed full recipient and attached-reward consequence. Both buttons fit the 390×844 viewport. Cancelled; no transfer sent.                              |
| Rewards                    | Existing and newly created Orbiter, progress and zero-claim states                                       | No positive claimable reward was available; a successful nonzero claim was not tested.                                                                                                  |
| Auction                    | Connected and disconnected completed-auction states                                                      | Auction had finished; active bidding and claim/refund execution were not tested.                                                                                                        |
| Navigation / errors        | Public-card entry and back navigation, leading-zero search, out-of-range identity                        | “0023” rejected; /fleet/4445 returns a proper 404, with room to improve its recovery links.                                                                                             |
| Quotrons                   | Home, Desk, Exchange, Relics, mobile home, animated relic preview                                        | Visual/product-flow inspection only. No Quotrons wallet or transactions. Its disclaimer overlay was hidden locally to inspect underlying screens; no agreement was submitted.           |

The fresh test address was `0xE7b2163E4aD4C20418693bF7d4967025b23c9726`. It used the repository's WalletConnect test peer, restricted to Base Sepolia and the staging deployment. The initially restored wallet had a disconnected signing process; that environmental issue is not evidence that normal wallets cannot connect. Likewise, the later delayed wallet responses need reproduction with supported consumer wallets before assigning their root cause to Orbit or Reown.

This was not a formal accessibility certification, performance benchmark or security audit. No production-value assets or operator configuration were changed.

At completion, the temporary wallet was disconnected, its signing process stopped, its temporary pairing file and instrumented helper removed, and the Chrome viewport override reset. Only the audit artifacts were left in the working tree.

## Fix order

P0 means resolve or investigate as a public-release gate because it affects transaction confidence or a material consequence. P1 means a major usability or presentation fix. P2 means refinement after the main journeys are coherent. Scope estimates are relative: S is contained copy/state work, M spans a component or page, L spans multiple flows or the art system. They are not delivery-time commitments.

| Priority | ID  | Fix                                                                        | Scope |
| -------- | --- | -------------------------------------------------------------------------- | ----- |
| P0       | 01  | Reconcile successful transactions when wallet responses are delayed        | M–L   |
| P0       | 02  | Make cross-tab transaction recovery truthful                               | M     |
| P0       | 03  | Give collectible destruction a prominent, specific sell warning            | M     |
| P1       | 04  | Put the swap form first on mobile; make advanced chart tools optional      | M     |
| P1       | 05  | Replace repeated trade explanation with one compact review                 | M     |
| P1       | 06  | Preserve order terms and show approval / execution as separate steps       | M     |
| P1       | 07  | Turn purchase success into a clear Discovery handoff                       | M     |
| P1       | 08  | Redesign Discovery waiting and completion around the collector             | M     |
| P1       | 09  | Show claimable rewards before protocol processing details                  | M     |
| P1       | 10  | Make Explore a browsable collection, not eight samples                     | L     |
| P1       | 11  | Move identity facts and owner actions ahead of support                     | M     |
| P1       | 12  | Make Auction reflect its actual phase, including while disconnected        | M     |
| P1       | 13  | Replace placeholder presentation with finished, consistent collectible art | L     |
| P1       | 14  | Unify wallet-facing branding                                               | S–M   |
| P1       | 15  | Simplify navigation and the mobile wallet / testnet header                 | M     |
| P1       | 16  | Introduce the collecting loop on Home using actual craft                   | M     |
| P1       | 17  | Give Fleet direct next actions and meaningful personal summaries           | M     |
| P2       | 18  | Make amount errors and available balances useful                           | S–M   |
| P2       | 19  | Explain Discovery thresholds without requiring arithmetic                  | M     |
| P2       | 20  | Make Faucet a short funding step                                           | S–M   |
| P2       | 21  | Give Relics the visual weight of special objects                           | M–L   |
| P2       | 22  | Separate getting started, rules, help and technical reference              | M     |
| P2       | 23  | Establish stronger typography and visual hierarchy                         | M–L   |
| P2       | 24  | Standardize state language, numbers, dates and disclosure rules            | M     |
| P2       | 25  | Improve search normalization and contextual navigation                     | S–M   |
| P2       | 26  | Keep diagnostics useful without letting them dominate normal screens       | M     |
| P2       | 27  | Refine Launch, transfer and ownership feedback                             | M     |

## Findings and acceptance criteria

### 01 — A mined transaction can remain “Confirm in your wallet”

**Observed:** Launch #2750 succeeded in block 46719206 while the app continued to show “Confirm in your wallet,” the pre-Launch FUEL balance and Grounded state. Moving to Fleet did not reconcile it. Reloading updated ownership and balance, but produced “Wallet response interrupted.” Supplying the actual transaction hash through Recovery options resolved the activity correctly. A subsequent FUEL approval also stalled before a reload; after that reload, its interruption had cleared automatically, although the form had reset to Buy with no amount.

**Fix:** Investigate wallet-response delivery separately from receipt and ownership reconciliation. Add a bounded waiting state with an explicit “Check transaction status” action and a route back to the wallet. Recover only when chain evidence matches the saved call. Keep manual hash verification as a fallback. Do not infer transaction success solely because an unrelated balance changed.

**Acceptance:** Test normal completion, delayed response, lost response, reload, replacement, rejection and mined revert with supported wallets. A mined exact matching call resolves; uncertain submission never silently resubmits. Approval success never claims the sale itself succeeded. Preserve the user's direction and amount when recovery returns them to review.

Evidence: [pending Launch](screenshots/launch-wallet-pending.jpg), [recovery alongside the already updated Orbiter](screenshots/launch-recovery-mobile.jpg), [recovered state](screenshots/launch-recovered.jpg), [receipt](launch-receipt.json). Root cause remains unassigned because the signing peer was a test harness.

### 02 — Opening another tab is described as closing the app

**Observed:** With a wallet request still pending in the source tab, opening another Orbit tab showed “The app closed while waiting for your wallet.” The original tab remained open and still showed the wallet prompt. The resulting recovery banner consumes a substantial part of a mobile first screen. Local code restores a saved `simulated` state as `submission-unknown` with that fixed explanation.

**Fix:** Track the active request across tabs and distinguish “Waiting in another tab” from a genuinely lost response. Use truthful uncertainty when the app cannot know what happened. Put a concise status in the shell and detailed recovery inside its expansion.

**Acceptance:** Opening a second tab cannot falsely assert that the first closed; no duplicate signing request is submitted. Reload recovery continues to work and remains scoped to wallet, deployment and original transaction.

Entry points: `apps/web/src/lib/collector-transaction-record.ts`, `apps/web/src/providers/protocol-client-provider.tsx`.

### 03 — A sale that destroys a craft needs a dedicated consequence block

**Observed:** Selling 0.2 FUEL from 1.14952 FUEL correctly reports “This sale dissolves 1 Grounded Craft,” embedded in the same paragraph as the price and fee. It does not identify #2750 in that visible summary. The same Sell screen still says “Each whole $FUEL crossed schedules one Discovery.” That buying-oriented guidance competes directly with the actual sale consequence.

**Fix:** Show affected craft IDs/art and pending Discovery cancellations beside the sell review. Use a clearly differentiated warning only when that consequence applies. Keep a concise, accurate no-loss state for a fractional sale. Remove acquisition guidance from Sell. If the exact affected identities cannot be determined reliably, state the count and selection rule without inventing a specific craft.

**Acceptance:** Threshold-crossing sales show consequences before the signing action; fractional sales remain simple; permanent Orbiters are not described as backing that will dissolve. Actual approval and final sale both retain the reviewed consequence.

Evidence: [sell dissolution review](screenshots/sell-dissolution-review-mobile.jpg).

### 04 — Mobile Trade puts the amount entry almost two screens down

**Observed:** At 390×844 in the clean disconnected state, “You pay” begins around document y=1628px. A large chart and its desktop toolbars precede the order. The default includes candles, indicators, replay, drawing tools, Fibonacci and two sets of time controls.

**Fix:** On mobile: title/price, swap card, optional compact chart, advanced market details. On desktop: compact market context beside the order, with full chart mode available explicitly. Remember a user's advanced preference. Do not require a global beginner/pro mode choice during onboarding.

**Acceptance:** At 390×844 with no error banner, a user can see Buy/Sell, the payment amount and primary action area without passing a full chart. Advanced tools remain reachable and labelled. Existing chart buttons do have accessible names in Chrome; the problem observed is prioritization, not a proven labelling failure.

Evidence: [mobile Trade](screenshots/orbit-trade-mobile-clean.png).

### 05 — Trade repeats the same information in too many forms

Inputs, a prose review, metric rows, approval guidance, a faucet sentence, a Discovery explanation and network disclaimers all compete. The pay/receive values appear repeatedly. Raw quote block numbers receive attention comparable to minimum received and fees.

**Fix:** One amount pair, one short outcome/consequence, then a compact review of minimum received, fee, price impact and required steps. Put raw block references, routing and mechanics in “Trade details.” Keep significant price impact and meaningful collectible loss visible.

**Acceptance:** Each value has one primary presentation. A user can answer “What do I pay, what is protected, what changes in my Fleet, and what do I sign?” from a single review area.

Evidence: [buy review](screenshots/buy-review.jpg). Entry points: `components/trade/exchange-panel.tsx`, `exchange-review-checklist.tsx`, `lib/exchange-state.ts` under `apps/web/src`.

### 06 — Pending trades discard the quote being acted on

The receive field returns to “No quote yet” during submission, while the CTA becomes “Buying” or “Selling.” A global banner identifies the approval, but the form does not clearly present a two-step sequence.

**Fix:** Freeze the submitted review visually. Show “1. Approve WETH” then “2. Confirm purchase,” with the active step and its outcome. A changed or expired quote must produce an explicit renewed review, rather than silently replacing the signed terms.

**Acceptance:** Wallet waiting, approval mined, trade awaiting signature and final settlement are distinguishable. Reload retains enough order context to resume safely.

### 07 — Purchase success should lead directly to the thing purchased

The successful buy cleared the form and showed a small confirmation notification. A Discovery link exists in the shell, but the primary purchase area did not turn into a persistent receipt and collection handoff.

**Fix:** Replace the completed form with a compact receipt: “You received 1.1495 FUEL. Your craft is being discovered.” Provide “View Fleet” and a secondary “Make another trade.” Record the pending result in Fleet automatically.

**Acceptance:** A new collector can proceed to Discovery without noticing a badge or opening transaction history. Returning to Trade still allows a fresh quote.

Evidence: [buy result](screenshots/buy-result.jpg).

### 08 — Discovery reads like a processing log

The real flow moved from randomness pending to “0 of 1 results processed,” briefly reported delivery-service status unavailable, and eventually delivered #2750. The waiting panel explains cancelled backing, verified ownership, public support data and timestamps at once. “0 min elapsed” persisted across observations even as the last-checked timestamp advanced; its underlying data/clock behavior needs investigation before classifying it as a timer defect.

**Fix:** Default to a restrained reveal state: “Discovering your craft” → “Preparing your craft” → the delivered identity. Explain once that no further signature is needed. Keep the material cancellation rule nearby, in plain language. Expand processing stages and support data only on request or when a delay actually requires action. Do not invent a countdown when delivery has no reliable ETA.

**Acceptance:** Normal waiting has one clear state and next action. A transient inability to fetch service health is distinguishable from confirmed delivery failure. Completion reveals and links to the craft rather than simply removing the progress panel. Delay timing uses a reliable request time and communicates unavailable evidence honestly.

Evidence: [pending](screenshots/discovery-pending.jpg), [randomness received](screenshots/discovery-mobile.jpg), [delivered](screenshots/discovery-delivered-mobile.jpg). Entry point: `apps/web/src/components/fleet/discovery-progress.tsx`.

### 09 — Rewards explains the machinery before showing the user's reward

The page opens with “When will my Orbiter receive rewards?”, the 0.04 WETH threshold, a pool-progress percentage, time rules, configuration checks and four processing queues. The claim button was around document y=1769px in the desktop capture. Wallet token balances form another section after the processing explanation.

**Fix:** Start with claimable rewards per token and the claim action. If zero, show one personal waiting reason and the user's eligible Orbiters/tracks. Put reward-cycle progress, queues, thresholds and verification below an expansion. Separate “Claimable,” “Already in your wallet” and “Protocol funds awaiting conversion.” Do not add unlike token units into a meaningless total.

**Acceptance:** Both positive and zero-claim states answer “What can I claim?” first. A new user is not required to understand conversion queues. Experienced users retain track-level budgets and evidence. No fixed payout or date is promised.

Evidence: [Rewards](screenshots/orbit-rewards.png), [fresh wallet's final mobile rewards state](screenshots/final-rewards-mobile.jpg). The latter was 4,095px tall at 390px width and showed an eligible NVDAc Orbiter with no claimable rewards. Entry points: `components/rewards/rewards-panel.tsx`, `reward-progress-panel.tsx`, `stock-balances-panel.tsx`.

### 10 — Explore is a sample gallery, not collection exploration

There are eight fixed sample IDs for a 4,444-identity collection, with no complete browse, pagination or sorting. Each card says “Illustrative preview” and primarily exposes its number. Search follows the gallery: approximately y=1577px at 390px width and y=1936px at 320px width.

**Fix:** Put search and filters first. Offer a paginated collection with useful track, tier and state metadata. Feature a small curated set separately if desired. Show discovered / undiscovered / unavailable states distinctly. Explain random acquisition once; browsing a specific identity must not imply that buying FUEL purchases that chosen identity.

**Acceptance:** Someone seeking NVDAc craft or a specific ID can start immediately. All identities are reachable through browsing, not only by knowing a number. Unknown ownership never becomes a fabricated “undiscovered” result.

Evidence: [Explore](screenshots/orbit-explore.png), [mobile Explore](screenshots/orbit-explore-mobile.png). Source corroboration: `apps/web/src/components/home/public-gallery.tsx` contains the eight-element sample list.

### 11 — Identity detail prioritizes support over the object and its action

On #2750 mobile, artwork is followed by explorer links, wallet-display help, “Copy support details,” Service status and a privacy explanation before Facts and Review Launch. Public #23 also shows ownership-oriented troubleshooting even though it is not owned by the visitor. “Not observed onchain,” “Not yet discovered” and manifest caveats make the public state feel like a diagnostic read.

**Fix:** Order: art + identity/state → track/tier/reward weight → relevant action → rewards → collapsed provenance/help. Render owner actions only in the owned state. Put transfer behind a secondary action. Give public visitors “Explore more” and a contextual acquisition explanation.

**Acceptance:** The next meaningful action is beside the identity facts on desktop and immediately after them on mobile. A healthy public identity page does not lead with troubleshooting.

Evidence: [Grounded detail](screenshots/grounded-detail-mobile.jpg), [public identity](screenshots/orbit-identity23.png). Entry point: `apps/web/src/components/fleet/craft-detail-panel.tsx`.

### 12 — A completed Auction still presents a bidding form

The connected view showed a completed auction with 20 WETH raised and 4,000 FUEL allocated, but retained “Set the most you will pay,” amount/price inputs and preparation steps, ending in “Bidding not open.” The disconnected view hid the useful auction state behind wallet connection despite claiming public protocol data remains visible.

**Fix:** Render by phase. Completed: result, market-open status, “Trade FUEL,” and personalized claim/refund tasks if applicable. Active: price, time, bid review and commitments. Upcoming: start time and explanation. Public phase/results do not require a wallet.

**Acceptance:** The completed state has no inviting but unusable bid form. A disconnected user can tell whether the auction is open. Wallet connection adds account-specific actions rather than unlocking basic public facts.

Evidence: [connected Auction](screenshots/orbit-auction.png), [disconnected mobile Auction](screenshots/orbit-auction-mobile.png).

### 13 — Finish the artwork system and remove presentation commentary

Home's cinematic spacecraft, gallery line-art identities, wallet imagery and relic presentations do not yet feel like one collection. “Editorial artwork,” eight “Illustrative preview” labels, and repeated “Preview only. No transaction.” copy advertise the production scaffolding.

**Fix:** Establish actual identity/state art, thumbnails, relic treatment and share cards as one system. Ship consistent artwork and metadata, then remove routine preview commentary. A Grounded/Orbiter appearance toggle can simply say “Grounded” and “Orbiter.” Move the explanation of illustrative marketing material out of the central product flow where it is not material to a decision.

**Acceptance:** Home examples, Explore, detail, Fleet and share cards portray the same identity consistently. Wallet/metadata differences are resolved or explained only where relevant. The repo contains a `PlaceholderMetadataRenderer`; verify deployed metadata and renderer immutability before promising that every wallet image can be changed through a frontend asset swap. This work may include a deployment/metadata dependency, not just deleting text.

Evidence: [Home](screenshots/orbit-home-mobile-clean.png), [Explore](screenshots/orbit-explore.png), [Relics](screenshots/orbit-relics.png). Entry points: `components/ui/craft-art.tsx`, `components/ui/craft-preview.tsx`, `components/home/public-gallery.tsx`, identity Open Graph image and `packages/contracts/src/metadata/PlaceholderMetadataRenderer.sol`.

### 14 — Wallet connection changes the product's name

Orbit's connection interface says ORBIT 4444, while the next chooser says “Connect a wallet to your ETHOnline 26 account.” The test peer also received the dapp name ETHOnline 26. This is a trust break exactly when the user is deciding whether to connect/sign.

**Fix / acceptance:** Use the public product name, icon and canonical origin consistently in the shell, wallet SDK project settings, dapp metadata and signing messages. Verify the actual external wallet display, not just an in-app heading.

Evidence: [wallet chooser](screenshots/orbit-wallet-picker.png) and observed WalletConnect proposal metadata.

### 15 — Navigation gives permanent space to temporary infrastructure

Auction remains one of four primary mobile destinations after completion. Mobile reserves a prominent extra row for “Get test funds,” even after funding. The compact logo loses its wordmark while account/testing controls consume scarce space.

**Fix:** Center navigation on Explore, Trade and My Fleet. Make Auction prominent while actionable and otherwise accessible as launch results/history. Consolidate address, network, balances and faucet access in an account menu. Retain a quiet testnet indicator; bring funding forward when the user is actually short of funds. Preserve the bottom navigation pattern, which is useful.

**Acceptance:** Primary navigation reflects continuing user tasks. At 390px, the global shell leaves useful first-screen space and still makes account/network state clear. Funded and unfunded headers do not show the same oversized funding invitation.

### 16 — Home needs a short introduction to the actual collecting loop

“Find the craft worth keeping” is a good restrained opening. The cinematic hero and two CTAs do not explain the relationship between FUEL, random Discovery, Grounded Craft and permanent Orbiters.

**Fix:** Add a short three-step visual sequence using real collection artwork: buy FUEL → discover a Grounded Craft → Launch a favorite permanently. State the one-FUEL irreversible burn at the Launch decision. Explain rewards briefly after the loop and link to rules. Add a small real collection sample and a route to Explore.

**Acceptance:** A first-time visitor can explain the basic loop without opening Learn. The home page remains short; it does not become a dashboard of fee splits and service health.

### 17 — Fleet should help manage craft, not just inspect them

The selected-craft hangar has useful visual space, and the All/Grounded/Orbiters filters are a good start. But “Choose a craft to inspect,” “Showing 1 of 1 matching confirmed collectibles,” the selected card and a separate “View craft” step add ceremony. The rewards teaser asks users to inspect progress rather than telling them their personal status.

**Fix:** Lead with useful counts, claimable rewards and any pending Discovery. Put View / Launch where appropriate on the selected craft; offer a grid for larger collections and keep the hangar as an optional presentation. Make the reward teaser state-aware.

**Acceptance:** A collector can identify launchable craft and claimable rewards directly from Fleet. Zero, one and many holdings all have intentional layouts. Keep the existing concise disconnected empty state.

### 18 — Amount errors should help users correct the amount

An insufficient-WETH quote suggested a maximum like `0.004143745632371792 WETH`, while generic “Enter an amount” guidance remained on a populated form. Available balances are hidden in a lower disclosure even though amount selection depends on them.

**Fix / acceptance:** Show an appropriately rounded available balance beside the amount, retain exact precision on demand, and offer Max. Display the most relevant state-specific message once. Reserve sufficient ETH for gas when computing spendable native balance. An insufficient-balance state must not also ask the user to enter an amount they already entered.

### 19 — Discovery thresholds should be translated into an outcome

“0.85048 FUEL to the next discovery” plus protected-minimum guidance asks new users to do threshold arithmetic and understand slippage simultaneously.

**Fix:** Offer an optional amount target such as “Enough for 1 Discovery,” calculated from the current balance and protected minimum. Explain when the quote is below the required boundary. Do not present an estimate as a guaranteed collectible before execution and Discovery finalization.

**Acceptance:** The review states the expected Discovery count and material minimum-boundary caveat in plain language. The interface does not suggest a particular chosen identity will be delivered.

### 20 — Faucet should be a short funding step

The request is preceded by service budgets, fixed request windows, caps and precise top-up calculations. Most of this is operational detail. Cooldown presentation favors an absolute date/time over how long the person must wait.

**Fix:** Show what the wallet will receive, request button and one current limit/cooldown. Move other limits below “Funding limits.” Keep the existing success link back to Trade and the `returnTo` behavior. If already funded or in cooldown, show the useful onward action there too.

**Acceptance:** Ready, requesting, partially funded, funded and cooldown states each have a clear next step. Testnet-only status is clear without repeating it in every sentence.

Evidence: [Faucet](screenshots/orbit-faucet.png), [funding success](screenshots/funding-complete.jpg).

### 21 — Relics need individual visual presence

Four narrow equal columns give small artwork the same treatment as ordinary information cards. Repeated preview labels, story paragraphs, kind/name duplication and ownership duplication take attention from the objects. “⅓ of 12.5%” requires mental arithmetic to understand one relic's share.

**Fix:** Give each relic a large distinctive silhouette and a concise identity/story. Use an appearance toggle whose result is immediate. Show one ownership state and a legible per-track share; explain the precise split in details. Preserve the difference between acquisition odds, reward allocation and actual claimable rewards.

**Acceptance:** Users can recognize the special objects visually. Previewing their state does not look like a blockchain action. Neither rarity nor reward allocation is described as a promised payout.

Evidence: [Orbit Relics](screenshots/orbit-relics.png), [Quotrons Relics](screenshots/quotrons-relics.png).

### 22 — Learn mixes onboarding, troubleshooting and technical reference

The page begins with multiple troubleshooting explanations and verification links before the collecting loop. Fees, reward percentages, wallet safety, many contract addresses, glossary and history then occupy one long page. The heading's promise that decisions come first does not match the order.

**Fix:** Separate Getting started, Rules, Help and Technical reference through tabs/pages or a clear indexed structure. Put the short collecting loop first. Make help task-based and expandable. Label historical protocol information explicitly as historical when it no longer describes the current auction phase.

**Acceptance:** Basic onboarding can be read without contract addresses. A troubleshooting visitor can jump straight to the relevant problem. Advanced rules and verification remain reachable and complete.

Evidence: [Learn](screenshots/orbit-learn.png).

### 23 — The visual system needs stronger differences in emphasis

Many sections use similarly weighted gray bordered panels, uppercase small labels and dense number/text rows. Orange marks actions, navigation, metadata and status, reducing its usefulness as an attention cue. The space theme is present, but the treatment often feels like an operational console.

**Fix:** Reserve strong orange for the principal action and selected state; use quieter secondary controls. Give collectible art more area, reduce repeated panel chrome, and use spacing to express grouping. Use a readable sans face for explanatory prose and mono for numeric precision/IDs. Establish distinct display, section, body and metadata scales. Review muted text contrast and focus visibility with measurements during implementation; no WCAG failure score was established here.

**Acceptance:** A blurred/squinted page still has an obvious subject and primary action. Prose reads comfortably on mobile. Track colors and statuses remain distinguishable without relying on color alone. Reduced-motion users receive equivalent state feedback.

### 24 — Use a consistent product vocabulary and formatting policy

“Canonical,” “bounded,” “manifest,” “observed onchain,” “WETH-side,” “sealed” and long ISO timestamps appear in normal collecting flows. Units and metadata can read as joined strings; dates alternate between raw UTC-style evidence and user-local text. Repeated disclaimers have become visual furniture.

**Fix:** Maintain one copy policy: user outcome first, one short explanation, technical evidence on demand. Standardize number precision, spacing between values and units, relative status timestamps with exact time on demand, and state labels. Distinguish unknown, empty, pending and failed. Never replace unknown data with a reassuring zero.

**Acceptance:** Shared components format the same asset and state identically. Public copy no longer narrates implementation choices. Material facts remain visible at the decision where they matter.

### 25 — Search and back navigation should accept user intent

Searching `0023` is rejected even though padded identity numbers are used visually. `/fleet/4445` correctly produces a 404 but sends users to the protocol overview or Learn instead of directly back to collection search. Entering a public identity from Explore highlights My Fleet in navigation, despite the working Back to Explore link.

**Fix / acceptance:** Normalize whitespace, an optional `#` and leading zeros at the search boundary; keep canonical URLs strict internally. Preserve Explore context through public inspection. Invalid identity recovery should lead to Explore/search with the attempted value available for correction.

### 26 — Put diagnostics behind human-readable service status

Status and Market are appropriate destinations for advanced evidence. Their block numbers, observation methods, health caveats, queue details and history should be reachable without being duplicated on every healthy collector screen. A check passing at one observation time should not imply perpetual service health.

**Fix / acceptance:** Start Status with what works, what is degraded, who must act and when it was checked. Expand exact evidence below. Keep claimable, queued and projected amounts separate. Expose Market data from Trade. Sparse market history should have a concise honest state rather than oversized chrome or implied long-term performance.

Evidence: [Status](screenshots/orbit-status.png), [Market](screenshots/orbit-market.png). Some captures include the earlier interrupted-wallet banner; that is a session state, not the default page header.

### 27 — Keep the Launch safeguard, improve its presentation and outcome

Launch review correctly names the collectible, gives the exact one-FUEL burn, identifies the resulting Orbiter, requires acknowledgement and supports cancellation. It repeats irreversibility across its heading, explanation, cost, note and checkbox. The detail page also shows the full transfer form by default, competing with Launch. After success, there is little celebratory state transformation beyond the data refresh and notification.

**Fix:** Keep one explicit irreversible-cost statement and acknowledgement, a before/after identity view, and the precise confirmation label. Make transfer a secondary sheet with its own recipient review. After verified Launch, show the same craft become an Orbiter and offer its reward view. Use restrained motion with a reduced-motion equivalent.

**Acceptance:** Cancel preserves the original page/context. Confirmation remains deliberate and keyboard accessible. Long mobile dialogs keep their controls reachable; validate with actual viewport screenshots and keyboard tests rather than full-page captures alone. Success celebrates a confirmed outcome, never an unmined request.

Evidence: [Launch review](screenshots/launch-review-mobile.jpg), [transfer review at the actual viewport](screenshots/transfer-review-viewport.jpg). Transfer validation and cancellation worked; transfer execution was not exercised.

## Proposed screen order

| Surface   | Default visible content                                                | On demand                                                  |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Home      | Product premise, real craft, three-step loop, Explore / Trade          | Rules, protocol background                                 |
| Explore   | Search, state/track/tier filters, collection                           | Provenance, technical ownership evidence                   |
| Trade     | Amount, balance, expected output, consequence, review / action         | Full chart, route, contract, raw quote evidence            |
| Discovery | Current plain-language stage, no-extra-action message, resulting craft | Randomness reference, service diagnostics, support package |
| Identity  | Art, state, traits, owner action, attached rewards                     | Contract links, wallet-display help, transfer form         |
| Fleet     | Collection, pending discoveries, personal reward summary               | Detailed filters, ownership sync evidence                  |
| Rewards   | Claimable per token, claim action or personal waiting reason           | Queues, thresholds, epoch and funding details              |
| Auction   | Current phase and relevant next action                                 | Auction results/rules, historical evidence                 |
| Faucet    | Funding amount, request or cooldown, return to task                    | Service limits                                             |

Progressive disclosure should happen within these tasks. A user should not need to decide whether they are a beginner or an expert before doing anything.

## What to take from Quotrons

The valuable reference is its coherence: the product object, typography, frames, textures and state transitions belong to the same world. Relics get enough space to feel special; appearance changes are understandable through direct interaction. The disconnected [Desk](https://quotrons.cash/desk) is restrained, and expandable sections elsewhere provide useful precedent for keeping mechanics secondary. [Relics](https://quotrons.cash/relics) is the strongest reference for giving objects identity and presence. [Exchange](https://quotrons.cash/exchange) is useful for comparing the amount card, though it also contains substantial surrounding explanation.

For Orbit, build a coherent spacecraft collection: a hangar/mission-archive visual language, actual recognizable craft, clear Grounded-to-Orbiter transformation and focused instrument-like controls. Preserve Orbit's dark space identity while developing it beyond generic panel grids. Do not simply copy Quotrons' paper palette or retro hardware.

Also avoid inheriting its long first-visit disclaimer gate, crowded navigation/ticker, long home page and aggressive slippage presets. The reference has strengths and its own sources of overload.

Evidence: [Quotrons Home](screenshots/quotrons-home.png), [mobile Home](screenshots/quotrons-home-mobile.png), [Desk](screenshots/quotrons-desk.png), [Exchange](screenshots/quotrons-exchange.png), [Relics](screenshots/quotrons-relics.png).

## Copy examples

These are proposed patterns, not claims that every line can be replaced without checking its data/state condition.

| Current pattern                                                       | Proposed presentation                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| “Illustrative preview” on every card                                  | Remove after final art is integrated; show track, tier and actual state instead.                         |
| “Preview Orbiter” + “Preview only. No transaction.”                   | Appearance control: “Grounded / Orbiter.”                                                                |
| “Canonical Market” + “Trade”                                          | “Trade FUEL.” Technical market identity in details.                                                      |
| “Randomness verified · preparing your collection” + processing essay  | “Preparing your craft.” Expand “Discovery details” for verification.                                     |
| “Copies only this request's public network…” on a healthy detail page | “Copy support details” inside Help; explain contents there.                                              |
| “Enter 0.004143745632371792 WETH or less”                             | “Available: 0.00414 WETH” + Max, exact balance on demand.                                                |
| “When will my Orbiter receive rewards?” before the user's balance     | “Your rewards” → claimable assets or “No rewards to claim yet,” followed by the actual current reason.   |
| Completed auction with “Bidding not open”                             | “Auction complete” → result and “Trade FUEL,” plus any personal settlement action.                       |
| Repeated network paragraphs                                           | Quiet “Base Sepolia · Testnet” in the shell, with no-value status in onboarding and transaction context. |

## Implementation sequence and validation

1. Fix transaction confidence and material consequence presentation: findings 01–03 and 06. Exercise delayed/lost wallet responses, multi-tab use and approval-only outcomes with meaningful integration tests.
2. Reorder the primary journeys: mobile Trade, Rewards, Explore, identity and phase-aware Auction. Preserve the functioning funding return link, filters, Launch acknowledgement and manual verification fallback.
3. Finish the art and visual system, then remove preview scaffolding. Validate any metadata/deployment dependencies before announcing wallet-art parity.
4. Apply the copy, number formatting, navigation and help architecture consistently.
5. Validate the completed flows on desktop and physical mobile wallets: disconnected, fresh funded, pending Discovery, owned Grounded, launched Orbiter, positive/zero claim, stale/unavailable reads and completed Auction. Add keyboard/focus, reduced-motion and measured contrast checks. Optimize performance after measuring actual loading and interaction costs; this audit does not assert a Lighthouse score.

The success criterion is practical: a new user can discover, buy, find their craft and understand Launch without reading protocol documentation, while an experienced user can still inspect exact mechanics and evidence without losing their task.

## Transaction evidence

All transactions below are Base Sepolia test transactions. Public receipt JSON contains no wallet key or pairing URI.

| Action                   | Hash                                                                 | Verified result                                                         |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Approve WETH             | `0x396c7d240709bdab9ace94e652853f101bf14a8bac85c51a670745f4eb59b6fd` | Success, block 46718980                                                 |
| Buy FUEL with 0.006 WETH | `0xd976e03cd8a50785aeba2ff9ec5b3f9513bcc56ea1dbb0066c1756d46d812d02` | Success, block 46718984                                                 |
| Launch #2750             | `0xf9848f4625cefa8c1d04c21b4c606e50455148ed3d00a222336bd8a249f321af` | Success, block 46719206; browser manually recovered                     |
| Approve FUEL for sale    | `0x8150674f545af212f227b4e769ffa029e2491ed1a953facefeb7a065a22677a6` | Success, block 46719291; browser cleared after reload                   |
| Sell 0.05 FUEL           | `0x4f8090495c4d5d655446f1d3e8d0ed7373c54c892231a5967ba8720b5f9a6319` | Success, block 46719339; normal frontend confirmation, Orbiter retained |

Receipts: [buy and approval](transaction-receipts.json), [Launch](launch-receipt.json), [sell approval](sell-approval-receipt.json), [sale](sell-receipt.json). Screenshots: [sale confirmation](screenshots/sell-complete.jpg), [retained Orbiter](screenshots/orbiter-detail-mobile.jpg).
