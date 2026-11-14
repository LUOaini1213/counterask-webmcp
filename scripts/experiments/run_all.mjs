// Run every exploratory script once and fail if one throws.
//   node scripts/experiments/run_all.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run_all.mjs').sort();
let failed = 0;
for (const f of scripts) {
  const t = Date.now();
  try {
    execFileSync(process.execPath, [join(here, f)], { stdio: 'ignore', timeout: 300_000 });
    console.log(`ok   ${f} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${f}: ${e.message.split('\n')[0]}`);
  }
}
console.log(`${scripts.length - failed} / ${scripts.length} exploratory scripts ran`);
if (failed) process.exitCode = 1;
