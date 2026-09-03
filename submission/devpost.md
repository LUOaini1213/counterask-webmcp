# Devpost submission text — Counterask

Paste-ready. The four headed sections are the four things the challenge asks
the description to explain, in the order it asks for them.

---

**Project name:** Counterask

**Elevator pitch (≤ 200 chars):**
A storefront whose WebMCP tools return a *question* when answering would be a
guess — and that reads a whole sentence the way an agent relays it: budget,
refusals and all.

**Built with (tags):** webmcp, javascript, html, css, bm25, python, amazon-reviews-2023, no-backend

**Live URL:** https://luoaini1213.github.io/counterask-webmcp/ (GitHub Pages; no login needed;
`?agent=demo` runs the scripted agent in any browser)

**Repository:** https://github.com/LUOaini1213/counterask-webmcp (MIT, public)

**Testing instructions for judges:** open the live URL in the ChatGPT desktop
app's in-app browser, or in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`
enabled. Ask for "a leather belt under $40" and watch `answer_question` appear in
the tool list; answer it; ask why the first result is first; add one to the cart
and ask the agent to order it — the checkout is a declarative form only you can
submit. Without WebMCP, the header button runs the same flow as a scripted agent.

---

## Why this use case is a strong fit for WebMCP

Every storefront in this challenge will expose the same shape of tool:
`get-products`, `filter-products`, `show-products`. The WebMCP spec's own
e-commerce example does exactly that. All of them assume the store's job is to
**answer**.

For most of a shopping conversation that assumption is wrong. Ask this catalog
for "a belt" and 97 products match; the top-ranked one beats the tenth by 5%.
Ranking them is a coin flip dressed as a recommendation. One more fact — what
it is made of — clears forty of them on average. The store *knows* this; it
has the distribution in front of it. But a tool that can only return products
has no way to say so, so it returns its coin flip and lets the agent present a
guess as an answer.

WebMCP is the first place a website can express its own uncertainty as a
first-class outcome. `search_products` returns one of two shapes: a ranked
list, or **a single clarifying question** with options and counts. The spec
lists "fully autonomous workflows" under its Non-Goals and says the human
interface stays primary; a tool that declines to guess is the most direct
expression of that intent we could build. It puts the person back in the loop
at the exact moment the machine cannot decide — not as a permission prompt
bolted on afterwards, but because the site genuinely does not know and says
so.

## How it creates a better user experience

**The store listens the way an agent talks.** A search box gets "leather
belt". An agent relaying a person gets "I'm looking for a leather belt,
nothing with a snap, not over $50". Fed to a keyword matcher, that sentence
requires "looking" to appear in a title, reads "snap" as a *requirement*, and
never sees the budget. Counterask parses budgets, refusals ("not leather",
"no laces", "nothing from Nike"), orderings ("cheapest", "best rated") and
stated attributes out of the sentence itself. Measured on 800 such sentences
written from real product records, refusals inverted into requirements went
from 100% to 0%, budgets broken in the top ten from 31% to 0%, and Hit@10 from
0.79 to 0.999 — under phrasings the parser was never tuned on as well.

**It never asks what it was told.** Anything stated is a constraint, not a
question. "No preference" is remembered, so the same question cannot come
straight back. The agent can pass whatever it already knows from the
conversation — attributes, exclusions, budget, facets the shopper does not
mind — structured, and structured input wins over the parse.

**It says what it heard, and what still differs.** Every result carries an
`understood` block echoing exactly how the request was read, so the agent can
check before trusting the answer and the person sees the same thing as chips.
When the store does answer, it names the attributes that still separate the
products shown — "eleven buckle, one pull-on" — so the agent can summarise
rather than read out a list.

**"No results" is never the last word.** When nothing survives every
requirement, the store lifts each one in turn, re-counts, and reports which is
doing the damage. The agent gets `relax`; the person gets buttons.

## What people and agents can do together that was difficult before

The person supplies the one thing the store cannot compute: which of two
equally good attributes they actually care about. The store supplies the one
thing the person cannot see: that this is the moment their answer matters,
which attribute it is, and what choosing each option would leave. The agent
carries the question across, in the person's own words, and carries the
answer back.

Before WebMCP this loop did not exist. An agent driving a site through its
DOM sees a grid, not a decision. A site behind a REST API cannot register a
tool that appears only while a question is open and vanishes when it is
answered — here `answer_question` does exactly that, so the tool list itself
tells the agent what the page is waiting for. And a person and an agent
clicking or calling land in the *same* function: one state machine, two
surfaces, nothing that can drift between what a human sees and what an agent
is told.

None of this is about menswear. The parser reads whatever attribute
vocabulary the catalog builder emits; the stopping policy reasons about
evidence and pool size, not clothing; the tools describe a store, not a
category. Swap the catalog and the same seven tools ask the right question
about laptops, groceries or hotel rooms — and the "no results" recovery, the
`understood` echo and the tool-that-appears-when-needed come with them.

Concretely, in one session: "find me a wallet that's not leather, under $30"
→ the store returns 30 candidates and one question (*which category —
wallets, card cases, money clips?*) → the agent asks the person → the person
answers → the store answers with what still differs → the agent curates the
grid with `show_products` so the person sees the pick, not a transcript →
"why that one?" → `explain_ranking`, deterministic, quotable.

## How WebMCP was implemented

Nine imperative tools registered with `document.modelContext.registerTool`
(with a `navigator.modelContext` fallback) and one declarative tool, all
running in the tab — no server, no model call, no tokens:

- `search_products` — the request in the shopper's words plus optional
  structured knowledge; returns `answer` or `need_more_evidence`.
- `answer_question` — **registered dynamically** only while a question is
  open, and unregistered the way the spec has it: by aborting the
  `AbortSignal` it was registered with. The page listens to `toolchange` and
  calls `getTools()` to show the live list, so a person can watch it come and
  go.
- `refine_search` (require or exclude), `revise_search` (the shopper changed
  their mind: take back a value, a facet, the budget — the cart stays),
  `parse_only` (a dry run of the reading with a per-pass audit,
  `readOnlyHint`), `list_attributes` (vocabulary with counts, `readOnlyHint`),
  `show_products` (agent-curated grid), `explain_ranking` (`readOnlyHint`),
  `add_to_cart`, `remove_from_cart`, `view_cart`, `reset_search`. Every tool
  carries a `title`. The visit — search, open question, cart — is remembered
  across reloads.
- `checkout` — a **declarative** `<form toolname="checkout">` with
  `toolparamdescription` on its fields and *without* `toolautosubmit`: an agent
  can fill in the name and address, the browser focuses the button, and only
  the person places the order. The submit handler answers an agent-invoked
  submission through `SubmitEvent.respondWith()`.

Results are MCP-shaped on the wire (`content` text plus `structuredContent`),
so a client following either convention reads the same thing.

Verified on Chrome 152 with `chrome://flags/#enable-webmcp-testing`, through
`document.modelContext` itself: all tools register with titles and
`readOnlyHint`, the declarative checkout form is picked up as a tool, a search
returns the question and `answer_question` appears (and leaves after it is
answered), and `executeTool` on the checkout form fills the fields, focuses
*Place order* and waits for the person — nothing is submitted.

Behind them: a sentence parser (budget, ordering, refusals at both the
recorded-attribute and title-word level, stated attributes, filler); BM25
retrieval over 9,901 real products with length normalisation and a
required-word conjunction; a value-of-information stopping policy that asks
only when the best question is expected to remove at least ten candidates and
at least 18% of the pool, measured as expected survivors rather than entropy
(products carry several values of one attribute, so shares are not a
distribution) and scaled by how much of the pool records the attribute at all.

For browsers without WebMCP, the page offers a **scripted agent**: the same
tools registered against a stand-in `modelContext`, called in the order a real
agent would call them, with the conversation shown beside the grid and
labelled as a simulation. Open the live URL with `?agent=demo` to watch it.

Everything is measured, and the rejected ideas are kept in the code with their
numbers: a "clear leader, stop asking" rule was built twice and removed twice;
graded credit for unrecorded attributes was byte-identical at four settings
and removed. Two self-supervised benchmarks (two-word shopper; agent-relayed
sentences, with a held-out phrasing set), 45 hand-written parse cases and a
stand-in-`modelContext` test of the tool surface run with `npm test`.

---

## Demo video outline (< 3 minutes, with narration)

1. **0:00–0:20** The problem in one search: type `belt` → 97 belts, leader 5%
   ahead. "Any store would show you these. This one asks."
2. **0:20–0:50** The question panel: *What material — leather, nylon,
   polyester, cotton?* with counts. Click leather → the answer, and the trace
   explaining why it stopped asking.
3. **0:50–1:30** The sentence: type `I'm looking for a leather belt, nothing
   with a snap, not over $50`. Show the chips (you said · not · price), the
   `understood` echo in the trace, priced items first.
4. **1:30–2:15** Agent-driven (ChatGPT's browser or Chrome with WebMCP): ask
   the agent for "a wallet that's not leather, under $30". Show the tool-call
   log: `search_products` → question → `answer_question` appears in the tool
   list → the agent relays the question → answer → `show_products`. Point at
   `answer_question` vanishing afterwards.
5. **2:15–2:40** The agent adds the cheapest to the cart and fills in the
   checkout — and stops. Point at the focused *Place order* button: the form is
   a declarative tool without auto-submit, so the last press is the person's.
   Press it yourself; the order confirmation appears.
6. **2:40–3:00** "No results" recovery: `linen suede belt under $12` → the
   relax buttons → 71 belts. Close on the README benchmark table. "Zero
   servers, zero tokens, one question at the right moment — and one button
   only you can press."

## Narration (word for word, ≈ 2 min 40 s at a calm pace)

> This is Counterask, a menswear store built for the WebMCP Challenge.
> Nine thousand nine hundred and one real products, and nothing runs on a
> server: retrieval, parsing and the decision to ask all happen in the tab.
>
> Type "belt". Ninety-seven belts. The first one beats the tenth by five
> percent. Any store would show you these. This one asks — what material —
> because it can see that one answer clears forty of them. Click leather, and
> it answers, and the panel on the right says why it stopped asking.
>
> Now say it the way a person would: "I'm looking for a leather belt, nothing
> with a snap, not over fifty dollars." The store reads the budget, the
> refusal, and the attribute out of the sentence. The chips show what it heard.
> Priced items come first, and it tells the agent what still separates the
> results — eleven buckle, one pull-on.
>
> Here is the same store driven by an agent through WebMCP. The person asks
> for a wallet that isn't leather, under thirty dollars. The agent calls
> search_products. The store returns a question instead of a list, and look at
> the tool list: answer_question appeared, because the page is waiting. The
> agent relays the question, the person answers, the agent calls
> answer_question, and the tool is gone again. Then show_products puts the
> pick on the grid — the person sees products, not a transcript.
>
> The agent adds the cheapest one to the cart and fills in the checkout — and
> stops. The checkout is a declarative WebMCP form without auto-submit. The
> agent can fill it; only I can press Place order. That is the spec's own
> principle, built into the store: the human interface stays primary.
>
> When nothing matches — linen suede belt under twelve dollars — the store
> doesn't say "no results". It says what to give up: drop the material, and
> seventy-one belts come back.
>
> Everything is measured. On eight hundred sentences written from real
> product records, refusals inverted into requirements went from one hundred
> percent to zero, broken budgets from thirty-one percent to zero, and Hit at
> ten from point seven nine to point nine nine nine.
>
> Seven tools, one state machine, zero tokens. A store that asks back when
> answering would be a guess.
