# Collector startup measurements

These measurements compare production builds against the same isolated browser fixture. They measure a returning collector's initial Fleet and Trade loads without a click, quote request, or transaction during the measured window. The wallet holds Grounded Craft #42, 1 FUEL, 5 WETH, and 5 ETH, all fixture values.

## Method

Run `node apps/web/browser/collector-performance.ts http://127.0.0.1:PORT OUTPUT.json` from the repository root against an independently started production server. The runner uses the existing collector ABI/RPC and history fixtures. Unknown external requests are blocked; no live chain, funding service, or wallet is used.

Both builds use Chromium, a 375 × 812 viewport, 150 ms network latency, 200,000 bytes/s download, and 93,750 bytes/s upload. Mocked external responses also receive a fixed 150 ms delay because intercepted responses do not traverse a real network. Each sample starts in a fresh browser context with HTTP cache disabled. The existing wallet chooser establishes wallet restoration storage before measurement; `orbit:*` observation/activity caches are removed. The isolated wallet fixture grants the same account before hydration. No wallet submission or user interaction occurs during measurement.

There are three samples per route. RPC HTTP requests and individual JSON-RPC methods are counted for 15 seconds from document navigation. A populated Fleet Inspect link or the spendable-WETH Max button marks wallet-data readiness. FCP and LCP come from browser performance entries. CLS uses the maximum layout-shift session window, with a one-second gap and five-second maximum duration, excluding recent-input shifts.

These are controlled local measurements, not production telemetry or an SLA. Rendering timings include hydration, wallet restoration, and fixture reads. Three samples characterize this scenario; they do not establish performance for large collections or every mobile wallet. Physical-device and unfamiliar-user checks remain separate.

## Builds and evidence

Baseline source: `c16067c04bcfe5f08399a2de5a9b57077b9accef`, built in an isolated checkout with an offline dependency install. Production build ID: `-oXMbP6E6hfUvQSrfJEEx`.

Raw baseline samples: [2026-09-06-baseline.json](./collector-performance/2026-09-06-baseline.json).

Measured implementation source: the working tree following that baseline, production build ID `D2HLUP1rVgZzn7vxtlqQ-`. Raw current samples: [2026-09-06-current.json](./collector-performance/2026-09-06-current.json). Chromium version: `151.0.7922.34` for both builds. No other browser workload or build ran during either measurement.

The later mobile-navigation correction removes input-focus-driven hiding. It changes interaction behavior outside this no-input measurement window; these samples retain their original measured build ID and are not presented as a new run on that subsequent build.

## Results

Medians of three samples per route; timings are milliseconds. All three samples had the same RPC count and CLS within each route/build.

| Route | Build    | RPC HTTP | Wallet-data ready | FCP |  LCP |    CLS |
| ----- | -------- | -------: | ----------------: | --: | ---: | -----: |
| Fleet | Baseline |       46 |            6825.1 | 756 |  756 | 0.3510 |
| Fleet | Current  |       19 |            6825.3 | 788 | 6764 | 0.0039 |
| Trade | Baseline |       42 |            6824.8 | 752 |  752 | 0.1288 |
| Trade | Current  |       19 |            6822.5 | 792 |  792 | 0.0373 |

Startup RPC HTTP requests fell 58.7% on Fleet and 54.8% on Trade. Each current sample contains two `eth_blockNumber`, seven `eth_call`, six `eth_chainId`, one `eth_getBalance`, two `eth_getBlockByNumber`, and one `eth_getCode` requests. The raw files retain baseline method counts. No sample submitted a transaction or made an unsupported fixture request.

Stable mobile status rows and Fleet loading geometry substantially reduced layout movement in this scenario. Wallet-data readiness did not materially improve: it remains about 6.8 seconds under these fixed conditions. These results do not establish that the whole app renders faster.

Fleet's LCP increased because the largest painted element changed. A separate baseline diagnostic identified the static Fleet introduction as its LCP element. Current samples identify the new optional-Launch explanation, which appears after wallet restoration and ownership reads. Its 6.764-second median remains a visible-content delay; it is not removed from the measurements or described as an LCP improvement. Trade's LCP remains its static introductory paragraph.

Opened wallet connection help also passed viewport bounds checks at 375 px in the header and page body, and at 1440 px in the desktop rail. The body explanation was checked after ordinary document scrolling brought it into view.

## Remaining scope

This benchmark covers one held Grounded Craft and an idle Trade screen. Comparable public-exploration and 50-holding measurements are still outstanding, as are physical-device wallet testing and unfamiliar-user sessions. The fixture results cannot rule out production RPC-provider latency, rate limits, indexing delays, or mobile-wallet differences.
