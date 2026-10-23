# Gemini 生圖 prompt：第一批

由 `tools/art/gen_gemini_prompts.py` 產生，請改腳本後重跑，不要直接改這份。依據 `docs/art-direction.md` 第 12 節的 base v1 與 tile v1。

## 使用前必讀

1. **一段 prompt 只生一張圖。** 每段都寫了 "Generate exactly ONE image"。想要多個候選就對同一段按重新生成，不要改成「給我 6 張」。
2. **附圖。** 每段上方的「附圖」欄寫了要一起上傳的參考圖。江兆耘的立繪上傳前須先取得他本人同意（§12.2）；未取得同意前，A、B、C 區先跳過或只用 `assets/brand/badge-1024.png` 當畫風參考。
3. **背景。** Gemini 不能輸出透明背景，所以 base v1 的 "transparent background" 改成純白底，去背靠外框做 flood fill。這是對 base v1 的工具適配，記為 `base v1-g`，需江兆耘同意後寫回 `art-src/ai/prompt-template.md`。
4. **圖中不要有字。** 牌子、標籤、看板一律留白，字由程式疊。若生成圖仍出現字或仿中文，後製第 4 步清掉。
5. **紀錄。** 每採用一張，在 `art-src/ai/log/<id>.json` 記工具版本、日期、prompt 版本、附圖、生成張數、採用哪張（§12.6）。生成與挑選每張以 20 分鐘為上限。
6. **後製六步**（§12.4）做完才可進 `public/assets/`。道具與紋理的目標像素尺寸寫在 prompt 的 "downscaled to" 裡。
7. 狀態、修飾器、行事曆、福利關鍵字圖示的項目清單是本批的提案（美術指南只寫了數量），可依設計增減。

## 不交給 AI 的（§12.1）

營運長、西裝範本、所有逐格像素動畫、閃電徽章、印章與愛心等識別元素、換色、圖中文字。另外以下由程式繪製，不需要生圖：考卷紙張本體、手機精外框、看板內容、輸送帶、各種框與便條。


## 數量

| 區 | 張數 |
| --- | --- |
| A. 頭像：既有角色的表情延伸 | 5 |
| B. 頭像：新角色（Boss 與考卷） | 7 |
| C. 小晨與外層插圖 | 7 |
| D. 敵人頭部概念（每段 prompt 重生 6 次，挑 1 個給江兆耘像素重畫） | 5 |
| E. 承載知識的道具（江兆耘操作，§12.1） | 11 |
| F. 一般道具（組員可操作） | 30 |
| G. 證據牆靜態道具（組員可操作，§7.6） | 5 |
| H. 地板紋理（組員可操作，生成後一律以腳本量化到世界色票） | 6 |
| I. 文具圖示（AI 底稿，江兆耘修整） | 4 |
| J. 狀態圖示（10） | 10 |
| K. 修飾器圖示（6，公告欄與電梯面板共用） | 6 |
| L. 行事曆與時段圖示（9） | 9 |
| M. 福利關鍵字圖示（5，菌隊延後） | 5 |
| 合計 | 110 |


## A. 頭像：既有角色的表情延伸

### `portrait-brain-sleepy` 大腦董事長：睡不飽「我有一個……那個……」

- 附圖：assets/organs/brain-normal.png (上傳前須取得江兆耘同意，§12.2)
- 備註：與原圖並排檢查：外框粗細、粉色、領帶與識別證位置一致。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same pink brain mascot character from the attached reference image, same body shape, same yellow necktie, same white ID badge, same small pie with a little flag in his left hand, but the pie is now tiny (about one quarter of the original size). New expression: sleepy and lost for words, eyes half-closed drawn as two flat horizontal lines, mouth crooked and slightly open as if trailing off mid-sentence, shoulders drooping. Keep the same blush.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, sparkles, stars, new accessories.
```

### `portrait-brain-surprised` 大腦董事長：驚訝「原來是誤報？」

- 附圖：assets/organs/brain-normal.png (上傳前須取得江兆耘同意，§12.2)

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same pink brain mascot character from the attached reference image, same body, same yellow necktie, same white ID badge, same pie with a little flag. New expression: surprised and a bit embarrassed, eyes wide open drawn as round white circles with navy dots, small O-shaped mouth, one hand raised near the cheek, a single small sweat drop beside the head.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, sparkles, stars, exclamation marks.
```

### `portrait-liver-memo` 肝：舉便利貼「已處理。」

- 附圖：assets/organs/liver-base.png (上傳前須取得江兆耘同意，§12.2)
- 備註：便利貼留白，「已處理。」由程式疊字。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same liver-shaped mascot from the attached reference image (coral pink body, cream lobe band, yellow necktie, envelope in the pocket), with the same tired half-lidded eyes and dark circles. Remove the coffee cup. He now calmly holds up a blank square yellow sticky note (#FFF1A8) beside his head with one hand, facing the viewer, expression flat and composed.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, coffee cup, mug.
```

### `portrait-liver-tired` 肝：「……累。」

- 附圖：assets/organs/liver-base.png (上傳前須取得江兆耘同意，§12.2)
- 備註：肝第一次開口的時刻，語氣要平實，不要搞笑。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same liver-shaped mascot from the attached reference image (coral pink body, cream lobe band, yellow necktie, envelope in the pocket). Remove the coffee cup. New expression: exhausted, eyes fully closed drawn as two downward arcs, head bowed forward, small flat mouth, arms hanging down. Quiet and sincere, not comedic.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, coffee cup, tears, sweat, sparkles.
```

### `portrait-liver-caught` 肝：「被你發現了啊」（冒汗苦笑）

- 附圖：assets/organs/liver-base.png (上傳前須取得江兆耘同意，§12.2)
- 備註：做得完版可延後（§6.4 第三張依時數）。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same liver-shaped mascot from the attached reference image (coral pink body, cream lobe band, yellow necktie, envelope in the pocket). Remove the coffee cup. New expression: caught out, an awkward wry smile with the corners of the mouth pulled sideways, eyes looking away to the side, two small sweat drops near the head, one hand scratching the back of the head.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, coffee cup.
```


## B. 頭像：新角色（Boss 與考卷）

### `portrait-caffeine-pitch` 續杯經理 卡費因：推銷中

- 附圖：assets/organs/brain-normal.png（只當畫風參考）(上傳前須取得江兆耘同意，§12.2)
- 備註：先生這張，滿意後把這張成品一起附上去生 defeated，造型才會一致。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, upper body and head fill most of the frame, hands visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a mascot whose head is a takeaway coffee cup: cream cup body (#F4EBDD), brown sleeve (#8B5A3C) decorated like a credit card with two horizontal stripes and a small gold chip, dark brown lid (#6B4A3A) with a small blank round sticker on it; the face (eyes and mouth) is on the cup body; short arms and legs, wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest; he holds a loyalty stamp card with a 2x5 grid of empty circles. Pose: an over-eager salesman leaning forward, offering a fresh coffee cup toward the viewer with the free hand, wide sparkling eyes, big confident grin.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround.
```

### `portrait-caffeine-defeated` 續杯經理 卡費因：斷電／被駁回

- 附圖：上一張選定的 portrait-caffeine-pitch 成品 + assets/organs/brain-normal.png
- 備註：腺苷棉球之後會由程式疊，這裡只是氣氛，可接受被修掉。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, whole character visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same coffee-cup-headed character from the first attached image (same cup, sleeve, lid, sticker, suit, tie, pin and loyalty card). New state: powered down, sitting slumped on the floor, eyes drawn as two flat lines, mouth a small wavy line, the loyalty card now has every circle filled with a stamp, three empty paper cups stacked beside him, a few pale lavender cotton-ball shapes (#EAE4FF) piled on his shoulders.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround.
```

### `portrait-toast-boss-pitch` 敬酒部長：推銷中

- 附圖：assets/organs/brain-normal.png（只當畫風參考）(上傳前須取得江兆耘同意，§12.2)
- 備註：§11.3：部長不臉紅、不搖晃、不打嗝；笑點來自熱情過頭。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, upper body and head fill most of the frame, hands visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a mascot whose head is a round-mouthed toast cup with a wide rim, cup body wine-red (#9B2335) with thin gold bands; the face is on the cup body; short arms and legs, wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest; a blank cream sash worn diagonally across the chest; one hand holds a karaoke microphone; NO blush on the cheeks. Pose: singing passionately into the microphone with the other arm thrown wide open as if offering an over-enthusiastic hug, eyes closed in happy arcs, big open smiling mouth.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, blush, red face, swaying, drunk expression, hiccup bubbles, bottles, beer foam spilling.
```

### `portrait-toast-boss-defeated` 敬酒部長：被駁回

- 附圖：上一張選定的 portrait-toast-boss-pitch 成品 + assets/organs/brain-normal.png

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, upper body and head fill most of the frame, hands visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same toast-cup-headed character from the first attached image (same cup, gold bands, suit, tie, pin, sash, microphone). New state: sheepishly giving up, both hands raised palms-out in a 'fine, fine, I won't push you' gesture, microphone lowered, sash slightly crooked, awkward small smile, one sweat drop. NO blush.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, blush, red face, swaying, drunk expression, bottles.
```

### `portrait-exam-stern` 期中考卷：嚴肅

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：卷面格線與標題由程式畫，這張只定角色個性。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a mascot that is a single sheet of exam paper standing upright, cream white (#FFFDF7) with faint pale blue ruled lines and an empty name box at the top, thin round navy wire-frame glasses, tiny stick arms, no legs, no necktie, no badge, the face sits in the middle of the paper. Expression: stern examiner, eyebrows drawn as two short straight slanted lines, mouth a flat straight line, glasses catching a tiny white glint, arms crossed.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, blush, grades, check marks, crosses, red ink.
```

### `portrait-exam-approve` 期中考卷：認可

- 附圖：上一張選定的 portrait-exam-stern 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: Redraw exactly the same exam-paper character from the attached image (same paper, ruled lines, empty name box, glasses). New expression: quietly approving, eyes softened into gentle arcs, small satisfied smile, one tiny arm giving a thumbs-up, light oval blush.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, grades, check marks, red ink.
```

### `portrait-adenosine-base` 腺苷（睏意催收員）（推薦版，可選）

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：會回來對象的語法：圓、紫虛線、無徽章。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a round fluffy cotton-ball creature, very pale lavender (#EAE4FF) and slightly translucent looking, outlined with a DASHED purple line (#6A5FB8) instead of a solid outline, two small navy dot eyes, a gentle polite smile, wearing a tiny old-fashioned bookkeeper's visor cap, hugging a small white invoice sheet to its chest, a small 'z' shape floating above its head, no arms or legs, two or three tiny cotton tufts on its body.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, limbs, necktie, badge, lightning bolt, scary face.
```


## C. 小晨與外層插圖

### `illust-xiaochen-base` 小晨：基本造型

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：呆毛必須與營運長同形（勾號形），這是伏筆。之後的情境圖都附這張成品。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 3:4.
Subject: a chibi Taiwanese third-year computer science university student boy, short dark brown hair with one small check-mark shaped cowlick sticking up on top, faint dark circles under the eyes, blue pullover hoodie, dark jeans, a red backpack, holding a spiral notebook. Standing relaxed, facing the viewer, a slightly tired but kind small smile.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, school logo, brand logo on clothes, laptop logo.
```

### `illust-ch0-course-selection` 序章：選課系統當機的凌晨一點

- 附圖：選定的 illust-xiaochen-base 成品 + assets/organs/brain-normal.png
- 備註：卡片插圖區 240 × 150：生 3:2 後裁成 8:5。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E), flat fills with one-step same-hue shading, no gradients, no texture, chibi proportions (head about one third of body height), simple faces: solid navy round eyes with one white highlight, line mouth.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 3:2.
Subject: the same student from the attached image (same hair with check-mark cowlick, blue hoodie), sitting at a desk in a small dim dorm room at 1 a.m., hunched in front of a laptop, the screen glows pale blue and shows only a blank loading spinner and empty grey bars, his finger hovering over the refresh key, an empty instant-noodle cup and the red backpack on the floor, a small window showing a night sky.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, real university names, school emblem, readable UI, brand logos.
```

### `illust-ch1-tle-night` 第一章：晚上八點、一大杯咖啡、TLE

- 附圖：選定的 illust-xiaochen-base 成品 + assets/organs/brain-normal.png

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E), flat fills with one-step same-hue shading, no gradients, no texture, chibi proportions (head about one third of body height), simple faces: solid navy round eyes with one white highlight, line mouth.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 3:2.
Subject: the same student from the attached image (same hair with check-mark cowlick, blue hoodie), in a university computer lab in the evening, holding a very large takeaway coffee cup, staring at a laptop whose screen shows rows of short grey bars with one row highlighted in orange to suggest a failed test case, a frustrated pout, other empty desks and monitors in the background.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, real university names, readable code, readable UI, brand logos, red.
```

### `illust-midterm-exam` 期中考：上機考與紙筆考（推薦版，可選）

- 附圖：選定的 illust-xiaochen-base 成品 + assets/organs/brain-normal.png
- 備註：推薦版加做。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E), flat fills with one-step same-hue shading, no gradients, no texture, chibi proportions (head about one third of body height), simple faces: solid navy round eyes with one white highlight, line mouth.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 3:2.
Subject: the same student from the attached image (same hair with check-mark cowlick, blue hoodie), sitting in an exam room with rows of desks, on his desk a blank paper exam sheet and a pencil, focused and nervous, a wall clock above the blackboard, other students drawn as simple back-view silhouettes.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, readable writing on the blackboard, real university names.
```

### `illust-ch3-bbq` 第三章：系烤，拿烏龍茶敬大家（推薦版，可選）

- 附圖：選定的 illust-xiaochen-base 成品 + assets/organs/brain-normal.png
- 備註：§11.3：系烤會場不畫喝醉的人。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E), flat fills with one-step same-hue shading, no gradients, no texture, chibi proportions (head about one third of body height), simple faces: solid navy round eyes with one white highlight, line mouth.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 3:2.
Subject: the same student from the attached image (same hair with check-mark cowlick, blue hoodie), at an evening outdoor department barbecue on a grass field with string lights and long tables, smiling and raising a paper cup of oolong tea toward a few younger students, a barbecue grill with skewers in the background.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, drunk people, red faces, vomit, beer bottles, alcohol brand, people lying down.
```

### `illust-ch3-rescue` 第三章：叫不醒的阿凱（救援插圖，需王晨嬡審姿勢）

- 附圖：選定的 illust-xiaochen-base 成品（只當人物參考）
- 備註：這張本身就是衛教內容：側躺姿勢必須由王晨嬡對照查證表第 2 條審過才定稿。第一版兩腿伸直、頭枕在下方手臂上，不合格；這是第二版 prompt。生成後先自查四點：側臥、上方腿彎曲膝蓋著地、頭略後仰、上方手背墊在臉頰下。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color illustration with a dark navy outline (#0C2D5E), flat fills, one-step shading, desaturated cool palette (muted blues, grey-greens, soft greys), NO blush, no chibi exaggeration, more natural body proportions, quiet and sincere mood.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 3:2.
Subject: a calm, serious, realistic-proportioned scene at night at the quiet edge of a grass field, seen from a slightly high angle in front of the lying man so that all four of his limbs are clearly visible. A young man (Akai, short black hair, grey T-shirt) is in the first-aid recovery position, drawn limb by limb exactly like this: he lies on his LEFT side facing the viewer; his LEFT arm (the lower one) lies straight out on the grass at a right angle to his body, palm up; the back of his RIGHT hand (the upper one) is tucked under his right cheek, so his head rests on that hand and not on the grass; his RIGHT leg (the upper one) is bent at the hip and at the knee to about 90 degrees, with the right knee touching the grass in front of his body like a kickstand; his LEFT leg (the lower one) stays straight; his head is tilted slightly back with the chin lifted and the mouth pointing down toward the grass. The student from the attached image (blue hoodie, check-mark cowlick) kneels close beside him, behind his back, holding a phone to his ear, calling for help, worried but steady. Soft street-lamp light.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, blush, comedic expressions, sweat drops, vomit, bottles, cans, alcohol, ambulance lights flashing, dramatic glow, tears, both legs straight, legs together, head resting on the lower arm, lying on the back, lying face down.
```

### `illust-prologue-sunglasses-hand` 序章過場：凌晨兩點，墨鏡手簽合約

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：顯示約 128 像素，構圖要簡單。夜間董事長的身分不能露出來。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E), flat fills with one-step same-hue shading, no gradients, no texture, chibi proportions (head about one third of body height), simple faces: solid navy round eyes with one white highlight, line mouth.
Composition: a single illustration filling the whole frame, simple uncluttered background made of large flat color shapes, main subject readable when shrunk to 240x150 pixels. Aspect ratio 1:1.
Subject: a close-up of a dark office desk at 2 a.m. lit by a single desk lamp: a hand in a dark sleeve signing a contract with a fountain pen, the contract shows only blank lines and an empty signature box, a pair of black sunglasses lying on the desk beside it, the owner of the hand is not visible, slightly mysterious but still cute and flat.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, face, body, readable writing, signature letters, blood, weapon.
```


## D. 敵人頭部概念（每段 prompt 重生 6 次，挑 1 個給江兆耘像素重畫）

### `concept-flyer` 傳單紙怪

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：概念圖不作佔位圖（§13.5）；只給江兆耘挑方向。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a small chibi enemy mascot whose head is a folded advertising flyer (folded in half like a tent, printed with only flat colored blocks), a small short body wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest, sly grin, front view standing.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, readable print.
```

### `concept-energy-seller` 能量飲料推銷員

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：頭是使用模式物件加模式道具（試喝籃），避免讀成「飲料是壞人」。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a chibi salesman enemy mascot whose head is an energy drink can (the face on the can, pull tab on top, can body in bold flat colors with abstract shapes but no lettering), wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest, carrying a small wicker tasting basket full of tiny sample cups, pushy salesman grin, front view standing.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, brand name, readable label.
```

### `concept-cheers` 乾杯小弟

- 附圖：assets/organs/brain-normal.png（只當畫風參考）

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a small chibi party-hype enemy mascot whose head is a clear glass beer mug filled with pale amber beer and a ring of white foam on top (the kind of glass people clink when they shout cheers), the face is on the glass, wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest, a blank armband on the upper arm, holding up a small blank triangular pennant flag, cheerful shouting expression, front view standing.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, bread, toast bread, blush, red face, drunk expression, bottles.
```

### `concept-consultant` 序章速效顧問

- 附圖：assets/organs/brain-normal.png（只當畫風參考）
- 備註：唯一的人頭版本。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a chibi slick business consultant with a normal human head, glossy slicked-back hair, squinting eyes in a fake friendly smile, wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest, holding a dark contract folder under one arm, the other hand offering a handshake, front view standing.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, sunglasses.
```

### `concept-caffeine-sprite` 卡費因（像素 Boss 用的頭部簡化方向）

- 附圖：選定的 portrait-caffeine-pitch 成品
- 備註：給江兆耘看 64 × 64 時哪些細節要捨棄。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat-color sticker illustration in the same style as the attached reference image: thick dark navy outline (#0C2D5E) about 1% of image width, soft pastel pink, coral and cream palette, one-step same-hue shading, no gradients, no texture, simple face: solid navy round eyes with one white highlight, oval blush, line mouth, cute office-worker mascot.
Composition: centered, full body visible, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no scenery, wide empty margin around the subject. Aspect ratio 1:1.
Subject: a simplified, very chunky chibi version of the coffee-cup-headed character from the attached image, designed to be redrawn as 64x64 pixel art: head about half of total height, only big shapes, the sleeve stripes reduced to two thick bands, loyalty card as a simple rectangle with a 2x5 dot grid, keep the same outfit as the attached image: wearing a charcoal grey business suit (#3B3F4A), a wine-red necktie (#9B2335), and a small plain golden-yellow lightning-bolt pin (#FFC83D) on the chest, front view standing.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, signature, realistic anatomy, blood, veins, slime, glossy wet highlights, 3D render, photo, red cross symbol, multiple panels, character sheet, turnaround, small details, beige suit, light-colored suit.
```


## E. 承載知識的道具（江兆耘操作，§12.1）

### `prop-coffee-machine-on` 咖啡機（營業中）1 × 2

- 附圖：不用附圖
- 備註：兩台外型相同，只差狀態。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a chunky office espresso machine, tall rectangular body in cream and coffee brown (#7A5238), a small rectangular screen glowing soft green, a little puff of white steam rising from the top, a cup slot with a white paper cup.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-coffee-machine-closed` 咖啡機（暫停營業）1 × 2

- 附圖：選定的 prop-coffee-machine-on 成品
- 備註：牌子留白，「暫停營業」由程式寫。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: exactly the same espresso machine as the attached image, but switched off: the screen is dark grey, no steam, and a blank rectangular paper sign hangs on a string across the front.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-clock-vent` 時鐘通風口 2 × 2（牆掛）

- 附圖：不用附圖
- 備註：鐘面不寫數字。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a wall-mounted round office clock whose lower half is a louvered air vent with horizontal slats, a thin wisp of lavender-grey smoke (#A99BC2) drifting out of the vent, clock face with plain tick marks and two hands, front view of a wall object.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, numbers on the clock.
```

### `prop-bed-door-closed` 就寢門：關閉

- 附圖：不用附圖
- 備註：三態以門扇角度區分；先生這張，另兩張附這張成品。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x96 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: a set of double wooden doors in warm brown, with a crescent-moon shaped arch on the lintel above them, and an empty rectangular gauge slot mounted beside the doors, doors fully closed.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-bed-door-half` 就寢門：半開

- 附圖：選定的 prop-bed-door-closed 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x96 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: exactly the same double wooden doors with the crescent-moon lintel and gauge slot as the attached image, but the doors are half open, each door panel swung about 45 degrees inward, soft warm light inside.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-bed-door-open` 就寢門：全開

- 附圖：選定的 prop-bed-door-closed 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x96 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: exactly the same double wooden doors with the crescent-moon lintel and gauge slot as the attached image, but both doors fully open against the walls, a calm dark-blue night room with a bed visible inside.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-alcohol-barrel` 酒精桶（打不動）1 × 1

- 附圖：不用附圖
- 備註：灰色斜線帶由江兆耘在像素圖上手加，不要叫 AI 畫。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a chunky upright cylindrical barrel made of amber glass (#D9A441) with dark metal hoops, a blank white rectangular label on the front, slightly desaturated muted colors, heavy and immovable looking.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-acetaldehyde-crate` 乙醛箱（可推）1 × 1

- 附圖：不用附圖
- 備註：§4：乙醛只用菱形與圓點，不畫斜線。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a square cardboard box colored red-purple (#B04A7A), on the front a white diamond-shaped symbol and inside it a tiny simple blushing face, small white L-shaped corner marks on the two top corners of the box.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-production-machine` 產線機台 3 × 2

- 附圖：不用附圖
- 備註：牌子「處理中，請勿催促」由程式寫；指針畫死在同一刻度。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 96x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 3:2.
Subject: a wide old-fashioned chemical factory processing machine in grey-purple metal, a round tachometer gauge on the front with the needle pointing to the middle, a few pipes on top, a small blank rectangular sign plate, a short conveyor input on the left and output on the right.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, numbers on the gauge.
```

### `prop-punch-clock` 打卡機（存檔點）

- 附圖：不用附圖
- 備註：永遠與茶水間成對擺放。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a wall-mounted vintage office punch clock: a box with a big round clock face on top and a card slot below, a small rack of blank time cards beside it, in cream and navy.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, numbers on the clock.
```

### `prop-tea-station` 茶水間（回復點）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a small office tea station: a low counter with a hot water dispenser, a few mugs, and a small potted plant, in cream, wood and soft green.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```


## F. 一般道具（組員可操作）

### `prop-temp-desk` 暫存桌 3 × 1（6 個文件放置點）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 96x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 16:9.
Subject: a long low office desk, with six evenly spaced empty paper trays on its top surface, plain wood and grey metal legs.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-nap-sofa` 午睡沙發 2 × 1

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 4:3.
Subject: a soft two-seat office sofa in muted blue-grey with one cushion and a folded blanket, a small crescent moon shaped throw pillow.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-steel-shelf` 肝醣倉庫藍色鋼架 1 × 2

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a tall warehouse storage shelf with blue steel frame (#4F6A8F) and three shelves holding plain cardboard boxes.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-glucose-box` 葡萄糖箱（可推）

- 附圖：不用附圖
- 備註：「C₆H₁₂O₆」由程式寫；倉庫調貨版本不加角標（另存一份去掉角標）。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a square white cardboard box with a blank blue rectangular label band on the front, small white L-shaped corner marks on the two top corners, sturdy and pushable.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-acetic-bottle` 乙酸瓶（背景）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 16x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a tall slim laboratory bottle in teal (#4FA3A5) with a narrow neck and a blank label.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-office-desk` 辦公桌椅組

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 4:3.
Subject: a single office desk with a closed laptop, a mug and a swivel chair, plain wood and grey.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-stall-frame` 夜市攤位框 2 × 2（系烤三攤共用）

- 附圖：不用附圖
- 備註：招牌字與桌上道具另外處理。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: an empty night-market food stall frame: wooden counter, a striped cloth canopy in cream and soft orange, a blank rectangular sign board on top, nothing on the counter.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-welfare-box-closed` 福利紙箱（關）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a cardboard box tied with a soft yellow ribbon bow, like a company gift, closed.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-welfare-box-open` 福利紙箱（開，空）

- 附圖：選定的 prop-welfare-box-closed 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: exactly the same cardboard box as the attached image, now opened and empty, flaps folded out, the yellow ribbon lying loose beside it.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-wall-board-frame` 牆掛看板框 2 × 2（死線、排名、通緝共用）

- 附圖：不用附圖
- 備註：框內留白，內容由程式繪製。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: an empty wall-mounted display board with a sturdy dark frame and a plain light grey blank screen area, two small bolts at the top, front view.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-stretch-station` 伸展站 2 × 2（久坐僵硬）

- 附圖：不用附圖
- 備註：§7.5：不用十字或醫療符號。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a green yoga mat laid on the floor with a rolled towel, and a simple poster on a stand showing a stick figure doing a shoulder stretch.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, medical cross, red.
```

### `prop-core-dump-box` 核心傾印文件箱

- 附圖：不用附圖
- 備註：一般障礙：無角標、無徽章；「core」由程式寫。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a plain brown file storage box with a lid, papers sticking out of the top, a blank white label area on the front.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-switch-lever` 關通知拉桿

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a small wall-mounted lever switch box with a round knob handle, in grey and navy, front view, the box face is completely blank with no label plate.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-floor-guide` 大廳樓層導覽牌 1 × 2（人體地標）

- 附圖：不用附圖
- 備註：§7.4：每個世界只有一個人體地標。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a tall freestanding department-store floor guide sign, on it a very simple cute cross-section silhouette of a human body in cream with five small colored dots inside it (pink, coral, light peach, cream, salmon), navy frame.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, realistic anatomy, organs drawn in detail.
```

### `prop-elevator` 大廳電梯 2 格寬

- 附圖：不用附圖
- 備註：門框色依器官改，用換色腳本處理。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x96 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: a closed elevator door set into a wall, brushed light metal doors, a door frame painted soft pink, a small round call button and a blank indicator light above, a taped blank paper note on the door.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-neuron-chandelier` 大腦頂樓神經元吊燈（人體地標）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a modern pendant chandelier shaped like a stylized neuron: a round central lamp with several branching arms ending in small glowing bulbs, in soft pink (#F08A8F) and warm white.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, realistic neuron, veins, wet.
```

### `prop-hex-control-board` 肝產線總控看板（人體地標）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a wall-mounted control board shaped like a hexagon, six small hexagonal indicator lamps arranged in a honeycomb, a few switches below, grey-purple metal, front view.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-doc-mountain` 肝辦公室文件山 1 × 3

- 附圖：不用附圖
- 備註：畫在 above 層。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x96 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a very tall teetering stack of paper documents and folders reaching upward, with several blank yellow sticky notes stuck on it, tall and narrow.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-resign-drawer` 微開的辭呈抽屜

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: an office desk drawer cabinet with the top drawer slightly open, a plain white envelope visible inside.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-bbq-grill` 系烤烤肉架

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 16:9.
Subject: a simple outdoor charcoal barbecue grill with a few skewers of vegetables and meat on the grate.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, fire flames, smoke clouds.
```

### `prop-long-table` 系烤長桌

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 96x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 21:9.
Subject: a long folding table with a plain paper tablecloth, a few paper cups and paper plates.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, bottles, cans, alcohol.
```

### `prop-night-desk-lamp` 夜間光源：檯燈

- 附圖：不用附圖
- 備註：光暈由程式疊加，這裡只要本體。以下 6 件夜間光源同理。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a small desk lamp switched on, warm light color (#FFD98A) on the bulb only.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, light rays, glow halo.
```

### `prop-night-monitor` 夜間光源：螢幕

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a computer monitor on a stand, screen lit pale blue (#8FD3FF) and blank.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, glow halo, readable UI.
```

### `prop-night-exit-sign` 夜間光源：緊急出口燈

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x16 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 16:9.
Subject: a wall-mounted emergency exit sign box glowing soft green (#7FD18B) with a simple running stick-figure and a door pictogram, no words.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, glow halo, words.
```

### `prop-night-window` 夜間光源：窗外夜景帶

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 128x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 21:9.
Subject: a long horizontal office window strip seen from inside at night, outside a dark blue city skyline silhouette with a few small lit windows.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-night-cleaning-cart` 夜間光源：清潔車

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x32 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a janitor's cleaning cart with a mop, a bucket and a small trash bag, in navy and grey.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, dirt, stains.
```

### `prop-night-vending` 夜間光源：販賣機

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a drink vending machine at night, front panel softly lit, rows of blank colorful drink bottles behind glass.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, brand names, energy drink logos.
```

### `prop-exam-pc-desk` 考場：上機場電腦桌

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: a plain exam-room computer desk with a monitor showing a blank dark screen, a keyboard and a mouse.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-exam-paper-desk` 考場：紙筆場桌

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 2:3.
Subject: a plain exam-room desk with a blank exam paper, a pencil, an eraser and a small ink pad.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-exam-projector` 考場：投影幕

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a pull-down projector screen hanging on a wall, blank white.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```


## G. 證據牆靜態道具（組員可操作，§7.6）

### `prop-evidence-cork-wall` 軟木板牆面組件（可左右無縫）

- 附圖：不用附圖
- 備註：需左右無縫（之後切成 32 × 64 的牆面組件）。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game wall texture, front view, flat fills, at most 5 colors, no outlines inside the surface, no gradients. The left edge must continue seamlessly into the right edge.
Composition: the wall surface fills the whole frame. Aspect ratio 1:1.
Subject: a cork board wall surface in warm tan cork color with subtle flat speckles, a thin wooden trim strip along the bottom edge.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet, pins, papers.
```

### `prop-evidence-pin` 圖釘

- 附圖：不用附圖
- 備註：非常小，最後由組員逐點修。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 8x8 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 1:1.
Subject: a single round-headed push pin seen from the front-top, head in soft navy blue.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-evidence-stand` 立式軟木展板 4 × 2

- 附圖：不用附圖
- 備註：肝工單串單獨釘在這裡。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 128x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 16:9.
Subject: a wide freestanding cork display board on two wooden legs, empty cork surface.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-evidence-cabinet` 卷宗櫃

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 32x64 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 9:16.
Subject: a tall wooden filing cabinet with four drawers, small blank label holders on each drawer.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```

### `prop-evidence-report-desk` 報告桌

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: flat simple video-game prop illustration, 3/4 top-down view (camera looking down about 45 degrees, front face and top face both visible), big simple shapes with no small details, thick dark navy outline (#0C2D5E), flat fills, at most 6 colors, light from the top-left so the shaded side is bottom-right, shading hue shifted toward navy, no gradients, no texture. It must still read clearly after being downscaled to 64x48 pixel art.
Composition: the single object centered, plain solid pure white background (#FFFFFF), no floor, no cast shadow, no other objects, wide empty margin. Aspect ratio 4:3.
Subject: a solid wooden desk with a neat closed report folder and a desk lamp on it.
Avoid: text, letters, numbers, Chinese characters, fake writing, logos, watermark, diagonal stripes, hazard stripes, lightning bolt shapes, teal or cyan accents, saturated red, glossy highlights, 3D render, photo, perspective distortion, multiple objects, sheet.
```


## H. 地板紋理（組員可操作，生成後一律以腳本量化到世界色票）

### `tex-warehouse-concrete` 肝醣倉庫：水泥地

- 附圖：不用附圖
- 備註：黃色安全線另外畫，不要進紋理。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #CFC9BC, #C2BBAC, #A69F90.
Subject: smooth warehouse concrete floor with very faint flat blotches.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```

### `tex-brain-carpet` 大腦（日）：藍灰地毯加淡腦迴紋

- 附圖：不用附圖
- 備註：夜間版由換色腳本產生。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #AFC0D3, #9FB1C6, #8EA0B6.
Subject: office carpet with a very subtle repeating wavy pattern that loosely suggests brain folds, drawn as soft flat curvy bands.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```

### `tex-brain-wood` 大腦（日）：木地板

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #D9BE98, #CBAE86, #B89A73.
Subject: simple wooden plank floor with long horizontal planks, flat colors, very faint grain.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```

### `tex-liver-grate` 肝化工廠：灰紫金屬格柵

- 附圖：不用附圖
- 備註：格線間距最好對齊 8 或 16 像素。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #B9B4B8, #A7A1A7, #958F96.
Subject: industrial metal floor grating made of a regular square grid of flat bars.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```

### `tex-liver-concrete` 肝化工廠：水泥

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #CFC6BE, #C2B8AF, #958F96.
Subject: worn factory concrete floor with faint flat patches.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```

### `tex-bbq-grass` 系烤會場：草地

- 附圖：不用附圖
- 備註：系烤會場色票尚未定，先用這三色。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: top-down seamless tileable floor texture, orthographic view looking straight down, flat colors, low contrast, low saturation, no outlines, no text. The left edge must continue the right edge and the top edge must continue the bottom edge. The image is only the floor surface filling the whole frame.
Colors: use only these colors: #9FBF8A, #8DB07A, #7A9E6A.
Subject: short trimmed lawn grass drawn as small flat tufts.
Avoid: text, letters, numbers, logos, perspective, vanishing point, objects, furniture, people, shadows of objects, lighting gradient, vignette, glossy reflections, photo, 3D render, diagonal stripes. Aspect ratio 1:1.
```


## I. 文具圖示（AI 底稿，江兆耘修整）

### `ic-weapon-stapler` 釘書機

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a chunky office stapler seen from the side, cream body with a navy top.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-weapon-folder` 公文夾

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a closed document folder (paper file folder) with a small clip, soft yellow.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-weapon-highlighter` 螢光筆

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a fat highlighter marker with the cap off, bright yellow (#FFE873) body and tip, the body is completely plain with no label, no printed words and no brand name.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-weapon-correction-tape` 修正帶（發表後才用，可延後）

- 附圖：不用附圖
- 備註：印章屬識別元素，不用 AI（§12.1）。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a correction tape dispenser, white and soft blue.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```


## J. 狀態圖示（10）

### `ic-tag-adenosine` 腺苷黏身

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small round pale lavender cotton ball with a dashed purple outline and a tiny 'z' above it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-cloak-on` 咖啡斗篷：生效（閉眼）

- 附圖：不用附圖
- 備註：三張斗篷狀態用同一個斗篷，只換眼睛；後兩張附這張成品。

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small hooded cloak in coffee brown with one big eye drawn on the front of the cloak (not in the hood), the eye is about one third of the cloak width and closed, drawn as a thick downward arc, the hood opening is empty and dark with no face.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-cloak-half` 咖啡斗篷：減弱（半睜）

- 附圖：選定的 ic-tag-cloak-on 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: exactly the same cloak as the attached image, but the eye is half open.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-cloak-off` 咖啡斗篷：失效（睜眼）

- 附圖：選定的 ic-tag-cloak-on 成品

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: exactly the same cloak as the attached image, but the eye is wide open and the cloak looks loose.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-withdrawal` 戒斷頭痛

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a simple round head silhouette with two small jagged throb marks above it and a tiny empty coffee cup beside it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-palpitation` 心悸

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a coral pink heart (#EE7A82) with two small vibration lines on each side.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-sugar-fatigue` 糖漿倦怠

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small amber puddle (#D9A441) with round bubbles and a droopy sleepy face.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-stiff-neck` 肩頸僵硬

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a simple bust silhouette with small zigzag stiffness marks on the neck and shoulders.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-dizzy` 頭暈冒冷汗

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a simple round face with swirl eyes and one cold sweat drop.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-tag-alcohol-ticket` 酒精工單

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small work order slip with an amber barrel symbol on it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```


## K. 修飾器圖示（6，公告欄與電梯面板共用）

### `ic-mod-sleepy` 腺苷睏睏

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a round wall clock with a small vent below and a lavender puff of smoke.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-mod-deadline` 死線看板

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small wall board with an hourglass on it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-mod-ranking` 排名看板

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small wall board with a simple podium of three bars and a bell.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-mod-core-dump` 核心傾印

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: an overturned file box with papers spilling out.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-mod-alcohol-line` 酒精產線

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a short conveyor belt carrying two amber barrels.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-mod-warehouse-locked` 倉庫上鎖

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a closed roller shutter door with a padlock.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```


## L. 行事曆與時段圖示（9）

### `ic-time-morning` 時段：上午（太陽）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a simple rising sun, soft yellow.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-time-afternoon` 時段：下午（書本）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: an open book, cream pages with a soft blue cover.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-time-evening` 時段：晚上（月亮）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a crescent moon with one small star, soft yellow.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-paper-exam` 紙筆考

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: an exam paper with a pencil lying across it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-lab-exam` 上機考

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small desktop computer monitor with a blank screen and a keyboard.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-deadline` 作業死線

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: an hourglass with a sheet of paper behind it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-office-hour` 助教 office hour

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: an office door slightly open with a small speech bubble beside it.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-internship` 實習面試

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small briefcase with a paper resume sticking out.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-cal-dept-event` 系上活動（系烤）

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a barbecue skewer and a paper cup.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```


## M. 福利關鍵字圖示（5，菌隊延後）

### `ic-perk-staple` 裝訂

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: two sheets of paper joined by a staple in the corner.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-perk-return` 退件

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a paper sheet with a curved arrow bouncing back.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-perk-mark` 標記

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a short yellow highlighter stroke under a small target circle.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-perk-line` 產線

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a small gear next to a short conveyor arrow.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```

### `ic-perk-archive` 歸檔

- 附圖：不用附圖

```text
Generate exactly ONE image. Not a sheet, not a grid, not multiple variations, no panels.
Style: single flat game UI icon, thick dark navy outline (#0C2D5E), flat fills, at most 4 colors, bold simple silhouette that is still readable at 32x32 pixels, slightly hand-drawn ink feel, small solid navy drop shadow offset to the bottom-right.
Composition: the single symbol centered, plain solid pure white background (#FFFFFF), no frame, no circle badge behind it, wide empty margin. Aspect ratio 1:1.
Subject: a file folder going into a drawer with a small downward arrow.
Avoid: text, letters, numbers, Chinese characters, logos, watermark, saturated red, teal or cyan, lightning bolt shapes, red cross symbol, gradients, 3D, glossy, photo, multiple icons, icon set.
```
