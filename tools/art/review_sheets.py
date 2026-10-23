"""Step 6 review sheets (art-direction 12.4): each processed asset next to a style reference,
then greyscale, 50 %, and protan / deutan / tritan simulations (Machado 2009, severity 1.0).

    python tools/art/review_sheets.py   ->  art-src/ai/review/review-<kind>.jpg
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from palette import C

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "assets"
OUT = ROOT / "art-src" / "ai" / "review"

MACHADO = {
    "protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
GROUPS = {  # kind -> (glob, reference image, scale for display)
    "portraits": ("portraits/portrait-*.png", ROOT / "assets/organs/brain-normal.png", 1),
    "illustrations": ("illustrations/*.png", None, 1),
    "props": ("props/*.png", ROOT / "art-src/drafts/props/box-pushable.png", 3),
    "icons": ("ui/icons/*.png", None, 1),
}


def srgb_to_lin(c):
    c = c / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def simulate(img, kind):
    a = np.asarray(img.convert("RGBA")).astype(float)
    rgb = lin_to_srgb(srgb_to_lin(a[..., :3]) @ np.array(MACHADO[kind]).T)
    return Image.fromarray(np.dstack([rgb, a[..., 3]]).round().astype(np.uint8), "RGBA")


def grey(img):
    a = np.asarray(img.convert("RGBA")).astype(float)
    lum = lin_to_srgb((srgb_to_lin(a[..., :3]) @ np.array([0.2126, 0.7152, 0.0722]))[..., None].repeat(3, 2))
    return Image.fromarray(np.dstack([lum, a[..., 3]]).round().astype(np.uint8), "RGBA")


def on_paper(img, pad=4):
    bg = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (*C["paper"], 255))
    bg.alpha_composite(img, (pad, pad))
    return bg


def row(img, ref, k):
    big = img.resize((img.width * k, img.height * k), Image.NEAREST) if k > 1 else img
    half = img.resize((max(1, img.width // 2), max(1, img.height // 2)), Image.LANCZOS)
    half = half.resize((half.width * k, half.height * k), Image.NEAREST) if k > 1 else half
    cells = []
    if ref is not None:
        r = Image.open(ref).convert("RGBA")
        s = big.height / r.height
        cells.append(r.resize((max(1, round(r.width * s)), big.height),
                              Image.NEAREST if k > 1 else Image.LANCZOS))
    cells += [big, grey(big), half, simulate(big, "protan"), simulate(big, "deutan"), simulate(big, "tritan")]
    return [on_paper(c) for c in cells]


def sheet(kind):
    pattern, ref, k = GROUPS[kind]
    files = sorted(PUB.glob(pattern))
    if not files:
        return None
    rows = [(f.stem, row(Image.open(f).convert("RGBA"), ref, k)) for f in files]
    label_h = 12
    width = max(sum(c.width + 4 for c in cells) for _, cells in rows) + 8
    height = sum(max(c.height for c in cells) + label_h + 6 for _, cells in rows) + 8
    out = Image.new("RGBA", (width, height), (200, 200, 200, 255))
    d = ImageDraw.Draw(out)
    y = 4
    for name, cells in rows:
        d.text((6, y), f"{name}   [ref] item | grey | 50% | protan | deutan | tritan", fill=C["ink-navy"])
        y += label_h
        x = 4
        for c in cells:
            out.alpha_composite(c, (x, y))
            x += c.width + 4
        y += max(c.height for c in cells) + 6
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"review-{kind}.jpg"  # PNG ran to 10 MB for the portraits; these are for eyes only
    out.convert("RGB").save(p, quality=85)
    return p


def main():
    for kind in GROUPS:
        p = sheet(kind)
        if p:
            print(p)


if __name__ == "__main__":
    main()
