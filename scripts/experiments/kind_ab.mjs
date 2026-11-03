// Does promoting the category leaf to an askable attribute earn its place?
import { setShelfMode } from '../../public/engine.js';
import { bench } from '../bench.mjs';
setShelfMode('off');
const { summary, misses } = bench({ n: 800, seed: 2026 });
console.log({ ...summary, misses: misses.length });
console.log('\nstill missed:');
for (const m of misses.slice(0, 8)) console.log(`  rank=${String(m.rank||'-').padStart(4)} pool=${String(m.pool).padStart(4)}  "${m.query}"  ->  ${m.title}`);
