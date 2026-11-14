import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';
setShelfMode('off');
const rows = [];
for (const minRemoved of [20, 30, 45, 60, 90, 130]) {
  POLICY.minRemoved = minRemoved;
  const b = bench({ n: 800, seed: 2026 });
  const e = sweep();
  rows.push({ minRemoved, 'Hit@10': b.summary['Hit@10'], 'Hit@1': b.summary['Hit@1'],
              MRR: b.summary.MRR, benchAsk: b.summary.askRate, sweepAsk: e.askRate,
              poolP90: e.poolP90 });
}
console.table(rows);
