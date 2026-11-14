// Asking has a price. This sweeps the two knobs that set it and prints the
// trade-off, so the thresholds come off a curve instead of out of the air.
//
// What we want: ask rate down, Hit@10 and MRR unmoved. Anywhere those two
// disagree, the question is not paying for its turn.
import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';

setShelfMode('off');
const rows = [];
for (const minGain of [0.12, 0.20, 0.28, 0.36, 0.45]) {
  for (const answerBelow of [12, 25, 40]) {
    POLICY.minGain = minGain;
    POLICY.answerBelow = answerBelow;
    const b = bench({ n: 800, seed: 2026 });
    const e = sweep();
    rows.push({
      minGain, answerBelow,
      'Hit@10': b.summary['Hit@10'], 'Hit@1': b.summary['Hit@1'], MRR: b.summary.MRR,
      benchAsk: b.summary.askRate, sweepAsk: e.askRate,
    });
  }
}
console.table(rows);
