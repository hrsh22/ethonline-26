# Production browser matrix

One runner checks the production build's HTTP responses, hydrated accessibility,
layout, wallet connection, and funding states in Chromium. There is no separate
SSR/JSDOM axe pass.

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
  Role-specific controls are covered by the admin component tests.

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

Retained stale evidence and chart data transitions are covered at the rendered
component seam and checked in Chrome with working reads. The old matrix's
"stale" case merely failed the first read, so it has been removed.
Authenticated admin input sizing is checked during the manual login pass.

## Screenshot baselines

```bash
pnpm --dir apps/web test:browser --screenshots=apps/web/browser/baseline
```

Review the diff before committing. Baselines are captured at 1440 px for the
marked routes only; adding more is a deliberate choice, since every baseline is
a file a reviewer must inspect.

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
