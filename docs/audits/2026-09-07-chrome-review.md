# Collector Chrome review, 7 September 2026

Reviewed the running development app through the Chrome extension at desktop width and a 375 × 812 viewport. This was an agent walkthrough, not an unfamiliar-user session or a physical mobile-wallet test.

## Observed and fixed

- Trade accepted an amount while disconnected but continued asking the visitor to enter an amount and wait for a quote. It now explains the wallet or network prerequisite, retains the amount, and quotes after access becomes ready.
- Relics restricted its detail links to owners, despite the detail routes supporting public inspection. Every Relic now has a public inspection link. The introduction explains the three Stations and Observatory, and the disconnected Fleet no longer calls a Station one of four Stations.
- The development badge intercepted taps on mobile More. Disabling the floating badge restores the app control while Next.js still reports runtime and compilation errors.
- Enlarged-text regression checks exposed overflowing wallet, onboarding, reward, help, and artwork controls. Their content now wraps within its available width. Gallery artwork reserves its dimensions and uses native offscreen paint deferral; public links and text remain available.
- BaseScan displayed Grounded Craft #1639 with no image, while the app and current contract metadata reported Orbiter #1639. Help now distinguishes cached external state labels from the sealed placeholder image limitation. See the [pinned metadata comparison](../artwork/2026-09-06-web-preview-boundary.md#chrome-explorer-comparison-7-september-2026).

## Chrome walkthrough

Inspected home, Get started, Trade, Fleet, Rewards, Relics, Market, Status, Learn, Faucet, and public identity details. The live #1639 page showed Orbiter and the expected owner. Unassigned #4441 explained that the identity remained in the available pool. The market showed indexed timestamps and available history; Status distinguished stale chain observations from unknown delivery status.

At phone width, verified More navigation, Relic inspection, browser Back to Relics, invalid identity lookup feedback, successful lookup of #1639, copy-link feedback, and wallet-display help. The wallet chooser fitted the viewport. Closing it retained the entered Trade amount. No wallet signature or transaction was submitted. The app tab recorded no console errors during this walkthrough. After history recovery, the advanced market chart opened with interval, indicator and drawing controls.

## Performance and regression checks

The constrained-network benchmark exposed an additional header jump while the webfont loaded. Next's adjusted Arial fallback made the disconnected Connect button much wider than JetBrains Mono. A monospace fallback keeps the header at 56 px through font loading. Matched public-home CLS fell from 0.2343 to 0.0008, with six RPC requests in both builds. A 50-holding Fleet used 19 requests versus a baseline median of 54, with CLS falling from 0.3510 to 0.0039. Wallet readiness remains about 6.8 seconds; the later Fleet LCP is explicitly retained as a limitation. The [performance record](../operations/collector-performance.md) preserves baseline, intermediate regression and corrected measurements.

The web suite passed 881 tests and configuration passed 137 tests. The 110-case production browser matrix and 17 harness self-tests passed before the font correction. The final font build is undergoing the same browser validation. Standards and Spec reviews found no remaining actionable findings through the font correction. CI also exposed a faucet-test scheduling race; it now waits for the actual recovery state and preserves its one-proof/one-request assertions.

## Running backend refresh

The old API returned 404 for `/v1/delivery/status` because it had loaded a September 5 build. Rebuilt packages and API, gracefully stopped its single supervisor, verified its children exited, and started one file-backed supervisor. The existing history migration replayed the index before the operator started. Readiness then returned HTTP 200, history was complete within two blocks of its observed head, and delivery status reported the saved Live policy, online liveness and a completed run. The first resumed cycle submitted no transactions because no Discovery was pending. Chrome recovered the market and displayed Delivery running. The authorized policy was unchanged.

## Acceptance boundaries

The production browser matrix and component checks provide controlled connected-wallet, transaction, and delayed-recovery coverage. This Chrome walkthrough used public live reads and a disconnected wallet chooser. Neither establishes physical mobile wallet handoff, virtual-keyboard behavior, manual screen-reader behavior, or comprehension by five unfamiliar collectors. Issues #44, #48, #53, and #56 retain those explicit acceptance gaps until evidence exists.
