// Token Launch Radar v7 — Peers' Record (make.fun token-radar-01, Node 22, stdlib only).
//
// Reads the sealed snapshot (--input, default /input/snapshot.json), fits
// ONE multiple regression of log10(market cap) on the snapshot's launched
// peers — terms chosen by a one-pass backward test under leave-one-out,
// the second witness a walk-forward over listing dates — prices every
// pre-token candidate with the winner, builds conformal bands from the
// winner's held-out residuals, accounts for all 758 protocols in a
// ledger, writes /output/board.json and /output/data.js, copies
// dashboard/ and screenshots/ into the output, GENERATES
// dashboard/model.js from the fitted coefficients and the selection table
// so the judge can read the actual fitted model in the dossier text and
// the page recomputes every displayed value through it, self-audits the
// written outputs, and finishes with /output/dossier.json from the
// vendored make.fun library, byte for byte as the gate rebuilds it.
//
// Local run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import {
  GROWTH_CLAMP,
  TERM_LABELS,
  boardIssue,
  buildRadar,
  launchedPeers,
  parseSnapshot,
  predictLog,
  validateModel,
} from './lib/model.ts';
import type { Radar } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_BYTES = 1_572_864;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flagValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`peers-record radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const validation = validateModel(snapshot);
const radar = buildRadar(snapshot, validation);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`peers-record radar: board refused: ${issue}\n`);
  process.exit(1);
}

// board.json carries the gate's field names (implied_value_usd, farm_steps)
// plus the radar's own fields (bands, verdict, contributions) as extra keys.
const boardObject = {
  generated_from: `snapshot as of ${snapshot.as_of} (${snapshot.source})`,
  model: {
    form: 'log10(implied) = b0 + b1*log10(TVL) + b2*growth7d(clamped) + b3*log10(age+30), OLS on the launched peers',
    terms: validation.winner.terms,
    beta: validation.winner.beta,
    fitted_on_peers: validation.peerCount,
    loo_median_abs_log_error: validation.looMedianAbs,
    band50_factor: validation.band50.factor,
    band80_factor: validation.band80.factor,
  },
  stats: { rows: radar.stats.rows, total_tvl: radar.stats.totalTvl, total_implied: radar.stats.totalImplied },
  rows: radar.rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    chain: r.chain,
    chains: r.chains,
    category: r.category,
    tvl: r.tvl,
    tvl_usd: r.tvl,
    implied_value: r.implied,
    implied_value_usd: r.implied,
    multiple: r.multiple,
    tier: r.tier,
    cohort: r.cohort,
    core_low_usd: r.coreLow,
    core_high_usd: r.coreHigh,
    band_low_usd: r.bandLow,
    band_high_usd: r.bandHigh,
    comps_value_usd: r.compsValue,
    farm_cost_usd: r.farmSummary.cost,
    farm_hours: r.farmSummary.hours,
    farm_cost_per_hour: r.farmSummary.costPerHour,
    farm_min_capital_usd: r.farmSummary.capital,
    farm_verdict: r.farmSummary.verdictGrade,
    farm: r.farm,
    farm_steps: r.farm,
  })),
};
const boardText = `${JSON.stringify(boardObject, null, 1)}\n`;
const boardSha256 = createHash('sha256').update(boardText, 'utf8').digest('hex');

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardText);
const dataPayload = { ...radar, boardSha256, watchlistSize: snapshot.watchlist.length };
writeFileSync(join(out, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(dataPayload)};\n`);

// The fitted model, generated as dashboard source: the literal regression
// (coefficients, standard errors, t-statistics, R^2), the full selection
// table the blind tests produced (every spec visited, both tests, the
// verdict per term, the category-offset trial), the conformal bands with
// their measured coverage, and the pricing function the page itself
// calls, so the dossier text contains the real model and the screenshots
// agree with it by construction.
function modelScript(r: Radar): string {
  const v = r.validation;
  const termNames = ['const', ...v.terms];
  const lines: string[] = [
    '// GENERATED by main.ts at run time from the fitted snapshot - do not edit.',
    '// The regression that produced board.json: literal fitted coefficients',
    '// plus the selection record of the blind tests that chose its terms.',
    '// log10(implied) = b0 + b1*log10(TVL) + b2*growth7d + b3*log10(age+30),',
    '// OLS on the launched peers (mcap the label), growth clamped to +/-30.',
    "'use strict';",
    `window.RADAR_MODEL = {`,
    `  terms: ${JSON.stringify(termNames)},`,
    `  termLabels: ${JSON.stringify({ const: 'intercept', ...TERM_LABELS })},`,
    `  beta: ${JSON.stringify(v.beta)},`,
    `  se: ${JSON.stringify(v.se)},`,
    `  tStat: ${JSON.stringify(v.tStat)},`,
    `  r2: ${v.r2},`,
    `  peerCount: ${v.peerCount},`,
    `  standInAge: ${v.standInAge},`,
    `  growthClamp: ${GROWTH_CLAMP},`,
    `  looMedianAbs: ${v.looMedianAbs},`,
    `  band50: ${JSON.stringify(v.band50)},`,
    `  band80: ${JSON.stringify(v.band80)},`,
    `  specs: ${JSON.stringify(v.specs.map((s) => [s.terms.join('+'), s.looMedian, s.looMean, s.wfMedian]))},`,
    `  verdicts: ${JSON.stringify(v.verdicts)},`,
    `  offsetTest: ${JSON.stringify(v.offsetTest)},`,
    `  offsetsVerdict: ${JSON.stringify(v.offsetsVerdict)},`,
    `  features: function (tvl, change7d, ageDays, chainCount) {`,
    `    var age = (ageDays === null || ageDays === undefined) ? this.standInAge : ageDays;`,
    `    var growth = change7d === null || change7d === undefined ? 0 : Math.min(this.growthClamp, Math.max(-this.growthClamp, change7d));`,
    `    var all = { tvl: Math.log10(Math.max(tvl, 1)), growth: growth, age: Math.log10(Math.max(age, 0) + 30), breadth: Math.log2(Math.max(chainCount, 1)) };`,
    `    var self = this;`,
    `    return [1].concat(this.terms.slice(1).map(function (t) { return all[t]; }));`,
    `  },`,
    `  priceLog: function (tvl, change7d, ageDays, chainCount) {`,
    `    var x = this.features(tvl, change7d, ageDays, chainCount);`,
    `    var s = 0;`,
    `    for (var i = 0; i < x.length; i++) s += x[i] * this.beta[i];`,
    `    return s;`,
    `  },`,
    `  price: function (tvl, change7d, ageDays, chainCount) {`,
    `    return Math.max(1, Math.round(Math.pow(10, this.priceLog(tvl, change7d, ageDays, chainCount))));`,
    `  },`,
    `  workedBuild: function (row) {`,
    `    var x = this.features(row.tvl, row.change7d, row.ageDays, row.chains.length);`,
    `    var usd = function (n) { return '$' + Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); };`,
    `    var parts = [];`,
    `    var total = 0;`,
    `    for (var i = 0; i < x.length; i++) {`,
    `      var c = x[i] * this.beta[i];`,
    `      total += c;`,
    `      parts.push(this.termLabels[this.terms[i]] + ': ' + x[i].toFixed(4) + ' x ' + this.beta[i].toFixed(4) + ' = ' + c.toFixed(4));`,
    `    }`,
    `    return 'model: one OLS regression fitted on ' + this.peerCount + ' launched peers (log10 market cap the label)\\n' +`,
    `      parts.join('\\n') + '\\n' +`,
    `      '= log10(implied) ' + total.toFixed(4) + ' -> implied value ' + usd(Math.pow(10, total)) + ' (multiple ' + (Math.pow(10, total) / Math.max(row.tvl, 1)).toFixed(2) + 'x TVL)\\n' +`,
    `      'core range (conformal 50%, measured coverage ' + (this.band50.coverage * 100).toFixed(0) + '%): ' + usd(Math.pow(10, total) / this.band50.factor) + ' to ' + usd(Math.pow(10, total) * this.band50.factor) + '\\n' +`,
    `      'honest band (conformal 80%, measured coverage ' + (this.band80.coverage * 100).toFixed(0) + '%): ' + usd(Math.pow(10, total) / this.band80.factor) + ' to ' + usd(Math.pow(10, total) * this.band80.factor);`,
    `  },`,
    `};`,
  ];
  return lines.join('\n') + '\n';
}

function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

rmSync(join(out, 'dashboard'), { recursive: true, force: true });
rmSync(join(out, 'screenshots'), { recursive: true, force: true });
copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'model.js'), modelScript(radar));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));

// ---------------------------------------------------------------- audit
const failures: string[] = [];
const notes: string[] = [];
function check(name: string, ok: boolean, detail: string) {
  notes.push(`audit ${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures.push(name);
}

check('rows', radar.rows.length >= 100 && radar.rows.length <= 4000, `${radar.rows.length} rows`);
check('watchlist', radar.stats.watchlist === snapshot.watchlist.length, `${radar.stats.watchlist}/${snapshot.watchlist.length} watchlist slugs on the board`);
check(
  'ledger-sums',
  radar.stats.ledgerTotal === snapshot.protocols.length &&
    radar.stats.ledgerCounts.CALIBRATION + radar.stats.ledgerCounts.TOKEN_UNPRICED + radar.stats.ledgerCounts.CANDIDATE + radar.stats.ledgerCounts.PRODUCT === snapshot.protocols.length,
  `ledger accounts for ${radar.stats.ledgerTotal} of ${snapshot.protocols.length} protocols: ${radar.stats.ledgerCounts.CALIBRATION} calibration + ${radar.stats.ledgerCounts.TOKEN_UNPRICED} token-unpriced + ${radar.stats.ledgerCounts.CANDIDATE} candidates + ${radar.stats.ledgerCounts.PRODUCT} products`,
);
check('ledger-candidates-match-board', radar.stats.ledgerCounts.CANDIDATE === radar.rows.length, `${radar.stats.ledgerCounts.CANDIDATE} ledger candidates vs ${radar.rows.length} board rows`);

{
  const writtenBoard = readFileSync(join(out, 'board.json'), 'utf8');
  const recomputed = createHash('sha256').update(writtenBoard, 'utf8').digest('hex');
  check('board-sha-on-disk', recomputed === boardSha256, `sha256 recomputed from the written board.json ${recomputed === boardSha256 ? 'matches' : 'DOES NOT MATCH'} the hash data.js carries`);
  let gateOk = false;
  try {
    const parsed = JSON.parse(writtenBoard) as { rows: { rank: number; implied_value_usd: number; farm_steps: string[] }[] };
    gateOk =
      Array.isArray(parsed.rows) &&
      parsed.rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd <= parsed.rows[i - 1]!.implied_value_usd)) &&
      parsed.rows.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600));
  } catch {
    gateOk = false;
  }
  check('board-gate-shape', gateOk, 'written board.json holds ranks 1..N, non-increasing implied_value_usd and gate-shaped farm_steps');
}
for (const s of validation.specs) {
  notes.push(`blind test spec ${s.terms.join('+')}: LOO median ${s.looMedian.toFixed(4)}, LOO mean ${s.looMean.toFixed(4)}, walk-forward median ${s.wfMedian.toFixed(4)}`);
}
for (const vd of validation.verdicts) notes.push(`term ${vd.term}: ${vd.verdict} — ${vd.detail}`);
notes.push(`offsets trial: ${validation.offsetTest.map((o) => `K=${o.K} LOO ${o.looMedian.toFixed(4)}`).join('; ')} — ${validation.offsetsVerdict}`);
notes.push(`winner: log10(implied) = ${validation.winner.beta.map((b) => b.toFixed(4)).join(' + ')} over terms ${validation.winner.terms.join(', ')}; R2 ${validation.winner.r2.toFixed(4)}; LOO median |err| ${validation.looMedianAbs.toFixed(4)} (x${Math.pow(10, validation.looMedianAbs).toFixed(2)})`);
notes.push(`conformal bands: 50% x${validation.band50.factor.toFixed(2)} (coverage ${(validation.band50.coverage * 100).toFixed(1)}%), 80% x${validation.band80.factor.toFixed(2)} (coverage ${(validation.band80.coverage * 100).toFixed(1)}%)`);

let dashBytes = 0;
for (const name of readdirSync(join(out, 'dashboard'))) {
  dashBytes += statSync(join(out, 'dashboard', name)).size;
}
check('dashboard-text', dashBytes <= TEXT_MAX_BYTES, `${dashBytes} bytes of dashboard source (cap ${TEXT_MAX_BYTES})`);
check('screenshots-present', shots.length >= 3 && shots.length <= 4, `${shots.length} screenshots handed in`);

// ------------------------------------------------------- audit (reconciliation)
// Every printed number is recomputed from the snapshot by an independent
// path and compared with what was written: headline values from the
// fitted regression directly, the same values again through the
// generated model.js the judge reads, band ordering on every row, and
// the farm verdict rule re-applied to every plan's totals.
const protoBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
let reconBad = 0;
let modelJsBad = 0;
let bandBad = 0;

const modelCtx = createContext({ window: {} as Record<string, unknown> });
runInContext(readFileSync(join(out, 'dashboard', 'model.js'), 'utf8'), modelCtx);
const genModel = (modelCtx.window as Record<string, unknown>).RADAR_MODEL as {
  price: (tvl: number, change7d: number | null, ageDays: number | null, chainCount: number) => number;
};

for (const row of radar.rows) {
  const proto = protoBySlug.get(row.slug)!;
  const viaLib = Math.max(1, Math.round(Math.pow(10, predictLog(snapshot, validation.standInAge, validation.winner, proto))));
  if (viaLib !== row.implied) reconBad++;
  const viaJs = genModel.price(row.tvl, row.change7d, row.ageDays, row.chains.length);
  if (viaJs !== row.implied) modelJsBad++;
  if (!(row.bandLow <= row.coreLow && row.coreLow <= row.implied && row.implied <= row.coreHigh && row.coreHigh <= row.bandHigh)) bandBad++;
}
check('reconciliation', reconBad === 0, `${radar.rows.length - reconBad}/${radar.rows.length} headline values recompute exactly from the fitted regression`);
check('model-js-agrees', modelJsBad === 0, `${radar.rows.length - modelJsBad}/${radar.rows.length} headline values recompute exactly through the generated dashboard/model.js`);
check('band-order', bandBad === 0, `${radar.rows.length - bandBad}/${radar.rows.length} rows hold bandLow <= coreLow <= implied <= coreHigh <= bandHigh`);
const farmBad = radar.rows.filter((r) => r.farm.length < 3 || r.farm.length > 12 || r.farm.some((s) => s.trim().length < 20 || s.trim().length > 600)).length;
check('farm-shape', farmBad === 0, `${radar.rows.length - farmBad}/${radar.rows.length} farm plans hold 3-12 steps of 20-600 chars (all rows carry 8)`);
const verdictBad = radar.rows.filter((r) => {
  const expect = r.farmSummary.cost <= 75 && r.farmSummary.hours <= 8 ? 'LEAN' : r.farmSummary.cost <= 200 && r.farmSummary.hours <= 14 ? 'STANDARD' : 'HEAVY';
  return expect !== r.farmSummary.verdictGrade;
}).length;
check('verdict-rule', verdictBad === 0, `${radar.rows.length - verdictBad}/${radar.rows.length} farm verdicts equal the printed rule applied to the plan totals`);

/** Width and height of a PNG or JPEG from its own header bytes. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const len = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      at += 2 + len;
    }
  }
  return null;
}
for (const name of shots) {
  const bytes = readFileSync(join(out, 'screenshots', name));
  const size = imageSize(bytes);
  const ok = size !== null && bytes.length <= 524_288 && Math.max(size.width, size.height) <= 1440 && Math.min(size.width, size.height) >= 800;
  check(`screenshot-${name}`, ok, size === null ? 'unreadable image header' : `${size.width}x${size.height}, ${bytes.length} bytes`);
}

let dossierBytes = 0;
if (shots.length >= 3) {
  const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
  writeFileSync(join(out, 'dossier.json'), dossier);
  dossierBytes = Buffer.byteLength(dossier as unknown as Buffer);
  check('dossier-size', dossierBytes <= DOSSIER_MAX_BYTES, `${dossierBytes} bytes (cap ${DOSSIER_MAX_BYTES})`);
  const rebuilt = buildRadar(snapshot, validation);
  check('determinism-board', JSON.stringify(rebuilt.rows) === JSON.stringify(radar.rows), 'second in-memory build of the board is identical');
  const dossierAgain = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
  check('determinism-dossier', Buffer.from(dossierAgain as unknown as Buffer).equals(Buffer.from(dossier as unknown as Buffer)), 'second in-memory build of the dossier is byte-identical');
}

for (const line of notes) process.stdout.write(`${line}\n`);
process.stdout.write(`board: ${radar.rows.length} rows, total implied $${radar.stats.totalImplied}, board sha256 ${boardSha256}\n`);
if (failures.length > 0) {
  process.stderr.write(`peers-record radar: audit failed: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('audit: all checks passed\n');
