// The numbers the README quotes, measured on the current tree and committed.
//
//   node scripts/results.mjs          # write results/bench_head.json
//   node scripts/results.mjs --check  # recompute; exit 1 if the committed
//                                     # file or any README figure disagrees
//
// The check is the point. Every figure on the README's first screen and in
// its tables is rebuilt here from the engine and the committed catalogue (or,
// for the historical columns, read from results/history.json, which
// `node scripts/history.mjs --check` rebuilds from git history), formatted the
// way the README writes it, and looked up in the README text. A README edit
// that drifts from the code, or a code change that moves a quoted number,
// fails the check.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, decide, parseRequest, POLICY } from '../public/engine.js';
import { bench } from './bench.mjs';
import { agentBench } from './agentbench.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'results', 'bench_head.json');
const HISTORY = join(ROOT, 'results', 'history.json');

// Text files are hashed and sized with LF line endings, so a Windows checkout
// with autocrlf measures the same bytes as Linux.
const lf = (file) => Buffer.from(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));

const catalogFile = join(ROOT, 'public', 'data', 'catalog.json');
const cat = new Catalog(JSON.parse(readFileSync(catalogFile, 'utf8')));

function example(text) {
  const req = parseRequest(text, cat);
  const scored = cat.search(req.query, req.constraints, req);
  const d = decide(cat, scored, req.constraints, 0);
  return {
    action: d.action,
    pool: d.pool.length,
    reasons: d.reasons,
    ...(d.action === 'ask' ? { facet: d.facet, options: d.options.map((o) => ({ value: o.value, count: o.count })) } : {}),
    ...(d.action === 'answer' ? { differentiators: d.differentiators } : {}),
  };
}

const EXAMPLES = [
  'belt', 'leather belt', 'running shoes', 'waterproof hiking boots, no laces',
  'a wallet that is not leather, under $30', 'cheapest wool sweater',
  "I'm looking for a leather belt, nothing with a snap, not over $50",
];

function publicFiles(dir = join(ROOT, 'public')) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? publicFiles(p) : [p];
  }).sort();
}

function parseCaseCount() {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'parse_test.mjs')], { encoding: 'utf8' });
  const m = out.match(/(\d+) \/ (\d+) sentences read as intended/);
  if (!m) throw new Error('parse_test.mjs did not print its tally');
  return { passed: +m[1], total: +m[2] };
}

export function measure() {
  const agent = (n, holdout) => {
    const r = agentBench({ n, holdout });
    return { summary: r.summary, listening: r.listening };
  };
  const pct = (f) => +(100 * cat.items.filter((i) => i.f[f]?.length).length / cat.items.length).toFixed(1);
  const files = publicFiles();
  return {
    generated_by: 'node scripts/results.mjs',
    note: 'Seeded (2026). bench = two- or three-word shopper; agentbench = agent-relayed sentences; holdout = phrasings the parser was not tuned on. Sizes are LF-normalised bytes, gzip at the zlib default level.',
    catalog: {
      items: cat.items.length,
      sha256_lf: createHash('sha256').update(lf(catalogFile)).digest('hex'),
      coverage_pct: Object.fromEntries(['material', 'closure', 'occasion', 'fit', 'color'].map((f) => [f, pct(f)])),
      priced_pct: +(100 * cat.items.filter((i) => typeof i.p === 'number' && i.p > 0).length / cat.items.length).toFixed(1),
    },
    bench_400: bench({ n: 400 }).summary,
    agentbench_400_holdout: agent(400, true),
    bench_800: bench({ n: 800 }).summary,
    agentbench_800: agent(800, false),
    agentbench_800_holdout: agent(800, true),
    parse_cases: parseCaseCount(),
    examples: Object.fromEntries(EXAMPLES.map((t) => [t, example(t)])),
    size_bytes: {
      catalog_raw: lf(catalogFile).length,
      catalog_gzip: gzipSync(lf(catalogFile)).length,
      public_gzip: files.reduce((s, f) => s + gzipSync(lf(f)).length, 0),
    },
  };
}

// ---- formatting, the way the README writes numbers ----
const r3 = (x) => (Math.round(x * 1000 + 1e-6) / 1000).toFixed(3);
const r2 = (x) => (Math.round(x * 100 + 1e-6) / 100).toFixed(2);
const pctOf = (s) => `${Math.round(parseFloat(s))}%`;       // "70.9% of 165" -> "71%"
const mib = (b, d = 2) => (b / 1048576).toFixed(d);

export function claims(head, hist) {
  const c = [];
  const add = (what, text) => c.push({ what, text });
  const b = head.bench_800, a = head.agentbench_800.summary, h = head.agentbench_800_holdout.summary;
  const al = head.agentbench_800.listening, hl = head.agentbench_800_holdout.listening;
  const kw = hist.keyword.agentbench_800, pr = hist.parser.agentbench_800;

  // First screen
  add('catalogue size', `${cat.items.length.toLocaleString('en-US')} real products`);
  const inN = Math.round(100 / head.catalog.priced_pct);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  add('first screen: priced share', `only one product in ${words[inN] ?? inN} has a price`);
  add('data: priced share', `Prices exist for one product in ${words[inN] ?? inN}`);
  add('first screen: agent Hit@10 / Hit@1', `Hit@10 ${r3(a['Hit@10'])} (Hit@1 ${r3(a['Hit@1'])})`);
  add('first screen: held-out Hit@10', `held-out phrasings the parser was not tuned on, ${r3(h['Hit@10'])}`);
  add('first screen: keyword baseline', `scored Hit@10 ${r3(kw.summary['Hit@10'])} and turned every refusal into a requirement`);
  for (const l of [al, hl]) {
    for (const k of ['negationInverted', 'negationViolatedInTop10', 'budgetViolatedInTop10']) {
      if (pctOf(l[k]) !== '0%') add(`listening ${k} is zero`, `__${k} is ${l[k]}__`);
    }
    if (l.redundantAsks !== 0 || l.reasksAfterDecline !== 0) add('listening asks are zero', '__asks not zero__');
  }

  // The before/after table
  const tr = (label, cells) => add(`table row ${label}`, `| ${label} | ${cells[0]} | ${cells[1]} | **${cells[2]}** |`);
  for (const k of ['Hit@10', 'Hit@1', 'MRR']) tr(k, [r3(kw.summary[k]), r3(pr.summary[k]), r3(a[k])]);
  tr('refusals inverted into requirements', [pctOf(kw.listening.negationInverted), pctOf(pr.listening.negationInverted), pctOf(al.negationInverted)]);
  tr('refused value shown in top 10', [pctOf(kw.listening.negationViolatedInTop10), pctOf(pr.listening.negationViolatedInTop10), pctOf(al.negationViolatedInTop10)]);
  tr('budget broken in top 10', [pctOf(kw.listening.budgetViolatedInTop10), pctOf(pr.listening.budgetViolatedInTop10), pctOf(al.budgetViolatedInTop10)]);
  tr('questions asked about something already said', [kw.listening.redundantAsks, pr.listening.redundantAsks, al.redundantAsks]);
  tr('questions re-asked after "no preference"', [kw.listening.reasksAfterDecline, pr.listening.reasksAfterDecline, al.reasksAfterDecline]);
  add('holdout sentence', `Hit@10 ${r3(h['Hit@10'])} · Hit@1 ${r3(h['Hit@1'])} · MRR ${r3(h.MRR)} with the same zero failures`);
  add('parse cases', `${head.parse_cases.total} hand-written sentences`);

  // Measured section
  add('bench 800', `**Hit@10 ${r3(b['Hit@10'])} · Hit@1 ${r3(b['Hit@1'])} · MRR ${r3(b.MRR)} · ${r2(b.meanTurns)} turns.**`);
  add('agentbench 800', `**Hit@10 ${r3(a['Hit@10'])} · Hit@1 ${r3(a['Hit@1'])} · MRR ${r3(a.MRR)} · ${r2(a.meanTurns)} turns**`);
  add('agentbench 800 holdout', `Under held-out phrasings: Hit@10 ${r3(h['Hit@10'])} · Hit@1 ${r3(h['Hit@1'])} · MRR ${r3(h.MRR)}`);
  const b4 = head.bench_400, h4 = head.agentbench_400_holdout.summary;
  add('npm test gate, keyword', `400 keyword targets give Hit@10 **${r3(b4['Hit@10'])}** and Hit@1 **${r3(b4['Hit@1'])}**`);
  add('npm test gate, held-out', `400 held-out agent phrasings give Hit@10 **${r3(h4['Hit@10'])}** and Hit@1 **${r3(h4['Hit@1'])}**`);

  // Attribute index before/after
  const pre = hist.preIndex, cov = head.catalog.coverage_pct;
  for (const f of ['material', 'closure', 'occasion', 'fit']) {
    add(`coverage ${f}`, `| ${f} | ${Math.round(pre.coverage_pct[f])}% | ${Math.round(cov[f])}% |`);
  }
  add('coverage color', `| color | — | ${Math.round(cov.color)}% |`);
  const pb = pre.bench_800;
  const dTurns = b.meanTurns - pb.meanTurns;
  add('index rebuild, two-word bench', `Hit@10 ${r3(pb['Hit@10'])} → ${r3(b['Hit@10'])}, Hit@1 ${r3(pb['Hit@1'])} → ${r3(b['Hit@1'])}, MRR ${r3(pb.MRR)} → ${r3(b.MRR)}, at ${dTurns >= 0 ? '+' : '−'}${r2(Math.abs(dTurns))} questions per session`);
  add('fit coverage sentence', `Only ${Math.round(cov.fit)}% of this catalog records a \`fit\` value`);

  // Stopping policy
  add('policy answerBelow', `**≤ ${POLICY.answerBelow} candidates**`);
  add('policy maxAsks', `**${POLICY.maxAsks} questions already asked**`);
  add('policy minRemoved/minGain', `fewer than ${POLICY.minRemoved} candidates, or less than ${Math.round(POLICY.minGain * 100)}% of the pool`);
  add('policy minCoverage', `recorded on under ${Math.round(POLICY.minCoverage * 100)}% of the pool`);

  // Worked examples
  const ex = head.examples;
  const belt = ex.belt, lb = ex['leather belt'];
  const reasonNum = (r, re) => (r.find((x) => re.test(x)) ?? '').match(re);
  const lead = reasonNum(belt.reasons, /leader only (\d+)% ahead/);
  const clr = reasonNum(belt.reasons, /clears ~(\d+) of them on average \(recorded on (\d+)%\)/);
  add('belt prose: pool', `Ask this catalog for "a belt" and ${belt.pool} products match`);
  add('belt prose: lead', `the top-ranked item beats the tenth by ${lead?.[1]}%`);
  add('belt prose: cleared', `clears ~${clr?.[1]} of them on average`);
  add('belt JSON: reason 1', `"${belt.pool} candidates, leader only ${lead?.[1]}% ahead."`);
  add('belt JSON: reason 2', `clears ~${clr?.[1]} of them on average (recorded on ${clr?.[2]}%).`);
  add('belt JSON: first option', `{"value":"${belt.options[0].value}","count":${belt.options[0].count}}`);
  const lbClose = lb.differentiators.find((d) => d.facet === 'closure');
  add('leather belt JSON: candidates', `"candidates": ${lb.pool},`);
  add('leather belt JSON: first split', `{"value":"${lbClose.splits[0].value}","count":${lbClose.splits[0].count}}`);
  add('leather belt JSON: reason', `"${lb.reasons[0]}"`);
  const rowFor = { belt: '`belt`', 'leather belt': '`leather belt`', 'running shoes': '`running shoes`', 'waterproof hiking boots, no laces': '`waterproof hiking boots, no laces`', 'a wallet that is not leather, under $30': '`a wallet that is not leather, under $30`', 'cheapest wool sweater': '`cheapest wool sweater`', "I'm looking for a leather belt, nothing with a snap, not over $50": '`…leather belt, nothing with a snap, not over $50`' };
  for (const [q, cell] of Object.entries(rowFor)) {
    add(`examples table: ${q}`, { row: cell, pool: ex[q].pool, action: ex[q].action });
  }
  const snap = ex["I'm looking for a leather belt, nothing with a snap, not over $50"];
  const sc = snap.differentiators.find((d) => d.facet === 'closure');
  add('examples table: snap split', `differ by closure: ${sc.splits.map((s) => `${s.count} ${s.value}`).join(', ')}`);
  add('examples table: leather belt clears', `answer — best question clears only ~${lb.reasons[0].match(/~(\d+)/)[1]}`);

  // Sizes
  const s = head.size_bytes;
  add('size: storefront', `the whole storefront is about ${mib(s.public_gzip)} MiB gzipped`);
  add('size: catalogue', `${mib(s.catalog_raw, 1)} MiB raw / ${mib(s.catalog_gzip)} MiB gzipped`);
  return c;
}

export function checkReadme(readme, head, hist) {
  const flat = readme.replace(/\s+/g, ' ');
  const lines = readme.split(/\r?\n/);
  const failures = [];
  // Every count of hand-written parser sentences, wherever the README gives one.
  for (const m of flat.matchAll(/(\d+) hand-written (?:sentences|parse cases)/g)) {
    if (+m[1] !== head.parse_cases.total) failures.push(`README says "${m[0]}", parse_test.mjs has ${head.parse_cases.total}`);
  }
  for (const { what, text } of claims(head, hist)) {
    if (typeof text === 'string') {
      if (!flat.includes(text.replace(/\s+/g, ' '))) failures.push(`${what}: README does not say ${JSON.stringify(text)}`);
    } else {
      const line = lines.find((l) => l.startsWith(`| ${text.row} |`));
      const cells = line?.split('|').map((x) => x.trim());
      if (!cells) failures.push(`${what}: no table row for ${text.row}`);
      else {
        if (cells[3] !== String(text.pool)) failures.push(`${what}: README says ${cells[3]} candidates, the engine finds ${text.pool}`);
        if (!cells[4]?.replace(/\*/g, '').startsWith(text.action)) failures.push(`${what}: README says "${cells[4]}", the engine decides ${text.action}`);
      }
    }
  }
  return failures;
}

function sameExceptSizes(a, b) {
  const strip = (o) => JSON.stringify({ ...o, size_bytes: undefined });
  if (strip(a) !== strip(b)) return false;
  return Object.keys(a.size_bytes).every((k) => Math.abs(a.size_bytes[k] - b.size_bytes[k]) <= 0.01 * b.size_bytes[k]);
}

if (process.argv[1]?.endsWith('results.mjs')) {
  const fresh = measure();
  const hist = JSON.parse(readFileSync(HISTORY, 'utf8'));
  if (process.argv.includes('--check')) {
    const failures = [];
    if (!existsSync(OUT)) failures.push('results/bench_head.json is missing');
    else if (!sameExceptSizes(fresh, JSON.parse(readFileSync(OUT, 'utf8')))) {
      failures.push('results/bench_head.json does not match a fresh run. Re-run `node scripts/results.mjs` and review the diff.');
    }
    failures.push(...checkReadme(readFileSync(join(ROOT, 'README.md'), 'utf8'), fresh, hist));
    for (const f of failures) console.error(`FAIL: ${f}`);
    if (failures.length) process.exitCode = 1;
    else console.log(`results ok: bench_head.json reproduces and ${claims(fresh, hist).length} README figures match`);
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(fresh, null, 2) + '\n');
    console.log(`wrote ${OUT}`);
  }
}
