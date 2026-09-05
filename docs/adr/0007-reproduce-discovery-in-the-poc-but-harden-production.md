# Use asynchronous verifiable discovery on Base Sepolia and in production

Superseded in part by [ADR 0014](./0014-separate-discovery-randomness-from-finalization.md): one VRF seed now covers an acquisition batch, the callback stores randomness only, and retryable finalization replaces callback-atomic minting and eight-word request chunks.

Base Sepolia and production use Chainlink VRF v2.5 asynchronous randomness. Crossing one or more whole-token boundaries records opaque Pending Discoveries in the acquisition transaction; it does not select or mint an identity. An independently verified coordinator callback later assigns the final identities without replacement and mints them atomically. Up to eight discoveries share one bounded VRF request, while FuelCore's 64-mutation transfer limit is split across bounded requests.

The Liquid Token remains tradable while discovery is pending, but the unseen collectible cannot be committed or transferred as an NFT. Losing the corresponding whole unit cancels the request, and its later result is ignored without being exposed to the seller. This prevents a wallet simulation or buyer contract from observing an assigned identity, rejecting the acquisition, and retrying for a preferred identity while avoiding a temporary token lock.
