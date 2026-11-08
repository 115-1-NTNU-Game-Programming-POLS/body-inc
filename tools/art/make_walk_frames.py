"""Derive the four operator.walk_down frames (idle, step A, idle, step B) from one base idle pose.

The base is the 32x48 front idle (see art-src/characters/operator-base-front.png, 29 rows tall).
The script lengthens the torso and legs, adds shoes, widens the vest, redraws the tie, makes the step frames
(raised leg, 1 px body bob, arm swing) and writes operator-front-0..3.png plus operator-front-sheet.png.
The shipped atlas was hand-finished on top of this output by the artist, so re-running it gives the starting
point, not the final frames.

Usage (from the repository root):
  python tools/art/make_walk_frames.py art-src/characters/operator-base-front.png out_dir
"""
import sys
from collections import Counter
from pathlib import Path
from PIL import Image

base_path, out_dir = sys.argv[1], Path(sys.argv[2]); out_dir.mkdir(parents=True, exist_ok=True)
W, H = 32, 48
src = Image.open(base_path).convert('RGBA')
cnt = Counter(p[:3] for p in src.getdata() if p[3])
top = [c for c, _ in cnt.most_common(16)]
near = lambda c: min(top, key=lambda q: sum((a - b) ** 2 for a, b in zip(c, q)))
rows = [[None if src.getpixel((x, y))[3] == 0 else near(src.getpixel((x, y))[:3]) for x in range(W)] for y in range(11, 40)]
HIP = 24
NAVY = (0x0C, 0x2D, 0x5E)
TEAL, TEAL_D = (0x2F, 0x9C, 0x95), (0x25, 0x7D, 0x86)
for y in range(27, 31):                       # wider vest: two teal columns on each side of the tie
    r = rows[y - 11]
    for x, c in ((13, TEAL), (14, TEAL), (18, TEAL_D), (19, TEAL_D)):
        if r[x] != NAVY: r[x] = c
TIE, TIE_D = (0xF2, 0xC2, 0x30), (0xE0, 0x9A, 0x2E)
for y in range(26, 33):                       # tie: knot, neck, blade, tip
    r = rows[y - 11]
    if y == 26: r[15], r[16], r[17] = TIE, TIE, TIE_D
    elif y == 27: r[16] = TIE
    elif y in (28, 29, 30): r[15], r[16], r[17] = TIE, TIE, TIE_D
    elif y == 31: r[16] = TIE_D
head_torso, legs = rows[:HIP], rows[HIP:]
ht = []
for i, r in enumerate(head_torso):            # longer torso: repeat three vest rows
    ht.append(r)
    if i in (17, 19, 21): ht.append(list(r))
plain = legs[1]
legs_l = legs[:2] + [list(plain) for _ in range(4)] + legs[2:]
SHOE = (0x39, 0x32, 0x37)
for k in (-3, -2, -1): legs_l[k] = [SHOE if (c and c != NAVY) else c for c in legs_l[k]]
for k in (-2, -1):
    r = legs_l[k]; lx = min(i for i, c in enumerate(r) if c); rx = max(i for i, c in enumerate(r) if c)
    r[lx - 1], r[lx] = NAVY, SHOE; r[rx + 1], r[rx] = NAVY, SHOE
legs_l.append([NAVY if c else None for c in legs_l[-1]])


def compose(raise_side=None, bob=0):
    out = [[None] * W for _ in range(H)]
    top_y = 46 - (len(ht) + len(legs_l)) + 1
    for i, r in enumerate(ht):
        for x in range(W):
            if r[x]: out[top_y + i - bob][x] = r[x]
    for half, xs in (('L', range(0, 16)), ('R', range(16, W))):
        rl = list(legs_l)
        if bob:
            rl = rl[:2] + rl[4:] if raise_side == half else rl[:2] + [list(plain)] + rl[2:]
        y0 = top_y + len(ht) - bob
        for i, r in enumerate(rl):
            for x in xs:
                if r[x]: out[y0 + i][x] = r[x]
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y in range(H):
        for x in range(W):
            if out[y][x]: im.putpixel((x, y), out[y][x] + (255,))
    return im


def swing(im, up_cols, down_cols, bob=1):    # one hand up 1 row, the other down 1 row
    y0, y1 = 32 - bob, 35 - bob; s = im.copy()
    for cols, d in ((up_cols, -1), (down_cols, 1)):
        for x in cols:
            col = [s.getpixel((x, y)) for y in range(y0, y1 + 1)]
            for i, p in enumerate(col): im.putpixel((x, y0 + i + d), p)
            im.putpixel((x, y1 if d == -1 else y0), s.getpixel((x, y1 + 1 if d == -1 else y0 - 1)))
    return im


L, R = range(10, 13), range(20, 23)
frames = [compose(), swing(compose('R', 1), R, L), compose(), swing(compose('L', 1), L, R)]
sheet = Image.new('RGBA', (W * 4, H), (0, 0, 0, 0))
for i, f in enumerate(frames):
    f.save(out_dir / f'operator-front-{i}.png'); sheet.paste(f, (i * W, 0))
sheet.save(out_dir / 'operator-front-sheet.png')
print(f'wrote 4 frames to {out_dir}, {len({p[:3] for p in sheet.getdata() if p[3]})} colours')
