// A/B the three ways of using the catalogue's category tree.
// Nothing here is a judgement call — bench.mjs has ground truth, so the shelf
// mode is whichever one moves Hit@1 and MRR, or none of them.
import { setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';

const rows = [];
for (const mode of ['off', 'boost', 'restrict']) {
  setShelfMode(mode);
  const { summary, misses } = bench({ n: 800, seed: 2026 });
  rows.push({ mode, ...summary, misses: misses.length });
}
console.table(rows);
