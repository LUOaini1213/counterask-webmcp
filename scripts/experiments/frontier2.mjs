import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';
setShelfMode('off');
POLICY.answerBelow = 12;
const rows = [];
for (const minGain of [0.40, 0.45, 0.50, 0.55, 0.60, 0.70, 0.80]) {
  POLICY.minGain = minGain;
  const b = bench({ n: 800, seed: 2026 });
  const e = sweep();
  rows.push({ minGain, 'Hit@10': b.summary['Hit@10'], 'Hit@1': b.summary['Hit@1'],
              MRR: b.summary.MRR, meanTurns: b.summary.meanTurns, sweepAsk: e.askRate });
}
console.table(rows);
