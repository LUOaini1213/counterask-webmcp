// How much should the store ask, if shoppers do not always answer?
import { POLICY, setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
setShelfMode('off');
const score = (h, m, t) => 0.5 * h + 0.3 * m + 0.2 * Math.max(0, Math.min(1, (11 - t) / 10));
const out = [];
for (const patience of [1.0, 0.7, 0.4]) {
  const row = { patience };
  let best = null;
  for (const minRemoved of [10, 20, 30, 45, 60, 90]) {
    POLICY.minRemoved = minRemoved;
    const b = bench({ n: 800, seed: 2026, patience });
    const s = score(b.summary['Hit@10'], b.summary.MRR, b.summary.meanTurns);
    row[`mr${minRemoved}`] = +s.toFixed(4);
    if (!best || s > best.s) best = { s, minRemoved };
  }
  row.best = best.minRemoved;
  out.push(row);
}
console.table(out);
