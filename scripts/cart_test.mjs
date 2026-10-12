// Exercise the production cart handlers with a minimal DOM, without WebMCP.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const node = () => ({ hidden: false, textContent: '', innerHTML: '', disabled: false,
  append() {}, querySelector() { return this.submit ??= node(); } });
let saved = null;
const sandbox = {
  document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node },
  localStorage: { setItem(k, v) { saved = v; }, getItem() { return saved; } },
};
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bboot\(\);\s*$/, '');
vm.runInNewContext(source + '\nglobalThis.test = {state, addToCart, cartSnapshot, placeOrder, restore};', sandbox);
const { state, addToCart, cartSnapshot, placeOrder, restore } = sandbox.test;
state.catalog = { byId: new Map([
  ['priced', { id: 'priced', t: 'Belt', p: 12.5 }],
  ['unknown', { id: 'unknown', t: 'Unpriced belt', p: null }],
]) };

for (const quantity of [0, -1, 1.5, Infinity, NaN, '2', 100, null]) {
  assert.ok(addToCart('priced', quantity).error, `reject invalid quantity ${quantity}`);
  assert.equal(state.cart.size, 0, 'invalid additions must not mutate the cart');
}
assert.equal(addToCart('priced').added.quantity, 1);
assert.equal(addToCart('priced', 98).added.quantity, 98);
assert.ok(addToCart('priced', 1).error, 'enforce accumulated line limit');
assert.equal(state.cart.get('priced'), 99);
assert.equal(cartSnapshot().total, 1237.5);
assert.equal(nodes.get('cartCount').textContent, '99 items');
assert.equal(placeOrder({name:'  ', address:'Road'}).status, 'no_order');
assert.equal(state.cart.get('priced'), 99);
addToCart('unknown');
assert.equal(cartSnapshot().total, null, 'missing price is not a zero-priced item');
assert.equal(cartSnapshot().subtotal, 1237.5);
assert.equal(nodes.get('checkout').querySelector('button[type=submit]').disabled, true);
assert.equal(placeOrder({name:'Buyer', address:'Road'}).status, 'no_order');
assert.equal(state.cart.size, 2, 'blocked checkout preserves both items');
state.cart.delete('unknown');
const order = placeOrder({name:' Buyer ', address:' Road '});
assert.equal(order.status, 'placed');
assert.equal(order.order.name, 'Buyer');
assert.equal(order.order.total, 1237.5);
assert.match(nodes.get('orderDone').textContent, /99 items/);
assert.match(nodes.get('cartFeedback').textContent, /Demo order placed/);
assert.equal(state.cart.size, 0);

// Corrupt/legacy stored entries must neither crash boot nor poison totals.
saved = JSON.stringify({cart:[null, 3, ['priced', -1], ['unknown', null], ['missing', 1], ['priced', 2]]});
assert.doesNotThrow(restore);
assert.equal(state.cart.size, 1);
assert.equal(state.cart.get('priced'), 2);
console.log('Cart regression checks passed: quantities, totals, checkout, persisted entries.');
