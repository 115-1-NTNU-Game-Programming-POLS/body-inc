"""World tilesets for public/assets/tilesets/ (art-direction 7.3 and 13.6).

Recolors the index-grey skeleton per world, drops the quantized AI floor into slots 0-3
(2 x 2 checker, one 64 px period) and redraws the shadow slots 4-7 on top of it, then
extrudes every sheet (1 px margin, 2 px spacing, like tile-extruder) and writes the matching
Tiled tileset (.tsj) plus tilesets.json for Phaser's addTilesetImage. Nobody types these
numbers by hand, so the three places cannot drift apart.

    python tools/art/build_tilesets.py          # needs postprocess.py textures and draw_drafts.py first
    python tools/art/build_tilesets.py --check  # every extruded tile must equal its source tile
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from draw_drafts import recolor
from palette import WORLDS, hex_rgb

ROOT = Path(__file__).resolve().parents[2]
DRAFT = ROOT / "art-src" / "drafts" / "tiles"
TEX = ROOT / "art-src" / "ai" / "processed" / "textures"
OUT = ROOT / "public" / "assets" / "tilesets"
T, MARGIN, SPACING, COLS = 32, 1, 2, 8

# world -> processed floor texture used for slots 0-3 (None keeps the flat skeleton floor)
FLOOR = {"lobby": None, "exam": None, "warehouse": "tiles-warehouse-floor",
         "brain": "tiles-brain-floor", "brain-night": "tiles-brain-night-floor", "liver": "tiles-liver-floor"}
EXTRA = {  # published name -> source
    "tiles-brain-floor-wood": TEX / "tiles-brain-floor-wood.png",
    "tiles-brain-night-floor-wood": TEX / "tiles-brain-night-floor-wood.png",
    "tiles-liver-floor-concrete": TEX / "tiles-liver-floor-concrete.png",
    "tiles-bbq-floor-grass": TEX / "tiles-bbq-floor-grass.png",
    "tiles-lobby-floor-marble": DRAFT / "tiles-lobby-floor-marble.png",
    "tiles-exam-floor": DRAFT / "tiles-exam-floor.png",
    "tiles-liver-floor-hex": DRAFT / "tiles-liver-floor-hex.png",
    "tiles-warehouse-safety-line": DRAFT / "tiles-warehouse-safety-line.png",
    "tiles-common-conveyor": DRAFT / "tiles-common-conveyor-12x4f.png",
}
SHADOW = {4: "N", 5: "W", 6: "E", 7: "NW"}  # same bands as draw_drafts.floor_shadow


def quadrants(tex):
    return [tex.crop((x, y, x + T, y + T)) for y in (0, T) for x in (0, T)]


def shadow(tile, sides, shade):
    a = np.array(tile)
    if "N" in sides:
        a[0:6, :, :3] = shade
    if "W" in sides:
        a[:, 0:4, :3] = shade
    if "E" in sides:
        a[:, T - 4:T, :3] = shade
    return Image.fromarray(a)


def world_sheet(world):
    sheet = recolor(Image.open(ROOT / "art-src/drafts/tiles/tiles-greybox-struct.png").convert("RGBA"), world)
    if FLOOR[world]:
        q = quadrants(Image.open(TEX / f"{FLOOR[world]}.png").convert("RGBA"))
        shade = hex_rgb(WORLDS[world][0][7])
        for i in range(4):
            sheet.paste(q[i], (i * T, 0))
        for slot, sides in SHADOW.items():
            sheet.paste(shadow(q[0], sides, shade), ((slot % COLS) * T, (slot // COLS) * T))
    return sheet


def extrude(img):
    cols, rows = img.width // T, img.height // T
    step = T + SPACING
    out = Image.new("RGBA", (MARGIN * 2 + cols * step - SPACING, MARGIN * 2 + rows * step - SPACING))
    for r in range(rows):
        for c in range(cols):
            tile = img.crop((c * T, r * T, c * T + T, r * T + T))
            big = Image.fromarray(np.pad(np.asarray(tile), ((1, 1), (1, 1), (0, 0)), mode="edge"))
            out.paste(big, (MARGIN + c * step - 1, MARGIN + r * step - 1))
    return out


def tsj(name, img_ex, cols, count):
    return {"type": "tileset", "version": "1.10", "name": name, "image": f"{name}-ex.png",
            "imagewidth": img_ex.width, "imageheight": img_ex.height, "tilewidth": T, "tileheight": T,
            "margin": MARGIN, "spacing": SPACING, "columns": cols, "tilecount": count}


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {f"tiles-{w}-struct": world_sheet(w) for w in FLOOR}
    for name, src in EXTRA.items():
        sheets[name] = Image.open(src).convert("RGBA")
    index = {}
    for name, img in sheets.items():
        img.save(OUT / f"{name}.png", optimize=True)
        ex = extrude(img)
        ex.save(OUT / f"{name}-ex.png", optimize=True)
        cols, rows = img.width // T, img.height // T
        (OUT / f"{name}.tsj").write_text(json.dumps(tsj(name, ex, cols, cols * rows), indent=1) + "\n",
                                         encoding="utf-8")
        index[name] = {"image": f"assets/tilesets/{name}-ex.png", "tileWidth": T, "tileHeight": T,
                       "margin": MARGIN, "spacing": SPACING, "columns": cols, "tileCount": cols * rows}
    shutil.copy(ROOT / "art-src/drafts/tiles/tiles-greybox-struct.slots.json", OUT / "struct-slots.json")
    (OUT / "tilesets.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"{len(sheets)} tilesets -> {OUT}")


def check():
    """Cut every tile out of the extruded sheet with margin/spacing and compare to the source."""
    bad = 0
    index = json.loads((OUT / "tilesets.json").read_text(encoding="utf-8"))
    for name, meta in index.items():
        src = np.asarray(Image.open(OUT / f"{name}.png").convert("RGBA"))
        ex = np.asarray(Image.open(ROOT / "public" / meta["image"]).convert("RGBA"))
        for i in range(meta["tileCount"]):
            c, r = i % meta["columns"], i // meta["columns"]
            x = meta["margin"] + c * (T + meta["spacing"])
            y = meta["margin"] + r * (T + meta["spacing"])
            if not np.array_equal(ex[y:y + T, x:x + T], src[r * T:(r + 1) * T, c * T:(c + 1) * T]):
                bad += 1
                print("mismatch", name, i)
    print(f"{len(index)} tilesets checked, {bad} mismatched tiles")
    return bad


if __name__ == "__main__":
    sys.exit(1 if check() else 0) if "--check" in sys.argv else build()
