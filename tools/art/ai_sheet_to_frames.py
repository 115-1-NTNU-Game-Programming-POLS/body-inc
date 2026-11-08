"""Turn an AI-generated pose sheet into 32x48 frames on the game's pixel grid.

The AI image is a "pixel art" picture whose art pixels are about SH/48 screen pixels wide, so the sheet is a
(round(SW / (SH / 48)) x 48) pixel image. Steps:
  1. flood the background from the border at full resolution (white sleeves enclosed by the outline survive)
  2. sample every art pixel (majority colour of its cell) and snap it to the palette
  3. cut the poses apart (empty columns), put each into a 32x48 frame, feet on row 46, feet centre on column 16

Usage (from the repository root):
  python tools/art/ai_sheet_to_frames.py <sheet.png|webp> <out_dir> --name operator_attack_down
  python tools/art/ai_sheet_to_frames.py sheet.webp out --name suit_hurt --palette-from art-src/characters/suit-base-walk.png

--palette-from takes the colours of an existing sprite PNG (use it to keep an atlas within 16 colours);
without it the full art-src/palette/body-inc-pixel.gpl is used. Write the result next to the AI log of the asset.
"""
import argparse, re, sys
from collections import Counter, deque
from pathlib import Path
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('sheet'); ap.add_argument('out_dir')
ap.add_argument('--name', default='frame')
ap.add_argument('--palette', default='art-src/palette/body-inc-pixel.gpl')
ap.add_argument('--palette-from', help='PNG whose colours are the only ones allowed')
ap.add_argument('--bg-min', type=int, default=235, help='all channels above this count as background white')
a = ap.parse_args()

if a.palette_from:
    pal = sorted({p[:3] for p in Image.open(a.palette_from).convert('RGBA').getdata() if p[3]})
else:
    pal = [tuple(map(int, m.groups()[:3])) for l in open(a.palette)
           if (m := re.match(r'\s*(\d+)\s+(\d+)\s+(\d+)\s+#', l))]
snap = lambda p: min(pal, key=lambda q: sum((x - y) ** 2 for x, y in zip(p, q)))

src = Image.open(a.sheet).convert('RGB'); SW, SH = src.size
S = 2; w, h = SW // S, SH // S; px = src.resize((w, h), Image.NEAREST).load()
mask = [[False] * w for _ in range(h)]
dq = deque([(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)])
while dq:
    x, y = dq.popleft()
    if not (0 <= x < w and 0 <= y < h) or mask[y][x] or min(px[x, y]) <= a.bg_min: continue
    mask[y][x] = True
    dq.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

GH = 48; cy = SH / GH; GW = round(SW / cy); cx = SW / GW
native = Image.new('RGBA', (GW, GH), (0, 0, 0, 0))
for y in range(GH):
    for x in range(GW):
        pts = [(int(x * cx + cx * (0.15 + 0.7 * i / 4)), int(y * cy + cy * (0.15 + 0.7 * j / 4))) for i in range(5) for j in range(5)]
        inside = [p for p in pts if not mask[min(h - 1, p[1] // S)][min(w - 1, p[0] // S)]]
        if len(inside) < len(pts) / 2: continue
        c = Counter(tuple(v // 8 * 8 for v in src.getpixel(p)) for p in inside).most_common(1)[0][0]
        native.putpixel((x, y), snap(c) + (255,))

cols = [any(native.getpixel((x, y))[3] for y in range(GH)) for x in range(GW)]
poses, s = [], None
for x, c in enumerate(cols + [False]):
    if c and s is None: s = x
    if not c and s is not None: poses.append((s, x)); s = None

out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
native.save(out / f'{a.name}_native.png')
frames = []
for i, (x0, x1) in enumerate(poses, 1):
    sub = native.crop((x0, 0, x1, GH)); sub = sub.crop(sub.getbbox())
    xs = [x for y in range(sub.height - 3, sub.height) for x in range(sub.width) if sub.getpixel((x, y))[3]]
    dx = round(16 - sum(xs) / len(xs))
    f = Image.new('RGBA', (32, 48), (0, 0, 0, 0)); f.paste(sub, (dx, 46 - (sub.height - 1)))
    f.save(out / f'{a.name}_{i}.png'); frames.append(f)
    print(f'pose {i}: {sub.size[0]}x{sub.size[1]} px, bbox in frame {f.getbbox()}')
sheet = Image.new('RGBA', (32 * len(frames), 48), (0, 0, 0, 0))
for i, f in enumerate(frames): sheet.paste(f, (i * 32, 0))
sheet.save(out / f'{a.name}_sheet.png')
used = {p[:3] for p in sheet.getdata() if p[3]}
print(f'{len(frames)} frames, {len(used)} colours' + ('  (over 16!)' if len(used) > 16 else ''))
