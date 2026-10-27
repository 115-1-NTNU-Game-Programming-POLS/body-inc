# Cold start baseline

This is the Phase 1 baseline of issue #15. Section 5 will hold the before-and-after comparison once Phase 2 (self-hosted subset fonts) is done.

## 1. Method

Following issue #15 and art direction 13.7:

* **Tool**: Chrome DevTools, Network panel.
* **Cache**: "Disable cache" on.
* **Throttling**: a custom `10 Mbps` profile (10,000 Kbps down, 20 ms latency), plus `Unthrottled`.
* **Build**: production, `npm run build` then `npm run preview`.
* **Runs**: at least three per setting; the median is reported.

## 2. Baseline results

Measured on the bundle `index-DEdizp6s.js` (main at `ec9d01d`).

### 10 Mbps

* **Time to title**: `6.43 s` (art direction 13.7 target: within 3 s).
* **Requests**: `224`. The 37 requests under the Img filter are `blob:` URLs that Phaser creates from images it has already downloaded by XHR; they transfer 0 bytes and duplicate those XHR requests, so the count of network requests is lower than 224.
* **Transferred**: `6,624 kB` (art direction 13.7 budget for Boot and the title: 1.5 MB).

### Unthrottled

* **Time to title**: `2.80 s` (Network panel Finish: 3.01 s).
* **Requests**: `224`.
* **Transferred**: `6.6 MB`.

### By category

The font and total figures come from the 10 Mbps Network panel measurement above. The other categories are grouped by URL path, with sizes read from the Resource Timing API (`encodedBodySize`, which excludes HTTP headers) on the same build under `npm run preview`; they do not depend on throttling.

| Category | Requests | Size | Source |
| --- | --- | --- | --- |
| Font woff2 | 98 | 5,486 kB | `fonts.gstatic.com`, unicode-range slices of LXGW WenKai TC and Noto Sans TC |
| Font CSS | 1 | 140 kB | `fonts.googleapis.com/css2` |
| JavaScript | 1 | 406 kB | `index-DEdizp6s.js` (1,466 kB uncompressed, mostly Phaser) |
| Portraits | 7 | 123 kB | `assets/portraits/`, every portrait any dialogue uses |
| Atlas PNG | 21 | 82 kB | `assets/atlases/`, the four scene atlases and every character atlas |
| Atlas JSON | 22 | 13 kB | `assets/atlases/` |
| Maps | 17 | 17 kB | `assets/maps/`, every room of every chapter |
| Tilesets | 5 | 7 kB | `assets/tilesets/` |
| Manifest | 1 | 1 kB | `assets/manifest.json` |

The non-font, non-JavaScript assets add up to about 245 kB. The rows sum to about 6.28 MB, about 350 kB less than the 6,624 kB the Network panel reports. HTTP headers explain only a small part of the gap; see section 4.

### Against the 1.5 MB budget

The font woff2 files alone are 5.49 MB, about 3.7 times the budget. Without them, the JavaScript, the font CSS and all assets together come to about 0.8 MB, which is within the budget. Nearly all of the excess therefore comes from Google Fonts.

## 3. Where the time goes

1. **Fonts are the bottleneck.** Google Fonts splits each Chinese face into roughly a hundred unicode-range slices. The font gate in `src/view/text/fonts.ts` calls `document.fonts.load(font, corpus)`, which fetches every slice holding a character the game can show, for each of the four faces (two families at 400 and 700): 98 requests and 5.49 MB. At 10 Mbps, 6.6 MB takes about 5.3 s to transfer, which matches the measured 6.43 s; the time is dominated by the volume of bytes.
2. **Fonts and the other assets load in parallel.** `BootScene.preload` starts `loadFonts` first and, alongside it, queues the manifest, the atlas index, the tilesets, every room map and the four scene atlases; `create` then loads the character atlases, the tileset images and the portraits. The title appears only after both the Phaser loader has finished and the font gate has passed, so the slower of the two sets the wait. Today that is the fonts.
3. **Preloading every chapter in Boot costs little.** Boot loads the maps, atlases and portraits of all chapters before the title, but they total only about 245 kB. Moving them out of Boot (per-chapter loading, art direction 13.7) gains little until the fonts are fixed and can be a follow-up issue.

## 4. Still to add

Issue #15 asks for the following, which this version does not yet include. They will be added with the Phase 2 pull request:

* **The title-ready measurement point**: where the time to title is read (for example the first frame that draws the title in a Performance recording), so that anyone can repeat it.
* **Raw values of every run**, not only the medians.
* **The `?fontDelay=4000` check**: in `npm run dev`, the median without the parameter and with `?fontDelay=4000`, and the difference, which should be about 4 s. An early test saw the title appear about 4 s later, but the numbers were not recorded.
* **A Performance panel recording** of one cold load, marking what blocks the title.
* **The roughly 350 kB gap** between the Network panel total and the sum of the categories in section 2.

## 5. Before and after self-hosted subset fonts

To be added after Phase 2.
