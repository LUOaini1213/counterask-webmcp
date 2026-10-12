// What the sentence parser must read, and must not.
//
// agentbench.mjs writes its sentences from templates, and a parser tuned on
// them can pass while failing the next phrasing a person tries. These are
// hand-written, in the wording people and agents actually use, each with what
// the store has to take from it — and, as important, what it must leave alone:
// "no-show socks" refuse nothing, "size 10" is not a budget, "Under Armour"
// is a brand.
//
//   node scripts/parse_test.mjs

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Catalog, parseRequest } from '../public/engine.js';

const cat = new Catalog(JSON.parse(
  readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));

// Each case: the sentence, then what must hold. Keys map onto the parse
// result; `has` / `lacks` check words in the cleaned query.
const CASES = [
  ['leather belt', { constraints: { material: ['leather'] }, has: ['leather', 'belt'], optional: ['leather'] }],
  ["I'm looking for a leather belt, nothing with a snap, not over $50",
    { constraints: { material: ['leather'] }, exclude: { closure: ['snap'] }, excludeTerms: ['snap'], budget: { min: null, max: 50 }, lacks: ['looking', 'snap', 'over'] }],
  ['a wallet that is not leather, under $30',
    { constraints: {}, exclude: { material: ['leather'] }, excludeTerms: ['leather'], budget: { min: null, max: 30 }, lacks: ['leather', 'that is'] }],
  ['running shoes under 50 bucks', { constraints: { occasion: ['athletic'] }, budget: { min: null, max: 50 } }],
  ['socks between $10 and $20', { budget: { min: 10, max: 20 } }],
  ['socks between 10-20 dollars', { budget: { min: 10, max: 20 } }],
  ['boots $80 to $120', { budget: { min: 80, max: 120 } }],
  ['a $30 belt', { budget: { min: 22, max: 38 } }],
  ['shoes around 60', { budget: { min: 45, max: 75 } }],
  ['boots over $100', { budget: { min: 100, max: null } }],
  ['belt over $20 and under $40', { budget: { min: 20, max: 40 }, lacks: ['over', 'under', '$20', '$40'] }],
  ['belt under $40 and over $20', { budget: { min: 20, max: 40 } }],
  ['belt under $50, under $30, and at least $20', { budget: { min: 20, max: 30 } }],
  ['belt not over $50 and not under $20', { budget: { min: 20, max: 50 }, excludeTerms: [] }],
  ['belt no less than $20', { budget: { min: 20, max: null } }],
  ['belt not less than $20', { budget: { min: 20, max: null } }],
  ['belt not below $20', { budget: { min: 20, max: null } }],
  ['belt under $1,000', { budget: { min: null, max: 1000 }, lacks: ['000'] }],
  ['watch between $1,000.50 and $2,000', { budget: { min: 1000.5, max: 2000 } }],
  ['belt under $40.', { budget: { min: null, max: 40 } }],
  ['belt between $40 and $20', {
    budget: { min: 40, max: 20 },
    budgetConflict: { min: 40, max: 20, reason: 'Minimum price exceeds maximum price.' },
  }],
  ['belt over $40 and under $20', {
    budget: { min: 40, max: 20 },
    budgetConflict: { min: 40, max: 20, reason: 'Minimum price exceeds maximum price.' },
  }],
  ['I have 40 dollars to spend on a hoodie', { budget: { min: null, max: 40 }, has: ['hoodie'], lacks: ['spend'] }],
  ['my budget is 25 for a tie', { budget: { min: null, max: 25 }, has: ['tie'] }],
  ['hoodie, 40 or less', { budget: { min: null, max: 40 } }],
  ['less than 20 dollar t-shirt', { budget: { min: null, max: 20 }, has: ['t-shirt'] }],
  ['hoodie under $40 or so', { budget: { min: null, max: 40 } }],
  ['size 10 running shoes', { budget: null, constraints: { occasion: ['athletic'] } }],
  ['I need 3 pairs of socks', { budget: null, has: ['socks'] }],
  ['2 pack boxer briefs', { budget: null }],
  ['cheapest wool sweater', { sort: 'price_asc', constraints: { material: ['wool'] }, lacks: ['cheapest'] }],
  ['not cheap belt', { sort: 'relevance', has: ['belt'], excludeTerms: [] }],
  ["I don't want a cheap belt", { sort: 'relevance', has: ['belt'], excludeTerms: [] }],
  ['not the most expensive belt', { sort: 'relevance', has: ['belt'], excludeTerms: [] }],
  ['not cheap, best rated belt', { sort: 'rating', has: ['belt'], excludeTerms: [] }],
  ['best rated hoodie', { sort: 'rating', lacks: ['best', 'rated'] }],
  ['most popular sneakers', { sort: 'popular', has: ['sneakers'] }],
  ['no-show socks', { exclude: {}, excludeTerms: [], has: ['no-show'] }],
  ['non-slip work boots', { exclude: {}, excludeTerms: [], constraints: { occasion: ['outdoor'] }, has: ['non-slip'] }],
  ['no iron dress shirt', { exclude: {}, excludeTerms: [], constraints: { occasion: ['formal'] } }],
  ["I don't want anything with a zipper", { exclude: { closure: ['zipper'] }, excludeTerms: ['zipper'] }],
  ["I'd rather not have a zipper", { exclude: { closure: ['zipper'] } }],
  ['skip the leather ones', { exclude: { material: ['leather'] }, lacks: ['leather', 'ones'] }],
  ['running shoes but not for the gym', { constraints: { occasion: ['athletic'] }, exclude: {}, conflicts: [{ facet: 'occasion', value: 'athletic' }] }],
  ['leather belt, not leather', {
    constraints: { material: ['leather'] }, exclude: {}, excludeTerms: [],
    conflicts: [{ facet: 'material', value: 'leather' }],
  }],
  ['leather belt, not leather or suede', {
    constraints: { material: ['leather'] }, exclude: { material: ['suede'] }, excludeTerms: ['suede'],
    bansNot: ['leather'], conflicts: [{ facet: 'material', value: 'leather' }],
  }],
  ['black belt, not black, no logo', {
    constraints: { color: ['black'] }, exclude: {}, excludeTerms: ['logo'],
    bansNot: ['black'], conflicts: [{ facet: 'color', value: 'black' }],
  }],
  ['waterproof hiking boots, no laces', { exclude: { closure: ['lace-up'] }, excludeTerms: ['lace'], constraints: { waterproof: ['water resistant'], occasion: ['outdoor'] } }],
  ['not nike', { excludeTerms: ['nike'], exclude: {} }],
  ['nothing from nike please', { excludeTerms: ['nike'], lacks: ['nike', 'please'] }],
  ['wool socks, not too thick', { constraints: { material: ['wool'] }, excludeTerms: ['thick'] }],
  ['a jacket in leather or suede', { constraints: { material: ['leather', 'suede'] } }],
  ['not leather or suede, a wallet', { exclude: { material: ['leather', 'suede'] }, has: ['wallet'] }],
  ['short sleeve shirt, not long sleeve', { constraints: { sleeve: ['short sleeve'] }, exclude: { sleeve: ['long sleeve'] }, excludeTerms: [] }],
  ['short-sleeve shirt, not long-sleeve', { constraints: { sleeve: ['short sleeve'] }, exclude: { sleeve: ['long sleeve'] }, excludeTerms: [] }],
  ['no big and tall', { exclude: { fit: ['big and tall'] }, excludeTerms: [] }],
  ["belt for my dad's birthday", { has: ['belt'], lacks: ['dad', 'birthday'], ignored: [] }],
  ['something formal for a wedding', { constraints: { occasion: ['formal'] }, lacks: ['wedding', 'something'] }],
  ['under armour hoodie', { budget: null, has: ['armour', 'hoodie'] }],
  ['the cheapest running shoes you have', { sort: 'price_asc', lacks: ['you have', 'cheapest'] }],
  ['do you have a slim fit dress shirt, machine washable', { constraints: { fit: ['slim fit'], occasion: ['formal'], care: ['machine wash'] }, lacks: ['do you have'] }],
  ['I want something for the gym, not polyester', { constraints: { occasion: ['athletic'] }, exclude: { material: ['polyester'] }, has: ['gym'] }],
  ['not made in the usa, a fleece', { exclude: { origin: ['made in usa'] }, excludeTerms: [], constraints: { material: ['fleece'] } }],
  ["Don't Run Out Of Steam sneaker", { exclude: {}, excludeTerms: [] }],
  ['a belt, any material is fine', { noPreference: ['material'], constraints: {}, has: ['belt'], lacks: ['material', 'fine'] }],
  ["running shoes, I don't care about the brand", { noPreference: [], exclude: {}, excludeTerms: [], lacks: ['brand', 'care'] }],
  ["dress shirt, fit doesn't matter", { noPreference: ['fit'], constraints: { occasion: ['formal'] }, lacks: ['matter'] }],
  ['wallet, no preference on material, under $20', { noPreference: ['material'], budget: { min: null, max: 20 } }],
  ['sweater, whatever fabric works', { noPreference: ['material'] }],
  ["I don't mind the closure, a leather belt", { noPreference: ['closure'], constraints: { material: ['leather'] }, exclude: {} }],
  ['any kind of jacket, not fussy about the sleeves', { noPreference: ['sleeve'], has: ['jacket'] }],
  ['work boots, avoid athletic for work', { exclude: { occasion: ['athletic'] }, bansNot: ['work'], constraints: { occasion: ['outdoor'] } }],
  ['boots, no laces to tie', { exclude: { closure: ['lace-up'] }, excludeTerms: ['lace'], bansNot: ['tie'] }],
  ['a shirt for work, not polyester', { exclude: { material: ['polyester'] }, optional: ['business', 'formal', 'office'], lacks: ['work'] }],
  ['shoes, not for work', { excludeTerms: ['work'], optional: [] }],
  ['black leather belt', { constraints: { color: ['black'], material: ['leather'] }, has: ['belt'] }],
  ['a hoodie, not black or navy', { exclude: { color: ['black', 'navy'] }, constraints: {} }],
  ['sneakers, any colour is fine, under $60', { noPreference: ['color'], budget: { min: null, max: 60 } }],
  ['faux leather jacket', { constraints: { material: ['faux leather'] } }],
  ['a full zip fleece in grey', { constraints: { closure: ['zipper'], material: ['fleece'], color: ['grey'] } }],
];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedObj = (o) => Object.fromEntries(Object.entries(o ?? {}).sort().map(([k, v]) => [k, [...v].sort()]));

let failed = 0;
for (const [text, want] of CASES) {
  const got = parseRequest(text, cat);
  const problems = [];
  const q = ` ${got.query} `;
  for (const [key, expect] of Object.entries(want)) {
    if (key === 'has') {
      for (const w of expect) if (!q.includes(` ${w} `) && !q.includes(` ${w},`)) problems.push(`query lacks "${w}" (query: "${got.query}")`);
    } else if (key === 'lacks') {
      for (const w of expect) if (q.includes(` ${w} `) || q.includes(` ${w},`)) problems.push(`query still has "${w}" (query: "${got.query}")`);
    } else if (key === 'constraints' || key === 'exclude') {
      if (!eq(sortedObj(got[key]), sortedObj(expect))) problems.push(`${key} ${JSON.stringify(got[key])} ≠ ${JSON.stringify(expect)}`);
    } else if (key === 'excludeTerms' || key === 'optional' || key === 'ignored' || key === 'noPreference') {
      const g = [...got[key]].sort();
      const e = [...expect].sort();
      const ok = key === 'excludeTerms' && expect.length ? expect.every((w) => g.includes(w)) : eq(g, e);
      if (!ok) problems.push(`${key} ${JSON.stringify(got[key])} ≠ ${JSON.stringify(expect)}`);
    } else if (key === 'bansNot') {
      for (const w of expect) if (got.excludeTerms.includes(w)) problems.push(`"${w}" must not be banned (excludeTerms: ${JSON.stringify(got.excludeTerms)})`);
    } else if (key === 'conflicts') {
      if (!eq(got.conflicts, expect)) problems.push(`conflicts ${JSON.stringify(got.conflicts)} ≠ ${JSON.stringify(expect)}`);
    } else if (!eq(got[key], expect)) {
      problems.push(`${key} ${JSON.stringify(got[key])} ≠ ${JSON.stringify(expect)}`);
    }
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL "${text}"`);
    for (const p of problems) console.log(`     ${p}`);
  }
}

console.log(`\n${CASES.length - failed} / ${CASES.length} sentences read as intended`);
if (failed) process.exitCode = 1;
