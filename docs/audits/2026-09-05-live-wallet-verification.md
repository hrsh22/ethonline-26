# Live wallet verification

Date: 2026-09-05. Branch: `audit/close-backlog`. PR: [#20](https://github.com/hrsh22/ethonline-26/pull/20).
Chrome used the real application at `http://localhost:3000`, Reown WalletConnect,
the checked `deployments/84532.json`, and live Base Sepolia contracts. No browser
wallet, RPC, funding, or admin-session fixtures were injected for these checks.
All assets were valueless test assets. The smoke peer signed only explicitly
enabled, deployment-bound actions; admin transaction submission stayed disabled.

## Service degradation

The initial degraded screen coincided with the API, history, and funding workers
being offline while the web server was running. Starting them restored API
readiness and the browser's Healthy status, including indexed reward history.
On resuming testing, the history worker had stopped again; restarting it restored
readiness. Its exit cause was not captured. One long-running development server
also stopped answering route requests and recovered after restart. Neither
restart is evidence of a protocol-contract fix.

The operator was keyless and Stopped. Its onchain diagnostics and its stale
attempt journal were checked separately. A real admin one-shot dry run completed
with zero submissions and left automation Stopped.

## Wallets and transactions

- Collector: `0x47560DC8c0EB1ad8b4A04011e17e03fEa460627f`.
- Cancellation/funding regression wallet: `0x4E4DCd5f2ce265fB99e97663c0Efc362F6b8C8a3`.
- Authorized admin: `0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214`.

The collector bought 1.173097920514834959 FUEL for 0.007 WETH, including the
0.00021 WETH fee. The browser's review matched the decoded transaction.
[The successful trade](https://sepolia.basescan.org/tx/0xfed5c27fd9431531b08980beb70d3edfdf98577c83976bda7b4b50f4d4529762)
was verified in Chrome at block 46425389, including transfers and recipient.

Because automation was deliberately Stopped, one ready Discovery was finalized
through a separately simulated, bounded CLI maintenance call, not the browser.
[Finalization](https://sepolia.basescan.org/tx/0x2e8f9b7a7922659a826294b66aa0f042ed9b6f26eba17b08bbd0ddbfe12f472a)
at block 46425987 produced Grounded Craft #1711, NVDAc, tier IV, weight 5.

The Launch review required its irreversible-burn checkbox. Cancelling kept the
craft unchanged. Confirming submitted
[Launch](https://sepolia.basescan.org/tx/0x32e00e2af198dff25af88e69be3d641caad763f907abcf13091f32a5b02b0628)
at block 46428156. Chrome's explorer receipt showed Success and exactly 1 FUEL
sent to the zero address. Fleet immediately showed 0.1731 FUEL, zero Grounded
Craft, zero Pending Discoveries, and incomplete permanent holdings while the
index lagged. Retry wallet read then showed one Orbiter, #1711, without another
transaction. Rewards showed zero units on all four tracks and disabled Claim.

A final [native-ETH trade](https://sepolia.basescan.org/tx/0x7362a71017d6479911a1014660aac1ddeddd9572874881d8e2c15eeab91c2dd5)
spent 0.0001 ETH for 0.016754037818342608 FUEL at block 46429012. Chrome's receipt
showed Success, the expected router/recipient, and the 0.000003 WETH fee. A direct
read pinned to the receipt block confirmed 0.009892626317182497 ETH. The immediate
browser showed 0.0098926 ETH, unchanged 0.0930 WETH, and 0.18985 FUEL, with separate
block labels where observations differed. Another Buy was disabled while
synchronization remained incomplete. Read-only retries after the index caught up
cleared that notice without another submission. Relics correctly showed all four
special identities as not held by this collector.

## Bugs reproduced and rechecked

| Issue | Observable result                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #21   | Rejecting the faucet proof reported signing cancellation and no asset request. Both balances stayed zero. Retrying requested another proof.                                                                                                              |
| #22   | A fresh real grant produced 0.01 ETH and 0.1 WETH. Its immediate success screen showed the next day's cooldown, without navigation. A separately signed repeat HTTP request returned already-funded with unchanged balances/deadline and no new request. |
| #23   | The Launch journey above verified fresh FUEL and explicit incomplete ownership until the index caught up. The native ETH sibling gap is tracked in #28.                                                                                                  |
| #26   | Rejecting a real WETH approval reported wallet cancellation, no submission, and Try again. Retry requested another wallet approval; both rejections retained 0.01 ETH, 0.1 WETH, and zero FUEL.                                                          |
| #27   | The new Orbiter exposed contradictory None attached / rewards ready copy. Live Fleet now says None attached and No rewards ready to claim; rendered checks distinguish positive, zero, and unavailable evidence.                                         |
| #28   | The native-ETH trade above verified pinned balance evidence, separate block labels, and receipt catch-up.                                                                                                                                                |

The existing public funding HTTP test also advanced the clock past 24 hours:
a wallet at both targets received nothing, and an ETH-only deficit received
exactly its 0.001 ETH shortfall without adding WETH. This simulated clock check
is not described as a 24-hour live browser wait. Funding was already deficit-only;
the new changes repair its immediate cooldown response and user feedback.

## Admin checks

The ordinary collector signed the real admin challenge and was denied because it
held no current operator role. The authorized admin signed in through Reown and
saw its nine actual capabilities. Creator-withdrawal review accepted an exact
small amount and rejected an amount above the balance; review was cancelled.
The FUEL pause review named its signer, capability, chain, pinned block, and
consequences; it was cancelled. No withdrawal or pause was sent.

The completed dry run, queue minimum gates, and Diagnostics were inspected in
Chrome. Expanding the health ledger showed 167 Healthy entries. Direct onchain
health, complete reward history, partial operational history, and the stale
attempt journal retained distinct labels. Sign out revoked the session, and a
direct revisit to Diagnostics returned to sign-in.

The corrected Operations summary now reports Stopped and scopes its empty-work
label to reward-track funds, addressing #24. Last Reward Epoch now says No
previous Reward Epoch when the count and timestamp are zero, addressing #29.
Both were rechecked while signed in. Operations, mobile navigation, Diagnostics,
and its expanded ledger had no horizontal overflow at 375px. Disconnecting the
authorized wallet revoked the admin session; a direct Diagnostics revisit again
returned to sign-in. This also checked revocation through Disconnect, not just
the separate Sign out button.

## Disconnect diagnosis and follow-up

The follow-up resolved #25 without changing wallet teardown. In a fresh Chrome
page, wallet `0x91551CDDd026d760232fF64E97A66d053b0e4F77` rejected a real funding
proof. At 1200px, Disconnect occupied x=12..227, y=726..770. Its center, 119.5,748,
was inside Next.js's **Collapse issues badge** button at x=108.23..132.23,
y=732..756. DOM hit testing returned `NEXTJS-PORTAL`, not the wallet button.
Clicking Disconnect collapsed that badge, produced no app-handler trace, and
left the wallet connected. An unobstructed click reached the handler and the
real peer received session deletion. The apparent retry was the first click
that actually reached the app, not evidence of a relay or SDK teardown failure.

The fix uses Next.js's documented `devIndicators.position` option to move the
development badge to the bottom-right. With the expanded badge still visible,
the same rejected-proof journey now hit Disconnect, showed pending teardown,
then showed Connect wallet on the first click. The peer confirmed session
deletion. No connector state, browser storage, or SDK code was patched, and all
temporary diagnostic logs were removed. Production does not render this badge.

At 375px, a fresh peer `0x6649082426dB257B39598FACaD6728284773B3D8` repeated the
rejection. The 44x44 Disconnect control was unobstructed, document width equalled
viewport width at 375px, and its first click returned to Connect wallet. This
measures the cancellation layout and action, not the short-lived pending layout.

The stalled development server's cause was also captured. Its expired terminal
session left stderr closed; the Node debugger observed uncaught `write EPIPE`
errors and sampling showed repeated exception logging at 101% CPU. Even static
HTTP requests timed out. Restarting the existing launcher with owner-only,
file-backed logs restored warm `/faucet` responses in 23.4ms. The history and API
workers use the same durable output handling during extended verification.
This explains the captured web stall, not the earlier history process exit,
whose final log remains unavailable.

#30 independently reproduced a temporary JSON-RPC `-32603` error terminating
history synchronization. Recognizing viem's existing `InternalRpcError` now
uses the existing finite Effect retries; real HTTP/viem checks cover recovery
to a committed checkpoint and continued rejection of invalid requests.

#31 removes two serial waits between independent wallet reads. With controlled
100ms external latency, the median fell from 511ms to 307ms, with unchanged RPC
counts and separate current-balance/indexed-ownership block identities. This is
a controlled comparison, not a promised live-network latency. No dependencies
or caching layer were added.

## Remaining limits

No live Stock Reward claim, creator withdrawal, protocol pause, or automatic
treasury replenishment was submitted. The zero-reward claim path was disabled,
not described as a successful claim. No deployed contract or protocol economics
changed. Temporary wallet peers were stopped and their generated private-key and
pairing files deleted after verification. Configured deployer credentials were
not changed. Live web/API/history/funding services were restored afterward.

## Final checks

The final uninterrupted root `pnpm test` run passed after the follow-up fixes,
including the production browser matrix and local deployment integration.

- `pnpm check:ci`: formatting, lint, TypeScript, deployment schema and manifest checks passed.
- `pnpm test:scripts:ci`: 451 tests passed after the history-recovery follow-up.
- `pnpm -r --if-present test`: config 137, protocol 253, API 139, web 783,
  contracts 184 unit checks, four stateful invariants, and four gas checks passed.
- `pnpm --dir apps/web test:release`: optimized build and 101 browser/HTTP cases passed.
- `pnpm --dir apps/web test:browser:self`: all 15 injected-defect/self-check cases passed.
- `pnpm test:deployment:ci`: local deployment, governed redeployment, idempotent
  rerun, mutation preflights, and launch seals passed.

An initial concurrent formatting check ran while tests were rewriting generated
gas snapshots and a component test was still being edited; it failed formatting.
The final complete `check:ci` run passed after those writes settled.

Independent Standards and Spec reviews passed after the native-ETH gap they found
was fixed. Both follow-up reviews also passed for #25, #30, and #31; the live
disconnect evidence above supersedes the earlier unresolved diagnosis. No new
dependencies were added. The full PR's non-test TypeScript under `apps/*/src` and
`packages/*/src` is 1,050 lines smaller than main; total repository lines increased
because of behavioral tests and verification records.
