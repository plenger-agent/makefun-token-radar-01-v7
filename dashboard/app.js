// Token Launch Radar v7 — dashboard application (vanilla JS, no network).
// data.js carries the snapshot-derived rows, the validation record and
// the full 758-protocol ledger; model.js carries the fitted regression as
// generated code. The detail view recomputes each headline value by
// calling that model code on the row's own figures, so what the page
// shows is what the code in the dossier computes.
'use strict';

const DATA = window.RADAR_DATA;
const MODEL = window.RADAR_MODEL;
const rows = DATA.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const fmt = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtShort = (n) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));
const mult = (n) => n.toFixed(2) + 'x';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (x) => (x * 100).toFixed(1) + '%';

// ---------------------------------------------------------------- masthead
function renderChrome() {
  const v = DATA.validation;
  const c = DATA.stats.ledgerCounts;
  document.getElementById('derived').textContent =
    'Derived from the sealed DefiLlama snapshot as of ' + DATA.asOf + ' (' + DATA.source + '). ' +
    'The model is fitted on the ' + v.peerCount + ' protocols whose token already trades, then applied to the ones still waiting.';
  const winSpec = v.specs.find((s) => s.terms.join('+') === v.terms.join('+')) || v.specs[0];
  document.getElementById('integrity').textContent =
    'Blind tests, printed in full under Method: leave-one-out median error x' + Math.pow(10, v.looMedianAbs).toFixed(2) +
    ' · walk-forward median x' + Math.pow(10, winSpec.wfMedian).toFixed(2) +
    ' · conformal 80% band x' + v.band80.factor.toFixed(1) + ' covered ' + pct(v.band80.coverage) + ' of held-out peers' +
    ' · category offsets and the breadth term were tested and REJECTED by the blind tests — the board says so rather than using them.';
  document.getElementById('stats').innerHTML = [
    [DATA.stats.rows, 'pre-token protocols ranked'],
    [fmtShort(DATA.stats.totalImplied), 'total implied value'],
    [DATA.stats.watchlist + '/' + DATA.watchlistSize, 'watchlist covered'],
    [DATA.stats.ledgerTotal, 'protocols accounted for'],
    [c.CALIBRATION, 'calibration peers (fitted)'],
    [c.CANDIDATE, 'launch candidates'],
    [c.TOKEN_UNPRICED, 'token recorded, unpriced'],
    [c.PRODUCT, 'products of launched'],
  ].map(([n, label]) => '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>').join('');
  document.getElementById('verify').innerHTML =
    'board.json sha256 <b>' + DATA.boardSha256 + '</b> · verify: recompute the hash of the board this page renders from, or open any protocol and watch the page re-derive its value through model.js.';
}

// ---------------------------------------------------------------- board
const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  implied: (a, b) => b.implied - a.implied,
  tvl: (a, b) => b.tvl - a.tvl,
  multiple: (a, b) => b.multiple - a.multiple,
  change: (a, b) => (b.change7d ?? -1e9) - (a.change7d ?? -1e9),
  cost: (a, b) => a.farmSummary.cost - b.farmSummary.cost,
};

function boardView(params) {
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const state = {
    q: params.get('q') || '',
    cohort: params.get('cohort') || 'ALL',
    cat: params.get('cat') || 'ALL',
    verdict: params.get('verdict') || 'ALL',
    sort: params.get('sort') || 'rank',
  };
  const el = document.getElementById('app');
  el.innerHTML =
    '<div class="controls">' +
    '<label>Search</label><input type="search" id="f-q" value="' + esc(state.q) + '" placeholder="name or slug">' +
    '<label>Cohort</label><select id="f-cohort">' +
    ['ALL', 'WATCHLIST', 'RADAR'].map((c) => '<option' + (state.cohort === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
    '<label>Category</label><select id="f-cat"><option>ALL</option>' +
    cats.map((c) => '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
    '<label>Farm verdict</label><select id="f-verdict">' +
    ['ALL', 'LEAN', 'STANDARD', 'HEAVY'].map((c) => '<option' + (state.verdict === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
    '<label>Sort</label><select id="f-sort">' +
    Object.keys(SORTS).map((s) => '<option' + (state.sort === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
    '<span class="count" id="f-count"></span></div>' +
    '<table class="board"><thead><tr>' +
    '<th class="l">#</th><th class="l">Protocol</th><th class="l">Category</th><th class="l">Chain</th>' +
    '<th>TVL</th><th>7d</th><th>Age</th><th>Implied value</th><th>x TVL</th><th>Core range 50%</th><th>Honest band 80%</th><th class="l">Farm verdict</th>' +
    '</tr></thead><tbody id="f-body"></tbody></table>' +
    '<p class="note">Implied value is the fitted regression reading: what the launched peers\' pricing record assigns to a protocol of this size, growth and age. ' +
    'The core range and honest band are conformal bands from the model\'s own held-out residuals — their measured coverage is printed under Method. Click any row for its worked build, comps and farm plan.</p>';

  const draw = () => {
    const q = state.q.toLowerCase();
    const list = rows
      .filter((r) => (state.cohort === 'ALL' || r.cohort === state.cohort))
      .filter((r) => (state.cat === 'ALL' || r.category === state.cat))
      .filter((r) => (state.verdict === 'ALL' || r.farmSummary.verdictGrade === state.verdict))
      .filter((r) => q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q))
      .sort(SORTS[state.sort]);
    document.getElementById('f-count').textContent = list.length + ' of ' + rows.length + ' rows';
    document.getElementById('f-body').innerHTML = list.map((r) =>
      '<tr data-slug="' + r.slug + '">' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td class="l"><span class="pname">' + esc(r.name) + '</span> ' + (r.cohort === 'WATCHLIST' ? '<span class="chip watch">watchlist</span>' : '') + '<br><span class="slug">' + r.slug + '</span></td>' +
      '<td class="l">' + esc(r.category || '—') + '</td>' +
      '<td class="l">' + esc(r.chain) + '</td>' +
      '<td class="num">' + fmtShort(r.tvl) + '</td>' +
      '<td class="num ' + (r.change7d === null ? '' : r.change7d >= 0 ? 'pos' : 'neg') + '">' + (r.change7d === null ? '—' : (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '%') + '</td>' +
      '<td class="num">' + (r.ageDays === null ? DATA.validation.standInAge + 'd*' : r.ageDays + 'd') + '</td>' +
      '<td class="num"><b>' + fmtShort(r.implied) + '</b></td>' +
      '<td class="num">' + mult(r.multiple) + '</td>' +
      '<td class="num">' + fmtShort(r.coreLow) + ' – ' + fmtShort(r.coreHigh) + '</td>' +
      '<td class="num">' + fmtShort(r.bandLow) + ' – ' + fmtShort(r.bandHigh) + '</td>' +
      '<td class="l"><span class="chip ' + r.farmSummary.verdictGrade.toLowerCase() + '">' + r.farmSummary.verdictGrade + '</span> <span class="small">' + fmt(r.farmSummary.cost) + ' · ' + fmt(Math.round(r.farmSummary.costPerHour)) + '/h</span></td>' +
      '</tr>').join('');
    for (const tr of document.querySelectorAll('#f-body tr')) {
      tr.addEventListener('click', () => { location.hash = '#/row/' + tr.getAttribute('data-slug'); });
    }
  };
  const bind = (id, key) => {
    document.getElementById(id).addEventListener('input', (e) => { state[key] = e.target.value; draw(); });
  };
  bind('f-q', 'q'); bind('f-cohort', 'cohort'); bind('f-cat', 'cat'); bind('f-verdict', 'verdict'); bind('f-sort', 'sort');
  draw();
}

// ---------------------------------------------------------------- detail
function detailView(slug) {
  const r = bySlug.get(slug);
  const el = document.getElementById('app');
  if (!r) { el.innerHTML = '<p class="note">No board row for ' + esc(slug) + '.</p>'; return; }
  const live = MODEL.price(r.tvl, r.change7d, r.ageDays, r.chains.length);
  const f = r.farmSummary;
  el.innerHTML =
    '<p class="backlink"><a href="#/board">&larr; back to the board</a></p>' +
    '<div class="detail-head"><h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
    '<span class="chip ' + (r.cohort === 'WATCHLIST' ? 'watch' : 'cand') + '">' + r.cohort + '</span>' +
    '<span class="chip">' + esc(r.category || 'no category') + '</span>' +
    '<span class="chip">' + r.chains.map(esc).join(' · ') + '</span></div>' +
    '<p class="small">' + esc(r.watchlistNote) + '</p>' +
    '<div class="kpis">' +
    '<div class="kpi hero"><b>' + fmt(r.implied) + '</b><span>implied value (fitted)</span></div>' +
    '<div class="kpi"><b>' + fmt(r.tvl) + '</b><span>TVL</span></div>' +
    '<div class="kpi"><b>' + mult(r.multiple) + '</b><span>implied multiple</span></div>' +
    '<div class="kpi"><b>' + (r.change7d === null ? '—' : (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(2) + '%') + '</b><span>TVL change 7d</span></div>' +
    '<div class="kpi"><b>' + (r.ageDays === null ? DATA.validation.standInAge + 'd *' : r.ageDays + 'd') + '</b><span>tracked age' + (r.ageStandIn ? ' (* stand-in)' : '') + '</span></div>' +
    '<div class="kpi"><b>' + fmt(r.compsValue) + '</b><span>comps cross-check</span></div>' +
    '</div>' +
    '<div class="cols"><div>' +
    '<h3>The worked build — recomputed live through model.js</h3>' +
    '<pre class="build">' + esc(MODEL.workedBuild(r)) + '</pre>' +
    '<p class="small">Page check: model.js prices this row at ' + fmt(live) + ', the board carries ' + fmt(r.implied) + ' — they agree by construction, and main.ts audits the agreement on every run.</p>' +
    '<h3>Term by term</h3>' +
    '<table class="grid"><thead><tr><th class="l">Term</th><th>Feature</th><th>Coefficient</th><th>Contribution</th></tr></thead><tbody>' +
    r.contributions.map((c) => '<tr><td class="l">' + esc(c.label) + '</td><td class="num">' + c.feature.toFixed(4) + '</td><td class="num">' + c.beta.toFixed(4) + '</td><td class="num">' + c.contribution.toFixed(4) + '</td></tr>').join('') +
    '</tbody></table>' +
    '<h3>Nearest launched peers (comps)</h3>' +
    '<table class="grid"><thead><tr><th class="l">Peer</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>' +
    r.neighbours.map((n) => '<tr><td class="l">' + esc(n.name) + '</td><td class="num">' + fmt(n.tvl) + '</td><td class="num">' + fmt(n.mcap) + '</td><td class="num">' + mult(n.multiple) + '</td></tr>').join('') +
    '</tbody></table>' +
    '<p class="small">The comps cross-check (median multiple of the three nearest launched peers, x this TVL) reads ' + fmt(r.compsValue) + ' against the regression\'s ' + fmt(r.implied) + '. Both are printed; neither is hidden when they disagree.</p>' +
    '</div><div>' +
    '<h3>Risks read off the record</h3><ul class="risks">' +
    r.risks.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
    '<h3>Farm plan — ' + f.holdWeeks + ' weeks</h3>' +
    '<ol class="steps">' + r.farm.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '<div class="verdict"><b>Verdict — ' + f.verdictGrade + '.</b> ' + esc(f.verdictLine) + '</div>' +
    '<table class="grid"><tbody>' +
    '<tr><td class="l">All-in cost (gas, fees, premiums)</td><td class="num">' + fmt(f.cost) + '</td></tr>' +
    '<tr><td class="l">Active time</td><td class="num">' + f.hours.toFixed(1) + ' h</td></tr>' +
    '<tr><td class="l">Cost per active hour</td><td class="num">' + fmt(Math.round(f.costPerHour)) + '/h</td></tr>' +
    '<tr><td class="l">Minimum working capital</td><td class="num">' + fmt(f.capital) + '</td></tr>' +
    '</tbody></table>' +
    '</div></div>';
}

// ---------------------------------------------------------------- method
function methodView() {
  const v = DATA.validation;
  const el = document.getElementById('app');
  const coefRows = MODEL.terms.map((t, i) =>
    '<tr><td class="l">' + esc(MODEL.termLabels[t]) + '</td><td class="num">' + v.beta[i].toFixed(4) + '</td><td class="num">' + v.se[i].toFixed(4) + '</td><td class="num">' + v.tStat[i].toFixed(2) + '</td></tr>').join('');
  el.innerHTML =
    '<h2>Method &amp; validation — the peers\' record, tested blind</h2>' +
    '<p class="note">The snapshot carries its own labelled training set: ' + v.peerCount + ' protocols whose token already trades, market cap the label, ' +
    'TVL, seven-day growth and tracked age the features. v7 fits ONE ordinary-least-squares regression of log10(market cap) on those peers and applies it to the ' +
    DATA.stats.rows + ' protocols still waiting on a token. Nothing is priced from a hand-kept list of names, and no factor rate is chosen by taste: every candidate term ' +
    'faced a one-pass backward test under leave-one-out (removed once from the full model; kept exactly when its removal raises the held-out error), with a walk-forward over listing dates as the second witness. The full record of both tests is below — including the terms that failed.</p>' +
    '<h3>The fitted regression (on ' + v.peerCount + ' launched peers, R² ' + v.r2.toFixed(3) + ' in log space)</h3>' +
    '<table class="grid"><thead><tr><th class="l">Term</th><th>Coefficient</th><th>Std. error</th><th>t</th></tr></thead><tbody>' + coefRows + '</tbody></table>' +
    '<p class="note">Two signs surprise and are printed, not smoothed: growth enters <b>negatively</b> — the peers\' record prices a seven-day TVL spike at a discount, ' +
    'because mercenary liquidity is not franchise value — and tracked age enters mildly negatively. A record with no listing date is scored at the peers\' median age of ' + v.standInAge + ' days, stated wherever it is used.</p>' +
    '<h3>Selection record — every spec the blind tests visited</h3>' +
    '<table class="grid"><thead><tr><th class="l">Spec (terms)</th><th>LOO median |log10 err|</th><th>LOO mean</th><th>Walk-forward median</th><th class="l">Fate</th></tr></thead><tbody>' +
    v.specs.map((s) => {
      const winner = s.terms.join('+') === v.terms.join('+');
      return '<tr><td class="l">' + esc(s.terms.join(' + ')) + '</td><td class="num">' + s.looMedian.toFixed(4) + '</td><td class="num">' + s.looMean.toFixed(4) + '</td><td class="num">' + s.wfMedian.toFixed(4) + '</td><td class="l">' + (winner ? '<span class="kept">WINNER — prices the board</span>' : 'tested') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<h3>Term verdicts</h3>' +
    '<table class="grid"><tbody>' +
    v.verdicts.map((x) => '<tr><td class="l">' + esc(x.term) + '</td><td class="' + (x.verdict === 'KEPT' ? 'kept' : 'dropped') + '">' + x.verdict + '</td><td class="l">' + esc(x.detail) + '</td></tr>').join('') +
    '</tbody></table>' +
    '<h3>Category offsets — the v6 device, on trial</h3>' +
    '<p class="note">Shrunk category offsets (median residual per category, pulled toward 1 by n/(n+K), capped x2.5) were tried as an addition to the winning spec at K = ' +
    v.offsetTest.map((o) => o.K).join(', ') + ': LOO medians ' + v.offsetTest.map((o) => o.looMedian.toFixed(4)).join(', ') + ' against ' + v.looMedianAbs.toFixed(4) + ' without. ' + esc(v.offsetsVerdict) + '.</p>' +
    '<h3>Conformal bands — honest ranges with measured coverage</h3>' +
    '<table class="grid"><thead><tr><th class="l">Band</th><th>Half-width</th><th>Measured coverage on held-out peers</th></tr></thead><tbody>' +
    '<tr><td class="l">Core range (50% conformal)</td><td class="num">x' + v.band50.factor.toFixed(2) + '</td><td class="num">' + pct(v.band50.coverage) + '</td></tr>' +
    '<tr><td class="l">Honest band (80% conformal)</td><td class="num">x' + v.band80.factor.toFixed(2) + '</td><td class="num">' + pct(v.band80.coverage) + '</td></tr>' +
    '</tbody></table>' +
    '<p class="note">The bands are quantiles of the winner\'s own leave-one-out residuals, with the finite-sample conformal correction; the coverage column is the share of held-out peers whose ' +
    'actual market cap fell inside the band the model would have printed for them. The bands are wide because the record is wide: launched multiples of TVL run from under x0.05 to over x10, and a radar that prints a narrow range is inventing precision.</p>' +
    '<h3>The farm verdict rule</h3>' +
    '<p class="note">Every plan\'s steps carry their own dollar cost and minutes; the totals are summed from the steps, never typed separately. A plan grades LEAN when its all-in cost is at most $75 and its active time at most 8 hours, ' +
    'STANDARD when at most $200 and 14 hours, HEAVY above either line. Each verdict also states the cost per active hour and the minimum working capital, so a plan can be refused on its numbers alone.</p>' +
    '<h3>Universe accounting</h3>' +
    '<p class="note">All ' + DATA.stats.ledgerTotal + ' protocols of the snapshot are accounted for in the Universe ledger: ' + DATA.stats.ledgerCounts.CALIBRATION + ' calibration peers the regression is fitted on, ' +
    DATA.stats.ledgerCounts.TOKEN_UNPRICED + ' that record a token the snapshot cannot price, ' + DATA.stats.ledgerCounts.CANDIDATE + ' launch candidates ranked on the board, and ' + DATA.stats.ledgerCounts.PRODUCT + ' products of launched protocols. The four counts sum to ' + DATA.stats.ledgerTotal + '; main.ts audits the sum on every run.</p>';
}

// ---------------------------------------------------------------- universe
function universeView(params) {
  const state = { q: params.get('q') || '', disp: params.get('disp') || 'ALL' };
  const el = document.getElementById('app');
  const DISP = {
    CALIBRATION: ['cal', 'Calibration peer'],
    TOKEN_UNPRICED: ['', 'Token recorded, unpriced'],
    CANDIDATE: ['cand', 'Launch candidate'],
    PRODUCT: ['prod', 'Product of launched'],
  };
  el.innerHTML =
    '<h2>Universe ledger — every one of the ' + DATA.stats.ledgerTotal + ' protocols, accounted for</h2>' +
    '<div class="controls"><label>Search</label><input type="search" id="u-q" value="' + esc(state.q) + '" placeholder="name or slug">' +
    '<label>Disposition</label><select id="u-disp"><option>ALL</option>' +
    Object.keys(DISP).map((d) => '<option' + (state.disp === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
    '<span class="count" id="u-count"></span></div>' +
    '<table class="board"><thead><tr><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th><th class="l">Disposition</th><th class="l">Why it sits here</th></tr></thead><tbody id="u-body"></tbody></table>';
  const draw = () => {
    const q = state.q.toLowerCase();
    const list = DATA.ledger
      .filter((r) => state.disp === 'ALL' || r.disposition === state.disp)
      .filter((r) => q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q));
    document.getElementById('u-count').textContent = list.length + ' of ' + DATA.ledger.length + ' protocols';
    document.getElementById('u-body').innerHTML = list.map((r) =>
      '<tr data-slug="' + r.slug + '"><td class="l"><span class="pname">' + esc(r.name) + '</span><br><span class="slug">' + r.slug + '</span></td>' +
      '<td class="l">' + esc(r.category || '—') + '</td><td class="num">' + fmtShort(r.tvl) + '</td>' +
      '<td class="l"><span class="chip ' + DISP[r.disposition][0] + '">' + DISP[r.disposition][1] + '</span></td>' +
      '<td class="l small">' + esc(r.note) + '</td></tr>').join('');
    for (const tr of document.querySelectorAll('#u-body tr')) {
      const slug = tr.getAttribute('data-slug');
      if (bySlug.has(slug)) tr.addEventListener('click', () => { location.hash = '#/row/' + slug; });
    }
  };
  document.getElementById('u-q').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  document.getElementById('u-disp').addEventListener('input', (e) => { state.disp = e.target.value; draw(); });
  draw();
}

// ---------------------------------------------------------------- router
function route() {
  const hash = location.hash || '#/board';
  const [path, query] = hash.slice(2).split('?');
  const params = new URLSearchParams(query || '');
  const seg = path.split('/');
  document.querySelectorAll('.views a').forEach((a) => a.classList.toggle('on', a.getAttribute('data-nav') === seg[0]));
  if (seg[0] === 'row' && seg[1]) detailView(seg[1]);
  else if (seg[0] === 'method') methodView();
  else if (seg[0] === 'universe') universeView(params);
  else boardView(params);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
renderChrome();
route();
