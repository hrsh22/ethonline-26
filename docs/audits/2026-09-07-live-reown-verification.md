# Live Reown verification — 7 September 2026

The Chrome extension drove the actual app at localhost:3000, paired through Reown with the repository's WalletKit test peer on Base Sepolia (84532). These were signed, mined testnet transactions, not mocked browser transactions. The [receipt record](2026-09-07-live-reown-receipts.json) contains all 12 successful receipts, decoded inputs, effects and final state at block 46,501,080.

## Executed journeys

| Journey           | Observed result                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funding           | Original wallet signed once, reloaded while pending, and received ETH/WETH without a duplicate proof. Cooldown remained visible on return.                                                                                                        |
| WETH buy          | Approved and bought with 0.007 WETH; reload recovered confirmation. Fleet tracked one pending Discovery and automatically delivered Grounded Craft #4179 without operator intervention.                                                           |
| Launch            | Cancelled review without a wallet request, then confirmed launch. Exactly 1 FUEL burned; reload recovered confirmation and Fleet retained Orbiter #4179.                                                                                          |
| Sell              | Approved and sold 0.1 FUEL. Permanent Orbiter remained held.                                                                                                                                                                                      |
| Native buy        | Expired quote blocked submission. A refreshed 0.0001 ETH buy completed with one transaction and no approval.                                                                                                                                      |
| Transfer          | Sent #4179 to a second test wallet and verified its Fleet; returned it after the reconciliation fix and verified the new owner immediately without disconnecting or reloading.                                                                    |
| Funding rejection | Second wallet rejected the proof; the app reported cancellation and balances stayed zero. Reconnecting and accepting funded the wallet.                                                                                                           |
| Rewards           | All four pending amounts were zero and Claim was disabled.                                                                                                                                                                                        |
| Admin             | Ordinary wallet was denied after signing. Authorized wallet authenticated, inspected roles/diagnostics, cancelled a Pause review without sending, requested one dry run, and signed out. Protected navigation then required authentication again. |
| Network/session   | Switched a wrong-network peer to Base Sepolia. Disconnect deleted sessions; reconnect restored the intended wallet.                                                                                                                               |
| Mobile            | At 375×812, navigation opened/closed correctly, Fleet retained the Orbiter, required FUEL was readable, filter labels fit, and the 77-digit Discovery reference wrapped without horizontal page overflow.                                         |

The original collector is `0xA497893bBE4855b76db26f18BeEf34cD0EE3CfDd`; temporary recipient is `0xAB211b5b4768BA055b0cF8cE6232335175f8B6d2`. Final original holdings: one permanent, active Orbiter #4179, zero pending Discoveries, 0.088675214684693132 FUEL. The recipient holds no collectible. The saved operator policy remained Live; the requested dry run completed and cleared its one-shot request.

## Defects found and fixed

1. A confirmed transfer could leave the detail page showing its previous owner and owner actions. Direct collectible reads now respect a session-scoped confirmed receipt block floor and recover automatically from stale observations. The live return transfer verified the fix.
2. Required FUEL copy displayed long raw decimals. Required amounts now use the existing formatter with upward rounding so a displayed target never understates the required amount; balances and exact transaction values retain their existing semantics.
3. The Discovery reference overflowed the mobile page. It now wraps using CSS.
4. Fleet filter labels overlapped at phone width. The shared segmented control wraps complete labels and grows to fit them. Browser regressions check normal and 200% text at 375px.

The test peer gained an opt-in transfer capability restricted to the deployed mirror, its own sender, an explicitly configured nonzero recipient, valid identity range and zero ETH. Set `SMOKE_WALLET_TRANSFER_RECIPIENT` alongside the existing transaction/action opt-ins. No generic contract signing or approval-for-all was added.

## Validation and limits

The final production build, `pnpm check`, 889 web tests and seven smoke-wallet tests passed. Independent Standards and Spec reviews accepted the transaction/read/format changes; a separate review accepted the final mobile increment. Controlled browser regression results are recorded in the accompanying PR/CI.

Early live actions used the development server; the return transfer and final mobile checks used the production build. Local production metadata used `https://localhost:3000`, while browser traffic used HTTP localhost. This is local acceptance evidence, not a deployed HTTPS-site claim.

Next.js development error indicators can still obscure mobile controls after a console error even with `devIndicators: false`; collapsing the badge restores the target. The production build has no development indicator. This refines the earlier Chrome review's badge claim without hiding runtime errors through application CSS.

Computer Use repeatedly returned `cgWindowNotFound` despite Chrome running and the documented reopen/retry procedure. Chrome extension control worked throughout, so verification continued there.

No positive live reward claim was possible: epoch count was zero, track queues were empty, all four pending rewards were zero, and the observed reward pot was about 0.002385 WETH versus the 0.04 WETH epoch minimum. No economic settings were changed to manufacture a claim. No privileged Pause, withdrawal, epoch or POL transaction was submitted.

Physical-phone wallet handoff, virtual keyboards, manual screen readers, final artwork and sessions with five unfamiliar collectors are not established by this run. Issues #44, #48, #53 and #56 retain their remaining acceptance requirements.
