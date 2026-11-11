// Fail if a tracked text file carries a local machine path or a path into a
// sibling checkout that readers of this repository cannot follow.
//
//   node scripts/hygiene_check.mjs
//
// The product catalogue is excluded: it is third-party product text.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['public/data/catalog.json', 'scripts/hygiene_check.mjs']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp3|mp4|wav|woff2?|ttf|pdf|zip|gz)$/i;

export const PATTERNS = [
  [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`]+/, 'Windows user profile path'],
  [/%LOCALAPPDATA%|\$env:LOCALAPPDATA|AppData[\\/]+Local/i, 'Windows per-user AppData path'],
  [/(^|[\s'"`(])\/home\/[a-z_][\w.-]*\//, 'Linux home directory path'],
  [/(^|[\s'"`(])\/Users\/[A-Za-z][\w.-]*\//, 'macOS home directory path'],
  [/scratchpad[\\/]/i, 'session scratchpad path'],
  [/\.\.[\\/]+techjam-conversational-search/, 'path into a sibling private checkout'],
];

export function scan(files, read) {
  const hits = [];
  for (const f of files) {
    if (SKIP.has(f) || BINARY.test(f)) continue;
    const lines = read(f).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [re, what] of PATTERNS) if (re.test(line)) hits.push(`${f}:${i + 1}: ${what}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

if (process.argv[1]?.endsWith('hygiene_check.mjs')) {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = scan(files, (f) => readFileSync(join(ROOT, f), 'utf8'));
  for (const h of hits) console.error(`FAIL: ${h}`);
  if (hits.length) process.exitCode = 1;
  else console.log(`hygiene ok: no local paths in ${files.length} tracked files`);
}
