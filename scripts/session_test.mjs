// Run the production restore and boot paths against saved visits and failed loads.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Catalog, decide, parseRequest, tokenize, POLICY } from '../public/engine.js';

const payload = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const catalog = new Catalog(payload);
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bboot\(\);\s*$/, '');
const plain = (value) => JSON.parse(JSON.stringify(value));
const priced = catalog.items.find((item) => Number.isFinite(item.p) && item.p >= 0);

function harness(saved = null, options = {}) {
  const nodes = new Map();
  const node = () => ({ hidden: false, textContent: '', innerHTML: '', disabled: false, value: '',
    append() {}, prepend() {}, addEventListener() {}, setAttribute() {}, classList: { toggle() {} },
    querySelector() { return this.submit ??= node(); } });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  let storage = options.raw ?? JSON.stringify(saved);
  let registrations = 0;
  const sandbox = {
    Catalog, decide, parseRequest, tokenize, POLICY, URLSearchParams,
    location: { search: '' },
    document: { getElementById: get, createElement: node },
    localStorage: {
      getItem() { if (options.noStorage) throw new Error('Storage denied'); return storage; },
      setItem(key, value) { if (options.noStorage) throw new Error('Storage denied'); storage = value; },
    },
    fetch: options.fetch ?? (async () => ({ ok: true, json: async () => payload })),
    registerTools() { registrations++; return false; },
  };
  vm.runInNewContext(source + '\nglobalThis.test = {state, restore, renderCart, persist, search, refine, addToCart, placeOrder, boot};', sandbox);
  sandbox.test.state.catalog = catalog;
  return { ...sandbox.test, get, saved: () => JSON.parse(storage), registrations: () => registrations };
}

// Real refinements and refusals survive a reload; reparsing said would lose them.
const original = harness();
original.search('leather belt under $50');
original.refine('closure', ['buckle']);
original.refine('material', ['canvas'], 'human', 'exclude');
original.state.declined.add('occasion');
original.state.asks = 1;
original.addToCart(priced.id, 2);
original.persist();
const resumed = harness(original.saved());
assert.equal(resumed.restore(), true);
for (const field of ['said', 'query', 'constraints', 'exclude', 'excludeTerms', 'budget', 'sort', 'optional', 'asks']) {
  assert.deepEqual(plain(resumed.state[field]), plain(original.state[field]), `preserve ${field}`);
}
assert.equal(resumed.state.cart.get(priced.id), 2);
assert.deepEqual([...resumed.state.declined], [...original.state.declined]);
assert.equal(resumed.state.scored.length, original.state.scored.length);

// Tools can create a useful structured search without any original sentence.
const structured = harness();
structured.search('', 'agent', { attributes: { material: ['leather'] }, budget_max: 30 });
const structuredAgain = harness(structured.saved());
assert.equal(structuredAgain.restore(), true);
assert.deepEqual(plain(structuredAgain.state.constraints), { material: ['leather'] });
assert.deepEqual(plain(structuredAgain.state.budget), { min: null, max: 30 });

const corruptFields = [
  { query: {} }, { constraints: { material: 'leather', closure: ['buckle', 4] } },
  { exclude: { material: null } }, { excludeTerms: [null, 7, 'snap'] },
  { declined: 42 }, { stated: {} }, { claims: [null, { pass: {}, said: 9 }] },
  { conflicts: [null, 2, {}] }, { optional: {} }, { ignored: false },
  { asks: -4 }, { asks: '1' }, { budget: { min: '0', max: 50 } },
  { sort: {} }, { order: {} }, { order: { items: [], total: '10' } },
];
for (const corruption of corruptFields) {
  const visit = harness({ ...original.saved(), ...corruption });
  assert.doesNotThrow(() => { visit.restore(); visit.renderCart(); }, JSON.stringify(corruption));
  assert.equal(visit.state.cart.get(priced.id), 2, 'a damaged field preserves the valid cart');
  if (!corruption.exclude) assert.equal(visit.state.exclude.material[0], 'canvas', 'valid refusals survive unrelated corruption');
}
for (const raw of ['{broken', 'null', '42', '[]']) {
  assert.doesNotThrow(() => harness(null, { raw }).restore(), raw);
}
const staleFacets = harness(JSON.parse('{"said":"belt","constraints":{"__proto__":["x"],"obsolete":["x"],"material":["leather","obsolete",null]},"declined":["obsolete","occasion"]}'));
assert.doesNotThrow(staleFacets.restore);
assert.deepEqual(plain(staleFacets.state.constraints), { material: ['leather'] });
assert.deepEqual([...staleFacets.state.declined], ['occasion']);

// Only a complete, internally consistent order can be displayed as placed.
const orderVisit = harness();
orderVisit.addToCart(priced.id, 2);
const placed = orderVisit.placeOrder({ name: 'Test Buyer', address: 'Test Road' }).order;
const orderAgain = harness(orderVisit.saved());
orderAgain.restore();
orderAgain.renderCart();
assert.deepEqual(plain(orderAgain.state.order), plain(placed));
assert.match(orderAgain.get('orderDone').textContent, /Demo order/);
for (const corruption of [{ total: '10' }, { total: placed.total + 1 }, { items: [null] },
  { items: [{ ...placed.items[0], quantity: -1 }] }]) {
  const invalid = harness({ order: { ...plain(placed), ...corruption } });
  invalid.restore();
  assert.doesNotThrow(invalid.renderCart);
  assert.equal(invalid.state.order, null);
}

// Fetch, HTTP, JSON and catalogue errors remain visible and preserve storage.
for (const fetch of [
  async () => { throw new Error('Offline'); },
  async () => ({ ok: false, status: 503, json: async () => payload }),
  async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
  async () => ({ ok: true, json: async () => ({}) }),
]) {
  const failed = harness(original.saved(), { fetch });
  assert.equal(await failed.boot(), false);
  assert.match(failed.get('statusTitle').textContent, /could not be loaded/);
  assert.match(failed.get('statusN').textContent, /reload/);
  assert.equal(failed.get('go').disabled, true);
  assert.equal(failed.registrations(), 0);
  assert.deepEqual(failed.saved(), original.saved());
}
const loaded = harness({ ...original.saved(), order: {}, claims: [null] });
assert.equal(await loaded.boot(), true);
assert.equal(loaded.registrations(), 1, 'bad persisted fields must not prevent tool registration');
assert.equal(loaded.get('go').disabled, false);
assert.equal(await harness(null, { noStorage: true }).boot(), true);
console.log('Session regression checks passed: valid restore, corrupt fields, orders, and load failures.');
