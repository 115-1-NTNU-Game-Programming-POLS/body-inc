# 音效與音樂 cue 表

這份文件記錄遊戲裡每一個聲音在哪裡響、怎麼來的，以及怎麼量過響度。設計文件 5.7 與美術指南第 10 節規定了聲音的語氣和預警字幕，這裡只列實作的對應。聲音沒有自己的規則：什麼事件放什麼聲音寫在 `content/feedback.json` 的 `sound` 欄位，聲音本身和音樂寫在 `content/audio.json`，`tools/check-content.ts` 會檢查兩邊對得上。

音效不是檔案。每個音效是 `content/audio.json` 裡的一份配方（cue），由幾個音（tone，有音高的波形）和噪音（noise，帶濾波的白噪音）疊成，播放時由 `src/app/sound.ts` 用 Web Audio 即時合成，所以不佔下載量，也沒有授權問題。音樂才是檔案，共七首，都是 Kevin MacLeod 的 CC BY 4.0 作品，放在 `public/assets/audio/music/`。issue #13 原本只要求找音效檔和寫這份 cue 表，不含接線；音效系統因此改走合成，找檔案的部分只剩音樂。

## 音樂

七首曲目各自以代號登記在 `content/audio.json` 的 `music.tracks`，`scenes`、`chapters` 和 `boss` 決定哪裡播哪一首。換曲時舊曲淡出、新曲淡入（各 0.8 秒），要求同一首曲子不會重新開始。Boss 戰（有 Boss 且尚未擊敗）蓋過章節的曲子。每首曲子都限制在 1.5 MB 以內（美術指南 13.7），並正規化到 -18 LUFS，所以換曲時不會忽大忽小。

| 代號 | 曲名 | 用在哪裡 | 檔案 |
| --- | --- | --- | --- |
| `title` | Lobby Time | 標題畫面、輸入宿主名字 | `lobby-time.mp3`，單聲道 56 kbps，1.35 MB |
| `prologue` | Comfortable Mystery | 序章 | `comfortable-mystery.mp3`，單聲道 48 kbps，1.42 MB |
| `brain` | Monkeys Spinning Monkeys | 大腦章、灰盒測試房、大腦巡視 | `monkeys-spinning-monkeys.mp3`，立體聲 80 kbps，1.25 MB |
| `liver` | Quirky Dog | 肝臟章、肝臟巡視 | `quirky-dog.mp3`，立體聲 64 kbps，1.19 MB |
| `boss` | Run Amok | 期中考章、任何 Boss 戰 | `run-amok.mp3`，立體聲 96 kbps，1.29 MB |
| `cards` | Easy Lemon | 開場與結尾卡牌、證據牆 | `easy-lemon.mp3`，立體聲 80 kbps，1.26 MB |
| `semester` | Local Forecast - Elevator | 選課、學期畫面 | `local-forecast-elevator.mp3`，單聲道 56 kbps，1.32 MB |

出處和授權的逐首紀錄在 `docs/art/asset-license.csv`，標示文字依 incompetech 的要求寫成「曲名 Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/」。標題畫面底部有一行鳴謝，寫明作者、授權、更動方式和倉庫網址（倉庫是公開的），`README.md` 有逐首的完整名單。這是 CC BY 4.0 允許的「以連結指向完整資訊」的做法；若要在遊戲內列出七首曲名，需要另做一個鳴謝畫面。

原始 MP3 不放進版本庫。重建的方式是依 `content/audio.json` 每首的 `sourceUrl` 下載到一個資料夾，再執行 `node tools/audio/build-music.ts <資料夾>`，它會用 ffmpeg 做兩段式 loudnorm 到 -18 LUFS（真峰值 -1.5 dB），並在單聲道與立體聲的位元率階梯中挑出 1.45 MB 以內最高的一檔。`node tools/audio/build-music.ts --verify` 會重新量已建好的檔案，響度要在目標的 1 LUFS 內、大小不超過 1,500,000 位元組。需要先安裝 ffmpeg。

## 事件音效

下表由 `content/feedback.json` 的 `sound` 欄位整理。「聽感」是配方的樣子，不是規格；改音效時改 `content/audio.json` 的配方，再依下一節重新量響度。

| cue | 聽感 | 由哪些事件觸發 |
| --- | --- | --- |
| `staple` | 釘書機：一聲短的金屬喀，緊接較悶的擦（紙被壓穿），底下墊一點低音 | `fire` |
| `swing` | 公文夾揮出的風聲：漸強的氣流由低往高掃，比閃身短；隨連擊每步升一個半音 | `swing` |
| `swap` | 換文具的兩個上行短音 | `toolSwapped` |
| `guard` | 舉起公文夾的悶響 | `guardRaised` |
| `parry` | 退件：啪的一聲加清脆的雙音，有字幕 | `parry` |
| `blocked` | 擋下攻擊的鈍響；也是主管的盾擋下釘書針與輕揮的聲音 | `blocked`, `shieldBlocked` |
| `crack` | 破防：短促的碎裂聲加一個下行方波，再補一個 988 Hz 的三角波叮，有字幕 | `shieldBroken` |
| `refuse` | 婉拒：明亮的兩個音，是獎勵感的聲音，有字幕 | `refused` |
| `clink` | 烤吐司或杯子碰撞的清脆聲 | `toasted` |
| `dodge` | 閃身的氣流掃過：漸強再淡出，由高往低掠過，沒有撞擊感 | `dodge` |
| `perfect` | 完美閃身的三個上行高音 | `perfectDodge` |
| `hit` | 釘書針擊中 | `hit` |
| `closed` | 結案：低沉的蓋章加雙音 | `caseClosed` |
| `poof` | 散開的氣音 | `dispersed`, `bossSummon` |
| `reform` | 重組：倒過來的散開聲，輕輕漸強的氣音，中間冒出幾顆往上滑的泡泡聲 | `reformed` |
| `respawn` | 重生：一聲紙張的沙，接兩個不高的上行音，比換文具低 | `respawned` |
| `bump` | 撞牆：一聲輕的悶響，只在剛碰到牆時響一次 | `bumpWall` |
| `boing` | 彈開 | `immuneBounce`, `backedOff` |
| `nope` | 不行：兩個下行短音 | `stampVoid`, `handsFull` |
| `heart` | 受擊的低音：失去一顆心，或在考試裡被打中 | `heartLost`, `examHit` |
| `tick` | 時鐘的滴答，有字幕；見下節 | 剩一顆心時由場景每秒播一次 |
| `heartbeat` | 心悸的三聲心跳；心跳只給能量飲料 | `palpitation` |
| `stampUp` | 蓋章舉起 | `stampRaised` |
| `stampDown` | 碰：蓋章落下，有字幕 | `stampLanded` |
| `ready` | 駁回量表滿的喀聲，有字幕 | `gaugeFull` |
| `cling` | 黏住 | `bound`, `clung`, `examStacked` |
| `yawn` | 下行的哈欠 | `forcedLeave`, `bedUse`, `forcedNap`, `napped` |
| `door` | 進門 | `doorEntered` |
| `locked` | 門鎖住的兩聲；限時閘門關上時也用它，因為閘門關上就是一扇鎖住的門 | `doorLocked`, `portClosed` |
| `pick` | 撿起東西的上行音 | `canTaken`, `teaTaken`, `pickedUp`, `parcelOut` |
| `click` | 開關 | `switchChanged` |
| `thunk` | 箱子或貨物落位 | `boxDelivered`, `boxChilled`, `portFilled`, `crateTaken`, `mixerFed`, `orderThrown` |
| `punch` | 打卡 | `checkpointSaved` |
| `unlock` | 解鎖：四個上行音 | `handbookUnlocked`, `toolGranted`, `bonusShown`, `portOpened` |
| `card` | 翻開卡牌 | `cardOpened` |
| `choose` | 選定一個選項 | `cardChosen`，選單確認 |
| `rescue.step` | 救援一步做對：三個上行音 | `rescueStep`，`outcome` 為 `step` |
| `rescue.early` | 步驟太早：兩個下行短音 | `rescueStep`，`outcome` 為 `early` |
| `rescue.myth` | 迷思做法：三個下行音 | `rescueStep`，`outcome` 為 `myth` |
| `exam.solved` | 答對一題的短促上行音 | `examAnswered`，`how` 為 `solved` |
| `exam.time` | 時間到：兩個下行短音 | `examAnswered`，`how` 為 `time` |
| `exam.stacks` | 腺苷黏滿，本題失敗：兩個下行短音 | `examAnswered`，`how` 為 `stacks` |
| `done` | 完成：四個上行音 | `rescueDone`, `examResult`, `bossDefeated`, `bossConceded` |
| `bad` | 失敗：三個下行音 | `bedRefused`, `mixerJammed` |
| `proof.true` | 證明為真的蓋章加上行雙音 | `proofStamped`（`ok` 為真） |
| `proof.false` | 證明為假的蓋章加下行雙音 | `proofStamped`（`ok` 為假） |
| `blip` | 對話的短嗶 | `talk`, `dialogueOpened`；對話逐句前進時由對話畫面播放（見下方介面音效） |
| `gulp` | Boss 喝飲料 | `bossDrink` |
| `stage` | Boss 換階段或換回合的三個音 | `bossStage`, `bossRound` |
| `powerdown` | 斷電 | `powerCut` |
| `woke.mixer` | 鬧鐘：高低交替的四聲方波短嗶，胃的攪拌機在睡眠中響起的警報 | `sleepInterrupted`（cause 為 `mixer`） |
| `woke.hurt` | 驚醒：一聲短促上揚的三角波，挨打的受傷音之外只提示「醒了」，不放鬧鐘 | `sleepInterrupted`（cause 為 `hurt`） |
| `dizzy.true` | 暈眩：下行的搖晃音 | `dizzyChanged`，`dizzy` 為真 |
| `dizzy.false` | 恢復：上行雙音 | `dizzyChanged`，`dizzy` 為假 |
| `disco` | 迪斯可罐頭 | `canDisco` |
| `breath` | Boss 喘氣 | `bossBreath` |
| `shield` | 餡餅盾 | `pieRaised`, `pieBlocked` |

設計文件 5.8 規定音效全部取文具的聲音（釘書機的喀擦、公文夾的啪、印章的碰），連段時音高每段升半音；目前的聲音是合成的近似，不是錄音。升半音只接在 `swing`，因為只有 `swing` 事件帶連擊數。剩一顆心時是時鐘的滴答，不是心跳，因為設計文件把心跳留給能量飲料的心悸。婉拒（`refuse`）有專屬的聲音，因為設計文件要求格擋拒絕比喝下去更有成就感。

救援、暈眩與考試作答的 cue 以結果命名（`rescue.step`、`dizzy.true`、`exam.time` 等），`content/feedback.json` 用 `{outcome}`、`{dizzy}`、`{how}` 這樣的佔位符依事件的結果選聲音，所以做對和做錯聽起來不同。`rescue.early` 與 `exam.time`、`exam.stacks` 目前共用 `nope` 的配方，`rescue.myth` 共用 `bad`，`dizzy.false` 共用 `pick`；它們各有自己的 id，是為了日後單獨改，不是疏漏。考試結算（`examResult`）不論分數都播 `done`，因為事件本身只帶總分，沒有及格與否，而結算畫面已經顯示分數；要讓不同分數聽起來不同，需要規則層先把及格與否放進事件。蓋章命中 Boss 的提案時會同時發出 `stampLanded` 與 `proposalRejected`，聲音與字幕只由 `stampLanded` 負責，否則同一下蓋章會出現兩行相同的字幕。

目前沒有聲音的事件共 18 個：`refusalSaid`、`freeze`、`proposalRejected`、`boxMoved`、`triggerEntered`、`roomChanged`、`dialogueClosed`、`clockAdvanced`、`glucoseRefilled`、`rescueOpened`、`examStarted`、`examQuestion`、`examFinished`、`examForecast`、`examClosed`、`outerRequested`、`returnedToCheckpoint`、`chapterEnded`。其中換房間、記帳和面板開關這類事件由跟著發生的另一個事件負責聲音（進門有 `doorEntered`），戰鬥相關的幾個已在 #73 決定（見下方「戰鬥音效驗收」），其餘是尚未決定要不要配聲音；要補的話在 `content/feedback.json` 加 `sound` 欄位即可，內容檢查會確認 cue 存在。

與 issue #13 的差異：該 issue 假設音效是檔案，所以要求的欄位是檔案、長度、來源和負責人。音效改成合成配方之後沒有檔案可列，來源一律是 `content/audio.json` 的配方；音樂的檔案、大小與來源在上方的表和 `docs/art/asset-license.csv`。負責人欄沒有填：設計文件第 15 節把打擊與文具的聲音交給楊成宇，`staple`、`swing`、`hit`、`parry`、`stampDown` 等是否採用要由他確認。


## 戰鬥音效驗收（#73）

設計文件第 15 節把打擊與文具的聲音交給楊成宇。2026-11-09 由楊成宇戴耳機在 `npm run dev` 裡玩序章、大腦章與咖啡因 Boss（`?room=greybox/caffeine-arena&gauge=100`）逐一聽過，結果如下。

| 聲音 | 決定 | 說明 |
| --- | --- | --- |
| 釘書機（`staple`） | 改 | 舊版太尖、不像釘書機：骨幹是方波（電子嗶聲的音色），能量有三分之二在 2 kHz 以上。改成金屬喀加紙張擦的兩段，2 kHz 以上的能量降到約 37%。套用修正後 RMS 約 -22.3 dBFS，已在目標的 0.5 dB 內，峰值剛好在上限之下；舊版因峰值上限停在 -23.4 dBFS。 |
| 揮公文夾（`swing`） | 改 | 舊版沒有風聲感：主體是一個往下掉的低音，聽起來是撞擊。拿掉低音，改成 50 毫秒漸強的帶通氣流，由 600 Hz 掃到 1800 Hz；連擊升半音照舊。 |
| 換文具（`swap`） | 保留 | |
| 舉公文夾（`guard`） | 保留 | |
| 退件（`parry`） | 保留 | 有字幕，與 `stampDown`、`ready` 和三級預警的配方都沒有改，彼此仍然不同。 |
| 擋下（`blocked`） | 保留 | |
| 命中（`hit`） | 保留 | |
| 結案（`closed`） | 保留 | |
| 彈開（`boing`） | 保留 | 符合設計文件 5.5 的軟彈開。 |
| 閃身（`dodge`） | 改 | 舊版像衝刺撞到牆：聲音一開始就是最大聲，長度只有約 40 毫秒。改成 80 毫秒漸強、240 毫秒長的氣流，由 2000 Hz 往 500 Hz 掠過，再墊一層低通氣流。方向和 `swing` 相反，所以閃開與揮出聽得出差別。 |
| 完美閃身（`perfect`） | 保留 | |
| 扣血（`heart`） | 保留 | |
| 舉印章（`stampUp`） | 保留 | |
| 蓋章（`stampDown`） | 保留 | 設計文件 13.6 說駁回印章沿用期中版的蓋章聲，沒有改。 |
| 量表充滿（`ready`） | 保留 | |

漸強需要一個新的配方欄位：聲音的 `attack`（秒），以直線升到峰值；沒寫時照舊是 6 毫秒的起音。原本的起音固定 6 毫秒，任何聲音一開始都是最大聲，所以氣流聲聽起來都像敲擊。只有 `swing`、`dodge` 和新的 `reform` 用到它，其他配方沒有變。

改過或新增的六個 cue（`staple`、`swing`、`dodge`、`reform`、`respawn`、`bump`）都用校準頁重新量過，`trimDb` 是校準頁算出的值。校準頁同時算出 `exam.solved` 的修正是 8.5，與原本檔案裡的 2.5 不同。2.5 是新增時照抄同配方的 `choose`，但 `choose` 屬選單類（目標 -28 dBFS），`exam.solved` 屬一般效果（-22 dBFS），兩者差 6 dB，因此一併改為 8.5。

### 沒有聲音的戰鬥事件

| 事件 | 決定 | 理由 |
| --- | --- | --- |
| `bumpWall` | 配 `bump`，每次碰到只響一次 | 碰到牆有回饋比較紮實。規則層在營運長頂著牆的每一幀都會送出 `bumpWall`，所以由畫面層的 `WallContact`（`src/app/wallContact.ts`）只讓剛碰到的那一下出聲：x、y 兩個方向分開算，沿著牆滑進牆角時第二面牆也會響；離開牆一幀之後再碰才算新的一次。 |
| `reformed` | 配 `reform` | 腺苷打散 6 秒後重組（設計文件 5.5），往往發生在營運長已經轉身之後；聽得到「又聚回來了」，才學得到「硬打會無限重組」。一間房同時重組的腺苷不多，不會變成噪音。依楊成宇的意見加了泡泡聲。 |
| `respawned` | 配 `respawn` | 可結案的敵人在原本的出生點重新出現。楊成宇試玩時，重生都發生在畫面內看得到的地方，所以聲音不會讓人摸不著頭緒，反而提醒玩家「又有人來上班了」。音高比換文具（`swap`）低，也不是一級預警那種單一高音，不會和兩者混淆。 |
| `freeze` | 不配 | 命中停頓總是和命中（`hit`）、結案、蓋章或受擊同一幀發生，那些已經有聲音。 |
| `refusalSaid` | 不配 | 和婉拒（`refused`，播 `refuse`）同一幀發生，台詞已經用文字顯示。 |
| `proposalRejected` | 不配 | 和 `stampLanded` 同一幀，`stampDown` 已經響了；兩個聲音疊在一起只會更吵。 |
| `boxMoved` | 不配 | 每移動一格觸發一次；輸送帶上有好幾個箱子時，每秒會響好幾次。推箱的手感之後可以由謎題的負責人另外考慮，例如只在 `by` 為 `push` 時配聲音。 |
| `triggerEntered` | 不配 | 觸發區是看不見的劇情開關，配聲音會讓玩家發現它的位置；觸發之後打開的對話或事件自己有聲音。 |

## 預警與字幕

三個預警等級各有自己的聲音，聽起來不會混在一起：一級是單一高音的叮，二級是兩下掃過的唰唰，三級是影印機式的滾動噪音加四下悶響。

| cue | 聽感 | 事件 | 字幕 |
| --- | --- | --- | --- |
| `telegraph.1` | 1568 Hz 的叮 | `telegraph`，`tier` 為 1 | 【叮】出招 |
| `telegraph.2` | 兩下上掃的唰唰 | `telegraph`，`tier` 為 2 | 【唰唰】範圍攻擊 |
| `telegraph.3` | 影印機：滾動噪音加四下悶響 | `telegraph`，`tier` 為 3 | 【影印機】Boss 大招：可駁回 |

字幕是彈性工時的一個選項「預警音效加字幕」（設定檔的 `captions`，預設關）。開啟後，上表的警告、剩一顆心的滴答、駁回量表滿、退件、婉拒、破防和蓋章會寫成方括號字幕，顯示在畫面下方中央，同時最多三行。警告字幕停留的時間等於它的前搖（一級 30 tick、二級 48 tick，三級依招式在 72 到 90 tick 之間，取中間值 81 tick）；其他字幕停留一秒。同一行字幕再次出現時只延長時間，不重複。聲音來自敵人時，字幕前面有一個黃色箭頭指向敵人相對營運長的方向，來源在營運長身上（距離不到 24 像素）或沒有來源時不畫箭頭。幾個敵人同時發出同一階的預警時只顯示一行，箭頭指向最後一個；這是刻意的取捨，三行上限不夠每個敵人各佔一行。換房間時字幕全部清掉，因為箭頭指的是舊房間裡的敵人。

| 字串鍵 | 字幕 | cue |
| --- | --- | --- |
| `caption.telegraph.1` | 【叮】出招 | `telegraph.1` |
| `caption.telegraph.2` | 【唰唰】範圍攻擊 | `telegraph.2` |
| `caption.telegraph.3` | 【影印機】Boss 大招：可駁回 | `telegraph.3` |
| `caption.tick` | 【滴答】幹勁剩一顆 | `tick` |
| `caption.ready` | 【喀】駁回量表已滿 | `ready` |
| `caption.parry` | 【啪】退件 | `parry` |
| `caption.refuse` | 【婉拒】 | `refuse` |
| `caption.crack` | 【喀】破防 | `crack` |
| `caption.stamp` | 【碰】駁回 | `stampDown` |

## 介面音效

選單的音效由場景直接以名稱播放，不經過事件。

| cue | 用在哪裡 |
| --- | --- |
| `move` | 標題、暫停選單、選課的游標移動 |
| `choose` | 確定一項、改變一個設定值（改音效音量時在改完之後播放，所以聽到的是新的音量） |
| `back` | 離開暫停選單的上一頁、返回 |
| `page` | 員工手冊開啟、翻頁與關閉；也是 `examBreak` 與 `orderReturned`（退貨：翻紙退回去） |
| `blip` | 對話逐句前進與選定回覆（第一句由 `dialogueOpened` 的嗶聲負責） |

## 音量與響度

設定檔有「音樂音量」和「音效音量」兩個獨立的選項，各五檔（0%、25%、50%、75%、100%），0% 是關。A／D 一檔一檔調，到頭會繞回另一端；Enter 或點擊從 100% 繞回時跳過 0%、回到 25%，避免按一下就靜音。實際的增益是設定值的平方，所以 50% 聽起來像一半。音樂的增益是 0.5 乘設定值的平方，因為音樂檔在 -18 LUFS，音效校準後比它響。音效匯流排最後有一個限幅器（門檻 -2 dB），同時響起的多個 cue 不會破音。同一個 cue 在 `minGapMs`（預設 30 毫秒）內不會重新開始，避免連發的聲音疊成噪音。

每個 cue 的 `trimDb` 是校準值。校準頁是 `tools/audio/calibrate.html`：以 `npm run dev` 啟動後開 `/tools/audio/calibrate.html`，它用 `OfflineAudioContext` 以遊戲同一套合成程式把每個 cue 離線算一遍（不套 `trimDb`），量整個 cue 的 RMS（超過 200 毫秒的取最響的 200 毫秒），再算出讓它到達所屬類別目標所需的修正，並印出可貼回 `content/audio.json` 的 JSON。類別與目標如下：一般效果 -22 dBFS、預警 -17 dBFS、選單 -28 dBFS、時鐘滴答 -26 dBFS。修正值以 0.5 dB 為單位捨去，並受峰值上限限制（一般 -3 dBFS，預警 -2 dBFS），所以幾個峰值很高、RMS 很低的 cue 到不了目標：`clink`（-22.7）、`telegraph.1`（-17.8）、`telegraph.2`（-22.0）和 `telegraph.3`（-20.6），括號內是套用修正後的 RMS。其餘 cue 都在目標的 0.5 dB 內。改了配方或新增 cue 之後要重跑校準。

驗證過的事：在無頭 Chrome 裡，手勢之前沒有任何聲音，第一個按鍵之後音訊環境解鎖、音樂開始；`stampDown` 經過匯流排時量到峰值 0.36，音效音量 0% 時為 0，改回 100% 後恢復；音樂音量 0% 時播放器音量為 0；一顆心時的 `tick` 每秒一次。滴答以「這一幀跨過了新的一秒」判斷，不看 tick 是不是 60 的倍數：一幀可能跑兩個以上的規則 tick，用倍數判斷時，30 fps 且從奇數 tick 開始的畫面會一次都不響。`test/app/audio.test.ts` 用真的 `FixedStepLoop` 在 20 到 144 fps、不同起始 tick 下驗證。
