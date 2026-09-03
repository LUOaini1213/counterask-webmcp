# Demo video — production plan (hand-off)

Written 2026-09-04 01:35 +0800 for whoever produces the video next. Nothing
here has been recorded yet. Everything needed is on this machine; the plan is
sized to fit **~75 minutes of production + 15 minutes upload**, because the
Devpost deadline is **2026-09-04 04:00 +0800 (03 Sept, 1:00 pm PT)** and the
video link must be in the form before then.

## What the rules require (verified on the Devpost page)

- under **3 minutes** — judges are not required to watch past 3:00
- a **clear demo of the project functioning, with audio**, covering what was
  built and **how WebMCP was used**
- uploaded to **YouTube, public** (not unlisted), link pasted in the form
- **no third-party trademarks, no copyrighted music** — no soundtrack at all;
  product titles with brand names may pass by on screen, but do not zoom in
  on any brand, and do not use brand imagery in title cards
- English narration

## Recommended approach: scripted capture of the real browser

Record the **real WebMCP path**, not the stand-in: Chrome for Testing 152 with
`chrome://flags/#enable-webmcp-testing` already enabled in a prepared profile,
driven over the DevTools Protocol so every scene is deterministic and
re-runnable. Frames come from `Page.captureScreenshot` at ~12 fps; narration
comes from `edge-tts`; ffmpeg assembles. This is the same pipeline shape as
`../techjam-conversational-search/scripts/build_demo_video.py` (edge-tts +
Pillow + ffmpeg), which can be borrowed from for the title card and the
concat step — but frames here are screenshots of the live page, not slides.

Fallback if the scripted route stalls after 20 minutes: open the same Chrome
window, record with **Win + G (Game Bar)**, narrate live from the script
below, trim in ffmpeg. Quality is lower; it is still a valid submission.

### Assets already in place

| what | where |
|---|---|
| Chrome for Testing 152 (no install, no admin) | `%LOCALAPPDATA%\Temp\claude\C--Users-LW-Desktop----nus----\68b4661d-d52a-4f21-8561-5adacca24b91\scratchpad\chrome-win64\chrome.exe` |
| profile with the flag pre-set (`Local State` → `enabled_labs_experiments: ["enable-webmcp-testing@1"]`) | same folder, `chrome-profile\` |
| CDP driver: evaluate JS / navigate / clear cache / click | `scripts/video/cdp.mjs` (copied from the scratchpad) |
| CDP screenshot | `scripts/video/cdp_shot.mjs` |
| ffmpeg 9.0.1 | on PATH |
| Python 3 with Pillow 12 and `edge_tts` | `python` |
| narration, word for word | below, and `submission/devpost.md` |
| the live site | https://luoaini1213.github.io/counterask-webmcp/ (append `?v=<timestamp>` to defeat the 10-minute CDN cache after any push) |

Launch the browser (PowerShell):

```powershell
$sp  = "$env:LOCALAPPDATA\Temp\claude\C--Users-LW-Desktop----nus----\68b4661d-d52a-4f21-8561-5adacca24b91\scratchpad"
Start-Process "$sp\chrome-win64\chrome.exe" -ArgumentList @('--remote-debugging-port=9222', "--user-data-dir=$sp\chrome-profile", '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', '--hide-scrollbars', 'https://luoaini1213.github.io/counterask-webmcp/?v=1')
```

Then `node scripts/video/cdp.mjs "typeof document.modelContext"` must print
`"object"` and the header badge must read **WebMCP tools registered**. If it
says the stand-in is in use, the flag did not take: check `Local State`.

### Two facts about Chrome 152 the driver must respect

- `document.modelContext.executeTool(tool, input)` takes `input` as a **JSON
  string**: `mc.executeTool(t, JSON.stringify({ query: 'belt' }))`. An object
  throws "Failed to parse input arguments".
- After a question is answered, `answer_question` stays in the tool list for
  **1.5 s** and then goes (Chrome rejects a call whose tool is removed while
  the call is still being delivered). Wait 2 s before showing the list.

## Shot list (target 2:45 total)

Capture each scene as a frame sequence while the driver performs the actions;
cut each scene to its narration length (narration ≈ 140 wpm; durations below
are what the narration takes plus a beat).

| # | time | on screen | driver actions | narration |
|---|---|---|---|---|
| 0 | 0:00–0:10 | title card (Pillow, no logos): **Counterask — the store that asks back** · live URL · "running on Chrome 152 with WebMCP" | — | *This is Counterask, a menswear store built for the WebMCP Challenge. Nine thousand nine hundred and one real products, and nothing runs on a server — retrieval, the sentence parser and the decision to ask all happen in the tab.* |
| 1 | 0:10–0:35 | the page; type `belt`; the amber question panel appears | set `#q` value, click `#go`; wait 1 s; hover the panel | *Type "belt". Ninety-seven belts. The first one beats the tenth by five percent — any store would just show you these. This one asks what material, because it can see that one answer clears forty of them. Pick leather and it answers, and the panel on the right says why it stopped asking.* |
| 1b | | click the **leather** option; grid shows 64; trace shows the differentiators | click `#askopts button:first-child`; wait 1 s | (continues) |
| 2 | 0:35–1:05 | search box with the sentence; chips *you said / not / price*; trace "read" lines; priced items first | set `#q` to `I'm looking for a leather belt, nothing with a snap, not over $50`; click `#go`; scroll trace into view | *Now say it the way a person would: "I'm looking for a leather belt, nothing with a snap, not over fifty dollars." The store reads the budget, the refusal and the attribute out of the sentence, and shows what it heard. Priced items come first, and it tells the agent what still separates the results.* |
| 3 | 1:05–1:35 | **native WebMCP**: the *on offer now* list in the tool-calls panel; then the question; `answer_question` appears in the list (it is highlighted amber) | scroll to `#toolsNow`; via `executeTool(search_products, "{\"query\":\"a wallet that is not leather, under $30\"}")`; wait 1 s | *Here is the same store driven through WebMCP itself, in Chrome with the flag on. The agent calls search_products. The store returns a question instead of a list — and look at the tool list: answer_question just appeared, because the page is waiting for a person.* |
| 3b | 1:35–1:55 | `executeTool(answer_question, "{\"values\":[\"wallets\"]}")`; grid of 18; after 2 s the tool is gone from the list | wait 2.2 s before the list shot | *The person answers, the agent passes it on, and the tool is gone again. Eighteen wallets, and the store says they differ mainly by colour.* |
| 4 | 1:55–2:20 | `add_to_cart` for the first product; the cart panel; then `executeTool(checkout, "{\"name\":\"Alex Rivera\",\"address\":\"12 Harbour Lane, Portland OR 97201\"}")` — the **browser fills the form and focuses Place order**; nothing submits | after the checkout call, hold 3 s; then click `#checkout button[type=submit]`; the order line appears | *The agent adds one to the cart and asks to order it. The checkout is a declarative WebMCP form without auto-submit — Chrome fills it in, focuses the button, and stops. The last press is mine. That is the spec's own principle, built into the store.* |
| 5 | 2:20–2:38 | `linen suede belt under $12` → "Nothing matches everything. Without… material = linen / suede · 71 items" → click it → 71 belts | set `#q`, click `#go`; wait; click `#relax button:first-child` | *When nothing matches, the store doesn't say "no results". It says what to give up: drop the material, and seventy-one belts come back.* |
| 6 | 2:38–2:50 | closing card: three numbers (two-word shopper Hit@10 0.998; agent sentences 0.993 with every listening check at zero; verified natively on Chrome 152) + URL | — | *Everything is measured, and it was verified on a real WebMCP browser. Seven-plus tools, one state machine, zero tokens — and one button only you can press.* |

Total narration ≈ 330 words ≈ 2:25 at a calm pace; with beats ≈ 2:45. Hard
ceiling 2:59.

Before scene 3 run `node scripts/video/cdp.mjs --clear-cache` once, and
between scenes call `reset_search` (or reload with a fresh `?v=`) so no state
leaks. `localStorage` remembers the visit: clear it at the start
(`localStorage.removeItem('counterask.v1')`) or scene 1 will resume scene 5.

## Assembly

1. **Narration**: one file per scene, e.g.
   `python -m edge_tts --voice en-US-AndrewNeural --rate=-5% --text "<scene text>" --write-media narr1.mp3`
   (Track 4 used `edge-tts` the same way; the voice can be swapped for the
   user's own recording — the rule only asks for audio.)
2. **Frames**: while the driver runs a scene, a loop of `Page.captureScreenshot`
   every 80 ms into `frames/scene<n>/%05d.png` (1600×900). `cdp_shot.mjs`
   shows the call; extend it to loop, or use `Page.startScreencast`.
3. **Per-scene video**: `ffmpeg -framerate 12 -i frames/scene1/%05d.png -i narr1.mp3 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#faf8f4" -c:v libx264 -pix_fmt yuv420p -r 30 -shortest scene1.mp4`
   — if the frames run shorter than the narration, freeze the last frame
   (`-vf tpad=stop_mode=clone:stop_duration=<s>`) rather than cutting the
   voice.
4. **Title/closing cards**: Pillow, 1920×1080, the page's own palette
   (`#faf8f4` ground, ink `#1b1b1b`, amber `#B45309`), Inter-like system font;
   no logos, no product images.
5. **Concat**: `ffmpeg -f concat -safe 0 -i list.txt -c copy demo.mp4`, then
   check `ffprobe demo.mp4` for duration < 180 s and a single audio stream.
6. **Captions** are optional; if burned in, keep them in the bottom 12% and
   test one frame — Track 4's caption band collided with content.

## Upload and submit

- YouTube: **Public** visibility. Title: *Counterask — a WebMCP store that
  asks back*. Description: the live URL, the repository URL, one line on what
  it is, "no music". Category: Science & Technology. Wait for processing to
  finish, open the link in a private window to confirm it plays.
- Devpost: paste the link in the video field; the rest of the text is in
  `submission/devpost.md` (live URL, repo, testing instructions, the four
  required sections).
- After submitting: **touch nothing** — not the repo, not the site, not the
  form — until winners are announced.

## Acceptance

- [ ] plays publicly on YouTube, < 3:00, audio audible throughout
- [ ] shows the question panel, the sentence being read, the native tool list with `answer_question` appearing and leaving, the checkout filled but not submitted, the relax buttons
- [ ] the words "WebMCP" and `document.modelContext` are heard or seen at least once
- [ ] no music, no brand close-ups, no other people's names on screen
- [ ] the live URL is legible on the closing card

## If time runs short

Cut scenes 5 and 6 first (the relax feature and the closing card), then
scene 2. Scenes 3–4 are the ones that prove WebMCP use; scene 1 is the one
that explains the idea. A 1:40 video with scenes 0, 1, 3, 4 is still a
complete submission.
