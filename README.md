# 人體股份有限公司（Body Inc.）

<img src="assets/brand/logo-lockup.png" alt="人體股份有限公司 Body Inc. 標誌" width="600">

國立臺灣師範大學「遊戲程式設計」（115-1）第七組的期末專題。玩家扮演資工系大二生小晨身體裡的營運長，走進各器官的世界探索、解謎並以文具進行輕戰鬥，對抗名為「速效顧問集團」的壞習慣，讓小晨撐到期末考。每個器官世界的核心機制就是該器官的生理知識，以職場諷刺的笑點包裝衛教，目標玩家是大學生。遊戲以 Phaser 3 開發，地圖以 Tiled 編輯。

2026-10-23 起，設計由管理模擬（拖曳血球代幣調度部門）轉為俯視角探索冒險，設計文件已改為第二版；`sim/`、`docs/specs/` 的內容與期中展示版屬於舊設計，哪些部分仍可沿用見設計文件第 17 節。遊戲本體的程式骨架已建立（見下方「遊戲程式」），架構見 `docs/architecture.md`、施工規劃見 `docs/build-plan.md`。期中提案用的展示版可以線上試玩：https://115-1-ntnu-game-programming-pols.github.io/body-inc-midterm-demo/ （原始碼在 [body-inc-midterm-demo](https://github.com/115-1-NTNU-Game-Programming-POLS/body-inc-midterm-demo)）。

## 資料夾內容

| 路徑 | 內容 |
| --- | --- |
| `docs/design-doc.md` | 遊戲設計文件（正本） |
| `docs/art-direction.md` | 美術指南：渲染架構、色票、視覺語法、角色與環境規格、介面與特效、AI 使用規範、素材清單與交付批次 |
| `docs/specs/` | 設計文件的三份附錄：內容規格、玩家體驗流程與文案規格（兩者屬舊設計，部分可沿用）、衛教查證表（仍有效） |
| `docs/site/` | 把設計文件與附錄轉成網頁閱讀版的腳本與模板 |
| `sim/` | 數值模擬程式（Node.js），用來驗證數值是否傳達正確的衛教訊息；代幣與危機模型屬舊設計，需依設計文件第 9.6 節重新模擬 |
| `slides/proposal/` | 期中提案簡報（10/19）的原始檔 |
| `prototypes/feasibility/` | 可行性審查時的原型：因果追溯、p5.js 粒子與代幣拖曳、中文斷行測試 |
| `assets/organs/` | 器官員工插圖（江兆耘以 AI 生成並挑選，見 `art-src/ai/log/organs-legacy.json`），去背後縮為 512px；檔名為「器官-狀態」，狀態有 base、normal、warning、quit（肌肉目前缺 base） |
| `assets/brand/` | 團隊標誌：方形圖示 `badge-1024.png` 與橫式標誌 `logo-lockup.png`（皆為透明背景）。底稿由 Google Gemini 生成，生成圖的仿中文印文已換成「人體公司」，並調整構圖與去背 |

附錄與設計文件本文不一致時，以本文為準；已知差異列在設計文件的「附錄」一節。

## 遊戲程式

需要 Node.js 22.18 以上（直接執行 `.ts` 工具腳本）。在專案根目錄執行：

```
npm install
npm run dev          # 開發伺服器，WASD 移動、J 或左鍵釘書機（按住連射）、空白或 K 閃身、F1 顯示碰撞框
npm run verify       # 型別檢查、測試、邊界與地圖檢查、建置，提交前必跑
node tools/maps/make-greybox.ts   # 重新產生灰盒測試房間
```

程式分成規則層 `src/core/`（純 TypeScript，可在 Node 執行，不得引用 Phaser 或瀏覽器）、轉接層 `src/app/` 與畫面層 `src/view/`，規則見 `docs/architecture.md`。違反分層的程式碼會讓 `npm run typecheck` 或 `npm run check` 失敗。合併到 `main` 時，GitHub Actions 會跑同一套檢查與美術檢查，通過後部署到 GitHub Pages。

### 編輯地圖

用 Tiled 開啟專案根目錄的 `body-inc.tiled-project`，物件類別（Spawn、NPC、Door 等）與地圖屬性會以下拉選單出現。地圖放在 `public/assets/maps/<章節>/*.tmj`，同一個資料夾視為同一章。狀態變體做成名稱以 `variant:` 開頭的圖層，類別選 Variant 並填 `when` 條件式。條件式只能用 `content/tags.json` 中的標籤與 `mod.` 開頭的修飾器。提交前執行 `node tools/check-maps.ts`，錯誤會以中文列出檔名與物件編號。新增敵人種類（`content/enemies.json`）後要重跑 `node tools/maps/make-tiled-project.ts` 更新下拉選單。

角色圖集由 `public/assets/atlases/index.json` 決定載入正式圖或佔位圖；加入正式圖集 `public/assets/atlases/<key>.json` 後須重跑 `python tools/art/make_placeholders.py` 更新索引。

## 數值模擬

需要 Node.js 22 以上。在 `sim/` 執行：

```
node check.js 500                 # 12 項教育預期檢查
node accept.js 1000               # 重玩性驗收（應變事件、機會事件、難度階梯）
node run.js 500 --extra --cards   # 各策略與各學期設定卡的詳細結果
node discriminate.js 500          # 鑑別力測試
```

所有參數集中在 `sim/params.js`，每項標註來自設計文件（DOC）或暫時假設（ASSUME）。調整數值後請重跑 `check.js` 與 `accept.js`，兩者都必須通過。最近一次的輸出存在 `sim/*_out.txt`。

## 網頁閱讀版

需要 Python 3 與套件 `markdown`（`pip install markdown`）。在專案根目錄執行：

```
python docs/site/build.py
```

輸出在 `docs/site/dist/`（不納入版本控制），本文為 `index.html`，三份附錄各一頁。頁面之間以 `./` 連回本文，部署時本文需放在網站根目錄。網頁版的版本日期寫在 `docs/site/template.html` 的 masthead，更新文件時一併修改。

## 提案簡報

`slides/proposal/deck.json` 記錄投影片順序，`slides/proposal/slides/*.html` 每張一個檔案，講稿寫在各檔的 `<aside>`。簡報採 Claude Slides 的投影片格式（固定 1920×1080 畫布、全部使用行內樣式），修改後需重新發布才會更新線上版本。投影片中的圖片以 `/_blob/<id>` 參照線上簡報的素材庫，離開線上簡報不會顯示；封面的標誌即 `assets/brand/badge-1024.png` 縮為 640px 後上傳的版本。

## 組員

黃晨瑋（PM、技術負責）、楊成宇、王晨嬡、王欣媛、江兆耘、黃苡晴、劉哲瑋。分工見設計文件的「分工與時程」。
