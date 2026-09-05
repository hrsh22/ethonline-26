# Authenticate the admin boundary

Status: accepted on 31 August 2026 for the Base Sepolia proof of concept.

## Context

Contract state and canonical events are public on Base Sepolia, but the application also assembles
that evidence with offchain Keeper state, deployment expectations, operational failures, and
unbroadcast commands. Treating those different sources as one public status payload reveals more
operational detail than a collector needs. Conversely, hiding public chain evidence behind a
wallet session would imply confidentiality that the chain cannot provide. Client-side wallet
checks cannot protect either server-rendered admin routes or their data requests.

## Decision

Classify data at the server boundary by source and purpose:

| Classification             | Sources and examples                                                                                                                                                                                                                                                 | Boundary                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public onchain evidence    | Block-pinned contract roles, pauses, balances, queues, reward liabilities, Canonical Market state, transaction receipts and logs, plus canonical indexed swaps, fees, liquidity cycles, permanent commitments, Reward Epochs, conversions, notifications, and claims | May remain available through exact public routes, direct RPC, and explorers. It must never be described as confidential.                                                                                                                        |
| Public sanitized aggregate | Bounded liveness/readiness, Historical Read Model coverage, funding availability, and the public `/status` summary of onchain health, freshness, collection counts, destination-locked fund totals, and canonical reward activity                                    | Contains only approved fields. It omits role and deployment ledgers, dependency errors, Keeper attempts, cycle generations, failure classes, retry state, and command or audit state.                                                           |
| Authenticated diagnostic   | The curated operations composite, Keeper-attempt journal, exact dependency failures, expected-versus-observed deployment and role ledgers, operational timelines, and detailed queue, accounting, and funding drill-downs                                            | Requires a current authorized server session even when an individual fact inside the synthesis is independently public onchain.                                                                                                                 |
| Authenticated command data | Proposed action intent and simulation, slippage and deadline review, unbroadcast transaction state, session and CSRF metadata, and any future desired mode, command, pending-transaction, failure, or audit record                                                   | Requires a current authorized server session. Every mutation also requires CSRF validation and its exact current action role. Current protocol transactions remain wallet-to-contract and retain contract authorization as the final authority. |

Worker bearer tokens, deployer or funding-signer keys, and server-side session and CSRF verifier
secrets are secrets rather than members of an exposure class. They are never returned to or logged
for a browser. The opaque session token is returned only as an `HttpOnly` cookie; the session's
request token for CSRF validation is authenticated command data.

The public sign-in route lives outside the protected admin layout. Its EIP-4361-compatible
challenge binds the configured domain and URI, Base Sepolia chain `84532`, the full selected
deployment fingerprint, address, nonce, issued time, and expiry. The server compares every bound
field, consumes a nonce atomically, rejects expiry and replay, and verifies both EOA and ERC-1271
signatures. Signature verification and live role reads use one block-pinned view.

The VM API owns the challenge, short-lived session, revocation, and authorization policy. Challenge
lifetimes are configured within 60–600 seconds. Before prompting a wallet, the browser rejects
challenges outside that interval, challenges older than the maximum lifetime, and issue times more
than 30 seconds in its future. That narrow allowance covers ordinary API/browser clock skew without
weakening the API's exact-message verification authority. The
session is an opaque cookie with `HttpOnly`, `SameSite`, and `Path=/`; it is host-only and `Secure`
outside loopback development. Fixed, credential-free, same-origin Next.js route handlers may relay
only authentication and protected-admin requests so the web origin can hold that cookie. They are
not a generic proxy and receive no worker credential. Every protected API route independently
returns fixed `401` or `403` responses, sends `Cache-Control: private, no-store`, validates CSRF on
mutations, and rechecks the deployment fingerprint and current block-pinned roles before returning
data or authorizing an action. `/admin`, every nested route, and each protected data seam perform
the same check before protected shell rendering or data fetching; a layout check alone is not the
security boundary.

Visibility and mutation authority are separate:

| Live principal                            | Console and diagnostics | Authorized action                                    |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------- |
| FuelCore owner                            | Read                    | Pause or resume FuelCore only                        |
| RewardLedger owner                        | Read                    | Pause or resume RewardLedger only                    |
| EpochConverter owner                      | Read                    | Pause or resume EpochConverter only                  |
| ProtocolLiquidityVault owner              | Read                    | Pause or resume ProtocolLiquidityVault only          |
| Keeper                                    | Read                    | Open a Reward Epoch; execute or retry a Reward Track |
| ProtocolLiquidityVault liquidity executor | Read                    | Execute Protocol-Owned Liquidity only                |
| FuelCore guardian                         | Read                    | None in the current console                          |
| Current recovery signer                   | Read                    | None in the current console                          |
| Creator alone                             | Denied                  | None                                                 |
| Any other wallet                          | Denied                  | None                                                 |

For the Base Sepolia threshold recovery contract, the current recovery principals are its live
`signerOne` and `signerTwo` values, not the recovery contract address. A principal with multiple
roles receives the union of those roles, so a creator who is also the Keeper enters as Keeper,
never by virtue of being creator. Sealed Reward Track configuration is not exposed as an admin
command.

Account, chain, deployment, disconnect, logout, expiry, and live role changes clear protected
client state and invalidate access before the next protected read or action. Public `/status`
continues to load raw canonical reward history and current onchain aggregates, but it neither loads
Keeper-attempt history nor sends unauthenticated users toward protected diagnostics.

## Narrow supersession of ADR 0010

This decision supersedes ADR 0010 only where that ADR maps
`GET /v1/history/protocol/operations` and
`GET /v1/history/protocol/keeper-attempts` as public routes, and where it requires every browser
request to bypass same-origin Next.js route handlers. Those detailed feeds move behind the
authenticated diagnostic boundary, and the fixed credential-free relays described above are
permitted for authentication and protected admin data.

ADR 0010 remains authoritative for the public raw-onchain and sanitized routes, exact allowlists,
the prohibition on wildcard forwarding, loopback-only workers, server-only worker credentials,
and the VM-owned API. This decision also preserves ADR 0009's manifest, persistence, canonicality,
cursor, and single-writer requirements. In particular, canonical reward history remains public;
only the curated operations composite and Keeper-attempt detail change classification.

## Consequences

Collectors retain useful, independently verifiable public status without receiving offchain
operator detail. Operators must sign in before any admin shell or diagnostic request is served,
and losing a live role takes effect on the next protected seam rather than at session expiry.
Same-origin relays return for this narrow cookie-bearing interface, but Vercel still holds no
history-worker, Keeper, funding-worker, operator, deployer, or signer credential.
