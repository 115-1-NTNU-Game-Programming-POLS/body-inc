"""Sample rooms built from public/assets only, for the style-board check (art-direction 12.4 step 6).

    python tools/art/preview_rooms.py  ->  art-src/ai/review/room-<world>-2x.png
"""
import json
from pathlib import Path

from PIL import Image

from draw_drafts import sample_room

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "assets"
OUT = ROOT / "art-src" / "ai" / "review"
T = 32

# world -> [(prop id, tile x, tile y)], positions follow the room rules of 7.1 (wall items on rows 1-2)
ROOMS = {
    "brain": [("prop-clock-vent", 2, 1), ("prop-wall-board-frame", 15, 1), ("prop-coffee-machine-on", 3, 4),
              ("prop-coffee-machine-closed", 5, 4), ("prop-nap-sofa", 14, 8), ("prop-temp-desk", 8, 7),
              ("prop-punch-clock", 16, 4), ("prop-tea-station", 17, 4)],
    "brain-night": [("window-night-band", 2, 1), ("prop-night-desk-lamp", 4, 6), ("prop-night-monitor", 6, 6),
                    ("prop-night-vending", 16, 4), ("prop-night-cleaning-cart", 12, 8),
                    ("prop-night-exit-sign", 15, 2)],
    "liver": [("prop-hex-control-board", 2, 1), ("prop-production-machine", 8, 5), ("prop-alcohol-barrel", 4, 8),
              ("prop-alcohol-barrel", 5, 8), ("prop-acetic-bottle", 13, 4), ("prop-doc-mountain", 16, 6),
              ("prop-resign-drawer", 17, 8)],
    "warehouse": [("prop-steel-shelf", 2, 4), ("prop-steel-shelf", 3, 4), ("prop-steel-shelf", 4, 4),
                  ("prop-switch-lever", 16, 2), ("prop-wall-board-frame", 13, 1)],
    "lobby": [("prop-floor-guide", 4, 4), ("prop-elevator", 12, 1), ("prop-punch-clock", 2, 4),
              ("prop-tea-station", 3, 6), ("prop-office-desk", 14, 7)],
    "exam": [("prop-exam-projector", 2, 1), ("prop-exam-pc-desk", 4, 5), ("prop-exam-pc-desk", 6, 5),
             ("prop-exam-paper-desk", 12, 5), ("prop-exam-paper-desk", 14, 5)],
}


def main():
    names = json.loads((PUB / "tilesets" / "struct-slots.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    for world, props in ROOMS.items():
        ts = Image.open(PUB / "tilesets" / f"tiles-{world}-struct.png").convert("RGBA")
        room = sample_room(ts, names)
        for pid, tx, ty in sorted(props, key=lambda p: p[2]):
            src = PUB / "props" / f"{pid}.png"
            if not src.exists():  # program-drawn props live in the drafts
                src = ROOT / "art-src" / "drafts" / "props" / f"{pid}.png"
            im = Image.open(src).convert("RGBA")
            x = tx * T + (T - im.width) // 2 if im.width < T else tx * T
            y = ty * T if ty <= 2 else (ty + 1) * T - im.height  # floor props stand on their tile
            room.alpha_composite(im, (x, max(0, y)))
        room.resize((room.width * 2, room.height * 2), Image.NEAREST).save(OUT / f"room-{world}-2x.png")
    print(f"{len(ROOMS)} rooms -> {OUT}")


if __name__ == "__main__":
    main()
