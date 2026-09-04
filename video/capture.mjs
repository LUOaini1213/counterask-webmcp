// Drive the live store in a real WebMCP browser and capture every scene.
//
// Chrome for Testing 152 must already be running with
// --remote-debugging-port=9222 and a profile whose Local State enables
// chrome://flags/#enable-webmcp-testing. See submission/video_plan.md.
//
//   node video/capture.mjs            # all scenes
//   node video/capture.mjs s3 s4      # only these
//
// Frames land in video/frames/<scene>/%05d.png at FPS, sized to the viewport.

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const PORT = 9222;
const FPS = 10;
const W = 1600;
const H = 900;
// The same bytes GitHub Pages serves, from disk: no CDN cache to defeat and
// no network jitter in the middle of a shot. Override with VIDEO_SITE.
const SITE = process.env.VIDEO_SITE || 'http://127.0.0.1:5199/';
const ROOT = dirname(fileURLToPath(import.meta.url));
const DURATIONS = JSON.parse(readFileSync(join(ROOT, 'durations.json'), 'utf8'));

// --- CDP -----------------------------------------------------------------

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target — is Chrome running with --remote-debugging-port=9222?');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params);
};
const on = (method, fn) => listeners.set(method, fn);
// Every call is bounded: a screenshot taken across a navigation, or an
// evaluate whose promise never settles, must not stall the whole capture.
const cdp = (method, params = {}, ms = 15000) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => {
    if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }
  }, ms);
});

const VERBOSE = process.argv.includes('-v');
const step = (msg) => { if (VERBOSE) console.log(`      · ${msg}`); };

async function evaluate(expression, ms = 15000) {
  step(`eval ${expression.replace(/\s+/g, ' ').slice(0, 70)}`);
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true }, ms);
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  }
  return r.result?.result?.value;
}

// Ready means the catalogue finished loading and the app rendered its
// examples — not merely that the document parsed.
async function navigate(url) {
  step(`navigate ${url}`);
  await cdp('Page.navigate', { url }, 30000);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const ready = await evaluate(
      "document.readyState === 'complete' && !!document.getElementById('examples')?.children.length");
    if (ready) return;
  }
  throw new Error(`page never became ready: ${url}`);
}

// --- frame capture -------------------------------------------------------

// Chrome pushes a frame whenever the page changes, which is far faster than
// asking for a screenshot in a loop (650 ms each at this size) and gives a
// real timestamp per frame. A still page produces no frames, so a heartbeat
// re-requests one; the assembler turns arrival times into durations.
let shots = [];
let capturing = false;
let frameDir = null;

on('Page.screencastFrame', (p) => {
  if (!capturing) return;
  const n = shots.length;
  writeFileSync(join(frameDir, `${String(n).padStart(5, '0')}.jpg`), Buffer.from(p.data, 'base64'));
  shots.push({ file: `${String(n).padStart(5, '0')}.jpg`, at: Date.now() });
  cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
});

async function startCapture(scene) {
  frameDir = join(ROOT, 'frames', scene);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  shots = [];
  capturing = true;
  const t0 = Date.now();
  await cdp('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  // Heartbeat: nudge a frame out of a page that is not repainting, so a hold
  // on screen still becomes video.
  const beat = setInterval(() => {
    if (capturing) evaluate('void document.body.offsetHeight', 4000).catch(() => {});
  }, 1000 / FPS);

  return async () => {
    clearInterval(beat);
    capturing = false;
    await cdp('Page.stopScreencast').catch(() => {});
    await sleep(120);
    const end = Date.now();
    const timed = shots.map((s, i) => ({
      file: s.file,
      dur: ((i + 1 < shots.length ? shots[i + 1].at : end) - s.at) / 1000,
    })).filter((s) => s.dur > 0.001);
    writeFileSync(join(frameDir, 'timing.json'),
      JSON.stringify({ scene, seconds: (end - t0) / 1000, frames: timed }, null, 1));
    return timed.length;
  };
}

// --- page helpers --------------------------------------------------------

const q = (js) => evaluate(js);

const setQuery = (text) => q(`(() => {
  const el = document.getElementById('q');
  el.value = ${JSON.stringify(text)};
  el.focus();
  return true;
})()`);

// Type into the box a character at a time, so the video shows a person typing.
async function typeQuery(text, perChar = 34) {
  await q("document.getElementById('q').value = ''; document.getElementById('q').focus(); true");
  for (const ch of text) {
    await q(`document.getElementById('q').value += ${JSON.stringify(ch)}; true`);
    await sleep(perChar);
  }
}

const click = (sel) => q(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing ' + ${JSON.stringify(sel)}; el.click(); return 'ok'; })()`);

const scrollTo = (sel, block = 'center') => q(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'missing';
  el.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'smooth' });
  return 'ok';
})()`);

const scrollTop = () => q("window.scrollTo({ top: 0, behavior: 'smooth' }); true");

// A soft highlight the capture can see, so the eye lands where the narration
// is pointing. Removed by clearing the class.
const spotlight = (sel, on = true) => q(`(() => {
  document.querySelectorAll('.__spot').forEach(e => e.classList.remove('__spot'));
  if (!${on}) return 'cleared';
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'missing';
  el.classList.add('__spot');
  return 'ok';
})()`);

const installStyle = () => q(`(() => {
  if (document.getElementById('__spotstyle')) return 'already';
  const s = document.createElement('style');
  s.id = '__spotstyle';
  s.textContent = \`
    .__spot { outline: 3px solid #B45309 !important; outline-offset: 4px;
              border-radius: 10px; transition: outline-color .3s; }
    * { scrollbar-width: none !important; }
    ::-webkit-scrollbar { display: none !important; }
  \`;
  document.head.appendChild(s);
  window.__ready = true;
  return 'installed';
})()`);

// Native WebMCP: Chrome 152 wants the input as a JSON string.
const tool = async (name, input = {}) => q(`(async () => {
  const mc = document.modelContext;
  const t = (await mc.getTools()).find(x => x.name === ${JSON.stringify(name)});
  if (!t) return { error: 'no tool ' + ${JSON.stringify(name)} };
  const raw = await mc.executeTool(t, ${JSON.stringify(JSON.stringify(input))});
  try { return JSON.parse(raw).structuredContent; } catch { return { raw: String(raw).slice(0, 200) }; }
})()`);

const toolNames = () => q('(async () => (await document.modelContext.getTools()).map(t => t.name))()');

// A clean page to open a shot on. The store remembers a visit, so clearing
// the record is not enough on its own — the restored search is already on
// screen by the time the clear runs — and the page is reset afterwards.
async function fresh(extra = '') {
  // Two loads: the first only to reach the origin and drop the record, the
  // second to boot with nothing remembered — no restored search, no cart, no
  // order from an earlier take.
  await navigate(`${SITE}?v=${Date.now()}${extra}`);
  await q("try { localStorage.clear(); } catch {} true");
  await navigate(`${SITE}?v=${Date.now()}${extra}`);
  await installStyle();
  await sleep(500);
}

// --- scenes --------------------------------------------------------------

const scenes = {
  // The storefront at rest, under the opening line. The title card carries
  // the first few seconds; this carries the rest of it.
  s0: {
    prep: () => fresh(),
    async act() {
    await sleep(2600);
    await scrollTo('#grid', 'start');
    await sleep(2000);
    await scrollTo('#toolsNow', 'center');
    await sleep(2000);
    await scrollTop();
    await sleep(1200);
  },
  },

  // Typing "belt" and the store asking back.
  s1: {
    prep: () => fresh(),
    async act() {
    await sleep(600);
    await typeQuery('belt');
    await sleep(400);
    await click('#go');
    await sleep(900);
    await spotlight('#ask');
    await sleep(2600);
    await spotlight('#askopts button:nth-child(1)');
    await sleep(1800);
    await spotlight(null, false);
    await sleep(600);
  },
  },

  // Answering it, and the reasons panel.
  s1b: {
    async act() {
    await sleep(300);
    await click('#askopts button:nth-child(1)');
    await sleep(1200);
    await scrollTo('#trace', 'center');
    await sleep(700);
    await spotlight('#trace');
    await sleep(2400);
    await spotlight(null, false);
    await scrollTop();
    await sleep(700);
  },
  },

  // A whole sentence: budget, refusal, attribute.
  s2: {
    prep: () => fresh(),
    async act() {
    await sleep(500);
    await typeQuery("I'm looking for a leather belt, nothing with a snap, not over $50", 26);
    await sleep(500);
    await click('#go');
    await sleep(1100);
    await spotlight('#chips');
    await sleep(2200);
    await spotlight(null, false);
    await scrollTo('#trace', 'center');
    await sleep(600);
    await spotlight('#trace');
    await sleep(2600);
    await spotlight(null, false);
    await scrollTop();
    await sleep(600);
  },
  },

  // Native WebMCP: the agent asks, the store returns a question, and the
  // tool that answers it appears in the list.
  s3: {
    prep: async () => { await fresh(); await scrollTo('#toolsNow', 'center'); await sleep(700); },
    async act() {
    await sleep(400);
    await sleep(500);
    await spotlight('#toolsNow');
    await sleep(2400);
    await spotlight(null, false);
    await tool('search_products', { query: 'a wallet that is not leather, under $30' });
    await sleep(900);
    await scrollTop();
    await sleep(800);
    await spotlight('#ask');
    await sleep(1800);
    await spotlight(null, false);
    await scrollTo('#toolsNow', 'center');
    await sleep(600);
    await spotlight('#toolsNow');
    await sleep(2600);
    await spotlight(null, false);
    await sleep(400);
  },
  },

  // Answering natively; the tool leaves the list again.
  s3b: {
    async act() {
    await sleep(200);
    await tool('answer_question', { values: ['wallets'] });
    await sleep(900);
    await scrollTop();
    await sleep(900);
    await sleep(1500);            // the tool lingers 1.5 s by design
    await scrollTo('#toolsNow', 'center');
    await sleep(600);
    await spotlight('#toolsNow');
    await sleep(2000);
    await spotlight(null, false);
    await sleep(400);
  },
  },

  // Cart, then the declarative checkout the agent may fill but not submit.
  s4: {
    async act() {
    await scrollTop();
    await sleep(400);
    const res = await tool('view_cart');
    const search = await q(`(() => {
      const cards = [...document.querySelectorAll('#grid .p .add')];
      return cards.length ? cards[0].dataset.id : null;
    })()`);
    if (search) await tool('add_to_cart', { id: search, quantity: 1 });
    await sleep(900);
    await scrollTo('#cartPanel', 'center');
    await sleep(700);
    await spotlight('#cartPanel');
    await sleep(2000);
    await spotlight(null, false);
    // The declarative form: fire and do not await — it stays pending until a
    // person submits, which is the point.
    await q(`(async () => {
      const mc = document.modelContext;
      const t = (await mc.getTools()).find(x => x.name === 'checkout');
      window.__checkoutPending = true;
      mc.executeTool(t, JSON.stringify({ name: 'Alex Rivera', address: '12 Harbour Lane, Portland OR 97201' }))
        .then(() => { window.__checkoutPending = false; })
        .catch(() => { window.__checkoutPending = false; });
      return 'called';
    })()`);
    await sleep(1400);
    await spotlight('#checkout');
    await sleep(2600);
    await spotlight('#checkout button[type=submit]');
    await sleep(2400);
    await spotlight(null, false);
    await sleep(300);
    await click('#checkout button[type=submit]');
    await sleep(1200);
    await spotlight('#orderDone');
    await sleep(2000);
    await spotlight(null, false);
    await sleep(500);
  },
  },

  // Nothing matches: what to give up.
  s5: {
    prep: () => fresh(),
    async act() {
    await sleep(400);
    await typeQuery('linen suede belt under $12', 28);
    await sleep(400);
    await click('#go');
    await sleep(1100);
    await spotlight('#relax');
    await sleep(2200);
    await click('#relax button:nth-child(2)');
    await sleep(1400);
    await spotlight(null, false);
    await sleep(900);
  },
  },
};

// --- run -----------------------------------------------------------------

// A scene must last at least as long as the line spoken over it, or the
// narration would run into the next shot. Whatever the actions did not fill
// is held on the last state — the page keeps repainting, so it stays video
// rather than a frozen still.
// The opening line plays over the title card first, so the page only has to
// cover what is left of it.
const CARD_LEAD = { s0: 5.0 };

async function padTo(name, startedAt) {
  const target = (DURATIONS[name] ?? 0) - (CARD_LEAD[name] ?? 0) + 0.7;
  const spent = (Date.now() - startedAt) / 1000;
  if (spent < target) {
    step(`hold ${(target - spent).toFixed(1)}s to reach ${target.toFixed(1)}s`);
    await sleep((target - spent) * 1000);
  }
}

const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const order = want.length ? want : Object.keys(scenes);

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const report = {};
for (const name of order) {
  const scene = scenes[name];
  if (!scene) { console.log(`  ?? no scene ${name}`); continue; }
  process.stdout.write(`  ${name} ... `);
  // A page load is not part of the shot: it happens before the camera rolls.
  if (scene.prep) await scene.prep();
  const stop = await startCapture(name);
  const t0 = Date.now();
  await scene.act();
  await padTo(name, t0);
  const n = await stop();
  const secs = (Date.now() - t0) / 1000;
  report[name] = { frames: n, seconds: +secs.toFixed(1), narration: DURATIONS[name] ?? null };
  console.log(`${n} frames, ${secs.toFixed(1)}s captured, narration ${DURATIONS[name] ?? '—'}s`);
}
writeFileSync(join(ROOT, 'capture_report.json'), JSON.stringify(report, null, 1));
ws.close();
console.log('\ncapture done');
