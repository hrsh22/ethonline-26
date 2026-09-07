# Collector startup measurements

The latest corrected measurements show public-home CLS falling from 0.2343 to 0.0008 and 50-holding Fleet CLS from 0.3510 to 0.0039. Fleet startup uses 19 RPC requests versus a baseline median of 54; wallet readiness remains about 6.8 seconds. See [corrected font fallback](#corrected-font-fallback) for the final build and evidence. Earlier measurements below retain their original build and scenario limits.

The original September 6 measurements compare production builds against the same isolated browser fixture. They measure a returning collector's initial Fleet and Trade loads without a click, quote request, or transaction during the measured window. The wallet holds Grounded Craft #42, 1 FUEL, 5 WETH, and 5 ETH, all fixture values.

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

The original September 6 benchmark covers one held Grounded Craft and an idle Trade screen. The September 7 extension below adds disconnected home startup and a 50-holding Fleet. Physical-device wallet testing, unfamiliar-user sessions, and public-gallery interaction performance remain unmeasured. The fixture results cannot rule out production RPC-provider latency, rate limits, indexing delays, or mobile-wallet differences.

## September 7: disconnected home and 50 holdings

The same runner now accepts `--public` for disconnected home-page startup and `--fleet-50` for a returning collector holding Grounded identities #1–#50 backed by 50 fixture FUEL. Run each flag separately against each build. Both scenarios retain the viewport, network throttling, response delay, disabled HTTP cache, three independent contexts, and 15-second observation window above. The public scenario does not restore wallet storage or grant an account. The Fleet scenario restores the existing isolated wallet fixture. Unknown external requests remain blocked; neither scenario sends transactions.

Baseline remains `c16067c04bcfe5f08399a2de5a9b57077b9accef`, build `-oXMbP6E6hfUvQSrfJEEx`. The intermediate product source is `70bec034b52079f672578efd6d77f3f4fdb9a68d`, build `ub5jOfwbxL9nujZI-OHvB`. Both use Chromium `151.0.7922.34`. Production servers ran on isolated loopback ports 3131 and 3132, with all browser data served by fixtures. Browser and build workloads were stopped during measurement; a focused test ran only during a pause between scenario groups.

The baseline predates the public gallery. Therefore `/` compares disconnected home startup, not completion of the same gallery interaction. Public readiness means the main heading is present; it can precede FCP and does not establish hydration or wallet readiness. Fleet readiness means the first confirmed Inspect link is visible after collection reads. Rendering counts describe the initial page, not ownership totals.

Raw evidence: [public baseline](./collector-performance/2026-09-07-public-baseline.json), [public intermediate](./collector-performance/2026-09-07-public-current.json), [50-holding baseline](./collector-performance/2026-09-07-fleet50-baseline.json), and [50-holding intermediate](./collector-performance/2026-09-07-fleet50-current.json).

Medians of three samples; timings are milliseconds.

| Scenario           | Build        | RPC HTTP | Readiness | FCP |  LCP |    CLS |
| ------------------ | ------------ | -------: | --------: | --: | ---: | -----: |
| Home, disconnected | Baseline     |        6 |     671.3 | 748 |  748 | 0.2343 |
| Home, disconnected | Intermediate |        6 |     708.5 | 784 |  784 | 0.2976 |
| Fleet, 50 holdings | Baseline     |       54 |    6841.5 | 768 |  768 | 0.3510 |
| Fleet, 50 holdings | Intermediate |       19 |    6837.2 | 792 | 6788 | 0.2976 |

The 50-holding Fleet median RPC count falls from 54 to 19 (64.8%). Baseline counts range from 50 to 54 within the fixed window; every current sample has 19. Readiness remains about 6.8 seconds. Baseline renders 50 Inspect links; current renders 25, comprising its first page of 24 cards and the journey action. Thus the initial rendered content differs even though both fixtures contain 50 identities. These results do not measure scrolling through all 50 cards. As in the earlier single-holding scenario, the LCP element changes from the introductory paragraph to content shown after wallet restoration; the higher LCP is retained as a limitation.

The intermediate public-home build does **not** show an improvement: RPC requests stay at six and CLS rises from 0.2343 to 0.2976. All current home and 50-holding samples share a dominant initial mobile-header shift. In the recorded home trace, the wallet action wrapper changes from 343 × 92 px on a second row to 281.84 × 44 px on the first row at about 1.1 seconds; the content below moves from y=149 to y=56. A separate [header diagnostic](./collector-performance/2026-09-07-header-diagnostic.json) confirms the cause: the DOM remains the disconnected “Connect wallet” control while `document.fonts.status` changes from loading to loaded. Its computed 16 px font size, 25.6 px line height, 0.96 px tracking, and padding stay unchanged, but button width shrinks from 244.83 to 181.84 px when the font loads. The fallback font metrics cause the header reflow. This diagnostic is separate from the three-sample aggregates. The current build's 0.2976 CLS also exceeds the earlier September 6 single-holding sample; the newer results must not be represented by that earlier build's 0.0039 CLS.

These measurements establish two additional controlled startup scenarios. They do not establish physical mobile-wallet support, unfamiliar-user comprehension, real-provider capacity, or a public-release performance guarantee.

The September 7 files ending in `-current.json` preserve this intermediate build, including its header regression. The separately measured correction follows below.

## Corrected font fallback

The follow-up uses Courier New/Courier/monospace while JetBrains Mono loads, instead of the generated proportional fallback. Corrected product source: `60c43eab6e24f8c86f5b3151d68beb5b831cfae1`; production build ID: `VUTjVKCEc76BibtbJ3qU-`. A fresh production process loaded this build before measurement. The saved baseline remains unchanged; the corrected public and 50-holding samples use the same scenario flags and conditions.

The separate [corrected header diagnostic](./collector-performance/2026-09-07-header-final-diagnostic.json) starts with a 56 px header while fonts are loading and records no subsequent header-height change. Its fallback Connect button is 181.875 px wide, matching the previous loaded-font width closely enough to preserve the row layout. Diagnostic CLS is 0.0008; the sample is not included in the three-run aggregates below.

Raw corrected evidence: [public home](./collector-performance/2026-09-07-public-final.json) and [50-holding Fleet](./collector-performance/2026-09-07-fleet50-final.json).

| Corrected scenario | RPC HTTP | Readiness | FCP |  LCP |    CLS |
| ------------------ | -------: | --------: | --: | ---: | -----: |
| Home, disconnected |        6 |     671.3 | 748 |  748 | 0.0008 |
| Fleet, 50 holdings |       19 |    6786.8 | 756 | 6784 | 0.0039 |

The corrected public home retains six RPC requests and the baseline’s 748 ms median LCP, while CLS falls from 0.2343 to 0.0008. The corrected 50-holding Fleet retains 19 RPC requests and roughly 6.8-second data readiness, with CLS falling from the baseline’s 0.3510 to 0.0039. Its 6.784-second LCP remains a limitation caused by later, larger content. These results support the font fallback correction and bounded startup reads for the measured scenarios; they do not establish faster wallet readiness or replace the remaining physical-device and unfamiliar-user gates.
