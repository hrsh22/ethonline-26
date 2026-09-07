# Collector delivery progress

Fleet and Start use the current wallet's Pending Discovery and first batch
observation. The card distinguishes awaiting randomness, the 15-minute randomness
delay, verified randomness, and delayed finalization. Counts say **processed**:
`finalizedCount` can include cancelled slots and is not a delivered-identity count.
Elapsed time advances locally once a minute; it does not add RPC polling. Last
checked shows the wallet observation time. Service messages reuse the shell's
shared, expiring public delivery status.

The shell saves the latest observed request ID under the deployment and wallet.
This is a read-only reference, not authorization to send a transaction. It remains
after navigation/reload, including when the request is no longer pending. Storage
failure leaves current observations usable. The bookmark contains no signature,
key, raw transaction, or inferred identity.

## Correlated outcomes

The existing history index now tracks each FuelCore request, fulfilment, and
cancellation. Its account-filtered page links the acquisition transaction to the
bytes32 protocol request and exact terminal identity or cancellation. Numeric VRF
batch references remain distinct. Fleet and Start share a bounded cached HTTP
page; only shell activity owns its 15-second recovery refresh, paused by the query
client when hidden. Complete settled history stops polling. Confirmed actions and
wallet synchronization transitions trigger a fresh shared read. No history card polls chain RPC.

A revealed identity becomes a delivered card only after current complete wallet
ownership also includes it. When ownership lags or has moved, the recorded delivery
remains explicit without claiming the wallet still holds it. Cancelled backing
shows an explicit terminal cancellation. Page truncation and partial indexing are
visible; absence is never treated as a terminal outcome. Old databases replay once
through the normal bounded synchronizer to backfill the newly tracked events.

## Launch completion

A confirmed `commit-collectible` operation retains its affected identity in the
existing transaction journal. Until current complete permanent-ownership evidence
includes that identity, activity says the Launch receipt is confirmed and collection
synchronization is still in progress. Once verified, it shows the same identity,
permanent Orbiter state, 1 FUEL burn, Reward Track, and View Orbiter link.

Up to 20 confirmed actions are separately retained in the existing local activity
journal after dismissal or a newer action. This bounded device history is distinct
from canonical acquisition outcomes.

A 400 ms nonblocking fade and a polite announcement occur once for the latest
verified operation per deployment/wallet. The seen-operation marker survives
remounts. Reduced motion renders the final state immediately. If storage cannot
save the marker, the final state remains visible without replayable animation.

Targeted component tests cover partial processing, stopped service, delayed
randomness/finalization, ownership synchronization, retained request scope, and
one-time/reduced-motion completion. The integrated browser matrix owns actual
purchase-to-delivery and Launch/reload validation; manual review still evaluates
motion quality and mobile-wallet presentation.
