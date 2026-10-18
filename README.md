# 人體股份有限公司（Body Inc.）

<img src="assets/brand/logo-lockup.png" alt="人體股份有限公司 Body Inc. 標誌" width="600">

國立臺灣師範大學「遊戲程式設計」（115-1）第七組的期末專題。玩家扮演大二生小晨身體裡的營運長，調度各器官部門、處理突發事件，讓小晨撐到期末考而不被送進急診。遊戲以 p5.js 開發，以職場諷刺的笑點包裝衛教知識，目標玩家是大學生。

目前處於企劃與原型階段，遊戲本體的程式碼尚未開始撰寫。期中提案用的展示版可以線上試玩：https://115-1-ntnu-game-programming-pols.github.io/body-inc-midterm-demo/ （原始碼在 [body-inc-midterm-demo](https://github.com/115-1-NTNU-Game-Programming-POLS/body-inc-midterm-demo)）。

## 資料夾內容

| 路徑 | 內容 |
| --- | --- |
| `docs/design-doc.md` | 遊戲設計文件（正本） |
| `docs/specs/` | 設計文件的三份附錄：內容規格、玩家體驗流程與文案規格、衛教查證表 |
| `docs/site/` | 把設計文件與附錄轉成網頁閱讀版的腳本與模板 |
| `sim/` | 數值模擬程式（Node.js），用來驗證數值是否傳達正確的衛教訊息 |
| `slides/proposal/` | 期中提案簡報（10/19）的原始檔 |
| `prototypes/feasibility/` | 可行性審查時的原型：因果追溯、p5.js 粒子與代幣拖曳、中文斷行測試 |
| `assets/organs/` | 器官員工插圖（江兆耘繪製），去背後縮為 512px；檔名為「器官-狀態」，狀態有 base、normal、warning、quit（肌肉目前缺 base） |
| `assets/brand/` | 團隊標誌：方形圖示 `badge-1024.png` 與橫式標誌 `logo-lockup.png`（皆為透明背景）。底稿由 Google Gemini 生成，生成圖的仿中文印文已換成「人體公司」，並調整構圖與去背 |

附錄與設計文件本文不一致時，以本文為準；已知差異列在設計文件的「附錄」一節。

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
