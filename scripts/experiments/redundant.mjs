import { readFileSync } from 'node:fs';
import { Catalog, extractConstraints, decide } from '../../public/engine.js';
import { QUERIES } from '../eval.mjs';
const cat = new Catalog(JSON.parse(readFileSync(new URL('../../public/data/catalog.json', import.meta.url),'utf8')));
for (const label of ['without extraction','with extraction']) {
  const use = label === 'with extraction';
  let asked=0, redundant=0;
  for (const q of QUERIES) {
    const stated = extractConstraints(q, cat.facetValues, cat.facetForms);
    const c = use ? stated : {};
    const d = decide(cat, cat.search(q, c), c, 0);
    if (d.action !== 'ask') continue;
    asked++;
    if (stated[d.facet]) redundant++;
  }
  console.log(`${label.padEnd(20)} asks=${asked}  redundant=${redundant}`);
}
