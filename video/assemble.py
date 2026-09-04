#!/usr/bin/env python3
"""Turn captured frames, cards and narration into one submission video.

Each scene becomes a clip whose frames keep the timing they were captured
with (ffmpeg's concat demuxer, one duration per frame), padded to 1920x1080
on the page's own ground colour, with its narration laid over it. Two cards
bookend the film. No music: the rules forbid material we do not own, and the
voice is the whole soundtrack.

    python video/assemble.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
GROUND = "0xfaf8f4"
W, H = 1920, 1080

# scene id -> (frames dir or card image, seconds of card lead-in)
FILM = [
    ("s0", "card:title.png", 5.0),
    ("s1", "frames", 0),
    ("s1b", "frames", 0),
    ("s2", "frames", 0),
    ("s3", "frames", 0),
    ("s3b", "frames", 0),
    ("s4", "frames", 0),
    ("s5", "frames", 0),
    ("s6", "card:closing.png", None),   # None: card fills the whole line
]

DUR = json.loads((ROOT / "durations.json").read_text(encoding="utf-8"))


def run(args, **kw):
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-2500:] + "\n")
        raise SystemExit(f"ffmpeg failed: {' '.join(str(a) for a in args[:6])} ...")
    return r


def probe(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)])
    return float(r.stdout.strip())


VF = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
      f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={GROUND},format=yuv420p")


CLIP_FPS = 15


def clip_from_frames(scene, target, dest):
    """The captured frames, resampled onto a steady timeline of `target` seconds.

    Chrome emits a frame only when the page changes, so a hold can be one
    frame lasting seconds. Handing those durations to ffmpeg's concat demuxer
    was unreliable — it ignores the final entry's duration and mis-timed long
    ones — so the variable timeline is sampled at a fixed rate here: for each
    tick, whichever frame was on screen then. The clip is then exactly as long
    as the line spoken over it.
    """
    d = ROOT / "frames" / scene
    timing = json.loads((d / "timing.json").read_text(encoding="utf-8"))
    frames = timing["frames"]
    captured = sum(f["dur"] for f in frames)

    # Where each captured frame starts on the captured timeline.
    starts, t = [], 0.0
    for f in frames:
        starts.append(t)
        t += f["dur"]

    # Actions run at their own pace; only the closing hold is stretched, so a
    # short scene waits on its last state instead of playing in slow motion.
    ticks = int(round(target * CLIP_FPS))
    lines, i = [], 0
    for k in range(ticks):
        at = k / CLIP_FPS
        at = at * (captured / target) if target < captured else min(at, captured - 1e-6)
        while i + 1 < len(frames) and starts[i + 1] <= at:
            i += 1
        while i > 0 and starts[i] > at:
            i -= 1
        lines.append(f"file '{(d / frames[i]['file']).as_posix()}'")
        lines.append(f"duration {1 / CLIP_FPS:.5f}")
    lines.append(f"file '{(d / frames[-1]['file']).as_posix()}'")

    lst = ROOT / f"_{scene}.txt"
    lst.write_text("\n".join(lines), encoding="utf-8")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-t", f"{target:.3f}",
         "-vf", VF, "-r", "30", "-c:v", "libx264", "-preset", "medium",
         "-crf", "20", "-pix_fmt", "yuv420p", str(dest)])
    lst.unlink()


def clip_from_card(card, seconds, dest):
    run(["ffmpeg", "-y", "-loop", "1", "-t", f"{seconds:.3f}", "-i", str(ROOT / "cards" / card),
         "-vf", VF, "-r", "30", "-c:v", "libx264", "-preset", "medium",
         "-crf", "20", "-pix_fmt", "yuv420p", str(dest)])


def main():
    parts = []
    for scene, kind, lead in FILM:
        narr = ROOT / "narr" / f"{scene}.mp3"
        spoken = probe(narr)
        total = spoken + 0.55           # a beat after each line
        pieces = []

        if kind.startswith("card:"):
            card = kind.split(":", 1)[1]
            card_secs = total if lead is None else lead
            c = OUT / f"{scene}_card.mp4"
            clip_from_card(card, card_secs, c)
            pieces.append(c)
            if lead is not None:
                v = OUT / f"{scene}_page.mp4"
                clip_from_frames(scene, total - lead, v)
                pieces.append(v)
        else:
            v = OUT / f"{scene}_v.mp4"
            clip_from_frames(scene, total, v)
            pieces.append(v)

        # video for this line, then the line laid over it
        silent = OUT / f"{scene}_silent.mp4"
        if len(pieces) == 1:
            pieces[0].replace(silent)
        else:
            lst = ROOT / f"_{scene}_join.txt"
            lst.write_text("\n".join(f"file '{p.as_posix()}'" for p in pieces), encoding="utf-8")
            run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                 "-c", "copy", str(silent)])
            lst.unlink()
            for p in pieces:
                p.unlink(missing_ok=True)

        out = OUT / f"{scene}.mp4"
        run(["ffmpeg", "-y", "-i", str(silent), "-i", str(narr),
             "-filter_complex", "[1:a]adelay=250|250,apad[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
             "-shortest", str(out)])
        silent.unlink(missing_ok=True)
        parts.append(out)
        print(f"  {scene:<4} {probe(out):6.2f}s  (line {spoken:.2f}s)")

    lst = ROOT / "_film.txt"
    lst.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts), encoding="utf-8")
    final = OUT / "counterask-demo.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", str(final)])
    lst.unlink()

    d = probe(final)
    print(f"\n  {final}  {int(d // 60)}:{d % 60:05.2f}")
    if d >= 179:
        print("  !! at or over three minutes — trim a scene")
    else:
        print(f"  {179 - d:.0f}s of headroom under the three-minute limit")


main()
