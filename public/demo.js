// A scripted agent, for browsers without WebMCP.
//
// The real thing is ChatGPT's browser or Chrome with WebMCP enabled, where an
// agent calls these tools itself. Everywhere else the page would be a search
// box with a story attached. So when modelContext is absent, the page can run
// a *scripted* agent against a stand-in: the same tools, registered through
// the same function, called in the order a real agent would call them, with
// the conversation shown alongside. It is labelled as a simulation everywhere
// it appears. Nothing here pretends to be WebMCP; it shows what WebMCP lets
// the page do.

// The stand-in follows the spec's shape: registerTool(tool, { signal })
// resolves to nothing, aborting the signal unregisters, getTools() lists what
// is registered, and a toolchange event fires on every change — so the page
// code that runs here is exactly the code that runs against the real thing.
export function standInContext() {
  const tools = new Map();
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(new Event('toolchange')); };
  return {
    tools,
    async registerTool(spec, { signal } = {}) {
      if (tools.has(spec.name)) throw new DOMException(`A tool named "${spec.name}" is already registered`, 'InvalidStateError');
      tools.set(spec.name, spec);
      changed();
      signal?.addEventListener('abort', () => { if (tools.delete(spec.name)) changed(); }, { once: true });
    },
    async getTools() {
      return [...tools.values()].map(({ name, title, description, inputSchema, annotations }) =>
        ({ name, title, description, inputSchema, annotations, origin: location.origin }));
    },
    async executeTool(tool, input = {}) {
      const spec = tools.get(tool.name);
      if (!spec) throw new DOMException(`No tool named "${tool.name}"`, 'NotFoundError');
      return JSON.stringify(await spec.execute(input, {}));
    },
    addEventListener(type, fn) { if (type === 'toolchange') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'toolchange') listeners.delete(fn); },
  };
}

const money = (p) => (p != null ? ` ($${Number(p).toFixed(2)})` : '');
const short = (t, n = 46) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// `page` is what a real browser would do for the declarative checkout tool:
// fill the form and focus the button. The stand-in has no declarative
// support, so the page lends the script that one move, clearly labelled.
export async function runScript(ctx, show, pause = (ms) => new Promise((r) => setTimeout(r, ms)), page = {}) {
  const names = () => [...ctx.tools.keys()].join(', ');
  const call = async (name, args) => {
    const tool = ctx.tools.get(name);
    if (!tool) { show('note', `${name} is not registered right now — the page is not waiting for it.`); return null; }
    show('call', `${name}(${JSON.stringify(args)})`);
    const wire = await tool.execute(args, {});
    return wire?.structuredContent ?? wire;
  };

  show('note', `Tools on offer: ${names()}.`);
  await pause(700);
  show('person', "I need a wallet that isn't leather, under $30.");
  await pause(900);
  show('agent', 'Passing that to the store as you said it.');
  let r = await call('search_products', { query: "a wallet that isn't leather, under $30" });
  await pause(800);

  if (r?.status === 'need_more_evidence') {
    show('agent', `${r.candidates} candidates, and the store says ranking them now would be a guess. It asks: “${r.question}”`);
    show('note', `A new tool appeared while the question is open — ${names()}.`);
    await pause(1500);
    const pick = r.options[0];
    show('person', `${pick.label ?? pick.value}, please.`);
    await pause(700);
    r = await call('answer_question', { values: [pick.value] });
    await pause(500);
    show('note', `Answered, so it is gone again — ${names()}.`);
    await pause(700);
  }

  if (!r || r.status !== 'answer' || !r.products?.length) {
    show('agent', r?.note ?? 'Nothing came back.');
    show('note', 'End of script.');
    return;
  }

  const top = r.products.slice(0, 3).map((p) => `${short(p.title)}${money(p.price)}`).join('; ');
  const diff = r.differentiators?.[0];
  show('agent', `${r.candidates} match. ${diff ? `The store says they differ mainly by ${diff.facet} — ${diff.splits.map((s) => `${s.count} ${s.value}`).join(', ')}. ` : ''}Top three: ${top}.`);
  await pause(1600);

  show('person', 'Why is the first one first?');
  await pause(700);
  const first = r.products[0];
  const ex = await call('explain_ranking', { id: first.id });
  if (ex && !ex.error) {
    const sig = ex.popularitySignal ?? {};
    show('agent', `It matched ${ex.matchedWords.join(', ')}${ex.matchesWholeRequest ? ' — the whole request' : ''}, and ${sig.reviews ?? 0} reviewers rate it ${sig.rating ?? '—'}. Rank ${ex.rank} of ${ex.policy.candidates}, no model involved, so the same answer every time.`);
  }
  await pause(1600);

  show('person', 'Just show me the cheapest three.');
  await pause(700);
  const cheapest = r.products.filter((p) => p.price != null).sort((a, b) => a.price - b.price).slice(0, 3);
  if (!cheapest.length) {
    show('agent', 'None of these list a price, so I have left the store’s order as it is.');
    show('note', 'End of script. In ChatGPT’s browser or Chrome with WebMCP enabled, an agent does all of this itself.');
    return;
  }
  await call('show_products', { ids: cheapest.map((p) => p.id) });
  show('agent', `On the grid now: ${cheapest.map((p) => `${short(p.title, 36)}${money(p.price)}`).join('; ')}.`);
  await pause(1500);

  show('person', 'Put the cheapest one in my cart and order it.');
  await pause(800);
  const cart = await call('add_to_cart', { id: cheapest[0].id, quantity: 1 });
  if (cart?.error) {
    show('agent', cart.error);
  } else if (cart?.items?.length) {
    const added = cart.items.find((item) => item.id === cheapest[0].id) ?? cart.items[0];
    const total = Number.isFinite(cart.total) ? `Total $${cart.total.toFixed(2)}.`
      : `Priced subtotal $${(cart.subtotal ?? 0).toFixed(2)}. Some items have no listed price; remove those before checkout.`;
    show('agent', `In the cart: ${short(added.title, 40)}${money(added.price)}. ${total}`);
    if (!Number.isFinite(cart.total)) {
      show('note', 'End of script. Your cart is unchanged except for the item just added.');
      return;
    }
    await pause(900);
    show('agent', 'I can fill in the checkout form for you, but I cannot place the order — the store made its checkout a form without auto-submit, so the last press is yours.');
    await pause(700);
    show('note', 'In a WebMCP browser the checkout <form toolname="checkout"> is itself a tool: the browser fills it from the agent’s call and focuses the button. Simulating that fill now.');
    page.fillCheckout?.({ name: 'Alex Rivera', address: '12 Harbour Lane, Portland OR 97201' });
  }
  await pause(900);
  show('note', 'End of script. In ChatGPT’s browser or Chrome with WebMCP enabled, an agent does all of this itself — and still cannot press Place order.');
}
