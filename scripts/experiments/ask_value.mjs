// Is asking still worth anything, now that the ranker is better?
//
// Copaon measured clarification as strictly harmful (0.8830 off vs 0.8173 on).
// Our earlier sweep said the opposite. The difference should be headroom: they
// were already at Hit@10 0.995 before asking, so a question could only cost a
// turn. BM25 moved our no-ask baseline, so the question has to be re-asked.
import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
setShelfMode('off');
const score = (h, m, t) => 0.5 * h + 0.3 * m + 0.2 * Math.max(0, Math.min(1, (11 - t) / 10));

const rows = [];
for (const [label, minRemoved] of [['never ask', 1e9], ['ask a lot (10)', 10], ['ask rarely (130)', 130]]) {
  for (const patience of [1.0, 0.6]) {
    POLICY.minRemoved = minRemoved;
    const r = bench({ n: 800, seed: 2026, patience });
    rows.push({ policy: label, patience,
      'Hit@10': r.summary['Hit@10'], 'Hit@1': r.summary['Hit@1'], MRR: r.summary.MRR,
      turns: r.summary.meanTurns,
      score: +score(r.summary['Hit@10'], r.summary.MRR, r.summary.meanTurns).toFixed(5) });
  }
}
console.table(rows);
const never = rows.find(r => r.policy === 'never ask' && r.patience === 1);
const lots = rows.find(r => r.policy === 'ask a lot (10)' && r.patience === 1);
console.log(`\nvalue of asking at patience 1.0:  Hit@10 ${(lots['Hit@10']-never['Hit@10']).toFixed(4)}  score ${(lots.score-never.score).toFixed(5)}`);
