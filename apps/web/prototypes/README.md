# ORBIT UX concepts — throwaway design study

Question: which collector composition best combines ORBIT's craft identity with a simpler personal experience?

This is an isolated preimplementation artifact. It is not production application code. All balances, identities, quotes, rewards, wallets and outcomes are illustrative. There are no RPC calls, real wallet connections or transactions. State is in memory and resets on reload or Reset scenario.

## Run

From this checkout:

```bash
node apps/web/prototypes/serve-orbit-ux-prototype.mjs
```

Open `http://127.0.0.1:3107/fleet?variant=A`.

For the collaborative browser on another device on the local network:

```bash
ORBIT_PROTOTYPE_HOST=0.0.0.0 node apps/web/prototypes/serve-orbit-ux-prototype.mjs
```

Use this machine's network address with port 3107. The server serves only the prototype HTML, JavaScript, stylesheet and the existing editorial hangar image. It does not serve environment files or a directory listing. Default binding remains loopback.

## Review

- A · Gallery: artwork grid; recommended starting point.
- B · Hangar: craft selector with a large selected object.
- C · Manifest: inventory rows with a selected detail area.

Use the floating arrows or keyboard left/right arrows to compare layouts. The layout key is in `?variant=A`, `B` or `C`. Typing in a field or using a dialog does not trigger the keyboard switcher.

Open Design review controls to select Home, My Fleet, Trade, craft detail or Explore; change between populated, disconnected, empty and pending scenarios. The same-origin navigation stays inside the in-memory study. Reload resets sample outcomes; scenario and variant remain URL-addressable.

Try a grounded craft's Launch review, cancel it, then simulate a confirmed Launch. Try an individual Orbiter claim and check its credited wallet token separately from remaining unclaimed rewards. Trade shows a chart and form by default; simulated buy/sell changes sample FUEL and pending/grounded holdings. Transfer uses a full-address review and simulates ownership removal.

## Evidence and limitations

Browser interactions checked: B/C selection and focus; disconnected Rewards; Launch acknowledgement and same-identity transition; individual claim attribution/wallet credit; edited trade amount and pending discovery result. DOM geometry checks at 390/768/1024/1280px covered Home, Fleet variants, Trade and detail, with navigation present and no page overflow. Additional mobile dialog checks covered viewport bounds and focus restoration.

Screenshot/recording export failed in the collaborative preview tooling. These checks do not constitute a completed screenshot-based visual review. The live interactive concept remains viewable.

The study does not validate live quotes, slippage execution, allowances, transaction races, randomness, discovery finalization, indexer state, wallet restoration, ownership revalidation, claim batching or production accessibility/performance. Use the implementation's existing transaction/ownership state models and tests when building the chosen design. Do not promote this prototype code directly into production.

Captured on branch `design/orbit-ux-concepts-20260908`. No winning variant has been approved for implementation yet. Main planning references: `docs/ux-simplification-plan.md`, `docs/ux-concept-review.md`, `docs/ux-implementation-brief.md` in the primary checkout.
