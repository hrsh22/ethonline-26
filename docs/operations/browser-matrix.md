# Production browser matrix

One runner checks the production build's HTTP responses, hydrated accessibility,
layout, wallet connection, and funding states in Chromium. There is no separate
SSR/JSDOM axe pass.

The release build and its test API use port 18800, separate from the development
API on 8800. Completed public views stay idle; failed wallet reads are checked
for bounded automatic recovery.

## Commands

| Command                                 | Scope                                            |
| --------------------------------------- | ------------------------------------------------ |
| `pnpm --dir apps/web test:browser`      | Full release matrix against an already-built app |
| `pnpm --dir apps/web test:browser:self` | Proves the harness fails on injected defects     |
| `pnpm --dir apps/web test:release`      | Build once, then run HTTP and browser checks     |
| `pnpm --dir apps/web test:production`   | Alias for `test:release`                         |

Focused runs stay available per ticket:

```bash
pnpm --dir apps/web test:browser --only=exchange,faucet
pnpm --dir apps/web test:browser --only=state:wrong-network
pnpm --dir apps/web test:browser --only=shell
pnpm --dir apps/web test:browser --only=http:
```

`--only` matches against case labels. `--report=<path>` writes the JSON report
(default `apps/web/browser-matrix-report.json`). `--screenshots=<dir>` captures
baselines for the marked routes at 1440 px.

## First-time setup

```bash
pnpm --dir apps/web exec playwright install chromium
```

Playwright pins its own Chromium build. CI must run the same command before the
matrix; the browser is not vendored into the repository.

## Long-lived local verification

`pnpm dev` is a foreground command. When an agent's terminal session expires,
its output pipes may close while Next.js stays alive. On 2026-09-05 this left
the server at 101% CPU with every HTTP request timing out: the Node debugger
captured `write EPIPE`, and Next.js repeatedly tried to log that error to the
same closed stderr pipe. This was a process-launch failure, not slow rendering.

For local verification that must outlive a terminal session, use a process
supervisor or give the existing launcher file-backed output and no terminal
input. From the repository root:

```bash
pnpm build:packages
mkdir -p .data
umask 077
nohup node scripts/staging-web.ts dev </dev/null >>.data/web-dev.log 2>&1 &
echo "Web launcher PID: $!"
curl --max-time 30 --fail http://127.0.0.1:3000/faucet --output /dev/null
```

Record the launcher PID. Verify its identity with `ps` before stopping it with
`kill -TERM <launcher-pid>`; do not kill every Node process. `.data` is ignored
by Git, and newly created logs are owner-only. Keep logs local and do not print
environment files. Apply the same output handling to individually launched
history/API workers, but never start a second history writer or funding signer.
Use a real supervisor when automatic restart is required; `nohup` does not
restart crashed services. A listening port alone is not readiness: require a
successful page response and the API's `/readyz` response before browser checks.

## What fails a run

- a console error, excluding the browser's generic `Failed to load resource`
  line, which duplicates the precise request reporting below;
- an unhandled rejection or thrown page error;
- a failed or non-2xx script, stylesheet, font, or image;
- a hydration mismatch, including React's **minified** production error codes
  418, 421, 422, 423, and 425 — the English messages never appear in a
  production build, so matching only on text would miss every real case;
- page-level horizontal overflow measured from real geometry, with a
  one-pixel tolerance for sub-pixel rounding;
- collector-header collisions measured between the brand, visible navigation,
  and wallet actions even when the document itself does not overflow;
- a first Tab that reaches nothing, or reaches a control with no visible box;
- a request to a protected admin path before a session exists;
- an Axe WCAG 2.1 A/AA violation, run **after** hydration.
- a numeric input smaller than 16px, an exact base-unit balance overflowing its
  metric cell, or a rendered keyboard-focusable chart without a visible outline;
- a fixture state whose expected wallet indicator, heading, or action never appears;
- an incorrect HTTP status, protected-route redirect, CSP, or frame policy.

## Coverage

- **Routes** — every public route, a valid and two invalid craft details, the
  global 404, admin sign-in, and both protected admin routes with their
  expected sign-in redirect, across 375/768/1024/1440 px in the shipped Graphite
  dark theme.
- **Shell regressions** — 320 px, 781 px, 1161 px, and 1200 px: compact,
  immediately above tablet, and the formerly colliding wide-nav range.
- **Wallet states** — disconnected, connecting, wrong-network, and an ordinary
  connected wallet, through an injected EIP-1193 provider so the real wallet
  code paths run without an extension or a live signer.
- **Funding states** — reads in flight, eligible, empty inventory, failed reads,
  already funded, and recipient cooldown. Each is
  checked once on the faucet, where its distinct outcome is observable.
- **Admin session boundary**: a connected wallet without an admin session is
  redirected from both protected routes and issues no protected request.
- **Admin controls**: a keeper/creator session reaches the real protected route
  at 375px. The raw minimum disclosure and exact WETH withdrawal input accept
  user input and must compute to at least 16px. A temporary 12px style on the
  actual minimum input must fail the same detector before its style is restored.
  Role-specific behavior remains covered by the admin component tests.

## Determinism

HTTP fixtures use endpoint-specific history envelopes checked through the actual
indexed-history reader, and funding responses checked by the shared Effect schema.
RPC chain identity is valid; unsupported chain reads explicitly fail. These cases
do not claim to cover healthy onchain balances. A separate market-history case
supplies two canonical swaps with matching fee records and requires a rendered
priced chart before inspecting its keyboard focus and layout.

Every interactive page must handle a real dialog interaction before inspection.
The static global 404 is checked as a recovery document, without a wallet shell. Connected
cases then open the wallet picker and select a locally injected EIP-6963 wallet.
Its provider emits account/chain changes and refuses all signing and sending.
Installing it alone does not count as a connection.

Release and CI builds use a fixed public test Reown project ID. Only Reown's
directory/configuration/image requests are stubbed; the application and wallet
connector are real. A normal app build is not changed. Running `test:browser`
against an arbitrary prior build requires wallet connection to be configured.

The `state:cached-stale` case loads a real encoded public snapshot from browser
storage, fails the live refresh, and requires the same collection count, funds,
block and observation time alongside the visible stale/last-known markers. It
does not present a failed first read as prior evidence. Rendered component tests
separately cover the fresh-to-stale TTL and chart data transitions.
The admin-input case starts a test-only API on `127.0.0.1:8800` for the runner's
lifetime; an occupied port fails startup. Only its opaque fixture cookie gets a
valid deployment-bound session. Verification and action endpoints are denied;
missing diagnostics return unavailable rather than falsely revoking the session.
Its partial chain fixture observes only the creator fee balance. Other contract
reads explicitly fail, so this case does not claim transaction readiness or
healthy operator state. No production authentication bypass is installed.

## Screenshot baselines

```bash
pnpm --dir apps/web test:browser --screenshots=apps/web/browser/baseline
```

Review the diff before committing. Baselines are captured at 1440 px for the
marked routes only; adding more is a deliberate choice, since every baseline is
a file a reviewer must inspect.

## Chrome connection recovery

The user authorizes agents to launch Chrome, open its extension-enabled profile,
and open or claim project test tabs without asking again. This permission covers
browser testing for this repository, not new access grants, security changes,
extension installation, credential handling, or transaction approvals.

1. Load the current Chrome skill and reuse a working browser connection. An empty
   tab list is valid; only a disconnected browser needs reconnection.
2. If connection fails, follow the skill's bundled extension and native-host
   diagnostics. A running Chrome process does not prove a usable window exists.
3. When those checks pass, use `node scripts/open-chrome-window.js --browser chrome`
   from the current Chrome plugin root. It selects the extension-enabled profile.
   Wait two seconds, reconnect once, and verify a real page through the plugin.
4. Use the Computer Use skill for native UI fallback. If it reports
   `cgWindowNotFound`, compare `sky.get_app_state({ app: "com.apple.finder" })`.
   If Finder works, use `sky.press_key({ app: "com.google.Chrome", key: "super+n" })`
   to create a native Chrome window, then retry `get_app_state`. Verify navigation
   and screenshot capture before declaring recovery. This recovered Chrome on
   2026-09-07 when the profile-launch helper alone had not produced a capturable
   window; no new permission or service restart was needed. Leave user-owned
   Chrome windows open after testing. Request user action only if the remaining
   recovery requires a new grant, reinstall, or another restricted action.

Verified on 2026-09-05: the extension and native-host checks passed while no
browser was connected and Computer Use could not find a Chrome window. Opening
the selected Profile 1 restored both plugins without installation or new grants.

## Manual Chrome checklist

Scripted success is not accepted as the only proof. Before a release, one
person runs this by hand with a real Reown wallet on Base Sepolia:

1. Connect an ordinary wallet. Confirm the faucet signs its wallet-control
   proof and reports funded, then cooldown on a second attempt.
2. Execute one explicitly confirmed valueless trade. Confirm the trade terms
   match what the wallet is asked to sign, and the receipt links resolve.
3. Reject a wallet prompt. Confirm the rejected state is reported and retry
   works.
4. Sign in to `/admin` with an authorized wallet. Confirm only the capabilities
   that wallet holds are rendered.
5. Open one privileged review, cancel it, then run one safe dry or no-op path.
6. Revoke or switch the wallet mid-session. Confirm admin access ends.

Record the date, wallet, deployment, and outcome alongside the release notes.
