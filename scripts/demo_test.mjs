import assert from 'node:assert/strict';
import { runScript } from '../public/demo.js';

const product = { id: 'wallet', title: 'Cheapest wallet', price: 12 };
async function run(cart) {
  const transcript = [];
  let filled = false;
  const results = {
    search_products: { status: 'answer', products: [product], candidates: 1 },
    explain_ranking: { error: 'Not needed for this test' }, show_products: {}, add_to_cart: cart,
  };
  const context = { tools: new Map(Object.entries(results).map(([name, result]) =>
    [name, { execute: async () => ({ structuredContent: result }) }])) };
  await runScript(context, (role, text) => transcript.push(text), async () => {}, {
    fillCheckout() { filled = true; },
  });
  return { transcript: transcript.join('\n'), filled };
}

const item = { ...product, quantity: 1, lineTotal: 12 };
const priced = await run({ items: [item], total: 12, subtotal: 12 });
assert.equal(priced.filled, true);
assert.match(priced.transcript, /Total \$12\.00/);
const unpriced = await run({ items: [
  { id: 'unknown', title: 'Existing unpriced belt', price: null, quantity: 1 }, item,
], total: null, subtotal: 12, unpricedItems: 1 });
assert.equal(unpriced.filled, false, 'do not invite checkout while prices are missing');
assert.match(unpriced.transcript, /Priced subtotal \$12\.00/);
assert.match(unpriced.transcript, /In the cart: Cheapest wallet/);
assert.match(unpriced.transcript, /End of script/);
const rejected = await run({ items: [item], total: 1188, error: 'Quantity must be a whole number from 1 to 99.' });
assert.equal(rejected.filled, false);
assert.match(rejected.transcript, /Quantity must/);
assert.doesNotMatch(rejected.transcript, /In the cart:/);
console.log('Demo regression checks passed: priced cart, missing price, rejected addition.');
