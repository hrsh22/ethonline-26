# Collector browser journeys

The existing browser matrix includes seven transaction journeys and the public
collection/share route. Run a focused case against the release build with:

```sh
pnpm --dir apps/web test:browser --only=collector-journey:launch-reload
pnpm --dir apps/web test:browser --only=public-collection:explore-and-share
```

| Case suffix         | Visible acceptance                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `funding-discovery` | One top-up request survives a service outage and page reload; funded wallet buys; delayed Discovery remains visible until the craft arrives.                                |
| `launch-reload`     | One Launch survives reload; the Orbiter remains in Fleet while indexing lags, and the success notice retires on navigation, and completed activity survives another reload. |
| `receipt-recovery`  | A submitted hash survives receipt RPC failure, then confirms automatically with one wallet submission.                                                                      |
| `trade-stages`      | Wallet cancellation does not submit; native ETH buy, WETH approval/buy, and FUEL sell send the reviewed direction and exact input.                                          |
| `approval-reload`   | Reload after approval submission confirms only that approval; a swap occurs only after a fresh explicit review.                                                             |
| `partial-rewards`   | Unavailable rewards remain explicit; claim review includes only known identities and separate token amounts; its submitted ABI batch matches that review and confirms.      |
| `quote-recovery`    | Editing cancels an outstanding quote transport; a 429 recovers to the latest amount with at most four quote HTTP requests, then navigation works.                           |

The opt-in `transacting` wallet is an isolated EIP-1193 fixture. It returns dummy
proof bytes and sends transaction payloads only to a reserved `.invalid` URL
intercepted by Playwright. It has no private key, extension, or real broadcast.
Ordinary browser fixtures still reject signing and transaction methods. ABI
reads, receipts, funding status, and history are controlled at HTTP boundaries;
the actual client provider, caches, persistence, and screens run normally.

Case JSON includes RPC HTTP requests, quote HTTP requests and cancellations,
wallet submissions, and funding requests. Total RPC counts cover the whole
journey, including confirmation/reconciliation; they are not an idle-load or
constrained-network benchmark. Quote counts have an asserted four-request budget.
The shared accessibility, focus, viewport, and numeric-input checks run after
each journey. Funding restart/idempotency itself is verified by service/API
tests; the browser fixture exercises the corresponding outage and recovery.

During implementation, Launch reached its confirmed detail but lost its Fleet
card after reload with index lag. The browser check failed before bounded
identity reconciliation hints were persisted, then reached the card after that
fix. The rendered-style check also caught Fleet's `text-base` resolving below
16px; explicit input sizing addresses that failure. Receipt, funding and reward
fixtures were corrected where wire schemas were incomplete; those fixture
failures are not evidence of application regressions. Existing targeted
provider/hook/service tests supply their own regression evidence.

A real mobile-wallet smoke check has not been performed. Device, OS/browser,
wallet/version, network, result and limitations must be recorded separately;
375px Chromium is not a physical-device wallet result. The final production matrix passed 109 cases, including these seven journeys;
the browser harness passed all 17 self-tests.
