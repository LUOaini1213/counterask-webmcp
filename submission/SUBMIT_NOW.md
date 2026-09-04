# 提交单 — 照抄即可（Devpost 表单逐格对应）

截止：**2026-09-04 16:00 GMT+8**（Devpost 页面倒计时为准）

顺序：先传 YouTube（最慢），拿到链接后再填表。

---

## 0. 先做：上传 YouTube

文件：`counterask-demo.mp4`（1:56.99，7.3 MB，已发到对话里）

- 可见性 **Public**（不是 Unlisted，规则要求 publicly visible）
- 标题：`Counterask — a WebMCP store that asks back`
- 说明栏贴：
  ```
  Counterask is a menswear storefront whose WebMCP tools return a question
  when answering would be a guess. 9,901 real products, no server, no model
  call, no tokens. Recorded in Chrome 152 with WebMCP enabled.

  Live: https://luoaini1213.github.io/counterask-webmcp/
  Code: https://github.com/LUOaini1213/counterask-webmcp (MIT)

  No music. Built for The WebMCP Challenge.
  ```
- 类别：Science & Technology
- 传完用无痕窗口打开链接确认能播

---

## 1. Project name
```
Counterask
```

## 2. Elevator pitch
```
A storefront whose WebMCP tools hand the agent a question instead of a guess — and that reads a whole sentence: budget, refusals and all.
```

## 3. Built with（标签，逐个加）
```
webmcp
javascript
html
css
bm25
python
amazon-reviews-2023
no-backend
```

## 4. Try it out（链接栏）
```
https://luoaini1213.github.io/counterask-webmcp/
https://github.com/LUOaini1213/counterask-webmcp
```

## 5. Video demo link
```
（粘贴刚才的 YouTube 链接）
```

## 6. 公开代码仓
```
https://github.com/LUOaini1213/counterask-webmcp
```

## 7. 给评委的测试说明（如果表单有这一栏）
```
Open the live URL in the ChatGPT desktop app's in-app browser, or in Chrome
149+ with chrome://flags/#enable-webmcp-testing enabled. No login needed.

Try: "a wallet that is not leather, under $30". The store returns a question
instead of a list, and answer_question appears in the tool list while it is
open. Answer it, then ask the agent to add one to the cart and order it — the
checkout is a declarative WebMCP form without auto-submit, so the agent can
fill it but only you can press Place order.

Without a WebMCP browser, add ?agent=demo to the URL to watch the same flow
run as a scripted agent.
```

---

## 8. About the project（正文，四段，全部照抄）

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
0.79 to 0.99 — under phrasings the parser was never tuned on as well. On the
build that ships, the two benchmarks read Hit@10 0.998 (two-word shopper) and
0.993 (agent-relayed sentences), with every listening check at zero.

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
category. Swap the catalog and the same tools ask the right question
about laptops, groceries or hotel rooms — and the "no results" recovery, the
`understood` echo and the tool-that-appears-when-needed come with them.

Concretely, in one session: "find me a wallet that's not leather, under $30"
→ the store returns 30 candidates and one question (*which category —
wallets, card cases, money clips?*) → the agent asks the person → the person
answers → the store answers with what still differs → the agent curates the
grid with `show_products` so the person sees the pick, not a transcript →
"why that one?" → `explain_ranking`, deterministic, quotable.

## How WebMCP was implemented

Eleven imperative tools registered with `document.modelContext.registerTool`
(with a `navigator.modelContext` fallback), a twelfth that comes and goes with
the open question, and one declarative tool, all running in the tab — no server, no model call, no tokens:

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
sentences, with a held-out phrasing set), 61 hand-written parse cases, a
fuzzer that builds 4,000 sentences nobody wrote, and a stand-in-`modelContext`
test of the tool surface run with `npm test`.

---

## 检查清单（提交前扫一眼）

- [ ] YouTube 是 **Public**，能在无痕窗口播放
- [ ] 视频链接填进表单
- [ ] 仓库地址填的是 `counterask-webmcp`（About 栏已显示 MIT）
- [ ] 线上地址能打开
- [ ] 四段说明都贴了
- [ ] 点了 **Submit**，页面显示已提交（不是草稿）

提交后：仓库、线上站、Devpost 条目都不要再动，直到 9 月 23 日左右公布结果。想继续开发就 fork。
