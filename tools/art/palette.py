"""Single source for the colors in docs/art-direction.md section 3.

Run directly to write art-src/palette/body-inc.gpl, palette.json and worlds.json.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# (key, hex, zh name)
GLOBAL = [
    # structure
    ("ink-navy", "#0C2D5E", "墨藍"),
    ("stage", "#1F2733", "舞台"),
    ("text-ink", "#2A2D34", "文字墨"),
    ("text-2", "#4A4F57", "次要文字"),
    ("note", "#5F646C", "註解"),
    ("disabled-frame", "#9A958A", "停用框"),
    ("charcoal", "#3B3F4A", "炭灰"),
    ("charcoal-dark", "#2C2F38", "炭灰暗"),
    ("stone", "#8A8F98", "石灰"),
    ("light-grey", "#C9CCD1", "淺灰"),
    ("paper", "#FBF8EF", "紙白"),
    ("highlight", "#FFFDF7", "高光白"),
    ("notebook-line", "#E2E9F1", "筆記本橫線"),
    ("notebook-margin", "#E8A09B", "筆記本邊線"),
    # semantic
    ("warn-red", "#C8372D", "正紅"),
    ("warn-red-dark", "#A12A21", "紅暗"),
    ("wine", "#9B2335", "酒紅"),
    ("wine-dark", "#6E1A27", "酒紅暗"),
    ("acetaldehyde", "#B04A7A", "乙醛紅紫"),
    ("heart", "#EE7A82", "愛心珊瑚粉"),
    ("badge-gold", "#FFC83D", "徽章金"),
    ("staff-yellow", "#FCC551", "員工黃"),
    ("staff-yellow-dark", "#E09A2E", "員工黃暗"),
    ("hilite-yellow", "#FFE873", "螢光黃"),
    ("sticky-yellow", "#FFF1A8", "便利貼黃"),
    ("blue-ink", "#2B4C8C", "藍墨"),
    ("operator-teal", "#2F9C95", "營運長青"),
    ("operator-teal-dark", "#1F6F6A", "營運長青暗"),
    ("drowsy", "#EAE4FF", "睏意紫"),
    ("drowsy-edge", "#6A5FB8", "睏意紫邊"),
    ("orange-lamp", "#E8772E", "橙燈"),
    ("yellow-lamp", "#F2C230", "黃燈"),
    ("pass-green", "#2F6B3A", "通過綠"),
    ("aid-green", "#3F9A5B", "急救綠"),
    # characters
    ("shirt", "#FFFDF7", "襯衫"),
    ("shirt-dark", "#D9DEE8", "襯衫暗"),
    ("pants", "#2E3A59", "褲子"),
    ("pants-dark", "#1E2740", "褲子暗"),
    ("skin", "#FDE3CF", "膚色"),
    ("skin-dark", "#F2BFA6", "膚色暗"),
    ("hair", "#4A3428", "頭髮"),
    ("hair-dark", "#2F2019", "頭髮暗"),
    ("night-crew", "#3B3F8C", "夜班制服"),
    ("night-crew-dark", "#2A2D66", "夜班制服暗"),
    # organ skins
    ("brain", "#FCB6C0", "大腦"), ("brain-dark", "#EF8FA2", "大腦暗"),
    ("liver", "#EF9998", "肝"), ("liver-dark", "#D77A7C", "肝暗"),
    ("stomach", "#F6D0CF", "胃"), ("stomach-dark", "#EFA7A2", "胃暗"),
    ("immune", "#FEEFE3", "免疫"), ("immune-dark", "#F2C9B8", "免疫暗"),
    ("gut", "#F7B7A6", "腸道"), ("gut-dark", "#E8968A", "腸道暗"),
    ("muscle", "#EE9A8C", "肌肉"), ("muscle-dark", "#D9786E", "肌肉暗"),
    # bosses
    ("cup", "#F4EBDD", "杯身"), ("cup-sleeve", "#8B5A3C", "杯套"), ("cup-lid", "#6B4A3A", "杯蓋"),
    # props
    ("cardboard", "#D2A86E", "紙箱"),
    ("grass", "#7FA36A", "系烤草地"),
]

# Index greys of the shared structure skeleton (art-direction 7.3), in world-table column order.
ROLES = ["wall-top-dark", "wall-top-light", "wall-face", "wall-face-shade", "skirting",
         "floor-main", "floor-alt", "floor-shade"]
INDEX_GREYS = [0x20, 0x40, 0xE0, 0xC0, 0x60, 0xD0, 0xB0, 0x90]

WORLDS = {
    "lobby": (["#3D4A66", "#5A6888", "#EFE6D6", "#D9CDB8", "#8C7B63", "#EDE4D3", "#DCCFB8", "#C2B49B"],
              {"elevator-light": "#F2C14E", "guide-blue": "#2B4C8C", "plant": "#5E8C61"}),
    "warehouse": (["#3B4250", "#566070", "#D8D3C8", "#BDB6A8", "#6E6A60", "#CFC9BC", "#C2BBAC", "#A69F90"],
                  {"glucose-box": "#F2D27A", "safety-line": "#E8C14A", "rack-blue": "#4F6A8F"}),
    "brain": (["#3A3F63", "#565C88", "#F3E9DA", "#DCCDB8", "#9B7A5C", "#AFC0D3", "#D9BE98", "#8EA0B6"],
              {"brain-pink": "#F08A8F", "coffee": "#7A5238", "vent-smoke": "#A99BC2"}),
    "brain-night": (["#1C2140", "#2B3260", "#5F6690", "#4A5078", "#3A3354", "#4E5E86", "#6E6478", "#3B4870"],
                    {"lamp": "#FFD98A", "screen": "#8FD3FF", "exit": "#7FD18B"}),
    "exam": (["#3A3F63", "#565C88", "#EEF0F2", "#D3D8DE", "#7D8794", "#CDD6DF", "#E4E8EC", "#AEB8C4"],
             {"paper": "#FFFDF7", "blackboard": "#3F5E52", "second-hand": "#2A2D34"}),
    "liver": (["#3E3446", "#5C4C5E", "#D9C7C2", "#BFA8A3", "#6B5560", "#B9B4B8", "#CFC6BE", "#958F96"],
              {"alcohol-amber": "#D9A441", "acetaldehyde": "#B04A7A", "acetic": "#4FA3A5", "pipe": "#7D6A8C"}),
    "stomach": (["#4A3A36", "#6A554E", "#F2DCC8", "#DCC0A8", "#8A6650", "#E9D6C3", "#F3E4D2", "#CDB59E"],
                {"logistics": "#E8955A", "cold": "#9CC7DE"}),
    "immune": (["#22364A", "#35506A", "#DCE6EA", "#C1CFD6", "#4B6478", "#C8D4D9", "#DDE5E8", "#A9B8C0"],
               {"guard-blue": "#2F6B9A", "pollen": "#C9D96B"}),
    "gut": (["#2F3D33", "#46594A", "#D8DCC4", "#BCC2A6", "#6A6E52", "#C6CDB0", "#D9D1B4", "#A6AE90"],
            {"flora": "#6FAF73", "fiber": "#E5D3A1", "water": "#7FB4C9"}),
}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


C = {k: hex_rgb(v) for k, v, _ in GLOBAL}


def _mix(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def pixel_palette():
    """Every global, world and accent color plus its light and dark step.

    Art-direction 2.3 allows three steps per material with the dark step shifted toward
    ink navy; pixel assets are quantized to this set and the palette check accepts it.
    """
    bases = [hex_rgb(v) for _, v, _ in GLOBAL]
    for cols, acc in WORLDS.values():
        bases += [hex_rgb(v) for v in cols] + [hex_rgb(v) for v in acc.values()]
    out = []
    for b in bases:
        for c in (b, _mix(b, C["highlight"], 0.35), _mix(b, C["ink-navy"], 0.28)):
            if c not in out:
                out.append(c)
    return out


def write_files():
    pal_dir = ROOT / "art-src" / "palette"
    pal_dir.mkdir(parents=True, exist_ok=True)
    gpl = ["GIMP Palette", "Name: body-inc", "Columns: 8", "#"]
    for k, v, zh in GLOBAL:
        r, g, b = hex_rgb(v)
        gpl.append(f"{r:3d} {g:3d} {b:3d}\t{k}")
    (pal_dir / "body-inc.gpl").write_text("\n".join(gpl) + "\n", encoding="utf-8")
    (pal_dir / "palette.json").write_text(json.dumps(
        {k: {"hex": v, "name": zh} for k, v, zh in GLOBAL}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    worlds = {"roles": ROLES, "indexGreys": [f"#{g:02X}{g:02X}{g:02X}" for g in INDEX_GREYS], "worlds": {}}
    for w, (cols, acc) in WORLDS.items():
        worlds["worlds"][w] = {"colors": dict(zip(ROLES, cols)), "accents": acc}
    (pal_dir / "worlds.json").write_text(json.dumps(worlds, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    px = ["GIMP Palette", "Name: body-inc-pixel", "Columns: 3", "#"]
    px += [f"{r:3d} {g:3d} {b:3d}\t#{r:02X}{g:02X}{b:02X}" for r, g, b in pixel_palette()]
    (pal_dir / "body-inc-pixel.gpl").write_text("\n".join(px) + "\n", encoding="utf-8")
    print(f"{len(GLOBAL)} global colors, {len(WORLDS)} worlds -> {pal_dir}")


if __name__ == "__main__":
    write_files()
