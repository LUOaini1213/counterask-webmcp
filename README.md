# Counterask — the store that asks back

A menswear storefront whose WebMCP tools return **a question** when answering
would be a guess — and that reads a whole sentence the way an agent relays it:
budget, refusals, stated attributes and all.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).
9,901 real products. No server, no model call, no tokens.

**Live:** <https://luoaini1213.github.io/counterask-webmcp/> — open it in the ChatGPT
desktop app's browser or Chrome with WebMCP enabled; add `?agent=demo` in any
browser to watch the scripted agent.

---

## The idea

Every WebMCP storefront in this challenge will expose the same shape of tool:
`get-products`, `filter-products`, `show-products`. The spec's own e-commerce
example does exactly that. Those tools all share one assumption — that the
store's job is to **answer**.

For most of a shopping conversation that assumption is wrong.

Ask this catalog for "a belt" and 97 products match. Every one of them is a
belt, and the top-ranked item beats the tenth by 5%. Ranking them is a coin
flip dressed up as a recommendation. One more fact — what it is made of —
clears forty of them on average. The store knows this. It has the distribution
in front of it. But a tool that can only return products has no way to say so,
so it returns its coin flip and lets the agent present a guess as an answer.

**Counterask gives the store a second move.** `search_products` returns one of
two things:

```jsonc
// enough evidence
{ "status": "answer", "products": [ … ], "candidates": 58,
  "differentiators": [ { "facet": "closure", "splits": [ {"value":"buckle","count":11}, … ] } ],
  "why": ["Best question would only clear ~8 of 58 candidates — not worth a turn."] }

// not enough evidence
{ "status": "need_more_evidence",
  "question": "What material are you after — leather, nylon, polyester, cotton?",
  "facet": "material",
  "options": [ {"value":"leather","count":57}, … ],
  "why": ["97 candidates, leader only 5% ahead.",
          "Asking \"material\" clears ~40 of them on average (recorded on 89%)."],
  "note": "Answering now would be a guess. Put this question to the shopper, then call answer_question." }
```

(On the wire each result is MCP-shaped: `content` carries that JSON as text,
`structuredContent` carries the object, so a client following either
convention reads the same thing.)

The question is not a failure path. It is the store declining to guess on the
shopper's behalf, and handing the agent the one question worth asking. And
when the store *does* answer, it says what still separates the products it is
showing, so the agent can summarise — "eleven buckle, one pull-on" — instead
of reading out a list.

## What an agent says is not what a search box gets

A search box gets `leather belt`. An agent relaying a person gets:

> I'm looking for a leather belt, nothing with a snap, not over $50

Fed to a keyword matcher, that sentence does three wrong things at once: it
requires "looking" and "over" to appear in a title, it reads "snap" as a
requirement rather than a refusal, and it never sees the budget at all.

So the store parses the sentence itself — in a fixed order, blanking each span
it claims so a word read one way is never read again another way:

| Pass | Reads | Example |
|---|---|---|
| budget | ceilings, floors, ranges, "around" | `under $40`, `between 20 and 30 dollars`, `not over $50` |
| ordering | cheapest, best rated, most popular | `the cheapest running shoes you have` |
| waved through | "any … is fine", "doesn't matter", "no preference on" | `any material is fine` → never asked about |
| settings | "for work", "for a wedding", "for the beach" | ranking hints, never filters |
| refusals | "not", "no", "without", "nothing with", "don't want", "avoid", "skip the" … | `not leather`, `no laces`, `nothing from Nike` |
| stated attributes | every surface form the catalog builder knows | `waterproof` → water resistant, `for the gym` → athletic |
| filler | "I'm looking for", "for my brother's birthday", "please" | dropped |

Three details matter more than the regexes:

**A refusal is applied at two levels.** A value the catalog *records* is
excluded (`closure ≠ lace-up`), and the refused word itself is banned from
titles (`"lace"`), which is what makes `not nike` and `no hood` work with no
vocabulary at all. A product whose listing never says what it is made of is
*not* excluded by "not leather" — missing is not a mismatch, in either
direction.

**A stated attribute is a filter, not a required title word.** "Something for
the gym" becomes `occasion = athletic` over every athletic product, with
titles that say "gym" ranked first. Requiring the word shrank that pool from
790 to the 48 whose title happens to say so.

**The store reports how it read you.** Every result carries an `understood`
block — query, attributes, exclusions, budget, sort, words it ignored, and any
conflict ("running shoes but not for the gym" names one value both ways). An
agent can check it before trusting the answer, and a person sees the same
thing as chips above the grid.

Measured on 800 sentences written from real product records
([`scripts/agentbench.mjs`](scripts/agentbench.mjs)), before and after:

| | keyword matcher | sentence parser |
|---|---:|---:|
| Hit@10 | 0.793 | **0.999** |
| Hit@1 | 0.698 | **0.901** |
| MRR | 0.738 | **0.939** |
| refusals inverted into requirements | 100% | **0%** |
| refused value shown in top 10 | 71% | **0%** |
| budget broken in top 10 | 31% | **0%** |
| questions asked about something already said or waved through | 0 | 0 |
| questions re-asked after "no preference" | 12 | **0** |

A parser tuned on its own templates can pass while failing the next phrasing
a person tries, so the same 800 targets are also run under a second set of
phrasings it was never tuned on (`--holdout`: "skip the", "avoid", "max $40",
"I have 40 dollars to spend", "in the $20-$30 range", "not fussy about the
closure"…). Those score Hit@10 0.998 with the same zero failures. And 61
hand-written sentences in
[`scripts/parse_test.mjs`](scripts/parse_test.mjs) pin down what must be read
and what must be left alone: *no-show socks* refuse nothing, *size 10* is not a
budget, *41mm* is not $41, *Under Armour* is a brand.

Those numbers are from the catalogue build the parser was written against.
On the rebuilt attribute index below, the same two benchmarks read: two-word
shopper Hit@10 0.998 · Hit@1 0.849 · MRR 0.905; agent sentences Hit@10 0.993 ·
Hit@1 0.904 · MRR 0.937 (held-out phrasings 0.991 · 0.900 · 0.935), listening
checks still at zero.

## Why this is the right shape for WebMCP specifically

The [specification](https://github.com/webmachinelearning/webmcp) lists under
**Non-Goals**:

> **Fully autonomous workflows**: The API is not intended for fully autonomous
> agents operating without human oversight.

and under design principles:

> The human web interface remains primary; agent tools **augment rather than
> replace** user interaction.

A tool that returns a question is the most direct expression of that intent we
could build. It puts the person back in the loop at the exact moment the
machine cannot decide — not as a permission prompt bolted on afterwards, but
because the site genuinely does not know and says so.

Three further things fall out of it:

**The tool list is state.** `answer_question` is registered only while a
question is open, and unregistered the moment it is answered. An agent reading
the available tools can see what the page is waiting for without being told.

**One code path, two surfaces.** A person clicking an answer chip and an agent
calling `answer_question` enter the same function. The page cannot drift
between what it shows a human and what it tells an agent, because there is only
one state machine. The search box understands the same sentences the tools do.

**The agent's knowledge wins.** Whatever the agent already knows from the
conversation can be passed structured — attributes, exclusions, budget, facets
the shopper said they do not mind — and structured input overrides the parse.
The store never asks about anything it has been told.

## Verified on a real WebMCP browser

Run on Chrome 152 (Chrome for Testing) with `chrome://flags/#enable-webmcp-testing`,
driving the live site through `document.modelContext` itself:

- All eleven imperative tools appear in `getTools()` with their titles and
  `readOnlyHint`; the declarative `<form toolname="checkout">` appears as a
  twelfth tool, its schema derived from the form's fields.
- `search_products` returns the question; `answer_question` then appears in
  the list, `toolchange` fires and the page's *on offer now* line updates —
  natively, not through the stand-in.
- Calling `answer_question` closes the question and the tool leaves the list
  a moment later. (The first native run rejected that call: aborting a tool's
  registration while the browser was still delivering its own result fails
  with an "unknown transient reason", so a closed question now keeps its tool
  for 1.5 s.)
- `executeTool` on the `checkout` form fills in the name and address, focuses
  *Place order*, and stays pending until a person presses it. Nothing was
  submitted.
- One implementation detail worth knowing: Chrome 152's `executeTool` takes
  its input as a JSON *string* and exposes `inputSchema` as one; tools still
  receive a parsed object.

## The tools

| Tool | What it does |
|---|---|
| `search_products` | The request in the shopper's words, plus anything already known, structured. Returns products **or** a question. |
| `answer_question` | *Registered only while a question is open.* One or more option values, or `no_preference` — which is remembered. |
| `refine_search` | Add one requirement or one refusal mid-conversation. |
| `revise_search` | Take something back — a value, a facet, a refused word, the budget, the sort — and keep the rest. |
| `parse_only` | A dry run: how a sentence would be read, with which pass claimed which words. Nothing searched. *read-only* |
| `list_attributes` | The vocabulary this catalog actually carries, with counts. *read-only* |
| `show_products` | Replace the grid with ids the agent picked, in its order. |
| `explain_ranking` | Which words matched, whether the whole request matched, demand signal, policy state. *read-only* |
| `add_to_cart` · `remove_from_cart` · `view_cart` | The cart, with line totals. |
| `reset_search` | Clear the search, including the question budget. The cart is kept. |
| `checkout` | **Declarative** — a `<form toolname="checkout">` without `toolautosubmit`. An agent can fill it; the browser focuses the button; only the person presses it. |

Every tool goes through the one call the spec defines, in
[`public/webmcp.js`](public/webmcp.js):

```js
document.modelContext.registerTool({
  name: "search_products",
  description: "Search 9,901 menswear products. Pass the shopper's request in their own words …",
  inputSchema: { type: "object", properties: { query: { type: "string" }, /* … */ }, required: ["query"] },
  execute: async (input) => api.search(input.query, "agent", input),
}, { signal: controller.signal });
```

Three spec details, because they are where "thorough use of WebMCP" is
decided:

- **Dynamic registration is done the way the spec does it.** `registerTool`
  resolves to nothing; a tool is removed by aborting the `AbortSignal` it was
  registered with. `answer_question` is registered with a fresh controller
  while a question is open and aborted when it is answered (older polyfills
  that hand back a handle, or expose `unregisterTool`, are honoured too).
- **The page watches its own tool list.** `getTools()` plus the `toolchange`
  event drive the *on offer now* line in the tool-calls panel, so a person can
  watch `answer_question` come and go.
- **Titles and annotations.** Every tool has a `title`; the pure reads carry
  `readOnlyHint: true`.

**When nothing matches.** A sentence with three requirements and a budget can
empty a 9,901-product catalog, and "no results" is the least useful thing a
store can say. When nothing — or fewer than four products — survives, the
store lifts each requirement, refusal, banned word, required word and the
budget in turn, re-counts, and reports which one is doing the damage. The
agent gets the list as `relax` ("lifting *material = linen / suede* leaves
71"); the person gets the same options as buttons.

## The attribute index

The builder reads title, bullet points and details as one text and records
every attribute value it can name. It used to match substrings, which is why
it could not list "snap" (it would fire on "snapback") or "lace" ("shoelace"),
and why "faux leather" counted as leather. It now matches whole words with
the endings people add, longest form first and never overlapping — the same
rule the page uses on a sentence, which is what keeps the index a superset of
anything a shopper can say. Faux leather is its own value; closures gained
slip-on, drawstring and elastic waist; occasions gained the sports; and a
**color** facet was added from the same text.

| facet | recorded before | after |
|---|---:|---:|
| material | 56% | 69% |
| closure | 31% | 41% |
| occasion | 25% | 35% |
| fit | 8% | 9% |
| color | — | 41% |

Measured on the same two-word queries: Hit@10 0.995 → 0.998, Hit@1 0.841 →
0.849, MRR 0.898 → 0.905, at +0.03 questions per session. The agent-sentence
benchmark composes its sentences from the target's own attributes, so its
sentences changed too (more to state, more to refuse); it reads Hit@10 0.993
with every listening check still at zero. What the rebuild buys in the store
is visible in the questions: *leather belt, buckle* now asks **Which color —
black, brown, silver, gold?**, which no earlier build could ask.

## How the stopping policy works

`decide()` in [`public/engine.js`](public/engine.js) answers when any of these hold:

- **≤ 12 candidates** — the shopper can just look at the list.
- **3 questions already asked** — the budget is spent.
- **No remaining question earns its turn** — the best one would clear fewer
  than 10 candidates, or less than 18% of the pool.

Otherwise it asks about the attribute expected to remove the most candidates —
skipping anything the shopper stated, and anything they declined.

**Three details that took the most work:**

*Entropy is the textbook choice here and it is wrong for this data.* A product
carries several values of the same attribute at once — a shoe is both
`athletic` and `casual` — so the value shares are not a probability
distribution and `-Σp·log p` is meaningless. Counting expected survivors needs
no such assumption and produces a number a shopper can read: *answering this
cuts the pool by about this much.*

*Missing is not a mismatch.* Only 5% of this catalog records a `fit` value. A
naive gain calculation loves `fit` — asking it "removes 98% of candidates" —
but it removes them for having no data, not for failing the requirement. So
reduction is measured inside the covered subset and scaled by coverage, and any
attribute recorded on under 45% of the pool is not asked about at all.

*A question has to earn its turn in absolute terms.* Cutting 409 candidates to
213 is worth a turn; cutting 23 to 9 is not, yet the second is the larger
fraction. Tuning on the ratio alone drove the store to dump 409 running shoes
on the shopper while interrogating them about a 23-item sweater. A "the leader
is clear enough, stop asking" rule was built twice and removed twice — the
second time it measurably lost more than it saved.

*The category tree is asked one level at a time, scored as it will be shown.*
Every product carries its whole category path. A question shows four
options and "something else", so each level of the tree, and each
product's own leaf, is scored as the four biggest nodes plus an "other"
bucket; the level that clears the most candidates is asked, phrased under
the deepest node the pool shares — *Which kind of clothing — pullovers,
vests, cardigans, sweaters?* Measured against the leaf-only question it
replaced: keyword Hit@1 +0.005, Hit@10 −0.001, agent sentences flat — a
wash, kept for the questions it produces and because an agent can now
filter by a parent node ("shoes") as well as a leaf.

*One step of lookahead was built and is off.* Valuing the strongest few
questions by what they remove now plus what the best follow-up would
remove from what each answer leaves (`POLICY.lookahead`) saves about
0.01 of a question per session and moves Hit@1 by one or two targets in
either direction, on both benchmarks and both shoppers
(`npm run ab:lookahead`). The myopic choice is already the right question
nearly every time on this catalogue; there is little to set up.

What the built-in examples do:

| Query | Read as | Candidates | Decision |
|---|---|---:|---|
| `belt` | — | 97 | **ask** — what material? |
| `leather belt` | material = leather | 63 | answer — best question clears only ~8 |
| `running shoes` | occasion = athletic | 728 | **ask** — which category? |
| `waterproof hiking boots, no laces` | water resistant, outdoor; **not** lace-up, "lace" banned | 56 | **ask** — which category? |
| `a wallet that is not leather, under $30` | **not** leather; ≤ $30 | 30 | **ask** — which kind of accessories? |
| `cheapest wool sweater` | wool; cheapest first | 21 | **ask** — which category? |
| `…leather belt, nothing with a snap, not over $50` | leather; **not** snap; ≤ $50 | 56 | answer — differ by closure: 10 buckle, 1 pull-on |

`leather belt` is the one to look at. 63 candidates is a lot, and the store
still answers, because no recorded attribute separates them enough to be worth
a turn — it says so, and says what little does differ. The policy asks when a
question helps, not when the pool is merely large.

## Measured

Two benchmarks, both self-supervised from the product records, both seeded:

- [`scripts/bench.mjs`](scripts/bench.mjs) — the shopper a search box meets:
  two or three title words, truthful answers.
  **Hit@10 0.998 · Hit@1 0.849 · MRR 0.905 · 1.13 turns.**
- [`scripts/agentbench.mjs`](scripts/agentbench.mjs) — the caller an agent
  relays: a sentence with filler, stated attributes, a refusal, a budget.
  **Hit@10 0.993 · Hit@1 0.904 · MRR 0.937 · 1.08 turns**, with every
  listening check at zero failures. Under held-out phrasings: Hit@10 0.991 ·
  Hit@1 0.900 · MRR 0.935, still zero failures. `SHOPPER=menu` runs either
  benchmark with a shopper who can only pick from the four options shown.
- [`scripts/parse_test.mjs`](scripts/parse_test.mjs) — 61 hand-written
  sentences with what the parser must and must not take from each.
- [`scripts/fuzz.mjs`](scripts/fuzz.mjs) — 4,000 sentences nobody wrote,
  built from fragments of every pass in random order: the parser must never
  throw and a refusal must never come back as a requirement. Its first run
  found 32 sentences where one refusal's window swallowed the next cue's
  words; that is fixed, and the run is part of `npm test`.
- [`scripts/tools_test.mjs`](scripts/tools_test.mjs) — the WebMCP surface
  against a stand-in `modelContext`, including `answer_question` appearing and
  disappearing on cue.

Both know their blind spots. The simulated shopper answers instantly and only
ever states attributes the target really has, so neither benchmark can price a
person's patience or a missing attribute. That is why the ask threshold is
set in absolute candidates removed, and why a "clear leader" shortcut is not
shipped — those were the two places measurement said no.

Retrieval takes about two milliseconds a query on a laptop; the whole
storefront is a 0.58 MB download.

## Running it

```bash
python scripts/build_catalog.py --source /path/to/catalog.jsonl   # optional, output is committed
python -m http.server 5173 --directory public                     # or: npm start, npx serve public
npm test                                                          # parser cases, tool surface, both benchmarks
```

Then open `http://localhost:5173` in the **ChatGPT desktop app's in-app
browser**, which supports WebMCP by default, or in Chrome with WebMCP
enabled, to drive it with an agent:

- Chrome 149 or newer, `chrome://flags/#enable-webmcp-testing` → *Enabled*,
  restart.
- Optionally the
  [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools)
  extension from Chrome Labs, which lists the page's tools, runs them by hand,
  and can hand them to Gemini. Watch `answer_question` appear in its list after
  a search for "belt".

In any other browser the storefront degrades to an ordinary — and fully
working — search UI that understands the same sentences; the badge in the
header tells you which mode you are in.

Without WebMCP, the header also offers **a scripted agent**: the same tools,
registered through the same code against a stand-in `modelContext` that
follows the spec's shape (`registerTool` with an `AbortSignal`, `getTools`,
`toolchange`), called in the order a real agent would call them, with the
conversation shown beside the grid — a person asks for a non-leather wallet
under $30, the store returns a question, `answer_question` appears in the tool
list, the person answers, it disappears, the agent asks why the first result
is first, curates the grid, adds the cheapest to the cart, fills in the
checkout, and stops — because the last press is the person's. It is labelled
as a simulation wherever it appears. `?agent=demo` starts it on load.

**Deploying.** The whole storefront is the `public/` folder, so any static
host works. Three are pre-configured: a GitHub Pages workflow
([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) that runs the
tests and publishes on every push to `main` once Pages is set to *GitHub
Actions* in the repository settings; [`netlify.toml`](netlify.toml); and
[`vercel.json`](vercel.json).

```
public/
  index.html      storefront
  app.js          state machine + rendering (the one code path)
  engine.js       sentence parser, retrieval, attribute evidence, stopping policy
  webmcp.js       tool registration, including the dynamic answer_question
  data/catalog.json
scripts/
  build_catalog.py  50,000-product source catalog -> browser index
  bench.mjs         ground truth, two-word shopper
  agentbench.mjs    ground truth, agent-relayed sentences (--holdout for unseen phrasings)
  parse_test.mjs    61 hand-written sentences the parser must read, and must not over-read
  tools_test.mjs    the WebMCP surface, with a stand-in modelContext
  smoke.mjs         policy behaviour on the sample queries
  eval.mjs          pool sizes, ask rate, timing across 50 queries
```

## Data

Products are the menswear slice (level-2 category `Men`) of the frozen
50,000-product catalog derived from **Amazon Reviews 2023**, McAuley Lab, UCSD.
9,901 items, 2.4 MB raw / 0.58 MB gzipped — the whole storefront ships to the
client. Prices exist for one product in five; a budget excludes what is priced
outside it and keeps what is unpriced, ranked after. There is no ranking model
and no training: demand is proxied by log-scaled review volume, because a
frozen catalog has no click log.

## A parallel implementation

Teammate Cui Zixuan (`cuizhi-chat`) built an independent implementation of
the same design on the [`cuizi-rewrite`](https://github.com/LUOaini1213/counterask/tree/cuizi-rewrite) branch
of the sibling repository —
its own parser, policy, tests and a self-contained single-file build. Five of
its ideas were folded back into this tree: the category tree asked one level
at a time, the `parse_only` dry run with a
per-pass audit of the reading, `revise_search` for a shopper who changes
their mind, remembering the visit across reloads, and a fuzzer. The branch is
kept as it was.

## License

MIT — see [LICENSE](LICENSE).
