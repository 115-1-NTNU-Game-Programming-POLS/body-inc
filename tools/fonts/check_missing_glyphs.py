import sys
from pathlib import Path
from fontTools.ttLib import TTFont

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FONTS_DIR = PROJECT_ROOT / "public" / "assets" / "fonts"
CORPUS_FILE = PROJECT_ROOT / "tools" / "fonts" / ".cache" / "corpus_base.txt"

if not CORPUS_FILE.exists():
    print("找不到 corpus 檔案，請先執行 build_fonts.py")
    sys.exit(1)

with open(CORPUS_FILE, "r", encoding="utf-8") as f:
    corpus_text = f.read()

font_files = list(FONTS_DIR.glob("*.woff2"))
if not font_files:
    print(" 找不到 .woff2 字型檔！")
    sys.exit(1)

# 支援 --test-fixture 參數：加入罕見字 "龘" 驗證是否會觸發 Fail
test_fixture_mode = "--test-fixture" in sys.argv
check_text = corpus_text + ("龘" if test_fixture_mode else "")

if test_fixture_mode:
    print("[Fixture Test Mode] 已加入罕見字 '龘'，預期結果為 FAIL")

all_passed = True
for font_path in font_files:
    font = TTFont(font_path)
    cmap = font.getBestCmap()
    missing = [char for char in check_text if ord(char) not in cmap]
    if missing:
        print(f"{font_path.name} 缺少 {len(missing)} 個字元: {missing[:10]}")
        all_passed = False
    else:
        print(f"{font_path.name} 涵蓋所有字元")

if test_fixture_mode:
    if not all_passed:
        print(" [Fixture Check Passed] Missing-glyph check 成功在罕見字測試中偵測到缺字並觸發 Fail！")
        sys.exit(0)
    else:
        print("Fixture 測試失敗：未偵測到缺字")
        sys.exit(1)

if not all_passed:
    sys.exit(1)

print("\n所有字型檔皆通過 Missing-glyph 檢查！")