# Collector implementation validation

This record covers the 24 specifications under [#57](https://github.com/hrsh22/ethonline-26/issues/57), including the preceding authorized fixes already present in the working tree. Review compared the final work with `c16067c04bcfe5f08399a2de5a9b57077b9accef` on `main`.

## Behavior delivered

| Specifications     | Result                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #33, #37           | Submitted hashes, ambiguous wallet outcomes, and completed activity survive reload. Automatic receipt checks never resubmit. Previously verified Fleet identities remain visible during eligible transport failures and post-Launch index lag. |
| #34, #40           | Accepted funding requests persist in SQLite and recover through the existing service queue. Leases, nonce and receipt records prevent duplicate grants. Newer status observations supersede delayed request responses.                         |
| #35, #36, #41, #51 | Incomplete ownership and unavailable rewards remain unknown. Every claim review identifies eligible identities and separate token amounts. Current ownership and fresh authorization remain required.                                          |
| #38, #39           | The app distinguishes observation freshness from delivery availability. Obsolete reads abort, deadlines and endpoint cooldowns bound recovery, and successful idle detail reads stop polling.                                                  |
| #42, #43, #45, #52 | Launch and transfer reviews name the identity and consequences. Connection opens the wallet chooser directly. Trade separates approval from purchase, and first-use guidance carries the next required action across pages.                    |
| #46, #47           | Indexed Discovery request/outcome events correlate acquisition hashes with delivered or cancelled results. Completed Launch and delivery remain reviewable; animation does not imply ownership before verification.                            |
| #48, #49, #50, #55 | Public browsing, identity lookup, craft previews, Relic stories, Fleet filters and share previews use the existing art and routing. Sealed canonical metadata differences are disclosed.                                                       |
| #53, #54, #56      | Mobile primary navigation, readable form/prose sizing, contextual help and safe support references are implemented. Physical-device and unfamiliar-user acceptance remains open.                                                               |
| #44                | Seven deterministic transaction journeys exercise the real client coordinator with controlled HTTP and wallet boundaries. They cannot sign or broadcast on a live network.                                                                     |

Live resumes after a backend restart only for the same authorized deployment. An explicit Stop remains stopped, as requested and recorded in ADR 0012. Protocol economics and sealed deployment identity are unchanged.

## Automated validation

- `pnpm check` passed formatting, deployment schema and generated manifest consistency, lint, and workspace/script type checks on the final source.
- The full test invocation passed scripts: 458 tests; config: 137; protocol: 259; API: 140; contracts: 184 unit tests, 4 invariant tests and 4 gas tests. It stopped at outdated web fixture/copy assertions. After those corrections and the final layout/focus changes, all 99 web files and 871 tests passed.
- The production build passed. The browser matrix caught missing new API fixtures, focus-check assumptions and responsive layout defects. A mobile submit regression then proved the navigation could reappear between pointerdown and pointerup and intercept the click. Removing focus-driven navigation hiding made the same regression pass. The final production matrix passed all 109 cases. All 17 browser-harness self-tests passed, including injected failures and the corrected native-summary keyboard-path injection.
- `pnpm test:deployment:ci` passed local deployment, governed redeployment, idempotent rerun, mutation preflights and launch seals. This used the local test chain.

In the controlled startup comparison, Fleet RPC HTTP requests fell from 46 to 19 and Trade from 42 to 19. Fleet CLS fell from 0.3510 to 0.0039 and Trade from 0.1288 to 0.0373. Wallet-data readiness stayed around 6.8 seconds. Fleet LCP now measures later wallet-dependent content; the report records that delay rather than claiming all rendering improved.

See [collector journeys](../operations/collector-journeys.md) for the seven workflows, exact submission expectations and test boundaries. See [performance measurements](../operations/collector-performance.md) for constrained-network conditions, comparable request counts and rendering limitations. Whole-journey request totals are not idle-load budgets.

## Review

Standards and specification reviews ran independently against the full worktree change. Standards review found no unresolved documented-standard violations after corrections. Specification review identified completed-activity retention, missing approval/trade/claim journey coverage and missing comparable performance evidence; the implementation and checks were extended to cover them. The final gallery, layout, focus and benchmark changes were reviewed again. Both axes report zero unresolved actionable findings.

The review also corrected stale-history retention to accept only typed transient history unavailability, amended ADRs for the additive discovery event/query contract, and checked migration revision handling inside its SQLite transaction. Unknown or invalid canonical evidence cannot be promoted to current ownership.

## Outstanding manual acceptance

The following issues remain open for checks that have not occurred:

- #44 and #53: a physical mobile-wallet connection/return smoke check, plus real virtual-keyboard reachability for #53.
- #48: unfamiliar reviewers distinguishing the craft and four Relics at thumbnail size, and actual wallet/explorer appearance comparison.
- #56: five unfamiliar-user journey sessions, manual screen-reader verification, and physical text enlargement/keyboard checks.

[Public usability validation](../operations/public-usability-validation.md) supplies the session tasks and evidence fields. [Artwork boundary](../artwork/2026-09-06-web-preview-boundary.md) records canonical metadata evidence and the disclosed web preview difference. Desktop Chromium at 375 px does not establish physical mobile-wallet support.

No mainnet deployment, canonical metadata migration, real wallet transaction or public-usability sign-off was performed as part of this implementation.
