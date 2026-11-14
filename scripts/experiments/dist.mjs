import { readFileSync } from 'node:fs';
import { Catalog, decide, separation } from '../../public/engine.js';
import { QUERIES } from '../eval.mjs';
const cat = new Catalog(JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url),'utf8')));

// signature = the facet-value fingerprint of an item
const sig = (it) => Object.entries(it.f).sort().map(([k,v])=>k+':'+[...v].sort().join('/')).join('|');

const rows = QUERIES.map(q=>{
  const s = cat.search(q,{});
  const top = s.slice(0,10).map(x=>x.item);
  const distinct = new Set(top.map(sig)).size;
  return {q, pool:s.length, sep:+separation(s).toFixed(3), distinctTop10:distinct};
});
const seps = rows.map(r=>r.sep).sort((a,b)=>a-b);
const pct = p => seps[Math.floor(seps.length*p)];
console.log('separation percentiles: p10=%s p25=%s p50=%s p75=%s p90=%s max=%s',
  pct(.1),pct(.25),pct(.5),pct(.75),pct(.9),seps[seps.length-1]);
const dt = rows.map(r=>r.distinctTop10).sort((a,b)=>a-b);
console.log('distinct top-10 signatures: min=%s p25=%s median=%s p75=%s max=%s',
  dt[0],dt[Math.floor(dt.length*.25)],dt[Math.floor(dt.length/2)],dt[Math.floor(dt.length*.75)],dt[dt.length-1]);
console.log('\nqueries whose top-10 are near-clones (<=3 distinct signatures):');
for (const r of rows.filter(r=>r.distinctTop10<=3)) console.log(`  ${String(r.pool).padStart(4)}  sig=${r.distinctTop10}  sep=${r.sep}  ${r.q}`);
console.log('\nhighest separation:');
for (const r of rows.sort((a,b)=>b.sep-a.sep).slice(0,6)) console.log(`  sep=${String(r.sep).padEnd(6)} pool=${String(r.pool).padStart(4)}  ${r.q}`);
