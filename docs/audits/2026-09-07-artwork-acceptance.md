# Artwork acceptance review, 7 September 2026

This is an agent-led review of issue #48 against `cd9b84d` and the small plume correction below. Two agents inspected rendered specimens; the second received only the images before describing the shapes. Neither result is an unfamiliar-human recognition study. No physical NFT-wallet image comparison was performed in this review, and the original acceptance wording is unchanged.

## Rendered artwork

The actual `CraftArt` component was server-rendered in an isolated checkout and rasterized with Chromium at device pixel ratio 1. Specimens use the application’s actual dark-surface, line and accent colors, at 64, 128 and 320 CSS pixels, with Grounded and Orbiter appearances beside one another. These are component contact sheets, not wallet screenshots or captures of live ownership. Fleet normally caps art at 160px and the detail portrait at 256px with the default root font; the sheets also inspect a larger size.

- [Seven ordinary identities, both appearances and three sizes](artwork-acceptance/ordinary.png).
- [All four Relics, both appearances and three sizes](artwork-acceptance/relics.png).

| Ordinary identity   | Recognizable shape                     | Finding                                                                                                                                                               |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #23, #3021          | Tug, with stepped neck and shoulders   | Distinct from the smooth and pointed families at 64px.                                                                                                                |
| #208                | Broad wedge with triangular nose       | The broad silhouette survives reduction to a thumbnail.                                                                                                               |
| #710                | Rounded capsule nose and parallel hull | Clear at card/detail sizes; nose differences from a narrow craft are subtler at 64px.                                                                                 |
| #1204, #1639, #4179 | Narrow, pointed needle                 | Fins, antenna, ports and engine arrangement distinguish specimens within this family. Tiny internal seams are decoration, not a thumbnail identification requirement. |

The second agent identified the same four shape families without source or story prompts. Across Grounded/Orbiter pairs, hull, fins, ports, engines, antenna and track bands retain their position. Orange illumination and the engine plume communicate the ordinary craft’s changed appearance. The image number and current-state label remain the authoritative identifiers; decorative differences do not encode an invented reward multiplier.

| Relic                | Thumbnail distinction                            | Story and protocol boundary                                                                                               |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| #4441, Station One   | One rectangular array on each side of a hub      | Night-side berth and first light. Fictional setting; one-third of the collective 12.5% Basket Relic allocation per track. |
| #4442, Station Two   | Two arrays on each side                          | Crossing point and departure checks. Same allocation as the other Stations.                                               |
| #4443, Station Three | Three arrays on each side                        | Outer traffic lanes and returning craft. Same allocation, despite having more illustrated arrays.                         |
| #4444, Observatory   | Upright telescope, open aperture and curved dish | Gathering distant light and maintaining a connection home. Separate 5% Indicator Relic allocation per track.              |

Both agents could distinguish the array counts at 64px and immediately separate the Observatory. The three Stations intentionally read as variants of one satellite family, not unrelated objects. Relic state previews rely mainly on illumination, so the explicit Grounded/Orbiter text and pressed-state semantics matter. Preview controls say “Preview only. No transaction.” Stories and the “About this artwork” disclosure explicitly separate fiction and decoration from reward properties.

## Concrete correction

| Before                                                                                                                                                                                    | After                                                                                                                  | Why                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Some ordinary plume vertices extended beyond the 120-unit SVG canvas. For example, #1 reached 121.6; #23 visibly ended at the canvas edge. [Before](artwork-acceptance/plume-before.png). | Plume depth now fits inside the same canvas with a two-unit lower margin. [After](artwork-acceptance/plume-after.png). | Stops clipping while preserving the craft’s identifying geometry and existing viewBox. |

The regression failed on the previous renderer and now checks every ordinary identity, #1–#4440, for plume coordinates within the canvas. All seven existing/new value-and-art tests pass; targeted ESLint passes. Comparing the 42 ordinary SVG specimens before and after correction showed every non-plume element unchanged. No collection assignment, reward calculation, ownership rule or metadata contract changed.

## Canonical metadata evidence

Fresh read-only calls used Base Sepolia block 46,509,487 and the mirror at `0x441F6f786c8E9d3EEc16748e55Ee32626d1F93DA`. [Decoded token URI evidence](artwork-acceptance/canonical-metadata.json).

| Identity    | Canonical result                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| #1639       | Orbiter; METAc; Tier I; weight 1; `placeholder://orbit-4444/orbiter`.                                                   |
| #4179       | Orbiter; NVDAc; Tier II; weight 1.5; the same Orbiter placeholder URI.                                                  |
| #4441–#4444 | Mirror `tokenURI` reverted with `UnknownIdentity(uint256)`, so these calls do not establish a held NFT or wallet image. |

At block 46,509,525, `launched()` returned true and the mirror’s renderer address matched `0xb466c469b161149E7AFA4A357d7fC47867bB3429`. [Renderer-only evidence](artwork-acceptance/renderer-metadata.json) for hypothetical permanent Relics returns Station 1/2/3 or Observatory, All Reward Tracks, Special tier and their Station/Observatory placeholder URI. Those renderer calls are descriptive previews, not ownership evidence. Relic weight 0 in this placeholder metadata is not an ordinary-weight allocation rule; the application correctly explains their separate reserved allocations.

`FuelCore.setMetadataRenderer` rejects changes after launch. The deployed placeholder renderer initializes image locations in its constructor and exposes no image updater. This deployment therefore cannot adopt the web SVG images through its existing permitted metadata mechanism. ADR 0005 requires a separately authorized deployment or migration for a different frozen production identity. None was performed.

The app’s import/help copy warns that web artwork is an illustration and sealed metadata uses placeholders. Prior actual Chrome explorer evidence for #1639 is documented in [the existing metadata boundary review](../artwork/2026-09-06-web-preview-boundary.md): empty image and cached Grounded name while fresh tokenURI and app reported Orbiter. That prior explorer observation is not presented as a new visit here. `placeholder://` is not a usable public image URL, so this review cannot claim web/wallet image parity or finished canonical production artwork.

## Semantics, motion and cost

Standalone art exposes a named image; art beside the matching identity is hidden from the accessibility tree. Existing tests cover both. Relic previews use a normal button with `aria-pressed`; the existing browser journey verifies reduced-motion transition behavior. The final production browser run is the integration check for the current combined branch, rather than treating these isolated specimens as a full application test.

The inspected ordinary SVG strings were 1,648–2,525 uncompressed bytes; Relics were 809–1,899 bytes. These are markup sizes, not page-network or performance measurements. Rendering the sheets made no RPC calls. The homepage uses eight local deterministic examples, reserved square art space and native content visibility on artwork only; cards disable route prefetch. Social previews are separate cached PNGs built from stable manifest traits, with illustrative-state disclosure and no owner or claimable-balance assertion.

The remaining limits are explicit: these are agent judgments, not unfamiliar-human results; physical-wallet image presentation was not inspected; and the sealed placeholder deployment cannot provide matching canonical art. This review supplies the achievable visual and metadata evidence without marking those distinct requirements complete.
