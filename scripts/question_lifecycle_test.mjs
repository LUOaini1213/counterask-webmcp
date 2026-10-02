import assert from 'node:assert/strict';
import { standInContext } from '../public/demo.js';
import { registerTools } from '../public/webmcp.js';

globalThis.location ??= { origin: 'http://localhost' };
globalThis.document ??= {};
const listeners = new Set();
let pending = false;
const change = (value) => { pending = value; for (const fn of listeners) fn(value); };
const api = {
  subscribeQuestion(fn) { listeners.add(fn); fn(pending); return () => listeners.delete(fn); },
  search() { change(true); return { status: 'need_more_evidence' }; },
  answerQuestion() { change(false); return { status: 'answer' }; },
  cart() { return { status: 'cart', items: [] }; },
  parseOnly() { return { status: 'reading' }; },
  vocab() { return {}; },
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = () => new Promise((r) => setTimeout(r, 1700));
const ctx = standInContext();
registerTools(api, null, ctx);
await tick();
change(true); // A person searched using the page, not an agent tool.
await tick();
assert.ok(ctx.tools.has('answer_question'), 'human search exposes its pending question');
await ctx.tools.get('view_cart').execute({});
await ctx.tools.get('parse_only').execute({query:'belt'});
await settle();
assert.ok(ctx.tools.has('answer_question'), 'read-only tool results cannot close the question');
change(false); // Person clicked a choice/reset.
await settle();
assert.ok(!ctx.tools.has('answer_question'), 'human answer removes the tool');

change(true); // Restored question exists before tools initialize.
const restored = standInContext();
registerTools(api, null, restored);
await tick();
assert.ok(restored.tools.has('answer_question'), 'restored question is registered on boot');
registerTools(api, null, restored);
assert.equal(listeners.size, 2, 're-registering a context does not leak subscriptions');

await Promise.all([ctx.tools.get('search_products').execute({query:'belt'}),
  ctx.tools.get('search_products').execute({query:'belt'})]);
assert.ok(ctx.tools.has('answer_question'), 'concurrent searches do not duplicate registration');
await ctx.tools.get('answer_question').execute({value:'leather'});
change(true); // New human search before deferred unregister fires.
await settle();
assert.ok(ctx.tools.has('answer_question'), 'a previous close cannot unregister a new question');
change(false);
await settle();

// Slow registration plus a queued read must not bypass the native call's
// deferred unregister window when the question closes in the meantime.
const slow = standInContext();
const originalRegister = slow.registerTool.bind(slow);
let release;
const gate = new Promise((r) => { release = r; });
slow.registerTool = async (spec, options) => {
  await originalRegister(spec, options);
  if (spec.name === 'answer_question') await gate;
};
registerTools(api, null, slow);
await tick();
change(true);
await tick();
const cartRead = slow.tools.get('view_cart').execute({});
await tick();
change(false);
release();
await cartRead;
await tick();
assert.ok(slow.tools.has('answer_question'), 'queued work cannot bypass the deferred unregister window');
await settle();
assert.ok(!slow.tools.has('answer_question'), 'the delayed close still completes');
console.log('Question lifecycle passed: human, reload, read-only calls, repeat registration and races.');
