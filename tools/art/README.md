# 美術管線腳本

本資料夾的腳本實作美術指南（`docs/art-direction.md`）第 12 與 13 節的流程。全部以 Python 3.12 執行，需要 Pillow、numpy 與 scipy，於 `body-inc/` 下執行。

## 執行順序

從一份乾淨的副本重建所有產物時，依下列順序執行；後面的腳本會讀前面的輸出。

| 順序 | 指令 | 產出 |
| --- | --- | --- |
| 1 | `python tools/art/palette.py` | `art-src/palette/` 的全域色票、像素色票與世界色票 |
| 2 | `python tools/art/draw_drafts.py` | `art-src/drafts/` 的程式草稿（骨架圖塊、方箱、特效、表情圖示） |
| 3 | `python tools/art/make_placeholders.py` | `public/assets/atlases/placeholder/` 的角色佔位圖集，與遊戲讀取的圖集索引 `public/assets/atlases/index.json`（有正式圖集的鍵指向正式圖） |
| 4 | `python tools/art/postprocess.py` | AI 原圖的自動後製：`public/assets/` 的頭像、插圖、道具、圖示，與 `art-src/ai/processed/` 的母檔和地板紋理 |
| 5 | `python tools/art/export_portraits.py` | 既有器官立繪的對話尺寸版 |
| 6 | `python tools/art/build_tilesets.py` | `public/assets/tilesets/` 的世界圖塊集、擠出版、Tiled 圖塊集與 `tilesets.json` |
| 7 | `python tools/art/pack_atlases.py` | `public/assets/atlases/` 的場景圖集與介面圖示圖集 |
| 8 | `python tools/art/review_sheets.py`、`preview_rooms.py` | `art-src/ai/review/` 的審查圖與範例房間 |
| 9 | `python tools/art/import_ai_batch.py --sheets-only` | `art-src/ai/raw/_contact/` 的原圖縮圖總表 |

第 4 至 9 步的中間產物（`art-src/ai/processed/`、`art-src/ai/review/`、`art-src/ai/raw/_contact/`）雖可重建，仍提交進 Git，讓沒有跑過管線的組員也能直接檢視。

新一批 AI 圖的流程是：改 `gen_gemini_prompts.py` 並重跑產生 prompt，生圖後把每個 id 選定的一張以 id 命名放進一個資料夾，執行 `python tools/art/import_ai_batch.py <資料夾>`，再從第 4 步往下跑。

## 檢查

以下四項在提交前執行，任一項失敗即不得提交。每支檢查都以故意做錯的輸入確認過它會失敗。

| 指令 | 檢查內容 | 鑑別測試 |
| --- | --- | --- |
| `python tools/art/check_assets.py` | `public/assets/` 每個檔案都被 `docs/art/asset-license.csv` 涵蓋，AI 素材都有生成紀錄 | 未登錄的檔案與缺紀錄的 AI 道具各一，皆失敗 |
| `python tools/art/check_palette.py` | 道具、場景圖集與圖塊集沒有像素色票以外的顏色 | 一個 `#010203` 像素，失敗 |
| `python tools/art/build_tilesets.py --check` | 擠出版依 margin 與 spacing 切回的每一格都與原圖相同 | 擠出版改一個像素，失敗 |
| `python tools/art/make_placeholders.py --check` | 正式角色圖集沒有缺少清單合約上的動畫標籤 | 刪掉一個標籤，失敗 |

## 自動後製的範圍與限制

`postprocess.py` 只做指南第 12.4 節六步中可以機械化的部分：以白底連通區域去背、移除脫離主體的裝飾星星、把接近墨藍的外框校正為 `#0C2D5E`、把接近色票的色塊吸附到色票、道具以盒狀取樣縮到目標像素再量化到像素色票並加 1 像素內描邊、圖示縮到 64 或 104 像素。像素道具量化後另做逐點清理：移除孤立像素、補滿針孔、把單像素雜點換成四鄰多數色；頭像母檔則補上一圈最小寬度（長邊的 0.6%）的墨藍外框，補足 AI 線條斷開或過細之處。第 4 步（移除生成文字）是人工目視，結果記在各生成紀錄的 `post.remove-text`。

自動版的品質足以拼房間與試玩，但機械清理無法取代逐點手修的判斷。江兆耘手修後，以同一個檔名覆蓋 `public/assets/` 中的檔案，並把生成紀錄的對應步驟改為 `true`（或把 `status` 改為 `final`）。之後重跑 `postprocess.py` 會跳過這些 id，不會蓋掉手修版；沒有改紀錄的話，手修版會被自動版覆蓋。

像素色票（`art-src/palette/body-inc-pixel.gpl`）是全域色、世界色與重點色各自展開成亮、基、暗三階的集合，對應指南第 2.3 節「每種材質最多 3 階，暗面往墨藍偏移」。

## 個別判斷

- 方箱類（葡萄糖箱、乙醛箱、核心傾印箱、福利紙箱）依指南第 7.4 節共用一副方箱骨架，遊戲使用 `art-src/drafts/props/` 的程式版，AI 圖判定不用。
- 酒精桶在像素化後由腳本退飽和 30% 並畫上 2 像素石灰斜線帶（第 5.6 節）。
- 夜間窗戶改用 `art-src/drafts/props/window-night-band.png` 的程式版（128 × 32 橫向窗帶），AI 圖判定不用。
- 證據軟木牆只取 AI 圖中央 60%，去掉木框後做成無縫紋理。
- 阿凱救援插圖第一版未通過復甦姿勢自檢（雙腿伸直、頭枕在下方手臂），以 v2 prompt 重生後由王晨嬡審過第 6.5 節的姿勢才放進 `public/assets/`。需要審查的圖放進 `postprocess.py` 的 `HOLD`，審過前只輸出到 `art-src/ai/processed/`。
- 肝臟世界的主地板改用程式畫的六角磚（格位 0 至 2 為素磚、3 為帶標記磚，32 像素一週期，可任意排列）；AI 生成的格柵地板在 2 倍顯示時過於雜亂，改發佈為第二種地板 `tiles-liver-floor-grate`。
- 地板紋理以半週期錯位交疊做成 64 像素一週期的無縫圖，量化成該世界地板的三階；圖塊集格位 0 至 3 是它的四個象限，鋪地板時須以 2 × 2 交錯排列，隨機混用會出現接縫。
