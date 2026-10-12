import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Catalog, decide, parseRequest, tokenize, POLICY } from '../public/engine.js';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bboot\(\);\s*$/, '');
const sandbox = { Catalog, decide, parseRequest, tokenize, POLICY, document: {getElementById:()=>({})} };
vm.runInNewContext(source + '\nrender = (decision) => { globalThis.rendered = decision; }; globalThis.app = api;', sandbox);
const api = sandbox.app;
api.state.catalog = new Catalog(JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));
api.search('belt under $30');
const eligible = api.state.scored[0].item.id;
const expensive = api.state.catalog.items.find((it) => it.p > 30).id;
assert.ok(api.showProducts([eligible, expensive]).error, 'curation must not bypass the price ceiling');
assert.equal(api.state.shown, null, 'rejected curation preserves existing grid');
api.showProducts([eligible, eligible]);
assert.equal(api.state.shown.length, 1, 'deduplicate curated products');
api.search('belt');
assert.ok(api.state.pending, 'fixture should open material question');
api.showProducts([api.state.scored[0].item.id]);
assert.equal(sandbox.rendered.action, 'ask', 'curation keeps the visible question consistent with pending state');
assert.equal(api.snapshot().status, 'need_more_evidence');
console.log('Curation passed: constraints preserved, duplicates removed, pending question stays visible.');
