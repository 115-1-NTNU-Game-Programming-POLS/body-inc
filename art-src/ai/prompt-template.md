# AI 提示詞範本

本檔是美術指南第 12.3 節要求的固定基底句與版本紀錄。每個素材的完整提示詞由 `tools/art/gen_gemini_prompts.py` 依本檔的基底句組合，輸出到 `art-src/ai/prompts/`；改基底句要改那支腳本並在下表加一列。依指南，範本變更需江兆耘同意；以下 v1-g 與 tile v1-g 是 PM 在第一批生圖時為配合工具所做的適配，尚待江兆耘確認。

## 工具

第一批（2026-10-23）使用 Google Gemini 的影像生成，模型版本當時未記錄，下一批起請在生成紀錄的 `model` 欄位填入介面顯示的模型名稱。指南第 12.2 節要求的工具實測（以參考圖控制風格、輸出解析度與去背品質、服務條款）尚未做完：本批實際觀察到的是可以接受參考圖、輸出約 1024 至 2528 像素、不能輸出透明背景。服務條款是否允許把輸出用於公開展示的課程作品，需在 Google 的生成式 AI 使用政策與 Gemini 服務條款中確認後，把條款網址記在這裡。

## 版本

| 版本 | 日期 | 內容 | 同意 |
| --- | --- | --- | --- |
| base v1 | 2026-10-23 | 指南第 12.3 節原文，透明背景 | 指南定稿 |
| tile v1 | 2026-10-23 | 指南第 12.3 節原文 | 指南定稿 |
| base v1-g | 2026-10-23 | 同 base v1，但 transparent background 改為 plain solid pure white background (#FFFFFF)，並加上「只生一張圖」的開頭句；去背改由 `tools/art/postprocess.py` 以白底連通區域處理 | 待江兆耘 |
| tile v1-g | 2026-10-23 | 同 tile v1，加「只生一張圖」的開頭句與每個世界的地板色碼 | 待江兆耘 |

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
