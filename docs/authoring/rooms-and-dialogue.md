# 房間、對話與卡片製作說明

這份說明給用 Tiled 做房間、用試算表寫對話的組員。程式不需要改動：房間是 `public/assets/maps/` 下的 Tiled 檔，章節的房間怎麼接在一起寫在 `content/chapters/` 的一個 JSON 檔，對話寫在 `content/dialogue/` 的 CSV 檔。每一種檔案都有檢查腳本，錯誤會用中文指出檔名與位置。設計依據是設計文件第 13.2 與 13.3 節；說明與設計文件不一致時，以設計文件為準。

## 做一間房

先安裝 [Tiled](https://www.mapeditor.org/)，再用它開啟專案根目錄的 `body-inc.tiled-project`。物件類別（Door、NPC、Bed 等）與地圖屬性會以下拉選單或勾選框出現，不必背屬性名稱。

新房間從範本複製。`public/assets/maps/_template/` 有四份範本，依房間所屬的世界挑選：`room-lobby.tmj`（大廳）、`room-warehouse.tmj`（肝醣倉庫）、`room-brain.tmj`（大腦）、`room-liver.tmj`（肝）。把檔案複製到 `public/assets/maps/<章>/` 並改名，章是資料夾名稱，房間名稱只用小寫英文、數字與連字號，例如 `public/assets/maps/brain/coffee-room.tmj`。範本是標準的 20 × 12 格房間，南牆已開一個 2 格寬的門，並放了玩家出生點（PlayerStart）。範本刻意沒有填 `organ`、`role`、`estSeconds` 三個地圖屬性，沒填就交出去，地圖檢查會失敗。目前只有 1 × 1 的範本；2 × 1 與 2 × 2 的大房間尚未提供範本，需要時請找程式組。

地圖屬性填這幾項：`organ` 是房間所屬的器官，`role` 是房間的用途（combat、puzzle、rest、treasure、transit、core），`estSeconds` 是預估通關秒數，`difficulty` 為 1 到 3。有敵人是「打不掉」的類型時，教學房要在 `tutorialFor` 填那種敵人的 id，詳見設計文件 5.5 節與 13.3 節。

房間畫在兩個圖塊圖層上。`floor` 圖層是地板，只負責好看。`walls` 圖層的每一個非空格都是牆，營運長走不過去，所以地板上的家具不要畫在 `walls` 上，除非它真的要擋路。場景裝飾的做法見 README 的「編輯地圖」。

## 房間裡的物件

物件放在名為 `objects` 的物件圖層。從 Tiled 的類別下拉選單選類別後，只填需要的屬性。下表列出目前有效果的類別；Switch、Conveyor、Hazard、Pickup 目前只檢查格式，放進去不會有任何動作，要等負責的功能完成。

| 類別 | 做什麼 | 要填的屬性 |
| --- | --- | --- |
| PlayerStart | 營運長出生與強制下班（還沒打過卡時）回來的位置，每間房一個 | 無 |
| Spawn | 敵人生成點 | `enemyType` 從下拉選單選；`count` 數量；`respawnSeconds` 擊退後幾秒再出現，0 表示不再出現；`when` 條件式 |
| NPC | 可對話的角色，走近按 E 或 Enter | `npcId`、`dialogueId`（必須存在於對話 CSV）；`npcId` 與 `public/assets/manifest.json` 裡某個角色圖的名稱相同時（例如 `liver`），會自動畫出那個角色，否則畫一個佔位的人形 |
| Trigger | 營運長踩上去就觸發 | `event` 見下段；`eventId`；`once` 預設只觸發一次；`when` 條件式 |
| Door | 房間的門 | `socket` 朝哪個方向；`lock` 是否上鎖；**物件的 Name 欄必填** |
| Bed | 床 | `bedType` 是 `nap` 或 `sleep`；`requires` 條件式，成立才能用 |

Trigger 的 `event` 有五種。`checkpoint` 是打卡機：營運長踩上去時存檔、補滿心，之後強制下班會回到這裡，每次踩上去都算，不受 `once` 影響。`clock_advance` 讓章內時鐘前進，`eventId` 填分鐘數，必須是 1 到 4 位數的整數，例如 `20`；留空、寫小數、`1e1` 或文字都會被地圖檢查擋下。`dialogue` 開啟對話，`eventId` 填對話 id。`card` 翻開一張事件卡，`eventId` 填這一章卡組裡事件卡的 id，寫法見下方「卡片」一節。`cutscene` 會通知外層的過場，那個功能完成前沒有反應。

Bed 的 `nap` 是午睡沙發：時鐘前進 20 分鐘，黏在身上的腺苷全部回到原處，每張床只能用一次。`sleep` 是就寢門：條件成立就結束這一章，目前會回到標題畫面。`requires` 寫成條件式，例如 `caffeine<15`，不成立時床會回應「還睡不著」。條件式只能用 `content/tags.json` 裡的標籤，語法是標籤名、比較運算、驚嘆號否定、逗號表示「且」。

NPC、Bed、Trigger 可以畫成矩形，也可以只放一個點。放點的時候，遊戲以 1 格大小、置中在那個點上處理。門一定要畫成矩形。

Door 的 `socket` 位置是固定的，檢查腳本會逐一指出放錯的地方：北門在北牆第 9 至 10 欄，南門在南牆（最後一列）第 9 至 10 欄，西門在西牆第 6 至 7 列，東門在東牆第 6 至 7 列。門只有 `lock` 為 `none` 時才走得過去，其他值目前一律顯示「這扇門上鎖了」，鑰匙、開關等解鎖方式由後續功能補上。

## 把房間接起來

房間本身不知道門通往哪裡。章節的串接寫在 `content/chapters/<章>.json`，檔名與裡面的 `id` 必須和地圖資料夾同名。範例（`content/chapters/greybox.json`）：

```json
{
  "version": 1,
  "id": "greybox",
  "start": "greybox/greybox-room",
  "links": [
    { "a": "greybox/greybox-room#door-s", "b": "greybox/rest-room#door-n" },
    { "a": "greybox/rest-room#door-e", "b": "greybox/brain-corridor#door-w" }
  ]
}
```

`start` 是新遊戲進入的房間。`links` 的每一項把兩扇門接在一起，寫法是「房間路徑#門的名字」，房間路徑是資料夾加檔名、不含 `.tmj`，門的名字就是 Tiled 物件的 Name 欄。兩扇門必須面對面：北門接南門、東門接西門。接好之後從任一邊走過去，都會出現在另一間房的那扇門前。

檢查腳本對章節有幾條規定。每扇沒有上鎖的門都要接到某個地方；故意留著暫時不用的門，把 `lock` 設成上鎖即可。同一扇門只能接一次。整章的房間都要從 `start` 走得到，而上鎖的門目前打不開，所以只靠上鎖的門接起來的房間也算走不到。每間房都要有 PlayerStart。放在 `variant:` 圖層裡的門沒辦法寫進章節檔，所以那種門一定要上鎖，或移到變體圖層之外。新增一個地圖資料夾時，也要在 `content/chapters/` 加上同名的章節檔，漏掉會被檢查指出。要讓新章節出現在遊戲裡，還需要程式組把它登記進 `src/app/content.ts` 的 `CHAPTER_FILES`。

## 在瀏覽器試玩

在專案根目錄執行 `npm install` 與 `npm run dev`，用網址直接進指定的房間：

```
http://localhost:5173/?room=greybox/rest-room&tags=caffeine:50
```

`room` 是房間路徑；`tags` 是進房時身上的狀態標籤，數值標籤寫成 `名稱:數值`、布林標籤只寫名稱，用逗號隔開；`halves=2` 讓營運長只剩 2 個半顆心，方便測試強制下班；`gauge=100` 讓駁回量表直接是滿的。這些參數只在開發版有效，正式版會忽略。房間裡按 F1 可以看到碰撞框。

## 提交前

執行 `npm run check`（只想檢查地圖時執行 `node tools/check-maps.ts`，只檢查資料檔時執行 `node tools/check-content.ts`，只檢查對話時執行 `node tools/check-dialogue.ts`，只檢查卡片時執行 `node tools/check-decks.ts`）。通過時最後一行是 `0 problem(s)`。有問題時每一行是一個問題，開頭是檔名，接著是物件編號與原因，例如：

```
public/assets/maps/brain/coffee-room.tmj 物件 #4（Door）：門「door-e」沒有接到任何房間，也沒有上鎖；請在章節檔連起來，或把 lock 設成上鎖
```

合併到 `main` 之前，GitHub 上的檢查會跑同一套規則，沒通過不能合併。

## 對話

對話寫在試算表裡，匯出成 UTF-8 的 CSV，放進 `content/dialogue/`，一個檔案可以放很多段對話，同一個 `dialogueId` 不能出現在兩個檔案。第一列是表頭，欄位名稱與順序固定：

| 欄位 | 內容 |
| --- | --- |
| `dialogueId` | 這一段對話的名字，Tiled 的 NPC 與 Trigger 就是用它接上；同一段對話的每一句都填同樣的名字 |
| `order` | 這一句在該段對話裡的順序，從 1 開始的整數，同一段裡不能重複；播放順序看 `order`，不看列在檔案裡的先後 |
| `speaker` | 說話者代號，必須登記在 `content/speakers.json`；玩家的選項一律寫 `operator` |
| `expression` | 表情，對應立繪 `public/assets/portraits/portrait-<說話者>-<表情>.png`；玩家的選項可以留空 |
| `text` | 台詞或選項文字；有逗號或換行時，整格要用雙引號包起來 |
| `condition` | 條件式，語法與 Tiled 的 `when` 相同；不成立時這一句被略過，留空表示一定顯示 |
| `effect` | 這一句出現時（選項則是被選中時）發生的事，多個效果用分號隔開，寫法見下方 |
| `next` | 這一句之後接哪裡：另一列的 `order`，或 `end` 表示結束；留空就接下一列 |
| `fact` | 台詞若含生理說法，填衛教查證表的條目編號；查證尚未完成的填 `pending:編號`；也可以填 `general`，意思與標籤字典和字串表裡的 `general` 相同；沒有生理說法就留空 |

範例（`content/dialogue/greybox.csv` 中腦的簡報）：

```csv
dialogueId,order,speaker,expression,text,condition,effect,next,fact
greybox.brain.briefing,1,brain,normal,早安，營運長。今天的待辦有點多。,,,,
greybox.brain.briefing,2,brain,surprised,你的黑眼圈比昨天深了。,sleep_debt>=2,,,
greybox.brain.briefing,3,brain,normal,先從哪一件開始？,,,,
greybox.brain.briefing,4,operator,,先趕報告。,,tag:deadline;clock:30,7,
greybox.brain.briefing,5,operator,,先去補眠。,,clock:20,8,
greybox.brain.briefing,6,operator,,晚點再說。,,,end,
greybox.brain.briefing,7,brain,warning,好。截止時間逼近了，記得存檔。,,,end,
greybox.brain.briefing,8,brain,sleepy,好。睡醒再說。,,,,
```

### 一段對話怎麼走

對話從第一句開始往下走。說話者的句子顯示在對話框裡，按 E、Enter、J、空白鍵、K 或滑鼠左鍵繼續（互動、攻擊與閃身的按鍵都算確認）。連續 2 到 3 列 `speaker` 為 `operator` 的列是一組玩家選項，會以便利貼從畫面右側滑出；用 W、S 移動、再按確認鍵，或直接按 1、2、3，也可以用滑鼠點選項（選項出現時，滑鼠只有點中便利貼才算數，點在空白處不會送出目前選中的選項）。選了之後接著走那個選項自己的 `next`，沒填就接在這一組選項後面的第一列。`next` 只能指向比自己大的 `order`，所以每一段對話一定會結束；它也不能指向一組選項的中間。上面的範例裡，第 4 列選了之後接第 7 列，第 5 列接第 8 列，第 6 列直接結束，所以第 7 列要自己寫 `end`，否則會接著念第 8 列。

條件讀的是當下的標籤。說話者的句子條件不成立就略過，接著看下一列；選項條件不成立就不出現；一組選項全部不成立，整組略過；整段都被略過時，對話不會開啟。選項生效之後的下一句，看得到那個選項剛設定的標籤。

### 效果

`effect` 可以寫四種，用分號隔開，依序生效：`tag:名稱` 把布林標籤設為成立；`tag:名稱=數字` 把數值標籤設為該值；`tag:名稱+數字` 把數值標籤加上該值；`clock:分鐘` 讓章內時鐘前進，說話是花時間的；`unlock:手冊頁代號` 解鎖一頁員工手冊。對話只能改標籤字典裡來源含 `event` 或 `chapter` 的標籤，來源只有 `card` 或 `rule` 的標籤（例如咖啡因）由卡片或規則算出來，對話不能直接設定。名稱以 `mod.` 開頭的修飾器是由標籤條件算出來的，同樣不能設定，要改它所依據的標籤。每個標籤的變動都會記進因果紀錄，寫明是哪一段對話的哪一句造成的。

### 說話者與兩種版面

`content/speakers.json` 登記每個說話者的 `style` 與 `portrait`。每個說話者還要在 `content/strings/zh-TW.json` 有一則 `speaker.<代號>` 的名牌文字，少了的話 `node tools/check-content.ts` 會報錯。`operator` 是玩家選項專用的代號，不能登記。

`style` 為 `box` 的說話者使用畫面下方的對話框，左上角有名牌，立繪站在對話框左上方，下緣被框蓋住一截。`style` 為 `memo` 的說話者用在肝，肝不說話，沒有對話框，台詞寫在畫面中央偏右的一張便利貼上，立繪站在畫面左下。立繪每次只顯示正在說話的那一位；玩家選項出現時，對話框裡仍是上一句說話者的台詞。`portrait` 為 `false` 的說話者不需要立繪檔。

### 長度限制

對話框每行最多 30 個全形字、最多 3 行。玩家選項的便利貼最多 2 行，100% 字級每行 17 字，125% 字級每行 14 字，所以 28 字以內在兩檔字級都放得下。肝的便利貼最多 3 行，100% 字級每行 13 字，125% 字級每行 10 字，所以 30 字以內都放得下。斷行規則和遊戲相同，例如收尾標點不落在行首，所以標點多的句子可能比字數看起來更早換行。兩種便利貼的寬度是暫定值，美術確認前可能調整。

### 檢查

`node tools/check-dialogue.ts`（`npm run check` 已包含）用遊戲讀檔的同一支程式讀 CSV，所以它放行的檔案遊戲一定讀得進去。它檢查表頭與欄位數、`order`、條件式與效果的寫法、`next` 的目標存在且只往後、每組選項是 2 到 3 列、每一句都有辦法走到、說話者已登記、立繪檔存在、文字放得進版面，以及 `unlock:` 指到的手冊頁存在。有任何一列出問題，整段對話都不會載入，遊戲啟動時也會直接停下並列出問題，所以不會有只剩一半的對話；欄位數不對的那一列也一樣，整段對話會被整個略過，不會再連帶報出一串「找不到下一句」。訊息裡的列號和試算表顯示的一致，空白列也算一列。地圖檢查確認 Tiled 裡寫的 `dialogueId` 存在於某個 CSV，遊戲啟動時也會對每張房間地圖再確認一次，所以舊的打包檔不會等到玩到一半才出錯。

`npm run check:release` 多擋一項：`fact` 還是 `pending:編號` 的句子，表示衛教查證還沒完成，不能發行。目前沒有任何工作流程會自動執行它，發行前要手動跑一次。字串表 `content/strings` 裡的 `pending` 標記不在這個檢查的範圍內。

### 目前還沒有的

台詞整句直接顯示，沒有逐字出現的效果。員工手冊還沒做，所以 `unlock:` 目前只會跳出「員工手冊多了一頁」的提示並記進因果紀錄，不會留下解鎖狀態，等建置計畫 P6 補上。同一個 tick 只會開一段對話；同時踩到兩個對話觸發點時，後一個被丟掉；如果它是只觸發一次的觸發點，會還回來，離開再踩進去就能觸發。同理，整段都被條件略過、沒有開起來的對話，也不會用掉它的觸發點。每一句出現後的前 12 個 tick（0.2 秒）按鍵不算，避免戰鬥中按住的鍵把第一句直接跳過，這個時間是暫定值，要看試玩的感覺再調。

## 卡片

每一章的外層卡片寫在 `content/decks/<章>.json`，檔名與裡面的 `chapter` 都要和章節檔同名。卡片分兩種：章首卡在新遊戲進入第一間房之前依序翻開，決定這一章開局有多糟（例如昨晚幾點睡、早上有沒有喝咖啡）；事件卡在章節中途由 Tiled 的 Trigger 翻開，`event` 選 `card`、`eventId` 填事件卡的 id。範例（`content/decks/greybox.json` 的一部分）：

```json
{
  "version": 1,
  "chapter": "greybox",
  "opening": [
    {
      "id": "morning_coffee",
      "options": [
        { "id": "drink", "effect": "tag:caffeine=100" },
        { "id": "skip", "effect": "" }
      ]
    }
  ],
  "events": [
    {
      "id": "group_chat",
      "options": [
        { "id": "rewrite", "effect": "tag:deadline;clock:60" },
        { "id": "office_hour", "effect": "tag:stress+10" }
      ]
    }
  ]
}
```

章首卡最多 3 張，每張卡有 2 到 3 個選項。卡片 id 在整個卡組裡不能重複（章首卡與事件卡共用一套 id，因為卡面文字以 id 為鍵），同一張卡的選項 id 也不能重複。`effect` 的寫法與對話相同，留空表示這個選項不改變任何狀態，但選擇本身仍會記進因果紀錄，結算報告才知道玩家選了什麼。章首卡只能設定標籤字典裡來源含 `card` 的標籤，事件卡只能設定來源含 `event` 的標籤。

卡面文字放在 `content/strings/zh-TW.json`：題目是 `deck.<章>.<卡>.title`，每個選項的名稱是 `deck.<章>.<卡>.<選項>`，名稱下方的說明是 `deck.<章>.<卡>.<選項>.note`。題目最多 2 行，選項名稱最多 2 行，說明最多 4 行，在 100% 與 125% 字級都要放得下。選項說明是玩家做決定時唯一的線索，請寫出這個選擇在章節裡會造成的結果，例如「睡眠債 2 小時：走廊多兩個腺苷通風口」。

章首卡畫面可以用 W、S、A、D 或方向鍵移動，按 E、Enter、J 或空白鍵確定，也可以直接按 1、2、3 或用滑鼠點卡片。事件卡出現時房間與章內時鐘都會停住，用 W、S 移動、確認鍵確定、1 2 3 直接選，或點卡片；點在卡片以外的地方不算數。和對話一樣，卡片出現後的前 12 個 tick 按鍵不算。帶有事件卡的 Trigger 預設只觸發一次。

章內時鐘在探索時會自己走，現實 55 秒是遊戲裡 1 小時（`content/params.json` 的 `exploreSecondsPerHour`）；對話與事件卡打開時時鐘停住。咖啡因殘留隨時鐘以 5 小時半衰期遞減（`halfLife`），殘留 50 以上時腺苷完全看不到營運長，不會飄過來也不會黏上，25 到 50 之間只在 2 格內察覺，25 以下恢復正常。

`node tools/check-decks.ts`（`npm run check` 已包含）用遊戲讀檔的同一支程式讀卡組，檢查格式、id、效果寫法、卡面文字是否存在與放得下，並把每一種章首卡組合實際帶進章節：每間房都要進得去，而且在等待 24 小時之內，至少有一張 `bedType` 為 `sleep` 的床的 `requires` 會成立；每一張事件卡的每個選項也會疊在每種組合上再試一次。任何一種組合讓章節無法結束，檢查就失敗。檢查同時列出每種組合的敵人數、董事長精神 P 與「壓力」（敵人數除以 P），以及最難組合比最簡單組合難多少，設計文件的目標約 30%；這個數字只記錄、不會讓檢查失敗，而且它還沒有計入咖啡因隱身的好處。地圖檢查確認 Trigger 寫的事件卡存在於該地圖資料夾那一章的卡組，遊戲啟動時也會再確認一次。

## 尚未驗證的事

Tiled 在「另存新檔」時是否會改寫範本裡圖塊集的相對路徑，目前沒有在 Tiled 裡實際確認。範本與正式房間在同一層資料夾，直接複製檔案不會有路徑問題；若在 Tiled 裡另存新檔後圖塊消失，請改用檔案總管複製範本。
