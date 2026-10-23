"""Program-drawn draft art: FX, operator emotes, greybox structure tiles, floor skins,
conveyor, box skeleton. All outputs are drafts for greybox play; Jiang's hand-drawn
versions replace them slot for slot.

    python tools/art/draw_drafts.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from palette import C, INDEX_GREYS, ROLES, WORLDS, hex_rgb
from pixel import (ascii_art, canvas, grid, mix, outline, put, ramp, rect, rgba, scale, strip, text,
                   text_width)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art-src" / "drafts"
NAVY = rgba("ink-navy")
WHITE = rgba("highlight")
T = 32


def save(img, rel):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p)
    return p


# ---------------------------------------------------------------- FX

def fx_paper_scrap():
    shapes = [
        ["..oo....", ".owwo...", ".owwwo..", "..owwo..", "...oo..."],
        ["...ooo..", "..oyyo..", ".oyyo...", ".ooo...."],
        [".oooo...", ".owwo...", ".owwo...", ".oooo..."],
        ["..o.....", ".oyo....", "oyyyo...", ".oyyo...", "..oo...."],
    ]
    cols = {"o": NAVY, "w": rgba("paper"), "y": rgba("sticky-yellow")}
    frames = []
    for s in shapes:
        f = canvas(8, 8)
        ascii_art(f, 0, 1, s, cols)
        frames.append(f)
    return strip(frames)


def fx_ink_dot():
    rows = [
        ["........", "........", "...bb...", "..bbbb..", "..bbbb..", "...bb...", "........", "........"],
        ["........", "..b..b..", ".bbbbb..", ".bbbbbb.", "..bbbbb.", ".bbbb...", "...b..b.", "........"],
        [".b......", "......b.", "..b.....", "....b...", ".b...bb.", "........", "..b..b..", "b......."],
    ]
    frames = []
    for r in rows:
        f = canvas(8, 8)
        ascii_art(f, 0, 0, r, {"b": rgba("blue-ink")})
        frames.append(f)
    return strip(frames)


def fx_cotton():
    lav = rgba("drowsy", 217)  # 85% per art-direction 4
    edge = rgba("drowsy-edge")
    shapes = [
        ["..ee....", ".elle...", "ellllle.", ".ellle..", "..ee...."],
        ["...e....", ".eelee..", "elllle..", ".eelle..", "...ee..."],
        [".ee.....", "elle....", "ellee...", ".eelle..", "...ee..."],
    ]
    frames = []
    for s in shapes:
        f = canvas(8, 8)
        ascii_art(f, 0, 1, s, {"l": lav, "e": edge})
        frames.append(f)
    return strip(frames)


def fx_sweat():
    f = canvas(4, 6)
    ascii_art(f, 0, 0, [".o..", ".o..", "obo.", "obbo", "obbo", ".oo."],
              {"o": NAVY, "b": rgba("notebook-line")})
    return f


def fx_smoke():
    frames = []
    for i, (r, a) in enumerate([(2.5, 230), (3.5, 200), (4.5, 140), (5.5, 70)]):
        f = canvas(12, 12)
        for cx, cy, rr in [(6, 7 - i * 0.5, r), (4, 8 - i * 0.5, r * 0.7), (8, 8 - i * 0.5, r * 0.7)]:
            for y in range(12):
                for x in range(12):
                    if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr:
                        put(f, x, y, rgba("paper", a))
        frames.append(f)
    return strip(frames)


def fx_tie_fly():
    f = canvas(8, 12)
    ascii_art(f, 0, 0, [
        "..oooo..",
        "..owwo..",
        "...oo...",
        "..owwo..",
        "..owwo..",
        ".owwwwo.",
        ".owwwdo.",
        ".owwwdo.",
        ".owwddo.",
        "..owdo..",
        "...oo...",
        "........",
    ], {"o": NAVY, "w": rgba("wine"), "d": rgba("wine-dark")})
    return f


# ---------------------------------------------------------------- operator emotes (art-direction 5.3)

GLYPHS = {
    "dots": ["..........", "..........", "..........", "..........",
             ".##.##.##.", ".##.##.##.", ".........."],
    "question": ["...###....", "..#...#...", "......#...", "....##....",
                 "....#.....", "..........", "....#....."],
    "exclaim-question": [".#...###..", ".#..#...#.", ".#......#.", ".#....##..",
                         ".#....#...", "..........", ".#....#..."],
    "sweat": ["....#.....", "...#b#....", "..#bbb#...", ".#bbbbb#..",
              ".#bbbbb#..", "..#bbb#...", "...###...."],
    "anger": ["..#....#..", "..#....#..", "##......##", "..........",
              "##......##", "..#....#..", "..#....#.."],
    "note": ["....###...", "....#.##..", "....#..#..", "....#.....",
             "..###.....", ".####.....", "..##......"],
}


def emote(name):
    f = canvas(16, 16)
    rect(f, 2, 1, 13, 10, WHITE)
    rect(f, 1, 2, 14, 9, WHITE)
    put(f, 4, 11, WHITE)
    put(f, 5, 11, WHITE)
    put(f, 4, 12, WHITE)
    outline(f, NAVY)
    ascii_art(f, 3, 2, GLYPHS[name], {"#": NAVY, "b": rgba("notebook-line")})
    return f


# ---------------------------------------------------------------- greybox structure (index greys)

G = dict(zip(ROLES, INDEX_GREYS))


def gtile(role):
    t = np.zeros((T, T, 4), np.uint8)
    t[..., :3] = G[role]
    t[..., 3] = 255
    return t


def gset(t, ys, xs, role):
    t[ys, xs, :3] = G[role]


def floor_variant(seed):
    t = gtile("floor-main")
    rng = np.random.default_rng(seed)
    for _ in range(seed * 3):
        x, y = rng.integers(2, 29, 2)
        gset(t, slice(y, y + 2), slice(x, x + 1), "floor-alt")
    return t


def wall_top(edges=(), notch=None):
    """Wall-top piece. edges: sides that face the room (lit lip). notch: inner corner."""
    t = gtile("wall-top-dark")
    lip = 3
    for e in edges:
        if e == "S":
            gset(t, slice(T - lip, T), slice(None), "wall-top-light")
        if e == "N":
            gset(t, slice(0, lip), slice(None), "wall-top-light")
        if e == "E":
            gset(t, slice(None), slice(T - lip, T), "wall-top-light")
        if e == "W":
            gset(t, slice(None), slice(0, lip), "wall-top-light")
    if notch:
        ys = slice(T - lip, T) if "S" in notch else slice(0, lip)
        xs = slice(T - lip, T) if "E" in notch else slice(0, lip)
        gset(t, ys, xs, "wall-top-light")
    return t


def wall_face(part, lower):
    t = gtile("wall-face")
    if not lower:
        gset(t, slice(0, 3), slice(None), "wall-face-shade")  # shadow under the lip
        gset(t, slice(14, 15), slice(None), "wall-face-shade")  # panel seam
    else:
        gset(t, slice(T - 5, T), slice(None), "skirting")
        gset(t, slice(10, 11), slice(None), "wall-face-shade")
    if part == "L":
        gset(t, slice(None), slice(0, 2), "wall-face-shade")
    if part == "R":
        gset(t, slice(None), slice(T - 2, T), "wall-face-shade")
    if part == "V":  # vertical panel variant
        gset(t, slice(None), slice(15, 16), "wall-face-shade")
    return t


def door_opening(side, top):
    t = gtile("wall-top-dark")
    frame = slice(0, 3) if side == "L" else slice(T - 3, T)
    gset(t, slice(None), frame, "skirting")
    if top:
        gset(t, slice(0, 4), slice(None), "skirting")
    return t


def door_leaf(side, locked):
    t = gtile("skirting")
    gset(t, slice(2, T), slice(3, T - 3) if True else None, "wall-face-shade")
    inner = slice(3, T - 3)
    gset(t, slice(6, 14), inner, "wall-face")
    gset(t, slice(18, 28), inner, "wall-face")
    hx = slice(T - 7, T - 5) if side == "L" else slice(5, 7)
    gset(t, slice(15, 18), hx, "wall-top-dark")
    if locked and side == "L":
        gset(t, slice(14, 22), slice(T - 9, T - 1), "wall-top-light")
        gset(t, slice(16, 20), slice(T - 7, T - 3), "wall-top-dark")
    return t


def floor_shadow(sides):
    t = gtile("floor-main")
    if "N" in sides:
        gset(t, slice(0, 6), slice(None), "floor-shade")
    if "W" in sides:
        gset(t, slice(None), slice(0, 4), "floor-shade")
    if "E" in sides:
        gset(t, slice(None), slice(T - 4, T), "floor-shade")
    return t


def partition(part):
    t = np.zeros((T, T, 4), np.uint8)
    t[12:T, :, :3] = G["wall-face"]
    t[12:T, :, 3] = 255
    t[8:12, :, :3] = G["wall-top-light"]
    t[8:12, :, 3] = 255
    t[T - 4:T, :, :3] = G["skirting"]
    if part == "L":
        t[8:T, 0:2, :3] = G["wall-face-shade"]
    if part == "R":
        t[8:T, T - 2:T, :3] = G["wall-face-shade"]
    return t


def stairs():
    t = gtile("floor-main")
    for i in range(4):
        gset(t, slice(i * 8, i * 8 + 2), slice(None), "floor-shade")
        gset(t, slice(i * 8 + 2, i * 8 + 4), slice(None), "floor-alt")
    return t


# Slot layout proposal for the 8-column template (art-direction 7.3). Append-only once agreed.
SLOTS = [
    ("floor-0", lambda: floor_variant(0)), ("floor-1", lambda: floor_variant(1)),
    ("floor-2", lambda: floor_variant(2)), ("floor-3", lambda: floor_variant(3)),
    ("floor-shadow-n", lambda: floor_shadow("N")), ("floor-shadow-w", lambda: floor_shadow("W")),
    ("floor-shadow-e", lambda: floor_shadow("E")), ("floor-shadow-nw", lambda: floor_shadow("NW")),
    ("walltop-edge-s", lambda: wall_top("S")), ("walltop-edge-n", lambda: wall_top("N")),
    ("walltop-edge-e", lambda: wall_top("E")), ("walltop-edge-w", lambda: wall_top("W")),
    ("walltop-outer-se", lambda: wall_top("SE")), ("walltop-outer-sw", lambda: wall_top("SW")),
    ("walltop-outer-ne", lambda: wall_top("NE")), ("walltop-outer-nw", lambda: wall_top("NW")),
    ("walltop-inner-se", lambda: wall_top((), "SE")), ("walltop-inner-sw", lambda: wall_top((), "SW")),
    ("walltop-inner-ne", lambda: wall_top((), "NE")), ("walltop-inner-nw", lambda: wall_top((), "NW")),
    ("walltop-fill", lambda: wall_top()),
    (None, None), (None, None), (None, None),
    ("door-n-l-top", lambda: door_opening("L", True)), ("door-n-r-top", lambda: door_opening("R", True)),
    ("door-n-l", lambda: door_opening("L", False)), ("door-n-r", lambda: door_opening("R", False)),
    ("door-closed-l", lambda: door_leaf("L", False)), ("door-closed-r", lambda: door_leaf("R", False)),
    ("door-locked-l", lambda: door_leaf("L", True)), ("door-locked-r", lambda: door_leaf("R", True)),
    ("face-upper-l", lambda: wall_face("L", False)), ("face-upper-m", lambda: wall_face("M", False)),
    ("face-upper-r", lambda: wall_face("R", False)), ("face-upper-v", lambda: wall_face("V", False)),
    ("face-lower-l", lambda: wall_face("L", True)), ("face-lower-m", lambda: wall_face("M", True)),
    ("face-lower-r", lambda: wall_face("R", True)), ("face-lower-v", lambda: wall_face("V", True)),
    ("partition-l", lambda: partition("L")), ("partition-m", lambda: partition("M")),
    ("partition-r", lambda: partition("R")), ("stairs", stairs),
]


def greybox_tileset():
    tiles, names = [], {}
    for i, (name, fn) in enumerate(SLOTS):
        tiles.append(Image.fromarray(fn()) if fn else None)
        if name:
            names[name] = i
    return grid(tiles, 8, T, T), names


def recolor(img, world):
    """Map index greys to a world's 8 colors. Other pixels pass through."""
    cols = WORLDS[world][0]
    a = np.array(img)
    out = a.copy()
    for g, hx in zip(INDEX_GREYS, cols):
        m = (a[..., 0] == g) & (a[..., 1] == g) & (a[..., 2] == g) & (a[..., 3] > 0)
        out[m, :3] = hex_rgb(hx)
    return Image.fromarray(out)


def sample_room(tileset, names):
    """20x12 standard room (art-direction 7.1) with a north door and a locked west door."""
    W, H = 20, 12
    m = [[names["floor-0"]] * W for _ in range(H)]
    for x in range(W):
        m[0][x] = names["walltop-edge-s"]
        m[1][x] = names["face-upper-m"]
        m[2][x] = names["face-lower-m"]
        m[11][x] = names["walltop-edge-n"]
    for y in range(1, 11):
        m[y][0] = names["walltop-edge-e"]
        m[y][W - 1] = names["walltop-edge-w"]
    m[0][0] = names["walltop-inner-se"]
    m[0][W - 1] = names["walltop-inner-sw"]
    m[11][0] = names["walltop-inner-ne"]
    m[11][W - 1] = names["walltop-inner-nw"]
    m[1][1], m[2][1] = names["face-upper-l"], names["face-lower-l"]
    m[1][W - 2], m[2][W - 2] = names["face-upper-r"], names["face-lower-r"]
    for x in range(1, W - 1):
        m[3][x] = names["floor-shadow-n"]
    m[3][1] = names["floor-shadow-nw"]
    for x in (5, 14):
        m[1][x], m[2][x] = names["face-upper-v"], names["face-lower-v"]
    m[0][9], m[0][10] = names["door-n-l-top"], names["door-n-r-top"]
    m[1][9], m[1][10] = names["door-n-l"], names["door-n-r"]
    m[2][9], m[2][10] = names["door-n-l"], names["door-n-r"]
    m[11][9], m[11][10] = names["floor-0"], names["floor-0"]
    m[11][8], m[11][11] = names["walltop-outer-ne"], names["walltop-outer-nw"]
    m[5][0], m[8][0] = names["walltop-outer-se"], names["walltop-outer-ne"]
    m[6][0], m[7][0] = names["door-locked-l"], names["door-locked-r"]
    rng = np.random.default_rng(7)
    for y in range(4, 11):
        for x in range(1, W - 1):
            r = rng.random()
            m[y][x] = names["floor-1"] if r < 0.15 else names["floor-2"] if r < 0.22 else m[y][x]
    for x in (4, 5, 6):
        m[7][x] = names[{4: "partition-l", 5: "partition-m", 6: "partition-r"}[x]]
    room = canvas(W * T, H * T)
    for y in range(H):
        for x in range(W):
            i = m[y][x]
            room.alpha_composite(tileset.crop(((i % 8) * T, (i // 8) * T, (i % 8 + 1) * T, (i // 8 + 1) * T)),
                                 (x * T, y * T))
    return room


# ---------------------------------------------------------------- world floor skins

def lobby_marble():
    _, cols = None, WORLDS["lobby"][0]
    main, alt, shade = (hex_rgb(cols[5]), hex_rgb(cols[6]), hex_rgb(cols[7]))
    tiles = []
    for base in (main, alt):
        for qy in (0, 1):
            for qx in (0, 1):
                t = canvas(T, T)
                rect(t, 0, 0, T - 1, T - 1, (*base, 255))
                if qy == 0:
                    rect(t, 0, 0, T - 1, 0, (*shade, 255))
                if qx == 0:
                    rect(t, 0, 0, 0, T - 1, (*shade, 255))
                tiles.append(t)
    return grid(tiles, 4, T, T)


def exam_tiles():
    cols = WORLDS["exam"][0]
    main, alt, shade = (hex_rgb(cols[5]), hex_rgb(cols[6]), hex_rgb(cols[7]))
    tiles = []
    for v in range(4):
        t = canvas(T, T)
        for cy in range(2):
            for cx in range(2):
                c = alt if (v == 1 and (cx, cy) == (1, 0)) or (v == 2 and (cx, cy) == (0, 1)) else main
                rect(t, cx * 16, cy * 16, cx * 16 + 15, cy * 16 + 15, (*c, 255))
                rect(t, cx * 16, cy * 16, cx * 16 + 15, cy * 16, (*shade, 255))
                rect(t, cx * 16, cy * 16, cx * 16, cy * 16 + 15, (*shade, 255))
        tiles.append(t)
    return grid(tiles, 4, T, T)


def hex_tiles():
    """Seamless 32x32 hex floor for the liver factory (period 32 in both axes)."""
    cols = WORLDS["liver"][0]
    fill_a, fill_b, grout = hex_rgb(cols[6]), hex_rgb(cols[5]), hex_rgb(cols[7])
    centers = [(8, 4), (24, 4), (0, 20), (16, 20), (32, 20)]

    def cell(x, y):
        best, bi = 1e9, 0
        for i, (cx, cy) in enumerate(centers):
            for oy in (-32, 0, 32):
                for ox in (-32, 0, 32):
                    d = (x + 0.5 - cx - ox) ** 2 + ((y + 0.5 - cy - oy) * 1.15) ** 2
                    if d < best:
                        best, bi = d, (round((cx + ox) / 16), round((cy + oy - 4) / 16))
        return bi

    ids = [[cell(x, y) for x in range(T)] for y in range(T)]
    tiles = []
    for v in range(2):
        t = canvas(T, T)
        for y in range(T):
            for x in range(T):
                c = ids[y][x]
                edge = ids[y][(x + 1) % T] != c or ids[(y + 1) % T][x] != c
                col = grout if edge else (fill_b if (v == 1 and c == (1, 0)) else fill_a)
                put(t, x, y, (*col, 255))
        tiles.append(t)
    return grid(tiles, 2, T, T)


def warehouse_lines():
    cols = WORLDS["warehouse"][0]
    floor = (*hex_rgb(cols[5]), 255)
    line = (*hex_rgb(WORLDS["warehouse"][1]["safety-line"]), 255)
    specs = ["H", "V", "NE", "NW", "SE", "SW"]
    tiles = []
    for s in specs:
        t = canvas(T, T)
        rect(t, 0, 0, T - 1, T - 1, floor)
        if s == "H":
            rect(t, 0, 14, T - 1, 17, line)
        elif s == "V":
            rect(t, 14, 0, 17, T - 1, line)
        else:
            rect(t, 14, 14, 17, 17, line)
            if "N" in s:
                rect(t, 14, 0, 17, 17, line)
            if "S" in s:
                rect(t, 14, 14, 17, T - 1, line)
            if "E" in s:
                rect(t, 14, 14, T - 1, 17, line)
            if "W" in s:
                rect(t, 0, 14, 17, 17, line)
        tiles.append(t)
    return grid(tiles, 6, T, T)


# ---------------------------------------------------------------- conveyor (art-direction 7.4)

def conveyor_frame(arrows, phase):
    """Belt moving right. arrows = arrows per tile (1 slow, 2 normal, 3 fast)."""
    t = canvas(T, T)
    belt, belt_d = C["text-2"], ramp(C["text-2"])[2]
    rect(t, 0, 4, T - 1, T - 5, (*belt, 255))
    for y in (0, T - 4):
        rect(t, 0, y, T - 1, y + 3, rgba("stone"))
    rect(t, 0, 3, T - 1, 3, NAVY)
    rect(t, 0, T - 4, T - 1, T - 4, NAVY)
    rect(t, 0, 5, T - 1, 5, (*belt_d, 255))
    step = T / arrows
    for k in range(arrows):
        ax = int(round(k * step + phase * 8)) % T
        for j in range(6):  # chevron ">" from (ax,10) to tip (ax+5,15/16) back to (ax,21)
            for w in range(2):
                put(t, (ax + j + w) % T, 10 + j, WHITE)
                put(t, (ax + j + w) % T, 21 - j, WHITE)
    return t


def conveyor_sheet():
    rows = []
    for arrows in (1, 2, 3):
        right = [conveyor_frame(arrows, p) for p in range(4)]
        for rot in (0, 180, 90, 270):  # right, left, up, down
            rows.append([f.rotate(rot) for f in right])
    sheet = canvas(4 * T, len(rows) * T)
    for j, row in enumerate(rows):
        for i, f in enumerate(row):
            sheet.alpha_composite(f, (i * T, j * T))
    return sheet


# ---------------------------------------------------------------- box skeleton (art-direction 4, 7.4)

CARDBOARD = (0xD2, 0xA8, 0x6E)  # draft only, not yet in body-inc.gpl


def box(base, corners=False, deco=None):
    light, mid, dark = ramp(base)
    f = canvas(T, T)
    rect(f, 4, 7, 27, 13, (*light, 255))       # top face
    rect(f, 4, 14, 27, 27, (*mid, 255))        # front face
    rect(f, 24, 14, 27, 27, (*dark, 255))      # shaded right side
    rect(f, 4, 14, 27, 14, (*dark, 255))       # top/front seam
    if deco:
        deco(f)
    outline(f, NAVY)
    if corners:
        w = WHITE
        for (x, y, dx, dy) in [(5, 8, 1, 1), (26, 8, -1, 1), (5, 12, 1, -1), (26, 12, -1, -1)]:
            put(f, x, y, w)
            put(f, x + dx, y, w)
            put(f, x, y + dy, w)
    shadow = rgba("ink-navy", 64)
    rect(f, 4, 29, 27, 31, shadow)
    return f


def deco_glucose(f):
    rect(f, 7, 17, 22, 24, WHITE)
    rect(f, 7, 20, 22, 21, rgba("blue-ink"))


def deco_acetaldehyde(f):
    cx, cy = 15, 20
    for dy in range(-5, 6):
        span = 5 - abs(dy)
        for dx in range(-span, span + 1):
            put(f, cx + dx, cy + dy, WHITE)
    put(f, 13, 21, rgba("heart"))
    put(f, 17, 21, rgba("heart"))
    put(f, 14, 19, NAVY)
    put(f, 16, 19, NAVY)


def deco_ribbon(f):
    y = rgba("staff-yellow")
    rect(f, 14, 7, 17, 27, y)
    rect(f, 4, 9, 27, 11, y)
    rect(f, 12, 5, 13, 7, y)
    rect(f, 18, 5, 19, 7, y)


def deco_label(f):
    rect(f, 9, 18, 20, 23, WHITE)


def immune_barrel():
    """Alcohol barrel: 30% desaturated, grey 45-degree stripe band (art-direction 5.6)."""
    amber = C["badge-gold"] if False else hex_rgb(WORLDS["liver"][1]["alcohol-amber"])
    grey = (sum(amber) // 3,) * 3
    base = mix(amber, grey, 0.3)
    light, mid, dark = ramp(base)
    f = canvas(T, T)
    for y in range(8, 26):
        rect(f, 9, y, 22, y, (*mid, 255))
    rect(f, 8, 10, 23, 23, (*mid, 255))
    rect(f, 19, 9, 22, 24, (*dark, 255))
    rect(f, 10, 8, 21, 10, (*light, 255))
    for y in (13, 20):
        rect(f, 8, y, 23, y, (*dark, 255))
    rect(f, 11, 15, 17, 18, WHITE)
    outline(f, NAVY)
    sil = np.array(f)[..., 3] > 0
    band = np.zeros_like(sil)
    for y in range(T):
        for x in range(T):
            if not sil[y, x]:
                near = sil[max(0, y - 2):y + 3, max(0, x - 2):x + 3].any()
                band[y, x] = near
    stone = rgba("stone")
    for y in range(T):
        for x in range(T):
            if band[y, x] and (x + y) % 4 < 2:
                put(f, x, y, stone)
    return f


# ---------------------------------------------------------------- template sheet

def template_sheet(tileset, names):
    k = 3
    img = scale(tileset, k)
    for name, i in names.items():
        x, y = (i % 8) * T * k, (i // 8) * T * k
        lab = canvas(T, 8)
        rect(lab, 0, 0, text_width(str(i)) + 1, 6, rgba("highlight"))
        text(lab, 1, 1, str(i), NAVY)
        img.alpha_composite(scale(lab, k), (x, y))
    return img


def main():
    fx = {
        "fx/fx-paper-scrap-4f-8x8.png": fx_paper_scrap(),
        "fx/fx-ink-dot-3f-8x8.png": fx_ink_dot(),
        "fx/fx-cotton-3f-8x8.png": fx_cotton(),
        "fx/fx-sweat-4x6.png": fx_sweat(),
        "fx/fx-smoke-4f-12x12.png": fx_smoke(),
        "fx/fx-tie-fly-8x12.png": fx_tie_fly(),
        "emote/emote-operator-6f-16x16.png": strip([emote(n) for n in GLYPHS]),
    }
    for rel, img in fx.items():
        save(img, rel)

    ts, names = greybox_tileset()
    save(ts, "tiles/tiles-greybox-struct.png")
    (OUT / "tiles" / "tiles-greybox-struct.slots.json").write_text(
        json.dumps(names, indent=2) + "\n", encoding="utf-8")
    save(template_sheet(ts, names), "tiles/tiles-greybox-struct-labeled-3x.png")
    rooms = {}
    room_grey = sample_room(ts, names)
    for w in ("lobby", "warehouse", "brain", "brain-night", "exam", "liver"):
        save(recolor(ts, w), f"tiles/tiles-{w}-struct.png")
        rooms[w] = recolor(room_grey, w)

    skins = {
        "tiles/tiles-lobby-floor-marble.png": lobby_marble(),
        "tiles/tiles-exam-floor.png": exam_tiles(),
        "tiles/tiles-liver-floor-hex.png": hex_tiles(),
        "tiles/tiles-warehouse-safety-line.png": warehouse_lines(),
        "tiles/tiles-common-conveyor-12x4f.png": conveyor_sheet(),
    }
    for rel, img in skins.items():
        save(img, rel)

    boxes = {
        "props/box-plain.png": box(CARDBOARD),
        "props/box-pushable.png": box(CARDBOARD, corners=True),
        "props/box-glucose-pushable.png": box(hex_rgb(WORLDS["warehouse"][1]["glucose-box"]), True, deco_glucose),
        "props/box-glucose-noshift.png": box(hex_rgb(WORLDS["warehouse"][1]["glucose-box"]), False, deco_glucose),
        "props/box-acetaldehyde.png": box(C["acetaldehyde"], True, deco_acetaldehyde),
        "props/box-core-dump.png": box(CARDBOARD, False, deco_label),
        "props/box-welfare.png": box(CARDBOARD, False, deco_ribbon),
        "props/barrel-alcohol-immune.png": immune_barrel(),
    }
    for rel, img in boxes.items():
        save(img, rel)

    # previews: lobby room with a few props, and liver room with hex floor
    lobby = rooms["lobby"].copy()
    marble = lobby_marble()
    for y in range(4, 11):
        for x in range(1, 19):
            q = ((x // 2 + y // 2) % 2) * 4 + (y % 2) * 2 + (x % 2)
            lobby.alpha_composite(marble.crop(((q % 4) * T, (q // 4) * T, (q % 4 + 1) * T, (q // 4 + 1) * T)),
                                  (x * T, y * T))
    lobby.alpha_composite(boxes["props/box-pushable.png"], (8 * T, 6 * T))
    lobby.alpha_composite(boxes["props/box-welfare.png"], (12 * T, 5 * T))
    lobby.alpha_composite(boxes["props/box-glucose-pushable.png"], (15 * T, 8 * T))
    liver = rooms["liver"].copy()
    hexes = hex_tiles()
    for y in range(4, 11):
        for x in range(1, 19):
            liver.alpha_composite(hexes.crop((0, 0, T, T)), (x * T, y * T))
    conv = conveyor_sheet()
    for x in range(2, 17):
        liver.alpha_composite(conv.crop((0, 4 * T, T, 5 * T)), (x * T, 9 * T))
    liver.alpha_composite(boxes["props/box-acetaldehyde.png"], (6 * T, 6 * T))
    liver.alpha_composite(boxes["props/barrel-alcohol-immune.png"], (11 * T, 6 * T))
    liver.alpha_composite(boxes["props/barrel-alcohol-immune.png"], (12 * T, 6 * T))
    save(scale(lobby, 2), "preview/room-lobby-2x.png")
    save(scale(liver, 2), "preview/room-liver-2x.png")
    save(scale(rooms["brain-night"], 2), "preview/room-brain-night-2x.png")

    sheet_items = list(fx.values()) + list(boxes.values())
    sheet = canvas(sum(im.width * 2 + 6 for im in sheet_items) + 4, 72)
    x = 4
    for im in sheet_items:
        s = scale(im, 2)
        sheet.alpha_composite(s, (x, 4))
        x += s.width + 6
    bg = Image.new("RGBA", sheet.size, (*C["paper"], 255))
    bg.alpha_composite(sheet)
    save(scale(bg, 2), "preview/small-sprites-4x.png")
    print("drafts ->", OUT)


if __name__ == "__main__":
    main()
