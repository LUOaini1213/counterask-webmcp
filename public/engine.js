// Counterask retrieval and stopping policy.
//
// Everything here runs in the tab. No server, no model call, no token spend:
// a shopper's phrasing never leaves the page, and an agent that drives the
// store gets the same answers a person does, from the same code path.
//
// The interesting part is decide(). Most storefronts answer every query.
// This one works out whether answering is the best move it has, and when it
// isn't, it hands back the question worth asking instead.

// Words that carry no product meaning. Note what is *not* here: "shirt",
// "shoe", "belt". An earlier version stopped-out "shirt" as too common, which
// made "t-shirt" tokenize to nothing at all and quietly return the entire
// catalog ranked by popularity. A word being frequent is what IDF is for.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'this', 'that', 'from',
  'are', 'was', 'will', 'can', 'has', 'have', 'all', 'any', 'not', 'but',
  'men', 'mens', "men's", 'size', 'sizes', 'made', 'great', 'perfect',
  'quality', 'need', 'want', 'looking', 'find', 'some', 'something', 'would',
  'like', 'please', 'best', 'new', 'top',
  // Words an agent's sentence carries and a title never does.
  'show', 'recommend', 'suggest', 'get', 'buy', 'shop', 'hey', 'hello',
  'thanks', 'really', 'very', 'just', 'maybe', 'ideally', 'preferably',
  'under', 'over', 'around', 'about', 'between', 'than', 'less', 'more',
  'least', 'most', 'budget', 'dollar', 'dollars', 'bucks', 'usd', 'price',
  'one', 'ones', 'thing', 'things', 'stuff', 'kind', 'type', 'sort', 'option',
  'options', 'item', 'items', 'product', 'products', 'version',
  'what', 'whats', 'which', 'how', 'where', 'there', 'here', 'them', 'they',
  'him', 'his', 'her', 'its', 'okay', 'yeah', 'thanks', 'without', 'dont', 'don',
]);

// Shoppers type plurals; catalogues are written in the singular, and vice
// versa. "chinos" returned nothing at all until this existed.
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes'))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  const raw = (text || '').toLowerCase();
  const out = new Set();

  // Hyphenated and apostrophised compounds carry meaning as a unit *and* as
  // parts: "t-shirt" has to survive as "tshirt" and as "shirt", because the
  // catalogue writes it both ways.
  for (const compound of raw.match(/[a-z0-9]+(?:[-'][a-z0-9]+)+/g) ?? []) {
    const joined = compound.replace(/[-']/g, '');
    if (joined.length > 2) out.add(stem(joined));
  }
  for (const word of raw.match(/[a-z0-9]+/g) ?? []) {
    if (word.length <= 2 || STOP.has(word)) continue;
    out.add(stem(word));
  }
  return [...out];
}

// --- what a sentence says ------------------------------------------------

const escapeRe = (t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

// Whole-word match for a surface form, tolerant of the endings people add —
// "buttons", "laced", "washable" — and of nothing else, or "snap" fires on
// "snapback".
function formRegex(form) {
  return new RegExp(`(^|[^a-z])(${escapeRe(form)})(?:s|es|ed|d|able|ing)?(?=[^a-z]|$)`, 'g');
}

// Every place a facet value is spelled out in the text, longest form first,
// so "leather sole" is read as a sole and not as a material plus a sole.
// `extra` adds wording the builder deliberately does not record; see ALSO.
function findForms(text, facetValues, facetForms, extra = null) {
  const found = [];
  for (const [facet, values] of Object.entries(facetValues)) {
    // Only facets with a curated surface-form vocabulary may be read out of
    // free text. The category tree has none: its leaves include bare words
    // like "active" and "casual", so "active gym" was once read as
    // kind="active" and filtered away a target whose kind is "active shorts"
    // — pool 7 to 0. Safe to *ask* about, unsafe to infer.
    if (!facetForms?.[facet]) continue;
    for (const value of values) {
      const forms = [...(facetForms[facet][value] ?? [value]), ...(extra?.[facet]?.[value] ?? [])];
      for (const form of forms) {
        const re = formRegex(form);
        let m;
        while ((m = re.exec(text))) {
          const at = m.index + m[1].length;
          found.push({ facet, value, at, end: at + m[0].length - m[1].length });
        }
      }
    }
  }
  found.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
  const keep = [];
  for (const f of found) {
    if (keep.some((t) => f.at < t.end && t.at < f.end)) continue;
    keep.push(f);
  }
  return keep.sort((a, b) => a.at - b.at);
}

// Attributes the shopper already stated, lifted straight out of their words.
//
// Without this the store treats "waterproof hiking boots" as three keywords
// and can then turn around and ask whether it should be waterproof. Anything
// they have already said is a constraint, not a search term to be weighed.
// A shopper says "waterproof"; the catalog records "water resistant", so
// every surface form the builder mapped onto a value is matched, whole words
// only — "casual" must not fire on "casualwear".
export function extractConstraints(query, facetValues, facetForms = null) {
  const found = {};
  for (const f of findForms(` ${(query || '').toLowerCase()} `, facetValues, facetForms)) {
    const list = (found[f.facet] ??= []);
    if (!list.includes(f.value)) list.push(f.value);
  }
  return found;
}

// A search box gets "leather belt". An agent relaying a person gets "I'm
// looking for a leather belt, nothing with a snap, under $30". Fed to a
// keyword matcher that sentence does three wrong things at once: it requires
// "looking" and "under" to appear in a title, it reads "snap" as a requirement
// rather than a refusal, and it never sees the budget at all. Measured on 800
// such sentences (scripts/agentbench.mjs) before this existed: every refusal
// was inverted into a requirement, 71% of refused values showed up in the top
// ten anyway, 31% of budgets were broken there, and Hit@10 fell from 0.996 to
// 0.793 on phrasing alone.
//
// parseRequest takes the sentence apart in a fixed order — budget, sort,
// refusals, stated attributes, filler — blanking each span it claims, so a
// word read one way is never read again another way. What is left is the
// product description, which is what the ranker wanted all along.

const AMOUNT = String.raw`(?<![a-z0-9.,])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![a-z0-9]|[,.]\d)(?!\s*(?:mm|cm|inch|inches|in\b|ft|feet|oz|lbs?|kg|ml|pack|packs|pairs?|pcs|pieces?|count|ct|x\b|"|”|%))`;
const MONEY = String.raw`\$?\s?${AMOUNT}\s?(?:dollars?|bucks|usd)?`;
const MARKED = String.raw`(?:\$\s?${AMOUNT}|${AMOUNT}\s?(?:dollars?|bucks|usd))`;
const amount = (value) => Number(value.replace(/,/g, ''));
const near = (n) => ({ min: Math.floor(n * 0.75), max: Math.ceil(n * 1.25) });
const BUDGET_RULES = [
  [String.raw`\b(?:between|from)\s+${MONEY}\s*(?:and|to|-|–)\s*${MONEY}`, (a, b) => ({ min: amount(a), max: amount(b) })],
  [String.raw`\$\s?${AMOUNT}\s?(?:-|–|to)\s?\$?\s?${AMOUNT}`, (a, b) => ({ min: amount(a), max: amount(b) })],
  [String.raw`\b${AMOUNT}\s?(?:-|–|to)\s?${AMOUNT}\s?(?:dollars|bucks|usd)\b`, (a, b) => ({ min: amount(a), max: amount(b) })],
  // Read negated comparisons before their positive fragments: "not under"
  // must not be claimed by the later "under" rule and become a ceiling.
  [String.raw`\b(?:no more than|not more than|not over|not above)\s+${MONEY}`, (a) => ({ min: null, max: amount(a) })],
  [String.raw`\b(?:no less than|not less than|not under|not below)\s+${MONEY}`, (a) => ({ min: amount(a), max: null })],
  [String.raw`\b(?:under|below|less than|cheaper than|lower than|up to|at most|max(?:imum)?(?: of)?|within|budget(?: is| of)?|capped at)\s+${MONEY}`, (a) => ({ min: null, max: amount(a) })],
  [String.raw`\b(?:over|above|more than|at least|min(?:imum)?(?: of)?|starting (?:at|from)|upwards of)\s+${MONEY}`, (a) => ({ min: amount(a), max: null })],
  [String.raw`\b(?:have|got)\s+${MONEY}\s+to spend\b`, (a) => ({ min: null, max: amount(a) })],
  [String.raw`${MONEY}\s+to spend\b`, (a) => ({ min: null, max: amount(a) })],
  [String.raw`\b(?:have|got|spend|spending|pay|paying)\s+(?:about |around |up to )?${MARKED}`, (a, b) => ({ min: null, max: amount(a ?? b) })],
  [String.raw`\b(?:around|about|approximately|roughly|close to|near)\s+${MONEY}`, (a) => near(amount(a))],
  [String.raw`${MONEY}\s+(?:or less|or under|or below|or cheaper|max|maximum|tops|at most|budget)\b`, (a) => ({ min: null, max: amount(a) })],
  [String.raw`${MONEY}\s+(?:or more|or above|or over|minimum|at least|and up)\b`, (a) => ({ min: amount(a), max: null })],
  [String.raw`${MARKED}`, (a, b) => near(amount(a ?? b))],
].map(([re, fn]) => [new RegExp(re), fn]);

const SORT_RULES = [
  [/\b(?:cheapest|lowest price|least expensive|cheap(?:er)?|inexpensive|affordable|budget[- ]friendly|on a budget|low[- ]cost)\b/, 'price_asc'],
  [/\b(?:most expensive|priciest|premium|high[- ]end|luxury|top of the line)\b/, 'price_desc'],
  [/\b(?:best|highest|top)[- ]rated|best reviews?|highest rating\b/, 'rating'],
  [/\b(?:most popular|best[- ]sell(?:ing|er)|most reviewed|popular)\b/, 'popular'],
];

// "not", and everything a person says instead of "not". "non" is absent on
// purpose: "non-slip", "non-iron" name a feature, they refuse nothing. A bare
// "don't" is absent too — a PUMA shoe is titled "Don't Run Out Of Steam" —
// only "don't want", "doesn't have" and their kin refuse what follows.
const NEG_CUE = /\b(?:not|no|without|except(?:ing)?|excluding|avoid(?:ing)?|nothing|never|minus|sans|isn't|aren't|isnt|arent|(?:don't|dont|do not|wouldn't|wouldnt|would not) (?:want|need|like|care for|fancy)|(?:doesn't|doesnt|does not) (?:have|come with|need)|(?:shouldn't|shouldnt|should not|can't|cant|cannot|mustn't|must not) (?:be|have|come with)|anything but|other than|rather than|instead of|skip(?: the)?|leave out(?: the)?)\b/g;

// "no" bound to a feature name, hyphen or not: no-show socks, no-iron shirts.
const NO_FEATURE = new Set(['show', 'iron', 'tie', 'slip', 'sweat', 'wrinkle']);

// Wording people use for a value the builder records under a stricter name.
// The builder matches substrings, so it cannot list "snap" (it would fire on
// "snapback") or "lace" ("shoelace"); a whole-word matcher can. Used for
// refusals only. A positive "snap belt" stays a search term, because turning
// it into a filter would drop every snap belt whose listing never spelled out
// "snap closure" — a requirement can only be as complete as the record. A
// refusal is the safe direction: dropping what is *recorded* as snap is never
// wrong, only partial, and the refused word itself is banned from titles too.
const ALSO = {
  closure: {
    snap: ['snap', 'snaps'],
    'lace-up': ['laces', 'lace', 'shoelaces', 'lace-ups', 'laced'],
    zipper: ['zip', 'zips', 'zippered'],
  },
  fit: {
    'slim fit': ['slim', 'skinny', 'fitted'],
    'relaxed fit': ['relaxed', 'loose', 'baggy'],
  },
};

// "Any material is fine", "fit doesn't matter": a facet the person has
// waved through. Reported as no-preference so the store never asks about it
// — a question about something the shopper just said they do not mind reads
// as not listening, exactly like a question about something they stated.
const FACET_WORDS = {
  material: ['material', 'materials', 'fabric', 'fabrics'],
  closure: ['closure', 'closures', 'fastening', 'fastener', 'fasteners'],
  sleeve: ['sleeve length', 'sleeves', 'sleeve'],
  fit: ['fit', 'cut'],
  care: ['care instructions', 'washing', 'care'],
  origin: ['origin', 'country of origin', "where it's made", 'where it is made'],
  sole: ['sole', 'soles'],
  occasion: ['occasion', 'occasions'],
  pocket: ['pockets', 'pocket'],
  kind: ['kind', 'category', 'type', 'style'],
  color: ['color', 'colour', 'colors', 'colours', 'shade'],
};
const FACET_WORD = Object.entries(FACET_WORDS)
  .flatMap(([facet, words]) => words.map((w) => [w, facet]))
  .sort((a, b) => b[0].length - a[0].length);
const WORD = `(${FACET_WORD.map(([w]) => escapeRe(w)).join('|')})`;
const NOPREF = [
  String.raw`\b(?:any|whatever|either)\s+(?:kind of\s+|sort of\s+|type of\s+)?WORD\s+(?:is fine|is ok|is okay|works|will do|would do|is good)\b`,
  String.raw`\b(?:i )?(?:don't|dont|do not|doesn't|does not) (?:care|mind) (?:about |what |which |the )?(?:the )?WORD\b`,
  String.raw`\b(?:the )?WORD (?:doesn't|doesnt|does not|don't|dont) matter\b`,
  String.raw`\bno preference (?:on|for|about|regarding|as to) (?:the )?WORD\b`,
  String.raw`\b(?:not (?:fussy|bothered|picky|particular)|open|flexible|easy) (?:about|on|regarding) (?:the )?WORD\b`,
  String.raw`\b(?:any|whatever) WORD\b(?! of\b)`,
].map((re) => new RegExp(re.replace('WORD', WORD), 'g'));

const FILLER = [
  // "I don't care about the brand": whatever the noun, the phrase is not a
  // requirement. Facets are caught above, before this runs.
  /\b(?:i )?(?:don't|dont|do not) (?:care|mind) (?:about |which |what )?(?:the )?[a-z]+\b/g,
  /\b(?:i'?m|i am|we'?re|we are)\s+(?:looking|searching|shopping|hunting)\s+for\b/g,
  /\b(?:looking|searching|shopping|hunting)\s+for\b/g,
  /\b(?:i|we)\s+(?:need|want|would like|'d like|am after|require|could use)\b/g,
  /\b(?:can|could|would|will) you\s+(?:please\s+)?(?:find|show|recommend|suggest|get|help me find)(?: me| us)?\b/g,
  /\b(?:find|show|get|recommend|suggest|give)\s+(?:me|us)\b/g,
  /\bdo you (?:have|sell|carry|stock)\b/g,
  /\b(?:please|thanks|thank you|hey|hi|hello)\b/g,
  /\bfor (?:my|a|the|his) (?:brother|dad|father|son|husband|boyfriend|friend|partner|uncle|grandpa|grandfather|nephew|colleague|coworker|boss|him|himself)(?:'s)?\b/g,
  /\b(?:as a |for a |for his |for my )?(?:birthday|christmas|anniversary|graduation|father'?s day|wedding)(?: gift| present)?\b/g,
  /\b(?:as a )?(?:gift|present) for\b/g,
  /\b(?:something|anything|some|a few|a couple of|a pair of|pair of)\b/g,
  /\b(?:that is|that's|which is|ones? that (?:is|are)|you have|you've got|you sell|you carry|in stock|ones?)\b/g,
  /\b(?:what about|how about|any chance (?:you have|of)|help me (?:pick|find|choose)|would be (?:great|nice|perfect)|ideally|if possible)\b/g,
];

// "for work" is not a search for the word "work". A setting the shopper
// mentions is turned into ranking hints — words that lift products written for
// that setting — and never into a filter, because the catalogue does not
// record settings and a filter can only be as complete as the record.
const CONTEXT = [
  [/\bfor (?:work|the office|business|meetings)\b/g, 'business formal office'],
  [/\bfor (?:a |the )?(?:wedding|funeral|interview|graduation|party)\b/g, 'formal dress'],
  [/\bfor (?:the )?(?:weekend|everyday|every day|daily wear|lounging around)\b/g, 'casual'],
  [/\bfor (?:the )?(?:beach|pool|swimming)\b/g, 'beach swim'],
  [/\bfor (?:the )?(?:winter|cold weather|snow)\b/g, 'winter warm thermal'],
  [/\bfor (?:the )?(?:summer|hot weather)\b/g, 'summer lightweight breathable'],
  [/\bfor (?:travel|traveling|travelling|a trip|flights?)\b/g, 'travel'],
  [/\bfor (?:school|college|campus)\b/g, 'casual'],
];

export function parseRequest(text, catalog) {
  let s = ` ${(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  const out = {
    constraints: {}, exclude: {}, excludeTerms: [], budget: null, sort: 'relevance',
    optional: [], ignored: [], conflicts: [], noPreference: [], claims: [],
  };
  // Retain why a word was banned, so resolving a facet conflict does not
  // leave its companion word ban active or erase an independent refusal.
  const termSources = new Map();
  const ban = (word, source = null) => {
    if (!termSources.has(word)) termSources.set(word, new Set());
    termSources.get(word).add(source);
  };
  const facetSource = (facet, value) => `${facet}\0${value}`;
  // Every span a pass takes is recorded with the words it took, so the
  // reading can be audited: "budget took 'under $40', refusal took 'not
  // leather'". Idea borrowed from the parallel implementation on the
  // cuizi-rewrite branch.
  let pass = 'budget';
  const blank = (at, end) => {
    const said = s.slice(at, end).replace(/\s+/g, ' ').trim();
    if (said) out.claims.push({ pass, said });
    s = `${s.slice(0, at)}${' '.repeat(end - at)}${s.slice(end)}`;
  };

  // What the person waved through, before anything else can read the words.
  pass = 'no preference';
  for (const re of NOPREF) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const facet = FACET_WORD.find(([w]) => w === m[1])?.[1];
      if (facet && !out.noPreference.includes(facet)) out.noPreference.push(facet);
      blank(m.index, m.index + m[0].length);
      re.lastIndex = m.index + 1;
    }
  }

  pass = 'budget';
  // Budget first: "not over $50" is a ceiling, not a refusal.
  for (const [re, fn] of BUDGET_RULES) {
    let m;
    while ((m = re.exec(s))) {
      const next = fn(...m.slice(1));
      const previous = out.budget ?? { min: null, max: null };
      out.budget = {
        min: next.min == null ? previous.min : previous.min == null ? next.min : Math.max(previous.min, next.min),
        max: next.max == null ? previous.max : previous.max == null ? next.max : Math.min(previous.max, next.max),
      };
      blank(m.index, m.index + m[0].length);
    }
  }
  if (out.budget?.min != null && out.budget?.max != null && out.budget.min > out.budget.max) {
    out.budgetConflict = { ...out.budget, reason: 'Minimum price exceeds maximum price.' };
  }
  pass = 'ordering';
  for (const [re, sort] of SORT_RULES) {
    let m;
    while ((m = re.exec(s))) {
      // "Not cheap belt" requests no positive ordering. Claim the negated
      // adjective together with its cue, before a refusal can consume "belt".
      const prefix = s.slice(0, m.index);
      const cue = [...prefix.matchAll(new RegExp(NEG_CUE.source, 'g'))].at(-1);
      const negated = cue && /^\s+(?:(?:a|an|the|too|very|really)\s+)*$/.test(prefix.slice(cue.index + cue[0].length));
      if (negated) {
        pass = 'ordering refusal';
        blank(cue.index, m.index + m[0].length);
        pass = 'ordering';
        continue;
      }
      if (out.sort === 'relevance') out.sort = sort;
      blank(m.index, m.index + m[0].length);
    }
  }

  // Settings, before refusals can read "for work" as words to ban. A
  // negated setting ("not for work") is left for the refusal pass.
  pass = 'setting';
  const hints = [];
  for (const [re, hint] of CONTEXT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (/\b(?:not|no|never|isn't|aren't|nothing)\s+$/.test(s.slice(0, m.index))) continue;
      blank(m.index, m.index + m[0].length);
      if (!hints.includes(hint)) hints.push(hint);
    }
  }

  // Refusals. A cue opens a window — two words for "no", which binds tightly
  // ("no laces, leather"), five for "not" and "without", which take a phrase
  // — closed early by punctuation, a dash, "and"/"but", or the next cue. A facet value spelled
  // out inside it is excluded; every other word in it is banned from titles,
  // which is what makes "not nike" and "no hood" work with no vocabulary at
  // all. A multi-word value that starts inside the window is taken whole, so
  // "no big and tall" is not cut at its own "and".
  pass = 'refusal';
  NEG_CUE.lastIndex = 0;
  let cue;
  while ((cue = NEG_CUE.exec(s))) {
    const from = cue.index + cue[0].length;
    if (s[from] === '-') continue;                          // no-show, non-iron
    const tail = s.slice(from);
    const lead = tail.length - tail.trimStart().length;
    const ext = tail.trimStart().split(' ').slice(0, 7).join(' ');
    const first = ext.split(' ')[0] ?? '';
    const limit = cue[0] === 'no' ? 2 : 5;
    const stop = ext.search(/[,.;!?—–]|\s-\s|\s(?:and|(?<!anything\s)but)\s|\s(?:not|no|nothing|without|except|excepting|excluding|avoid|avoiding|never|minus|sans|skip|leave|anything|other|rather|instead|don't|dont|doesn't|doesnt|shouldn't|shouldnt|can't|cant|cannot|mustn't|isn't|aren't|isnt|arent|wouldn't|wouldnt)\s/);
    let win = (stop === -1 ? ext : ext.slice(0, stop)).split(' ').slice(0, limit).join(' ');
    const clause = win.slice(1).search(/\s(?:for|to|so|because|since|as|when|if|while)\s/);
    if (clause !== -1) win = win.slice(0, clause + 1);

    const hits = findForms(ext, catalog.facetValues, catalog.facetForms, ALSO)
      .filter((h) => h.at < win.length);
    // "no iron", "no slip" name a feature — unless the words are a value the
    // catalogue knows: "no slip on" refuses slip-ons. The fuzzer found the
    // collision once the rebuilt index had a slip-on value.
    if (cue[0] === 'no' && NO_FEATURE.has(first) && !hits.some((h) => h.at === 0)) continue;
    let rest = win;
    for (const h of hits) {
      const end = Math.min(h.end, rest.length);
      rest = `${rest.slice(0, h.at)}${' '.repeat(end - h.at)}${rest.slice(end)}`;
    }
    const words = tokenize(rest).filter((t) => catalog.postings.has(t));
    if (!hits.length && !words.length) continue;
    for (const word of words) ban(word);
    for (const h of hits) {
      const list = (out.exclude[h.facet] ??= []);
      if (!list.includes(h.value)) list.push(h.value);
      // The refused word itself is banned from titles too, so "no laces"
      // also drops a boot the catalogue never recorded as lace-up but whose
      // title says so. Single words only: banning "big" and "tall" for "no
      // big and tall" would take a Big Logo hoodie with them, and "short-sleeve"
      // would take every sleeve.
      const span = ext.slice(h.at, h.end).trim();
      if (/^[a-z]+$/.test(span)) {
        for (const word of tokenize(span).filter((t) => catalog.postings.has(t))) ban(word, facetSource(h.facet, h.value));
      }
    }
    const endRel = Math.max(win.length, ...hits.map((h) => h.end));
    blank(cue.index, from + lead + endRel);
    NEG_CUE.lastIndex = from + lead + endRel;
  }

  // Stated attributes. The words stay in the query — "running" still ranks
  // running shoes above other athletic shoes — but they are reported as
  // optional, so the title is not required to repeat what the filter already
  // guarantees. Requiring it shrank "something for the gym" from every
  // athletic item to the 48 whose title happens to say "gym".
  // Keeping product-type words ("running") required while the rest went
  // optional was tried against the rebuilt catalogue and measured worse on
  // every run (keyword Hit@1 -0.009, agent Hit@10 -0.003): the pool it kept
  // out was mostly the right products under other titles.
  for (const h of findForms(s, catalog.facetValues, catalog.facetForms)) {
    const list = (out.constraints[h.facet] ??= []);
    if (!list.includes(h.value)) list.push(h.value);
    out.claims.push({ pass: 'stated', said: s.slice(h.at, h.end).trim(), as: `${h.facet} = ${h.value}` });
    for (const t of tokenize(s.slice(h.at, h.end))) if (!out.optional.includes(t)) out.optional.push(t);
  }

  // "running shoes, but not for the gym": both words map to the one value
  // this vocabulary has. The requirement is kept, the refusal is reported
  // back rather than silently emptying the pool.
  for (const [facet, values] of Object.entries(out.exclude)) {
    const clash = values.filter((v) => out.constraints[facet]?.includes(v));
    for (const value of clash) {
      out.conflicts.push({ facet, value });
      for (const sources of termSources.values()) sources.delete(facetSource(facet, value));
    }
    const left = values.filter((v) => !clash.includes(v));
    if (left.length) out.exclude[facet] = left; else delete out.exclude[facet];
  }
  out.excludeTerms = [...termSources].filter(([, sources]) => sources.size).map(([word]) => word);

  for (const re of FILLER) s = s.replace(re, ' ');

  for (const hint of hints) {
    s += ` ${hint}`;
    for (const t of tokenize(hint)) if (!out.optional.includes(t)) out.optional.push(t);
  }

  out.query = s.replace(/ +/g, ' ').replace(/( *[,;] *)+/g, ', ')
    .replace(/^[ ,]+|[ ,]+$/g, '');
  out.ignored = tokenize(out.query).filter((t) => !catalog.postings.has(t));
  return out;
}

export class Catalog {
  constructor(payload) {
    this.meta = payload.meta;
    this.facetValues = payload.facetValues;
    this.facetForms = payload.facetForms ?? null;
    this.items = payload.items;
    this.byId = new Map(this.items.map((it) => [it.id, it]));

    // Both sides of the match go through the same stemmer. Doing it here
    // rather than in the build script is deliberate: one stemmer, one file,
    // so a query token and an index token can never be normalised differently.
    this.postings = new Map();
    const add = (tok, i) => {
      let list = this.postings.get(tok);
      if (!list) this.postings.set(tok, (list = []));
      if (list[list.length - 1] !== i) list.push(i);
    };

    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      // Tokenize the title here, with the very function queries go through.
      // The build script's own tokenizer split "V-Neck T-Shirt" into neck and
      // shirt while this one also yields vneck and tshirt, so a product could
      // be missing from the results for a query written out of its own title.
      // Moving the stemmer over was not enough; the split has to match too.
      const terms = new Set(tokenize(it.t));
      // Attribute evidence is searchable too. "waterproof hiking boots" should
      // find a boot the catalogue only calls waterproof in its bullet points,
      // not just one that spells it out in the title.
      for (const vals of Object.values(it.f)) {
        for (const v of vals) for (const w of tokenize(v)) terms.add(w);
      }
      it.terms = terms;
      it.idx = i;
      for (const t of terms) add(t, i);

      // The catalogue's own leaf category, promoted to a first-class askable
      // attribute. Every other facet is scraped out of marketing copy and
      // recorded on 7%-56% of products; this one is structural and present on
      // nearly all of them, which is exactly what the question-picker wants.
      // Injecting it as an ordinary facet rather than special-casing it means
      // filtering, gain, phrasing and the simulated shopper all work unchanged.
      // The whole path is recorded, shallow to deep — accessories / wallets,
      // card cases & money organizers / wallets — so the tree can be asked
      // about one level at a time (see splitKind) and a chosen node keeps
      // everything beneath it.
      const path = (it.c ?? []).filter(Boolean).map((x) => x.toLowerCase());
      if (path.length) (it.f ??= {}).kind = path;
    }
    this.N = this.items.length;
    this.avgLen = this.items.reduce((a, it) => a + it.terms.size, 0) / Math.max(this.N, 1);
    if (!this.meta.facets.includes('kind')) this.meta.facets = ['kind', ...this.meta.facets];
    this.facetValues = {
      kind: [...new Set(this.items.flatMap((it) => it.f.kind ?? []))].sort(),
      ...this.facetValues,
    };

    // The catalogue's own shelves. 184 of them, median 24 products, and until
    // now entirely unused: a shopper typing "sneaker" was matched against
    // titles while "Shoes / Fashion Sneakers" sat right there in the data.
    this.shelves = new Map();
    for (let i = 0; i < this.items.length; i++) {
      const path = (this.items[i].c ?? []).join(' / ');
      if (!path) continue;
      let shelf = this.shelves.get(path);
      if (!shelf) this.shelves.set(path, (shelf = { path, terms: new Set(tokenize(path)), items: [] }));
      shelf.items.push(i);
    }
  }

  /**
   * The shelf a query is asking for, if it is clearly asking for one.
   *
   * Restricting to a shelf is a hard narrowing, so it has to be earned: the
   * query must cover most of the shelf's own name, and the winner must be
   * clearly ahead of the next shelf, or a vague word drags the shopper into
   * the wrong aisle.
   */
  matchShelf(qTokens) {
    if (!qTokens.length) return null;
    const q = new Set(qTokens);
    const scores = [];
    for (const shelf of this.shelves.values()) {
      let hit = 0;
      for (const t of shelf.terms) if (q.has(t)) hit++;
      if (!hit) continue;
      // Cover the shelf name, and be covered by the query: "shoes" should not
      // win "Shoes / Athletic / Running" outright over plain "Shoes".
      const precision = hit / shelf.terms.size;
      const recall = hit / q.size;
      scores.push({ shelf, score: (2 * precision * recall) / (precision + recall) });
    }
    if (!scores.length) return null;
    scores.sort((a, b) => b.score - a.score || b.shelf.items.length - a.shelf.items.length);
    const best = scores[0];
    const runnerUp = scores[1]?.score ?? 0;
    if (best.score < 0.5) return null;
    return { ...best, margin: best.score - runnerUp, alternatives: scores.slice(1, 4) };
  }

  idf(token) {
    const df = this.postings.get(token)?.length ?? 0;
    return Math.log((this.N + 1) / (df + 1));
  }

  // Candidates matching every active constraint, scored against the free text.
  //
  // `optional` names the query words that were read as a stated attribute —
  // "leather" in "leather belt". The filter already guarantees the attribute,
  // so the title is not required to repeat the word: a belt whose listing says
  // leather only in its bullet points still qualifies. A title that does
  // repeat it still ranks higher.
  //
  // `shelf` selects how the catalogue's own category tree is used: not at all,
  // as a ranking bonus, or as a hard restriction. See SHELF_MODE.
  search(query, constraints = {}, {
    shelf = SHELF_MODE, exclude = {}, excludeTerms = [], budget = null,
    sort = 'relevance', optional = [],
  } = {}) {
    // A word no product carries cannot be a requirement. "interview" and
    // "brother" arrive in an agent's sentence and in no title; before this
    // they still counted toward the conjunction, which then never held, so
    // every such query fell through to the loose 60% floor.
    const qTokens = tokenize(query).filter((t) => this.postings.has(t));
    const opt = new Set(optional);
    const required = qTokens.filter((t) => !opt.has(t));
    const need = required.length;
    const facetKeys = Object.keys(constraints);
    const exKeys = Object.keys(exclude ?? {}).filter((f) => exclude[f]?.length);
    const banned = (excludeTerms ?? []).filter((t) => this.postings.has(t));
    const cap = budget && (budget.max != null || budget.min != null) ? budget : null;
    // No product, including an unpriced one, can satisfy an inverted range.
    if (cap?.min != null && cap?.max != null && cap.min > cap.max) return [];
    const shelfMatch = shelf === 'off' ? null : this.matchShelf(required);
    const shelfSet = shelfMatch ? new Set(shelfMatch.shelf.items) : null;

    // An attribute the shopper stated is a fact about what they will accept —
    // but only against products the catalogue actually describes. Three cases,
    // not two:
    //
    //   records it and matches   -> full credit
    //   records it and differs   -> a real mismatch, excluded
    //   does not record it       -> unknown, kept
    //
    // The old code collapsed the third into the second. With facets recorded on
    // as little as 7% of products, "leather" was throwing away every belt whose
    // listing simply never said what it was made of.
    const passes = (it) => {
      for (const facet of facetKeys) {
        const have = it.f[facet];
        if (!have?.length) return false;
        if (!constraints[facet].some((w) => have.includes(w))) return false;
      }
      // A refusal removes what is *recorded* as the refused value, and any
      // product whose own words carry the refused term. A listing that never
      // says what it is made of is not evidence that it is leather — the same
      // rule as above, read the other way.
      for (const facet of exKeys) {
        const have = it.f[facet];
        if (have?.length && exclude[facet].some((w) => have.includes(w))) return false;
      }
      for (const t of banned) if (it.terms.has(t)) return false;
      // Only a fifth of this catalogue carries a price. A budget can exclude a
      // product priced outside it; it cannot exclude one with no price at all.
      if (cap && typeof it.p === 'number') {
        if (cap.max != null && it.p > cap.max) return false;
        if (cap.min != null && it.p < cap.min) return false;
      }
      return true;
    };

    // BM25 length normalisation. Without it every product matching the same
    // words scored within a rounding error of every other — separation between
    // first place and tenth ran at a median of 0.015 — because the IDF sum is
    // identical across them and log-scaled popularity barely varies. Length is
    // the signal that separates them: a title that is *mostly* the shopper's
    // words is a better match than one mentioning them in passing among twenty
    // others. Term frequency in a title is effectively 1, so BM25's tf
    // saturation collapses to a constant; the length term does the work.
    const score = (it, hit, inReq) => {
      const dl = it.terms.size || 1;
      const norm = 1 - BM25_B + BM25_B * (dl / this.avgLen);
      let bm = 0;
      for (const tok of hit) bm += this.idf(tok) * ((BM25_K1 + 1) / (1 + BM25_K1 * norm));
      const coverage = need ? 0.5 + 0.5 * (inReq / need) : 1;
      let sc = bm * coverage + 0.35 * popularity(it);
      if (shelf === 'boost' && shelfSet?.has(it.idx)) sc *= 1.35;
      return sc;
    };

    if (!need) {
      // Nothing is required of the title: everything the shopper said was an
      // attribute the filter enforces, or a word no product carries. Every
      // product passing the filter is a candidate, ranked by how much of the
      // wording its own title repeats, then by demand.
      const hits = [];
      for (const it of this.items) {
        if (!passes(it)) continue;
        const hit = qTokens.filter((t) => it.terms.has(t));
        hits.push({ item: it, matched: hit, inReq: 0, full: hit.length === qTokens.length, score: score(it, hit, 0) });
      }
      return hits.sort(order(sort, cap));
    }

    // Only visit documents that contain at least one required term. Scanning
    // all 9,901 items per keystroke was pure waste — the postings list exists.
    const candidates = new Set();
    for (const tok of required) {
      for (const i of this.postings.get(tok) ?? []) candidates.add(i);
    }

    // A shelf restriction is only allowed to narrow, never to gut: "shorts"
    // matches a 4-item "Clothing / Shorts" shelf while 776 products are
    // genuinely shorts, so a restriction that would throw away almost
    // everything is refused rather than trusted.
    let restrictTo = null;
    if (shelf === 'restrict' && shelfSet) {
      let survivors = 0;
      for (const i of candidates) if (shelfSet.has(i)) survivors++;
      if (survivors >= 10 && survivors >= candidates.size * 0.15) restrictTo = shelfSet;
    }

    const hits = [];
    for (const i of candidates) {
      const it = this.items[i];
      if (restrictTo && !restrictTo.has(i)) continue;
      if (!passes(it)) continue;
      const hit = qTokens.filter((t) => it.terms.has(t));
      const inReq = hit.filter((t) => !opt.has(t)).length;
      if (inReq) hits.push({ item: it, matched: hit, inReq, full: hit.length === qTokens.length });
    }

    // Every word the shopper typed is a requirement, not a hint: "leather
    // belt" must not return more rows than "belt". So take the conjunction
    // first, and only relax when it would leave too little to choose from —
    // the same rule the filter stage uses on stated attributes.
    let keep = hits.filter((h) => h.inReq === need);
    if (keep.length < 8 && need > 1) {
      const floor = Math.max(1, Math.ceil(need * 0.6));
      keep = hits.filter((h) => h.inReq >= floor);
    }
    if (!keep.length) keep = hits;

    for (const h of keep) h.score = score(h.item, h.matched, h.inReq);
    return keep.sort(order(sort, cap));
  }
}

// BM25 constants. b controls how hard length is penalised; k1 saturates term
// frequency, which barely matters for titles where a word appears once.
const BM25_K1 = 1.2;

// Graded credit for products the catalogue never describes was built, measured
// and removed. The idea is right in general — silence is not refusal — and it
// is inert here for a structural reason: the facet extractor reads title,
// features and details together, so the index is a superset of anything a
// shopper could be quoting. Of 5,819 products whose *title* states an
// attribute, the number missing that attribute from the index is zero. Scoring
// them at partial credit moved the composite by +0.0004 and gave byte-identical
// results at credits of 0.10, 0.25, 0.45 and 0.70, which is the signature of a
// mechanism that never fires.
export let BM25_B = 0.5;
export function setBm25B(b) { BM25_B = b; }

// A frozen catalog has no click log, so demand is proxied by review volume.
// log-scaled, because the difference between 20 and 200 reviews means more
// than the difference between 20,000 and 20,200.
function popularity(it) {
  const n = it.n || 0;
  const r = it.r || 3.5;
  return (Math.log10(1 + n) / 5) * (r / 5);
}

// How the candidate list is ordered.
//
// Plain relevance is the score. Every *explicit* ordering — cheapest, best
// rated, under a budget — is an ordering of the answers, not of everything
// the words touch: products matching the whole request come first, then
// those matching every required word, and within a tier the requested order
// applies. Without the tiers "cheapest running shoes" led with a $16.99 pair
// of socks whose listing mentions shoe size.
//
// Under a budget, a product with a known in-budget price is a better answer
// than one whose listing never gave a price — prices exist for 20% of this
// catalogue, and "under 30 dollars" was showing $45.99 in third place — but
// again only within a tier: the first cut put every priced item first, and
// "wool sweater around $45" led with a $40.95 pair of socks.
function order(sort, budget) {
  const price = (h) => (typeof h.item.p === 'number' ? h.item.p : null);
  const byScore = (a, b) => b.score - a.score;
  if (sort === 'relevance' && !budget) return byScore;

  const tier = (a, b) => ((b.full ? 1 : 0) - (a.full ? 1 : 0))
    || ((b.inReq ?? 0) - (a.inReq ?? 0))
    || (budget ? ((price(b) != null) - (price(a) != null)) : 0);

  let key = byScore;
  if (sort === 'price_asc' || sort === 'price_desc') {
    const dir = sort === 'price_asc' ? 1 : -1;
    key = (a, b) => {
      const pa = price(a);
      const pb = price(b);
      if (pa == null || pb == null) return (pa == null) - (pb == null) || byScore(a, b);
      return dir * (pa - pb) || byScore(a, b);
    };
  } else if (sort === 'rating') {
    // Five stars from one reviewer is not a better rating than 4.8 from five
    // thousand. Shrink toward the catalogue-wide 3.5 by review count.
    const bayes = (h) => (((h.item.r || 0) * (h.item.n || 0)) + 3.5 * 20) / ((h.item.n || 0) + 20);
    key = (a, b) => bayes(b) - bayes(a) || byScore(a, b);
  } else if (sort === 'popular') {
    key = (a, b) => (b.item.n || 0) - (a.item.n || 0) || byScore(a, b);
  }
  return (a, b) => tier(a, b) || key(a, b);
}

// --- the stopping policy ------------------------------------------------

// What asking about a facet is actually worth: the share of the candidate
// pool the answer is expected to remove.
//
// Entropy is the textbook move here and it is wrong for this data, because a
// product carries several values of the same facet at once — a shoe is both
// "athletic" and "casual" — so the value shares do not form a distribution and
// -Σp·log p means nothing. Counting the expected survivors does work, needs no
// such assumption, and says something a shopper can read: answering this cuts
// the pool by about this much.
export function splitValue(pool, facet) {
  if (facet === 'kind') return splitKind(pool);
  const counts = new Map();
  let covered = 0;
  for (const it of pool) {
    const vals = it.f[facet];
    if (!vals?.length) continue;
    covered++;
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size < 2 || !pool.length) return { gain: 0, coverage: 0, counts };

  // Coverage is the trap here. A facet only 3% of the pool records would
  // "remove 97% of candidates" — but it removes them for having no data, not
  // for failing the shopper's requirement. Missing is not a mismatch, so the
  // reduction is measured inside the covered subset and then scaled by how
  // much of the pool that subset is.
  const coverage = covered / pool.length;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let expectedSurvivors = 0;
  for (const c of counts.values()) expectedSurvivors += (c / total) * c;

  const reduction = 1 - expectedSurvivors / covered;
  return { gain: Math.max(0, coverage * reduction), coverage, counts };
}

// The category tree, asked one level at a time.
//
// Measured against the leaf-only question it replaces (800 targets, oracle
// and menu-only shoppers): keyword Hit@1 +0.005, Hit@10 -0.001, agent
// sentences flat. A wash on the benchmarks; kept for the questions it
// produces and because a parent node ("shoes") now works as a filter.
// Scoring every other facet the same capped way was byte-identical on all
// four runs - their tails are too small to matter - so only this one does.
//
// A product's category is a path, and the whole path is recorded on it, so
// the pool can be split at any depth. Whatever nearly every candidate shares
// is an ancestor, not a question; below that, the shallowest level that
// actually splits the pool is the one to ask, because "shoes or oxfords?" is
// not a question anyone can answer. Once a node is chosen the filter keeps
// only products beneath it, the next level becomes the shallowest split, and
// the same code asks again. Products whose path stops above the level being
// asked cannot answer it; they count against coverage, the same way an
// unrecorded attribute does. Idea borrowed from the cuizi-rewrite branch.
function splitKind(pool) {
  const N = pool.length;
  const none = { gain: 0, coverage: 0, counts: new Map(), level: null, ancestor: null };
  if (!N) return none;

  // The deepest node nearly everyone shares, for phrasing the question.
  const share = new Map();
  const depthOf = new Map();
  let covered = 0;
  let maxDepth = 0;
  for (const it of pool) {
    const path = it.f.kind;
    if (!path?.length) continue;
    covered++;
    maxDepth = Math.max(maxDepth, path.length);
    path.forEach((v, i) => {
      share.set(v, (share.get(v) || 0) + 1);
      if (!depthOf.has(v) || i < depthOf.get(v)) depthOf.set(v, i);
    });
  }
  let ancestor = null;
  for (const [v, c] of share) {
    if (c >= 0.95 * covered && (ancestor === null || depthOf.get(v) > depthOf.get(ancestor))) ancestor = v;
  }

  // Level by level, shallowest first. A level where one node dominates
  // splits nothing worth a turn — a pool of belts is 95% "accessories" — so
  // the first level whose split clears enough is the one to ask; below the
  // bar, the best level is still reported so the policy can decline it.
  // Level by level. A question shows four options and "something else", so
  // a level is scored as it will be asked: the four biggest nodes and one
  // "other" bucket. A leaf level with forty small leaves scores badly — most
  // shoppers would answer "other" — and a level where one node dominates
  // scores badly too. The level that clears the most candidates wins; ties
  // go to the shallower one.
  // The candidate levels are each fixed depth, plus "leaf": every product's
  // own last node whatever its depth, which is what the catalogue's leaves
  // were before the tree existed and what a mixed-depth pool can always
  // answer. Products whose path stops above a fixed depth cannot answer at
  // that depth; they count against its coverage.
  let best = null;
  for (const d of [...Array(maxDepth).keys(), 'leaf']) {
    const counts = new Map();
    let atLevel = 0;
    for (const it of pool) {
      const path = it.f.kind;
      const v = d === 'leaf' ? path?.[path.length - 1] : path?.[d];
      if (v === undefined) continue;
      atLevel++;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size < 2) continue;
    const coverage = atLevel / N;
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const shown = sorted.slice(0, 4);
    const other = sorted.slice(4).reduce((a, b) => a + b, 0);
    let expectedSurvivors = 0;
    for (const c of [...shown, other]) expectedSurvivors += (c / atLevel) * c;
    const reduction = 1 - expectedSurvivors / atLevel;
    const result = { gain: Math.max(0, coverage * reduction), coverage, counts, level: d, ancestor };
    const ok = coverage >= POLICY.minCoverage;
    if (!best || (ok && !best.ok) || (ok === best.ok && result.gain > best.gain)) best = { ...result, ok };
  }
  if (!best) return { ...none, coverage: covered / N, ancestor };
  delete best.ok;
  return best;
}

// How far clear of the pack the leader is.
//
// The first version compared the top score with the runner-up. On this data
// that gap is almost always noise — median 0.003 across a 50-query sweep, and
// the "clear leader" branch fired once in fifty. Two near-identical products
// scoring within a rounding error of each other says nothing about whether the
// *leader* is distinctive; it says those two are twins.
//
// Comparing the leader with the tenth-placed candidate asks the question the
// policy actually cares about: is there one obvious answer here, or a crowd?
export function separation(scored) {
  if (scored.length < 2) return 1;
  const top = scored[0].score;
  if (top <= 0) return 0;
  const pack = scored[Math.min(9, scored.length - 1)].score;
  return Math.max(0, (top - pack) / top);
}

// How the category tree is used by default. Set from measurement, not taste:
// see scripts/shelf_ab.mjs.
export let SHELF_MODE = 'off';
export function setShelfMode(mode) { SHELF_MODE = mode; }

export const POLICY = {
  // Below this many candidates the shopper can just look at the list.
  answerBelow: 12,
  // How many products an answer shows.
  show: 12,
  // No decisiveSeparation. A "the leader is clear enough, stop asking" rule
  // was tried twice and failed twice. First against a separation metric that
  // compared first place with second, where the gap is noise: median 0.003,
  // and the branch fired once in fifty queries. Then again after BM25 length
  // normalisation moved that distribution 7.6x and made the metric real — at
  // which point the branch became measurably harmful, costing 0.0034 of
  // composite score (0.96194 at a threshold of 0.18 against 0.96535 with the
  // branch off). Stopping early on a confident-looking leader loses more than
  // it saves, so separation is now reported to the shopper and not acted on.
  // A question has to earn its turn, and a *proportion* cannot say whether it
  // has. Cutting 409 candidates to 213 is worth a turn; cutting 23 to 9 is
  // not, yet the second is the larger fraction. Tuning the ratio alone drove
  // the store to dump 409 running shoes while interrogating someone about a
  // 23-item sweater. So the bar is absolute — how many candidates the answer
  // is expected to remove — with the ratio kept only as a floor against
  // questions that barely separate anything.
  minRemoved: 10,
  minGain: 0.18,
  // Below this, the facet is too sparsely recorded to ask about: most of the
  // pool would be dropped for missing data rather than for not matching.
  minCoverage: 0.45,
  // Never ask more than this many times in one session.
  maxAsks: 3,
  // Value the strongest few questions by what they set up as well as what
  // they remove now. Built, measured (scripts/ab_lookahead.mjs, 800 targets,
  // oracle and menu-only shoppers) and left off: it saves 0.01 of a
  // question per session and moves Hit@1 by one or two targets in either
  // direction. The myopic choice is already the right question nearly
  // every time on this catalogue; there is little to set up.
  lookahead: 0,
  lookaheadWidth: 4,
};

/**
 * The whole point of Counterask.
 *
 * Returns either an answer (here are the products) or a question (this is the
 * one attribute worth knowing before I answer), plus the reasoning behind the
 * choice so both the shopper and the agent can see why.
 */
export function decide(catalog, scored, constraints, asksSoFar = 0, { declined = [] } = {}) {
  const pool = scored.map((s) => s.item);
  const sep = separation(scored);
  const answer = (reasons) => ({
    action: 'answer', pool, separation: sep, reasons,
    differentiators: differentiate(catalog, pool.slice(0, POLICY.show), constraints, declined),
  });

  const reasons = [];
  const enoughAlready = pool.length <= POLICY.answerBelow;
  const outOfBudget = asksSoFar >= POLICY.maxAsks;

  if (!pool.length) {
    return { action: 'empty', pool, reasons: ['No product matches every stated requirement.'] };
  }
  if (enoughAlready) reasons.push(`${pool.length} candidates left — small enough to show.`);
  if (outOfBudget) reasons.push(`Already asked ${asksSoFar} questions — answering now.`);

  if (enoughAlready || outOfBudget) {
    return answer(reasons);
  }

  // Evidence is thin. Find the question that would separate the pool most.
  const thin = [];
  const best = bestQuestion(catalog, pool, constraints, declined, { thin });

  if (!best || best.removed < POLICY.minRemoved || best.gain < POLICY.minGain) {
    reasons.push(best
      ? `Best question would only clear ~${Math.round(best.removed)} of ${pool.length} candidates — not worth a turn.`
      : 'No remaining question would meaningfully reorder these results.');
    return answer(reasons);
  }

  // Category leaves are written for a taxonomy, not for a sentence: "wallets,
  // card cases & money organizers" next to plain "wallets" reads as a repeat.
  // Label with the head of the name, keep the full value for filtering.
  const seen = new Set();
  const options = [];
  for (const [value, count] of [...best.counts.entries()].sort((a, b) => b[1] - a[1])) {
    const label = value.length <= 22 ? value : (value.split(/[,&]/)[0].trim() || value);
    if (seen.has(label)) continue;
    seen.add(label);
    options.push({ value, label, count });
    if (options.length === 4) break;
  }

  reasons.push(
    `${pool.length} candidates, leader only ${(sep * 100).toFixed(0)}% ahead.`,
    `Asking "${best.facet}" clears ~${Math.round(best.removed)} of them on average `
      + `(recorded on ${(best.coverage * 100).toFixed(0)}%)`
      + (best.followUp > 0 ? `, and sets up a follow-up worth ~${Math.round(best.followUp)} more.` : '.'),
  );
  for (const t of thin.slice(0, 2)) {
    reasons.push(`Not asking "${t.facet}": recorded on only ${(t.coverage * 100).toFixed(0)}% of these — it would remove products for having no data, not for failing.`);
  }

  // What the four options leave out: candidates recorded under some other
  // value, and candidates with no value recorded at all. The first is an
  // "or something else" the agent can put a number on; the second is what a
  // "no preference" keeps.
  const listed = new Set(options.map((o) => o.value));
  let others = 0;
  let unrecorded = 0;
  for (const it of pool) {
    const vals = it.f[best.facet];
    if (!vals?.length) unrecorded++;
    else if (!vals.some((v) => listed.has(v))) others++;
  }

  return {
    action: 'ask',
    facet: best.facet,
    options,
    others,
    unrecorded,
    pool,
    gain: best.gain,
    separation: sep,
    reasons,
    level: best.level ?? null,
    ancestor: best.ancestor ?? null,
    question: phrase(best.facet, options, best),
  };
}

// The question worth asking of this pool, if any: the facet whose answer is
// expected to remove the most candidates, subject to the coverage gate.
//
// With POLICY.lookahead on, the strongest few candidates are valued by what
// they remove now plus what the best follow-up question would remove from
// what each answer leaves — so a question that sets up a second good
// question can beat one that only narrows a little more now. The gates that
// decide whether to ask at all still look at the first step alone.
function bestQuestion(catalog, pool, constraints, declined, { lookahead = POLICY.lookahead, thin = null } = {}) {
  const candidates = [];
  for (const facet of catalog.meta.facets) {
    // Known already, or declined already. "No preference" used to be
    // forgotten the moment it was clicked, and the same question came
    // straight back: 12 re-asks in 800 simulated sessions.
    if (declined.includes(facet)) continue;
    // A chosen category can be asked about again, one level deeper.
    if (constraints[facet] && facet !== 'kind') continue;
    const { gain, coverage, counts, level = null, ancestor = null } = splitValue(pool, facet);
    if (coverage < POLICY.minCoverage) {
      // Too thinly recorded to ask about — but say so when it would
      // otherwise have looked like the strongest question, so the reader
      // sees why the store did not ask what they might expect.
      if (thin && counts.size >= 2 && coverage > 0) thin.push({ facet, coverage });
      continue;
    }
    // Rank candidate questions by candidates removed, not by share removed.
    const removed = gain * pool.length;
    candidates.push({ facet, gain, coverage, counts, removed, level, ancestor, followUp: 0 });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.removed - a.removed);
  if (!lookahead || pool.length <= POLICY.answerBelow) return candidates[0];
  let top = null;
  for (const c of candidates.slice(0, POLICY.lookaheadWidth)) {
    c.followUp = expectedFollowUp(catalog, pool, constraints, declined, c);
    const value = c.removed + c.followUp;
    if (!top || value > top.value) top = { ...c, value };
  }
  return top;
}

// What the best next question would remove, on average, from what this one
// leaves: over each answer the shopper might give, weighted by how many
// candidates give it, plus the shopper who has no such preference at all.
function expectedFollowUp(catalog, pool, constraints, declined, q) {
  const { facet, level } = q;
  const inBucket = (it, v) => {
    const vals = it.f[facet];
    if (!vals?.length) return false;
    if (facet !== 'kind') return vals.includes(v);
    return level === 'leaf' ? vals[vals.length - 1] === v : vals[level] === v;
  };
  const worth = (next) => (next && next.removed >= POLICY.minRemoved && next.gain >= POLICY.minGain ? next.removed : 0);
  let total = 0;
  for (const c of q.counts.values()) total += c;
  let expected = 0;
  for (const [v, c] of q.counts) {
    const sub = pool.filter((it) => inBucket(it, v));
    if (sub.length <= POLICY.answerBelow) continue;
    const next = bestQuestion(catalog, sub, { ...constraints, [facet]: [v] }, declined, { lookahead: 0 });
    expected += q.coverage * (c / total) * worth(next);
  }
  const none = 1 - q.coverage;
  if (none > 0) {
    const next = bestQuestion(catalog, pool, constraints, [...declined, facet], { lookahead: 0 });
    expected += none * worth(next);
  }
  return expected;
}

// What still separates the products the shopper is about to see.
//
// The store has just decided that no question is worth a turn. The agent
// presenting the list can still say "these differ mainly in closure — eight
// buckle, four snap", which is the difference between a list and an answer,
// and can offer to narrow without the store having to ask.
export function differentiate(catalog, shown, constraints = {}, declined = []) {
  const out = [];
  for (const facet of catalog.meta.facets) {
    if (declined.includes(facet)) continue;
    // A chosen category can be asked about again, one level deeper.
    if (constraints[facet] && facet !== 'kind') continue;
    const { gain, coverage, counts } = splitValue(shown, facet);
    if (coverage < POLICY.minCoverage || counts.size < 2) continue;
    const splits = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([value, count]) => ({ value, count }));
    out.push({ facet, gain, splits });
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, 2)
    .map(({ facet, splits }) => ({ facet, splits }));
}

function phrase(facet, options, ask = {}) {
  const list = options.map((o) => o.label ?? o.value).slice(0, 4).join(', ');
  const head = (v) => (v.length <= 22 ? v : (v.split(/[,&]/)[0].trim() || v));
  const q = {
    material: `What material are you after — ${list}?`,
    closure: `How should it fasten — ${list}?`,
    sleeve: `Which sleeve length — ${list}?`,
    fit: `What fit do you want — ${list}?`,
    care: `Any laundry preference — ${list}?`,
    origin: `Does origin matter — ${list}?`,
    sole: `What sole are you looking for — ${list}?`,
    occasion: `What is the occasion — ${list}?`,
    pocket: `Do you need ${list}?`,
    waterproof: `Should it be ${list}?`,
    color: `Which color — ${list}?`,
    kind: (() => {
      const h = ask.ancestor ? head(ask.ancestor) : null;
      const clashes = h && options.some((o) => (o.label ?? o.value) === h);
      return h && !clashes ? `Which kind of ${h} — ${list}?` : `Which category — ${list}?`;
    })(),
  }[facet];
  return q || `Which ${facet} — ${list}?`;
}
