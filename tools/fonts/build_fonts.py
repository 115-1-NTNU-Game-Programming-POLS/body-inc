import json
import os
import subprocess
import urllib.request
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.mutator import instantiateVariableFont

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STRINGS_PATH = PROJECT_ROOT / "content" / "strings" / "zh-TW.json"
DIALOGUE_DIR = PROJECT_ROOT / "content" / "dialogue"
OUTPUT_DIR = PROJECT_ROOT / "public" / "assets" / "fonts"
CACHE_DIR = PROJECT_ROOT / "tools" / "fonts" / ".cache"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 1. 收集遊戲實際使用的字元 (Base Corpus)
chars = set()
for code in range(32, 127):
    chars.add(chr(code))

extra_punc = "…—～,.:;?!)]}'」』〉》〕】\"'「『〈《〔【"
chars.update(extra_punc)

if STRINGS_PATH.exists():
    with open(STRINGS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
        chars.update(json.dumps(data, ensure_ascii=False))

if DIALOGUE_DIR.exists():
    for file_path in DIALOGUE_DIR.rglob("*.*"):
        if file_path.suffix in [".json", ".csv", ".txt"]:
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    chars.update(f.read())
            except Exception:
                pass

base_corpus_text = "".join(sorted(chars))
base_corpus_file = CACHE_DIR / "corpus_base.txt"
with open(base_corpus_file, "w", encoding="utf-8") as f:
    f.write(base_corpus_text)

print(f"Base Corpus: {len(chars)} 個唯一字元，已寫入 {base_corpus_file.name}")

# 2. 建立 +3500 常用字 Safety Net Corpus (依據常用 CJK 區間)
safety_chars = set(chars)
for cp in range(0x4E00, 0x5C00):
    safety_chars.add(chr(cp))
safety_corpus_text = "".join(sorted(safety_chars))
safety_corpus_file = CACHE_DIR / "corpus_safety.txt"
with open(safety_corpus_file, "w", encoding="utf-8") as f:
    f.write(safety_corpus_text)

print(f"Safety Net Corpus: {len(safety_chars)} 個字元，已寫入 {safety_corpus_file.name}")

# 3. 下載輔助函式
def download_font(urls, target_path):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as resp, open(target_path, "wb") as out:
                out.write(resp.read())
            return True
        except Exception:
            pass
    return False

FONTS = [
    {
        "name": "LXGWWenKaiTC-Regular.woff2",
        "temp": CACHE_DIR / "LXGWWenKaiTC-Regular.ttf",
        "weight": None,
        "urls": [
            "https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf",
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf"
        ]
    },
    {
        "name": "LXGWWenKaiTC-Bold.woff2",
        "temp": CACHE_DIR / "LXGWWenKaiTC-Bold.ttf",
        "weight": None,
        "urls": [
            "https://raw.githubusercontent.com/google/fonts/main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf",
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf"
        ]
    },
    {
        "name": "NotoSansTC-Regular.woff2",
        "temp": CACHE_DIR / "NotoSansTC-Variable.ttf",
        "weight": 400,
        "urls": [
            "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
        ]
    },
    {
        "name": "NotoSansTC-Bold.woff2",
        "temp": CACHE_DIR / "NotoSansTC-Variable.ttf",
        "weight": 700,
        "urls": [
            "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
        ]
    }
]

# 4. 執行下載、子集裁切與容量比較
results = []
for font in FONTS:
    output_path = OUTPUT_DIR / font["name"]
    temp_path = font["temp"]

    if not temp_path.exists():
        download_font(font["urls"], temp_path)

    input_ttf = temp_path
    if font["weight"] is not None:
        static_ttf = CACHE_DIR / f"{font['name'].replace('.woff2', '')}-static.ttf"
        if not static_ttf.exists():
            var_font = TTFont(temp_path)
            static_font = instantiateVariableFont(var_font, {"wght": font["weight"]})
            static_font.save(static_ttf)
        input_ttf = static_ttf

    # 產出 Base Corpus woff2
    cmd_base = [
        "pyftsubset", str(input_ttf),
        f"--text-file={str(base_corpus_file)}",
        f"--output-file={str(output_path)}",
        "--flavor=woff2", "--layout-features=*",
    ]
    subprocess.run(cmd_base, check=True)
    base_kb = output_path.stat().st_size / 1024

    # 產出 Safety Net woff2（僅測試容量）
    safety_output = CACHE_DIR / f"safety_{font['name']}"
    cmd_safety = [
        "pyftsubset", str(input_ttf),
        f"--text-file={str(safety_corpus_file)}",
        f"--output-file={str(safety_output)}",
        "--flavor=woff2", "--layout-features=*",
    ]
    subprocess.run(cmd_safety, check=True)
    safety_kb = safety_output.stat().st_size / 1024

    results.append((font["name"], base_kb, safety_kb))
    print(f"{font['name']}: Base = {base_kb:.1f} KB | +3,500 Safety Net = {safety_kb:.1f} KB")

print("\n--- Font Size Comparison Report ---")
for name, base_kb, safety_kb in results:
    print(f"{name:26}: {base_kb:6.1f} KB  ->  {safety_kb:6.1f} KB (+{(safety_kb-base_kb):.1f} KB)")