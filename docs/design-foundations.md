# Application design foundations

The application ships a single dark visual identity called **Graphite**: a
neutral near-black canvas with signal orange, composed like a refined trading
terminal. The collector uses the **Hangar** composition: one featured craft
with a selector, readable product typography, and quiet surrounding controls.
The operator console remains a dense, data-first instrument. Both make
irreversible decisions calmly and keep the same semantic status colors.

Structure comes from restrained hairlines and one step of surface tint on a
near-black canvas; a panel may add the soft `--shadow-raised` so it separates
from the canvas without a heavier border. The single accent — signal orange
— is reserved for live values, the primary action, the current destination and
a lit Orbiter. Purple or pink Web3 gradients, glass panels, glow effects,
scanline textures, and marquee tickers are outside this system.

It supports two working modes without pretending they are two systems:

- The collector experience is the product. A compact header holds Explore,
  Trade, and My Fleet; mobile uses those same three destinations in a bottom
  bar. Objects and the current task come before protocol accounting.
- The operator console retains its rail: the console
  destinations, the session being operated under, and denser boards.

## Scope of the current system

Every surface reads the Graphite color map on `:root`. Typography is scoped
under `[data-shell="collector"]`; collector changes must not alter the
operator's rail, density, or wallet theme. There is no `prefers-color-scheme`
split.

## Semantic color

`apps/web/src/app/styles/foundations.css` is the source of truth. The document
declares `color-scheme: dark`, so native controls and scrollbars match the
canvas. Components use semantic tokens according to their role:

- Canvas and layers: `--canvas`, `--surface-1`, `--surface-2`, and
  `--surface-3`. Surface 1 is a panel; 2 is a panel header or the rail; 3 is a
  well or an input. Elevation is expressed by one step of tint and a hairline;
  `--shadow-raised` may reinforce a panel but never replaces the hairline.
- Text: `--text-primary`, `--text-secondary`, and `--text-tertiary`.
- Rules: `--border-subtle`, `--border-strong`, and `--focus-ring`.
- Signal: `--accent-fill` (orange) with `--accent-fill-text` for the one filled
  control on a page, `--accent-text` for live values, links and the active
  destination, `--accent-surface` for a tinted well, and `--accent-border` for
  a region holding a live or owned state.
- State: information, success, warning and danger each have a surface and a
  text token. A partial read uses `--state-partial-text`, which is a caution
  and not a failure.
- Charts sit one step below the panel on `--chart-surface` and draw with the
  `--chart-*` family only.
- The `--inverse-*` family is a lifted plate for a rare emphasis moment.

`--primary` is a fill alias. It must not be used for text, icons, focus, chart
strokes, or borders. Token pairings are tested for WCAG AA; focus and chart
marks are tested at 3:1 or better. The theme uses neither pure black nor pure
white. Text selection uses the warning surface with primary text.

The wallet modal is part of the same instrument. Reown is pinned to
`themeMode: "dark"` with the signal fill as its brand colour and the canvas as
its colour mix, and it never follows the OS preference. Because Reown cannot
read custom properties, the literals are asserted against the token map by
`wallet-provider-theme.test.ts`.

## Typography

- Barlow carries collector prose, headings, actions, field labels and
  segmented controls. IBM Plex Mono carries Fleet identifiers and measured
  values; other collector surfaces retain JetBrains Mono. Collector headings,
  actions, field labels and segment labels use sentence case. Caps mono is
  reserved for units, badges, metric labels and page eyebrows.
- The operator retains JetBrains Mono for every role. Root font bindings
  stay mono; the collector scope changes only its own sans/display bindings.

The type scale lives in the `@theme` block: `label` (the 12px floor, caps,
tracked), `caption`, `body-sm`, `body`, `lede`, `title-sm`, `title`, `heading`,
`display` and `hero`. Panel titles, column headers and units are caps labels.
Collector body copy and primary actions target 16px. Operator body copy is
14px; twelve pixels is the floor for labels, never for a paragraph or action.

Measured values are typeset, not printed raw. A value carries an explicit
precision, its unit as a quiet label, and tabular figures; a full-precision
value belongs in a `title` or a disclosure, never in a truncated display string.

## Density and layout

Collector screens use density level 4 of 10. My Fleet opens on one featured
owned craft and a selector; a compact balance/reward summary supports it.
Match the B prototype's composition: a wide left selector, a separate framed
artwork stage, and an unboxed identity caption on the right. Use underline
filters, balance beside the Collection/Rewards tabs, and a compact reward strip.
Completed activity belongs in Notifications, not a permanent page-wide banner;
pending and unresolved actions keep their recovery controls visible.
An empty collection has fixed Explore and Trade links, independent of balances.
Advanced filters and technical evidence are secondary. Trade is chart-led:
the interactive candlestick chart is the only chart view and takes eight of
twelve columns beside a four-column order panel on wide screens (seven and
five at laptop width); on mobile the order panel comes first and the chart
follows at a fixed 20rem height. The chart panel opens with the pair, its
live price and the range control. Home is an editorial introduction, not an
accounting board. Disconnected and empty collections show a craft on a stage
with one action, never a bare sentence.
Prose stays concise and below 80 characters per line.

Admin screens use density level 8 of 10. Put related facts in shared boards,
tables, ledgers, or split panes. High density never permits tiny explanatory
copy or ambiguous controls.

The collector shell owns the header and mobile navigation; the operator shell
owns its rail. A route owns one content column. A compact testnet/no-value
disclosure persists; routine block/health telemetry belongs in Status.
Interactive controls have a minimum 44px target. Containers nest at most one
level deep: inside a panel, related facts become rows, wells, or metric cells,
never another panel. Metric boards are equal columns on a shared baseline, so a
longer label can never shift its neighbour's value.

## Shape

The system has one restrained radius rule, softly rounded so panels read as
plates rather than as a card system:

- Panels use `--radius-surface` at 10px.
- Controls use `--radius-control` at 6px.
- `--radius-pill` is reserved for a state dot.

Do not mix arbitrary rounded values inside one composition.

## Motion

Motion exists to confirm state change. Use `--motion-fast` for direct control
feedback, `--motion-standard` for component state changes, and
`--motion-slow` for a larger reveal, all with `--ease-standard`. Collector
motion has a variance level of 2 of 10; admin motion has a variance level of
2 of 10. No entrance choreography, no looping decoration, no animated evidence
values. The reduced-motion media query removes non-essential animation.

## State and action grammar

Every surface that can load, fail, or hold nothing designs those states beside
its populated state. A blocked condition is announced before the control it
blocks. An unreadable value is one clear statement, not a grid of placeholders,
and an empty or disconnected surface shows what the product is plus one action
rather than a row of dashes. There is no onboarding ladder, user-stage
classifier, cross-page next-action controller, or first-Orbiter completion
goal. Wallet access, insufficient funds, pending discovery, and transaction
recovery are action-local facts. Launch is optional, not unfinished onboarding.

Use `StateFeedback` for loading, empty, blocked, partial, stale, error, success
and notice. Errors are assertive alerts; everything else is a polite status.
Never render a raw exception, RPC payload, or server response into it.

Use `DisabledReason` next to a disabled action, connected with
`aria-describedby`. A disabled control says what condition will enable it.

A selected segment lifts to the panel surface with a subtle hairline and a
semibold sentence-case label; the rest stay recessed. Exactly one active treatment exists per navigation set: the
signal rule.

Wallet surfaces distinguish disconnected, connecting, wrong network, switching,
rejected, and connected. Admin authentication additionally distinguishes
challenge preparation, signing, verifying, and rejected.

## Stylesheet ownership

`globals.css` is an import-only entrypoint. Its local cascade order is fixed:

1. `foundations.css` — tokens, element defaults, the touch-target floor and
   the focus ring.
2. `market.css` — only overrides for the third-party chart's own DOM.

Components author their styles as Tailwind utilities over the semantic tokens;
there are no route stylesheets. A test forbids
unreferenced rules, arbitrary breakpoints, and font sizes below the floor.
