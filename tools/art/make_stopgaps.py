"""Stopgap atlases built by code from art that already exists, for manifest keys whose
hand-drawn sheet has not arrived (art direction 15.4). They replace the labelled placeholder
boxes in game and still need hand finishing; a hand-drawn atlases/<key>.json wins over them.

    python tools/art/make_stopgaps.py          # rebuild public/assets/atlases/stopgap/
    python tools/art/make_placeholders.py      # then refresh atlases/index.json
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import postprocess as pp  # noqa: E402
from palette import C, hex_rgb, pixel_palette  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "assets"
OUT = PUB / "atlases" / "stopgap"
MANIFEST = {e["key"]: e for e in json.loads((PUB / "manifest.json").read_text(encoding="utf-8"))["entries"]}

NAVY = tuple(C["ink-navy"])
GOLD = tuple(C["badge-gold"])
SKIN = {hex_rgb("#FDE3CF"), hex_rgb("#F2BFA6")}
NOTE_YELLOW = hex_rgb("#FFF1A8")
BOLT = ["..###", ".###.", "#####", "..##.", ".##..", ".#..."]


def _reserved(c):
    """Colours code-built art may not use: operator teal and warning red (3.1, reserved rules),
    and badge gold, which only the stamped badge carries."""
    r, g, b = c
    teal = g > r + 40 and b > r + 20 and abs(g - b) < 60
    return teal or c in {tuple(C["warn-red"]), tuple(C["warn-red-dark"]), GOLD}


ALLOWED = np.array([c for c in pixel_palette() if not _reserved(tuple(c))], float)
ALLOWED_TREE = cKDTree(ALLOWED)


def rgba(img):
    return np.asarray(img.convert("RGBA")).copy()


def clean_colours(a):
    """Remap reserved colours to the nearest allowed one; returns the old gold pixels' centre."""
    op = a[..., 3] > 0
    gold = op & np.all(a[..., :3] == GOLD, axis=2)
    centre = tuple(np.argwhere(gold).mean(0)[::-1]) if gold.any() else None
    for y, x in np.argwhere(op):
        c = tuple(int(v) for v in a[y, x, :3])
        if c == GOLD:
            a[y, x, :3] = NOTE_YELLOW
        elif _reserved(c):
            a[y, x, :3] = ALLOWED[ALLOWED_TREE.query(c)[1]]
    return centre


def dark_grey(c):
    r, g, b = (int(v) for v in c)
    return max(r, g, b) < 110 and max(r, g, b) - min(r, g, b) < 24 and (r, g, b) != NAVY


def stamp_badge(a, near):
    """Section 4 badge: 5 x 6 gold bolt on the suit whose every 4-neighbour becomes navy (the ring
    may cover a tie or sash edge, never the background), as close to `near` (x, y) as fits.
    Returns the top-left corner or None."""
    h, w = a.shape[:2]

    def at(x, y):
        return a[y, x] if 0 <= x < w and 0 <= y < h and a[y, x, 3] else None

    best = None
    for by in range(h - 5):
        for bx in range(w - 4):
            gold = {(bx + dx, by + dy) for dy, r in enumerate(BOLT) for dx, ch in enumerate(r) if ch == "#"}
            ring = {(x + dx, y + dy) for x, y in gold for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))} - gold
            d = abs(bx + 2 - near[0]) + abs(by + 2.5 - near[1])
            if best and d >= best[0]:
                continue
            if all(at(*p) is not None and dark_grey(at(*p)[:3]) for p in gold) and \
                    all(at(*p) is not None for p in ring):
                best = (d, bx, by, gold, ring)
    if not best:
        return None
    _, bx, by, gold, ring = best
    for x, y in gold:
        a[y, x, :3] = GOLD
    for x, y in ring:
        a[y, x, :3] = NAVY
    return bx, by


def place(small, w, h, foot):
    """Centre `small` in a w x h frame with its lowest opaque row on row `foot`."""
    s = rgba(small)
    rows = np.where(s[..., 3].any(1))[0]
    s = s[rows[0]:rows[-1] + 1]
    out = np.zeros((h, w, 4), np.uint8)
    top = foot + 1 - s.shape[0]
    x0 = (w - s.shape[1]) // 2
    ys, xs = slice(max(0, top), foot + 1), slice(max(0, x0), min(w, x0 + s.shape[1]))
    out[ys, xs] = s[max(0, -top):, max(0, -x0):max(0, -x0) + (xs.stop - xs.start)]
    return out


def whole(src, key, badge=False):
    """One pixelized pose from a full-body image, reused for every tag."""
    e = MANIFEST[key]
    (w, h), (_, foot) = e["frame"], e["anchor"]
    a = place(pp.pixelize(src, w, foot), w, h, foot)  # one free row on top for the bob frame
    centre = clean_colours(a)
    note = ""
    if badge:
        near = centre or (w / 2, foot * 0.6)
        spot = stamp_badge(a, near)
        note = f"badge at {spot}" if spot else "no room for the badge"
    return {t["name"]: a for t in e["tags"]}, note


def head_from_sticker(img, crop=None):
    """The object head of a concept sticker: everything above the first row where the suit shows
    in the middle third, largest connected part only."""
    a = rgba(img)
    if crop:
        H, W = a.shape[:2]
        a = a[int(crop[1] * H):int(crop[3] * H), int(crop[0] * W):int(crop[2] * W)]
    H, W = a.shape[:2]
    mid = a[:, W // 3: 2 * W // 3]
    suit = np.array([[px[3] > 200 and dark_grey(px[:3]) and tuple(px[:3]) != NAVY and
                      not (abs(int(px[0]) - 12) < 30 and abs(int(px[2]) - 94) < 40) for px in row] for row in mid])
    y0 = next(y for y in range(H // 4, H) if suit[y].sum() >= max(3, mid.shape[1] * 0.15))
    a = a[:y0]
    lab, n = ndimage.label(a[..., 3] > 127)
    keep = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    a[~keep] = 0
    return pp.crop_alpha(Image.fromarray(a, "RGBA"), 128)


def deface(head):
    """Back view: fill the face (inner navy, its highlights and blush) with the colours around it."""
    a = head.copy()
    op = a[..., 3] > 0
    inner = ndimage.binary_erosion(op)
    navy = np.all(a[..., :3] == NAVY, axis=2)
    face = inner & navy
    lightish = (a[..., :3].astype(int).sum(2) > 600) | ((a[..., 0].astype(int) - a[..., 1]) > 40)
    face |= ndimage.binary_dilation(face) & inner & lightish
    for _ in range(30):
        if not face.any():
            break
        nxt = face.copy()
        for y, x in np.argwhere(face):
            neigh = [tuple(a[yy, xx, :3]) for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1))
                     if 0 <= yy < a.shape[0] and 0 <= xx < a.shape[1] and op[yy, xx] and not face[yy, xx]]
            if neigh:
                a[y, x, :3] = max(set(neigh), key=neigh.count)
                nxt[y, x] = False
        face = nxt
    return a


def swap_heads(key, concept, crop=None, box=(16, 21)):
    """The suit-base poses with the concept's object head (5.4: one suit, object heads)."""
    sheet = Image.open(PUB / "atlases" / "suit-base.png").convert("RGBA")
    data = json.loads((PUB / "atlases" / "suit-base.json").read_text(encoding="utf-8"))
    tag_of = {t["from"]: t["name"].split(".", 1)[1] for t in data["meta"]["frameTags"]}
    sticker, _ = pp.sticker(concept)
    head_img = head_from_sticker(sticker, crop)
    head = rgba(pp.pixelize(head_img, *box))
    rows, cols = np.where(head[..., 3] > 0)
    head = head[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    clean_colours(head)
    back = deface(head)
    out = {}
    for i, fr in data["frames"].items():
        f = fr["frame"]
        a = rgba(sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])))
        op = a[..., 3] > 0
        skin = op & np.array([[tuple(int(v) for v in p[:3]) in SKIN for p in row] for row in a])
        lab, n = ndimage.label(skin)
        old = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
        ys, xs = np.where(old)
        neck, cx = ys.max(), int(round(xs.mean()))
        navy = op & np.all(a[..., :3] == NAVY, axis=2)
        clear = (old | (ndimage.binary_dilation(old) & navy))
        clear[neck + 1:] = False
        a[clear] = 0
        for _ in range(4):  # outline pixels the old head left floating
            op = a[..., 3] > 0
            navy = op & np.all(a[..., :3] == NAVY, axis=2)
            body = op & ~navy
            orphan = navy & ~ndimage.binary_dilation(body)
            orphan[neck + 1:] = False
            a[orphan] = 0
        hd = back if tag_of[int(i)].endswith("_up") else head
        hh, hw = hd.shape[:2]
        top, left = neck + 1 - hh, cx - hw // 2
        for y in range(hh):
            for x in range(hw):
                if hd[y, x, 3] and 0 <= top + y < a.shape[0] and 0 <= left + x < a.shape[1]:
                    a[top + y, left + x] = hd[y, x]
        out[tag_of[int(i)]] = a
    return out, f"head {head.shape[1]}x{head.shape[0]} from {concept}"


def exam_faces():
    """Face strips over the program-drawn paper: dark strokes and blush only, no paper."""
    def face(name):
        img = Image.open(PUB / "portraits" / f"{name}.png").convert("RGBA")
        W, H = img.size
        crop = img.crop((int(W * 0.12), int(H * 0.27), int(W * 0.88), int(H * 0.82)))
        # thin strokes would average away in a 12x box downscale; thicken the dark ones first
        flat = Image.new("RGBA", crop.size, (255, 255, 255, 255))
        flat.alpha_composite(crop)
        thick = flat.convert("RGB").filter(ImageFilter.MinFilter(5))
        small = np.asarray(thick.resize((24, 16), Image.BOX)).astype(int)
        small = np.dstack([small, np.full(small.shape[:2], 255)])
        out = np.zeros((16, 24, 4), np.uint8)
        lum = small[..., :3].mean(2)
        blush = (small[..., 0] - small[..., 1] > 45) & (small[..., 3] > 128)
        out[blush] = (*hex_rgb("#F4A8AB"), 255)
        out[(lum < 150) & (small[..., 3] > 128)] = (*NAVY, 255)
        for x in range(24):  # no facial feature is a 6 px vertical line; the paper edge is
            col, y = out[:, x, 3] > 0, 0
            while y < 16:
                run = y
                while run < 16 and col[run]:
                    run += 1
                if run - y >= 6:
                    out[y:run, x] = 0
                y = run + 1
        lab, n = ndimage.label(out[..., 3] > 0)
        for i in range(1, n + 1):  # paper edges and fingers survive as thin vertical strokes
            xs = np.where(lab == i)[1]
            if xs.max() - xs.min() < 2:
                out[lab == i] = 0
        return out
    stern, approve = face("portrait-exam-stern"), face("portrait-exam-approve")
    for x, y in ((9, 11), (10, 12), (11, 12), (12, 12), (13, 12), (14, 11)):  # its thin smile does not survive
        approve[y, x] = (*NAVY, 255)
    pick = {"stern": stern, "quiz": stern, "surprised": stern, "frown": stern,
            "satisfied": approve, "closed": approve}
    return {t["name"]: pick[t["name"].split("_")[0]] for t in MANIFEST["exam"]["tags"]}, "faces from the two exam portraits"


def from_png(path, key):
    e = MANIFEST[key]
    (w, h), (_, foot) = e["frame"], e["anchor"]
    a = place(Image.open(path), w, h, foot)
    return {t["name"]: a for t in e["tags"]}, f"from {path.relative_to(ROOT).as_posix()}"


def portrait(name):
    return Image.open(PUB / "portraits" / f"{name}.png").convert("RGBA")


BUILD = {
    "alcohol-barrel": lambda: from_png(PUB / "props" / "prop-alcohol-barrel.png", "alcohol-barrel"),
    "glucose-box": lambda: from_png(ROOT / "art-src" / "drafts" / "props" / "box-glucose-pushable.png", "glucose-box"),
    "energy-seller": lambda: swap_heads("energy-seller", "concept-energy-seller", box=(15, 21)),
    "cheers": lambda: swap_heads("cheers", "concept-cheers", crop=(0.28, 0.0, 1.0, 1.0), box=(17, 20)),
    "caffeine": lambda: whole(portrait("portrait-caffeine-pitch"), "caffeine", badge=True),
    "toast-boss": lambda: whole(portrait("portrait-toast-boss-pitch"), "toast-boss", badge=True),
    "brain": lambda: whole(portrait("portrait-brain-base"), "brain"),
    "liver": lambda: whole(portrait("portrait-liver-base"), "liver"),
    "adenosine": lambda: whole(portrait("portrait-adenosine-base"), "adenosine"),
    "adenosine-mini": lambda: whole(portrait("portrait-adenosine-base"), "adenosine-mini"),
    "exam": exam_faces,
}


def write(key, poses):
    e = MANIFEST[key]
    w, h = e["frame"]
    frames, tags = [], []
    for t in e["tags"]:
        a = poses[t["name"]]
        start = len(frames)
        for i in range(t["frames"]):
            frames.append(a if i % 2 == 0 else np.concatenate([a[1:], np.zeros_like(a[:1])]))  # bob up 1 px
        tags.append({"name": f"{key}.{t['name']}", "from": start, "to": len(frames) - 1, "direction": "forward"})
    pad = 2
    cols = min(len(frames), 8)
    rows = (len(frames) + cols - 1) // cols
    sheet = np.zeros((rows * (h + pad) - pad, cols * (w + pad) - pad, 4), np.uint8)
    data = {"frames": {}, "meta": {"app": "body-inc tools/art/make_stopgaps.py", "version": "stopgap",
                                   "image": f"{key}.png", "format": "RGBA8888",
                                   "size": {"w": sheet.shape[1], "h": sheet.shape[0]}, "scale": "1",
                                   "frameTags": tags}}
    for i, a in enumerate(frames):
        x, y = (i % cols) * (w + pad), (i // cols) * (h + pad)
        sheet[y:y + h, x:x + w] = a
        data["frames"][str(i)] = {"frame": {"x": x, "y": y, "w": w, "h": h}, "rotated": False, "trimmed": False,
                                  "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
                                  "sourceSize": {"w": w, "h": h}, "duration": e.get("duration", 100)}
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(OUT / f"{key}.png", optimize=True)
    (OUT / f"{key}.json").write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")


def main():
    keys = sys.argv[1:] or list(BUILD)
    for key in keys:
        if (PUB / "atlases" / f"{key}.json").exists():
            print(f"{key}: hand-drawn atlas exists, skipped")
            continue
        poses, note = BUILD[key]()
        write(key, poses)
        print(f"{key}: {note}")


if __name__ == "__main__":
    main()
