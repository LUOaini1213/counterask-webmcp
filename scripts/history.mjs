// Rebuild the historical columns of the README from git history.
//
// The README compares the store before and after it learned to parse a
// sentence, and the attribute index before and after it was rebuilt. Those
// "before" engines are not in the current tree, so this script checks the
// old commits out into temporary worktrees and runs their own benchmarks:
//
//   keyword   97e9f51  the engine before the sentence parser, measured with
//                      the agent benchmark from 619981d (the commit that
//                      introduced both), exactly as that commit message reports
//   parser    619981d  the commit that added the parser: same 800 sentences,
//                      same catalogue build
//   preIndex  796b926  the last commit before the attribute index was rebuilt
//
//   node scripts/history.mjs          # write results/history.json
//   node scripts/history.mjs --check  # recompute, exit 1 if it differs
//
// It needs the full history (a shallow clone does not have these commits:
// `git fetch --unshallow` first). Each run starts a fresh node process inside
// the old tree, so no module state is shared between engines.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'results', 'history.json');

export const COMMITS = {
  keyword: '97e9f511bff82a14842d0174beb8b30b3e6d5a0f',
  parser: '619981dc1bda2a3b94575d580aab1afc8f24ab1e',
  preIndex: '796b926186fb143511230e4db21939d4a39d8eb5',
};

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function resolve(ref) {
  try { return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`); }
  catch {
    console.error(`commit ${ref} is not in this clone. Run \`git fetch --unshallow\` (or clone without --depth) and try again.`);
    process.exit(2);
  }
}

function withWorktree(sha, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'counterask-history-'));
  rmSync(dir, { recursive: true, force: true });
  git('worktree', 'add', '--detach', '--force', dir, sha);
  try { return fn(dir); }
  finally {
    git('worktree', 'remove', '--force', dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

// Run a snippet as an ES module inside the old tree and parse its JSON output.
function runIn(dir, code) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

// The text replacement must hit exactly once, or the old file is not the one
// this script was written against.
function patch(file, edits) {
  let s = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected one "${from}", found ${n}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s);
}

const AGENT = (holdout) => `
  const { agentBench } = await import('./scripts/agentbench.mjs');
  const r = agentBench({ n: 800${holdout ? ', holdout: true' : ''} });
  console.log(JSON.stringify({ summary: r.summary, listening: r.listening }));`;

const BENCH = `
  const { bench } = await import('./scripts/bench.mjs');
  console.log(JSON.stringify(bench({ n: 800 }).summary));`;

const COVERAGE = `
  import { readFileSync } from 'node:fs';
  const { Catalog } = await import('./public/engine.js');
  const cat = new Catalog(JSON.parse(readFileSync('public/data/catalog.json', 'utf8')));
  const pct = (f) => +(100 * cat.items.filter((i) => i.f[f]?.length).length / cat.items.length).toFixed(1);
  console.log(JSON.stringify(Object.fromEntries(['material', 'closure', 'occasion', 'fit', 'color'].map((f) => [f, pct(f)]))));`;

export function measure() {
  const sha = Object.fromEntries(Object.entries(COMMITS).map(([k, v]) => [k, resolve(v)]));
  const agentFromParser = git('show', `${sha.parser}:scripts/agentbench.mjs`);

  const keyword = withWorktree(sha.keyword, (dir) => {
    // The pre-parser bench.mjs keeps its helpers private; the agent benchmark
    // from 619981d imports three of them. Export them, unchanged otherwise.
    patch(join(dir, 'scripts', 'bench.mjs'), [
      ['\nfunction mulberry32(', '\nexport function mulberry32('],
      ['\nfunction queryFor(item, rng) {', '\nexport function queryFor(item, rng, catalog = cat) {'],
      ['cat.postings.get(t)', 'catalog.postings.get(t)'],
      ['\nfunction answerAs(', '\nexport function answerAs('],
    ]);
    writeFileSync(join(dir, 'scripts', 'agentbench.mjs'), agentFromParser);
    return { commit: sha.keyword, agentbench_800: runIn(dir, AGENT(false)) };
  });

  const parser = withWorktree(sha.parser, (dir) => (
    { commit: sha.parser, agentbench_800: runIn(dir, AGENT(false)) }));

  const preIndex = withWorktree(sha.preIndex, (dir) => ({
    commit: sha.preIndex,
    bench_800: runIn(dir, BENCH),
    agentbench_800: runIn(dir, AGENT(false)),
    agentbench_800_holdout: runIn(dir, AGENT(true)),
    coverage_pct: runIn(dir, COVERAGE),
  }));

  return {
    generated_by: 'node scripts/history.mjs',
    note: 'keyword = the engine at 97e9f51 run with the agent benchmark from 619981d; parser = 619981d; preIndex = 796b926, the last commit before the attribute index rebuild. Seeded (2026), 800 targets.',
    keyword, parser, preIndex,
  };
}

if (process.argv[1]?.endsWith('history.mjs')) {
  const fresh = measure();
  const text = JSON.stringify(fresh, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (committed !== text) {
      console.error('results/history.json does not match a fresh run of the historical commits. Re-run `node scripts/history.mjs` and review the diff.');
      process.exitCode = 1;
    } else console.log('history ok: results/history.json matches the historical commits');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
