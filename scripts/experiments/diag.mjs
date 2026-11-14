import { readFileSync } from 'node:fs';
import { Catalog, splitValue, separation, POLICY } from '../../public/engine.js';
const payload = JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url),'utf8'));
const cat = new Catalog(payload);
for (const q of ['wallet','belt','running shoes','leather belt']) {
  const scored = cat.search(q, {});
  const pool = scored.map(s=>s.item);
  console.log(`\n"${q}"  pool=${pool.length}  sep=${(separation(scored)*100).toFixed(0)}%`);
  const rows = cat.meta.facets.map(f=>({f,...splitValue(pool,f)}))
    .sort((a,b)=>b.gain-a.gain);
  for (const r of rows.slice(0,6)) {
    const gate = r.coverage < POLICY.minCoverage ? 'SKIP cov' : (r.gain < POLICY.minGain ? 'skip gain' : 'ELIGIBLE');
    console.log(`   ${r.f.padEnd(11)} cov=${(r.coverage*100).toFixed(0).padStart(3)}%  gain=${r.gain.toFixed(3)}  ${gate}`);
  }
}
