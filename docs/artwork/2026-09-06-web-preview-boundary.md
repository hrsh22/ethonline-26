# Web artwork and canonical metadata

The public gallery and craft pages draw deterministic SVG illustrations from the identity number. Ordinary craft preserve their hull, fins, ports, engines and assigned track bands through Launch. Panel seams and docking details are decorative. Relics have original fictional stories, solar-cell details and a labeled Grounded/Orbiter appearance preview. Preview controls never call the wallet or change protocol state.

The selected ORBIT identity adapter continues to supply brand, collectible names and Reward Track labels. The Relic stories apply only to that identity. The three Stations remain Basket Relics and the Observatory remains the Indicator Relic; narrative roles add no properties to the collection manifest.

## Checked canonical record

On 6 September 2026, a read-only `tokenURI(1639)` call against the staging Base Sepolia collection contract `0x441F6f786c8E9d3EEc16748e55Ee32626d1F93DA` returned:

- Name: Orbiter #1639.
- Image: `placeholder://orbit-4444/orbiter`.
- Reward Track: METAc; Rarity Tier: I; Reward Weight: 1; ordinary collectible.
- Description explicitly identifies placeholder artwork and valueless Base Sepolia test assets.

The published deployment record lists placeholder image locations for all four collectible kinds and sealed metadata. The deployed placeholder renderer initializes its image locations in its constructor and exposes no update function. The web illustration is therefore not the image an external NFT wallet can resolve from this record. An empty wallet thumbnail is expected with this placeholder URI; it is not evidence that ownership disappeared.

ADR 0005 freezes the selected production identity and metadata. This work changes web illustrations only. A deployment with usable canonical artwork requires a separately authorized deployment or migration and its own metadata review. No existing sealed image location, contract, identity assignment, reward weight or owner was changed.

## Public and shared previews

Eight homepage examples use the shipped collection manifest and local SVG geometry. Links disable prefetch, and cards do not query ownership or wallets. Opening a detail page performs the existing scoped read. Sample appearances are illustrative and are not offered as selectable Discovery Draw outcomes.

Identity Open Graph and Twitter images use the same deterministic ordinary hull generator, simplified at social-card scale. Relic silhouettes preserve the corresponding station-array count or telescope aperture. Images show only stable identity number, assigned track/tier or Relic kind, network, and preview disclosure. They never publish a live owner, claimable reward amount, or assertion that the illustrated state is current. Next caches each generated PNG for one day. No RPC request is required to render an image.

## Verification and remaining review

Manual Chrome checks covered all eight gallery examples at desktop and 375px width, invalid lookup feedback, disconnected lookup of #1639, public copy feedback, manifest-derived wallet import details, and Relic preview switching. At 375px the gallery had no horizontal overflow. Ordinary, Station and Observatory social images returned HTTP 200 PNG responses of roughly 46–51KB; the ordinary card was visually inspected at 1200×630. The gallery includes the four ordinary hull families, and the existing before/after specimen retains the same identity through Launch.

The public collection browser journey checks lookup, disconnected navigation, repeated PNG output, native sharing success/cancellation, unsupported sharing, and the manual URL fallback after clipboard failure. The release browser matrix remains the integration boundary.

An unfamiliar-human recognition/comprehension session and actual mobile-wallet image rendering have not been performed. They remain public-release review gates; the checked canonical placeholder URI prevents claiming web/wallet artwork parity. Do not describe this deployment's canonical artwork as finished production metadata.
