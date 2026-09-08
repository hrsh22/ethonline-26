function craftSvg(c, label = true) {
  const orbiter = c.state === "Orbiter";
  const n = c.id;
  const wings = 30 + (n % 4) * 7;
  const nose = 67 + (n % 3) * 7;
  const ports = 2 + (n % 3);
  let dots = "";
  for (let i = 0; i < ports; i++)
    dots += `<circle cx="200" cy="${155 + i * 25}" r="5" fill="${orbiter ? c.tone : "#16191d"}" stroke="#c7ccd0" stroke-width="3"/>`;
  return `<svg viewBox="0 0 400 400" class="craft-svg ${orbiter ? "orbiter" : ""}" role="img" aria-label="${label ? esc((orbiter ? "Orbiter " : "Grounded craft ") + "#" + c.id) : ""}"><defs><linearGradient id="h${n}" x1="0" x2="1"><stop stop-color="#555e67"/><stop offset=".46" stop-color="#252b31"/><stop offset=".7" stop-color="#444d55"/><stop offset="1" stop-color="#191d22"/></linearGradient><linearGradient id="p${n}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff2d0"/><stop offset=".26" stop-color="${c.tone}"/><stop offset="1" stop-color="#ff3c00" stop-opacity="0"/></linearGradient></defs><g class="craft-core"><path class="plume" d="M180 303 Q200 382 220 303Z" fill="url(#p${n})"/><path d="M${200 - wings} 242 L${105 - wings} 303 L${165} 292 L200 320 L235 292 L${295 + wings} 303 L${200 + wings} 242Z" fill="#252b31" stroke="#7e8790" stroke-width="3"/><path d="M200 ${nose} Q${244 + (n % 10)} 135 ${236 + (n % 8)} 262 L218 312 L182 312 L${164 - (n % 8)} 262 Q${156 - (n % 10)} 135 200 ${nose}Z" fill="url(#h${n})" stroke="#bdc2c5" stroke-width="3"/><path d="M200 ${nose + 8}V307 M171 245H229 M169 263H231" stroke="#707982" stroke-width="2" opacity=".8"/><path d="M177 118 Q200 98 223 118 L218 151 Q200 160 182 151Z" fill="#0f171c" stroke="${c.tone}" stroke-width="3"/><path d="M165 278 L184 268 L181 310 H160Z M235 278 L216 268 L219 310 H240Z" fill="#13171b" stroke="#a1a8ae" stroke-width="3"/>${dots}<path d="M166 223H234" stroke="${c.tone}" stroke-width="5"/><text x="200" y="205" fill="#d8d8d3" text-anchor="middle" font-family="monospace" font-size="12">O/${String(c.id).padStart(4, "0")}</text></g></svg>`;
}

// Throwaway ORBIT design study. All state is in memory; reload resets the scenario.
const variants = { A: "Gallery", B: "Hangar", C: "Manifest" };
const initial = [
  {
    id: 1204,
    state: "Grounded",
    track: "GOOGLc",
    tier: "Tier I",
    tone: "#ff7a32",
    reward: 0,
  },
  {
    id: 208,
    state: "Orbiter",
    track: "AAPLc",
    tier: "Tier II",
    tone: "#9fc7e9",
    reward: 0.018,
  },
  {
    id: 710,
    state: "Orbiter",
    track: "NVDAc",
    tier: "Tier III",
    tone: "#b7d6a4",
    reward: 0.006,
  },
  {
    id: 3291,
    state: "Grounded",
    track: "METAc",
    tier: "Tier II",
    tone: "#cab6e6",
    reward: 0,
  },
];
let variant = "A",
  scenario = "populated",
  fleetTab = "collection",
  filter = "all",
  selected = 1204;
let crafts = [],
  owned = [],
  pending = 0,
  fuel = 0,
  weth = 1.42,
  walletTokens = {},
  connected = true;
let tradeSide = "buy",
  tradeAmount = "0.0065",
  review = null,
  returnFocus = null;
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
const amount = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
function reset(next = "populated") {
  scenario = ["populated", "disconnected", "empty", "pending"].includes(next)
    ? next
    : "populated";
  crafts = initial.map((c) => ({ ...c }));
  connected = scenario !== "disconnected";
  owned = scenario === "populated" ? [1204, 208, 710] : [];
  pending = scenario === "pending" ? 1 : 0;
  fuel = scenario === "populated" ? 1.25 : pending;
  weth = scenario === "empty" ? 0 : 1.42;
  walletTokens = { AAPLc: 0.042, NVDAc: 0.01, GOOGLc: 0, METAc: 0 };
  filter = "all";
  selected = 1204;
  tradeSide = "buy";
  tradeAmount = "0.0065";
  fleetTab = "collection";
}
function syncUrl() {
  const p = new URLSearchParams(location.search);
  variant = variants[p.get("variant")] ? p.get("variant") : "A";
  fleetTab = p.get("view") === "rewards" ? "rewards" : "collection";
}
reset(new URLSearchParams(location.search).get("state"));
syncUrl();
function url(path, extra = {}) {
  const p = new URLSearchParams({ variant, state: scenario, ...extra });
  return path + "?" + p;
}
function go(path, extra = {}) {
  history.pushState({}, "", url(path, extra));
  syncUrl();
  render();
  scrollTo(0, 0);
  $("main h1")?.focus({ preventScroll: true });
}
function active(path) {
  return location.pathname === path ? "active" : "";
}
function ownCrafts() {
  return crafts.filter((c) => owned.includes(c.id));
}
function claimable(ids = owned) {
  return crafts.filter(
    (c) => ids.includes(c.id) && c.state === "Orbiter" && c.reward > 0,
  );
}
function shell(content) {
  return (
    '<div class="shell variant-' +
    variant.toLowerCase() +
    '"><header class="topbar"><a class="brand" href="' +
    url("/") +
    '"><i class="brand-mark"></i>ORBIT 4444</a><nav class="primary-nav" aria-label="Primary">' +
    nav() +
    '</nav><div class="utility"><span class="testnet">Testnet · no value</span><button class="wallet" data-action="wallet">' +
    (connected ? "0x71F…9A2" : "Connect wallet") +
    "</button></div></header><main>" +
    content +
    '<footer class="concept-footer"><span>Base Sepolia · no-value test assets</span><button data-action="help" class="btn quiet">How it works</button><button data-action="status" class="btn quiet">Protocol status</button></footer></main><nav class="mobile-nav" aria-label="Primary mobile">' +
    nav() +
    "</nav></div>"
  );
}
function nav() {
  return [
    ["/explore", "Explore"],
    ["/exchange", "Trade"],
    ["/fleet", "My Fleet"],
  ]
    .map(
      ([path, label]) =>
        '<a class="' +
        (path === "/fleet" && location.pathname.startsWith("/fleet")
          ? "active"
          : active(path)) +
        '" href="' +
        url(path) +
        '">' +
        label +
        "</a>",
    )
    .join("");
}
function heading(title, action = "") {
  return (
    '<div class="page-head"><h1 tabindex="-1">' +
    title +
    "</h1>" +
    action +
    "</div>"
  );
}
function card(c) {
  return (
    '<article class="craft-card"><a class="craft-stage" href="' +
    url("/fleet/" + c.id, { from: "fleet" }) +
    '" aria-label="View craft #' +
    c.id +
    '">' +
    craftSvg(c) +
    '</a><div class="craft-meta"><div><h3>#' +
    String(c.id).padStart(4, "0") +
    "</h3><p>" +
    c.track +
    " · " +
    c.tier +
    '</p></div><span class="badge ' +
    (c.state === "Orbiter" ? "green" : "") +
    '">' +
    c.state +
    "</span></div></article>"
  );
}
function access() {
  return '<section class="empty"><p>Connect a wallet to see your craft and rewards.</p><button class="btn primary" data-action="wallet">Connect wallet</button></section>';
}
function pendingCard() {
  return (
    '<article class="pending-card"><div><div class="pending-orbit"></div><h3>' +
    pending +
    " discovery " +
    (pending === 1 ? "pending" : "draws pending") +
    "</h3><p>Your FUEL is held. The craft " +
    (pending === 1 ? "identity is" : "identities are") +
    ' still unknown.</p><button class="btn quiet" data-action="pending">See progress</button></div></article>'
  );
}
function rewardStrip() {
  const list = claimable();
  if (!list.length) return "";
  return (
    '<div class="reward-strip"><div><span class="sample-tag">Rewards available</span><div class="reward-values">' +
    list
      .map((c) => "<span>" + amount(c.reward) + " " + c.track + "</span>")
      .join("") +
    '</div></div><button class="btn" data-action="claim">Review claim</button></div>'
  );
}
function selectedPanel(c) {
  return (
    '<div class="selected-craft"><div class="craft-stage">' +
    craftSvg(c) +
    '</div><div class="selected-info"><span class="badge ' +
    (c.state === "Orbiter" ? "green" : "") +
    '">' +
    c.state +
    "</span><h2>#" +
    String(c.id).padStart(4, "0") +
    "</h2><p>" +
    c.track +
    " · " +
    c.tier +
    '</p><a class="btn" href="' +
    url("/fleet/" + c.id, { from: "fleet" }) +
    '">View craft</a></div></div>'
  );
}
function collection() {
  if (!connected) return access();
  const all = ownCrafts();
  if (!all.length && !pending) {
    const fraction = fuel > 0;
    return (
      '<section class="empty"><h2>' +
      (fraction
        ? "Your FUEL is in your wallet."
        : "Your collection starts here.") +
      "</h2><p>" +
      (fraction
        ? "You hold " +
          amount(fuel) +
          " FUEL. Another " +
          amount(Math.ceil((Math.floor(fuel) + 1 - fuel) * 1e6) / 1e6) +
          " FUEL reaches the next whole-unit boundary for a random discovery."
        : (weth
            ? "Buy FUEL to start collecting."
            : "Get test funds, then buy FUEL.") +
          " Crossing a whole-unit balance starts a random discovery.") +
      '</p><button class="btn primary" data-action="' +
      (weth ? "buy" : "fund") +
      '">' +
      (weth ? "Buy FUEL" : "Get test funds") +
      "</button></section>"
    );
  }
  const shown = all.filter((c) => filter === "all" || c.state === filter);
  if (!shown.some((c) => c.id === selected)) selected = shown[0]?.id;
  const filters =
    '<div class="filters" aria-label="Collection filters">' +
    [
      ["all", "All"],
      ["Grounded", "Grounded"],
      ["Orbiter", "Orbiters"],
    ]
      .map(
        ([v, label]) =>
          '<button class="filter ' +
          (filter === v ? "active" : "") +
          '" aria-pressed="' +
          (filter === v) +
          '" data-action="filter" data-filter="' +
          v +
          '">' +
          label +
          " " +
          (v === "all" ? all.length : all.filter((c) => c.state === v).length) +
          "</button>",
      )
      .join("") +
    "</div>";
  let body = "";
  if (variant === "A")
    body =
      '<section class="collection-grid">' +
      (pending ? pendingCard() : "") +
      shown.map(card).join("") +
      "</section>";
  else if (shown.length) {
    const chosen = crafts.find((c) => c.id === selected);
    body =
      '<section class="selection-layout"><div class="craft-selector">' +
      shown
        .map(
          (c) =>
            '<button class="selector-item ' +
            (selected === c.id ? "selected" : "") +
            '" data-action="select" data-id="' +
            c.id +
            '" aria-pressed="' +
            (selected === c.id) +
            '" aria-label="Select craft #' +
            c.id +
            '"><span class="selector-art">' +
            craftSvg(c) +
            "</span><span><strong>#" +
            String(c.id).padStart(4, "0") +
            "</strong><small>" +
            c.state +
            " · " +
            c.track +
            "</small></span></button>",
        )
        .join("") +
      "</div>" +
      selectedPanel(chosen) +
      "</section>" +
      (pending ? pendingCard() : "");
  } else body = pending ? pendingCard() : "<p>No craft in this filter.</p>";
  return rewardStrip() + filters + body;
}
function rewards() {
  if (!connected) return access();
  if (!ownCrafts().length)
    return '<section class="empty"><h2>No rewards yet.</h2><p>Rewards can accrue to an Orbiter after an optional Launch. Amounts and timing are not guaranteed.</p><button class="btn" data-action="tab" data-tab="collection">View collection</button></section>';
  const list = claimable();
  return (
    '<section class="rewards-view"><h2>Available to claim</h2><p>Rewards stay with each Orbiter until its current owner claims them.</p>' +
    (list.length
      ? list
          .map(
            (c) =>
              '<div class="claim-token"><div><strong>' +
              amount(c.reward) +
              " " +
              c.track +
              "</strong><p>Orbiter #" +
              c.id +
              '</p></div><a class="link" href="' +
              url("/fleet/" + c.id, { from: "fleet" }) +
              '">View craft</a></div>',
          )
          .join("") +
        '<button class="btn primary claim-cta" data-action="claim">Review claim</button>'
      : "<p>No rewards are currently available.</p>") +
    '<section class="wallet-holdings"><h3>Already in your wallet</h3><p>Separate from unclaimed rewards.</p>' +
    Object.entries(walletTokens)
      .filter(([, n]) => n > 0)
      .map(
        ([t, n]) =>
          '<div class="fact"><span>' +
          t +
          "</span><strong>" +
          amount(n) +
          "</strong></div>",
      )
      .join("") +
    "</section></section>"
  );
}
function fleet() {
  const has = connected && (owned.length || pending || fuel > 0);
  return shell(
    heading(
      "My Fleet",
      connected && (owned.length || pending)
        ? '<a class="btn quiet" href="' + url("/exchange") + '">Buy FUEL</a>'
        : "",
    ) +
      (has
        ? '<div class="tabs"><button class="tab ' +
          (fleetTab === "collection" ? "active" : "") +
          '" data-action="tab" data-tab="collection">Collection</button><button class="tab ' +
          (fleetTab === "rewards" ? "active" : "") +
          '" data-action="tab" data-tab="rewards">Rewards</button><span class="fleet-balance">' +
          amount(fuel) +
          " FUEL</span></div>"
        : "") +
      (fleetTab === "rewards" ? rewards() : collection()),
  );
}
function home() {
  return shell(
    '<section class="home-hero"><div class="home-copy"><span class="eyebrow">An ORBIT collection of 4,444 craft</span><h1 tabindex="-1">Find the craft worth keeping.</h1><p>Buy FUEL. Discover a random craft. Choose whether to keep it liquid or Launch it permanently.</p><div class="button-row"><a class="btn primary" href="' +
      url("/exchange") +
      '">Start collecting</a><a class="link" href="' +
      url("/explore") +
      '">Explore craft</a></div></div><figure class="hero-art"><img src="/prototype-art/grounded-craft-hangar.png" alt="Spacecraft resting in an open hangar above clouds"><figcaption class="hero-caption">Editorial artwork</figcaption></figure></section><section class="steps"><div class="step"><strong>Buy FUEL</strong><p>Each new whole-unit balance starts a random discovery.</p></div><div class="step"><strong>Meet your craft</strong><p>A Grounded Craft stays paired with one liquid FUEL.</p></div><div class="step"><strong>Choose when to Launch</strong><p>Optional and irreversible: burn 1 FUEL to make that craft permanent and reward-eligible.</p></div></section>',
  );
}
function chart() {
  return '<aside class="market-ghost"><div class="chart-head"><div><h2>FUEL / WETH</h2><p class="mono">0.006 WETH</p></div><span class="sample-tag">Illustrative · 24h</span></div><svg class="price-chart" viewBox="0 0 640 300" role="img" aria-label="Illustrative 24-hour FUEL price chart, ending at 0.006 WETH"><g stroke="#343c45" stroke-width="1"><path d="M15 35H565M15 105H565M15 175H565M15 245H565"/></g><g fill="#a8b0b8" font-family="monospace" font-size="13"><text x="575" y="40">.0062</text><text x="575" y="110">.0058</text><text x="575" y="180">.0054</text><text x="575" y="250">.0050</text><text x="15" y="285">00:00</text><text x="270" y="285">12:00</text><text x="520" y="285">24:00</text></g><path d="M15 220L40 195L65 208L90 170L115 181L140 165L165 125L190 150L215 122L240 138L265 115L290 118L315 83L340 110L365 88L390 90L415 110L440 84L465 73L490 98L515 71L540 65L565 70" fill="none" stroke="#ff8b4f" stroke-width="3"/><circle cx="565" cy="70" r="5" fill="#ff8b4f"/></svg><p class="chart-caption">Price per FUEL in WETH. Chart and quotes in this study are sample data.</p></aside>';
}
function quote() {
  const input = Number(tradeAmount),
    valid =
      Number.isFinite(input) &&
      input > 0 &&
      input <= (tradeSide === "buy" ? weth : fuel);
  const output = valid
    ? tradeSide === "buy"
      ? (input * 0.97) / 0.006
      : input * 0.006 * 0.97
    : 0;
  const delta =
    tradeSide === "buy"
      ? Math.floor(fuel + output) - Math.floor(fuel)
      : Math.floor(fuel) - Math.floor(fuel - input);
  return {
    input,
    output,
    minimum: output * 0.99,
    fee: valid ? input * (tradeSide === "buy" ? 1 : 0.006) * 0.03 : 0,
    delta,
    valid,
  };
}
function effect(q) {
  if (!q.valid) return "Enter an amount within your balance.";
  return tradeSide === "buy"
    ? q.delta
      ? "Estimated " +
        q.delta +
        " random " +
        (q.delta === 1 ? "discovery" : "discoveries") +
        ". Identity cannot be chosen."
      : "Your balance stays below its next whole-unit boundary."
    : q.delta
      ? "This crosses " +
        q.delta +
        " whole-unit " +
        (q.delta === 1 ? "boundary" : "boundaries") +
        ". Pending discoveries cancel first, then grounded craft return."
      : "This sale stays within your fractional balance.";
}
function trade() {
  const q = quote();
  return shell(
    heading("Trade FUEL") +
      '<div class="trade-layout">' +
      chart() +
      '<section class="trade-card"><div class="segmented">' +
      ["buy", "sell"]
        .map(
          (side) =>
            '<button class="' +
            (tradeSide === side ? "active" : "") +
            '" data-action="side" data-side="' +
            side +
            '">' +
            (side === "buy" ? "Buy" : "Sell") +
            "</button>",
        )
        .join("") +
      '</div><div class="amount-box"><label for="tradeAmount"><span>You ' +
      (tradeSide === "buy" ? "pay" : "sell") +
      "</span><span>Balance " +
      amount(tradeSide === "buy" ? weth : fuel) +
      '</span></label><div class="amount-line"><input id="tradeAmount" inputmode="decimal" value="' +
      esc(tradeAmount) +
      '"><span class="asset">' +
      (tradeSide === "buy" ? "WETH" : "FUEL") +
      '</span></div></div><div class="amount-box"><label>You receive, estimated</label><div class="amount-line"><strong id="quoteOut" class="mono quote-number">' +
      amount(q.output) +
      '</strong><span class="asset">' +
      (tradeSide === "buy" ? "FUEL" : "WETH") +
      '</span></div></div><div class="trade-facts"><div><span>Trading fee</span><strong>3.00%</strong></div><div><span>Minimum received</span><strong id="minimumOut">' +
      amount(q.minimum) +
      " " +
      (tradeSide === "buy" ? "FUEL" : "WETH") +
      '</strong></div></div><p id="collectionEffect" class="effect-copy">' +
      effect(q) +
      '</p><button class="btn primary wide" data-action="' +
      (!connected
        ? "wallet"
        : weth === 0 && tradeSide === "buy"
          ? "fund"
          : "trade") +
      '" ' +
      (connected && weth > 0 && !q.valid ? "disabled" : "") +
      ">" +
      (!connected
        ? "Connect wallet"
        : weth === 0 && tradeSide === "buy"
          ? "Get test funds"
          : "Review " + tradeSide) +
      "</button></section></div>",
  );
}
function currentCraft() {
  return crafts.find(
    (c) => c.id === Number(location.pathname.split("/").pop()),
  );
}
function detail() {
  const c = currentCraft();
  if (!c)
    return shell(
      heading("Craft not in this study") +
        '<a class="btn" href="' +
        url("/explore") +
        '">Explore samples</a>',
    );
  const own = connected && owned.includes(c.id);
  const from =
    new URLSearchParams(location.search).get("from") === "explore"
      ? "explore"
      : "fleet";
  return shell(
    '<a class="link" href="' +
      url("/" + from) +
      '">Back to ' +
      (from === "fleet" ? "My Fleet" : "Explore") +
      '</a><div class="detail-layout"><div class="craft-stage">' +
      craftSvg(c) +
      '</div><section class="detail-info"><span class="badge ' +
      (c.state === "Orbiter" ? "green" : "") +
      '">' +
      c.state +
      '</span><h1 tabindex="-1">#' +
      String(c.id).padStart(4, "0") +
      "</h1><p>" +
      c.track +
      " · " +
      c.tier +
      "</p><p>" +
      (c.state === "Orbiter"
        ? "Permanent. This craft no longer depends on a FUEL balance. Rewards vary with activity and completed conversions."
        : "Paired with one whole FUEL. You can keep it grounded; Launch is an optional permanent decision.") +
      "</p>" +
      (own && c.state === "Orbiter"
        ? '<div class="details-list"><div class="fact"><span>Available to claim</span><strong>' +
          amount(c.reward) +
          " " +
          c.track +
          "</strong></div></div>"
        : "") +
      '<div class="detail-actions"><div class="button-row">' +
      (own
        ? (c.state === "Grounded"
            ? '<button class="btn primary" data-action="launch">Review Launch</button>'
            : c.reward > 0
              ? '<button class="btn primary" data-action="claim">Review claim</button>'
              : '<span class="badge">No rewards available</span>') +
          '<button class="btn" data-action="transfer">Transfer</button>'
        : "<p>Public sample preview. Buying FUEL draws an identity at random.</p>") +
      "</div></div></section></div>",
  );
}
function explore() {
  return shell(
    heading(
      "Explore craft",
      '<a class="btn quiet" href="' + url("/exchange") + '">Buy FUEL</a>',
    ) +
      '<p class="catalog-note">A catalog of sample identities. Buying FUEL draws a craft at random; you cannot select a pictured craft.</p><section class="explore-grid">' +
      crafts
        .map(
          (c) =>
            '<article><a class="craft-stage" href="' +
            url("/fleet/" + c.id, { from: "explore" }) +
            '">' +
            craftSvg(c) +
            '</a><div class="craft-meta"><div><h3>#' +
            String(c.id).padStart(4, "0") +
            "</h3><p>" +
            c.track +
            " · " +
            c.tier +
            '</p></div><a class="btn quiet" href="' +
            url("/fleet/" + c.id, { from: "explore" }) +
            '">View craft</a></div></article>',
        )
        .join("") +
      "</section>",
  );
}
function render(focus) {
  document.body.dataset.variant = variant;
  $("#variantLabel").textContent = variant + " · " + variants[variant];
  $("#stateSelect").value = scenario;
  $("#pageSelect").value = location.pathname;
  const path = location.pathname;
  $("#app").innerHTML =
    path === "/"
      ? home()
      : path === "/fleet"
        ? fleet()
        : path === "/exchange"
          ? trade()
          : path === "/explore"
            ? explore()
            : detail();
  if (focus) $(focus)?.focus({ preventScroll: true });
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function close() {
  const d = $("#reviewDialog");
  d.close();
  if (returnFocus?.isConnected) returnFocus.focus();
  else $("main h1")?.focus({ preventScroll: true });
}
function modal(type) {
  returnFocus = document.activeElement;
  const c = currentCraft();
  review = { type };
  let title = "",
    body = "",
    confirm = "";
  if (type === "launch") {
    if (
      !c ||
      !connected ||
      !owned.includes(c.id) ||
      c.state !== "Grounded" ||
      fuel < 1
    )
      return;
    review.id = c.id;
    title = "Launch #" + c.id + "?";
    body =
      '<p class="warning"><strong>Burns exactly 1 FUEL forever, plus network gas.</strong></p><p>The same craft becomes a permanent Orbiter on the ' +
      c.track +
      ' track. Its liquid FUEL backing cannot be recovered. Rewards are variable and not guaranteed.</p><p>Base Sepolia · no-value test assets.</p><label class="check"><input id="ack" type="checkbox"><span>I understand this Launch is permanent and burns 1 FUEL.</span></label>';
    confirm =
      '<button class="btn primary" data-action="confirm" disabled>Launch #' +
      c.id +
      "</button>";
  } else if (type === "claim") {
    review.ids = claimable(c ? [c.id] : owned).map((x) => x.id);
    if (!connected || !review.ids.length) return;
    title = "Review claim";
    body =
      '<div class="details-list">' +
      claimable(review.ids)
        .map(
          (x) =>
            '<div class="fact"><span>Orbiter #' +
            x.id +
            "</span><strong>" +
            amount(x.reward) +
            " " +
            x.track +
            "</strong></div>",
        )
        .join("") +
      "</div><p>These token amounts will move from the listed identities to your wallet. Base Sepolia test tokens; network gas applies.</p>";
    confirm =
      '<button class="btn primary" data-action="confirm">Claim rewards</button>';
  } else if (type === "trade") {
    const q = quote();
    if (!connected || !q.valid) return;
    review = { type, quote: q, side: tradeSide };
    title = "Review " + tradeSide;
    const receive = tradeSide === "buy" ? "FUEL" : "WETH";
    body =
      '<div class="details-list">' +
      [
        [
          "You " + (tradeSide === "buy" ? "pay" : "sell"),
          amount(q.input) + " " + (tradeSide === "buy" ? "WETH" : "FUEL"),
        ],
        ["Estimated received", amount(q.output) + " " + receive],
        ["Minimum received", amount(q.minimum) + " " + receive],
        ["Trading fee", amount(q.fee) + " WETH (3%)"],
      ]
        .map(
          ([k, v]) =>
            '<div class="fact"><span>' +
            k +
            "</span><strong>" +
            v +
            "</strong></div>",
        )
        .join("") +
      '</div><p class="warning">' +
      effect(q) +
      "</p><p>" +
      (tradeSide === "buy"
        ? "An estimate is not a confirmed discovery. The actual received amount determines whole-unit boundaries. WETH approval may precede the purchase."
        : "Unlaunched craft depend on their paired whole-unit balance. Orbiters remain permanent.") +
      "</p><p>Base Sepolia · no-value test assets · network gas applies.</p>";
    confirm =
      '<button class="btn primary" data-action="confirm">Simulate ' +
      tradeSide +
      "</button>";
  } else if (type === "transfer") {
    if (!c || !connected || !owned.includes(c.id)) return;
    review.id = c.id;
    title = "Transfer #" + c.id;
    body =
      '<label for="recipient">Recipient address</label><input id="recipient" class="recipient" placeholder="0x…" autocomplete="off"><p class="warning">' +
      (c.state === "Orbiter"
        ? "Unclaimed rewards move with this Orbiter to its new owner."
        : "Its paired 1 FUEL moves with this Grounded Craft.") +
      "</p><p>Base Sepolia. Check the full recipient before confirming.</p>";
    confirm =
      '<button class="btn primary" data-action="review-transfer" disabled>Review transfer</button>';
  } else if (type === "pending") {
    title = "Discovery pending";
    body =
      "<p>Your " +
      pending +
      " unseen " +
      (pending === 1 ? "identity is" : "identities are") +
      " waiting for a random result. You can keep waiting; moving away the backing FUEL cancels the corresponding unseen discovery.</p><p>The design study does not contact the randomness service.</p>";
  } else if (type === "help") {
    title = "How collecting works";
    body =
      "<p>Buy FUEL. Crossing each new whole-unit balance starts a random Discovery Draw. The revealed Grounded Craft stays paired with its whole FUEL.</p><p>Optional Launch burns 1 FUEL permanently and makes that same craft an Orbiter, eligible for variable rewards. Selling below a whole-unit boundary can cancel an unseen discovery or dissolve a grounded craft.</p>";
  } else {
    title = "Protocol status";
    body =
      "<p>This design study is offline and has no live protocol status. The implemented app will keep its public status page here.</p>";
  }
  $("#dialogContent").innerHTML =
    '<div class="dialog-head"><div><span class="sample-tag">Design simulation · no transactions</span><h2 id="dialogTitle">' +
    title +
    '</h2></div><button class="icon-btn" data-action="close" aria-label="Close review">×</button></div>' +
    body +
    '<div class="button-row">' +
    confirm +
    '<button class="btn" data-action="close">' +
    (confirm ? "Cancel" : "Close") +
    "</button></div>";
  $("#reviewDialog").showModal();
}
function confirm() {
  const r = review;
  if (!r) return;
  if (r.type === "launch") {
    crafts.find((c) => c.id === r.id).state = "Orbiter";
    fuel -= 1;
    close();
    render("main h1");
    toast("#" + r.id + " is now an Orbiter. No rewards have accrued yet.");
  }
  if (r.type === "claim") {
    claimable(r.ids).forEach((c) => {
      walletTokens[c.track] = (walletTokens[c.track] || 0) + c.reward;
      c.reward = 0;
    });
    close();
    render("main h1");
    toast(
      "Claim simulated. Only the reviewed rewards moved to wallet balances.",
    );
  }
  if (r.type === "trade") {
    const q = r.quote;
    if (r.side === "buy") {
      weth -= q.input;
      fuel += q.output;
      pending += q.delta;
    } else {
      fuel -= q.input;
      weth += q.output;
      let remaining = q.delta;
      const cancelled = Math.min(pending, remaining);
      pending -= cancelled;
      remaining -= cancelled;
      for (const c of ownCrafts()
        .filter((c) => c.state === "Grounded")
        .reverse()) {
        if (remaining-- > 0) owned = owned.filter((id) => id !== c.id);
      }
    }
    close();
    go("/fleet");
    toast(
      r.side === "buy"
        ? "Purchase simulated. Inspect your updated collection and pending discoveries."
        : "Sale simulated. Your collection now reflects the balance change.",
    );
  }
  if (r.type === "transfer") {
    const c = crafts.find((c) => c.id === r.id);
    owned = owned.filter((id) => id !== r.id);
    if (c.state === "Grounded") fuel -= 1;
    close();
    go("/fleet");
    toast(
      "Transfer simulated. Craft and attached rewards are no longer in this wallet.",
    );
  }
}
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (
    link &&
    link.origin === location.origin &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey
  ) {
    e.preventDefault();
    history.pushState({}, "", link.href);
    syncUrl();
    render();
    scrollTo(0, 0);
    $("main h1")?.focus({ preventScroll: true });
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "close") {
    close();
    return;
  }
  if (a === "wallet") {
    if (!connected) {
      connected = true;
      scenario = "empty";
      owned = [];
      fuel = 0;
      pending = 0;
      weth = 0;
      history.replaceState({}, "", url(location.pathname));
      render("main h1");
      toast("Sample wallet connected.");
    } else
      toast(
        "Sample account: 0x71F…9A2. Change scenarios in Design review controls.",
      );
  }
  if (a === "fund") {
    weth = 0.03;
    render("main h1");
    toast(
      "Sample wallet funded with 0.03 test WETH and gas. No faucet request was sent.",
    );
  }
  if (a === "buy") go("/exchange");
  if (a === "tab") {
    fleetTab = el.dataset.tab;
    history.replaceState({}, "", url("/fleet", { view: fleetTab }));
    render('[data-tab="' + fleetTab + '"]');
  }
  if (a === "filter") {
    filter = el.dataset.filter;
    render('[data-filter="' + filter + '"]');
  }
  if (a === "select") {
    selected = Number(el.dataset.id);
    render('[data-action="select"][data-id="' + selected + '"]');
  }
  if (a === "side") {
    tradeSide = el.dataset.side;
    tradeAmount = tradeSide === "buy" ? "0.0065" : ".25";
    render('[data-side="' + tradeSide + '"]');
  }
  if (
    [
      "launch",
      "claim",
      "trade",
      "transfer",
      "pending",
      "help",
      "status",
    ].includes(a)
  )
    modal(a);
  if (a === "review-transfer") {
    const recipient = $("#recipient").value;
    review.recipient = recipient;
    $("#dialogContent").innerHTML =
      '<div class="dialog-head"><h2 id="dialogTitle">Confirm transfer #' +
      review.id +
      '</h2></div><p class="recipient-full">' +
      esc(recipient) +
      "</p><p>Base Sepolia. " +
      (crafts.find((c) => c.id === review.id).state === "Orbiter"
        ? "Unclaimed rewards move with this identity."
        : "The paired 1 FUEL moves with this craft.") +
      '</p><div class="button-row"><button class="btn primary" data-action="confirm">Simulate transfer</button><button class="btn" data-action="close">Cancel</button></div>';
    $('#dialogContent [data-action="close"]').focus();
  }
  if (a === "confirm") confirm();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "tradeAmount") {
    tradeAmount = e.target.value;
    const q = quote();
    $("#quoteOut").textContent = amount(q.output);
    $("#minimumOut").textContent =
      amount(q.minimum) + " " + (tradeSide === "buy" ? "FUEL" : "WETH");
    $("#collectionEffect").textContent = effect(q);
    const b = $('[data-action="trade"]');
    if (b) b.disabled = !q.valid;
  }
  if (e.target.id === "recipient")
    $('[data-action="review-transfer"]').disabled =
      !/^0x[0-9a-fA-F]{40}$/.test(e.target.value) ||
      /^0x0{40}$/.test(e.target.value);
  if (e.target.id === "ack")
    $('#reviewDialog [data-action="confirm"]').disabled = !e.target.checked;
});
$("#pageSelect").addEventListener("change", (e) => go(e.target.value));
$("#stateSelect").addEventListener("change", (e) => {
  reset(e.target.value);
  history.replaceState({}, "", url(location.pathname));
  render();
});
$("#resetDemo").addEventListener("click", () => {
  reset(scenario);
  history.replaceState({}, "", url(location.pathname));
  render();
  toast("Scenario reset. All values are sample data.");
});
function cycle(delta) {
  const keys = Object.keys(variants);
  variant = keys[(keys.indexOf(variant) + delta + 3) % 3];
  history.replaceState({}, "", url(location.pathname, { view: fleetTab }));
  render();
}
$("#prevVariant").addEventListener("click", () => cycle(-1));
$("#nextVariant").addEventListener("click", () => cycle(1));
document.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
    document.activeElement?.isContentEditable ||
    $("#reviewDialog").open
  )
    return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    cycle(e.key === "ArrowRight" ? 1 : -1);
  }
});
$("#reviewDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  close();
});
$("#reviewDialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) close();
});
addEventListener("popstate", () => {
  syncUrl();
  render();
});
render();
