// Ground truth for Counterask.
//
// Every other script here measures proxies — how big the pool is, how often
// the store asks. None of them can tell "better" from "merely smaller". This
// one can: pick a product, write the query a shopper looking for *that*
// product would type, and see whether the store finds it.
//
// The shopper is simulated the way the TechJam harness simulates one: they
// know what they want, so when the store asks about an attribute they answer
// truthfully from the target's own record, and say "no preference" when the
// target does not carry that attribute at all.
//
//   node scripts/bench.mjs            # 400 targets, seeded
//   node scripts/bench.mjs 1000       # more targets
//   node scripts/bench.mjs 400 --min-hit10=0.99 --min-hit1=0.86   # exit 1 below a floor

import { readFileSync } from 'node:fs';
import { Catalog, decide, parseRequest, tokenize } from '../public/engine.js';
import { floorFailures, report } from './floors.mjs';

const cat = new Catalog(JSON.parse(
  readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));

// Deterministic sampling, so a change in the ranker is the only thing that can
// move the numbers between two runs.
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The query a shopper types is not the product's full title — it is the two or
// three words they remember. Taking the *rarest* title terms would be cheating
// (a unique brand name makes retrieval trivial); taking the most common ones
// would be unfair. Take the middle: skip the single rarest term, then keep the
// next few, which is roughly "category plus one distinguishing word".
export function queryFor(item, rng, catalog = cat) {
  const terms = [...new Set(tokenize(item.t))]
    .map((t) => ({ t, df: catalog.postings.get(t)?.length ?? 0 }))
    .filter((x) => x.df > 0)
    .sort((a, b) => a.df - b.df);
  if (terms.length < 2) return null;
  const body = terms.slice(1);                 // drop the rarest — too easy
  const take = 2 + Math.floor(rng() * 2);      // 2 or 3 words
  return body.slice(0, take).map((x) => x.t).join(' ');
}

// A shopper who knows what they want: answer from the target, or decline.
export function answerAs(target, facet, ask = null) {
  const have = target.f[facet];
  if (!have?.length) return null;
  // A category question is asked one level at a time: answer with the
  // target's node at that level, or "no preference" when its path is shorter.
  const value = facet === 'kind' && ask?.level != null
    ? (ask.level === 'leaf' ? have[have.length - 1] : (have[ask.level] ?? null))
    : have[0];
  // SHOPPER=menu: a person who can only pick from the four options on screen,
  // and says "no preference" when theirs is not among them. The default is
  // an oracle who can name any value the catalogue knows, as an agent can.
  if (process.env.SHOPPER === 'menu' && value != null && ask?.options && !ask.options.some((o) => o.value === value)) return null;
  return value;
}

// `patience` is the chance a shopper bothers to answer a question at all.
// At 1.0 they are an oracle: every question is answered instantly and
// correctly, asking costs nothing, and the benchmark will always prefer a
// store that interrogates. Real shoppers shrug. Sweeping this is what turns
// "how much should it ask" from taste back into a measurement.
export function bench({ n = 400, seed = 2026, maxAsks = 3, patience = 1 } = {}) {
  const rng = mulberry32(seed);
  const stats = { n: 0, hit10: 0, hit1: 0, rrSum: 0, turnSum: 0, asked: 0, unanswerable: 0 };
  const misses = [];

  for (let tries = 0; stats.n < n && tries < n * 6; tries++) {
    const target = cat.items[Math.floor(rng() * cat.items.length)];
    const query = queryFor(target, rng);
    if (!query) continue;

    // The production path, exactly: the sentence parser first, even though a
    // keyword query has no budget or refusal in it for the parser to find.
    const req = parseRequest(query, cat);
    let constraints = req.constraints;
    const declined = [];
    let asks = 0;
    let scored = cat.search(req.query, constraints, req);

    // Run the real loop: the policy asks, the simulated shopper answers.
    for (;;) {
      const d = decide(cat, scored, constraints, asks, { declined });
      if (d.action !== 'ask' || asks >= maxAsks) break;
      const value = rng() < patience ? answerAs(target, d.facet, d) : null;
      asks++;
      if (value === null) {
        // "No preference" — the store must not filter on it, and must not
        // ask it again. It may still ask something else.
        declined.push(d.facet);
        continue;
      }
      constraints = { ...constraints, [d.facet]: [value] };
      scored = cat.search(req.query, constraints, req);
    }

    const rank = scored.findIndex((s) => s.item.id === target.id) + 1;
    stats.n++;
    stats.asked += asks;
    stats.turnSum += asks + 1;               // the search itself is a turn
    if (rank === 1) stats.hit1++;
    if (rank >= 1 && rank <= 10) { stats.hit10++; stats.rrSum += 1 / rank; }
    else misses.push({ query, rank, title: target.t.slice(0, 58), pool: scored.length });
  }

  return {
    summary: {
      targets: stats.n,
      'Hit@10': +(stats.hit10 / stats.n).toFixed(4),
      'Hit@1': +(stats.hit1 / stats.n).toFixed(4),
      MRR: +(stats.rrSum / stats.n).toFixed(4),
      meanTurns: +(stats.turnSum / stats.n).toFixed(3),
      askRate: `${(100 * stats.asked / stats.n).toFixed(0)}%`,
    },
    misses,
  };
}

if (/[\\/]bench\.mjs$/.test(process.argv[1] ?? '')) {
  const args = process.argv.slice(2);
  const n = Number(args.find((a) => /^\d+$/.test(a))) || 400;
  const { summary, misses } = bench({ n });
  console.log(summary);
  console.log(`\nmissed ${misses.length} (target not in top 10):`);
  for (const m of misses.slice(0, 10)) {
    console.log(`  rank=${String(m.rank || '-').padStart(5)} pool=${String(m.pool).padStart(4)}  "${m.query}"  ->  ${m.title}`);
  }
  report(floorFailures(summary, args));
}
