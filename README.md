# 人體股份有限公司（Body Inc.）

<img src="assets/brand/logo-lockup.png" alt="人體股份有限公司 Body Inc. 標誌" width="600">

國立臺灣師範大學「遊戲程式設計」（115-1）第七組的期末專題。玩家扮演資工系大二生小晨身體裡的營運長，走進各器官的世界探索、解謎並以文具進行輕戰鬥，對抗名為「速效顧問集團」的壞習慣，讓小晨撐到期末考。每個器官世界的核心機制就是該器官的生理知識，以職場諷刺的笑點包裝衛教，目標玩家是大學生。遊戲以 Phaser 3 開發，地圖以 Tiled 編輯。

2026-10-23 起，設計由管理模擬（拖曳血球代幣調度部門）轉為俯視角探索冒險，設計文件已改為第二版；`sim/`、`docs/specs/` 的內容與期中展示版屬於舊設計，哪些部分仍可沿用見設計文件第 17 節。遊戲本體的程式骨架已建立（見下方「遊戲程式」），架構見 `docs/architecture.md`、施工規劃見 `docs/build-plan.md`。期中提案用的展示版可以線上試玩：https://115-1-ntnu-game-programming-pols.github.io/body-inc-midterm-demo/ （原始碼在 [body-inc-midterm-demo](https://github.com/115-1-NTNU-Game-Programming-POLS/body-inc-midterm-demo)）。

## 資料夾內容

| 路徑 | 內容 |
| --- | --- |
| `docs/design-doc.md` | 遊戲設計文件（正本） |
| `docs/art-direction.md` | 美術指南：渲染架構、色票、視覺語法、角色與環境規格、介面與特效、AI 使用規範、素材清單與交付批次 |
| `docs/authoring/` | 給做房間與寫對話的組員：房間範本怎麼用、各物件類別怎麼填、章節怎麼串接、對話 CSV 的欄位 |
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
npm run dev          # 開發伺服器，標題畫面選新遊戲或繼續；WASD 移動、J 或左鍵釘書機（按住連射）、空白或 K 閃身、R 或中鍵駁回印章、E 或 Enter 互動、F1 顯示碰撞框
npm run verify       # 型別檢查、測試、邊界與地圖檢查、建置，提交前必跑
node tools/maps/make-greybox.ts         # 重新產生灰盒測試房間
node tools/maps/make-brain-corridor.ts  # 重新產生灰盒大腦走廊（狀態變體範例）
node tools/maps/make-caffeine-arena.ts  # 重新產生咖啡因 Boss 灰盒場地
node tools/maps/make-rest-room.ts       # 重新產生灰盒休息室（打卡機、午睡與就寢的床、NPC）
node tools/maps/make-room-template.ts   # 重新產生給內容組複製的房間範本
```

程式分成規則層 `src/core/`（純 TypeScript，可在 Node 執行，不得引用 Phaser 或瀏覽器）、轉接層 `src/app/` 與畫面層 `src/view/`，規則見 `docs/architecture.md`。違反分層的程式碼會讓 `npm run typecheck` 或 `npm run check` 失敗。合併到 `main` 時，GitHub Actions 會跑同一套檢查與美術檢查，通過後部署到 GitHub Pages。

畫面上的文字一律用 `src/view/text/fonts.ts` 的 `addText` 建立，中文字串放在 `content/strings/zh-TW.json`。Boot 會等字型載入完遊戲可能用到的每個字才開始；開發版遇到字表外的字或字型還沒載完就建立文字，會直接報錯。要模擬網路慢的冷啟動，在網址加上 `?fontDelay=4000`。

存檔透過 `src/app/storage.ts` 讀寫 `localStorage`（鍵名 `hbc.v1.*`），任何失敗都只在畫面左下角顯示提示，不會讓遊戲停下。存檔格式改版時，要在 `src/core/save/slots.ts` 調高版本並補上遷移函式，否則測試會失敗。開發版可在網址加上 `?storage=blocked` 或 `?storage=full` 模擬寫入失敗。

開發版可用網址跳過標題畫面，直接進指定的房間並指定進房時的狀態標籤，例如 `?room=greybox/brain-corridor&tags=sleep_debt:2,breakfast`：`room` 是 `public/assets/maps/` 下的「資料夾/檔名」，`tags` 的數值標籤寫成 `名稱:數值`、布林標籤只寫名稱。在外層卡牌（P1）完成前，這是看狀態變體的唯一方式。`sleep_debt` 也決定董事長精神係數 P，進而影響駁回量表的充能速度。`halves=2` 讓營運長只剩兩個半顆心，方便測試強制下班。加上 `gauge=100` 會以滿格的駁回量表開始，不必先打中 125 發釘書針就能試印章。`?room=greybox/caffeine-arena&gauge=100` 是續杯經理卡費因的 Boss 戰，在他舉起提案書時蓋章可以駁回提案；灰盒測試房間裡有推銷員、傳單手與腺苷各一。正式版忽略這些參數。

### 編輯地圖

做房間與寫對話的步驟、各物件類別怎麼填，見 [`docs/authoring/rooms-and-dialogue.md`](docs/authoring/rooms-and-dialogue.md)；新房間從 `public/assets/maps/_template/` 複製。以下是給程式組的重點。

用 Tiled 開啟專案根目錄的 `body-inc.tiled-project`，物件類別（Spawn、NPC、Door 等）與地圖屬性會以下拉選單出現。地圖放在 `public/assets/maps/<章節>/*.tmj`，同一個資料夾視為同一章。狀態變體做成名稱以 `variant:` 開頭的群組圖層，類別選 Variant 並填 `when` 條件式；進房時條件成立才會出現，房間裡標籤再變也不會即時切換。群組內的 `objects` 物件圖層放 Spawn 等玩法物件，`props` 物件圖層放道具：道具是從道具圖塊集（圖片集合，指向 `public/assets/props/*.png`）拖曳的圖塊物件，遊戲以同名的場景圖集影格畫出。變體內的圖塊圖層目前不會畫出，地圖檢查會報錯。範例見 `public/assets/maps/greybox/brain-corridor.tmj`。條件式只能用 `content/tags.json` 中的標籤與 `mod.` 開頭的修飾器。提交前執行 `node tools/check-maps.ts`，錯誤會以中文列出檔名與物件編號。新增敵人種類（`content/enemies.json`）後要重跑 `node tools/maps/make-tiled-project.ts` 更新下拉選單。

### 章節、打卡機與存檔

一個地圖資料夾是一章，章內房間怎麼接在一起寫在 `content/chapters/<章>.json`：每個 `links` 項目把兩扇名字對得上的門（Tiled 物件的 Name 欄）接起來，兩端 socket 必須相對。`node tools/check-maps.ts` 檢查兩端存在、socket 相對、沒有接兩次、沒有接去哪裡又沒上鎖的門、全章從起點可達、每間房有 PlayerStart、走過門後不會站在牆裡。新章節還要登記在 `src/app/content.ts` 的 `CHAPTER_FILES`，Boot 才會載入它的房間，漏掉時 `npm test` 會失敗。上鎖的門目前打不開，不算通路；`variant:` 圖層裡的門無法串接，必須上鎖。

房間之間的狀態由 `src/core/chapter/` 管：標籤、章內時鐘、血量與駁回量表、用掉的一次性觸發點、最近的打卡機。Trigger 的 `checkpoint` 是打卡機，存檔寫進 `hbc.v1.story`；強制下班會回到最近的打卡機，已用掉的觸發點保留，標籤與時鐘回到打卡時的狀態，黏身的腺苷層數跟著回來（只有睡覺會清），打卡之後用掉的午睡沙發隨時鐘還原而恢復可用。腺苷也會跟著過門，只有睡覺清得掉。午睡沙發（Bed 的 `nap`）每張只能用一次；就寢門（`sleep`）條件成立時結束這一章。NPC 與 `dialogue` 類的 Trigger 會開啟對話：對話開著時房間凍結，只有對話自己的輸入有效，狀態在 `ChapterState.dialogue`，所以對話和其他規則一樣可以重播。對話的寫法與檢查見上述製作說明；程式端的重點是讀檔與走法都在 `src/core/dialogue/`，標籤、時鐘與手冊頁的變動在 `src/core/chapter/talk.ts`，畫面在 `src/view/scenes/DialogueScene.ts`，說話者與版面登記在 `content/speakers.json`。`node tools/check-dialogue.ts` 已包含在 `npm run check`，`npm run check:release` 另外擋下 `fact` 還是 `pending` 的台詞。

### 編輯內容資料

`content/` 下的每個 JSON 檔都由 `content/schema/` 中對應的 schema 檢查，對應關係登記在 `tools/check-content.ts` 的 `RULES`。提交前執行 `node tools/check-content.ts`，會以中文列出檔名、欄位位置與問題，例如拼錯或多出的欄位。Boss 的招式與數值放在 `content/bosses/<id>.json`，每一招必須符合預警分級的長度，範圍招的有效時間不得超過閃身無敵幀，否則載入失敗。修改 schema 後要重跑 `node tools/content/make-content-types.ts`，重新產生程式使用的型別 `src/core/content/generated.ts`。

角色圖集由 `public/assets/atlases/index.json` 決定載入正式圖或佔位圖；加入正式圖集 `public/assets/atlases/<key>.json` 後須重跑 `python tools/art/make_placeholders.py` 更新索引。

## 數值模擬

需要 Node.js 22 以上。在 `sim/` 執行：

```
node check.js 500                 # 12 項教育預期檢查
node accept.js 1000               # 重玩性驗收（應變事件、機會事件、難度階梯）
node run.js 500 --extra --cards   # 各策略與各學期設定卡的詳細結果
node discriminate.js 500          # 鑑別力測試
```

所有參數集中在 `content/params.json`，模擬與遊戲讀同一份檔案；每項參數在 `notes` 中標註來自設計文件（DOC）或暫時假設（ASSUME）。新增或改名參數時，要一併更新 `notes` 與 `content/schema/params.schema.json`，否則 `node tools/check-content.ts` 會失敗。調整數值後請重跑 `check.js` 與 `accept.js`，兩者都必須通過。最近一次的輸出存在 `sim/*_out.txt`。

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
