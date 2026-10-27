"""Check that the font stylesheets promise only glyphs the font files have (issue #15).

    python tools/fonts/check_fonts.py                         the real fonts.css and fonts-extra.css
    python tools/fonts/check_fonts.py --expect-missing X.css  passes only if X.css lacks a glyph

The font gate in src/view/text/fonts.ts trusts each @font-face's unicode-range: a character in
a loaded face's range counts as drawable. This reads every woff2 file a stylesheet names and
fails when its range holds a code point the file's cmap does not, or when two faces of one
family and weight claim the same code point. tools/check-fonts.ts (npm run check) covers the
other half, that the base ranges hold every character the content uses.

tools/fonts/fixtures/rare-glyph.css declares 龘 for a real base file; CI runs it with
--expect-missing to prove this check can fail.
"""

import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "public" / "assets" / "fonts"


def faces(css_path: Path):
    for body in re.findall(r"@font-face\s*\{([^}]*)\}", css_path.read_text(encoding="utf-8")):
        prop = lambda name: (re.search(rf"{name}\s*:\s*([^;]+)", body) or [None, ""])[1].strip()
        src = re.search(r"url\(\s*[\"']?([^\"')]+)", prop("src"))
        cps = set()
        for part in prop("unicode-range").split(","):
            m = re.fullmatch(r"U\+([0-9A-F]+)(?:-([0-9A-F]+))?", part.strip(), re.I)
            if m:
                a = int(m[1], 16)
                cps.update(range(a, int(m[2] or m[1], 16) + 1))
        yield prop("font-family").strip("\"'"), prop("font-weight"), (css_path.parent / src[1]) if src else None, cps


def problems(css_paths: list[Path]) -> list[str]:
    out = []
    claimed: dict[tuple[str, str], dict[int, Path]] = {}
    for css in css_paths:
        if not css.exists():
            out.append(f"{css}: missing; run python tools/fonts/build_fonts.py")
            continue
        for family, weight, file, cps in faces(css):
            where = f"{css.name} {family} {weight}"
            if file is None or not file.exists():
                out.append(f"{where}: font file {file} not found")
                continue
            if not cps:
                out.append(f"{where} ({file.name}): no unicode-range, so the gate counts every character as covered")
                continue
            lacking = sorted(cps - set(TTFont(file).getBestCmap()))
            if lacking:
                shown = " ".join(f"{chr(c)}(U+{c:04X})" for c in lacking[:20])
                out.append(f"{where} ({file.name}): unicode-range promises {len(lacking)} code points the file lacks: {shown}")
            seen = claimed.setdefault((family, weight), {})
            twice = sorted(c for c in cps if c in seen)
            if twice:
                out.append(f"{where} ({file.name}): {len(twice)} code points already declared by {seen[twice[0]].name}, from U+{twice[0]:04X}")
            seen.update((c, file) for c in cps)
    return out


def main(argv: list[str]) -> int:
    if argv[:1] == ["--expect-missing"]:
        found = problems([Path(argv[1]).resolve()])
        print("\n".join(found) or "no problem found")
        if not found:
            print(f"FAIL: {argv[1]} should have shown a missing glyph")
            return 1
        print("ok: the check reports the missing glyph")
        return 0
    css = [FONTS / "fonts.css", FONTS / "fonts-extra.css"]
    found = problems(css)
    for p in found:
        print(p)
    names = {f.name for f in FONTS.rglob("*.woff2")}
    used = {file.name for c in css if c.exists() for _, _, file, _ in faces(c) if file}
    for orphan in sorted(names - used):
        print(f"{orphan}: not named by any stylesheet; rerun python tools/fonts/build_fonts.py")
        found.append(orphan)
    print(f"font files: {len(found)} problem(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
