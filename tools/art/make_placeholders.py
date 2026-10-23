"""Placeholder sprite sheets from public/assets/manifest.json (art-direction 13.5).

One PNG + Aseprite json-hash per entry, frame keys "0".."n" so that Phaser's
anims.createFromAseprite() finds them. Real Aseprite exports must use the same
naming (--filename-format "{frame}") and replace these files one for one.

    python tools/art/make_placeholders.py          # write placeholders
    python tools/art/make_placeholders.py --check  # fail if a real sheet misses a manifest tag
"""
import json
import sys
from pathlib import Path

from palette import C
from pixel import canvas, outline, put, rect, rgba, text, text_width

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "public" / "assets" / "manifest.json"
OUT = ROOT / "public" / "assets" / "atlases" / "placeholder"
NAVY = rgba("ink-navy")
DIR_LETTER = {"down": "D", "side": "S", "up": "U"}


def body_box(f, w, h, ax, ay):
    bw = max(10, int(w * 0.6))
    bh = max(10, int(h * 0.75))
    x0, y0 = ax - bw // 2, ay - bh + 1
    return x0, y0, x0 + bw - 1, ay


def draw_frame(entry, tag_dir, idx):
    w, h = entry["frame"]
    ax, ay = entry["anchor"]
    f = canvas(w, h)
    x0, y0, x1, y1 = body_box(f, w, h, ax, ay)
    cat = entry["category"]
    bob = idx % 2  # make animation progress visible
    y0 += bob
    if cat in ("defeatable", "player"):
        body = "ink-navy" if cat == "defeatable" else "operator-teal"
        rect(f, x0, y0, x1, y1, rgba(body))
        tie = "wine" if cat == "defeatable" else "staff-yellow"
        cx = (x0 + x1) // 2
        top = y0 + (y1 - y0) // 3
        for j in range(6):
            for i in range(-(j // 2), j // 2 + 1):
                put(f, cx + i, top + j, rgba(tie))
        if cat == "defeatable":
            # badge front and back: on the up-facing frames it is still visible
            rect(f, cx + 3, top + 1, cx + 5, top + 3, rgba("badge-gold"))
    elif cat == "reforming":
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        r = min(x1 - x0, y1 - y0) / 2
        for y in range(h):
            for x in range(w):
                d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
                if d <= r - 1:
                    put(f, x, y, rgba("drowsy", 217))
                elif d <= r and int((x + y) / 1.5) % 3 != 2:
                    put(f, x, y, rgba("drowsy-edge"))
    elif cat == "immune":
        rect(f, x0, y0, x1, y1, rgba("stone"))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x + y) % 4 < 2 and (x - x0 < 2 or x1 - x < 2 or y - y0 < 2 or y1 - y < 2):
                    put(f, x, y, rgba("light-grey"))
    elif cat == "partner":
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 2
        r = min(x1 - x0, y1 - y0) / 2
        skin = entry.get("skin", "brain")
        for y in range(h):
            for x in range(w):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    put(f, x, y, rgba(skin))
        rect(f, int(cx) - 1, int(cy) + 2, int(cx) + 1, int(cy) + 7, rgba("staff-yellow"))
        outline(f, NAVY)
    else:  # prop, npc, ui
        rect(f, x0, y0, x1, y1, rgba("light-grey" if cat == "prop" else "night-crew"))
    if cat not in ("partner",):
        outline(f, NAVY)
    label = entry["abbr"]
    lx = max(0, (w - text_width(label)) // 2)
    rect(f, lx - 1, 0, lx + text_width(label), 6, rgba("highlight"))
    text(f, lx, 1, label, NAVY)
    info = f"{DIR_LETTER.get(tag_dir, '')}{idx}"
    if h >= 24:
        rect(f, 0, h - 7, text_width(info) + 1, h - 1, rgba("highlight"))
        text(f, 1, h - 6, info, NAVY)
    put(f, ax, ay, rgba("hilite-yellow"))  # anchor marker
    return f


def build(entry):
    w, h = entry["frame"]
    frames, tags = [], []
    for tag in entry["tags"]:
        name, count = tag["name"], tag["frames"]
        tag_dir = name.rsplit("_", 1)[-1] if "_" in name else ""
        start = len(frames)
        for i in range(count):
            frames.append(draw_frame(entry, tag_dir, i))
        tags.append({"name": f"{entry['key']}.{name}", "from": start, "to": len(frames) - 1,
                     "direction": "forward", "color": "#000000ff"})
    cols = min(len(frames), 8)
    rows = (len(frames) + cols - 1) // cols
    pad = 2
    sheet = canvas(cols * (w + pad), rows * (h + pad))
    data = {"frames": {}, "meta": {
        "app": "body-inc tools/art/make_placeholders.py", "version": "placeholder",
        "image": f"{entry['key']}.png", "format": "RGBA8888",
        "size": {"w": sheet.width, "h": sheet.height}, "scale": "1",
        "frameTags": tags, "layers": [], "slices": []}}
    for i, fr in enumerate(frames):
        x, y = (i % cols) * (w + pad), (i // cols) * (h + pad)
        sheet.alpha_composite(fr, (x, y))
        data["frames"][str(i)] = {
            "frame": {"x": x, "y": y, "w": w, "h": h}, "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h},
            "duration": entry.get("duration", 100)}
    return sheet, data


def check(manifest):
    """Compare real exports in atlases/ with the manifest tags."""
    missing = []
    for e in manifest["entries"]:
        real = ROOT / "public" / "assets" / "atlases" / f"{e['key']}.json"
        if not real.exists():
            continue
        have = {t["name"] for t in json.loads(real.read_text(encoding="utf-8-sig"))["meta"]["frameTags"]}
        for t in e["tags"]:
            if f"{e['key']}.{t['name']}" not in have:
                missing.append(f"{e['key']}.{t['name']}")
    return missing


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if "--check" in sys.argv:
        missing = check(manifest)
        for m in missing:
            print("missing tag:", m)
        stale = index_problems(manifest)
        for s in stale:
            print("atlas index:", s)
        sys.exit(1 if missing or stale else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    for e in manifest["entries"]:
        sheet, data = build(e)
        sheet.save(OUT / f"{e['key']}.png")
        (OUT / f"{e['key']}.json").write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"{len(manifest['entries'])} placeholder sheets -> {OUT}")
    write_index(manifest)


REAL_DIR = ROOT / "public" / "assets" / "atlases"


def expected_index(manifest):
    """The game cannot list public/ at runtime, so it reads which atlas to load per key from
    atlases/index.json. A real export in atlases/<key>.json wins over its placeholder."""
    return {e["key"]: (f"assets/atlases/{e['key']}" if (REAL_DIR / f"{e['key']}.json").exists()
                       else f"assets/atlases/placeholder/{e['key']}") for e in manifest["entries"]}


def index_problems(manifest):
    """A real atlas added without rerunning this script would otherwise ship the placeholder."""
    path = REAL_DIR / "index.json"
    if not path.exists():
        return ["index.json missing; run python tools/art/make_placeholders.py"]
    have = json.loads(path.read_text(encoding="utf-8"))
    want = expected_index(manifest)
    return [f"{k}: index says {have.get(k)!r}, expected {v!r}; rerun make_placeholders.py"
            for k, v in want.items() if have.get(k) != v] + \
           [f"{k}: in index but not in the manifest" for k in have if k not in want]


def write_index(manifest):
    index = expected_index(manifest)
    real_dir = REAL_DIR
    (real_dir / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    real = sum(1 for v in index.values() if "placeholder" not in v)
    print(f"atlas index: {real} real, {len(index) - real} placeholder -> {real_dir / 'index.json'}")


if __name__ == "__main__":
    main()
