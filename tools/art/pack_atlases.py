"""Pack the non-animated world sprites and the paper-ink icons into Phaser atlases (art-direction 13.4).

Animated characters never go in here: createFromAseprite looks frames up by index, so each
character keeps its own sheet. Frames here are looked up by name with this.load.atlas.

    python tools/art/pack_atlases.py  ->  public/assets/atlases/atlas-<group>.png / .json
"""
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "assets"
DRAFT = ROOT / "art-src" / "drafts"
OUT = PUB / "atlases"
PAD = 2
MAX_W = 1024

GROUP_RULES = [  # first match wins; frame name prefix -> group
    ("brain", ("prop-coffee-machine", "prop-clock-vent", "prop-bed-door", "prop-temp-desk", "prop-nap-sofa",
               "prop-neuron-chandelier", "prop-night-", "window-night-band")),
    ("liver", ("prop-alcohol-barrel", "prop-production-machine", "prop-steel-shelf", "prop-acetic-bottle",
               "prop-hex-control-board", "prop-doc-mountain", "prop-resign-drawer", "box-acetaldehyde")),
    ("exam", ("prop-exam-",)),
]
STRIP = re.compile(r"^(?P<base>.+?)-(?P<n>\d+)f-(?P<w>\d+)x(?P<h>\d+)$")
EMOTES = ["dots", "question", "exclaim-question", "sweat", "anger", "note"]


def group_of(name):
    for g, prefixes in GROUP_RULES:
        if name.startswith(prefixes):
            return g
    return "common"


def frames_of(path):
    """Yield (frame name, image); horizontal strips named -<n>f-<w>x<h> are cut per frame."""
    img = Image.open(path).convert("RGBA")
    m = STRIP.match(path.stem)
    if not m:
        yield path.stem, img
        return
    n, w, h = int(m["n"]), int(m["w"]), int(m["h"])
    labels = EMOTES if m["base"] == "emote-operator" else [str(i) for i in range(n)]
    for i in range(n):
        yield f"{m['base']}-{labels[i]}", img.crop((i * w, 0, i * w + w, h))


def pack(items):
    """Shelf packing, tallest first. Returns placements and sheet size."""
    items = sorted(items, key=lambda it: (-it[1].height, -it[1].width, it[0]))
    x = y = shelf = 0
    width = 0
    placed = []
    for name, img in items:
        if x + img.width > MAX_W:
            x, y = 0, y + shelf + PAD
            shelf = 0
        placed.append((name, img, x, y))
        x += img.width + PAD
        shelf = max(shelf, img.height)
        width = max(width, x - PAD)
    return placed, (width, y + shelf)


def write(group, items):
    placed, (w, h) = pack(items)
    sheet = Image.new("RGBA", (w, h))
    frames = {}
    for name, img, x, y in placed:
        sheet.alpha_composite(img, (x, y))
        frames[name] = {"frame": {"x": x, "y": y, "w": img.width, "h": img.height}, "rotated": False,
                        "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height},
                        "sourceSize": {"w": img.width, "h": img.height}}
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / f"atlas-{group}.png", optimize=True)
    meta = {"app": "body-inc tools/art/pack_atlases.py", "image": f"atlas-{group}.png", "format": "RGBA8888",
            "size": {"w": w, "h": h}, "scale": "1"}
    (OUT / f"atlas-{group}.json").write_text(json.dumps({"frames": frames, "meta": meta}, indent=1) + "\n",
                                             encoding="utf-8")
    kb = (OUT / f"atlas-{group}.png").stat().st_size / 1024
    print(f"atlas-{group}: {len(frames)} frames, {w}x{h}, {kb:.0f} KB")


def main():
    world = {}
    sources = sorted((PUB / "props").glob("*.png"))
    sources += sorted(p for p in (DRAFT / "props").glob("*.png") if p.stem != "barrel-alcohol-immune")
    sources += sorted((DRAFT / "fx").glob("*.png")) + sorted((DRAFT / "emote").glob("*.png"))
    for p in sources:
        for name, img in frames_of(p):
            world.setdefault(group_of(name), []).append((name, img))
    for g, items in sorted(world.items()):
        write(g, items)
    icons = [(p.stem, Image.open(p).convert("RGBA")) for p in sorted((PUB / "ui" / "icons").glob("*.png"))]
    write("ui-icons", icons)


if __name__ == "__main__":
    main()
