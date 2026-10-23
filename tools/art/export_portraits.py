"""Re-export the existing organ portraits at dialogue size (art-direction 6.1, 6.2, 13.7).

assets/organs/<organ>-<state>.png  ->  public/assets/portraits/portrait-<organ>-<state>.png,
300 px tall, 60 KB at most, intestine renamed to gut. The originals are not redrawn.

    python tools/art/export_portraits.py
"""
from pathlib import Path

from PIL import Image

from postprocess import resize, save_small

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "organs"
OUT = ROOT / "public" / "assets" / "portraits"
RENAME = {"intestine": "gut"}


def main():
    n = 0
    for p in sorted(SRC.glob("*.png")):
        organ, state = p.stem.split("-", 1)
        organ = RENAME.get(organ, organ)
        img = Image.open(p).convert("RGBA")
        box = img.getchannel("A").getbbox()
        img = img.crop(box) if box else img
        disp = resize(img, (round(img.width * 300 / img.height), 300))
        dest = OUT / f"portrait-{organ}-{state}.png"
        save_small(disp, dest)
        n += 1
        print(f"{dest.name}  {dest.stat().st_size / 1024:.0f} KB")
    print(f"{n} portraits -> {OUT}")


if __name__ == "__main__":
    main()
