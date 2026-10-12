// Run the production conversation transitions with the real catalogue and
// retrieval policy. Rendering is the only app function replaced by a stub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Catalog, decide, parseRequest, tokenize, POLICY } from '../public/engine.js';

const catalog = new Catalog(JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));
const nodes = new Map();
const node = () => ({
  children: [], attributes: {}, listeners: {},
  append(child) { this.children.push(child); },
  setAttribute(name, value) { this.attributes[name] = value; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
});
const sandbox = {
  Catalog, decide, parseRequest, tokenize, POLICY,
  document: {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node,
  },
};
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bboot\(\);\s*$/, '');
vm.runInNewContext(source + '\nrender = () => {}; globalThis.test = {api, renderChips};', sandbox);
const { api, renderChips } = sandbox.test;
api.state.catalog = catalog;
const plain = (value) => JSON.parse(JSON.stringify(value));
const equals = (actual, expected, message) => assert.deepEqual(plain(actual), expected, message);
const candidates = () => api.state.scored.map(({ item }) => item);
const lacks = (facet, values) => assert.ok(candidates().every((item) =>
  !(item.f[facet] ?? []).some((value) => values.includes(value))), `every candidate respects ${facet} refusals`);

let result = api.search('belt not leather, no cotton, no Nike', 'agent', { attributes: { material: ['leather'] } });
assert.ok(result.candidates > 0, 'structured requirement overrides the opposing parsed refusal');
equals(result.understood.attributes.material, ['leather']);
equals(result.understood.exclude.material, ['cotton']);
assert.ok(!result.understood.excludeWords.includes('leather'), 'the companion word ban is overridden too');
assert.ok(result.understood.excludeWords.includes('cotton'), 'unrelated material refusal stays hard');
assert.ok(result.understood.excludeWords.includes('nike'), 'unrelated title refusal stays hard');
assert.ok(candidates().every((item) => item.f.material?.includes('leather')));
lacks('material', ['cotton']);

result = api.search('leather belt', 'agent', { exclude: { material: ['leather'] } });
assert.ok(result.candidates > 0, 'structured refusal overrides the parsed requirement');
assert.equal(result.understood.attributes.material, undefined);
lacks('material', ['leather']);

result = api.search('cotton belt', 'agent', { attributes: { material: ['leather'] } });
assert.ok(result.candidates > 0);
equals(result.understood.attributes.material, ['leather'], 'same-field structured requirement replaces the parse');
assert.ok(candidates().every((item) => item.f.material?.includes('leather')));

result = api.search('belt not leather, no Nike', 'agent', { exclude: { material: ['cotton'] } });
equals(result.understood.exclude.material, ['cotton']);
assert.ok(!result.understood.excludeWords.includes('leather'), 'replaced parsed refusal leaves no hidden title ban');
assert.ok(result.understood.excludeWords.includes('nike'));
lacks('material', ['cotton']);

result = api.search('belt not leather', 'agent', { exclude: { material: ['leather'] } });
assert.ok(result.understood.excludeWords.includes('leather'), 'repeating a refusal preserves its title protection');

result = api.search('belt', 'agent', { attributes: { material: ['leather'] }, exclude: { material: ['leather'] } });
assert.equal(result.status, 'no_match', 'explicitly contradictory structured fields are not silently relaxed');
equals(result.understood.attributes.material, ['leather']);
equals(result.understood.exclude.material, ['leather']);
assert.equal(api.snapshot().status, 'no_match', 'a read-only snapshot preserves an empty decision');

api.search('belt');
api.refine('material', ['leather'], 'agent', 'exclude');
const afterFirstRefusal = new Set(candidates().map((item) => item.id));
result = api.refine('material', ['cotton'], 'agent', 'exclude');
equals(result.understood.exclude.material, ['leather', 'cotton'], 'successive refusals accumulate');
lacks('material', ['leather', 'cotton']);
assert.ok(candidates().every((item) => afterFirstRefusal.has(item.id)), 'adding a refusal cannot reintroduce a candidate');
result = api.refine('material', ['leather'], 'agent', 'exclude');
equals(result.understood.exclude.material, ['leather', 'cotton'], 'repeated refusals are idempotent');
assert.equal(api.refine('material', ['leather']).status, 'no_match', 'refinement retains hard contradictory refusals');

api.search('belt not leather, no Nike');
result = api.revise(['material']);
assert.equal(result.understood.exclude.material, undefined);
assert.ok(!result.understood.excludeWords.includes('leather'), 'dropping a facet drops its companion word ban');
assert.ok(result.understood.excludeWords.includes('nike'));
assert.ok(candidates().some((item) => item.f.material?.includes('leather')), 'taking back the refusal restores matching products');

api.search('boots no laces, no Nike');
result = api.revise(['lace-up']);
assert.equal(result.understood.exclude.closure, undefined);
assert.ok(!result.understood.excludeWords.includes('lace'), 'canonical revisions also remove a stemmed surface word');
assert.ok(result.understood.excludeWords.includes('nike'));

api.search('belt not leather, no Nike');
renderChips();
const chips = nodes.get('chips').children;
const buttons = chips.flatMap((chip) => chip.children);
assert.ok(!buttons.some((button) => button.attributes['aria-label'] === 'Stop excluding leather'), 'a companion ban is one removable fact');
buttons.find((button) => button.attributes['aria-label'] === 'Stop excluding material').listeners.click();
assert.ok(!api.state.excludeTerms.includes('leather'), 'removing the visible refusal chip clears its companion title ban');
assert.ok(api.state.excludeTerms.includes('nike'));

result = api.search('belt');
assert.equal(result.status, 'need_more_evidence', 'fixture opens a genuine production question');
const pending = plain(result);
const questionKeys = ['question', 'facet', 'options', 'otherValues', 'notRecorded', 'why', 'candidates'];
for (const key of questionKeys) equals(api.snapshot()[key], pending[key], `snapshot retains pending ${key}`);
for (const empty of [undefined, null, [], [''], [null]]) {
  result = api.answerQuestion(empty);
  assert.equal(result.questionsAsked, 0, 'an empty answer cannot silently claim no preference');
  assert.equal(result.status, 'need_more_evidence');
  assert.ok(result.understood.rejected.length > 0);
  for (const key of questionKeys) equals(result[key], pending[key], `empty answer retains pending ${key}`);
}
for (let attempt = 0; attempt < POLICY.maxAsks + 1; attempt++) {
  result = api.answerQuestion(['not-a-catalogue-value']);
  assert.equal(result.questionsAsked, 0, 'an invalid answer never spends a question');
  assert.equal(result.status, 'need_more_evidence');
  assert.equal(result.understood.rejected.length, 1);
  for (const key of questionKeys) equals(result[key], pending[key], `invalid answer retains pending ${key}`);
}
result = api.refine('not-a-facet', ['anything']);
assert.equal(result.questionsAsked, 0);
assert.equal(result.question, pending.question, 'invalid refinement also preserves the current question');
result = api.answerQuestion([pending.options[0].value]);
assert.equal(result.questionsAsked, 1, 'a valid answer spends exactly one question');
equals(result.understood.attributes[pending.facet], [pending.options[0].value]);

api.search('belt');
result = api.answerQuestion(['no_preference']);
assert.equal(result.questionsAsked, 1);
assert.ok(result.understood.noPreference.includes(pending.facet));
assert.equal(result.understood.rejected, undefined, 'a valid skip clears prior input rejections');
if (result.status === 'need_more_evidence') assert.notEqual(result.facet, pending.facet);

result = api.search('belt', 'agent', { budget_min: 80, budget_max: 20 });
assert.equal(result.status, 'no_match', 'impossible structured budgets do not admit unknown prices');
equals(result.understood.budgetConflict, { min: 80, max: 20, reason: 'Minimum price exceeds maximum price.' });
assert.ok(result.caveats.includes('Minimum price exceeds maximum price.'));
assert.equal(api.revise(['budget']).understood.budgetConflict, undefined, 'taking back a budget clears its conflict');
result = api.parseOnly('belt over $80 and under $20');
equals(result.budgetConflict, { min: 80, max: 20, reason: 'Minimum price exceeds maximum price.' });

result = api.search('belt between $10 and $100', 'agent', { budget_max: 50 });
equals(result.understood.budget, { min: 10, max: 50 }, 'an explicit maximum preserves the parsed minimum');
result = api.search('belt between $10 and $100', 'agent', { budget_min: 20 });
equals(result.understood.budget, { min: 20, max: 100 }, 'an explicit minimum preserves the parsed maximum');
for (const value of [-1, Infinity, NaN, '20', true, null, '']) {
  result = api.search('belt between $10 and $100', 'agent', { budget_max: value });
  equals(result.understood.budget, { min: 10, max: 100 }, 'invalid structured limits cannot remove parsed limits');
  assert.equal(result.understood.rejected[0].facet, 'budget_max');
  assert.equal(result.understood.rejected[0].reason, 'must be a finite nonnegative number');
}
result = api.search('belt under $100', 'agent', { budget_min: 0 });
equals(result.understood.budget, { min: 0, max: 100 }, 'a zero budget bound is valid');

console.log('Dialogue regression checks passed: structured precedence, accumulated refusals, revisions, pending questions, invalid answers and budget conflicts.');
