"""List colors outside the pixel palette in world pixel art (art-direction 12.5). Exit 1 if any.

Covers props, the world atlases and the tilesets; portraits, illustrations and paper-ink
icons are linear-filtered art and may carry in-between colors (12.4 step 3).

    python tools/art/check_palette.py
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from palette import pixel_palette

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "assets"
TARGETS = ["props/*.png", "atlases/atlas-common.png", "atlases/atlas-brain.png", "atlases/atlas-liver.png",
           "atlases/atlas-exam.png", "tilesets/*.png"]


def main():
    allowed = {tuple(c) for c in pixel_palette()}
    bad_files = 0
    files = sorted({p for t in TARGETS for p in PUB.glob(t)})
    for p in files:
        a = np.asarray(Image.open(p).convert("RGBA"))
        rgb = a[a[..., 3] > 0][:, :3]
        colors = {tuple(int(v) for v in c) for c in np.unique(rgb, axis=0)}
        off = sorted(colors - allowed)
        if off:
            bad_files += 1
            shown = ", ".join("#%02X%02X%02X" % c for c in off[:8])
            print(f"{p.relative_to(ROOT).as_posix()}: {len(off)} off-palette colors ({shown}{' ...' if len(off) > 8 else ''})")
    print(f"{len(files)} files, {bad_files} with off-palette colors")
    sys.exit(1 if bad_files else 0)


if __name__ == "__main__":
    main()
