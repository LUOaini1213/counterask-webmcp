// WebMCP surface.
//
// The store exposes its dialogue policy, not just its database. search_products
// can come back with a question instead of a product list, and while that
// question is open an extra tool — answer_question — exists to close it. The
// tool list itself tells the agent what the page is waiting for.
//
// That shape is the spec's own stated intent rather than a workaround: WebMCP
// lists "fully autonomous workflows" under Non-Goals and says the human
// interface stays primary. A tool that declines to guess is how a storefront
// puts the person back in the loop at the one moment it matters. The checkout
// is the other such moment, and it is not here at all: it is a declarative
// tool — a <form toolname="checkout"> in index.html without toolautosubmit —
// so an agent can fill it and only the person can submit it.

const context = () => document.modelContext ?? navigator.modelContext ?? null;

// How long a closed question keeps its answer_question tool registered, so
// the browser can finish delivering the call that closed it.
const POLICY_UNREGISTER_DELAY = 1500;

const FACETS = ['material', 'closure', 'sleeve', 'fit', 'care', 'origin', 'sole', 'occasion', 'pocket', 'waterproof', 'color', 'kind'];

const facetMap = (what) => ({
  type: 'object',
  description: `${what} Keys are facets — ${FACETS.join(', ')} — values are arrays of attribute values. `
    + 'Surface wording is accepted ("waterproof" for "water resistant", "wallets" for the category leaf); '
    + 'call list_attributes for the exact vocabulary and counts.',
  additionalProperties: { type: 'array', items: { type: 'string' } },
});

// The names currently on offer, from the context's own registry when it has
// one (getTools is in the spec) — the page shows this list so a person can
// watch answer_question come and go.
export async function listTools(ctx) {
  try {
    if (typeof ctx?.getTools === 'function') return (await ctx.getTools()).map((t) => t.name);
  } catch { /* an older polyfill without getTools */ }
  return [];
}

// `ctx` is the browser's modelContext by default. The scripted demo passes a
// stand-in, so the same registration code runs against both. `onTools` is
// told the tool names whenever they change.
export function registerTools(api, onCall, ctx = context(), onTools = null) {
  if (!ctx?.registerTool) return false;

  const announce = async () => { if (onTools) onTools(await listTools(ctx)); };
  if (typeof ctx.addEventListener === 'function') ctx.addEventListener('toolchange', announce);

  // Registration as the spec has it: the promise resolves to nothing, and a
  // tool is unregistered by aborting the signal it was registered with. An
  // older polyfill may instead hand back a handle, or expose unregisterTool;
  // both are honoured, so the dynamic tool below disappears everywhere.
  async function register(spec) {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const handle = ctx === document.modelContext
      ? await document.modelContext.registerTool(spec, options)
      : await ctx.registerTool(spec, options);
    return async () => {
      controller.abort();
      try { await handle?.unregister?.(); } catch { /* not a handle */ }
      try { await ctx.unregisterTool?.(spec.name); } catch { /* not provided */ }
    };
  }

  let dropAnswerTool = null;

  // Wrap every handler so the page's own activity log sees agent traffic.
  //
  // On the wire a result is MCP-shaped: `content` carries the JSON as text
  // for a client that reads tool results the way MCP clients do, and
  // `structuredContent` carries the object itself for one that takes JSON.
  // Whichever convention the browser follows, the agent sees the same thing.
  //
  // Registering answer_question happens as soon as a question opens.
  // *Unregistering* it is deferred: Chrome 152's native implementation
  // rejects an executeTool whose tool is aborted while the browser is still
  // finishing that call ("The operation failed for an unknown transient
  // reason"), and a macrotask later was still too soon. So a closed question
  // takes its tool away a moment later, and at the latest at the start of
  // the next call. The stand-in never minded either way.
  let lastResult = null;
  let unregisterTimer = null;
  const settle = () => syncAnswerTool(lastResult).catch((err) => console.warn('WebMCP tool sync failed', err));
  const traced = (name, fn) => async (args) => {
    if (unregisterTimer) { clearTimeout(unregisterTimer); unregisterTimer = null; await settle(); }
    const result = await fn(args ?? {});
    onCall?.(name, result);
    lastResult = result;
    if (result?.status === 'need_more_evidence') await settle();
    else unregisterTimer = setTimeout(() => { unregisterTimer = null; settle(); }, POLICY_UNREGISTER_DELAY);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    };
  };

  // answer_question only exists while a question is on the table. An agent
  // reading the tool list can see, without being told, that the page is
  // waiting on the shopper.
  async function syncAnswerTool(result) {
    const pending = result?.status === 'need_more_evidence';
    if (pending && !dropAnswerTool) {
      dropAnswerTool = await register({
        name: 'answer_question',
        title: 'Answer the store\'s question',
        description:
          'Answer the clarifying question the store is currently asking. Put the question to the '
          + 'shopper first unless the conversation already answers it — the whole point is that the '
          + 'store will not guess this attribute on their behalf. Pass one or more of the option '
          + 'values offered ("leather or suede" is two values), or "no_preference" when the shopper '
          + 'genuinely does not mind; the store then stops asking about that attribute.',
        inputSchema: {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'Option values from the question, or ["no_preference"].',
            },
            value: { type: 'string', description: 'A single option value, if you prefer.' },
          },
        },
        execute: traced('answer_question', ({ values, value }) =>
          api.answerQuestion(values ?? (value != null ? [value] : []), 'agent')),
      });
      await announce();
    } else if (!pending && dropAnswerTool) {
      const drop = dropAnswerTool;
      dropAnswerTool = null;
      await drop();
      await announce();
    }
  }

  const tools = [
    {
      name: 'search_products',
      title: 'Search the store',
      description:
        'Search 9,901 menswear products. Pass the shopper\'s request in their own words: the store '
        + 'reads budgets ("under $40", "between 20 and 30 dollars"), refusals ("not leather", '
        + '"no laces", "nothing from Nike"), orderings ("cheapest", "best rated"), stated '
        + 'attributes ("long sleeve", "waterproof") and attributes waved through ("any material is '
        + 'fine") out of the sentence itself, and never asks about anything already said. Anything '
        + 'you already know from the conversation can also be passed structured; structured input '
        + 'wins over the parse. '
        + 'Returns one of two shapes. status "answer": ranked products, plus "differentiators" '
        + 'naming the attributes that still separate them, so you can summarise rather than list. '
        + 'status "need_more_evidence": one clarifying question, because ranking now would be a coin '
        + 'flip between near-identical items and one attribute would settle it — put it to the '
        + 'shopper, then call answer_question. Either way, "understood" echoes exactly how the '
        + 'request was read; check it if a result looks off. When fewer than four products match, '
        + '"relax" says which requirement to lift and how many that leaves.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The request, in the shopper\'s words. A whole sentence is fine.',
          },
          attributes: facetMap('Attributes the shopper requires.'),
          exclude: facetMap('Attributes the shopper refuses.'),
          budget_max: { type: 'number', description: 'Ceiling in dollars. Products with no listed price are kept, ranked after priced ones.' },
          budget_min: { type: 'number', description: 'Floor in dollars.' },
          no_preference: {
            type: 'array',
            items: { type: 'string', enum: FACETS },
            description: 'Facets the shopper said they do not mind. The store will not ask about these.',
          },
          sort: {
            type: 'string',
            enum: ['relevance', 'price_asc', 'price_desc', 'rating', 'popular'],
            description: 'Order of the answer. Default relevance.',
          },
        },
        required: ['query'],
      },
      execute: traced('search_products', ({ query, ...given }) => api.search(query, 'agent', given)),
    },
    {
      name: 'refine_search',
      title: 'Add a requirement or a refusal',
      description:
        'Add one requirement or one refusal to the current search without starting over. Use it '
        + 'when the shopper adds a fact mid-conversation — "actually, leather", "not the zip one". '
        + 'Returns the same two shapes as search_products, and may come back with a question.',
      inputSchema: {
        type: 'object',
        properties: {
          facet: { type: 'string', enum: FACETS, description: 'Which attribute.' },
          values: {
            type: 'array',
            items: { type: 'string' },
            description: 'Accepted (or, with mode "exclude", refused) values. Surface wording is accepted.',
          },
          mode: { type: 'string', enum: ['require', 'exclude'], description: 'Default "require".' },
        },
        required: ['facet', 'values'],
      },
      execute: traced('refine_search', ({ facet, values, mode }) => api.refine(facet, values, 'agent', mode ?? 'require')),
    },
    {
      name: 'parse_only',
      title: 'See how the store would read a sentence',
      description:
        'A dry run: how the store would read the shopper\'s words — what it takes as a '
        + 'requirement, a refusal, a budget, an ordering, a facet waved through, and what it '
        + 'ignores — with which pass claimed which words, in order. Nothing is searched or '
        + 'changed. Use it to check a reading before acting on it, or to show the shopper what '
        + 'was heard.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The request, verbatim.' } },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      execute: traced('parse_only', async ({ query }) => api.parseOnly(query)),
    },
    {
      name: 'revise_search',
      title: 'Take something back',
      description:
        'The shopper changed their mind. Drop one or more things they had said — an attribute '
        + 'value ("leather"), a facet name ("material", which also forgets a no-preference), a '
        + 'refused word, "budget" or "sort" — and keep the rest, including the cart. Pass '
        + 'drop_all to take the whole request back. The result says what was dropped and what '
        + 'was not found, so you can tell the shopper it heard them.',
      inputSchema: {
        type: 'object',
        properties: {
          drop: { type: 'array', items: { type: 'string' }, description: 'Values, facet names, refused words, "budget" or "sort".' },
          drop_all: { type: 'boolean', description: 'Take the whole request back; the cart is kept.' },
        },
      },
      execute: traced('revise_search', ({ drop, drop_all }) => api.revise(drop ?? [], Boolean(drop_all), 'agent')),
    },
    {
      name: 'list_attributes',
      title: 'The catalog\'s attribute vocabulary',
      description:
        'The attribute vocabulary this catalog actually carries, per facet, with how many products '
        + 'record each value. Use it to map a shopper\'s wording onto values the other tools accept, '
        + 'and to tell the shopper what is and is not on offer.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: traced('list_attributes', async () => ({ status: 'answer', facets: api.vocab() })),
    },
    {
      name: 'show_products',
      title: 'Curate the grid',
      description:
        'Replace the visible product grid with a specific set of ids, in your order. Use it after '
        + 'applying judgement the store cannot — reading images, weighing what the shopper said '
        + 'three messages ago — so the person sees what you picked rather than a chat transcript.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Product ids from a previous result, in the order to display.',
          },
        },
        required: ['ids'],
      },
      execute: traced('show_products', ({ ids }) => api.showProducts(ids ?? [])),
    },
    {
      name: 'explain_ranking',
      title: 'Why a product ranks where it does',
      description:
        'Why a given product sits where it does: which words matched, whether it matches the whole '
        + 'request, the demand signal, and the stopping-policy state. Deterministic, so the same '
        + 'answer every time — quote it to the shopper if they ask why.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A product id from the current results.' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: true },
      execute: traced('explain_ranking', async ({ id }) => api.explain(id)),
    },
    {
      name: 'add_to_cart',
      title: 'Add to the cart',
      description:
        'Put a product from the current results in the cart. Returns the cart with line totals. '
        + 'Placing the order is not a tool you can call: the checkout form on the page is a '
        + 'declarative WebMCP tool without auto-submit, so you may fill it in, and only the '
        + 'shopper can press "Place order".',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A product id from the current results.' },
          quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'Default 1. At most 99 of a product in the cart, including previous additions.' },
        },
        required: ['id'],
      },
      execute: traced('add_to_cart', ({ id, quantity }) => api.addToCart(id, quantity === undefined ? 1 : quantity)),
    },
    {
      name: 'remove_from_cart',
      title: 'Remove from the cart',
      description: 'Take a product out of the cart. Returns the cart.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'A product id in the cart.' } },
        required: ['id'],
      },
      execute: traced('remove_from_cart', ({ id }) => api.removeFromCart(id)),
    },
    {
      name: 'view_cart',
      title: 'The cart',
      description: 'What is in the cart, with line totals and the order total.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: traced('view_cart', async () => api.cart()),
    },
    {
      name: 'reset_search',
      title: 'Start over',
      description: 'Clear the query, every requirement, refusal and budget, and the question budget. The cart is kept.',
      inputSchema: { type: 'object', properties: {} },
      execute: traced('reset_search', async () => api.reset('agent')),
    },
  ];

  Promise.all(tools.map(register)).then(announce).catch((err) => console.warn('WebMCP registration failed', err));
  return true;
}
