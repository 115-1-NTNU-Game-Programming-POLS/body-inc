# 規則層數值審查（issue #11）

審查對象是 `src/core/` 裡會影響戰鬥與章節規則的常數，對照 `docs/design-doc.md`（以下簡稱「設計文件」）與 `docs/authoring/rooms-and-dialogue.md`（以下簡稱「製作說明」）。本次**沒有改任何數字**，也沒有動 `src/` 與 `content/`；新增的測試都在 `test/core/invariants.test.ts`。

審查基準：`main` 的 87b4cb7（2026-11-01）。

## 怎麼讀這張表

- **出處**：`DOC 5.3` 表示設計文件第 5.3 節有寫這個數字；`ASSUME` 表示設計文件沒寫，是施工時暫定的（程式註解或 `content/` 的 `notes` 也這麼標）；`製作說明` 表示規則寫在製作說明。
- **規則**：這個數字必須遵守的設計規則。只寫「值等於多少」的不算規則。
- **測試**：`檔名:行號 測試名稱`。標 **新** 的是本次在 `invariants.test.ts` 新增的測試。「只鎖數值」表示現有測試寫死了數字，調整數值時會誤報失敗，但規則本身另有測試涵蓋。
- **發現**：F1 到 F6 的內容見文末「發現」一節。F1 到 F4 已另開 issue（#59 至 #62），F5 建議直接修改製作說明，F6 只是備註。

新測試的原則：每個測試都從常數本身推導預期值，調數字但規則還在時測試照樣通過；只有規則被破壞時才會失敗。每個新測試至少用一個突變（故意改壞程式）驗證過會失敗，清單見文末。

## 1. 幀數（`src/core/combat/frames.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `BUFFER_TICKS` | 21（0.35 秒） | DOC 5.3 | 冷卻與收招中的輸入被緩衝 0.35 秒，不會被吃掉 | `combat.test.ts:123` a press during recovery or cooldown is buffered for 0.35 s, not dropped（同時鎖了 21） | |
| `STAPLER.startupFrame` | 3 | DOC 5.3（不超過 6） | 輕攻擊起手不超過 6 幀 | `combat.test.ts:50` the first staple exists within 6 frames of the press | |
| `STAPLER.intervalTicks`、`speed`、`rangePx`、`damage` | 10、14 格/秒、7 格、1 | DOC 6.1 | 數值本身由設計文件固定 | `combat.test.ts:57`、`:81`；`folder.test.ts:528` | F4（#62，與公文夾的每秒傷害比較） |
| `STAPLER.holdSpeedFactor` | 0.7 | DOC 6.1 | 按住連射是主動選擇的減速，在 15% 上限之後才乘 | `combat.test.ts:69` holding fire moves at 70%, applied after the 15% slow cap | |
| `STAPLER.lockHalfAngleDeg`、`lockRangePx` | 25 度、7 格 | DOC 5.2 | 軟鎖定只吸附可結案的目標；鎖定距離不超過釘書針射程 | `combat.test.ts:93`（角度與對象）；**新** soft lock never picks a target farther than a staple can fly | |
| `DODGE.ticks`、`distancePx` | 13 幀、2.5 格 | DOC 5.3 | 閃身 13 幀移動 2.5 格 | `combat.test.ts:107` covers 2.5 tiles in 13 frames | |
| `DODGE.iframeFirst`、`iframeLast` | 2、11 | DOC 5.3 | 無敵幀是第 2 至 11 幀，其他幀不是 | `combat.test.ts:113` is invincible on frames 2 to 11 and on no other frame | F2（#60） |
| `DODGE.recoveryTicks`、`cooldownTicks` | 6、18（0.3 秒） | DOC 5.3 | 冷卻內的輸入被緩衝 | `combat.test.ts:123` | |
| `DODGE.perfectLast` | 7 | DOC 5.3 | 完美閃身是無敵幀的前 6 幀，且在無敵幀之內 | **新** the perfect-dodge window is the first 6 i-frames and lies inside the dodge；行為面見 `combat.test.ts:167` | F6（演出未實作） |
| `HURT.freezeTicks`、`knockbackPx`、`invulnTicks` | 4、1 格、60 | DOC 5.3 | 被打中時全場凍結 4 幀、擊退 1 格、之後 1 秒無敵 | `combat.test.ts:146`、`:155`、`:175`、`:182` | |
| `HURT.knockbackTicks` | 12 | ASSUME | 無（設計文件只給距離） | `combat.test.ts:155` | |
| `ENEMY_HIT_FREEZE` | 3 | DOC 5.3 | 只凍結被打中的敵人 | `folder.test.ts:180`（3 與連段終結 6） | **F1**（#59） |
| `BASE_HALVES` | 12（6 顆心） | DOC 5.3、5.6 | 基礎 6 顆；上限 = round(6 × P)，不低於 4 顆 | 只有基礎值，上限與 P 連動沒有實作也沒有測試 | **F3**（#61） |
| `TELEGRAPH.tier1Ticks`、`tier2Ticks`、`tier3MinTicks`、`tier3MaxTicks` | 30、48、72、90 | DOC 5.3 | 各級長度固定；級數越高預警越長 | Boss 載入器檢查各級長度：`boss.test.ts:77`、`:84`；**新** warnings grow longer with their tier | |
| `ZONE_MAX_ACTIVE` | 10（由 `DODGE` 推導） | DOC 5.3 推導 | 範圍招的有效時間不超過無敵幀長度，所以在預警最後一刻閃身一定躲得掉 | `boss.test.ts:84`（載入器拒絕）、`boss.test.ts:137`（每招都閃得掉） | |
| `CHEERS`（乾杯小弟全部數值） | 見程式 | DOC 7.7（行為）；數值多為 ASSUME | 一級預警；被婉拒才算結案 | `cheers.test.ts`。不在本 issue 範圍內，列出備查 | |

## 2. 移動與減速（`src/core/combat/movement.ts`、`operator.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `MOVE.maxSpeed` | 4.5 格/秒 | DOC 5.3 | | `movement.test.ts:12` | |
| `MOVE.accelTicks`、`stopTicks` | 4、3 | DOC 5.3 | | `movement.test.ts:16`、`:21` | |
| `MOVE.slowCap` | 0.15 | DOC 5.1 | 所有看得見的減速來源合計不超過 15% | `movement.test.ts:31` caps the sum of slow sources at 15% | |
| 減速來源的大小 | 黏身每層 5%、暈眩 15% | DOC 5.5、7.7 | 黏滿 3 層剛好等於 15% 上限；任何單一來源不超過上限 | **新** clinging up to the stack limit is exactly the slow cap, and no single visible source exceeds it | |
| `FOLDER.guardSpeedFactor` | 0.4 | DOC 6.1 | 主動選擇的減速，不計入上限 | `folder.test.ts:269` | |

## 3. 駁回印章與量表（`frames.ts`、`src/core/spirit.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `STAMP.gaugeMax` | 100 | DOC 5.4 | 量表不超過上限 | `stamp.test.ts:108`（只鎖數值：125 發剛好充滿） | F6（充滿時間） |
| `STAMP.startupTicks` | 21（0.35 秒） | DOC 5.4 | 起手期間無敵，按下時清空量表 | `stamp.test.ts:141` | |
| `STAMP.radiusPx`、`damage`、`hitFreeze` | 3.5 格、25、10 | DOC 5.4、5.3 | | `stamp.test.ts:163`、`:168` | |
| `GAUGE.staple`、`folder`、`parry`、`perfectDodge` | 0.8、1.5、15、10 | DOC 5.4 | 各來源乘上 P；彈開打不動的對象不充能 | `stamp.test.ts:81` 至 `:99`；`folder.test.ts:188`、`:295` | |
| `sCoef`、`sFloor`（`content/params.json`） | 0.07、0.3 | DOC 名詞解釋 | S = max(0.3, 1 − 0.07 × 睡眠債) | `stamp.test.ts:58`（只鎖數值：1、0.72、0.65） | |
| `chairmanSpirit` | P = 0.5 + 0.5 × S | DOC 5.4 | P 隨睡眠債只降不升；睡飽時為 1；不低於下限 | **新** never rises with sleep debt, is 1 when rested and never falls below its floor | |
| `BOSS.stampDamage`、`reviewTicks`、`reviewDamageFactor` | 40、4 秒、1.5 | DOC 5.4 | 蓋在提案書上取消大招，進入審核中 | `boss.test.ts:175`、`:192`、`:200` | |

## 4. 黏身與強制打盹（`frames.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `CLING.slowPerStack`、`maxStacks` | 0.05、3 | DOC 5.5 | 第 3 層觸發強制打盹 | `stamp.test.ts:228`；總和等於上限見第 2 節的新測試 | |
| `CLING.napMinutes` | 60 | DOC 5.5 | 時鐘前進 1 小時，黏身清空，腺苷回原處重組，總數不減 | `stamp.test.ts:228`、`:242` | |
| `CLING.driftSpeed`、`senseRangePx` | 1 格/秒、5 格 | ASSUME | 無設計規則；斗篷只會縮小察覺範圍（見第 7 節） | `stamp.test.ts:193` | |
| `REFORM_TICKS` | 360（6 秒） | DOC 5.5 | 打散 6 秒後重組，總數不減 | `combat.test.ts:228` | |

## 5. 敵人（`frames.ts`、`src/core/combat/actors.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `SALESMAN.windupTicks`、`FLYER.windupTicks` | 都等於 `TELEGRAPH.tier1Ticks` | DOC 5.3 | 一般敵人的攻擊是一級預警 0.5 秒 | `combat.test.ts:146`（讀 `SALESMAN.windupTicks`，不讀分級）、`flyer.test.ts:50`；**新** every regular enemy attack telegraphs for exactly the tier-1 warning（推銷員、傳單手、能量飲料推銷員，實際量測） | **F1**（#59） |
| `SALESMAN.damageHalves`、`FLYER.damageHalves` | 1、1 | DOC 5.3 | 一般攻擊扣半顆；任何單擊不超過一顆半 | **新** a regular attack costs half a heart, and no single hit anywhere takes more than a heart and a half（也檢查兩個 Boss 的每一招與乙醛紅霧） | |
| `SALESMAN.speed`、`reachPx`、`strikeTicks`、`recoverTicks` | 1.5 格/秒、40、6、40 | ASSUME | 無 | `combat.test.ts:146` 至 `:182` 間接涵蓋 | |
| `FLYER.nearPx`、`farPx`、`shotRangePx` | 3 格、6 格、8 格 | ASSUME | 傳單手在自己偏好的距離內一定打得到營運長 | `flyer.test.ts:67`；**新** a flyer can reach the operator from anywhere in the band it keeps | |
| `FLYER.speed`、`throwTicks`、`recoverTicks`、`shotSpeed`、`shotHalf` | 1.2 格/秒、8、60、4 格/秒、3 | ASSUME | 無 | `flyer.test.ts` | |

## 6. 咖啡因 Boss（`frames.ts` 的 `BOSS`、`content/bosses/caffeine.json`、`bosses/boss.ts`、`bosses/caffeine.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| 每招的 `tier`、`telegraphSeconds` | 0.5、0.8、1.3 | DOC 5.3 | 預警符合所屬分級；載入器拒絕不符的檔案 | `boss.test.ts:77`、`:84` | |
| 每招的 `activeTicks` | 6、6 | ASSUME（上限是 DOC） | 範圍招有效時間不超過無敵幀 | `boss.test.ts:84`、`:137` | |
| 每招的 `halves` | 1、1、2 | DOC 5.3 | 一級扣半顆，招牌招扣一顆，任何單擊不超過一顆半 | `boss.test.ts:84`；**新**（同第 5 節，讀取實際載入的內容） | |
| 命中停頓對 Boss | Boss 不凍結 | DOC 5.3 推導 | 命中停頓不拉長 Boss 的預警 | `boss.test.ts:162` hit-stop never stretches a telegraph | |
| `budget`、`stage2Budget` | 300、200 | ASSUME | 第二階段在三分之二的預算 | `boss.test.ts:209` | |
| `drink`、殘留加速 | 1.2，第 3 杯起 1.1 | DOC 7.4 | 殘留 25 以上才加速 | `boss.test.ts:117`、`:124` | |
| `summon` | 每 10 秒 2 隻，上限 8 | ASSUME（召喚本身是 DOC） | 高潮選「再一杯」時加倍 | `boss.test.ts:217`、`:233` | |
| `powerCutSeconds` | 8 | DOC 7.4 | 殘留第一次降到 25 以下時斷電 8 秒，不移除任何東西 | `boss.test.ts:242`、`:275` | |

## 7. 咖啡因衰減與斗篷（`src/core/outer/caffeine.ts`、`content/params.json`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `cup`、`halfLife` | 100、5 遊戲小時 | DOC 7.4 | 每 halfLife 小時減半 | `cards.test.ts:194` | |
| 一杯咖啡在 23:00 剩多少 | 08:00 喝剩約 12；15:00 喝剩約 33 | DOC 7.4 | 早上那杯到 23:00 已不影響就寢門（低於 15）；下午三點那杯會讓門半開（15 至 50） | **新** a cup at 08:00 no longer holds the sleep door at 23:00, and a cup at 15:00 still half-closes it | |
| `CLOAK.blindAt`、`nearAt`、`nearPx` | 50、25、2 格 | DOC 7.4、9.2 | 50 以上看不見、25 到 50 只在 2 格內察覺；斗篷只會縮小察覺範圍，不會放大 | `cards.test.ts:232`、`:250`、`:257`；**新** the cloak only ever narrows sight | |
| `bossSecondsPerHour` | 6 | DOC 7.2 | Boss 時鐘下半衰期為 30 秒 | `boss.test.ts:110` | |
| `exploreSecondsPerHour` | 55 | DOC 7.2 | 探索時 1 遊戲小時約 55 秒 | `cards.test.ts:171` | |

## 8. 血糖（`src/core/chapter/glucose.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `GLUCOSE.start` | 55 | ASSUME | 早上的起始值在正常帶內 | `prologue.test.ts:222`；**新**（見本節最後一列） | |
| `GLUCOSE.drainTicks` | 180（3 秒） | DOC 7.3 | 走動每 3 秒降 1，站著不降 | `prologue.test.ts:229` | |
| `GLUCOSE.refillBelow`、`refillTo` | 40、45 | DOC 7.3 | 低於 40 時肝補到 45；倉庫開著時永遠不會停在 40 以下 | `prologue.test.ts:239`、`:265` | |
| `GLUCOSE.band` | 40 至 70 | DOC 7.3 | | 見本節最後一列 | |
| `GLUCOSE.dizzyBelow`、`shutFloor` | 35、30 | DOC 7.7、ASSUME | 只有倉庫關著時才會跌破 35 並暈眩，停在下限 | `liver.test.ts:232`、`:240` | |
| `GLUCOSE.dizzySlow` | 0.15 | DOC 7.7 | 暈眩減速 15%，計入上限 | `liver.test.ts:247`；上限見第 2 節的新測試 | F5 |
| 上述數值之間的關係 | | DOC 7.3、7.7 | 起始值與補貨目標在正常帶內；補貨目標高於補貨門檻；暈眩線不高於補貨門檻；關倉下限低於暈眩線 | **新** the morning value and the refill target lie in the normal band, and only a shut warehouse reaches the dizzy line | |

## 9. 午睡沙發（`src/core/chapter/chapter.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `NAP.minutes` | 20 | DOC 7.4 | 午睡 20 分鐘、黏身層數清空、每張限用一次 | `chapter.test.ts:259` a nap takes 20 minutes, sends the clinging stacks home, and works once per bed；打卡前後的還原規則見 `chapter.test.ts:458`、`:469` | |

## 10. 推箱與輸送帶（`src/core/rooms/boxes.ts`）

| 常數 | 目前的值 | 出處 | 規則 | 測試 | 發現 |
| --- | --- | --- | --- | --- | --- |
| `PUSH.delayTicks` | 10（約 1/6 秒） | 製作說明 | 貼著箱子持續按住一段時間才推動；連續推不再重新等待 | `boxes.test.ts:84`、`:105`、`:131` | |
| `PUSH.slideTicks` | 12 | ASSUME | | `boxes.test.ts:95` | |
| `CONVEYOR_TICKS` | slow 60、normal 30、fast 15（每秒 1、2、4 格） | 製作說明 | 三種速度依序變快；沒有減速時逆著走一定前進得了；按住連射時 fast 輸送帶會把營運長往後帶 | `boxes.test.ts:215`、`:237`；**新** belts are slow, normal and fast in that order；**新** an unslowed operator makes headway against every belt; holding fire, the fast belt carries them back | F5 |

## 發現

### F1　命中停頓會拉長一般敵人的預警（#59）

`src/core/combat/actors.ts:119` 在敵人 `frozen > 0` 時直接 return，windup 的 `phaseTicks` 不前進。所以在推銷員或傳單手預警期間打中它，預警就會被拉長：每發釘書針 3 幀、連段終結 6 幀、印章 10 幀。實測：傳單手預警期間按住連射，兩發釘書針命中，預警從 30 幀變成 36 幀。Boss 不受影響，因為 `src/core/game.ts:580` 對 Boss 把 `frozen` 設為 0，`boss.test.ts:162` 也有測試。

設計文件 5.3 把一級預警定為 0.5 秒，同時規定敵人被命中時凍結 3 幀。兩條規則在這裡衝突，需要決定哪條優先：(a) 凍結期間 windup 照樣計時，畫面上的停頓只是演出；(b) 接受預警被拉長，在設計文件註明「預警長度不含命中停頓」。在決定之前，本 PR 不為這條規則寫測試；新測試量的是沒有被打中時的預警長度。

處理結果（#65，2026-11-02）：採 (a)。預警與出招在命中停頓期間照常計時，停頓只剩演出，所以預警恰好是該級的長度，出招也準時落下；停頓剩下的幀數在敵人進入下一階段時捨棄。被裝訂的釘住（`EnemyState.pin`，由 `isBound` 讀取）仍然停住一切，包括預警。設計文件 5.3 與 8.8 已註明，`test/core/hitstop.test.ts` 有測試。

### F2　閃身第 1 幀沒有無敵（#60）

程式與設計文件 5.3 一致：無敵幀是第 2 至 11 幀（`operator.ts:138`，`combat.test.ts:113`）。後果是：在攻擊命中的同一幀按下閃身，那一幀還不是無敵，會被打中。正面閃進迎面飛來的咖啡杯時特別明顯（見 `docs/build-plan.md` P4 段落）。

這不違反「每招都閃得掉」：在預警最後一幀按下閃身，命中幀已經是閃身的第 2 幀（`boss.test.ts:137`）。玩家需要比命中早 1 幀按，在 60 Hz 下約 17 毫秒，加上 0.35 秒的輸入緩衝，大多數情況感覺不到。需要決定的是：要維持設計文件（第 1 幀是起步，不無敵），還是改成 1 至 11 幀讓反應更寬鬆。後者會讓完美閃身的窗口跟著前移，也要一併更新 5.3。建議留到戰鬥試玩後再決定。

處理結果（#65）：維持第 2 至 11 幀，理由與上面相同，設計文件 5.3 已記錄，留到戰鬥試玩再決定。

### F3　幹勁上限沒有跟著 P 變動（#61）

設計文件 5.6 與 9.2：幹勁上限 = round(基礎 6 顆 × P)，不低於 4 顆；睡眠債 0 至 2 小時 6 顆、3 至 7 小時 5 顆、8 小時以上 4 顆。目前 `newOperator` 的 `maxHalves` 在 `game.ts:403` 與 `chapter.ts:296`、`:310` 都直接用 `BASE_HALVES`，P 只影響印章充能，所以睡眠不足的五個管道（5.6）少了一個。build-plan 的進度紀錄沒有提到這項延後。

處理結果（#65）：已實作。`heartCap(p)`（`frames.ts`）是基礎心數乘 P 後四捨五入到整顆、不低於 4 顆，`createGame` 進房時套用，帶進房間的心會被壓到新上限。HUD 把暫停營業的心畫成灰色，並在時鐘下方常駐一行說明原因，設計文件 5.6 記錄了以這一行取代原訂的懸停或 Tab。`test/core/hearts.test.ts` 有測試。

### F4　公文夾的每秒傷害約是釘書機的 2.7 倍（#62）

設計文件 6.1：「每秒傷害相近（約 4 到 6）」。釘書機每 10 幀 1 點，等於每秒 6 點。公文夾三段 2／2／4，每段 10 幀而且可以接著揮，等於每 0.5 秒 8 點、每秒 16 點；實測對一個血量很厚的木樁連按 2 秒，打掉 32 點。近戰的風險比遠程高，傷害較高或許是刻意的，但與 6.1 的說法不符，需要決定改數值還是改文件。`FOLDER` 的揮擊幀數在程式註解裡本來就標為試玩用的暫定值。

處理結果（#65）：數值不變，改文件。設計文件 6.1 現在把約 2.7 倍寫成近戰的風險溢價，`test/core/folder.test.ts` 量測這個比值，之後調數值必須同時改文件。試玩若覺得太強，先拉長 `swingTicks`，不動 2、2、4。

### F5　製作說明對輸送帶與腺苷的描述與數值不符（未開 issue，建議直接改文件）

製作說明寫：「按住射擊或身上黏著腺苷而變慢時，`fast` 輸送帶會比營運長走得快」。按住射擊成立：4.5 × 0.7 = 3.15 格/秒，小於 4。但黏 1 層時是 4.275、黏 2 層時是 4.05，都還比 fast 輸送帶快；黏到第 3 層會立刻強制打盹，所以腺苷本身永遠不會讓營運長被輸送帶往後帶。真正會被帶走的是按住連射、舉著公文夾，或肝臟章的暈眩（減速 15%，3.825）。建議把製作說明改成「按住射擊、舉公文夾或暈眩時」。

### F6　備註（不另開 issue）

- **充能時間**：設計文件 5.4 寫「睡飽的玩家約 25 秒充滿一次」。全部命中時，125 發 × 10 幀 = 20.8 秒；命中率約 83% 時才是 25 秒。看起來 25 秒已經算進漏射，兩者不衝突，留給試玩確認。
- **裝訂已實作**（#64）：釘書機同一目標連續命中達門檻的「裝訂」（6.1、8.8）已經做了。門檻由原訂的 5 發改為 3 發，快速裝訂為 2 發，因為可結案敵人的表現只有 3 到 6。
- **未實作**：完美閃身的慢動作演出（5.3）。build-plan 已記為延後，所以這裡不為它寫測試。彈性工時的預警音效字幕（5.7）原本也列在這裡，2026-11-03 隨音效系統完成（見 build-plan 與 `docs/audio/cues.md`）。這一條原本寫「目前只有遊戲速度 0.8」，查證後不實：設定檔存了 `gameSpeed`、迴圈也有 `speed` 欄位，但 `src/` 裡沒有任何程式寫入它，80% 其實沒有作用。2026-11-03 加上 Esc 選單後才真的接上，並多了 70% 一檔；同日其餘的輔助選項（受傷減半、幹勁不歸零、閃身自動完美、切換式攻擊、關閉震動、減少閃光）也已實作，各自有測試（見 build-plan）。

## 新測試與突變紀錄

每一列都實際跑過：改壞程式，確認該測試失敗，再還原。

| 新測試 | 突變 | 結果 |
| --- | --- | --- |
| warnings grow longer with their tier | `frames.ts` `tier3MinTicks` 改成 0.7 秒（比 tier 2 短） | 失敗 |
| the perfect-dodge window is the first 6 i-frames and lies inside the dodge | `perfectLast: 7` 改成 `9` | 失敗 |
| soft lock never picks a target farther than a staple can fly | `lockRangePx` 改成 9 格 | 失敗 |
| every regular enemy attack telegraphs for exactly the tier-1 warning | `SALESMAN.windupTicks` 改成 `TELEGRAPH.tier1Ticks + 6` | 失敗 |
| a flyer can reach the operator from anywhere in the band it keeps | `FLYER.shotRangePx` 改成 5 格 | 失敗 |
| a regular attack costs half a heart, and no single hit anywhere takes more than a heart and a half | `SALESMAN.damageHalves` 改成 4 | 失敗 |
| clinging up to the stack limit is exactly the slow cap, and no single visible source exceeds it | `CLING.slowPerStack` 改成 0.06 | 失敗 |
| belts are slow, normal and fast in that order | `CONVEYOR_TICKS.normal` 改成 10（比 fast 快） | 失敗 |
| an unslowed operator makes headway against every belt; holding fire, the fast belt carries them back | `CONVEYOR_TICKS.fast` 改成 6；另外 `holdSpeedFactor` 改成 0.95 | 兩者都失敗 |
| never rises with sleep debt, is 1 when rested and never falls below its floor | `sleepFactor` 拿掉 `Math.max(k.sFloor, …)`；另外把睡眠債改成 `Math.abs(sleepDebt - 4)` | 兩者都失敗 |
| the cloak only ever narrows sight | `CLOAK.nearPx` 改成 6 格（大於察覺範圍 5 格） | 失敗 |
| a cup at 08:00 no longer holds the sleep door at 23:00, and a cup at 15:00 still half-closes it | `metabolise` 的半衰期換算由 `× 60` 改成 `× 120` | 失敗 |
| the morning value and the refill target lie in the normal band, and only a shut warehouse reaches the dizzy line | `refillTo` 改成 38；`start` 改成 80；`dizzyBelow` 改成 42 | 三者都失敗 |
