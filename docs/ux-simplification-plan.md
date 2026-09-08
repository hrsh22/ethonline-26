# ORBIT collector experience: simplification proposal

Status: B · Hangar selected and implementation authorized by the user, 8 September 2026. Implemented through the existing provider and transaction seams; see `ux-implementation-brief.md` for the implementation contract and verification. The proposal below preserves the design rationale; the selected Hangar replaces the initial grid sketch.

## Direction

Keep ORBIT's space/craft identity. Make discovering, owning, and optionally launching craft the center of the experience. The user explicitly welcomes drastic UX changes and likes Quotrons' visual personality and collectible focus.

The collector should be able to answer: **What is this? What do I own? What can I do?** Protocol accounting belongs in supporting views, and transaction consequences belong beside the relevant decision. There is no onboarding ladder or first-Orbiter completion goal.

## Findings and reference

Reviewed the live [Quotrons home](https://www.quotrons.cash/), [My Desk](https://www.quotrons.cash/desk), and [Exchange](https://www.quotrons.cash/exchange), alongside the local ORBIT home, Start, Fleet, Trade, Rewards, and an identity detail. Compared Fleet/My Desk at 390px and desktop pages at 1280px. No wallet was connected and no transactions were performed; connected behavior was reviewed in source. The local wallet shell intermittently displayed connecting while page panels displayed disconnected, so screenshots are not evidence of a completed wallet session.

Quotrons' strengths are its tangible hardware identity, consistent presentation, recognizable dark/lit transformation, and a short disconnected My Desk state. Its ten navigation destinations, ticker, extensive home metrics, and busy exchange are not simplification targets to reproduce.

ORBIT's main friction is structural:

- Nine desktop navigation destinations compete before the user starts (`src/lib/navigation.ts:20`).
- Home combines three hero actions, a specimen, a gallery, census, fee accounting, reward liabilities, and onboarding (`src/app/(collector)/page.tsx:20`).
- Fleet puts global collection facts and explanatory samples before the disconnected wallet action; the connected summary has six metrics (`src/components/fleet/fleet-panel.tsx:106`).
- Rewards separates wallet balances and claims into repeated access states and follows the claim flow with funding mechanics (`src/components/rewards/rewards-panel.tsx:568`).
- Craft cards repeat consequence and observation copy beneath each object (`src/components/fleet/fleet-craft-card.tsx:118`).

Source paths above are relative to `apps/web/`.

## Proposed navigation

Desktop: ORBIT brand linking home, **Explore / Trade / My Fleet**, wallet/account control. Replace the persistent collector sidebar with a compact header. Mobile uses the same three destinations in a bottom bar; Help and account utilities stay accessible without occupying a primary tab.

| Existing surface            | Proposed destination          | Treatment                                                                                                       |
| --------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Home `/`                    | Home                          | Short product introduction, memorable craft visual, one primary collecting action, secondary Explore link       |
| Start `/start`              | Fixed redirect to My Fleet    | Remove journey/next-action orchestration; preserve old entry links without wallet-stage routing or return loops |
| Trade `/exchange`           | Trade                         | Chart and buy/sell form visible together; detailed history remains secondary                                    |
| Fleet `/fleet`              | My Fleet                      | Personal craft grid, pending discoveries, rewards summary; Collection and Rewards subviews                      |
| Craft `/fleet/[identityId]` | Shared craft detail           | Reachable from My Fleet and Explore; use origin-aware back navigation                                           |
| Relics `/relics`            | Explore → Relics              | Dedicated visual feature within the public collection; retain a deep link                                       |
| Rewards `/rewards`          | My Fleet → Rewards            | Preserve direct access via redirect/subview and a claim shortcut; do not bury claim behind a generic menu       |
| Market `/market`            | Trade → Market                | Chart, history, market statistics; retain a deep link                                                           |
| Status `/status`            | Footer/Help → Protocol status | Keep public evidence and its availability independent of wallet connection                                      |
| Learn `/learn`              | Help → How it works           | Canonical explanations and detailed economics                                                                   |
| Faucet `/faucet`            | Get test funds                | Secondary testnet utility; Trade may link it on insufficient funds, without a collecting journey                |
| Admin                       | Existing protected area       | Preserve authenticated diagnostics and commands                                                                 |

Explore is a public catalog, not a storefront for selecting a Discovery result. A card opens its detail; the purchase CTA says Buy FUEL. State near that CTA that newly acquired whole units draw craft randomly. Use published previews when live identity state is unavailable and label that distinction once clearly; do not invent live ownership or availability. A full live catalog is a separate data requirement if current APIs cannot support it efficiently.

## Keep, simplify, relocate, remove

| Content or capability                                               | Decision                               | Proposed presentation                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Craft artwork, identity, grounded/permanent state                   | Keep and strengthen                    | Large object; one clear state label; reward token and tier as compact attributes                               |
| Buy, sell, Launch, claim, transfer                                  | Keep                                   | Contextual actions; transfer secondary but discoverable; review before any transaction                         |
| FUEL balance and next discovery threshold                           | Simplify                               | Balance plus a contextual sentence when fractional holdings matter; exact boundary effects in the trade review |
| Pending discoveries                                                 | Keep when relevant                     | Personal pending item, honest waiting/delayed state, reveal when resolved; never a fabricated craft            |
| Claimable rewards                                                   | Keep prominent                         | Amounts grouped by token and a Review claim action; clearly mark incomplete reads and claim batches            |
| Stock tokens already in wallet                                      | Relocate                               | Secondary Rewards section; distinct from unclaimed rewards                                                     |
| Collection-wide totals                                              | Reduce                                 | At most a small relevant summary on Home/Explore; detailed census on Status                                    |
| Fee split, reward allocation, protocol queues                       | Relocate                               | Explain economics in Help; current accounting in Status; total trade fee remains in the trade review           |
| Chart, volume, historical trades                                    | Simplify                               | Chart beside Trade form by default; detailed history/statistics expand when requested                          |
| Fund → Discover → Launch onboarding                                 | Remove                                 | No journey classifier, completion flag, or cross-page next-action controller                                   |
| Block number, routine delivery/health status                        | Remove from permanent collector chrome | Status view and expandable transaction evidence; surface an incident when it affects the current action        |
| Chain identifier `84532`                                            | Remove from routine labels             | Human-readable network name; exact ID in connection/support details                                            |
| Repeated educational cards and four identical allocation breakdowns | Remove duplicates                      | One canonical explanation with contextual links                                                                |
| Repeated Connect wallet prompts and disabled action panels          | Consolidate                            | One page-level access state; compact global wallet control                                                     |
| Raw units, router/pool JSON, support payload explanations           | Relocate                               | Details/Help when requested; copy support information in a recovery flow                                       |
| Testnet/no-value identification                                     | Keep concise                           | One persistent testnet label, reinforced in transaction review                                                 |
| Safety, stale/partial data, failed transactions                     | Keep                                   | Plain-language impact and next action, never raw exceptions or false zero values                               |

Removal here means removing UI clutter and duplicate presentation. Public evidence remains accessible and underlying protocol capabilities remain intact.

## Screen behavior

**Home:** a craft is the focal point, with a concise product description and direct Trade FUEL and Explore links. No sequential Buy → Discover → Launch tutorial. Cut the accounting dashboard and repeated gallery/specimen explanations. Browsing requires no wallet; details of each action belong where that action is taken.

**My Fleet:** disconnected users see one invitation and Connect wallet. An empty collection has fixed Explore and Trade links, regardless of funding or fractional balance. Show balances as facts, not a stage toward the first craft. Owners see their craft immediately, with All / Grounded / Orbiters filters. Pending discoveries appear only for the relevant wallet. Advanced track/rarity/ID filters live in a filter control. Rewards use a compact token summary and direct Review claim shortcut, with full detail in the Rewards subview. Launch is an optional craft action; holding and selling remain valid choices.

```text
ORBIT               Explore   Trade   My Fleet            Wallet

My Fleet                                  Buy FUEL
Collection   Rewards
Rewards available: amounts by token        Review claim

All   Grounded   Orbiters                  Search / Filter
[large craft]      [large craft]      [discovery pending]
#identity         #identity          Waiting for reveal
Grounded · token  Orbiter · token    See details
```

This sketch describes information order, not a finished composition. The reward strip appears only when useful; errors or partial reads replace certainty with a precise status.

**Trade:** the user explicitly chose chart and form together. Put the market chart on the left and the focused buy/sell form on the right on desktop. On mobile, use a compact chart above the form so both are present by default. Keep Buy/Sell, pay asset, amount, expected output, and one contextual action together. Keep asset selection explicit; it may suggest an asset the wallet owns but must not silently switch assets after input or review. Show the current pay-asset balance inline. Make fee, minimum received, meaningful price impact, and discovery/balance-boundary consequences clear before confirmation. Settings hold editable slippage/deadline details; technical evidence expands separately. Approval and purchase remain visibly separate stages. Detailed history can expand below the default chart and form.

**Craft detail:** large craft, identity, state, reward token, tier, and ownership-aware actions. A grounded owner can Review Launch; an Orbiter owner with available rewards can Review claim. Transfer is a labeled secondary action. Visitors see factual detail without owner-only actions. Technical records, exact weights, and explorer links are secondary. Launch review explicitly identifies the selected craft, says “Burns exactly 1 FUEL forever, plus network gas,” explains loss of fungibility, and says rewards are variable. Preserve explicit acknowledgement and current ownership checks; a pending discovery cannot launch. Success visually changes that same identity only after confirmation. Transfer review explicitly says unclaimed rewards move with an Orbiter.

**Rewards subview:** lead with verified claimable amounts by token. Keep per-craft attribution available, because unclaimed rewards travel with the identity until claimed by its current owner. Wallet-held tokens and protocol funds are separate concepts and must never be summed as a personal claimable total. Make batch size, included identities, and remaining claims clear when the protocol cannot claim everything in one transaction.

## Visual direction

Working direction: an ORBIT craft collection with the character of a spacecraft catalog. Keep dark graphite and orange as recognizable anchors. Spend the visual emphasis on craft silhouettes, identity-specific details, and the grounded/launched transformation. Use a quiet surrounding interface and larger, clearer type.

Initial palette for design exploration: space `#0E0F12`, hull `#20252B`, instrument `#343C45`, paper `#ECEBE6`, muted text `#A8B0B8`, ignition `#FF6A1F`. Validate actual foreground/background pairs before adopting them. Existing track/state colors must remain distinguishable through text and shape as well as color.

Use Barlow for readable body/headings and JetBrains Mono for identifiers and numeric values, subject to a font specimen review. Favor sentence case, left-aligned content, 16px body text, and generous spacing around decisions. Avoid putting every paragraph inside a bordered panel. Keep 44px touch targets, visible focus, keyboard operation, and reduced-motion support.

One signature visual moment: the same grounded craft becomes an Orbiter. User-driven preview can explain the change on Home; transaction success reflects real confirmation. Ordinary navigation and data refreshes stay calm. No ticker or decorative looping dashboard motion is proposed.

This deliberately revises the collector rules in `docs/design-foundations.md`: density 7/10, one mono face for every role, persistent left rail, and live-data-first page openings. Keep the operator's dense task layout. Share semantic states and accessible primitives while permitting different collector and operator composition. The identity adapter in ADR 0005 remains the copy/asset seam; protocol terms and economics remain unchanged.

## Delivery sequence after agreement

1. Review this content/navigation plan and settle any remaining screen priorities.
2. Produce desktop/mobile visual concepts for Home, My Fleet, Trade, and Launch review, including disconnected/empty/pending states. Evaluate real copy and object art before building the redesign.
3. Implement collector foundations and shell, remove onboarding orchestration, then My Fleet/craft detail and integrated Rewards, then Trade, then Home/Explore and utility relocation. Keep route compatibility and useful URL filters.
4. Update the design foundations and affected behavioral/browser checks to reflect the accepted design. Verify browse → fund if needed → buy → pending discovery → inspect → optional Launch → claim, plus sell/transfer consequences and interruption recovery.

No contract changes, economics changes, new marketplace, automatic transactions, or new reward mechanisms are part of this redesign.

## Acceptance criteria

- Three consistent primary destinations on desktop/mobile; Help, status, and test funding remain findable.
- No onboarding ladder, first-Orbiter goal, wallet-stage classifier, or cross-page next-action controller; each destination is directly usable.
- At 390×844, My Fleet's first viewport shows the collection/access state and useful next action, without global metrics preceding it.
- A new visitor can explain how a craft is obtained, that identity selection is random, and that Launch is optional and irreversible.
- A returning owner can inspect a craft and review a claim directly from My Fleet without navigating a separate top-level rewards product.
- There is one authoritative wallet/access state per page; no contradictory connecting/disconnected panels.
- No claimable total merges different token units, wallet holdings, or shared protocol funds. Unknown/partial data never becomes zero.
- Discovery waiting/delay/cancellation, stale quotes, insufficient funds, wrong network, rejected signatures, partial holdings, pending transactions, sell boundaries, and transfer ownership changes remain intelligible and recoverable.
- Browsing works disconnected; Launch/claim/transfer authorization and transaction review remain intact. No change to the public/admin data boundary.
- Keyboard, mobile layout, contrast, focus restoration, and reduced motion pass relevant checks; visual walkthroughs cover populated states as well as empty ones.

Open design decisions for the concept stage: exact typography/art treatment and whether larger collections need a persistent filter bar. Trade prominence is settled: chart and trade form are visible together by default, per the user's preference. This supersedes the earlier optional-chart recommendation.

## Concept-stage refinements

The design study compared Gallery (artwork grid), Hangar (one selected craft and a thumbnail selector), and Manifest (compact inventory with a detail pane). The user selected **B · Hangar**: one featured craft with a selector. This supersedes the initial Gallery recommendation and the earlier grid sketch; keep Hangar's selected-object hierarchy while ensuring the selector stays easy to use on mobile and with larger fleets.

The prototype runs in an isolated worktree on a local preview server, with representative URL paths and an explicit design-review toolbar. It contains sample data and simulated actions only. It is a design artifact, not a replacement for the application or evidence that wallet integration works.

The user explicitly rejected the entire Fund → Discover → Launch ladder, including a subtler replacement made from situational next actions. Remove `collector-journey.ts` orchestration and journey-only consumers/tests once dependencies are checked; retain shared transaction checks at their actual callers. Do not maintain multiple onboarding stages. Connection, insufficient funds, pending discovery, and stale ownership remain ordinary operational facts, not progress toward completion. This supersedes the earlier contextual-onboarding proposal.

Use one-page collection browsing on a small fleet. Show advanced filters only when requested; do not permanently allocate a filter dashboard to a three-craft wallet. Preserve URL-addressable filters for larger collections.

A claimable-reward shortcut should be compact enough that at least the first owned craft remains visible in the initial mobile viewport. Keep multiple token amounts separate; the Rewards subview provides the full breakdown. Do not use a fabricated dollar total to compress four assets into one number.

The home illustration can use the existing hangar scene as editorial artwork. Identity detail and collectible cards must continue to represent their specific identity; avoid implying that a cinematic home illustration is the art of a purchasable NFT.

Before implementation, record the chosen concept and any borrowed elements, review Home/My Fleet/Trade/Launch on desktop and mobile, and settle the content hierarchy. Then turn the accepted design into implementation tasks covering the shell, route compatibility, wallet states, and preserved transaction semantics. The study code must not be promoted directly into production.
