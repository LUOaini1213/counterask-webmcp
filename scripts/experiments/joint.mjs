// Changing the scorer moved the separation distribution 7.6x, which silently
// invalidated decisiveSeparation — a threshold calibrated against the old
// scorer's percentiles. Re-fit both together rather than one after the other.
import { POLICY, setBm25B, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';
setShelfMode('off');
const score = (h, m, t) => 0.5 * h + 0.3 * m + 0.2 * Math.max(0, Math.min(1, (11 - t) / 10));
const rows = [];
for (const b of [0.3, 0.5, 0.75]) {
  for (const ds of [0.10, 0.18, 0.30, 0.50]) {
    setBm25B(b); POLICY.decisiveSeparation = ds;
    const r = bench({ n: 800, seed: 2026 });
    const e = sweep();
    rows.push({ b, decisiveSep: ds,
      'Hit@10': r.summary['Hit@10'], 'Hit@1': r.summary['Hit@1'], MRR: r.summary.MRR,
      turns: r.summary.meanTurns, sweepAsk: e.askRate,
      score: +score(r.summary['Hit@10'], r.summary.MRR, r.summary.meanTurns).toFixed(5) });
  }
}
rows.sort((a, b) => b.score - a.score);
console.table(rows);
