// Ground truth for the caller this store will actually meet.
//
// bench.mjs simulates the shopper a search box meets: two or three title
// words, then truthful answers. The caller in the WebMCP Challenge is an agent
// relaying a person's sentence — filler, a budget, an attribute or two stated
// up front, now and then a "not" — and a judge watching that agent will notice
// three things a keyword box never had to get right:
//
//   honour what was said        a budget, a stated attribute, a negation
//   do not ask what was said    a redundant question reads as not listening
//   do not re-ask what was declined
//
// This benchmark writes that sentence from the target's own record and scores
// exactly those, alongside the same Hit@10 / MRR the other benchmark reports.
// It runs against whatever the engine currently exports, so the same file
// measures the store before and after it learned to parse a sentence.
//
//   node scripts/agentbench.mjs            # 800 targets, seeded
//   node scripts/agentbench.mjs 2000
//   node scripts/agentbench.mjs --holdout  # phrasings the parser was not tuned on
//   node scripts/agentbench.mjs 400 --holdout --min-hit10=0.98 --listening   # exit 1 on a regression

import { readFileSync } from 'node:fs';
import * as engine from '../public/engine.js';
import { mulberry32, queryFor, answerAs } from './bench.mjs';
import { floorFailures, listeningFailures, report } from './floors.mjs';

const cat = new engine.Catalog(JSON.parse(
  readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));

// What the person said, as the agent would pass it on.
const FILLER = [
  (q) => `I'm looking for ${q}`,
  (q) => `find me ${q}`,
  (q) => `do you have ${q}`,
  (q) => `${q} please`,
  (q) => `I need ${q} for my brother's birthday`,
  (q) => `can you recommend ${q}`,
  (q) => `show me ${q}`,
];
const STATED = [
  (q, form) => `${form} ${q}`,
  (q, form) => `${q}, ${form}`,
  (q, form) => `${q} that is ${form}`,
  (q, form) => `${q} in ${form}`,
];
const NEGATED = [
  (q, form) => `${q}, not ${form}`,
  (q, form) => `${q} but no ${form}`,
  (q, form) => `${q} without ${form}`,
  (q, form) => `${q}, anything but ${form}`,
  (q, form) => `${q}, and it shouldn't be ${form}`,
];
const WAVED = [
  (q, word) => `${q}, any ${word} is fine`,
  (q, word) => `${q}, I don't care about the ${word}`,
  (q, word) => `${q}, ${word} doesn't matter`,
];
const BUDGET = [
  (q, lo, hi) => `${q} under $${hi}`,
  (q, lo, hi) => `${q} for less than ${hi} dollars`,
  (q, lo, hi) => `${q} between $${lo} and $${hi}`,
  (q, lo, hi) => `${q}, budget is $${hi}`,
  (q, lo, hi) => `${q} up to $${hi}`,
];

// A second set of phrasings the parser was never tuned on. `--holdout` runs
// the benchmark on these instead, so the headline number is not a parser
// grading its own homework.
const HOLDOUT = {
  FILLER: [
    (q) => `any chance you have ${q}?`,
    (q) => `what about ${q}`,
    (q) => `${q} would be great, thanks`,
    (q) => `I'm after ${q} for the weekend`,
    (q) => `help me pick ${q}`,
    (q) => `${q} for work`,
  ],
  STATED: [
    (q, form) => `${form}, ${q}`,
    (q, form) => `${q} — ${form} ideally`,
    (q, form) => `${q} (${form})`,
    (q, form) => `${q} which is ${form}`,
  ],
  NEGATED: [
    (q, form) => `${q}, skip the ${form}`,
    (q, form) => `${q}, I don't want ${form}`,
    (q, form) => `${q} — no ${form}`,
    (q, form) => `${q}, avoid ${form}`,
    (q, form) => `${q}, other than ${form}`,
    (q, form) => `${q}, definitely not ${form}`,
  ],
  WAVED: [
    (q, word) => `${q} — no preference on ${word}`,
    (q, word) => `${q}, whatever ${word} works`,
    (q, word) => `${q}, not fussy about the ${word}`,
  ],
  BUDGET: [
    (q, lo, hi) => `${q}, max $${hi}`,
    (q, lo, hi) => `${q} for $${hi} or less`,
    (q, lo, hi) => `${q} in the $${lo}-$${hi} range`,
    (q, lo, hi) => `${q}, I have ${hi} dollars to spend`,
    (q, lo, hi) => `${q} at most ${hi} bucks`,
    (q, lo, hi) => `${q} from $${lo} to $${hi}`,
  ],
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// Facets a person can state in words: the ones with a surface-form vocabulary.
const statable = Object.keys(cat.facetForms ?? {});

function compose(target, rng, T) {
  const core = queryFor(target, rng, cat);
  if (!core) return null;
  let q = core;
  const truth = { stated: {}, excluded: null, budget: null, waved: null };
  const { FILLER, STATED, NEGATED, BUDGET, WAVED } = T;

  // Up to two attributes the target carries, in the wording a person uses —
  // skipping any whose wording the core words already contain, so the
  // sentence never says "running, running".
  const coreWords = new Set(core.split(' '));
  const said = (facet) => [target.f[facet][0], ...cat.facetForms[facet][target.f[facet][0]]]
    .some((form) => form.split(/[\s-]+/).some((w) => coreWords.has(w)));
  const carried = statable.filter((f) => target.f[f]?.length && !said(f));
  const nStated = Math.min(carried.length, Math.floor(rng() * 3));      // 0, 1 or 2
  for (const facet of carried.sort(() => rng() - 0.5).slice(0, nStated)) {
    const value = target.f[facet][0];
    const form = pick(rng, cat.facetForms[facet][value]);
    q = pick(rng, STATED)(q, form);
    truth.stated[facet] = value;
  }

  // Sometimes a "not": a value of a facet the target is recorded on but does
  // not carry, so the exclusion is known-safe for the target.
  if (rng() < 0.35) {
    const known = statable.filter((f) => target.f[f]?.length && !truth.stated[f]);
    const facet = known.length ? pick(rng, known) : null;
    const others = facet ? cat.facetValues[facet].filter((v) => !target.f[facet].includes(v)) : [];
    if (others.length) {
      const value = pick(rng, others);
      q = pick(rng, NEGATED)(q, pick(rng, cat.facetForms[facet][value]));
      truth.excluded = { facet, value };
    }
  }

  // Sometimes a facet waved through — "any material is fine" — which the
  // store must then never ask about.
  if (rng() < 0.3) {
    const WORDS = { material: 'material', closure: 'closure', sleeve: 'sleeve', fit: 'fit', care: 'care', origin: 'origin', sole: 'sole', occasion: 'occasion', pocket: 'pocket', kind: 'category' };
    const open = Object.keys(WORDS).filter((f) => !truth.stated[f] && truth.excluded?.facet !== f);
    const facet = pick(rng, open);
    q = pick(rng, WAVED)(q, WORDS[facet]);
    truth.waved = facet;
  }

  // A budget the target fits inside, when it has a price at all.
  const p = typeof target.p === 'number' && target.p > 0 ? target.p : null;
  if (p && rng() < 0.5) {
    const hi = Math.ceil(p * 1.3);
    const lo = Math.max(1, Math.floor(p * 0.7));
    const tpl = pick(rng, BUDGET);
    q = tpl(q, lo, hi);
    truth.budget = { min: tpl.toString().includes('${lo}') ? lo : null, max: hi };
  }

  return { sentence: pick(rng, FILLER)(q), truth, core };
}

// The engine as it is today, or as it was: an older build has no sentence
// parser, so fall back to what it did have and let the numbers show the gap.
const parse = engine.parseRequest
  ? (text) => engine.parseRequest(text, cat)
  : (text) => ({
    query: text,
    constraints: engine.extractConstraints(text, cat.facetValues, cat.facetForms),
    exclude: {}, budget: null, sort: 'relevance',
  });

export function agentBench({ n = 800, seed = 2026, maxAsks = 3, holdout = false } = {}) {
  const rng = mulberry32(seed);
  const T = holdout ? HOLDOUT : { FILLER, STATED, NEGATED, BUDGET, WAVED };
  const s = {
    n: 0, hit10: 0, hit1: 0, rrSum: 0, turnSum: 0, asked: 0,
    withNeg: 0, negViolated: 0, negInverted: 0,
    withBudget: 0, budgetViolated: 0,
    statedFacets: 0, statedFound: 0,
    waved: 0, wavedMissed: 0,
    redundantAsks: 0, reasks: 0,
  };
  const misses = [];
  const violations = [];

  for (let tries = 0; s.n < n && tries < n * 6; tries++) {
    const target = cat.items[Math.floor(rng() * cat.items.length)];
    const made = compose(target, rng, T);
    if (!made) continue;
    const { sentence, truth } = made;

    const req = parse(sentence);
    let constraints = req.constraints;
    const opts = req;   // exclude, excludeTerms, budget, sort, optional
    let scored = cat.search(req.query, constraints, opts);

    // Did the store hear what was said?
    for (const [facet, value] of Object.entries(truth.stated)) {
      s.statedFacets++;
      if (constraints[facet]?.includes(value)) s.statedFound++;
    }
    if (truth.excluded && constraints[truth.excluded.facet]?.includes(truth.excluded.value)) s.negInverted++;

    // Then the dialogue, with a shopper who answers from the target.
    const declined = [...(req.noPreference ?? [])];
    if (truth.waved) {
      s.waved++;
      if (!declined.includes(truth.waved)) s.wavedMissed++;
    }
    let asks = 0;
    for (;;) {
      const d = engine.decide(cat, scored, constraints, asks, { declined });
      if (d.action !== 'ask' || asks >= maxAsks) break;
      if (truth.stated[d.facet] !== undefined || truth.waved === d.facet) s.redundantAsks++;
      if (declined.includes(d.facet)) s.reasks++;
      const value = answerAs(target, d.facet, d);
      asks++;
      if (value === null) { declined.push(d.facet); continue; }
      constraints = { ...constraints, [d.facet]: [value] };
      scored = cat.search(req.query, constraints, opts);
    }

    const top = scored.slice(0, 10).map((x) => x.item);
    if (truth.excluded) {
      s.withNeg++;
      const { facet, value } = truth.excluded;
      if (top.some((it) => it.f[facet]?.includes(value))) s.negViolated++;
    }
    if (truth.budget) {
      s.withBudget++;
      const { min, max } = truth.budget;
      if (top.some((it) => typeof it.p === 'number' && (it.p > max || (min != null && it.p < min)))) {
        s.budgetViolated++;
        violations.push({ sentence, truth: truth.budget, read: req.budget });
      }
    }

    const rank = scored.findIndex((x) => x.item.id === target.id) + 1;
    s.n++;
    s.asked += asks;
    s.turnSum += asks + 1;
    if (rank === 1) s.hit1++;
    if (rank >= 1 && rank <= 10) { s.hit10++; s.rrSum += 1 / rank; }
    else misses.push({ sentence, rank, title: target.t.slice(0, 56), pool: scored.length });
  }

  const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '—');
  return {
    summary: {
      targets: s.n,
      'Hit@10': +(s.hit10 / s.n).toFixed(4),
      'Hit@1': +(s.hit1 / s.n).toFixed(4),
      MRR: +(s.rrSum / s.n).toFixed(4),
      meanTurns: +(s.turnSum / s.n).toFixed(3),
      askRate: pct(s.asked, s.n),
    },
    listening: {
      statedHeard: `${pct(s.statedFound, s.statedFacets)} of ${s.statedFacets}`,
      wavedThroughHeard: `${pct(s.waved - s.wavedMissed, s.waved)} of ${s.waved}`,
      negationInverted: `${pct(s.negInverted, s.withNeg)} of ${s.withNeg}`,
      negationViolatedInTop10: `${pct(s.negViolated, s.withNeg)} of ${s.withNeg}`,
      budgetViolatedInTop10: `${pct(s.budgetViolated, s.withBudget)} of ${s.withBudget}`,
      redundantAsks: s.redundantAsks,
      reasksAfterDecline: s.reasks,
    },
    counts: { ...s },
    misses,
    violations,
  };
}

if (process.argv[1]?.endsWith('agentbench.mjs')) {
  const args = process.argv.slice(2);
  const holdout = args.includes('--holdout');
  const n = Number(args.find((a) => /^\d+$/.test(a))) || 800;
  const { summary, listening, counts, misses, violations } = agentBench({ n, holdout });
  console.log(holdout ? 'held-out phrasings' : 'tuning phrasings');
  console.log(summary);
  console.log(listening);
  for (const v of violations.slice(0, 5)) {
    console.log(`  budget broken: "${v.sentence}"  truth=${JSON.stringify(v.truth)} read=${JSON.stringify(v.read)}`);
  }
  console.log(`\nmissed ${misses.length} (target not in top 10):`);
  for (const m of misses.slice(0, 12)) {
    console.log(`  rank=${String(m.rank || '-').padStart(5)} pool=${String(m.pool).padStart(4)}  "${m.sentence}"  ->  ${m.title}`);
  }
  report([...floorFailures(summary, args), ...(args.includes('--listening') ? listeningFailures(counts) : [])]);
}
