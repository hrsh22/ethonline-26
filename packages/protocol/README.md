# Protocol application module

`@orbit/protocol` is the single application and operator-console boundary for contract reads and wallet transaction preparation. Consumers select one schema-v2 deployment manifest and one product identity, then create a manifest-bound reader:

```ts
const transport = makeViemProtocolTransport(publicClient, manifest, identity);
const indexed = createIndexedHistoryReaders({
  fetcher: fetch,
  identity,
  manifest,
});
const protocol = createProtocolReader({
  manifest,
  identity,
  transport,
  history: indexed.protocol,
});
```

Pages consume `readWallet`, `readHealth`, `quoteExactInput`, `readRecentOperations`, and the reader's manifest-bound `prepareTransaction`. They do not import contract addresses, ABI fragments, event topics, unit conversion, role arithmetic, or health invariants. Public health, quotes, and bounded operational history do not require a connected wallet. Capabilities come from roles observed at the same block, never from UI configuration alone.

Wallet ownership scans remain bounded direct reads because they are wallet-specific point-in-time
inputs. Shared Canonical Market and protocol history instead enters through `MarketHistoryReader`
and `ProtocolHistoryReader`. The public application uses the manifest-bound indexed HTTP adapter,
whose pages expose requested coverage, indexed-through block/time, head lag, stable cursors, and
complete/partial/error state. Browser memory and a public DEX website are not durable stores.
The viem history scanner remains only as a non-browser diagnostic fallback while tooling migrates;
it is not the public source of truth. Failed transaction attempts emit no canonical event, so the
operator continues to obtain that bounded safety state directly; the browser does not promote
successful indexed events into failed-attempt evidence. Multicalls, bytecode reads, and market
state continue to pin current domain snapshots to one observed block and preserve secondary
failures explicitly.

Prepared transactions include their manifest-selected target and ABI. Preparation fails before a wallet prompt for wrong-chain state, expired quotes/deadlines, invalid collectible ownership or claim eligibility, missing onchain roles, invalid operator inputs, and setup mutations rejected by launch sealing.

Stock Reward quantities remain labelled as raw token units. The module never presents them as guaranteed underlying-share counts.
