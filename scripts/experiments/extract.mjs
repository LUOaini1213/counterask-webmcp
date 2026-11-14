import { readFileSync } from 'node:fs';
import { Catalog, extractConstraints, decide } from '../../public/engine.js';
import { QUERIES } from '../eval.mjs';
const cat = new Catalog(JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url),'utf8')));
let hits=0, poolBefore=0, poolAfter=0, askBefore=0, askAfter=0;
for (const q of QUERIES) {
  const c = extractConstraints(q, cat.facetValues, cat.facetForms);
  const a = cat.search(q,{}), da = decide(cat,a,{},0);
  const b = cat.search(q,c),  db = decide(cat,b,c,0);
  poolBefore+=a.length; poolAfter+=b.length;
  if (da.action==='ask') askBefore++;
  if (db.action==='ask') askAfter++;
  if (Object.keys(c).length) { hits++;
    console.log(`  ${q.padEnd(26)} ${JSON.stringify(c).padEnd(44)} pool ${String(a.length).padStart(4)} -> ${String(b.length).padStart(4)}  ${da.action}->${db.action}`); }
}
console.log(`\nqueries with stated attributes: ${hits}/${QUERIES.length}`);
console.log(`mean pool: ${(poolBefore/QUERIES.length).toFixed(0)} -> ${(poolAfter/QUERIES.length).toFixed(0)}`);
console.log(`ask rate : ${(100*askBefore/QUERIES.length).toFixed(0)}% -> ${(100*askAfter/QUERIES.length).toFixed(0)}%`);
