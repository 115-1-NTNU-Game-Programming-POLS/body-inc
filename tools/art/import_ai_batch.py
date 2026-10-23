"""Import selected Gemini outputs into art-src/ai/raw/ and stub their logs (art-direction 12.6).

Files must be named <prompt id>.<ext> as in gen_gemini_prompts.ASSETS. Only the one
selected image per id comes in; rejected candidates stay out of the repo.

    python tools/art/import_ai_batch.py <download dir> [--date YYYY-MM-DD]
    python tools/art/import_ai_batch.py --sheets-only

Existing logs are never overwritten, so hand-filled fields survive a re-import.
"""
import hashlib
import json
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

from PIL import Image, ImageDraw

from gen_gemini_prompts import ASSETS

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "art-src" / "ai" / "raw"
LOG = ROOT / "art-src" / "ai" / "log"
SHEETS = RAW / "_contact"
EXTS = (".png", ".jpg", ".jpeg", ".webp")

CATEGORY = {"A": "portraits", "B": "portraits", "C": "illustrations", "D": "concepts",
            "E": "props", "F": "props", "G": "props", "H": "textures",
            "I": "icons", "J": "icons", "K": "icons", "L": "icons", "M": "icons"}
POST_STEPS = ["select", "outline", "quantize", "remove-text", "pixel-cleanup", "style-board-check"]


def category(section):
    return CATEGORY[section[0]]


def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def stub_log(aid, sec, title, attach, prompt, dest, src, day):
    return {
        "id": aid,
        "title": title,
        "batch": "gemini-batch-1",
        "tool": "Gemini",
        "model": None,
        "date": day,
        "template": "tile v1-g" if sec.startswith("H") else "base v1-g",
        "prompt": prompt,
        "references": attach or None,
        "candidates": None,
        "selected": dest.relative_to(ROOT).as_posix(),
        "selected_sha256": sha256(dest),
        "source_name": src.name,
        "post": {s: s == "select" for s in POST_STEPS},
        "hours": None,
        "status": "raw",
    }


def import_dir(src_dir, day_override=None):
    by_id = {a[1]: a for a in ASSETS}
    found = {}
    for p in src_dir.iterdir():
        if p.suffix.lower() in EXTS:
            found.setdefault(p.stem, []).append(p)
    unknown = sorted(set(found) - set(by_id))
    dup = sorted(k for k, v in found.items() if len(v) > 1)
    if unknown or dup:
        sys.exit(f"unknown ids: {unknown}\nduplicate ids: {dup}")
    LOG.mkdir(parents=True, exist_ok=True)
    copied = logged = 0
    for aid, (src,) in sorted(found.items()):
        sec, _, title, attach, prompt, _ = by_id[aid]
        dest = RAW / category(sec) / (aid + src.suffix.lower())
        dest.parent.mkdir(parents=True, exist_ok=True)
        for other in dest.parent.glob(aid + ".*"):
            if other != dest:
                other.unlink()  # format changed between re-imports
        shutil.copy2(src, dest)
        if sha256(dest) != sha256(src):
            sys.exit(f"copy mismatch: {src}")
        copied += 1
        log = LOG / f"{aid}.json"
        if not log.exists():
            day = day_override or datetime.fromtimestamp(src.stat().st_mtime).date().isoformat()
            log.write_text(json.dumps(stub_log(aid, sec, title, attach, prompt, dest, src, day),
                                      ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            logged += 1
    missing = [a[1] for a in ASSETS if a[1] not in found and not list(RAW.glob(f"*/{a[1]}.*"))]
    print(f"copied {copied}, new logs {logged}, still missing {len(missing)}: {missing}")


def contact_sheets(thumb=240, cols=6):
    SHEETS.mkdir(parents=True, exist_ok=True)
    groups = {}
    for sec, aid, *_ in ASSETS:
        hits = list(RAW.glob(f"{category(sec)}/{aid}.*"))
        if hits:
            groups.setdefault(category(sec), []).append((aid, hits[0]))
    for cat, items in groups.items():
        rows = (len(items) + cols - 1) // cols
        cell_h = thumb + 18
        sheet = Image.new("RGB", (cols * thumb, rows * cell_h), (200, 200, 200))
        draw = ImageDraw.Draw(sheet)
        for i, (aid, p) in enumerate(items):
            im = Image.open(p).convert("RGB")
            im.thumbnail((thumb - 8, thumb - 8))
            x, y = (i % cols) * thumb, (i // cols) * cell_h
            sheet.paste(im, (x + (thumb - im.width) // 2, y + (thumb - im.height) // 2))
            draw.text((x + 4, y + thumb + 2), aid, fill=(12, 45, 94))
        sheet.save(SHEETS / f"contact-{cat}.jpg", quality=85)
    print(f"contact sheets -> {SHEETS}")


def main():
    args = sys.argv[1:]
    if "--sheets-only" not in args:
        if not args or args[0].startswith("--"):
            sys.exit(__doc__)
        day = args[args.index("--date") + 1] if "--date" in args else None
        if day:
            date.fromisoformat(day)
        import_dir(Path(args[0]), day)
    contact_sheets()


if __name__ == "__main__":
    main()
