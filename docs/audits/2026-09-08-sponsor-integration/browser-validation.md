# Browser validation — 2026-09-08

The final production build passed the complete Chromium release matrix: **111
cases, zero failures**. This includes HTTP/security checks, public and protected
routes, all configured viewports, accessibility, mobile keyboard geometry,
wallet states, funding states, bounded read recovery, idle traffic, and every
collector transaction/reload journey.

- Build: `NEXT_PUBLIC_API_URL=http://127.0.0.1:18800 NEXT_PUBLIC_APP_URL=https://orbit.test NEXT_PUBLIC_PRIVY_APP_ID=cmtrsnsiz01xr0cieaecu5ki5 pnpm --dir apps/web build` — passed.
- Complete matrix: `pnpm --dir apps/web test:browser` — 111 passed.
- Final affected-case check before the complete run — 26 passed, including all invalid craft routes, protected admin routes, mobile focus, connection cancellation, disconnect/reload, and seven collector journeys.
- Harness self-test on the same final build, using an isolated production server on port 3109 — all 17 injected-defect/focus-restoration checks passed.
- Focused session/installed Coinbase SDK regression tests — 10 passed.

The detailed local report is `apps/web/browser-matrix-report.json` (ignored by
Git). Its SHA-256 for this run is `539fcd6163e5727ad623b99b9ec8a93a2690137c3285bfddd0616d58da39e7b0`.

## Real external-wallet check

A separate isolated Chromium session used the live application at
`http://localhost:3000`, Privy's wallet chooser, and a genuine WalletConnect
relay connection to an ephemeral WalletKit peer. Connection reached the app's
connected state; Disconnect returned to the Connect wallet action. No network
fixtures were installed for this check. Transaction, funding-proof, and admin
signing permissions were disabled. The pairing link stayed in memory and was
not printed; the peer and test browser were closed afterward.

## Regressions fixed and verified

- Disconnect clears every restored wagmi connector, preventing another
  authorized connector from silently keeping the app connected. The release
  case verifies connected reload, disconnect, and disconnected reload while the
  injected provider retains its account grant.
- Closing the Privy chooser is neutral cancellation. Actual connection errors
  still produce the retry state. Dismissal no longer introduces a large error
  banner that obscures focused inputs in a short mobile viewport.
- The installed Coinbase SDK checks actual COOP response headers on 404 pages.
  Tests verify compatible 404 headers, rejection of incompatible COOP headers,
  and continued failure on HTTP 503. No console errors or application statuses
  are suppressed by the harness.

## Scope of deterministic fixtures

The automated external-wallet matrix stubs Privy's public configuration,
analytics, logout acknowledgment, and the embedded frame's transport-readiness
handshake. Every embedded-wallet operation is rejected by that frame fixture;
no user, OTP, token, or authenticated session is fabricated. The matrix exercises
the real Privy SDK, injected EIP-6963 connector, and application code. Live email
and embedded-wallet transactions are documented separately in this audit folder.
