# Agent accessibility and mobile-layout review

Date: 7 September 2026. Issues #44, #53 and #56. Chrome with the production application at localhost:3000 on Base Sepolia; no-value test assets only.

## Browser evidence

- At 375 × 667, Fleet, Trade and Rewards remain one-tap destinations. The current destination has `aria-current="page"`. Browser Back returns to Trade after visiting Rewards.
- Trade exposes separate Buy/Sell and ETH/WETH groups, labeled You pay and You receive inputs, decimal input mode, a 44 px input target and 28 px numeric input text. The typed amount remains while opening and dismissing navigation.
- At 667 × 375, More opens a scrollable navigation menu. Keyboard traversal reaches the last route and returns to the wallet control. Escape closes the menu and returns focus to More with `aria-expanded="false"`.
- The actual Reown chooser fits at 375 × 667. Its close action is reachable. Cancellation exposed a second defect: focus remained on the page body instead of returning to Connect wallet; the shared control now restores the initiating Connect wallet button, confirmed in the rebuilt production app. Tests also cover a stale earlier attempt, intentional focus elsewhere and unmounted controls. Ordinary chooser dismissal was also checked in the rebuilt Chrome app: it produces no connection error and returns focus to Connect wallet; explicit wallet rejection and connection errors remain visible, and late unrelated events cannot affect the closed attempt. This is chooser and desktop-browser evidence, not a phone-to-wallet deep-link test.
- A 375 × 350 usable-height check exposed a focus obstruction: Tab from You pay to You receive placed the second field at y257–301 while the bottom navigation began at y285. The field remained partly visible but its lower 16 px were covered. Native scroll padding now reserves space for the header, bottom navigation and focus outline; a browser Tab regression checks the actual field bounds. Reduced-motion mode also disables smooth page scrolling. In the rebuilt production app, the focused field ended at y272.34 and navigation began at y285, leaving room for the six-pixel focus outline.

Existing release checks cover enlarged text, reduced motion, contrast, route accessibility, delayed collector operations and single-submission recovery. The positive desktop Chrome/Reown claim was independently verified in the separate positive-reward-claim audit; those receipts are not repeated here.

## Native and physical environment

No `adb`, Xcode Simulator, `simctl` or `devicectl` is available. No physical phone transport is exposed by the available tools. A browser viewport override does not prove virtual-keyboard, safe-area or wallet-app return behavior on an actual phone.

Computer Use could not capture Chrome or Finder in this session: both returned `cgWindowNotFound`. Retrying native Chrome window creation did not restore capture. Starting the installed VoiceOver application timed out; no screen-reader listening or navigation result is claimed. The task-started VoiceOver process was stopped after the failed attempt. The previous turn's successful Computer Use claim remains valid historical evidence, but does not establish VoiceOver behavior in this session.

This review covers keyboard behavior and exposed browser accessibility semantics. It does not certify spoken announcements or unaided newcomer comprehension. The original physical-device and participant requirements require an explicit acceptance-scope decision before being treated as complete through agent review.

## Final validation

The production build, repository checks, all 897 web unit tests and all 137 configuration tests pass. A stale configuration assertion still expected callback-only delivery wording; it was updated to the corrected two-stage explanation before the configuration suite passed. Independent source review found no remaining actionable defects. The targeted production mobile journey passed on the rebuilt artifact, including short-screen focus clearance and reduced-motion scrolling. PR CI results are recorded in the merge record.
