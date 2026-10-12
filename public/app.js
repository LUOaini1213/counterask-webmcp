// Counterask storefront.
//
// One state machine drives both surfaces. A person clicking an answer chip and
// an agent calling answer_question land in exactly the same function, so the
// page can never tell them apart and can never drift between them.

import { Catalog, decide, parseRequest, tokenize, POLICY } from './engine.js';
import { registerTools } from './webmcp.js';
import { standInContext, runScript } from './demo.js';

const el = (id) => document.getElementById(id);

const SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'popular'];
const SORT_LABEL = {
  relevance: 'relevance', price_asc: 'cheapest first', price_desc: 'priciest first',
  rating: 'best rated', popular: 'most reviewed',
};

const state = {
  catalog: null,
  vocab: null,          // facet -> [{ value, count }], computed once
  said: '',             // what was typed or passed, verbatim
  query: '',            // the product description left after parsing
  constraints: {},      // facet -> [values] the shopper requires
  exclude: {},          // facet -> [values] the shopper refused
  excludeTerms: [],     // words the shopper refused outright
  budget: null,         // { min, max } or null
  sort: 'relevance',
  optional: [],         // query words the filter already guarantees
  ignored: [],          // query words no product carries
  conflicts: [],        // a refusal naming a value the request also requires
  claims: [],           // which parser pass took which words, in order
  rejected: [],         // structured input this vocabulary does not have
  stated: new Set(),    // facets the shopper volunteered, vs ones we asked for
  declined: new Set(),  // facets the shopper said they do not mind
  asks: 0,
  pending: null,        // the question currently on screen
  scored: [],
  shown: null,          // explicit id list when an agent curates the grid
  cart: new Map(),      // id -> quantity
  order: null,          // the last order placed, by the person
};

const questionListeners = new Set();
function notifyQuestionChange() {
  for (const listener of questionListeners) listener(Boolean(state.pending));
}

// The box parses sentences too, not just the tools. These show it.
const EXAMPLES = [
  'belt',
  'leather belt',
  'running shoes',
  'waterproof hiking boots, no laces',
  'a wallet that is not leather, under $30',
  'cheapest wool sweater',
];

// --- boot ---------------------------------------------------------------

async function boot() {
  const controls = ['q', 'go', 'clear'].map(el);
  controls.forEach((control) => { control.disabled = true; });
  try {
    const res = await fetch('./data/catalog.json');
    if (!res.ok) throw new Error(`Catalogue request failed: ${res.status}`);
    const payload = await res.json();
    state.catalog = new Catalog(payload);
    state.vocab = countVocab(state.catalog);
  } catch {
    el('statusTitle').textContent = 'Products could not be loaded';
    el('statusN').textContent = 'Check your connection, then reload the page to try again.';
    el('mcpstate').textContent = 'Catalogue unavailable';
    return false;
  }

  el('examples').innerHTML = '';
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.textContent = q;
    b.addEventListener('click', () => { el('q').value = q; search(q, 'human'); });
    el('examples').append(b);
  }

  el('go').addEventListener('click', () => search(el('q').value, 'human'));
  el('q').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) search(el('q').value, 'human'); });
  el('clear').addEventListener('click', () => reset('human'));

  // A person adds from the card; an agent calls add_to_cart. Same function.
  el('grid').addEventListener('click', (e) => {
    const b = e.target.closest('button.add');
    if (b) addToCart(b.dataset.id, 1, 'human');
  });
  el('cartItems').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-remove]');
    if (b) removeFromCart(b.dataset.remove, 'human');
  });

  // The checkout form is a declarative WebMCP tool (see index.html). Whether a
  // person filled it or the browser did on an agent's behalf, the submit is
  // the person's press, and this handler is the one place an order is placed.
  el('checkout').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const result = placeOrder({ name: data.get('name'), address: data.get('address') });
    if (result.error) {
      el('cartHint').textContent = result.error;
      el('cartHint').hidden = false;
    }
    if (e.agentInvoked && typeof e.respondWith === 'function') e.respondWith(Promise.resolve(result));
  });
  // Restore before the first render of anything that persists, or the empty
  // page would overwrite the saved visit before it is read.
  if (new URLSearchParams(location.search).get('agent') !== 'demo') restore();
  renderCart();

  const ok = registerTools(api, logCall, undefined, renderTools);
  el('mcpdot').classList.toggle('on', ok);
  el('mcpstate').textContent = ok ? 'WebMCP tools registered' : 'WebMCP not available in this browser';

  // No WebMCP here: offer the scripted agent instead, and start it straight
  // away when the page was opened with ?agent=demo.
  if (!ok) {
    el('demoBtn').hidden = false;
    el('demoBtn').addEventListener('click', startDemo);
    if (new URLSearchParams(location.search).get('agent') === 'demo') startDemo();
  }
  controls.forEach((control) => { control.disabled = false; });
  return true;
}

let demoRunning = false;
let demoContext = null;
async function startDemo() {
  if (demoRunning) return;
  demoRunning = true;
  el('demoBtn').disabled = true;
  reset('human');
  el('convo').innerHTML = '';
  el('convoPanel').hidden = false;
  el('mcpstate').textContent = 'Scripted agent running — a simulation, WebMCP is not available in this browser';
  const ctx = demoContext ??= standInContext();
  registerTools(api, logCall, ctx, renderTools);
  await new Promise((r) => setTimeout(r, 0));
  try {
    await runScript(ctx, showTurn, undefined, { fillCheckout });
  } finally {
    demoRunning = false;
    el('demoBtn').disabled = false;
    el('demoBtn').textContent = 'Run the scripted agent again';
    el('mcpstate').textContent = 'Scripted agent finished — a simulation, WebMCP is not available in this browser';
  }
}

// The tool list as the page sees it, from getTools() and the toolchange
// event: a person can watch answer_question come and go.
function renderTools(names) {
  const line = el('toolsNow');
  if (!names?.length) { line.hidden = true; return; }
  line.hidden = false;
  line.innerHTML = `<b>on offer now</b> ${names.map((n) => `<code class="${n === 'answer_question' ? 'hot' : ''}">${esc(n)}</code>`).join(' ')}`;
}

// --- the cart, and the one move an agent cannot make ---------------------

const MAX_CART_QUANTITY = 99;
const validQuantity = (qty) => Number.isInteger(qty) && qty >= 1 && qty <= MAX_CART_QUANTITY;

function cartLines() {
  const lines = [];
  for (const [id, quantity] of state.cart) {
    const it = state.catalog.byId.get(id);
    if (!it) continue;
    const price = Number.isFinite(it.p) && it.p >= 0 ? it.p : null;
    lines.push({ id, title: it.t, quantity, price, lineTotal: price != null ? +(price * quantity).toFixed(2) : null });
  }
  return lines;
}

function cartSnapshot(extra = {}) {
  const items = cartLines();
  const total = +items.reduce((a, l) => a + (l.lineTotal ?? 0), 0).toFixed(2);
  const unpriced = items.filter((l) => l.price == null).length;
  return {
    status: 'cart',
    items,
    total: unpriced ? null : total,
    subtotal: total,
    ...(unpriced ? { unpricedItems: unpriced } : {}),
    ...(state.order ? { lastOrder: state.order } : {}),
    note: unpriced ? 'Some prices are unavailable. Remove those items before checkout; the subtotal covers priced items only.' : items.length
      ? 'To order, fill in the checkout form (a declarative tool: name and address) — the shopper presses Place order.'
      : 'The cart is empty.',
    ...extra,
  };
}

function addToCart(id, quantity = 1, actor = 'agent') {
  const it = state.catalog.byId.get(id);
  if (!it) return { ...cartSnapshot(), error: `"${id}" is not a product id in this catalogue.` };
  const qty = quantity;
  const next = (state.cart.get(id) || 0) + qty;
  if (!validQuantity(qty) || !validQuantity(next)) {
    const error = `Quantity must be a whole number from 1 to ${MAX_CART_QUANTITY}, including items already in the cart.`;
    el('cartFeedback').textContent = error;
    return cartSnapshot({ error });
  }
  state.cart.set(id, next);
  renderCart();
  el('cartFeedback').textContent = `Added ${qty} to your cart: ${it.t}.`;
  return cartSnapshot({ added: { id, title: it.t, quantity: qty } });
}

function removeFromCart(id, actor = 'agent') {
  const had = state.cart.delete(id);
  renderCart();
  if (had) el('cartFeedback').textContent = 'Item removed from your cart.';
  return cartSnapshot(had ? { removed: id } : { error: `"${id}" was not in the cart.` });
}

function placeOrder({ name, address }) {
  const items = cartLines();
  if (!items.length) return { status: 'no_order', error: 'The cart is empty.' };
  if (items.some((item) => item.price == null)) {
    return { status: 'no_order', error: 'Remove items with unavailable prices before checkout.' };
  }
  name = typeof name === 'string' ? name.trim() : '';
  address = typeof address === 'string' ? address.trim() : '';
  if (!name || !address) return { status: 'no_order', error: 'Name and address are required.' };
  const total = +items.reduce((a, l) => a + (l.lineTotal ?? 0), 0).toFixed(2);
  state.order = { id: `CA-${Date.now().toString(36).toUpperCase()}`, name, address, items, total, placedBy: 'the shopper' };
  state.cart = new Map();
  renderCart();
  el('cartFeedback').textContent = 'Demo order placed. No payment was taken.';
  return { status: 'placed', order: state.order };
}

// What a WebMCP browser does with a declarative tool call: fill the fields
// and focus the button. Used only by the scripted demo, which says so.
function fillCheckout({ name, address }) {
  const form = el('checkout');
  form.hidden = false;
  form.elements.name.value = name ?? '';
  form.elements.address.value = address ?? '';
  form.querySelector('button[type=submit]').focus();
  el('cartHint').textContent = 'Filled in for you. Check it, then press Place order — no agent can press it for you.';
  el('cartHint').hidden = false;
}

function renderCart() {
  const items = cartLines();
  const list = el('cartItems');
  list.innerHTML = '';
  for (const l of items) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ct">${esc(l.title.slice(0, 48))}</span>`
      + `<span class="cq">×${l.quantity}</span>`
      + `<span class="cp">${l.lineTotal != null ? `$${l.lineTotal.toFixed(2)}` : '—'}</span>`
      + `<button type="button" data-remove="${esc(l.id)}" aria-label="Remove">×</button>`;
    list.append(li);
  }
  const total = items.reduce((a, l) => a + (l.lineTotal ?? 0), 0);
  const count = items.reduce((a, l) => a + l.quantity, 0);
  const unpriced = items.some((item) => item.price == null);
  el('cartCount').textContent = count ? `${count} item${count === 1 ? '' : 's'}` : '';
  el('cartJump').hidden = !count;
  el('cartJump').textContent = `View cart (${count})`;
  el('cartTotal').textContent = items.length ? `${unpriced ? 'Priced subtotal' : 'Total'} $${total.toFixed(2)}` : '';
  el('checkout').hidden = !items.length;
  el('checkout').querySelector('button[type=submit]').disabled = unpriced;
  el('cartHint').hidden = items.length > 0 && !unpriced;
  el('cartHint').textContent = unpriced
    ? 'Some prices are unavailable. Remove those items before checkout; the subtotal covers priced items only.'
    : 'Nothing yet. Add from a card, or let the agent call add_to_cart.';
  const done = el('orderDone');
  if (state.order && !items.length) {
    done.hidden = false;
    const orderCount = state.order.items.reduce((sum, item) => sum + item.quantity, 0);
    done.textContent = `Demo order ${state.order.id} placed by you — ${orderCount} item${orderCount === 1 ? '' : 's'}, $${state.order.total.toFixed(2)}, to ${state.order.address}.`;
  } else {
    done.hidden = true;
  }
  persist();
}

function showTurn(role, text) {
  const li = document.createElement('li');
  li.className = `turn ${role}`;
  const who = { person: 'Person', agent: 'Agent', call: 'Tool call', note: '' }[role] ?? role;
  li.innerHTML = `${who ? `<b>${who}</b>` : ''}${esc(text)}`;
  el('convo').append(li);
  // Scroll the transcript, never the page: the grid has to stay in view
  // while the agent changes it.
  el('convo').scrollTop = el('convo').scrollHeight;
}

function countVocab(catalog) {
  const counts = {};
  for (const facet of catalog.meta.facets) counts[facet] = new Map();
  for (const it of catalog.items) {
    for (const [facet, vals] of Object.entries(it.f)) {
      const m = counts[facet];
      if (!m) continue;
      for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
    }
  }
  const out = {};
  for (const [facet, m] of Object.entries(counts)) {
    out[facet] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return out;
}

// --- core transitions ---------------------------------------------------

function search(text, actor = 'agent', given = {}) {
  const parsed = parseRequest(text || '', state.catalog);
  state.said = (text || '').trim();
  state.query = parsed.query;
  state.constraints = parsed.constraints;
  state.exclude = parsed.exclude;
  state.excludeTerms = parsed.excludeTerms;
  state.budget = parsed.budget;
  state.sort = parsed.sort;
  state.optional = parsed.optional;
  state.ignored = parsed.ignored;
  state.conflicts = parsed.conflicts;
  state.claims = parsed.claims ?? [];
  state.rejected = [];
  state.declined = new Set(parsed.noPreference ?? []);
  state.asks = 0;
  state.shown = null;
  // Whatever the agent already knows arrives structured and wins over the
  // parse: it has the whole conversation, the store has one sentence.
  applyGiven(given ?? {});
  state.stated = new Set([...Object.keys(state.constraints), ...Object.keys(state.exclude)]);
  return evaluate(actor);
}

function applyGiven(given) {
  const cat = state.catalog;
  const accept = (facet, values) => {
    if (!cat.facetValues[facet]) { state.rejected.push({ facet, reason: 'no such attribute' }); return null; }
    const ok = [];
    for (const raw of [].concat(values ?? [])) {
      const v = canonical(facet, String(raw));
      if (v) { if (!ok.includes(v)) ok.push(v); } else state.rejected.push({ facet, value: raw, reason: 'not in this catalogue' });
    }
    return ok.length ? ok : null;
  };
  const attributes = {};
  const exclude = {};
  for (const [facet, values] of Object.entries(given.attributes ?? {})) {
    const ok = accept(facet, values);
    if (ok) attributes[facet] = ok;
  }
  for (const [facet, values] of Object.entries(given.exclude ?? {})) {
    const ok = accept(facet, values);
    if (ok) exclude[facet] = ok;
  }
  for (const [facet, values] of Object.entries(attributes)) {
    state.constraints[facet] = values;
    removeExclusion(facet, values);
    state.declined.delete(facet);
    state.conflicts = state.conflicts.filter((conflict) => conflict.facet !== facet);
  }
  for (const [facet, values] of Object.entries(exclude)) {
    // A structured field replaces that parsed field. Only parsed opposing
    // requirements are removed: two explicit structured sides remain hard
    // constraints, even when the shopper supplied an impossible combination.
    removeExclusion(facet, (state.exclude[facet] ?? []).filter((value) => !values.includes(value)));
    state.exclude[facet] = values;
    if (!attributes[facet] && state.constraints[facet]) {
      const keep = state.constraints[facet].filter((value) => !values.includes(value));
      if (keep.length) state.constraints[facet] = keep;
      else delete state.constraints[facet];
    }
    state.declined.delete(facet);
    state.conflicts = state.conflicts.filter((conflict) => conflict.facet !== facet);
  }
  for (const [field, bound] of [['budget_min', 'min'], ['budget_max', 'max']]) {
    if (!Object.prototype.hasOwnProperty.call(given, field)) continue;
    const value = given[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      state.rejected.push({ facet: field, value, reason: 'must be a finite nonnegative number' });
      continue;
    }
    state.budget = { min: null, max: null, ...state.budget, [bound]: value };
  }
  for (const facet of given.no_preference ?? []) {
    if (cat.facetValues[facet]) state.declined.add(facet);
    else state.rejected.push({ facet, reason: 'no such attribute' });
  }
  if (SORTS.includes(given.sort)) state.sort = given.sort;
}

// "waterproof" -> "water resistant": a value is accepted by its canonical name
// or by any surface form the builder mapped onto it. Category leaves match by
// head word, so "wallets" finds "wallets, card cases & money organizers".
function canonical(facet, raw) {
  const cat = state.catalog;
  const want = raw.trim().toLowerCase();
  const values = cat.facetValues[facet] ?? [];
  if (values.includes(want)) return want;
  for (const value of values) {
    if ((cat.facetForms?.[facet]?.[value] ?? []).includes(want)) return value;
  }
  return values.find((v) => v.split(/[,&]/)[0].trim() === want) ?? null;
}

// Single-word refusals are enforced twice: by the recorded attribute and by
// title words (for products missing that attribute). Treat both as one fact
// when it is explicitly replaced or taken back, while keeping unrelated bans.
function exclusionWords(facet, values) {
  return new Set(values.flatMap((value) => [value, ...(state.catalog.facetForms?.[facet]?.[value] ?? [])])
    .filter((form) => /^[a-z]+$/i.test(form)).flatMap(tokenize));
}

function removeExclusion(facet, values = state.exclude[facet] ?? []) {
  const old = state.exclude[facet] ?? [];
  const removed = old.filter((value) => values.includes(value));
  if (!removed.length) return false;
  const keep = old.filter((value) => !values.includes(value));
  if (keep.length) state.exclude[facet] = keep;
  else delete state.exclude[facet];
  const words = exclusionWords(facet, removed);
  const retained = new Set(Object.entries(state.exclude)
    .flatMap(([key, list]) => [...exclusionWords(key, list)]));
  state.excludeTerms = state.excludeTerms.filter((word) => !words.has(word) || retained.has(word));
  return true;
}

function refine(facet, values, actor = 'agent', mode = 'require') {
  state.rejected = [];
  if (!facet || !values?.length) return snapshot();
  if (!state.catalog.facetValues[facet]) {
    state.rejected.push({ facet, reason: 'no such attribute' });
    return snapshot();
  }
  const ok = [];
  for (const raw of [].concat(values)) {
    const v = canonical(facet, String(raw));
    if (v) { if (!ok.includes(v)) ok.push(v); } else state.rejected.push({ facet, value: raw, reason: 'not in this catalogue' });
  }
  if (!ok.length) return snapshot();
  if (mode === 'exclude') state.exclude[facet] = [...new Set([...(state.exclude[facet] ?? []), ...ok])];
  else state.constraints[facet] = ok;
  state.declined.delete(facet);
  state.shown = null;
  return evaluate(actor);
}

function answerQuestion(values, actor = 'agent') {
  const pending = state.pending;
  if (!pending) return snapshot();
  const list = [].concat(values ?? []);
  if (list.length === 1 && list[0] === 'no_preference') {
    // "No preference" still costs a turn — and is remembered, so the same
    // question cannot come straight back.
    state.asks += 1;
    state.rejected = [];
    state.declined.add(pending.facet);
    state.pending = null;
    return evaluate(actor, { skipped: pending.facet });
  }
  if (!list.length) {
    state.rejected = [{ facet: pending.facet, reason: 'answer required; choose a value or no_preference' }];
    return snapshot();
  }
  // An invalid answer has not answered the question and must not spend one
  // of the limited clarification turns. refine still reports rejected values.
  if (list.some((value) => canonical(pending.facet, String(value)))) state.asks += 1;
  return refine(pending.facet, list, actor);
}

function reset(actor = 'agent') {
  Object.assign(state, {
    said: '', query: '', constraints: {}, exclude: {}, excludeTerms: [], budget: null,
    sort: 'relevance', optional: [], ignored: [], conflicts: [], claims: [], rejected: [],
    stated: new Set(), declined: new Set(), asks: 0, pending: null, scored: [], shown: null,
  });
  notifyQuestionChange();
  el('q').value = '';
  render({ action: 'idle', reasons: ['Waiting for a search.'], pool: [] });
  return snapshot();
}

// A dry run: how the store would read a sentence, without searching or
// changing anything. The agent can check a reading before acting on it, or
// show the shopper what was heard. Borrowed from the cuizi-rewrite branch.
function parseOnly(text) {
  const parsed = parseRequest(text || '', state.catalog);
  return {
    status: 'reading',
    request: (text || '').trim(),
    query: parsed.query,
    attributes: parsed.constraints,
    exclude: parsed.exclude,
    excludeWords: parsed.excludeTerms,
    budget: parsed.budget,
    ...(parsed.budgetConflict ? { budgetConflict: parsed.budgetConflict } : {}),
    sort: parsed.sort,
    noPreference: parsed.noPreference,
    ignoredWords: parsed.ignored,
    conflicts: parsed.conflicts,
    claims: parsed.claims,
    note: 'Nothing was searched. Call search_products to act on this reading, or pass the parts you agree with as structured input.',
  };
}

// "Actually, forget the leather": take back one or more things the shopper
// said — a value, a facet name, a refused word, "budget", "sort" — and keep
// the rest, including the cart. Borrowed from the cuizi-rewrite branch.
function revise(drop = [], dropAll = false, actor = 'agent') {
  if (dropAll) {
    reset(actor);
    return { ...snapshot(), dropped: ['everything'], note: 'The request was taken back. The cart is kept.' };
  }
  const cat = state.catalog;
  const dropped = [];
  const notFound = [];
  const without = (list, v) => list.filter((x) => x !== v);
  for (const raw of [].concat(drop ?? [])) {
    const want = String(raw ?? '').trim().toLowerCase();
    if (!want) continue;
    let hit = false;
    if (want === 'budget' || want === 'price') {
      if (state.budget) { state.budget = null; hit = true; }
    } else if (want === 'sort' || want === 'ordering' || want === 'order') {
      if (state.sort !== 'relevance') { state.sort = 'relevance'; hit = true; }
    } else if (cat.facetValues[want]) {
      if (state.constraints[want]) { delete state.constraints[want]; hit = true; }
      if (removeExclusion(want)) hit = true;
      if (state.declined.delete(want)) hit = true;
    } else {
      for (const facet of Object.keys(cat.facetValues)) {
        const v = canonical(facet, want);
        if (!v) continue;
        if (state.constraints[facet]?.includes(v)) {
          state.constraints[facet] = without(state.constraints[facet], v);
          if (!state.constraints[facet].length) delete state.constraints[facet];
          hit = true;
        }
        if (removeExclusion(facet, [v])) hit = true;
      }
      const tok = tokenize(want)[0];
      if (tok && state.excludeTerms.includes(tok)) { state.excludeTerms = without(state.excludeTerms, tok); hit = true; }
    }
    (hit ? dropped : notFound).push(raw);
  }
  if (!dropped.length) {
    return { ...snapshot(), dropped, notFound, note: 'Nothing in the current request matched what was to be dropped.' };
  }
  state.shown = null;
  return evaluate(actor, { dropped, ...(notFound.length ? { notFound } : {}) });
}

// --- remembering the visit ------------------------------------------------
//
// A person who reloads should find their search, their open question and
// their cart where they left them. Kept in localStorage, per browser; the
// scripted demo starts clean. Borrowed from the cuizi-rewrite branch.

const STORE_KEY = 'counterask.v1';

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const storedStrings = (value, fallback = []) => [...new Set((Array.isArray(value) ? value : fallback)
  .filter((item) => typeof item === 'string' && item.length > 0))];

function storedFacets(value, fallback = {}) {
  const out = {};
  for (const [facet, values] of Object.entries(isRecord(value) ? value : fallback)) {
    if (!Object.hasOwn(state.catalog.facetValues ?? {}, facet)) continue;
    const accepted = storedStrings(values).filter((item) => state.catalog.facetValues[facet].includes(item));
    if (accepted.length) out[facet] = accepted;
  }
  return out;
}

function storedOrder(order) {
  if (!isRecord(order) || !['id', 'name', 'address'].every((key) => typeof order[key] === 'string' && order[key].trim())
    || !Array.isArray(order.items) || !order.items.length || order.placedBy !== 'the shopper') return null;
  const items = [];
  for (const item of order.items) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string'
      || !validQuantity(item.quantity) || !Number.isFinite(item.price) || item.price < 0) return null;
    const lineTotal = +(item.price * item.quantity).toFixed(2);
    if (!Number.isFinite(lineTotal) || item.lineTotal !== lineTotal) return null;
    items.push({ id: item.id, title: item.title, quantity: item.quantity, price: item.price, lineTotal });
  }
  const total = +items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2);
  if (!Number.isFinite(total) || order.total !== total) return null;
  return { id: order.id, name: order.name, address: order.address, items, total, placedBy: 'the shopper' };
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      said: state.said, query: state.query, constraints: state.constraints, exclude: state.exclude,
      excludeTerms: state.excludeTerms, budget: state.budget, sort: state.sort, optional: state.optional,
      ignored: state.ignored, conflicts: state.conflicts, claims: state.claims,
      stated: [...state.stated], declined: [...state.declined], asks: state.asks,
      cart: [...state.cart], order: state.order,
    }));
  } catch { /* storage may be unavailable; the page works without it */ }
}

function restore() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return false; }
  if (!isRecord(saved)) return false;
  const cat = state.catalog;
  if (Array.isArray(saved.cart)) state.cart = new Map(saved.cart.filter((entry) =>
    Array.isArray(entry) && entry.length === 2 && cat.byId.has(entry[0]) && validQuantity(entry[1])));
  state.order = storedOrder(saved.order);
  // Validate each field independently: a damaged order or stale facet must
  // not erase the shopper's other valid refinements, refusals, or cart lines.
  const said = typeof saved.said === 'string' ? saved.said : '';
  const parsed = said ? parseRequest(said, cat) : {};
  const facetNames = (value, fallback) => storedStrings(value, fallback)
    .filter((facet) => Object.hasOwn(cat.facetValues ?? {}, facet));
  const budget = isRecord(saved.budget) ? saved.budget : (saved.budget === null ? null : parsed.budget);
  const money = (value) => Number.isFinite(value) && value >= 0 ? value : null;
  const min = money(budget?.min), max = money(budget?.max);
  Object.assign(state, {
    said, query: typeof saved.query === 'string' ? saved.query : (parsed.query ?? ''),
    constraints: storedFacets(saved.constraints, parsed.constraints), exclude: storedFacets(saved.exclude, parsed.exclude),
    excludeTerms: storedStrings(saved.excludeTerms, parsed.excludeTerms),
    budget: min != null || max != null ? { min, max } : null,
    sort: SORTS.includes(saved.sort) ? saved.sort : (parsed.sort ?? 'relevance'),
    optional: storedStrings(saved.optional, parsed.optional), ignored: storedStrings(saved.ignored, parsed.ignored),
    conflicts: (Array.isArray(saved.conflicts) ? saved.conflicts : (parsed.conflicts ?? []))
      .filter((item) => isRecord(item) && typeof item.facet === 'string' && typeof item.value === 'string'),
    claims: (Array.isArray(saved.claims) ? saved.claims : (parsed.claims ?? []))
      .filter((item) => isRecord(item) && typeof item.pass === 'string' && typeof item.said === 'string'
        && (item.as == null || typeof item.as === 'string')),
    stated: new Set(facetNames(saved.stated, Object.keys(parsed.constraints ?? {}))),
    declined: new Set(facetNames(saved.declined, parsed.noPreference)),
    asks: Number.isInteger(saved.asks) && saved.asks >= 0 ? Math.min(saved.asks, POLICY.maxAsks) : 0,
    rejected: [], shown: null,
  });
  if (!state.said && !state.query && !Object.keys(state.constraints).length && !Object.keys(state.exclude).length
    && !state.excludeTerms.length && !state.budget && state.sort === 'relevance' && !state.declined.size) return false;
  el('q').value = state.said;
  evaluate('human', { resumed: 'from your last visit' });
  return true;
}

function evaluate(actor, extra = {}) {
  const { catalog } = state;
  state.scored = catalog.search(state.query, state.constraints, {
    exclude: state.exclude,
    excludeTerms: state.excludeTerms,
    budget: state.budget,
    sort: state.sort,
    optional: state.optional,
  });
  const decision = decide(catalog, state.scored, state.constraints, state.asks, { declined: [...state.declined] });
  state.pending = decision.action === 'ask' ? decision : null;
  notifyQuestionChange();
  render(decision, extra);
  return snapshot(decision, extra);
}

// When nothing — or almost nothing — survives every requirement, say which
// one is doing the damage. Each requirement, refusal, banned word, required
// query word and the budget is lifted in turn and the pool re-counted. The
// agent gets the list; the person gets buttons.
const RELAX_BELOW = 4;

function relaxations() {
  const cat = state.catalog;
  if (!state.query && !Object.keys(state.constraints).length) return [];
  const base = {
    exclude: state.exclude, excludeTerms: state.excludeTerms, budget: state.budget,
    sort: state.sort, optional: state.optional,
  };
  const count = (constraints, opts) => cat.search(state.query, constraints, { ...base, ...opts }).length;
  const out = [];
  for (const [facet, values] of Object.entries(state.constraints)) {
    const c = { ...state.constraints };
    delete c[facet];
    out.push({ drop: `${facet} = ${values.join(' / ')}`, kind: 'require', facet, candidates: count(c, {}) });
  }
  for (const [facet, values] of Object.entries(state.exclude)) {
    const ex = { ...state.exclude };
    delete ex[facet];
    out.push({ drop: `not ${values.join(' / ')}`, kind: 'exclude', facet, candidates: count(state.constraints, { exclude: ex }) });
  }
  for (const word of state.excludeTerms) {
    out.push({ drop: `not "${word}"`, kind: 'word', word, candidates: count(state.constraints, { excludeTerms: state.excludeTerms.filter((w) => w !== word) }) });
  }
  const required = tokenize(state.query).filter((t) => cat.postings.has(t) && !state.optional.includes(t));
  if (required.length > 1) {
    for (const tok of required) {
      out.push({ drop: `the word "${tok}"`, kind: 'term', term: tok, candidates: count(state.constraints, { optional: [...state.optional, tok] }) });
    }
  }
  if (state.budget) out.push({ drop: `price ${describeBudget(state.budget)}`, kind: 'budget', candidates: count(state.constraints, { budget: null }) });
  return out.filter((r) => r.candidates > state.scored.length).sort((a, b) => b.candidates - a.candidates).slice(0, 5);
}

function applyRelaxation(r) {
  if (r.kind === 'require') delete state.constraints[r.facet];
  else if (r.kind === 'exclude') delete state.exclude[r.facet];
  else if (r.kind === 'word') state.excludeTerms = state.excludeTerms.filter((w) => w !== r.word);
  else if (r.kind === 'term') state.optional = [...state.optional, r.term];
  else if (r.kind === 'budget') state.budget = null;
  state.shown = null;
  evaluate('human');
}

// --- what both surfaces receive ----------------------------------------

function shownItems() {
  return state.shown
    ? state.shown.map((id) => state.catalog.byId.get(id)).filter(Boolean)
    : state.scored.slice(0, POLICY.show).map((s) => s.item);
}

function snapshot(decision, extra = {}) {
  const active = state.said || state.query || state.scored.length || Object.keys(state.constraints).length
    || Object.keys(state.exclude).length || state.excludeTerms.length || state.budget
    || state.sort !== 'relevance' || state.declined.size;
  const d = decision || state.pending || (active
    ? decide(state.catalog, state.scored, state.constraints, state.asks, { declined: [...state.declined] })
    : { action: 'idle', pool: [], reasons: [] });
  const pool = d.pool ?? [];
  const top = shownItems();

  const understood = {
    query: state.query,
    attributes: { ...state.constraints },
    exclude: { ...state.exclude },
    excludeWords: [...state.excludeTerms],
    budget: state.budget,
    sort: state.sort,
    noPreference: [...state.declined],
    ignoredWords: [...state.ignored],
  };
  if (state.conflicts.length) understood.conflicts = state.conflicts;
  if (state.rejected.length) understood.rejected = state.rejected;
  const budgetConflict = state.budget?.min != null && state.budget?.max != null && state.budget.min > state.budget.max
    ? { min: state.budget.min, max: state.budget.max, reason: 'Minimum price exceeds maximum price.' } : null;
  if (budgetConflict) understood.budgetConflict = budgetConflict;

  const caveats = [
    ...state.conflicts.map((c) => `"${c.value}" was both required and refused (same ${c.facet} in this catalogue); the requirement was kept.`),
    ...state.rejected.map((r) => `${r.facet}${r.value != null ? `=${r.value}` : ''} was ignored: ${r.reason}.`),
    ...(budgetConflict ? [budgetConflict.reason] : []),
  ];
  const base = {
    request: state.said,
    understood,
    questionsAsked: state.asks,
    candidates: pool.length,
    why: d.reasons ?? [],
    ...(caveats.length ? { caveats } : {}),
    ...extra,
  };
  if (state.budget) {
    const priced = pool.filter((it) => typeof it.p === 'number').length;
    base.candidatesWithPrice = priced;
    base.candidatesWithoutPrice = pool.length - priced;
  }
  if (pool.length < RELAX_BELOW && d.action !== 'idle') {
    const relax = relaxations();
    if (relax.length) base.relax = relax.map(({ drop, candidates }) => ({ drop, candidates }));
  }

  if (d.action === 'ask') {
    return {
      ...base,
      status: 'need_more_evidence',
      question: d.question,
      facet: d.facet,
      options: d.options,
      otherValues: d.others ?? 0,
      notRecorded: d.unrecorded ?? 0,
      note: 'Answering now would be a guess. Put this question to the shopper, then call answer_question — '
        + 'or, if the conversation already answers it, call answer_question straight away. '
        + `${d.others ? `${d.others} candidates carry a ${d.facet} value not listed; any value from list_attributes is accepted. ` : ''}`
        + `${d.unrecorded ? `${d.unrecorded} record no ${d.facet} at all and are kept only by "no_preference".` : ''}`.trim(),
    };
  }
  if (d.action === 'empty') {
    const hint = base.relax?.length
      ? `Nothing satisfies every requirement. Lifting ${base.relax[0].drop} leaves ${base.relax[0].candidates}; see "relax" for the rest. `
        + 'Ask the shopper which to give up, then search again or use refine_search.'
      : 'No product satisfies every requirement. Drop one with refine_search, or search again.';
    return { ...base, status: 'no_match', products: [], note: hint };
  }
  const diffs = d.differentiators ?? [];
  const describe = ({ facet, splits }) =>
    `${facet} (${splits.map((s) => `${s.count} ${headWord(s.value)}`).join(', ')})`;
  return {
    ...base,
    status: 'answer',
    products: top.map(serialize),
    differentiators: diffs,
    note: (diffs.length
      ? `Showing ${top.length} of ${pool.length}. They differ mainly by ${diffs.map(describe).join(' and ')}. `
        + 'Narrow with refine_search, or curate the grid with show_products.'
      : `Showing ${top.length} of ${pool.length}. No recorded attribute separates them further.`)
      + (base.relax?.length ? ` Only ${pool.length} match everything; lifting ${base.relax[0].drop} would leave ${base.relax[0].candidates}.` : ''),
  };
}

function serialize(it) {
  return {
    id: it.id,
    title: it.t,
    brand: it.b || undefined,
    price: typeof it.p === 'number' ? it.p : undefined,
    rating: it.r ?? undefined,
    reviews: it.n || undefined,
    attributes: it.f,
  };
}

function headWord(value) {
  return value.split(/[,&]/)[0].trim() || value;
}

function describeBudget(b) {
  if (!b) return '';
  if (b.min != null && b.max != null) return `$${b.min}–$${b.max}`;
  if (b.max != null) return `under $${b.max}`;
  return `over $${b.min}`;
}

// --- rendering ----------------------------------------------------------

function render(decision, extra = {}) {
  renderChips();
  renderAsk(decision);
  renderGrid(decision);
  renderTrace(decision, extra);
  persist();
}

function renderChips() {
  const wrap = el('chips');
  wrap.innerHTML = '';
  const chip = (html, cls, onRemove, label) => {
    const c = document.createElement('span');
    c.className = `chip ${cls}`.trim();
    c.innerHTML = html;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', label);
    x.addEventListener('click', () => { onRemove(); evaluate('human'); });
    c.append(x);
    wrap.append(c);
  };
  for (const [facet, values] of Object.entries(state.constraints)) {
    const how = state.stated.has(facet) ? 'you said' : 'you chose';
    chip(`<b>${esc(facet)}</b> ${esc(values.join(' / '))} <i>${how}</i>`, '', () => {
      delete state.constraints[facet];
      if (!state.stated.has(facet)) state.asks = Math.max(0, state.asks - 1);
    }, `Remove ${facet} filter`);
  }
  for (const [facet, values] of Object.entries(state.exclude)) {
    chip(`<b>not</b> ${esc(values.join(' / '))} <i>${esc(facet)}</i>`, 'no',
      () => { removeExclusion(facet); }, `Stop excluding ${facet}`);
  }
  const companionWords = new Set(Object.entries(state.exclude)
    .flatMap(([facet, values]) => [...exclusionWords(facet, values)]));
  for (const word of state.excludeTerms) {
    if (companionWords.has(word)) continue;
    chip(`<b>not</b> ${esc(word)}`, 'no',
      () => { state.excludeTerms = state.excludeTerms.filter((w) => w !== word); }, `Stop excluding ${word}`);
  }
  if (state.budget) {
    chip(`<b>price</b> ${esc(describeBudget(state.budget))}`, '', () => { state.budget = null; }, 'Remove budget');
  }
  if (state.sort !== 'relevance') {
    chip(`<b>sort</b> ${esc(SORT_LABEL[state.sort])}`, '', () => { state.sort = 'relevance'; }, 'Remove sort');
  }
  for (const facet of state.declined) {
    chip(`<b>${esc(facet)}</b> any <i>no preference</i>`, 'any',
      () => { state.declined.delete(facet); }, `Forget no preference on ${facet}`);
  }
}

function renderAsk(d) {
  const box = el('ask');
  if (d.action !== 'ask') { box.hidden = true; return; }
  box.hidden = false;
  el('askwhy').textContent = `Not enough evidence — ${d.pool.length} candidates, top only ${(d.separation * 100).toFixed(0)}% clear`;
  el('askq').textContent = d.question;
  const opts = el('askopts');
  opts.innerHTML = '';
  for (const o of d.options) {
    const b = document.createElement('button');
    b.innerHTML = `${esc(o.label ?? o.value)}<small>${o.count} items</small>`;
    b.addEventListener('click', () => answerQuestion([o.value], 'human'));
    opts.append(b);
  }
  const skip = document.createElement('button');
  skip.className = 'skip';
  skip.textContent = d.others ? `No preference · ${d.others} more under other values` : 'No preference';
  skip.addEventListener('click', () => answerQuestion(['no_preference'], 'human'));
  opts.append(skip);
}

function renderRelax(d) {
  const box = el('relax');
  box.innerHTML = '';
  const pool = d.pool?.length ?? 0;
  if (d.action === 'idle' || pool >= RELAX_BELOW) { box.hidden = true; return; }
  const options = relaxations();
  if (!options.length) { box.hidden = true; return; }
  box.hidden = false;
  const lead = document.createElement('span');
  lead.className = 'lead';
  lead.textContent = pool ? `Only ${pool} match everything. Without…` : 'Nothing matches everything. Without…';
  box.append(lead);
  for (const r of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${esc(r.drop)}<small>${r.candidates} items</small>`;
    b.addEventListener('click', () => applyRelaxation(r));
    box.append(b);
  }
}

function renderGrid(d) {
  const grid = el('grid');
  const empty = el('empty');
  grid.innerHTML = '';
  renderRelax(d);

  if (d.action === 'idle') {
    el('statusTitle').textContent = 'Start a search';
    el('statusN').textContent = '';
    empty.hidden = true;
    return;
  }
  if (d.action === 'empty') {
    const invalidBudget = state.budget?.min != null && state.budget?.max != null
      && state.budget.min > state.budget.max;
    el('statusTitle').textContent = invalidBudget ? 'Check your price range' : 'No match';
    el('statusN').textContent = '0 of 9,901';
    empty.textContent = invalidBudget
      ? `The minimum price ($${state.budget.min}) is above the maximum ($${state.budget.max}). Change your search or remove the price filter.`
      : 'Nothing matches every stated requirement.';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const items = shownItems();
  el('statusTitle').textContent = d.action === 'ask'
    ? 'Best guess so far'
    : (state.shown ? 'Curated by the agent' : 'Recommended');
  el('statusN').textContent = `showing ${items.length} of ${d.pool.length} candidates`;

  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'p';
    const tags = Object.entries(it.f).filter(([k]) => k !== 'kind').slice(0, 3)
      .map(([, vals]) => `<span class="tag">${esc(vals[0])}</span>`).join('');
    const price = typeof it.p === 'number'
      ? `$${it.p.toFixed(2)}`
      : '<span class="dim">price not listed</span>';
    card.innerHTML = `
      <div class="t">${esc(it.t)}</div>
      ${it.b ? `<div class="brand2">${esc(it.b)}</div>` : ''}
      <div class="tags">${tags}</div>
      <div class="meta">
        <span class="price">${price}</span>
        <span class="rating">${it.r ? `${it.r}★ · ${formatCount(it.n)}` : ''}</span>
        <button type="button" class="add" data-id="${esc(it.id)}">Add</button>
      </div>`;
    grid.append(card);
  }
}

function renderTrace(d, extra) {
  const lines = [];
  const k = (label, value) => lines.push(`<span class="k">${label.padEnd(10)}</span> ${esc(value)}`);
  k('request', state.said || '—');
  k('query', state.query || '—');
  const cons = Object.entries(state.constraints).map(([f, v]) => `${f}=${v.join('|')}`).join('  ');
  k('known', cons || '—');
  const nots = [
    ...Object.entries(state.exclude).map(([f, v]) => `${f}≠${v.join('|')}`),
    ...state.excludeTerms.map((w) => `"${w}"`),
  ].join('  ');
  if (nots) k('not', nots);
  if (state.budget) k('price', describeBudget(state.budget));
  if (state.sort !== 'relevance') k('sort', SORT_LABEL[state.sort]);
  if (state.declined.size) k('any', [...state.declined].join('  '));
  if (state.ignored.length) k('ignored', state.ignored.join('  '));
  for (const c of state.conflicts) k('conflict', `"${c.value}" both required and refused — kept`);
  for (const c of state.claims ?? []) k('read', `${c.pass} took "${c.said}"${c.as ? ` → ${c.as}` : ''}`);
  k('candidates', String(d.pool?.length ?? 0));
  k('asked', `${state.asks} / ${POLICY.maxAsks}`);
  if (extra.skipped) k('skipped', extra.skipped);
  if (extra.dropped) k('dropped', [].concat(extra.dropped).join('  '));
  if (extra.resumed) k('resumed', extra.resumed);
  lines.push('');
  lines.push(`<span class="v">decision → ${d.action}</span>`);
  for (const r of d.reasons ?? []) lines.push(`  · ${esc(r)}`);
  for (const diff of d.differentiators ?? []) {
    lines.push(`  · shown items differ by ${esc(diff.facet)}: ${esc(diff.splits.map((s) => `${headWord(s.value)} ${s.count}`).join(', '))}`);
  }
  el('trace').innerHTML = lines.join('\n');
}

function logCall(name, result) {
  el('callhint').hidden = true;
  const li = document.createElement('li');
  const summary = result?.status === 'need_more_evidence'
    ? `asked about ${result.facet}`
    : (result?.products
      ? `${result.products.length} products · ${result.candidates ?? 0} candidates`
      : 'ok');
  li.innerHTML = `<span class="nm">${esc(name)}()</span><br><span class="rs">${esc(summary)}</span>`;
  el('calls').prepend(li);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatCount(n) {
  if (!n) return '0 reviews';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k reviews`;
  return `${n} reviews`;
}

// --- the surface WebMCP tools drive ------------------------------------

const api = {
  subscribeQuestion(listener) {
    questionListeners.add(listener);
    listener(Boolean(state.pending));
    return () => questionListeners.delete(listener);
  },
  search, refine, answerQuestion, reset, snapshot, parseOnly, revise,
  addToCart, removeFromCart, cart: () => cartSnapshot(),
  get state() { return state; },
  showProducts(ids) {
    if (!Array.isArray(ids)) return { ...snapshot(), error: 'Product ids must be an array from the current results.' };
    const eligible = new Set(state.scored.map((s) => s.item.id));
    const rejectedIds = ids.filter((id) => !eligible.has(id));
    if (rejectedIds.length) {
      return { ...snapshot(), rejectedIds, error: 'Only products matching the current search may be shown. The grid was not changed.' };
    }
    state.shown = [...new Set(ids)];
    render(state.pending ?? { action: 'answer', pool: state.scored.map((s) => s.item), reasons: ['Grid curated by the agent.'] });
    return snapshot();
  },
  explain(id) {
    const hit = state.scored.find((s) => s.item.id === id);
    if (!hit) return { error: `"${id}" is not in the current candidate set.` };
    return {
      id,
      title: hit.item.t,
      rank: state.scored.indexOf(hit) + 1,
      score: Number(hit.score.toFixed(3)),
      matchedWords: hit.matched,
      matchesWholeRequest: Boolean(hit.full),
      attributesUsed: hit.item.f,
      popularitySignal: { rating: hit.item.r, reviews: hit.item.n },
      policy: {
        candidates: state.scored.length,
        questionsAsked: state.asks,
        maxAsks: POLICY.maxAsks,
        answerBelow: POLICY.answerBelow,
        sort: state.sort,
        budget: state.budget,
      },
      note: 'Score = BM25 over title and attribute words (IDF-weighted, length-normalised) '
        + '× coverage of the required words + 0.35 × log-scaled review demand. '
        + 'Deterministic; no model call.',
    };
  },
  vocab() { return state.vocab; },
};

boot();
