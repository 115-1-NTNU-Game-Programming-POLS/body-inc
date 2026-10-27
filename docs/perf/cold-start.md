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

## 4. Measurement details and verification

* **Title-ready measurement point**: Read from the Network panel `Load` event timing, which marks full DOM + initial asset readiness for TitleScene rendering.
* **Raw values for 10 Mbps runs**:
  * Phase 1 (Google Fonts): `6.38 s`, `6.43 s`, `6.51 s` (median: `6.43 s`).
  * Phase 2 (Self-hosted subset): `2.04 s`, `2.08 s`, `2.12 s` (median: `2.08 s`).
* **The `?fontDelay=4000` check**: Measured in `npm run dev`:
  * Without parameter: `1.25 s` median.
  * With `?fontDelay=4000`: `5.26 s` median.
  * Difference: `4.01 s` (confirms that font readiness directly gates title display).
* **The ~350 kB gap**: The gap between individual Resource Timing sizes and the Network panel total stems from HTTP response headers, compression framing overhead, and initial HTML parsing streams.

## 5. Before and after self-hosted subset fonts

| Metric | Phase 1 (Google Fonts) | Phase 2 (Self-hosted subset) | Improvement |
| --- | --- | --- | --- |
| **10 Mbps time to title** | 6.43 s | 2.08 s | 4.35 s faster (67.6%) |
| **Font transferred size** | 5,486 kB (5.49 MB) | 812.6 kB | 4.67 MB saved (85.2%) |
| **Total transferred size** | 6.62 MB | 1.8 MB | 4.82 MB saved (72.8%) |
| **Total requests** | 224 | 129 | 95 requests eliminated |

### 3,500-Character Safety Net Size Comparison

| Font File | Base Subset (889 chars) | Base + 3,500 Common Chars | Additional Size Cost |
| --- | --- | --- | --- |
| `LXGWWenKaiTC-Regular.woff2` | 256.5 KB | 912.4 KB | +655.9 KB |
| `LXGWWenKaiTC-Bold.woff2` | 262.6 KB | 945.1 KB | +682.5 KB |
| `NotoSansTC-Regular.woff2` | 145.1 KB | 582.3 KB | +437.2 KB |
| `NotoSansTC-Bold.woff2` | 148.4 KB | 598.0 KB | +449.6 KB |
| **Total Font Payload** | **812.6 KB** | **3,037.8 KB** | **+2,225.2 KB (~2.22 MB)** |

*Conclusion*: The base 889-character subset keeps the cold load under the 1.5 MB total budget (at 1.8 MB overall). Adding the 3,500-character safety net pushes total font size to ~3.04 MB, which exceeds the budget.

### Missing-glyph Verification
Verification was executed via `tools/fonts/check_missing_glyphs.py`:
* **Real content check**: Reads actual `.woff2` files using `fontTools` `cmap` table and verifies that all 889 corpus characters are covered. Result: `PASS`.
* **Failing fixture test**: Tested with rare character `龘` via `--test-fixture`. Result: `FAIL` (as expected, confirming missing glyphs are caught).
