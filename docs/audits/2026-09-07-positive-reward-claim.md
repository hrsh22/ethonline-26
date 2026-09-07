# Computer Use recovery and positive reward claim — 7 September 2026

## Computer Use

`sky.get_app_state({ app: "com.google.Chrome" })` reproduced `cgWindowNotFound`. Finder returned a valid desktop accessibility tree, ruling out a general desktop-capture failure. Creating a native Chrome window with `sky.press_key({ app: "com.google.Chrome", key: "super+n" })` restored its accessibility tree. Native address-bar navigation to `/rewards`, screenshot capture, and a later read of the connected Reown test wallet all worked. No permission change, extension install or service restart was needed. The recovery procedure is now in the browser matrix runbook.

## Authorized test setup

The user explicitly authorized canonical trading to generate rewards. The deployed Base Sepolia reward pot was below the immutable 0.04 WETH epoch minimum; arbitrary WETH transfers would not credit that accounting. The setup used existing valueless test WETH and four 0.3 WETH buy/sell round trips through the canonical router, with fresh quotes, 1% minimum-output protection, exact approvals, transaction simulation and the 64-discovery-mutation bound. All 16 setup transactions confirmed.

The setup wallet's original FUEL balance was restored exactly. Net test WETH expenditure was 0.07092, and the reward pot reached 0.049678805030711304 WETH. No fee, epoch threshold, exemption, ownership or route configuration was changed. The claimant is the existing Reown test wallet `0xA497893bBE4855b76db26f18BeEf34cD0EE3CfDd`, owner of permanent NVDAc Orbiter #4179. Its starting four reward-token balances and pending rewards were all zero.

## Recovery defect exposed by setup

The setup signer is also the staging operator signer. Despite checking latest and pending nonces before each setup transaction, a concurrently running discovery maintenance action selected the same nonce, 1422. The setup approval mined; the operator's original hash had no receipt and could no longer land. This was caused by overlapping test setup and operator signing. Pending-nonce checks alone do not serialize separate processes; future setup trades must use a separate funded test signer.

- Original operator hash: `0x42965601b62f5aa13ab14d169df37b6efaeb273da5ace309e9e85f757e81f478`.
- Confirmed setup approval: `0x0054f6828eaa55ec22ad02c7c4b38f45b946371df913db4e4cf50447223fb20d`.
- Canonical block: 46,507,042; account nonce after that block: 1423.

The unresolved transaction correctly prevented further operator signing, but the existing recovery path could only look up its receipt or rebroadcast its exact bytes. It had no terminal outcome for a provably consumed nonce. Issue #61 tracks the recovery fix and its actual-chain verification. No outbox row was manually deleted.

## Claim result

The next scheduled Live cycle recovered the original submission without a restart, policy change or manual outbox deletion. It persisted the canonical replacement proof, opened epoch 1 and confirmed all four reward conversions. All conversion queues cleared. The NVDAc conversion was `0x6def163335e7118661c8a167e004d39bcca13e5e79d9d02693ce0bf1c6bd1987`.

Computer Use refreshed the actual Chrome Rewards page, opened the claim review and expanded its identity list. The review showed #4179 and 0.229153130954477008 NVDAc. One Confirm claim click submitted through the connected Reown test peer, restricted to claim actions. The app showed preparation, then confirmed status, zero remaining claimable rewards and a disabled claim button. Confirmation and zero claimable balance survived a full browser reload.

Claim transaction: [0x92a925…ac460](https://sepolia.basescan.org/tx/0x92a92512b8c8ecf9bef85f7ad4c5ead977d15a80a8a6d904cd73a3b9e10ac460), canonical success in block 46,508,045. Independent reads at block 46,508,067 verified 23 confirmations, the matching RewardClaimed event and NVDAc Transfer from the ledger to A497. The exact wallet delta was +229153130954477008 raw units, or 0.229153130954477008 NVDAc. The other three reward balances stayed zero. All four pending amounts became zero; #4179 remained permanent and owned by A497.

Public setup, conversion and claim evidence is retained in [the JSON record](2026-09-07-positive-reward-claim.json). Setup trades used the CLI; the claim itself used the real Chrome app, native Computer Use controls and Reown. This is desktop wallet verification, not physical-phone coverage.

## Validation

All 489 script tests and repository checks passed. The focused recovery suite passed 81 tests, including uncertain replacement evidence, reorgs, pruned RPC history and durable recovery across crashes. Independent standards and spec reviews found no remaining code defects. Live recovery and the positive claim satisfy issue #61's actual-chain acceptance checks.

The successful claim exposed misleading empty-state wording that said no rewards had accrued yet. It now describes the current state: no rewards are available to claim. All 11 existing rewards panel tests pass. The Reown session was disconnected after verification and the temporary pairing file removed.
