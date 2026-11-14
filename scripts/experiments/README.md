# Exploratory scripts

One-off measurements made while tuning the engine. None of them is part of
`npm test`; several set `POLICY` fields or `setShelfMode('off')` before they
run, so their numbers describe the configuration they set up, not the shipped
one. They are kept because the README's design notes cite what they found.
`npm run experiments` runs each once to show they still execute against the
current engine.

| script | what it measures |
|---|---|
| `ask_value.mjs` | whether asking still helps now that the ranker is better (ask on vs off, two-word bench) |
| `bm25_ab.mjs` | BM25 length-normalisation `b` from 0 to 0.9: Hit@10, Hit@1, MRR and the separation median |
| `diag.mjs` | per-facet coverage and gain for four sample queries, and which facets the policy gates out |
| `dist.mjs` | separation percentiles and how many distinct attribute fingerprints a top 10 holds |
| `extract.mjs` | stated-attribute extraction on the 50 sample queries: pool size and ask/answer before and after |
| `frontier.mjs` | the two ask-cost knobs swept together: ask rate against Hit@10 and MRR |
| `frontier2.mjs` | `POLICY.minGain` sweep from 0.40 to 0.80 |
| `frontier3.mjs` | `POLICY.minRemoved` sweep from 20 to 130 |
| `joint.mjs` | BM25 `b` and the `decisiveSeparation` threshold re-fitted together (that rule was later removed from the engine, so its knob no longer has an effect) |
| `kind_ab.mjs` | whether the category leaf earns its place as an askable attribute |
| `patience.mjs` | how much to ask when the simulated shopper answers only some of the time |
| `price.mjs` | ask thresholds scored by TechJam Track 4's rule, 0.5·Hit@10 + 0.3·MRR + 0.2·efficiency |
| `redundant.mjs` | how often the store asks about something the query already stated, with and without extraction |
| `shelf_ab.mjs` | the three ways of using the category tree, A/B on Hit@1 and MRR |
