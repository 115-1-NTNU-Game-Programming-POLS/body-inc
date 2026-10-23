# AI 原圖（未後製）

本資料夾存放每個 prompt 選定的那一張 AI 原圖（76 張 Gemini、34 張 ChatGPT，依各檔內嵌的 C2PA 內容憑證判定，見 `art-src/ai/prompt-template.md`），檔名即 prompt id（見 `art-src/ai/prompts/gemini-batch-1.md`）。這些是底稿，不得直接放進 `public/assets/`；依美術指南第 12.4 節的六步後製完成後，成品才進遊戲。未採用的候選圖不進倉庫。

新一批圖以 `python tools/art/import_ai_batch.py <下載資料夾>` 匯入。腳本依 prompt id 分類複製、以雜湊值確認複製完整，並在 `art-src/ai/log/<id>.json` 建立生成紀錄。檔名對不上任何 prompt id 時整批拒絕。已存在的紀錄不覆蓋，因此手動補填的欄位在重新匯入後仍會保留。`_contact/` 是各類別的縮圖總覽，由同一支腳本產生，只供審圖。

生成紀錄中的 `model`（Gemini 的模型版本）、`candidates`（生成張數）與 `hours`（修整時數）匯入時未知，留空待補；`references` 照 prompt 所列，實際上傳的附圖若不同需改正。`post` 記錄六步後製的完成狀態：`true` 是人工完成，`"auto"` 是 `tools/art/postprocess.py` 的自動版，`"checked"` 是已目視確認圖中沒有文字，`"sheet"` 是已產生第 6 步的審查圖但尚未有人並排驗收。`status` 為 `auto-processed`（已進 `public/assets/`，等江兆耘手修覆蓋）、`not-adopted`（第 1 步判定不用）或 `held`（等審查）。後製流程見 `tools/art/README.md`。

## 第一批審圖結果（2026-10-23）

110 張全部到齊，格式皆為白底 RGB，插圖、地板紋理與軟木板牆為滿版。以下為需要處理的項目，其餘可直接進入後製。

| id | 問題 | 處理 |
| --- | --- | --- |
| `concept-cheers` | 頭部畫成吐司麵包，原 prompt 的 "toast cup" 有歧義 | 已依新 prompt 重生為啤酒杯；新圖的三角旗是正紅色，違反「世界中紅色只屬於預警」，像素重畫時改用其他顏色 |
| `concept-caffeine-sprite` | 西裝變成米色，與頭像不一致 | 已重生，改回深灰西裝 |
| `ic-weapon-highlighter` | 筆身有英文字 "CHUBBY HIGHLIGHTER BOLD" | 已重生，筆身無字 |
| `prop-switch-lever` | 開關盒上有英文字 "LEVER SWITCH" | 已重生，盒面無字 |
| `ic-tag-cloak-on`、`-half`、`-off` | 三態只差兜帽裡一隻小眼睛，32 像素下難以分辨 | 已重生為斗篷正面的大眼睛，但實測縮到 32 像素後三態仍糊成同一塊米色。後製腳本改以程式重畫眼睛（閉眼弧線、半睜半圓、睜眼加墨藍瞳孔），32 像素下已可分辨 |
| `prop-glucose-box` | 白箱藍帶，與倉庫色票 `#F2D27A` 矛盾；白色箱身也會讓可推箱的白色角標看不見 | 指南第 7.4 節已統一為黃色箱身加白標籤。依第 7.4 節「紙箱類共用一個方箱骨架」，五個方箱類 AI 圖（葡萄糖箱、乙醛箱、核心傾印箱、福利紙箱兩態）第 1 步判定不用，遊戲中改用 `art-src/drafts/props/` 的程式方箱骨架 |
| `prop-exam-projector` | 底色為淺灰而非純白 | 去背容差已涵蓋，無殘留 |
| `illust-ch0-course-selection` | 畫成白底貼紙圖，不是滿版場景，與其他插圖不一致 | 可接受；若要統一則重生 |
| `illust-ch3-rescue` | 側躺姿勢需醫療審查 | PM 先依指南第 6.5 節的四個條件自查：側臥符合；兩腿伸直併攏，上方腿沒有彎曲撐地；頭沒有明顯後仰；頭枕在下方手臂上，上方手臂橫在身前而不是墊在臉頰下。判定不合格，prompt 已改為逐肢體描述的第二版，需重新生成，自查通過後再交王晨嬡審。審過之前不放進 `public/assets/`（紀錄狀態為 `held`） |
| 多張頭像 | 背景有星星裝飾 | 後製腳本自動移除脫離主體的小型黃、白、粉橘色塊，汗滴與腺苷的「z」保留 |
| `portrait-adenosine-base` | 虛線輪廓有缺口，白底去背會灌進淡紫色身體 | 後製腳本對這張先封閉外框缺口再去背 |
| `portrait-toast-boss-*` | 炭灰西裝與墨藍只差 54（RGB 距離），外框校正門檻過寬時西裝會被染成墨藍 | 門檻已收到 34 |

重生後的圖放回下載資料夾再跑一次匯入腳本即可覆蓋原圖；生成紀錄需手動更新 `prompt`、`date` 與 `selected_sha256`，或刪除舊紀錄後重新匯入。
