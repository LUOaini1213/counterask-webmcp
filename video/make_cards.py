#!/usr/bin/env python3
"""Title and closing cards, in the storefront's own palette.

No logos, no product imagery, no third-party marks — the rules forbid them
and the page's own type is enough.

    python video/make_cards.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cards"
OUT.mkdir(exist_ok=True)

W, H = 1920, 1080
GROUND = "#faf8f4"
INK = "#1b1b1b"
MUTED = "#6b6559"
AMBER = "#B45309"
OK = "#2f6f4f"
LINE = "#e6e0d6"

FONTS = "C:/Windows/Fonts"


def font(name, size):
    for candidate in (name, "segoeui.ttf", "arial.ttf"):
        p = Path(FONTS) / candidate
        if p.is_file():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


SANS = lambda s: font("segoeui.ttf", s)
SANS_B = lambda s: font("segoeuib.ttf", s)
SERIF = lambda s: font("georgia.ttf", s)
MONO = lambda s: font("consola.ttf", s)


def centre(d, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)
    return y + f.size


def title_card():
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)
    # wordmark: "Counter" ink + "ask" amber, centred as one line
    a, b = "Counter", "ask"
    fa = SANS_B(92)
    wa, wb = d.textlength(a, font=fa), d.textlength(b, font=fa)
    x = (W - (wa + wb)) / 2
    d.text((x, 372), a, font=fa, fill=INK)
    d.text((x + wa, 372), b, font=fa, fill=AMBER)

    centre(d, 500, "the store that asks back", SERIF(44), MUTED)
    d.line([(W / 2 - 190, 592), (W / 2 + 190, 592)], fill=LINE, width=2)
    centre(d, 630, "A WebMCP storefront that returns a question", SANS(34), INK)
    centre(d, 678, "when answering would be a guess", SANS(34), INK)
    centre(d, 790, "9,901 real products  ·  no server  ·  no model call  ·  no tokens", MONO(26), MUTED)
    centre(d, 852, "running on Chrome 152 with WebMCP enabled", MONO(26), AMBER)
    img.save(OUT / "title.png")


def closing_card():
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)
    centre(d, 150, "Measured, not asserted", SANS_B(56), INK)

    rows = [
        ("two-word shopper", "Hit@10 0.998", "Hit@1 0.849"),
        ("agent-relayed sentences", "Hit@10 0.993", "every listening check 0"),
        ("refusals, budgets, re-asks", "0 failures", "in 800 sessions each"),
        ("4,000 fuzzed sentences", "0 parser faults", "3 seeds"),
    ]
    y = 300
    for label, a, b in rows:
        d.text((300, y), label, font=SANS(32), fill=MUTED)
        d.text((1030, y), a, font=MONO(32), fill=INK)
        d.text((1400, y), b, font=MONO(28), fill=OK)
        y += 74

    d.line([(300, y + 24), (W - 300, y + 24)], fill=LINE, width=2)
    centre(d, y + 74, "Verified natively on Chrome 152 — document.modelContext", MONO(28), AMBER)
    centre(d, y + 150, "luoaini1213.github.io/counterask-webmcp", SANS_B(38), INK)
    centre(d, y + 208, "github.com/LUOaini1213/counterask-webmcp  ·  MIT", MONO(24), MUTED)
    img.save(OUT / "closing.png")


title_card()
closing_card()
print("wrote", OUT / "title.png", "and", OUT / "closing.png")
