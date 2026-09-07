# Sponsor integration verification — 8 September 2026

The implementation connects Privy email and external-wallet onboarding to the
existing canonical Uniswap v4 market and a deployed Graph Studio reward-funding
projection. Web and API verification ran locally against Base Sepolia; no web
or API deployment was performed. Only free-tier services were configured.

## Automated validation

| Check                              | Result                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm check`                       | Passed: formatting, lint, TypeScript, deployment schema/bindings and Solidity compilation |
| Web unit/component tests           | 101 files, 915 tests passed                                                               |
| API tests                          | 150 tests passed                                                                          |
| Config tests                       | 137 tests passed                                                                          |
| Protocol TypeScript tests          | 19 files, 264 tests passed                                                                |
| Script tests                       | 42 files, 496 tests passed                                                                |
| Subgraph                           | Schema compatibility, six mapping tests, code generation and WASM build passed            |
| Production web build               | Passed                                                                                    |
| Production browser matrix          | 111 cases passed, zero failures                                                           |
| Browser harness defect self-checks | 17 passed                                                                                 |

The Solidity compiler emitted existing timestamp and test-token transfer lint
warnings. Contract source did not change. These results do not represent a new
full Solidity deployment/fork test run.

See the [browser validation record](browser-validation.md) for coverage and fixture boundaries.

## Live service evidence

The [integration runbook](../../operations/ethonline-2026-integrations.md) records
transaction links and configuration. A real Chrome session completed Privy email
OTP login, created an embedded wallet, signed the faucet proof, received test
funding, approved WETH, bought FUEL, launched identity #3444, recovered that Launch
after a deliberate reload, and claimed 0.996651576817566284 AAPLc.

- [Launch receipt and decoded event](privy-launch.json)
- [Claim receipt and decoded event](privy-claim.json)
- [Application reward-funding API response](reward-funding-api.json)
- [Graph query and receipt evidence](../../../subgraphs/orbit-market/evidence/privy-trade.json)

Recovery rejected an unrelated purchase hash before accepting the matching
Launch hash. It confirmed the existing transaction without submitting again.
Canonical block-height/hash validation and final receipt revalidation are also
covered by automated adversarial tests.

A separate real WalletConnect peer connected and disconnected through Privy.
Signing and transaction requests were disabled for that peer. Browser fixtures
exercise external-wallet application states; they reject embedded operations and
do not stand in for the live email journey.

## Boundaries

Graph is an optional analytics source. Existing SQLite history and block-pinned
ownership/claim reads remain authoritative. The standard market query executes
against the deployed ORBIT subgraph; attempts against external reference
providers failed or timed out, so cross-provider execution is not claimed.
Test assets have no economic USD value.

The entrant still needs to record the human-narrated demo and submit the project
and Uniswap feedback form. No award eligibility or outcome is guaranteed by this
audit.
