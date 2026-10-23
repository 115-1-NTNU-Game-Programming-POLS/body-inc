"""Automatic first pass of the art-direction 12.4 post-processing on art-src/ai/raw/.

Output is a stand-in: Jiang's hand-cleaned version replaces it under the same file name.
Steps done here: background removal, outline snapped to ink navy, palette quantization,
nearest-neighbour pixel downscale for world props, review sheets for step 6. Step 4
(text removal) is a human check, recorded per id in REVIEW below.

    python tools/art/postprocess.py              # everything
    python tools/art/postprocess.py props icons  # only some kinds
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

from gen_gemini_prompts import ASSETS
from palette import C, WORLDS, hex_rgb, pixel_palette

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "art-src" / "ai" / "raw"
PROC = ROOT / "art-src" / "ai" / "processed"
LOG = ROOT / "art-src" / "ai" / "log"
PUB = ROOT / "public" / "assets"
NAVY = np.array(C["ink-navy"], float)
PIX_PAL = np.array(pixel_palette(), float)
PIX_TREE = cKDTree(PIX_PAL)
PORTRAIT_PAL = np.array(sorted({c for c in C.values()}), float)

PROMPT = {a[1]: a[4] for a in ASSETS}
SECTION = {a[1]: a[0][0] for a in ASSETS}

# Ids that never reach public/: the shared box skeleton (art-direction 7.4) replaces the
# AI boxes, and the rescue illustration waits for the medical posture review.
NOT_ADOPTED = {
    "prop-glucose-box": "box skeleton in art-src/drafts/props replaces it (7.4); AI drew a white body",
    "prop-acetaldehyde-crate": "box skeleton in art-src/drafts/props replaces it (7.4)",
    "prop-core-dump-box": "box skeleton in art-src/drafts/props replaces it (7.4)",
    "prop-welfare-box-closed": "box skeleton in art-src/drafts/props replaces it (7.4)",
    "prop-welfare-box-open": "box skeleton in art-src/drafts/props replaces it (7.4)",
    "prop-night-window": "drawn as a slanted perspective strip that shrinks to a sliver at 128 x 32; "
                         "art-src/drafts/props/window-night-band.png is drawn in code instead",
}
HOLD = {"illust-ch3-rescue": "v2 passes the self-check (side-lying, upper knee on the ground, upper hand under "
                             "the cheek; head tilt is mild); waits for the recovery-position review by "
                             "Wang Chen-ai (6.5)"}

# Step 4 outcome after looking at every raw image: ids with generated writing left in.
TEXT_LEFT = {}

WALL = {"prop-clock-vent", "prop-wall-board-frame", "prop-hex-control-board", "prop-night-exit-sign",
        "prop-night-window", "prop-neuron-chandelier", "prop-exam-projector", "prop-evidence-pin"}
ATLAS_GROUP = {
    "brain": ["coffee-machine", "clock-vent", "bed-door", "temp-desk", "nap-sofa", "neuron-chandelier",
              "night-"],
    "liver": ["alcohol-barrel", "production-machine", "steel-shelf", "acetic-bottle", "hex-control-board",
              "doc-mountain", "resign-drawer"],
    "exam": ["exam-"],
}


# ---------------------------------------------------------------- shared steps

def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(float)


def background(rgb, tol=26, close=0):
    """Near-white region connected to the image border.

    close > 0 seals gaps of up to about 2 * close px in the outline first, for subjects
    with a dashed outline around a near-white body (adenosine).
    """
    near = (rgb.min(2) >= 255 - tol) & (np.ptp(rgb, axis=2) < 22)
    if close:
        near &= ~ndimage.binary_closing(~near, iterations=close)
    lab, _ = ndimage.label(near)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return np.isin(lab, edge[edge > 0])


def matte(rgb, bg, band):
    """Alpha from the white background; the anti-aliased fringe becomes navy with partial alpha."""
    alpha = np.where(bg, 0.0, 1.0)
    dist = ndimage.distance_transform_edt(~bg)
    fringe = (~bg) & (dist <= band)
    lum = rgb.mean(2)
    a = np.clip((255 - lum) / (255 - NAVY.mean()), 0, 1)
    alpha[fringe] = a[fringe]
    rgb = rgb.copy()
    rgb[fringe] = NAVY
    return rgb, alpha


def drop_sparkles(rgb, alpha, max_frac=0.012):
    """Remove small detached yellow or white blobs (the decorative stars Gemini adds)."""
    lab, n = ndimage.label(alpha > 0.5)
    if n < 2:
        return alpha, 0
    sizes = ndimage.sum(np.ones_like(alpha), lab, range(1, n + 1))
    total = sizes.sum()
    alpha = alpha.copy()
    dropped = 0
    for i, s in enumerate(sizes, 1):
        if s >= max_frac * total or s == sizes.max():
            continue
        m = lab == i
        core = ndimage.binary_erosion(m, iterations=2)  # ignore the navy rim when judging color
        core = core if core.any() else m
        r, g, b = (rgb[core][:, k].mean() for k in range(3))
        warm = r > 190 and b < r - 50  # gold, yellow and peach stars
        pale = min(r, g, b) > 200 and b - r < 25  # white stars, but not light-blue sweat drops
        if warm or pale:
            grown = ndimage.binary_dilation(m, iterations=3)
            alpha[grown & (alpha < 1)] = 0  # its navy fringe goes too
            alpha[m] = 0
            dropped += 1
    return alpha, dropped


def snap(rgb, mask, pal, tol):
    """Pixels within tol (RGB distance) of a palette color take that color exactly."""
    flat = rgb[mask]
    d, i = cKDTree(pal).query(flat)
    close = d <= tol
    flat[close] = pal[i[close]]
    out = rgb.copy()
    out[mask] = flat
    return out


def snap_navy(rgb, mask, tol=34):
    # charcoal suit #3B3F4A sits only 54 away from ink navy, so tol must stay well below that
    d = np.linalg.norm(rgb - NAVY, axis=2)
    out = rgb.copy()
    out[mask & (d <= tol)] = NAVY
    return out


def to_image(rgb, alpha):
    a = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha * 255, 0, 255)]).round().astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def crop_alpha(img, thresh=8):
    box = Image.fromarray((np.asarray(img)[..., 3] > thresh).astype(np.uint8) * 255).getbbox()
    return img.crop(box) if box else img


def resize(img, size, resample=Image.LANCZOS):
    return img.convert("RGBa").resize(size, resample).convert("RGBA")


def save_small(img, path, budget_kb=60):
    """PNG quantized until it fits the per-image budget of art-direction 13.7."""
    path.parent.mkdir(parents=True, exist_ok=True)
    for colors in (256, 192, 128, 96, 64):
        img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
            path, optimize=True)
        if path.stat().st_size <= budget_kb * 1024:
            return colors
    return colors


def raw_path(aid):
    return next(RAW.glob(f"*/{aid}.*"))


# ---------------------------------------------------------------- per kind

CLOSE = {"portrait-adenosine-base": 14, "ic-tag-adenosine": 10}


def sticker(aid, band=4, sparkles=True):
    rgb = load(raw_path(aid))
    bg = background(rgb, close=CLOSE.get(aid, 0))
    rgb, alpha = matte(rgb, bg, band)
    dropped = 0
    if sparkles:
        alpha, dropped = drop_sparkles(rgb, alpha)
    body = alpha > 0.99
    rgb = snap_navy(rgb, body)
    rgb = snap(rgb, body, PORTRAIT_PAL, 14)
    return crop_alpha(to_image(rgb, alpha)), dropped


def retrace(img, frac=0.006):
    """Even out the outer outline: every edge of the silhouette gets at least frac of the
    image width in ink navy (12.4 step 2). Thicker generated strokes are left as drawn.
    frac stays below the 1 % target: a band of 2 x 1 % would fill thin parts such as the
    flag pole or a tie tip with navy completely."""
    a = np.asarray(img).astype(float)
    mask = a[..., 3] > 127
    width = max(2, round(img.width * frac))
    band = mask & (ndimage.distance_transform_edt(mask) <= width)
    a[band, :3] = NAVY
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def do_portrait(aid):
    img, dropped = sticker(aid)
    s = 1024 / max(img.size)
    master = retrace(resize(img, (round(img.width * s), round(img.height * s))))
    PROC.joinpath("portraits").mkdir(parents=True, exist_ok=True)
    master.save(PROC / "portraits" / f"{aid}-1024.png", optimize=True)
    h = 300
    disp = resize(master, (round(master.width * h / master.height), h))
    colors = save_small(disp, PUB / "portraits" / f"{aid}.png")
    return {"outputs": [f"art-src/ai/processed/portraits/{aid}-1024.png", f"public/assets/portraits/{aid}.png"],
            "sparkles_removed": dropped, "png_colors": colors}


def card_crop(img, ratio=8 / 5):
    w, h = img.size
    if w / h > ratio:
        nw = round(h * ratio)
        return img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = round(w / ratio)
    return img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))


def do_illustration(aid):
    out = PROC / "illustrations"
    out.mkdir(parents=True, exist_ok=True)
    info = {}
    if aid == "illust-xiaochen-base":
        img, info["sparkles_removed"] = sticker(aid)
        master = resize(img, (round(img.width * 1024 / img.height), 1024))
        disp = resize(master, (round(master.width * 300 / master.height), 300))
    elif aid == "illust-prologue-sunglasses-hand":
        master = Image.open(raw_path(aid)).convert("RGBA")
        disp = resize(master, (256, 256))
    else:
        master = card_crop(Image.open(raw_path(aid)).convert("RGBA"))
        disp = resize(master, (480, 300))  # 240 x 150 card slot drawn at 2x (6.5)
    master.save(out / f"{aid}-master.png", optimize=True)
    outputs = [f"art-src/ai/processed/illustrations/{aid}-master.png"]
    if aid in HOLD:
        disp.save(out / f"{aid}-display.png", optimize=True)
        outputs.append(f"art-src/ai/processed/illustrations/{aid}-display.png")
    else:
        info["png_colors"] = save_small(disp, PUB / "illustrations" / f"{aid}.png")
        outputs.append(f"public/assets/illustrations/{aid}.png")
    info["outputs"] = outputs
    return info


def cleanup(rgb, alpha):
    """Pixel cleanup the way it is done by hand: drop lone pixels, fill pinholes, and replace
    single-pixel color specks with the color most of their four neighbours share."""
    alpha = alpha.copy()
    n8 = ndimage.convolve(alpha.astype(int), np.ones((3, 3), int), mode="constant") - alpha
    alpha[alpha & (n8 == 0)] = False  # lone opaque pixel
    pin = ~alpha & (n8 >= 7)
    alpha |= pin
    h, w = alpha.shape
    out = rgb.copy()
    for y in range(h):
        for x in range(w):
            if not alpha[y, x]:
                continue
            neigh = [tuple(rgb[yy, xx]) for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1))
                     if 0 <= yy < h and 0 <= xx < w and alpha[yy, xx]]
            me = tuple(rgb[y, x])
            if pin[y, x] or (len(neigh) == 4 and me not in neigh):
                vals, counts = np.unique(np.array(neigh), axis=0, return_counts=True) if neigh else (None, None)
                if neigh and (pin[y, x] or counts.max() >= 3):
                    out[y, x] = vals[counts.argmax()]
    return out, alpha


def pixelize(img, w, h, anchor_bottom=True, max_colors=16):
    """Fit, box-downscale, hard alpha, quantize to the pixel palette, 1 px inner navy outline."""
    img = crop_alpha(img, 128)
    s = min(w / img.width, h / img.height)
    nw, nh = max(1, round(img.width * s)), max(1, round(img.height * s))
    small = np.asarray(resize(img, (nw, nh), Image.BOX)).astype(float)
    alpha = small[..., 3] >= 128
    rgb = small[..., :3]
    # adaptive palette first so that at most max_colors survive, then snap those to the pixel palette
    q = Image.fromarray(rgb.astype(np.uint8)).quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT,
                                                         dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: max_colors * 3], float).reshape(-1, 3)
    _, idx = PIX_TREE.query(pal)
    rgb = PIX_PAL[idx][np.asarray(q)]
    rgb, alpha = cleanup(rgb, alpha)
    edge = alpha & ~ndimage.binary_erosion(alpha, border_value=0)
    rgb[edge] = NAVY
    out = np.zeros((h, w, 4), np.uint8)
    x0 = (w - nw) // 2
    y0 = h - nh if anchor_bottom else (h - nh) // 2
    out[y0:y0 + nh, x0:x0 + nw, :3] = rgb.astype(np.uint8)
    out[y0:y0 + nh, x0:x0 + nw, 3] = np.where(alpha, 255, 0)
    return Image.fromarray(out, "RGBA")


def immune_band(img):
    """Desaturate 30 % and add the 2 px stone 45-degree band around the outline (5.6)."""
    a = np.asarray(img).astype(float)
    rgb, al = a[..., :3], a[..., 3] > 0
    grey = rgb.mean(2, keepdims=True)
    rgb = rgb * 0.7 + grey * 0.3
    inner = ndimage.binary_erosion(al, iterations=1)
    band = inner & ~ndimage.binary_erosion(al, iterations=3)
    yy, xx = np.mgrid[: al.shape[0], : al.shape[1]]
    stripe = ((xx + yy) % 4) < 2
    rgb[band & stripe] = C["stone"]
    rgb = PIX_PAL[PIX_TREE.query(rgb.reshape(-1, 3))[1]].reshape(rgb.shape)
    rgb[al & ~inner] = NAVY
    return Image.fromarray(np.dstack([rgb, np.where(al, 255, 0)]).astype(np.uint8), "RGBA")


def target_size(aid):
    m = re.search(r"downscaled to (\d+)x(\d+) pixel", PROMPT[aid])
    return (int(m.group(1)), int(m.group(2))) if m else None


def do_prop(aid):
    out = PROC / "props"
    out.mkdir(parents=True, exist_ok=True)
    if aid == "prop-evidence-cork-wall":
        return do_cork(aid)
    w, h = target_size(aid)
    img, _ = sticker(aid, band=3, sparkles=True)
    px = pixelize(img, w, h, anchor_bottom=aid not in WALL)
    if aid == "prop-alcohol-barrel":
        px = immune_band(px)
    px.save(out / f"{aid}.png")
    outputs = [f"art-src/ai/processed/props/{aid}.png"]
    dest = PUB / "props" / f"{aid}.png"
    if aid in NOT_ADOPTED:
        dest.unlink(missing_ok=True)  # it may have been published before it was rejected
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        px.save(dest, optimize=True)
        outputs.append(f"public/assets/props/{aid}.png")
    return {"outputs": outputs, "size": [w, h], "colors": len(px.getcolors(4096) or [])}


def seamless(a):
    """Cross-fade with a half-period roll so the result wraps in both axes."""
    h, w = a.shape[:2]
    wy = 1 - np.abs(np.linspace(-1, 1, h))
    wx = 1 - np.abs(np.linspace(-1, 1, w))
    m = np.outer(wy, wx)[..., None]
    return a * m + np.roll(a, (h // 2, w // 2), (0, 1)) * (1 - m)


def tone_index(a, levels=3):
    """Luminance split at quantiles into levels bands: 0 darkest."""
    lum = a @ np.array([0.299, 0.587, 0.114])
    qs = np.quantile(lum, [0.18, 0.82]) if levels == 3 else np.quantile(lum, np.linspace(0, 1, levels + 1)[1:-1])
    return np.digitize(lum, qs)


def do_cork(aid):
    a = load(raw_path(aid))
    h, w = a.shape[:2]
    a = a[h // 5:h - h // 5, w // 5:w - w // 5]  # the raw has a wooden frame that the wrap blend dragged inward
    tile = np.asarray(Image.fromarray(seamless(a).astype(np.uint8)).resize((64, 64), Image.BOX)).astype(float)
    tile = ndimage.gaussian_filter(tile, (1.5, 1.5, 0), mode="wrap")
    base = hex_rgb("#C8955A")
    ramp = [_dark(base), base, _light(base)]
    idx = tone_index(tile)
    img = np.array(ramp, np.uint8)[idx]
    rgb = PIX_PAL[PIX_TREE.query(img.reshape(-1, 3).astype(float))[1]].reshape(img.shape).astype(np.uint8)
    im = Image.fromarray(rgb, "RGB").convert("RGBA")
    im.save(PROC / "props" / f"{aid}.png")
    dest = PUB / "props" / f"{aid}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, optimize=True)
    return {"outputs": [f"art-src/ai/processed/props/{aid}.png", f"public/assets/props/{aid}.png"],
            "size": [64, 64], "note": "seamless 2 x 2 tile wall face, cork color is a proposal"}


def _light(c):
    return tuple(round(a + (b - a) * 0.35) for a, b in zip(c, C["highlight"]))


def _dark(c):
    return tuple(round(a + (b - a) * 0.28) for a, b in zip(c, C["ink-navy"]))


ICON_SIZE = {"I": 104}  # stationery slot is 52 px, drawn at 2x (8.3); the rest 32 px at 2x
CLOAK_EYE = {"ic-tag-cloak-on": "closed", "ic-tag-cloak-half": "half", "ic-tag-cloak-off": "open"}


def redraw_cloak_eye(img, state):
    """The generated eyes melt into one cream blob at 32 px, so paint a bigger, bolder one.

    Finds the cream eye on the cloak front, covers it with the cloak brown, then draws a
    closed line, a half disc or an open eye with a navy pupil, 3 px strokes at the 64 px master.
    """
    from PIL import ImageDraw
    a = np.asarray(img).astype(int)
    h = a.shape[0]
    cream = (a[..., 0] > 200) & (a[..., 1] > 170) & (a[..., 2] > 120) & (a[..., 3] > 200)
    cream[: h * 2 // 5] = False  # the eye sits on the lower cloak, not in the hood
    ys, xs = np.nonzero(cream)
    cx, cy = int(xs.mean()), int(ys.mean())
    x0, x1, y0, y1 = xs.min() - 2, xs.max() + 2, ys.min() - 2, ys.max() + 2
    ring = a[max(0, y0 - 3):y1 + 4, max(0, x0 - 3):x1 + 4]
    ring = ring[(ring[..., 3] > 200) & (ring[..., 0] < 200) & (ring[..., 0] > 80)]
    brown = tuple(int(v) for v in np.median(ring[:, :3], axis=0))
    out = img.copy()
    d = ImageDraw.Draw(out)
    d.rectangle((x0, y0, x1, y1), fill=(*brown, 255))
    w, e = 13, 7  # half width and half height of the new eye
    cream_c, navy = (*C["paper"], 255), (*C["ink-navy"], 255)
    if state == "closed":
        d.arc((cx - w, cy - e - 4, cx + w, cy + e - 4), 20, 160, fill=cream_c, width=4)
    elif state == "half":
        d.chord((cx - w, cy - e, cx + w, cy + e), 0, 180, fill=cream_c, outline=navy, width=2)
        d.line((cx - w, cy, cx + w, cy), fill=cream_c, width=3)
    else:
        d.ellipse((cx - w, cy - e, cx + w, cy + e), fill=cream_c, outline=navy, width=2)
        d.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=navy)
    return out


def do_icon(aid):
    img, dropped = sticker(aid, band=3, sparkles=False)
    n = ICON_SIZE.get(SECTION[aid], 64)
    inner = n - max(4, n // 16)
    s = inner / max(img.size)
    small = resize(img, (max(1, round(img.width * s)), max(1, round(img.height * s))))
    canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    canvas.alpha_composite(small, ((n - small.width) // 2, (n - small.height) // 2))
    if aid in CLOAK_EYE:
        canvas = redraw_cloak_eye(canvas, CLOAK_EYE[aid])
    PROC.joinpath("icons").mkdir(parents=True, exist_ok=True)
    canvas.save(PROC / "icons" / f"{aid}.png")
    dest = PUB / "ui" / "icons" / f"{aid}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, optimize=True)
    return {"outputs": [f"art-src/ai/processed/icons/{aid}.png", f"public/assets/ui/icons/{aid}.png"],
            "size": [n, n]}


# ---------------------------------------------------------------- textures to floor tiles

# texture id -> (world, base role or hex, dark role or None for the default, sheet name, blur sigma)
# Concrete takes a neighbouring floor color as its dark step: the default shade made blotches
# that repeat visibly every 64 px, against the low-contrast floor rule (3.4).
TEXTURE_WORLD = {
    "tex-warehouse-concrete": ("warehouse", "floor-main", "floor-alt", "floor", 1.5),
    "tex-brain-carpet": ("brain", "floor-main", None, "floor", 0),
    "tex-brain-wood": ("brain", "floor-alt", None, "floor-wood", 0),
    "tex-liver-grate": ("liver", "floor-main", None, "floor", 0),
    "tex-liver-concrete": ("liver", "floor-alt", "floor-main", "floor-concrete", 1.5),
    "tex-bbq-grass": (None, "#7FA36A", None, "floor-grass", 0),
}
ROLE_IDX = {"floor-main": 5, "floor-alt": 6, "floor-shade": 7}


def floor_ramp(world, role, dark_role=None):
    if world is None:
        b = hex_rgb(role)
        return [_dark(b), b, _light(b)]
    cols = [hex_rgb(c) for c in WORLDS[world][0]]
    b = cols[ROLE_IDX[role]]
    if dark_role:
        dark = cols[ROLE_IDX[dark_role]]
    else:
        dark = cols[ROLE_IDX["floor-shade"]] if role == "floor-main" else _dark(b)
    return [dark, b, _light(b)]


def texture_index(aid, period=64, blur=0):
    a = seamless(load(raw_path(aid)))
    small = np.asarray(Image.fromarray(a.astype(np.uint8)).resize((period, period), Image.BOX)).astype(float)
    if blur:
        small = ndimage.gaussian_filter(small, (blur, blur, 0), mode="wrap")
    return tone_index(small)


def do_texture(aid):
    world, role, dark_role, sheet, blur = TEXTURE_WORLD[aid]
    idx = texture_index(aid, blur=blur)
    worlds = [world, "brain-night"] if world == "brain" else [world]
    outputs = []
    (PROC / "textures").mkdir(parents=True, exist_ok=True)
    for w in worlds:
        ramp = np.array(floor_ramp(w, role, dark_role), np.uint8)
        name = f"tiles-{w or 'bbq'}-{sheet}"
        Image.fromarray(ramp[idx], "RGB").convert("RGBA").save(PROC / "textures" / f"{name}.png")
        outputs.append(f"art-src/ai/processed/textures/{name}.png")
    np.save(PROC / "textures" / f"{aid}.idx.npy", idx)
    return {"outputs": outputs, "period": 64, "note": "2 x 2 tiles; lay floor-0..3 in a 2 x 2 checker"}


# ---------------------------------------------------------------- logs and driver

KIND = {"A": "portrait", "B": "portrait", "C": "illustration", "D": "concept", "E": "prop", "F": "prop",
        "G": "prop", "H": "texture", "I": "icon", "J": "icon", "K": "icon", "L": "icon", "M": "icon"}
RUN = {"portrait": do_portrait, "illustration": do_illustration, "prop": do_prop, "icon": do_icon,
       "texture": do_texture}


def update_log(aid, info):
    p = LOG / f"{aid}.json"
    log = json.loads(p.read_text(encoding="utf-8"))
    post = log["post"]
    if aid in NOT_ADOPTED:
        post["select"] = False
        log["status"] = "not-adopted"
        log["reason"] = NOT_ADOPTED[aid]
    else:
        post["outline"] = "auto"
        post["quantize"] = "auto"
        post["remove-text"] = "checked" if aid not in TEXT_LEFT else False
        post["pixel-cleanup"] = "auto" if KIND[SECTION[aid]] in ("prop", "texture") else "n/a"
        post["style-board-check"] = "sheet"
        log["status"] = "held" if aid in HOLD else "auto-processed"
        if aid in HOLD:
            log["reason"] = HOLD[aid]
    log["processed"] = info
    p.write_text(json.dumps(log, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def hand_finished(aid):
    """True once a person has done any step after selection, so the auto pass must not overwrite it."""
    log = json.loads((LOG / f"{aid}.json").read_text(encoding="utf-8"))
    manual = [k for k, v in log["post"].items() if v is True and k not in ("select", "remove-text")]
    return log.get("status") == "final" or bool(manual)


def main():
    kinds = set(sys.argv[1:]) or set(RUN)
    done = 0
    for aid, sec in SECTION.items():
        kind = KIND[sec]
        if kind not in kinds or kind not in RUN:
            continue
        if hand_finished(aid):
            print(f"{kind:12s} {aid}  skipped: hand-finished")
            continue
        info = RUN[kind](aid)
        update_log(aid, info)
        done += 1
        print(f"{kind:12s} {aid}")
    print(f"{done} processed")


if __name__ == "__main__":
    main()
