// Retrieval regressions for parser boundaries: assert what shoppers receive,
// not only the intermediate parse. Uses the frozen production catalogue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Catalog, parseRequest } from '../public/engine.js';

const cat = new Catalog(JSON.parse(readFileSync(
  new URL('../public/data/catalog.json', import.meta.url), 'utf8')));
const run = (query) => {
  const parsed = parseRequest(query, cat);
  return { parsed, hits: cat.search(parsed.query, parsed.constraints, parsed) };
};
const ids = (hits) => hits.map((hit) => hit.item.id).sort();

for (const query of [
  'belt over $20 and under $40',
  'belt under $40 and over $20',
  'belt not under $20 and not over $40',
  'belt no less than $20 and no more than $40',
]) {
  const { hits } = run(query);
  const priced = hits.filter((hit) => typeof hit.item.p === 'number');
  assert.ok(priced.length > 0, `${query}: expected priced candidates`);
  assert.ok(priced.every((hit) => hit.item.p >= 20 && hit.item.p <= 40),
    `${query}: both bounds must hold for every priced result`);
}

assert.deepEqual(ids(run('belt under $1,000').hits), ids(run('belt under $1000').hits),
  'A thousands separator must not change the amount or add a query term');

for (const query of ['belt between $40 and $20', 'belt over $40 and under $20']) {
  const { parsed, hits } = run(query);
  assert.ok(parsed.budgetConflict, `${query}: report the contradiction`);
  assert.equal(hits.length, 0, `${query}: even unpriced items cannot meet contradictory bounds`);
}
assert.equal(cat.search('belt', {}, { budget: { min: 40, max: 20 } }).length, 0,
  'Structured inverted ranges must not return unpriced products either');

const leather = run('leather belt').hits;
assert.ok(leather.length > 0);
assert.deepEqual(ids(run('leather belt, not leather').hits), ids(leather),
  'The declared positive-wins conflict policy must remove the companion word ban');
const mixed = run('leather belt, not leather or suede');
assert.ok(mixed.hits.length > 0);
assert.ok(mixed.hits.every((hit) => hit.item.f.material.includes('leather')
  && !hit.item.f.material.includes('suede') && !hit.item.terms.has('suede')),
  'Resolving leather must preserve the independent suede refusal');

for (const query of ['not cheap belt', "I don't want a cheap belt", 'not premium belt']) {
  const { parsed, hits } = run(query);
  assert.equal(parsed.sort, 'relevance');
  assert.deepEqual(ids(hits), ids(run('belt').hits),
    `${query}: negated price wording must not ban the requested product type`);
}

console.log('ok — composed price bounds, inverted ranges, facet conflicts and negated ordering');
