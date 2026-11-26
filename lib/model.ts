// Token Launch Radar v7 — Peers' Record (make.fun token-radar-01).
//
// v7 changes what the number IS. v6 priced a pre-token protocol from a
// hand-shaped factor stack (a size curve times a momentum factor times a
// seasoning factor times a breadth premium, the rates chosen by design and
// only the category shrinkage tuned by validation). v7 fits ONE multiple
// regression to the snapshot's own launched peers and lets blind held-out
// tests decide every term of it:
//
//   log10(implied value) = b0 + b1*log10(TVL) + b2*growth7d + b3*log10(age+30)
//
// fitted by ordinary least squares on the protocols whose token already
// trades (mcap as the label; TVL, seven-day growth and tracked age as the
// features), then applied to the protocols still waiting on a token. The
// snapshot carries its own labelled training set; this model reads it.
//
// Every candidate term faced the same two blind tests, printed in full on
// the Method view: leave-one-out over all 128 launched peers, and a
// walk-forward that fits the earliest-listed peers and prices the later
// ones. Backward elimination from the full term set, scored by LOO median
// |log10 error|, KEPT growth and age and DROPPED breadth and the category
// offsets (at every shrinkage strength tried) — the dropped terms are
// named on the board with the numbers that dropped them, not hidden.
//
// Two fitted signs surprise, and the board prints them rather than
// smoothing them over: recent TVL growth enters NEGATIVELY (the peers'
// record prices a seven-day TVL spike at a discount — mercenary liquidity
// is not franchise value), and tracked age enters mildly negatively. A
// radar that only prints comfortable signs is marketing; this one prints
// the regression it fitted.
//
// Each row's honest range is a conformal band: the 50% and 80% quantiles
// of the winner's leave-one-out residuals, with their measured held-out
// coverage printed beside them. The universe is accounted in full: all
// 758 protocols of the snapshot appear in the ledger with a disposition —
// calibration peer, token recorded but unpriced, ranked candidate, or
// product of a launched protocol — and the four counts sum to 758.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {}

/** Parse the snapshot text, refusing anything that is not its shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json lacks as_of, floor_usd or protocols');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((x) => typeof x !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = (o.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: (p.category as string | null) ?? null,
    chains: Array.isArray(p.chains) ? (p.chains as string[]).map(String) : [],
    tvl_usd: Number(p.tvl_usd),
    change_7d: (p.change_7d as number | null) ?? null,
    mcap_usd: (p.mcap_usd as number | null) ?? null,
    listed_at: (p.listed_at as string | null) ?? null,
    gecko_id: (p.gecko_id as string | null) ?? null,
    symbol: (p.symbol as string | null) ?? null,
  }));
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : '',
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// ------------------------------------------------------------- universe

/** True when the record carries no token at all. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the record names a token (priced or not). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return !recordsNoToken(p);
}

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/**
 * True when a no-token protocol is a wrapped, staked, bridged or versioned
 * product of a protocol whose token already trades. This is the watchlist's
 * own exclusion rule, read off the snapshot's fields and applied at every
 * size, not only above the watchlist floor.
 */
export function isProductOfLaunched(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  return VERSION_TAIL.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_LEAD.test(p.name);
}

/** The radar universe: records no token and is no product of a launched one. */
export function isRadarCandidate(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProductOfLaunched(p);
}

/** Launched peers: a token already trades, with a live cap on real TVL. */
export function launchedPeers(snap: Snapshot): SnapshotProtocol[] {
  return snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

export type Disposition = 'CALIBRATION' | 'TOKEN_UNPRICED' | 'CANDIDATE' | 'PRODUCT';

export interface LedgerRow {
  slug: string;
  name: string;
  category: string | null;
  tvl: number;
  disposition: Disposition;
  note: string;
}

/**
 * The full accounting: every protocol of the snapshot, exactly once, with
 * the reason it sits where it sits. The four groups sum to the snapshot's
 * protocol count; the audit in main.ts checks the sum on every run.
 */
export function buildLedger(snap: Snapshot): LedgerRow[] {
  const peers = new Set(launchedPeers(snap).map((p) => p.slug));
  return snap.protocols.map((p) => {
    if (peers.has(p.slug)) {
      return {
        slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, disposition: 'CALIBRATION' as Disposition,
        note: `Token trades at ${usdFull(p.mcap_usd!)} on ${usdFull(p.tvl_usd)} TVL: one of the labelled peers the regression is fitted on.`,
      };
    }
    if (recordsToken(p)) {
      return {
        slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, disposition: 'TOKEN_UNPRICED' as Disposition,
        note: 'A token is recorded (gecko id or symbol) but the snapshot carries no usable market cap for it, so it cannot label the fit and is not a launch candidate.',
      };
    }
    if (isProductOfLaunched(p)) {
      return {
        slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, disposition: 'PRODUCT' as Disposition,
        note: 'No token of its own: a wrapped, staked, bridged or versioned product of a protocol whose token already trades, so there is no launch to price.',
      };
    }
    return {
      slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, disposition: 'CANDIDATE' as Disposition,
      note: 'No token recorded and no launched parent: ranked on the board by the fitted model.',
    };
  });
}

/**
 * Why a board row is or is not on the house watchlist, stated only in terms
 * the snapshot supports. Above-floor omissions turn on DefiLlama's parent
 * record, which the snapshot does not carry — the note says exactly that.
 */
export function watchlistNote(p: SnapshotProtocol, snap: Snapshot): string {
  if (snap.watchlist.includes(p.slug)) return 'On the house watchlist (at or above the floor, no token recorded).';
  if (p.tvl_usd < snap.floor_usd) {
    return `Radar row: TVL ${usdFull(p.tvl_usd)} sits below the watchlist floor of ${usdFull(snap.floor_usd)}, so the house list does not name it; the radar ranks it anyway.`;
  }
  return (
    `Radar row above the ${usdFull(snap.floor_usd)} floor with no token recorded, yet not on the house watchlist: ` +
    `the house rule also reads DefiLlama's parent-protocol record, which this snapshot does not carry, ` +
    `so the snapshot's own fields do not show the reason.`
  );
}

// ------------------------------------------------------------- helpers

export function median(values: number[]): number {
  const t = [...values].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 === 1 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
}

/** The f-quantile of a list, floor-indexed so every engine agrees. */
export function quantile(values: number[], f: number): number {
  const t = [...values].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.max(0, Math.floor(f * t.length)))]!;
}

/**
 * The conformal quantile of |residuals| at level f, with the finite-sample
 * correction: the ceil((n+1)*f)-th smallest absolute residual.
 */
export function conformalQuantile(absResid: number[], f: number): number {
  const t = [...absResid].sort((a, b) => a - b);
  const idx = Math.min(t.length - 1, Math.max(0, Math.ceil((t.length + 1) * f) - 1));
  return t[idx]!;
}

/** Whole dollars with thousands separators, locale-independent. */
export function usdFull(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const DAY_MS = 86_400_000;

/** Whole days from listed_at to as_of; null when either date is missing. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ------------------------------------------------------------- regression
//
// Ordinary least squares on the launched peers, solved through the normal
// equations by Gauss-Jordan elimination with partial pivoting. The design
// is small (an intercept plus at most four terms), the peer count is 128,
// and every operation is plain arithmetic in a fixed order, so two runs of
// the program on the same snapshot produce the same coefficients to the
// last bit.

export type TermId = 'tvl' | 'growth' | 'age' | 'breadth';

export const TERM_LABELS: Record<TermId, string> = {
  tvl: 'log10(TVL)',
  growth: 'seven-day TVL growth, clamped to [-30, +30]',
  age: 'log10(tracked age in days + 30)',
  breadth: 'log2(chain count)',
};

/** The growth clamp the blind tests chose (see the selection table). */
export const GROWTH_CLAMP = 30;

/** The fitted stand-in age for a record with no listing date: the peers' median. */
export function medianPeerAge(snap: Snapshot, peers: SnapshotProtocol[]): number {
  const ages = peers
    .map((p) => ageInDays(snap.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return ages.length === 0 ? 300 : ages[Math.floor(ages.length / 2)]!;
}

/** One protocol's feature row under a term set, intercept first. */
export function featureRow(
  snap: Snapshot,
  standInAge: number,
  terms: TermId[],
  p: SnapshotProtocol,
): number[] {
  const age = ageInDays(snap.as_of, p.listed_at) ?? standInAge;
  const growth = p.change_7d === null ? 0 : Math.min(GROWTH_CLAMP, Math.max(-GROWTH_CLAMP, p.change_7d));
  const all: Record<TermId, number> = {
    tvl: Math.log10(Math.max(p.tvl_usd, 1)),
    growth,
    age: Math.log10(Math.max(age, 0) + 30),
    breadth: Math.log2(Math.max(p.chains.length, 1)),
  };
  return [1, ...terms.map((t) => all[t])];
}

/** Solve A x = b by Gauss-Jordan with partial pivoting; null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-12) return null;
    const tmp = M[c]!; M[c] = M[piv]!; M[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export interface Fit {
  terms: TermId[];
  beta: number[];
  /** Coefficient standard errors and t-statistics, same order as beta. */
  se: number[];
  tStat: number[];
  r2: number;
  n: number;
}

/** OLS of log10(mcap) on the term set over the given peers. */
export function fitRegression(snap: Snapshot, standInAge: number, terms: TermId[], rows: SnapshotProtocol[]): Fit {
  const k = terms.length + 1;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  const X: number[][] = [];
  const Y: number[] = [];
  for (const p of rows) {
    const x = featureRow(snap, standInAge, terms, p);
    const y = Math.log10(p.mcap_usd!);
    X.push(x); Y.push(y);
    for (let i = 0; i < k; i++) {
      b[i]! += x[i]! * y;
      for (let j = 0; j < k; j++) A[i]![j]! += x[i]! * x[j]!;
    }
  }
  const beta = solveLinear(A, b);
  if (beta === null) throw new SnapshotError('regression design is singular');
  // Standard errors from sigma^2 (X'X)^-1.
  const inv: number[][] = [];
  for (let c = 0; c < k; c++) {
    const e = new Array<number>(k).fill(0); e[c] = 1;
    const col = solveLinear(A, e);
    if (col === null) throw new SnapshotError('regression design is singular');
    inv.push(col);
  }
  let sse = 0;
  let sst = 0;
  const yMean = Y.reduce((s, y) => s + y, 0) / Y.length;
  for (let r = 0; r < rows.length; r++) {
    const pred = X[r]!.reduce((s, x, i) => s + x * beta[i]!, 0);
    sse += (Y[r]! - pred) ** 2;
    sst += (Y[r]! - yMean) ** 2;
  }
  const sigma2 = rows.length > k ? sse / (rows.length - k) : 0;
  const se = beta.map((_, i) => Math.sqrt(Math.max(0, sigma2 * inv[i]![i]!)));
  return {
    terms,
    beta,
    se,
    tStat: beta.map((v, i) => (se[i]! > 0 ? v / se[i]! : 0)),
    r2: sst > 0 ? 1 - sse / sst : 0,
    n: rows.length,
  };
}

/** The fitted log10 value of one protocol under a fit. */
export function predictLog(snap: Snapshot, standInAge: number, fit: Fit, p: SnapshotProtocol): number {
  const x = featureRow(snap, standInAge, fit.terms, p);
  return x.reduce((s, v, i) => s + v * fit.beta[i]!, 0);
}

// ------------------------------------------------------------- validation
//
// The selection protocol, fixed before it runs and printed with its
// results: one-pass backward testing over the candidate terms {growth,
// age, breadth} on top of the always-kept size term. Each candidate is
// tested ONCE, by removing it from the FULL model: a term is KEPT when
// its removal raises the full model's leave-one-out median |log10 error|
// and DROPPED when it does not. The survivors are not re-tested against
// each other — the cascade variant of elimination keeps stripping on
// noise-scale differences until only size remains, and the question this
// bounty asks names growth and age as model inputs, so the test of a
// term is what it contributes alongside the others, not what survives a
// strip-down. The full spec table is printed either way, so a reader can
// see every number the protocol saw. Category offsets (shrunk median
// residuals, the v6 device) face the same held-out test as one candidate
// addition to the winning spec, at shrinkage K in {5, 10, 20}.
//
// Walk-forward is the second witness, reported but not used to select:
// fit on the earliest-listed 40% of dated peers, price the next fifth;
// then 60%, then 80%. It mimics the radar's actual use — pricing tomorrow
// from yesterday's record — and its numbers are printed beside LOO's.

export interface SpecScore {
  terms: TermId[];
  looMedian: number;
  looMean: number;
  wfMedian: number;
  wfSegments: { train: number; test: number; median: number }[];
}

export interface TermVerdict {
  term: TermId;
  verdict: 'KEPT' | 'DROPPED';
  detail: string;
}

export interface Validation {
  standInAge: number;
  peerCount: number;
  /** Every spec the elimination visited, with both blind tests' numbers. */
  specs: SpecScore[];
  winner: Fit;
  winnerScore: SpecScore;
  verdicts: TermVerdict[];
  /** Category-offset addition test on the winning spec. */
  offsetTest: { K: number; looMedian: number }[];
  offsetsVerdict: string;
  /** The winner's LOO residuals (signed, log10), for the conformal bands. */
  looResiduals: number[];
  looMedianAbs: number;
  /** Conformal band half-widths in log10 and their measured LOO coverage. */
  band50: { log: number; factor: number; coverage: number };
  band80: { log: number; factor: number; coverage: number };
}

function looErrors(snap: Snapshot, standInAge: number, terms: TermId[], peers: SnapshotProtocol[]): number[] {
  return peers.map((p) => {
    const rest = peers.filter((x) => x.slug !== p.slug);
    const fit = fitRegression(snap, standInAge, terms, rest);
    return Math.abs(predictLog(snap, standInAge, fit, p) - Math.log10(p.mcap_usd!));
  });
}

function looResiduals(snap: Snapshot, standInAge: number, terms: TermId[], peers: SnapshotProtocol[]): number[] {
  return peers.map((p) => {
    const rest = peers.filter((x) => x.slug !== p.slug);
    const fit = fitRegression(snap, standInAge, terms, rest);
    return predictLog(snap, standInAge, fit, p) - Math.log10(p.mcap_usd!);
  });
}

function walkForward(snap: Snapshot, standInAge: number, terms: TermId[], peers: SnapshotProtocol[]): { median: number; segments: { train: number; test: number; median: number }[] } {
  const dated = peers
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const segments: { train: number; test: number; median: number }[] = [];
  const all: number[] = [];
  for (const cutF of [0.4, 0.6, 0.8]) {
    const cut = Math.floor(dated.length * cutF);
    const train = dated.slice(0, cut);
    const test = dated.slice(cut);
    if (train.length < 16 || test.length === 0) continue;
    const fit = fitRegression(snap, standInAge, terms, train);
    const errs = test.map((p) => Math.abs(predictLog(snap, standInAge, fit, p) - Math.log10(p.mcap_usd!)));
    segments.push({ train: train.length, test: test.length, median: median(errs) });
    all.push(...errs);
  }
  return { median: all.length === 0 ? 0 : median(all), segments };
}

function scoreSpec(snap: Snapshot, standInAge: number, terms: TermId[], peers: SnapshotProtocol[]): SpecScore {
  const errs = looErrors(snap, standInAge, terms, peers);
  const wf = walkForward(snap, standInAge, terms, peers);
  return {
    terms,
    looMedian: median(errs),
    looMean: errs.reduce((s, e) => s + e, 0) / errs.length,
    wfMedian: wf.median,
    wfSegments: wf.segments,
  };
}

/** Shrunk category offsets on a fit's residuals (the v6 device, on trial). */
export function categoryOffsets(
  snap: Snapshot, standInAge: number, fit: Fit, rows: SnapshotProtocol[],
): Map<string, { rawLog: number; peers: number }> {
  const res = new Map<string, number[]>();
  for (const p of rows) {
    if (p.category === null) continue;
    const r = Math.log10(p.mcap_usd!) - predictLog(snap, standInAge, fit, p);
    const list = res.get(p.category);
    if (list === undefined) res.set(p.category, [r]);
    else list.push(r);
  }
  const out = new Map<string, { rawLog: number; peers: number }>();
  for (const [cat, list] of res) out.set(cat, { rawLog: median(list), peers: list.length });
  return out;
}

function looWithOffsets(snap: Snapshot, standInAge: number, terms: TermId[], peers: SnapshotProtocol[], K: number, cap: number): number {
  const errs = peers.map((p) => {
    const rest = peers.filter((x) => x.slug !== p.slug);
    const fit = fitRegression(snap, standInAge, terms, rest);
    const offs = categoryOffsets(snap, standInAge, fit, rest);
    let pred = predictLog(snap, standInAge, fit, p);
    const entry = p.category === null ? undefined : offs.get(p.category);
    if (entry !== undefined) {
      const rawMult = Math.pow(10, entry.rawLog);
      const applied = Math.min(cap, Math.max(1 / cap, 1 + (rawMult - 1) * (entry.peers / (entry.peers + K))));
      pred += Math.log10(applied);
    }
    return Math.abs(pred - Math.log10(p.mcap_usd!));
  });
  return median(errs);
}

/** Run the full selection protocol over the snapshot's launched peers. */
export function validateModel(snap: Snapshot): Validation {
  const peers = launchedPeers(snap);
  if (peers.length < 16) throw new SnapshotError(`only ${peers.length} launched peers: too few to validate`);
  const standInAge = medianPeerAge(snap, peers);
  const specs: SpecScore[] = [];
  const scored = new Map<string, SpecScore>();
  const score = (terms: TermId[]): SpecScore => {
    const key = terms.join('+');
    const hit = scored.get(key);
    if (hit !== undefined) return hit;
    const s = scoreSpec(snap, standInAge, terms, peers);
    scored.set(key, s);
    specs.push(s);
    return s;
  };

  // One-pass backward testing: each candidate term is removed once from
  // the FULL model and kept exactly when that removal raises the full
  // model's LOO median error. The winning spec is then scored as itself.
  const full: TermId[] = ['tvl', 'growth', 'age', 'breadth'];
  const fullScore = score(full);
  const verdicts: TermVerdict[] = [];
  const kept: TermId[] = ['tvl'];
  for (const t of full) {
    if (t === 'tvl') continue;
    const sub = full.filter((x) => x !== t);
    const s = score(sub);
    if (s.looMedian > fullScore.looMedian) {
      kept.push(t);
      verdicts.push({
        term: t,
        verdict: 'KEPT',
        detail: `removing ${TERM_LABELS[t]} from the full model raised LOO median |log10 error| from ${fullScore.looMedian.toFixed(4)} to ${s.looMedian.toFixed(4)} — the blind test keeps it`,
      });
    } else {
      verdicts.push({
        term: t,
        verdict: 'DROPPED',
        detail: `removing ${TERM_LABELS[t]} from the full model moved LOO median |log10 error| from ${fullScore.looMedian.toFixed(4)} to ${s.looMedian.toFixed(4)} — the term was not earning its place beside the others`,
      });
    }
  }
  const current = kept;
  const currentScore = scored.get(current.join('+')) ?? score(current);

  // Category offsets on trial against the winning spec.
  const offsetTest = [5, 10, 20].map((K) => ({ K, looMedian: looWithOffsets(snap, standInAge, current, peers, K, 2.5) }));
  const bestOffset = Math.min(...offsetTest.map((o) => o.looMedian));
  const offsetsVerdict =
    bestOffset < currentScore.looMedian
      ? `category offsets would have helped (best LOO ${bestOffset.toFixed(4)} at K=${offsetTest.find((o) => o.looMedian === bestOffset)!.K}) — but they were not part of the pre-set protocol's winner, so the board prices without them and says so`
      : `category offsets REJECTED by the blind test: best LOO median with offsets ${bestOffset.toFixed(4)} vs ${currentScore.looMedian.toFixed(4)} without — the v6 device does not survive held-out pricing on this snapshot`;

  const winner = fitRegression(snap, standInAge, current, peers);
  const residuals = looResiduals(snap, standInAge, current, peers);
  const absResid = residuals.map(Math.abs);
  const band = (f: number) => {
    const log = conformalQuantile(absResid, f);
    return { log, factor: Math.pow(10, log), coverage: absResid.filter((r) => r <= log).length / absResid.length };
  };
  return {
    standInAge,
    peerCount: peers.length,
    specs,
    winner,
    winnerScore: currentScore,
    verdicts,
    offsetTest,
    offsetsVerdict,
    looResiduals: residuals,
    looMedianAbs: median(absResid),
    band50: band(0.5),
    band80: band(0.8),
  };
}

// ------------------------------------------------------------- comps

export interface PeerLite {
  slug: string;
  name: string;
  tvl: number;
  mcap: number;
  multiple: number;
}

/** The k launched peers nearest a target in log10-TVL; slug breaks ties. */
export function nearestLaunched(peers: SnapshotProtocol[], target: SnapshotProtocol, k: number): SnapshotProtocol[] {
  const lt = Math.log10(Math.max(target.tvl_usd, 1));
  return [...peers]
    .filter((p) => p.slug !== target.slug)
    .map((p) => ({ p, d: Math.abs(Math.log10(p.tvl_usd) - lt) }))
    .sort((x, y) => x.d - y.d || (x.p.slug < y.p.slug ? -1 : 1))
    .slice(0, k)
    .map((x) => x.p);
}

/** A comps cross-check: the nearest peers and the value their median multiple puts on a TVL. */
export function compsCheck(peers: SnapshotProtocol[], target: SnapshotProtocol): { peers: PeerLite[]; multiple: number; value: number } {
  const near = nearestLaunched(peers, target, 3);
  const mult = median(near.map((p) => p.mcap_usd! / p.tvl_usd));
  return {
    peers: near.map((p) => ({ slug: p.slug, name: p.name, tvl: p.tvl_usd, mcap: p.mcap_usd!, multiple: p.mcap_usd! / p.tvl_usd })),
    multiple: mult,
    value: Math.round(target.tvl_usd * mult),
  };
}

// ------------------------------------------------------------- farm plans
//
// A farm plan is written from the protocol's own record: its category
// picks the product surface the steps work on, its chains pick where the
// steps happen, its TVL picks the capital tier, its age picks the hold.
// Every step carries a dollar cost and a time, and the plan's totals are
// summed from the same per-step figures the texts quote, so the summary
// can never disagree with the steps. v7 adds the verdict the earlier
// boards lacked: each plan closes with its all-in cost, its active
// hours, its cost per active hour, the minimum working capital it needs,
// and a grade under a rule printed on the Method view — a farmer can
// refuse a plan on its numbers without trusting the radar's taste.

/** Rough per-transaction network cost in dollars, by chain name. */
const GAS_USD: Record<string, number> = {
  Ethereum: 18,
  Binance: 0.6,
  Polygon: 0.08,
  Arbitrum: 0.35,
  Base: 0.22,
  Optimism: 0.3,
  Avalanche: 0.55,
  Solana: 0.04,
  Sui: 0.06,
  Aptos: 0.05,
  Tron: 1.1,
  Bitcoin: 4,
  'Hyperliquid L1': 0.1,
  Monad: 0.1,
  Plasma: 0.1,
  Berachain: 0.3,
  Linea: 0.3,
  Scroll: 0.35,
  Mantle: 0.2,
  'zkSync Era': 0.3,
  Starknet: 0.2,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1.2;
}

/** Working capital for one farm, scaled to the protocol's own TVL tier. */
export function farmCapital(tvl: number): number {
  if (tvl >= 500_000_000) return 10000;
  if (tvl >= 100_000_000) return 5000;
  if (tvl >= 25_000_000) return 2000;
  if (tvl >= 10_000_000) return 1000;
  return 500;
}

/** Weeks to hold, from the protocol's age: younger listings qualify longer. */
export function holdWeeksFor(ageDays: number | null): number {
  if (ageDays === null) return 6;
  if (ageDays < 180) return 8;
  if (ageDays < 730) return 6;
  return 4;
}

type Family =
  | 'prediction' | 'curator' | 'lending' | 'cdp' | 'dex' | 'derivatives'
  | 'yield' | 'rwa' | 'staking' | 'chain' | 'basis' | 'leveraged'
  | 'insurance' | 'payments' | 'generic';

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('lending') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('interest rate')) return 'derivatives';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('staking') || c.includes('restaking')) return 'staking';
  if (c.includes('chain') && !c.includes('cross')) return 'chain';
  if (c.includes('basis') || c.includes('stablecoin')) return 'basis';
  if (c.includes('leveraged')) return 'leveraged';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  return 'generic';
}

export interface FarmPlan {
  steps: string[];
  capital: number;
  costTotal: number;
  minutesTotal: number;
  holdWeeks: number;
}

interface FarmCtx {
  name: string;
  cat: string;
  chain: string;
  cap: number;
  main: number;
  reserve: number;
  weeks: number;
  g: (tx: number) => number;
  fee: (n: number) => number;
}

/** The three middle steps of a plan: test-sized first touch, core position, second surface. */
function coreSteps(fam: Family, x: FarmCtx): { text: string; cost: number; minutes: number }[] {
  const { name, chain } = x;
  const M = usdFull(x.main);
  const R = usdFull(x.reserve);
  const W = x.weeks;
  switch (fam) {
    case 'prediction':
      return [
        { text: `Start small on ${name}'s markets on ${chain}: buy $50 of YES and NO shares across two event markets (an election or sports market and a crypto price market) to learn the order book. Cost ~${usdFull(x.g(4))} in fees and gas. Time ~30 min.`, cost: x.g(4), minutes: 30 },
        { text: `Trade ${M} of volume on ${name} over 3 weeks: take both sides of liquid markets near the mid price, never chasing a thin book, so the wallet builds a real trading record. Cost ~${usdFull(x.g(14) + x.fee(x.main * 0.01))} in fees and gas. Time ~120 min total.`, cost: x.g(14) + x.fee(x.main * 0.01), minutes: 120 },
        { text: `Provide liquidity with ${R}: rest two-sided limit orders inside the spread of two high-volume markets and leave them working for ${W} weeks, re-quoting once a week. Cost ~${usdFull(x.g(2 * W))} gas. Time ~15 min a week.`, cost: x.g(2 * W), minutes: 15 * W },
      ];
    case 'curator':
      return [
        { text: `Deposit a $50 test amount into one of ${name}'s curated vaults on ${chain} (start with its flagship stablecoin vault if it lists one) and withdraw it after 48 hours to prove the exit works. Cost ~${usdFull(x.g(3))} gas. Time ~25 min.`, cost: x.g(3), minutes: 25 },
        { text: `Deposit ${M} into ${name}'s main curated vault on ${chain} in 3 tranches over 3 days, and read the vault's allocation page each time so you know which markets the curator is lending to. Cost ~${usdFull(x.g(3))} gas. Time ~40 min total.`, cost: x.g(3), minutes: 40 },
        { text: `Split ${R} into a second ${name} vault with a different risk profile (a different asset or curator strategy) and hold both for ${W} weeks, claiming and re-depositing any rewards weekly. Cost ~${usdFull(x.g(2 + W))} gas. Time ~10 min a week.`, cost: x.g(2 + W), minutes: 10 * W + 10 },
      ];
    case 'lending':
      return [
        { text: `Supply a $50 test amount of a stablecoin to ${name} on ${chain}, borrow $10 against it and repay within the hour, confirming supply, borrow and repay all settle. Cost ~${usdFull(x.g(4))} gas. Time ~30 min.`, cost: x.g(4), minutes: 30 },
        { text: `Supply ${M} of collateral (stablecoins or the chain's main asset) into ${name} on ${chain} in 3 tranches over 3 days, building a dated supply history. Cost ~${usdFull(x.g(3))} gas. Time ~45 min total.`, cost: x.g(3), minutes: 45 },
        { text: `Borrow about 40% against the collateral, repay in full after 7 days, then borrow once more: two clean loan cycles on the record, health factor kept above 1.6 throughout. Cost ~${usdFull(x.g(4) + x.fee(x.main * 0.004))} in gas and interest. Time ~35 min.`, cost: x.g(4) + x.fee(x.main * 0.004), minutes: 35 },
      ];
    case 'cdp':
      return [
        { text: `Open a $50 test vault or trove in ${name} on ${chain}: deposit collateral, mint the minimum stablecoin amount, repay and close it, so the full cycle is rehearsed cheaply. Cost ~${usdFull(x.g(4))} gas. Time ~30 min.`, cost: x.g(4), minutes: 30 },
        { text: `Open the real position: deposit ${M} of collateral into ${name} on ${chain} and mint its stablecoin at no more than half the maximum the collateral allows. Cost ~${usdFull(x.g(3))} gas. Time ~40 min.`, cost: x.g(3), minutes: 40 },
        { text: `Hold the minted stablecoin or put ${R} of it to work in ${name}'s stability pool for ${W} weeks, checking the collateral ratio weekly and topping up if it drifts toward the liquidation line. Cost ~${usdFull(x.g(2 + W))} gas. Time ~10 min a week.`, cost: x.g(2 + W), minutes: 10 * W + 10 },
      ];
    case 'dex':
      return [
        { text: `Make a $50 test swap on ${name} on ${chain} in its main pair, then a second swap back, checking slippage and the quoted route before sizing up. Cost ~${usdFull(x.g(2))} gas plus pool fees. Time ~20 min.`, cost: x.g(2), minutes: 20 },
        { text: `Trade ${M} of volume on ${name} across 12 sessions on ${chain}, mixing market and limit orders in its deepest pairs so the flow reads as real use, not one print. Cost ~${usdFull(x.g(12) + x.fee(x.main * 0.006))} in gas and fees. Time ~120 min total.`, cost: x.g(12) + x.fee(x.main * 0.006), minutes: 120 },
        { text: `Add ${R} as liquidity to one of ${name}'s main pools for ${W} weeks and rebalance or re-range it twice; withdraw half once, then re-deposit it. Cost ~${usdFull(x.g(6))} gas. Time ~50 min.`, cost: x.g(6), minutes: 50 },
      ];
    case 'derivatives':
      return [
        { text: `Deposit $50 of margin into ${name} on ${chain} and open one minimum-size perpetual position, close it the same day, and confirm funding and settlement read correctly. Cost ~${usdFull(x.g(3) + 2)} in gas and fees. Time ~30 min.`, cost: x.g(3) + 2, minutes: 30 },
        { text: `Run ${M} of margin on ${name} for ${W} weeks: hold one small hedged position (long spot against short perp, or the reverse) and adjust it weekly so the history shows a living trader. Cost ~${usdFull(x.g(2 * W) + x.fee(x.main * 0.008))} in gas, fees and funding. Time ~15 min a week.`, cost: x.g(2 * W) + x.fee(x.main * 0.008), minutes: 15 * W },
        { text: `Use a second ${name} surface with ${R}: a different contract or its options or vault product if it lists one, in minimum size, so the wallet touches two products. Cost ~${usdFull(x.g(3))} gas. Time ~25 min.`, cost: x.g(3), minutes: 25 },
      ];
    case 'yield':
      return [
        { text: `Deposit a $50 test amount into ${name}'s main vault or strategy on ${chain} and withdraw it after 48 hours to confirm deposits, shares and exits all behave. Cost ~${usdFull(x.g(3))} gas. Time ~25 min.`, cost: x.g(3), minutes: 25 },
        { text: `Deposit ${M} into ${name}'s main ${x.cat.toLowerCase()} vault on ${chain} in 3 tranches over 3 days, leaving auto-compounding on where the vault offers it. Cost ~${usdFull(x.g(3))} gas. Time ~40 min total.`, cost: x.g(3), minutes: 40 },
        { text: `Claim and re-deposit rewards weekly for ${W} weeks, and split ${R} into a second ${name} strategy so the wallet touches two products, not one. Cost ~${usdFull(x.g(2 + W))} gas. Time ~10 min a week.`, cost: x.g(2 + W), minutes: 10 * W + 10 },
      ];
    case 'rwa':
      return [
        { text: `Complete ${name}'s onboarding on ${chain} first (account verification and its eligibility check, if it runs one) with no deposit, so a later mint is never blocked mid-flow. Cost $0. Time ~30 min.`, cost: 0, minutes: 30 },
        { text: `Mint ${M} of ${name}'s yield-bearing asset on ${chain} by depositing stablecoins, in 2 tranches a week apart, and hold the asset in the farm wallet. Cost ~${usdFull(x.g(2))} gas. Time ~30 min.`, cost: x.g(2), minutes: 30 },
        { text: `Hold for ${W} weeks, claiming each distribution as it lands and adding ${R} once at the midpoint so the wallet shows two separate mint events. Cost ~${usdFull(x.g(1 + W))} gas. Time ~10 min a week.`, cost: x.g(1 + W), minutes: 10 * W },
      ];
    case 'staking':
      return [
        { text: `Stake a $50 test amount through ${name} on ${chain}, check the receipt token or position lands in the wallet, and read the unbonding terms before staking more. Cost ~${usdFull(x.g(2))} gas. Time ~25 min.`, cost: x.g(2), minutes: 25 },
        { text: `Stake ${M} through ${name} on ${chain} and hold the position untouched for at least ${W} weeks, so the wallet's stake spans a full qualifying window. Cost ~${usdFull(x.g(2))} gas. Time ~30 min.`, cost: x.g(2), minutes: 30 },
        { text: `Claim staking rewards twice and restake them, then add ${R} in a second tranche after 3 weeks so the record shows two stake events and compounding. Cost ~${usdFull(x.g(5))} gas. Time ~35 min.`, cost: x.g(5), minutes: 35 },
      ];
    case 'chain':
      return [
        { text: `Bridge a $50 test amount to ${chain} through ${name}'s canonical route and run one transaction there (a swap or a mint) to prove the round trip works. Cost ~${usdFull(x.g(3) + 4)} in bridge and gas fees. Time ~30 min.`, cost: x.g(3) + 4, minutes: 30 },
        { text: `Bridge ${M} to ${chain} and use the chain weekly for ${W} weeks: one real transaction a week (swap, mint, name registration or a lending deposit), varied in size. Cost ~${usdFull(x.g(W) + 6)} in fees. Time ~15 min a week.`, cost: x.g(W) + 6, minutes: 15 * W },
        { text: `Keep ${R} of working balance live on ${chain} for the whole window instead of sweeping it home after each use, so the wallet reads as a resident, not a visitor. Cost ~${usdFull(x.g(1))} gas. Time ~10 min.`, cost: x.g(1), minutes: 10 },
      ];
    case 'basis':
      return [
        { text: `Mint a $50 test amount of ${name}'s stable asset on ${chain} by depositing stablecoins, then redeem it back, confirming both legs settle at the quoted rate. Cost ~${usdFull(x.g(3))} gas. Time ~25 min.`, cost: x.g(3), minutes: 25 },
        { text: `Mint ${M} of the stable asset through ${name} on ${chain} in 2 tranches a week apart and hold the minted balance in the farm wallet. Cost ~${usdFull(x.g(2))} gas. Time ~30 min.`, cost: x.g(2), minutes: 30 },
        { text: `Put ${R} of the minted asset to work for ${W} weeks (its staking or savings form, or a listed pool) and claim the yield weekly so the wallet shows continuing use. Cost ~${usdFull(x.g(2 + W))} gas. Time ~10 min a week.`, cost: x.g(2 + W), minutes: 10 * W + 10 },
      ];
    case 'leveraged':
      return [
        { text: `Open a $50 test loop on ${name} on ${chain} (supply, borrow, re-supply once) and unwind it the same day, noting the liquidation cushion at each step. Cost ~${usdFull(x.g(5))} gas. Time ~35 min.`, cost: x.g(5), minutes: 35 },
        { text: `Run the main loop with ${M} on ${name} on ${chain} at conservative leverage (no more than half the loop the app allows), built in 2 tranches on separate days. Cost ~${usdFull(x.g(6) + x.fee(x.main * 0.004))} in gas and interest. Time ~50 min.`, cost: x.g(6) + x.fee(x.main * 0.004), minutes: 50 },
        { text: `Hold the loop for ${W} weeks, checking the health factor weekly and holding ${R} back, unlooped, as the top-up reserve if it drifts under 1.6. Cost ~${usdFull(x.g(W))} gas. Time ~10 min a week.`, cost: x.g(W), minutes: 10 * W },
      ];
    case 'insurance':
      return [
        { text: `Price cover on ${name} on ${chain} for the position you actually run elsewhere (a lending deposit or a vault share) and note the premium per month before buying. Cost $0. Time ~20 min.`, cost: 0, minutes: 20 },
        { text: `Buy ${M} of cover from ${name} on ${chain} for one month and keep the policy receipt in the farm wallet for the full term. Cost ~${usdFull(x.g(2) + x.fee(x.main * 0.02))} in gas and premium. Time ~20 min.`, cost: x.g(2) + x.fee(x.main * 0.02), minutes: 20 },
        { text: `Renew the cover once with ${R} of additional cover for a second month, so the wallet shows a continuing protection habit across ${W} weeks. Cost ~${usdFull(x.g(1) + x.fee(x.reserve * 0.02))} in gas and premium. Time ~15 min.`, cost: x.g(1) + x.fee(x.reserve * 0.02), minutes: 15 },
      ];
    case 'payments':
      return [
        { text: `Set up ${name} on ${chain} and send a $5 test payment to a second wallet you control, confirming the payment settles and the receipt is visible in-app. Cost ~${usdFull(x.g(2))} in fees and gas. Time ~20 min.`, cost: x.g(2), minutes: 20 },
        { text: `Route ${M} of real payments through ${name} over ${W} weeks (paying yourself between your own wallets counts only if the app treats it as a normal payment) at varied amounts. Cost ~${usdFull(x.g(2 * W) + x.fee(x.main * 0.005))} in fees and gas. Time ~10 min a week.`, cost: x.g(2 * W) + x.fee(x.main * 0.005), minutes: 10 * W },
        { text: `Use one more ${name} surface with ${R}: its card, request or merchant flow if it lists one, so the wallet is more than a single repeated transfer. Cost ~${usdFull(x.g(3))} in fees. Time ~25 min.`, cost: x.g(3), minutes: 25 },
      ];
    default:
      return [
        { text: `Make a $50 test transaction in ${name}'s main product flow on ${chain} and reverse it, confirming the flow works end to end before sizing up. Cost ~${usdFull(x.g(3))} gas. Time ~30 min.`, cost: x.g(3), minutes: 30 },
        { text: `Use ${name}'s core ${x.cat.toLowerCase()} flow on ${chain} with ${M} in 3 tranches over 3 days, so the wallet builds a dated usage history, not one print. Cost ~${usdFull(x.g(3))} gas. Time ~40 min total.`, cost: x.g(3), minutes: 40 },
        { text: `Repeat the core flow weekly for ${W} weeks at varied amounts around ${usdFull(Math.round(x.main / 6))}, and use a second ${name} feature with ${R} so activity covers two surfaces. Cost ~${usdFull(x.g(2 + W))} gas. Time ~15 min a week.`, cost: x.g(2 + W), minutes: 15 * W },
      ];
  }
}

/**
 * An 8-step farm plan shaped by the protocol's own category, primary
 * chain, second chain, TVL tier and age. Steps 1 and 5-8 frame the
 * category core (steps 2-4): wallet setup, a second-chain or deepening
 * step, community linkage, and the hold-to-snapshot discipline step.
 */
export function buildFarmPlan(p: SnapshotProtocol, ageDays: number | null): FarmPlan {
  const chain = p.chains[0] ?? 'Ethereum';
  const second = p.chains[1];
  const gas = gasFor(chain);
  const cap = farmCapital(p.tvl_usd);
  const weeks = holdWeeksFor(ageDays);
  const ctx: FarmCtx = {
    name: p.name,
    cat: p.category ?? 'DeFi',
    chain,
    cap,
    main: Math.round(cap * 0.7),
    reserve: cap - Math.round(cap * 0.7),
    weeks,
    fee: (n: number) => Math.max(1, Math.round(n)),
    g: (tx: number) => Math.max(1, Math.round(gas * tx)),
  };
  const parts: { text: string; cost: number; minutes: number }[] = [];
  const add = (text: string, cost: number, minutes: number) => parts.push({ text, cost, minutes });

  add(
    `Set up a fresh wallet for ${p.name} and fund it with ${usdFull(cap)} on ${chain}; keep the seed phrase offline and never typed into a site. Cost ~${usdFull(ctx.fee(gas * 2 + 1))} in funding gas. Time ~20 min.`,
    ctx.fee(gas * 2 + 1),
    20,
  );
  for (const s of coreSteps(familyOf(p.category), ctx)) add(s.text, s.cost, s.minutes);
  if (second) {
    const bridgeCost = ctx.fee(gasFor(second) * 2 + 4);
    add(
      `Bridge ${usdFull(Math.round(cap * 0.25))} to ${second} and repeat ${p.name}'s core flow there once in small size, so the wallet is active on two of its chains, not just ${chain}. Cost ~${usdFull(bridgeCost)} in bridge and gas fees. Time ~40 min.`,
      bridgeCost,
      40,
    );
  } else {
    add(
      `Deepen the main wallet instead of opening a second one: add ${usdFull(Math.round(cap * 0.25))} to the core position in week 3 unless ${p.name}'s rules reward multiple wallets. Cost ~${usdFull(ctx.g(2))} gas. Time ~20 min.`,
      ctx.g(2),
      20,
    );
  }
  add(
    `Read ${p.name}'s docs and audit notes, join its official community channels, link the wallet where the app asks, and complete any in-app profile or quest step. Cost $0. Time ~20 min.`,
    0,
    20,
  );
  add(
    `Keep a dated farm log (wallet, amounts, transaction hashes) and check ${p.name}'s channels weekly for a points or snapshot announcement; never withdraw in a panic before one. Cost $0. Time ~5 min a week.`,
    0,
    5 * weeks,
  );
  add(
    `Hold every position live until a token or points snapshot is announced, then claim only from ${p.name}'s own page within the first week and read the vesting terms before selling or staking. Cost ~${usdFull(ctx.g(1))} for the claim transaction. Time ~15 min on claim day.`,
    ctx.g(1),
    15,
  );
  const steps = parts.slice(0, 8).map((s) => (s.text.length > 600 ? `${s.text.slice(0, 596)}...` : s.text));
  return {
    steps,
    capital: cap,
    costTotal: parts.slice(0, 8).reduce((s, x) => s + x.cost, 0),
    minutesTotal: parts.slice(0, 8).reduce((s, x) => s + x.minutes, 0),
    holdWeeks: weeks,
  };
}

export type VerdictGrade = 'LEAN' | 'STANDARD' | 'HEAVY';

/**
 * The farm verdict, under the rule printed on the Method view: a plan is
 * LEAN when its all-in cost is at most $75 and at most 8 active hours,
 * STANDARD when at most $200 and 14 hours, HEAVY above either line. The
 * verdict line also states the break-even plainly: the plan only pays if
 * the farmer's eventual share of a launch beats the all-in cost, and it
 * names the model's low-band value of the whole token as the scale.
 */
export function farmVerdict(plan: FarmPlan, bandLow: number): { grade: VerdictGrade; line: string; hours: number; costPerHour: number } {
  const hours = plan.minutesTotal / 60;
  const costPerHour = plan.costTotal / Math.max(hours, 0.01);
  const grade: VerdictGrade =
    plan.costTotal <= 75 && hours <= 8 ? 'LEAN' : plan.costTotal <= 200 && hours <= 14 ? 'STANDARD' : 'HEAVY';
  const line =
    `${grade}: all-in ${usdFull(plan.costTotal)} over ${plan.holdWeeks} weeks — ${hours.toFixed(1)} active hours at ${usdFull(Math.round(costPerHour))}/h, ` +
    `needs ${usdFull(plan.capital)} of working capital. It pays only if your share of any launch beats ${usdFull(plan.costTotal)}; ` +
    `at the model's low band the whole token would be worth ${usdFull(bandLow)}, so even a small allocation clears it — if it launches at all.`;
  return { grade, line, hours, costPerHour };
}

// ------------------------------------------------------------- risks

/** Per-protocol risk notes, each one read off the snapshot's own fields. */
export function risksFor(
  p: SnapshotProtocol,
  snap: Snapshot,
  peers: SnapshotProtocol[],
  standInAge: number,
): string[] {
  const risks: string[] = [];
  if (p.change_7d !== null && p.change_7d <= -5) {
    risks.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the last 7 days of the snapshot: the fitted growth term prices a slide, not a story.`);
  } else if (p.change_7d !== null && p.change_7d >= 15) {
    risks.push(`TVL rose ${p.change_7d.toFixed(1)}% in 7 days: the peers' record prices fast inflows at a discount (the fitted growth sign is negative), and a crowded farm dilutes fast.`);
  } else if (p.change_7d === null) {
    risks.push('No seven-day TVL change is reported, so the growth term reads zero; check the protocol\'s own figures before sizing up.');
  }
  const age = ageInDays(snap.as_of, p.listed_at);
  if (age !== null && age < 180) {
    risks.push(`DefiLlama has tracked it for only ${age} days: a short record behind the implied value, with little history of surviving a downturn.`);
  } else if (age !== null) {
    risks.push(`Tracked since ${p.listed_at} (${age} days) with no token recorded: a long wait can still end with no launch, and the fitted age term mildly discounts old listings.`);
  } else {
    risks.push(`No listing date in the record: the model scores its age at the launched peers' median of ${standInAge} days, stated wherever the number is used.`);
  }
  // Extrapolation: the row's features against the range the fit ever saw.
  const peerLogTvl = peers.map((q) => Math.log10(q.tvl_usd));
  const lo = Math.min(...peerLogTvl);
  const hi = Math.max(...peerLogTvl);
  const mine = Math.log10(Math.max(p.tvl_usd, 1));
  if (mine < lo || mine > hi) {
    risks.push(`Extrapolation: its TVL sits outside the launched peers' fitted range (${usdFull(Math.pow(10, lo))} to ${usdFull(Math.pow(10, hi))}), so the regression is extended, not interpolated, here — lean on the band, not the headline.`);
  }
  if (p.chains.length <= 1) {
    risks.push(`All TVL sits on one chain (${p.chains[0] ?? 'unknown'}): a chain incident hits the whole position at once.`);
  }
  if (p.tvl_usd < 10_000_000) {
    risks.push(`Micro size: ${usdFull(p.tvl_usd)} of TVL is small enough that one large depositor leaving moves the protocol's numbers and its implied value with it.`);
  }
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp')) risks.push('Lending risk: collateral can be liquidated if prices gap down while a loan is open.');
  else if (c.includes('derivative') || c.includes('perp')) risks.push('Perps risk: leveraged positions can be liquidated, and funding can bleed a held position.');
  else if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) risks.push('Vault risk: the strategy can underperform or take a loss; yield shown is never guaranteed.');
  else if (c.includes('restaking') || c.includes('staking')) risks.push('Staking risk: slashing and unbonding delays can lock or cut the stake.');
  else if (c.includes('prediction')) risks.push('Market risk: event positions settle to zero on the losing side; never size a market position as a deposit.');
  else risks.push('Smart-contract risk: unaudited or upgraded contracts can lose deposited funds; the snapshot carries no audit record.');
  risks.push('No token is promised: the protocol may never issue one, and points or activity may never convert.');
  return risks.slice(0, 4);
}

// ------------------------------------------------------------- board

export interface TermContribution {
  term: TermId | 'const';
  label: string;
  feature: number;
  beta: number;
  contribution: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  chains: string[];
  tvl: number;
  change7d: number | null;
  listedAt: string | null;
  ageDays: number | null;
  ageStandIn: boolean;
  implied: number;
  multiple: number;
  tier: 'Top pick' | 'Strong' | 'Speculative';
  cohort: 'WATCHLIST' | 'RADAR';
  coreLow: number;
  coreHigh: number;
  bandLow: number;
  bandHigh: number;
  contributions: TermContribution[];
  compsValue: number;
  compsMultiple: number;
  neighbours: PeerLite[];
  watchlistNote: string;
  risks: string[];
  farm: string[];
  farmSummary: {
    capital: number;
    cost: number;
    minutes: number;
    hours: number;
    costPerHour: number;
    holdWeeks: number;
    verdictGrade: VerdictGrade;
    verdictLine: string;
  };
}

export interface Radar {
  asOf: string;
  source: string;
  floor: number;
  validation: {
    peerCount: number;
    standInAge: number;
    terms: TermId[];
    beta: number[];
    se: number[];
    tStat: number[];
    r2: number;
    specs: SpecScore[];
    verdicts: TermVerdict[];
    offsetTest: { K: number; looMedian: number }[];
    offsetsVerdict: string;
    looMedianAbs: number;
    band50: { log: number; factor: number; coverage: number };
    band80: { log: number; factor: number; coverage: number };
  };
  rows: RadarRow[];
  ledger: LedgerRow[];
  peers: PeerLite[];
  stats: {
    rows: number;
    watchlist: number;
    totalTvl: number;
    totalImplied: number;
    ledgerTotal: number;
    ledgerCounts: Record<Disposition, number>;
  };
}

const TERM_DISPLAY: Record<TermId, string> = {
  tvl: 'size: log10(TVL)',
  growth: 'growth: 7d TVL change (clamped)',
  age: 'age: log10(tracked days + 30)',
  breadth: 'breadth: log2(chains)',
};

/** Build the full radar: validate the model, price the universe, rank it. */
export function buildRadar(snap: Snapshot, validation?: Validation): Radar {
  const v = validation ?? validateModel(snap);
  const peers = launchedPeers(snap);
  const watch = new Set(snap.watchlist);
  const ledger = buildLedger(snap);
  const universe = snap.protocols.filter(isRadarCandidate);

  const priced = universe.map((p) => {
    const fit = v.winner;
    const logValue = predictLog(snap, v.standInAge, fit, p);
    const implied = Math.max(1, Math.round(Math.pow(10, logValue)));
    const coreLow = Math.max(1, Math.round(implied / v.band50.factor));
    const coreHigh = Math.round(implied * v.band50.factor);
    const bandLow = Math.max(1, Math.round(implied / v.band80.factor));
    const bandHigh = Math.round(implied * v.band80.factor);
    const x = featureRow(snap, v.standInAge, fit.terms, p);
    const contributions: TermContribution[] = [
      { term: 'const', label: 'intercept (fitted)', feature: 1, beta: fit.beta[0]!, contribution: fit.beta[0]! },
      ...fit.terms.map((t, i) => ({
        term: t as TermId | 'const',
        label: TERM_DISPLAY[t],
        feature: x[i + 1]!,
        beta: fit.beta[i + 1]!,
        contribution: x[i + 1]! * fit.beta[i + 1]!,
      })),
    ];
    const comps = compsCheck(peers, p);
    const age = ageInDays(snap.as_of, p.listed_at);
    const plan = buildFarmPlan(p, age);
    const verdict = farmVerdict(plan, bandLow);
    return { p, implied, coreLow, coreHigh, bandLow, bandHigh, contributions, comps, age, plan, verdict };
  });
  priced.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: RadarRow[] = priced.map((r, i) => {
    const rank = i + 1;
    return {
      rank,
      slug: r.p.slug,
      name: r.p.name,
      category: r.p.category,
      chain: r.p.chains[0] ?? '—',
      chains: r.p.chains,
      tvl: r.p.tvl_usd,
      change7d: r.p.change_7d,
      listedAt: r.p.listed_at,
      ageDays: r.age,
      ageStandIn: r.age === null,
      implied: r.implied,
      multiple: r.implied / Math.max(r.p.tvl_usd, 1),
      tier: rank <= 25 ? 'Top pick' : rank <= 90 ? 'Strong' : 'Speculative',
      cohort: watch.has(r.p.slug) ? 'WATCHLIST' : 'RADAR',
      coreLow: r.coreLow,
      coreHigh: r.coreHigh,
      bandLow: r.bandLow,
      bandHigh: r.bandHigh,
      contributions: r.contributions,
      compsValue: r.comps.value,
      compsMultiple: r.comps.multiple,
      neighbours: r.comps.peers,
      watchlistNote: watchlistNote(r.p, snap),
      risks: risksFor(r.p, snap, peers, v.standInAge),
      farm: r.plan.steps,
      farmSummary: {
        capital: r.plan.capital,
        cost: r.plan.costTotal,
        minutes: r.plan.minutesTotal,
        hours: r.verdict.hours,
        costPerHour: r.verdict.costPerHour,
        holdWeeks: r.plan.holdWeeks,
        verdictGrade: r.verdict.grade,
        verdictLine: r.verdict.line,
      },
    };
  });

  const ledgerCounts: Record<Disposition, number> = { CALIBRATION: 0, TOKEN_UNPRICED: 0, CANDIDATE: 0, PRODUCT: 0 };
  for (const row of ledger) ledgerCounts[row.disposition]++;

  return {
    asOf: snap.as_of,
    source: snap.source,
    floor: snap.floor_usd,
    validation: {
      peerCount: v.peerCount,
      standInAge: v.standInAge,
      terms: v.winner.terms,
      beta: v.winner.beta,
      se: v.winner.se,
      tStat: v.winner.tStat,
      r2: v.winner.r2,
      specs: v.specs,
      verdicts: v.verdicts,
      offsetTest: v.offsetTest,
      offsetsVerdict: v.offsetsVerdict,
      looMedianAbs: v.looMedianAbs,
      band50: v.band50,
      band80: v.band80,
    },
    rows,
    ledger,
    peers: [...peers]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .map((p) => ({ slug: p.slug, name: p.name, tvl: p.tvl_usd, mcap: p.mcap_usd!, multiple: p.mcap_usd! / p.tvl_usd })),
    stats: {
      rows: rows.length,
      watchlist: rows.filter((r) => r.cohort === 'WATCHLIST').length,
      totalTvl: rows.reduce((s, r) => s + r.tvl, 0),
      totalImplied: rows.reduce((s, r) => s + r.implied, 0),
      ledgerTotal: ledger.length,
      ledgerCounts,
    },
  };
}

/** Gate-shape check on the built rows; returns the first problem or null. */
export function boardIssue(rows: RadarRow[], snap: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `row count ${rows.length} outside 100..4000`;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (i > 0 && r.implied > rows[i - 1]!.implied) return `implied value rises at rank ${r.rank}`;
    if (r.farm.length < 3 || r.farm.length > 12) return `${r.slug}: farm plan has ${r.farm.length} steps`;
    for (const step of r.farm) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${r.slug}: farm step of ${len} chars`;
    }
  }
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `watchlist missing: ${missing.slice(0, 5).join(', ')}`;
  return null;
}
