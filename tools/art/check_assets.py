"""License and AI-log coverage check (art-direction 12.6). Exit 1 on any problem.

Every file under public/assets/ must match a row of docs/art/asset-license.csv (first match
wins, fnmatch patterns). Rows with ai_level other than none need their generation log:
  {stem}   -> the file name without extension
  {frame}  -> every frame of an atlas JSON that is a prompt id from gen_gemini_prompts
  a glob   -> at least one match

    python tools/art/check_assets.py
"""
import csv
import json
import sys
from fnmatch import fnmatch
from pathlib import Path

from gen_gemini_prompts import ASSETS

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / "docs" / "art" / "asset-license.csv"
LICENSES = {"team-original", "CC0-1.0", "CC-BY-4.0", "OFL-1.1"}
AI_LEVELS = {"none", "ai-assisted", "ai-generated"}
AI_IDS = {a[1] for a in ASSETS}


def logs_missing(row, rel):
    pattern = row["ai_log"]
    if not pattern:
        return [f"{rel}: ai_level {row['ai_level']} but no ai_log"]
    path = ROOT / rel
    if "{stem}" in pattern:
        need = [pattern.replace("{stem}", path.stem)]
    elif "{frame}" in pattern:
        if path.suffix != ".json":
            return []  # the PNG half of an atlas is checked through its JSON
        frames = json.loads(path.read_text(encoding="utf-8-sig"))["frames"]
        need = [pattern.replace("{frame}", f) for f in frames if f in AI_IDS]
    else:
        return [] if list(ROOT.glob(pattern)) else [f"{rel}: no log matches {pattern}"]
    return [f"{rel}: missing {n}" for n in need if not (ROOT / n).exists()]


def main():
    rows = list(csv.DictReader(CSV.open(encoding="utf-8-sig")))
    problems = []
    for i, r in enumerate(rows, 2):
        if r["license"] not in LICENSES:
            problems.append(f"csv line {i}: license {r['license']!r} not allowed")
        if r["ai_level"] not in AI_LEVELS:
            problems.append(f"csv line {i}: ai_level {r['ai_level']!r} unknown")
    files = sorted(p for p in (ROOT / "public" / "assets").rglob("*") if p.is_file())
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        row = next((r for r in rows if fnmatch(rel, r["path"])), None)
        if row is None:
            problems.append(f"{rel}: not covered by asset-license.csv")
        elif row["ai_level"] != "none":
            problems += logs_missing(row, rel)
    for m in problems:
        print(m)
    print(f"{len(files)} files, {len(rows)} rows, {len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
