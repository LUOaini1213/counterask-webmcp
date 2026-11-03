import { setBm25B, setShelfMode, separation, Catalog } from '../../public/engine.js';
import { bench } from '../bench.mjs';
import { run as sweep } from '../eval.mjs';
setShelfMode('off');
const rows = [];
for (const b of [0, 0.3, 0.5, 0.75, 0.9]) {
  setBm25B(b);
  const r = bench({ n: 800, seed: 2026 });
  const e = sweep();
  rows.push({ b, 'Hit@10': r.summary['Hit@10'], 'Hit@1': r.summary['Hit@1'],
              MRR: r.summary.MRR, sepMedian: e.sepMedian, sweepAsk: e.askRate });
}
console.table(rows);
