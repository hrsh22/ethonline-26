# Collector read lifetimes

Known-identity reads, market quotes and reward-route quotes now use the same scoped transport as wallet/public reads. Each logical read has an eight-second overall deadline, including retries and response-body handling. Navigation or a changed query key aborts that scope. RPC transports retain one retry, a five-second per-request timeout, batching, and the shared endpoint cooldown.

The market quote key follows the raw input. A changed amount detaches the previous quote immediately; the new read starts only after the existing 250ms debounce settles. The visible quote still belongs to the matching wallet and amount. A late result cannot enable review for an older input.

Only failed, visible active queries recover on a 30-second interval. Successful reads, hidden pages and obsolete observers do not acquire a standing poll. Receipt checks have a 30-second deadline, one transport retry, and a four-second polling interval. An unresolved submitted hash remains stored; automatic receipt recovery backs off from five to at most 30 seconds. Read or receipt recovery cannot resubmit a wallet transaction.

## Checked behavior

The targeted known-collectible and Exchange panel suites pass 37 tests. New checks show that removing a detail observer aborts its signal, a stalled detail read ends after eight seconds and then recovers without a click, and a recovered view makes no additional reads over the next simulated minute. Editing an amount after a quote starts aborts the first signal before the 250ms debounce, then requests only the new amount.

The deterministic read-attempt budget for a stalled detail followed by recovery is two logical reads over 98 seconds: the initial attempt and one recovery. Previously the detail hook had no overall deadline or automatic recovery. For an amount change while one quote is pending, the previous behavior left that quote's transport running; the current behavior aborts its scope immediately. Existing transport tests cover the shared 429 cooldown and per-request limits.

These are logical-read and cancellation measurements. Live HTTP request counts depend on multicall composition and provider responses; they are not a claim that the user's earlier MetaMask failure was proven to be HTTP 429. The complete collector browser journeys exercise the external RPC boundary before release. See [the constrained-network comparison](collector-performance.md) for measured idle-load HTTP counts.
