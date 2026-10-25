# 房間與對話製作說明

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

Trigger 的 `event` 有五種。`checkpoint` 是打卡機：營運長踩上去時存檔、補滿心，之後強制下班會回到這裡，每次踩上去都算，不受 `once` 影響。`clock_advance` 讓章內時鐘前進，`eventId` 填分鐘數，必須是 1 到 4 位數的整數，例如 `20`；留空、寫小數、`1e1` 或文字都會被地圖檢查擋下。`dialogue` 開啟對話，`eventId` 填對話 id。`card` 與 `cutscene` 會通知外層的卡片與過場，那兩個功能完成前沒有反應。

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

執行 `npm run check`（只想檢查地圖時執行 `node tools/check-maps.ts`，只檢查資料檔時執行 `node tools/check-content.ts`）。通過時最後一行是 `0 problem(s)`。有問題時每一行是一個問題，開頭是檔名，接著是物件編號與原因，例如：

```
public/assets/maps/brain/coffee-room.tmj 物件 #4（Door）：門「door-e」沒有接到任何房間，也沒有上鎖；請在章節檔連起來，或把 lock 設成上鎖
```

合併到 `main` 之前，GitHub 上的檢查會跑同一套規則，沒通過不能合併。

## 對話

對話寫在試算表裡，匯出成 UTF-8 的 CSV，放進 `content/dialogue/`，一個檔案可以放很多段對話。第一列是表頭，欄位名稱與順序固定：

| 欄位 | 內容 |
| --- | --- |
| `dialogueId` | 這一段對話的名字，Tiled 的 NPC 與 Trigger 就是用它接上；同一段對話的每一句都填同樣的名字 |
| `order` | 這一句在該段對話裡的順序，從 1 開始的整數 |
| `speaker` | 說話者，對應立繪檔名，例如 `liver` |
| `expression` | 表情，例如 `normal`，對應立繪的狀態 |
| `text` | 台詞；台詞裡有逗號或換行時，整格要用雙引號包起來 |
| `condition` | 預留給條件式，等對話功能完成前請留空 |
| `effect` | 預留給效果，例如解鎖手冊頁，等對話功能完成前請留空 |
| `next` | 預留給分支的下一句，等對話功能完成前請留空 |
| `fact` | 台詞若含生理說法，填衛教查證表的條目編號；查證尚未完成的填 `pending:編號`；沒有生理說法就留空 |

範例（`content/dialogue/greybox.csv`）：

```csv
dialogueId,order,speaker,expression,text,condition,effect,next,fact
greybox.liver.hello,1,liver,normal,歡迎。,,,,
```

目前的檢查只看表頭是否完全吻合、每一列的欄位數是否一致、`dialogueId` 有沒有填、`order` 是不是整數；Tiled 裡寫的 `dialogueId` 若不在任何 CSV 裡，地圖檢查會報錯。對話框、條件與效果、`fact` 為 `pending` 時擋下發佈，都屬於對話功能（建置計畫 P5），完成前玩家在遊戲裡只會看到「對話 xxx 尚未實作」。

## 尚未驗證的事

Tiled 在「另存新檔」時是否會改寫範本裡圖塊集的相對路徑，目前沒有在 Tiled 裡實際確認。範本與正式房間在同一層資料夾，直接複製檔案不會有路徑問題；若在 Tiled 裡另存新檔後圖塊消失，請改用檔案總管複製範本。
