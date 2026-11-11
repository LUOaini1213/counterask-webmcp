// The benchmark cannot price a turn: its shopper answers instantly and always
// correctly, so asking is free and asking more always scores better. A real
// shopper's patience is the scarce thing.
//
// Rather than invent a price, borrow a published one. TechJam Track 4 scores
// this exact task as 0.5*Hit@10 + 0.3*MRR + 0.2*Efficiency, with
// Efficiency = clip((11 - turns)/10, 0, 1) — one extra turn costs 0.02. Under
// that rule the threshold stops being taste and becomes an argmax.
import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';

setShelfMode('off');
const score = (h, m, turns) => 0.5 * h + 0.3 * m + 0.2 * Math.max(0, Math.min(1, (11 - turns) / 10));

const rows = [];
for (const minRemoved of [10, 15, 20, 25, 30, 45, 60, 90, 130]) {
  POLICY.minRemoved = minRemoved;
  const b = bench({ n: 800, seed: 2026 });
  const e = sweep();
  const s = score(b.summary['Hit@10'], b.summary.MRR, b.summary.meanTurns);
  rows.push({
    minRemoved,
    'Hit@10': b.summary['Hit@10'], MRR: b.summary.MRR,
    turns: b.summary.meanTurns, sweepAsk: e.askRate,
    trackScore: +s.toFixed(5),
  });
}
rows.sort((a, b) => b.trackScore - a.trackScore);
console.table(rows);
console.log(`best: minRemoved=${rows[0].minRemoved} at ${rows[0].trackScore}`);
