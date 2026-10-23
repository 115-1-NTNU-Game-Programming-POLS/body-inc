# AI 提示詞範本

本檔是美術指南第 12.3 節要求的固定基底句與版本紀錄，也記錄工具、服務條款與江兆耘的同意狀態。每個素材的完整提示詞由 `tools/art/gen_gemini_prompts.py` 依本檔的基底句組合，輸出到 `art-src/ai/prompts/`；改基底句要改那支腳本並在版本表加一列。依指南，範本變更需江兆耘同意；以下 v1-g 與 tile v1-g 是 PM 在第一批生圖時為配合工具所做的適配，江兆耘已同意，見「江兆耘的同意」一節。

## 工具

第一批（2026-10-23）實際用了兩個工具，以每張原圖內嵌的 C2PA 內容憑證（工具簽署的出處紀錄）判定，不靠人工回憶：76 張由 Google Gemini 產生（憑證簽署者 Google LLC，產生器為 Google C2PA Core Generator Library，並標示已加上 SynthID 隱形浮水印），34 張由 ChatGPT 產生（憑證寫明 ChatGPT 的 `gpt-image`，經 OpenAI Media Service API）。ChatGPT 的 34 張是全部 1254 像素的 PNG：狀態、修飾器、行事曆、時段、福利關鍵字圖示，重生的 7 張，以及報告桌。兩家的憑證都沒有寫出具體模型版本，生成紀錄的 `model` 欄位據實寫「不在憑證中」。匯入腳本會自動讀取憑證，之後不需人工填寫工具欄。

指南第 12.2 節要求選定工具後鎖定到 12/7。本批混用兩個工具，產出的畫風在審查圖上看不出明顯落差，但之後同一類素材請固定用同一個工具，例如圖示固定 ChatGPT、頭像與道具固定 Gemini，避免同類素材風格漂移。

## 服務條款（2026-10-23 查證）

Google：Gemini 適用 Google 服務條款（[policies.google.com/terms](https://policies.google.com/terms)，2026-07-30 生效版）。原本的 Generative AI Additional Terms 已於 2024-05-22 併入該條款而停止適用（[policies.google.com/terms/generative-ai](https://policies.google.com/terms/generative-ai)）。條款寫明 Google 不主張使用者以服務產生之內容的所有權（"Google won't claim ownership over that content"）；與本專案相關的禁止事項是讓他人誤以為生成式 AI 內容是人類創作，以及用生成內容開發機器學習模型。

OpenAI：ChatGPT 適用 OpenAI Terms of Use（台灣適用 [openai.com/policies/row-terms-of-use](https://openai.com/policies/row-terms-of-use/)）。條款規定輸出歸使用者所有，OpenAI 將其對輸出的權利轉讓給使用者，條件是遵守條款；禁止把輸出表示為人類創作。查證時該頁拒絕直接讀取，以上內容取自 openai.com 網域的搜尋摘錄，日後應有人以瀏覽器開啟原頁核對一次。

結論：兩家條款都允許把產出用在公開展示的課程作品，共同的義務是揭露 AI 使用，也就是指南第 12.6 節的授權紀錄與製作群名單揭露行，本專案已經在做。另需注意，純 AI 產出在多數法域可能不受著作權保護，這不影響課程使用，但他人複製時團隊可能無法主張權利。

## 江兆耘的同意

指南第 12.2 節規定，江兆耘的立繪上傳到 AI 服務前須取得他本人同意，基底句的變更也需要他同意。依憑證，以下 20 次 Gemini 生成上傳了參考圖，且提示詞指定的參考圖是 `assets/organs/` 中他的立繪：concept-consultant、concept-energy-seller、concept-flyer、illust-ch0-course-selection、illust-ch1-tle-night、illust-ch3-bbq、illust-midterm-exam、illust-prologue-sunglasses-hand、illust-xiaochen-base、portrait-adenosine-base、portrait-brain-sleepy、portrait-brain-surprised、portrait-caffeine-defeated、portrait-caffeine-pitch、portrait-exam-stern、portrait-liver-caught、portrait-liver-memo、portrait-liver-tired、portrait-toast-boss-defeated、portrait-toast-boss-pitch。憑證只記錄輸入張數，不記錄是哪一張圖，實際上傳的是否為他的立繪以操作者的記憶為準。

需要向江兆耘取得的同意有兩項：一是事後追認以上 20 次上傳，二是同意 base v1-g 與 tile v1-g 兩個基底句版本。江兆耘於 2026-10-23 兩項皆同意，由 PM 黃晨瑋轉達。他同時說明 `assets/organs/` 的器官立繪本身就是他以 AI 生成的，因此這批立繪在授權紀錄中改登為 `ai-generated`，生成紀錄見 `art-src/ai/log/organs-legacy.json`。

| 項目 | 同意與否 | 日期 | 方式 |
| --- | --- | --- | --- |
| 追認 20 次上傳立繪 | 同意 | 2026-10-23 | 江兆耘告知 PM，PM 轉達 |
| base v1-g、tile v1-g | 同意 | 2026-10-23 | 江兆耘告知 PM，PM 轉達 |

## 版本

| 版本 | 日期 | 內容 | 同意 |
| --- | --- | --- | --- |
| base v1 | 2026-10-23 | 指南第 12.3 節原文，透明背景 | 指南定稿 |
| tile v1 | 2026-10-23 | 指南第 12.3 節原文 | 指南定稿 |
| base v1-g | 2026-10-23 | 同 base v1，但 transparent background 改為 plain solid pure white background (#FFFFFF)，並加上「只生一張圖」的開頭句；去背改由 `tools/art/postprocess.py` 以白底連通區域處理 | 江兆耘 2026-10-23 |
| tile v1-g | 2026-10-23 | 同 tile v1，加「只生一張圖」的開頭句與每個世界的地板色碼 | 江兆耘 2026-10-23 |

## base v1-g

```
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image:
thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream
palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes
with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: <framing>, plain solid pure white background (#FFFFFF), no floor, no cast shadow,
no scenery, wide empty margin around the subject. Aspect ratio <ar>.
Subject: <角色或物件描述>
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature,
realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol,
multiple panels, character sheet, turnaround.
```

道具、圖示與場景插圖另有三段同結構的變體（道具加「3/4 俯視、縮到目標像素仍可讀」，圖示加「32 像素可讀、右下實心陰影」，場景改為滿版），全文見 `tools/art/gen_gemini_prompts.py` 的 `PROP`、`ICON`、`SCENE` 常數。

## tile v1-g

```
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat
colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right
edge and the top edge must continue the bottom edge. The image is only the floor surface filling
the whole frame.
Colors: use only these colors: <該世界地板主、次、陰三色>.
Subject: <材質描述>
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people,
shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes.
Aspect ratio 1:1.
```

## 第一批的經驗

- 有歧義的英文字會被照字面理解："toast cup" 被畫成吐司麵包，改為 "beer mug" 才正確。物件名稱要用不會誤解的說法。
- 只寫 avoid 清單不足以阻止文字：螢光筆與拉桿都印上了英文，要在 Subject 裡明說「表面完全空白、沒有標籤」。
- 簡化版角色會丟掉沒有重申的配色，例如卡費因的西裝變成米色；衍生圖要把關鍵配色再寫一次。
- 即使寫了 avoid sparkles，頭像仍常帶裝飾星星，後製腳本會自動移除脫離主體的小型黃白色塊。
- 32 像素顯示的狀態圖示不能只靠細小差異區分，生成圖在原尺寸看得出差別，縮小後全部糊在一起；三態圖示的差異部位要佔圖示寬度三分之一以上，或在後製以程式重畫。
