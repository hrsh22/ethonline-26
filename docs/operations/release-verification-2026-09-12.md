# Collector release verification — 2026-09-12

Target: `https://orbit.gamified.trade`, staging contracts on Base Sepolia (84532).
Chrome used the restricted WalletConnect test wallet
`0xA497893bBE4855b76db26f18BeEf34cD0EE3CfDd`. Rabby was not used. All assets were
valueless test assets; no administrator keys were used for browser transactions.

## Approval recovery

Release `181f58b` fixes the lost-wallet-response path. A completed token approval
previously restored as an unknown submission requiring manual investigation.
The application now checks exact approval evidence or the saved allowance
prerequisite automatically. Older approvals can return to a fresh review after
read-only checks. Neither route authorizes or repeats a purchase.

For the live regression, the test wallet withheld an approval response for 45
seconds **after** broadcasting it. Chrome reloaded during that interval. The
application restored the connected wallet, observed the allowance at block
46716061, and returned to idle automatically. It showed no wallet-check checkbox
or hash-entry requirement, and did not send a trade. A new explicit review then
completed the purchase without repeating the approval.

- Interrupted approval: `0x240be61b57dc2d190f7165c4328210898535c5fdd60d305249c958c54b04e3de`
- Subsequent purchase: `0x26fe4d78d3db8ba6eb6afec2a52e024efcd0cb21c4a5858efddc9f2922b7548c`

Uncertain value-moving transactions remain protected against automatic replay.
Advanced recovery remains available for those cases.

## Live browser outcomes

| Flow                    | Result                                                      | Transaction                                                          |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Buy with 0.006 WETH     | Confirmed; balances updated                                 | `0xaa43abc1d1fecb522317bf656ff276770686135b90306963bd59f9bb53d4358b` |
| Sell 0.05 FUEL for WETH | Confirmed; fractional sale preserved Discovery              | `0xc4c3c29ee29a89d973c971e3e7ed6c68d321960205dab5617c0406aefbfa288b` |
| Buy with 0.0001 ETH     | Confirmed without a token approval                          | `0xed86caa72abf04d6e43e39b52c1a0ac00e78ab680a69e2bc6bef2b7ab3efadc8` |
| Sell 0.01 FUEL for ETH  | Confirmed; native ETH received                              | `0x81647d270af87db856df8b5933b846616fbfbbca03e79d8c934a31603261487c` |
| Discovery               | Delivered Grounded Craft #1289, METAc, tier III             | `0xbebfbdcb774606126a42119f1fdafba45e9509933ed193c92281c3fcc0b38c7c` |
| Launch #1289            | Confirmed; became a permanent Orbiter; spent exactly 1 FUEL | `0x812a803e63ccf989ee8cd729be99d920b5668bd3e5b69171dd68c259b1e9e649` |

The faucet displayed both prior transfers as received, current balances, and the
correct cooldown. A second grant was not attempted during cooldown. Rewards
showed no accrued rewards; a reward claim was not fabricated or submitted.

The auction page displayed complete, 20 WETH actually raised, and all 4,000
auction tokens allocated. Read-only checks confirmed migration, activation,
launched/unpaused trading, and ready API/history/funding dependencies.

## Automated coverage

- Recovery release: 976 web tests, 605 script tests, `pnpm check:ci`, optimized
  production build, and 142 production-browser cases passed locally.
- Advanced-chart follow-up: replaces simple-chart mode and the OHLCV disclosure
  with the existing advanced canvas by default. The chart remains dynamically
  loaded and exposes a named, keyboard-focusable viewport with a visible ring.
- The chart follow-up passed 971 web tests, lint, the optimized production build,
  and all 142 production-browser cases with the advanced-canvas checks enabled.
- The complete browser-harness self-test passed all 22 cases, including the
  injected advanced-chart hydration and keyboard-accessibility failures.
- Chart-focused tests cover initialization, updates, cleanup, failure/retry,
  bounded ranges, preserved viewport, and truthful zero-volume intervals.
- The browser detector requires a hydrated advanced canvas, accessible name,
  keyboard focus, and a visible focus indicator. Synthetic Chromium checks
  proved the detector rejects seven injected failures and accepts the healthy
  fixture.

GitHub Actions quota was unavailable; these gates ran locally rather than being
inferred from an absent CI result. This is collector-flow coverage, not a claim
that every possible wallet, browser, administrative action, or RPC outage was
exhaustively exercised.

## Discovery completion and reward progress follow-up

The reported stale Discovery banner came from a saved request reference that
was never retired. Public pages intentionally remove wallet reads; the banner
then treated that historical reference as unresolved work. Fresh zero-pending
wallet observations now retire the reference. An old reference or a stale wallet
read alone cannot produce a pending banner. Opaque request IDs remain internal
and no longer appear in the banner, progress panel, or acquisition cards.

My Fleet → Rewards now explains and displays the next reward cycle's actual
0.04 WETH funding threshold, minimum cycle interval, processing status, and
individual track queues. Queued budgets are distinct from the new-epoch pot and
from claimable stock-token amounts. Missing or stale reads cannot show a false
zero or readiness. The view refreshes shared queries every 30 seconds while
visible, identifies the connected wallet's tracks, and keeps payout timing
explicitly dependent on activity and successful conversion. An Orbiter with no
claimable rewards now has a reward-progress shortcut from its collection.

Local verification: 990 web tests, `pnpm check:ci`, the optimized production
build, and all 142 production-browser cases passed. The production
journeys now check that the opaque ID is absent, completed Discovery stays
absent after public-route navigation/reload, and a launched Orbiter can open the
reward-progress view with an accessible funding meter.
