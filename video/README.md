# The demo video, start to finish

Everything here rebuilds the submitted film from nothing but this repository
and a Chrome with WebMCP enabled. No screen recorder, no editor: the store is
driven over the DevTools protocol, so every shot is deterministic and can be
re-shot after a change to the page.

```bash
# 1. narration — one mp3 per line, and their exact durations
python video/make_narration.py

# 2. the two cards
python video/make_cards.py

# 3. capture, with Chrome for Testing 152 already running headless:
#    chrome.exe --headless=new --remote-debugging-port=9222 \
#      --user-data-dir=<profile with enable-webmcp-testing> \
#      --window-size=1600,900 --hide-scrollbars --disable-gpu
python -m http.server 5199 --directory public &   # or VIDEO_SITE=<live url>
node video/capture.mjs

# 4. assemble: each scene cut to the length of the line spoken over it
python video/assemble.py        # -> video/out/counterask-demo.mp4
```

Three things worth knowing if you re-shoot it:

- **The window must be compositing.** With a visible-but-occluded window
  Chrome stops producing frames: `captureScreenshot` fell to 0.7 fps and the
  screencast delivered one frame in five seconds. Headless fixed both — 23 fps
  and a steady stream.
- **Chrome only emits a frame when the page changes**, so a hold on screen is
  one frame lasting seconds. `assemble.py` resamples that variable timeline
  onto a steady 15 fps; handing the raw durations to ffmpeg's concat demuxer
  mis-timed the long ones and ignored the last.
- **Page loads happen before the camera rolls** (`prep` in each scene), and
  `fresh()` loads twice — once to clear the remembered visit, once to boot
  without it — or a shot opens on the previous take's cart.

The narration is `narration.json`; edit it and re-run steps 1 and 4 to change
what is said without re-shooting. Scene ids in `capture.mjs` match the ids
there, and each scene is cut to exactly its line plus a beat.
