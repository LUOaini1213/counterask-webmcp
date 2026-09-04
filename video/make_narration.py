#!/usr/bin/env python3
"""Render each narration line to an mp3 and report its duration.

    python video/make_narration.py
"""
import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
VOICE = "en-US-AndrewNeural"
RATE = "-4%"


async def render(item):
    out = ROOT / "narr" / f"{item['id']}.mp3"
    tts = edge_tts.Communicate(item["text"], VOICE, rate=RATE)
    await tts.save(str(out))
    return out


def duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, encoding="utf-8",
    )
    return float(r.stdout.strip())


async def main():
    items = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
    (ROOT / "narr").mkdir(exist_ok=True)
    total = 0.0
    out = {}
    for item in items:
        path = await render(item)
        d = duration(path)
        out[item["id"]] = round(d, 2)
        total += d
        print(f"  {item['id']:<4} {d:6.2f}s  {item['text'][:60]}...")
    (ROOT / "durations.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\ntotal narration {total:.1f}s = {int(total // 60)}:{total % 60:04.1f}")
    if total > 170:
        print("!! over budget — trim lines before capturing")


asyncio.run(main())
