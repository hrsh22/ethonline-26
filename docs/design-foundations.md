# Application design foundations

The application ships a single visual identity called **Graphite**:
a dark, dense, data-first instrument. One theme, always dark, built for reading
live numbers, recognising owned objects at a glance, and making irreversible
decisions calmly.

Structure comes from boxed panels drawn with hairlines on a near-black canvas.
One monospace family carries every role, and the single accent — signal orange
— is reserved for live values, the primary action, the current destination and
a lit Orbiter. Purple or pink Web3 gradients, glass panels, glow effects,
scanline textures, and marquee tickers are outside this system.

It supports two working modes without pretending they are two systems:

- The collector experience is the product. A persistent left rail holds every
  destination; the content column opens with a board of what is true right now.
- The operator console is the same rail with a different payload: the console
  destinations, the session being operated under, and denser boards.

## Scope of the current system

Every surface reads the Graphite map on `:root` — collector and operator
console alike. There is one token map, no theme scope, and no
`prefers-color-scheme` split anywhere.

## Semantic color

`apps/web/src/app/styles/foundations.css` is the source of truth. The document
declares `color-scheme: dark`, so native controls and scrollbars match the
canvas. Components use semantic tokens according to their role:

- Canvas and layers: `--canvas`, `--surface-1`, `--surface-2`, and
  `--surface-3`. Surface 1 is a panel; 2 is a panel header or the rail; 3 is a
  well or an input. Elevation is expressed by one step of tint and a hairline,
  never by shadow alone.
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

- JetBrains Mono is the only face, in both applications. It is bound to
  `--font-sans`, `--font-mono` and `--font-display`, so headings, labels,
  numerals and body share one rhythm and columns of values align.

The type scale lives in the `@theme` block: `label` (the 12px floor, caps,
tracked), `caption`, `body-sm`, `body`, `lede`, `title-sm`, `title`, `heading`,
`display` and `hero`. Panel titles, column headers and units are caps labels.
Body copy is 14px; twelve pixels is the floor for labels, never for a paragraph
or an action.

Measured values are typeset, not printed raw. A value carries an explicit
precision, its unit as a quiet label, and tabular figures; a full-precision
value belongs in a `title` or a disclosure, never in a truncated display string.

## Density and layout

Collector screens use density level 7 of 10. A route opens with a board of live
figures or the object itself; explanation comes last and collapsed. Panels sit
in a gap-of-12px grid; padding inside a panel is 16px. No paragraph outside a
disclosure is longer than one sentence.

Admin screens use density level 8 of 10. Put related facts in shared boards,
tables, ledgers, or split panes. High density never permits tiny explanatory
copy or ambiguous controls.

The shell owns the rail and the status strip; a route owns one content column.
Interactive controls have a minimum 44px target. Containers nest at most one
level deep: inside a panel, related facts become rows, wells, or metric cells,
never another panel. Metric boards are equal columns on a shared baseline, so a
longer label can never shift its neighbour's value.

## Shape

The system has one restrained radius rule, nearly square because structure
comes from hairlines:

- Panels use `--radius-surface` at 4px.
- Controls use `--radius-control` at 3px.
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
rather than a row of dashes.

Use `StateFeedback` for loading, empty, blocked, partial, stale, error, success
and notice. Errors are assertive alerts; everything else is a polite status.
Never render a raw exception, RPC payload, or server response into it.

Use `DisabledReason` next to a disabled action, connected with
`aria-describedby`. A disabled control says what condition will enable it.

A selected segment lifts to the panel surface with a strong hairline; the rest
stay recessed. Exactly one active treatment exists per navigation set: the
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
