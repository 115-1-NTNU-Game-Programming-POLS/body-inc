# Cold start

Sections 1 to 3 are the Phase 1 baseline of issue #15, with the game loading its fonts from Google Fonts. Sections 4 and 5 compare it with Phase 2, which self-hosts subset fonts.

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

## 4. Scripted method for the comparison

Sections 2 and 3 were read by hand from the Network panel. The comparison below uses a script instead, so that the end point is exact and anyone can repeat it:

* **End point**: `TitleScene` sets the performance mark `title-ready` on the first frame drawn with the title. The time to title is that mark's `startTime`, measured from navigation start. It can also be read in the Timings track of a Performance panel recording, or in the console with `performance.getEntriesByName('title-ready')`. The Network panel's Load event is not a valid end point: it does not wait for the font gate, which runs after the bundle has started.
* **Script**: `node tools/perf/cold-start.mjs <url> --runs 5 --throttle` drives a headless Chrome started with `--remote-debugging-port=9333`. Each run opens a fresh tab, disables the cache, clears the site's storage (a saved host name would load extra font slices), and with `--throttle` limits the network to 10 Mbps down with 20 ms latency, the profile of section 1. Bytes are `encodedDataLength` of every request finished by the mark, which includes HTTP headers.
* **Builds**: both production builds under `npm run preview`. "Before" is `main` at `37eddd5` with only the `title-ready` mark added, so both builds end at the same point.

**Checking the end point.** In `npm run dev` without throttling, the median of three runs is 1.11 s without `?fontDelay=4000` and 4.90 s with it, a difference of 3.8 s. The difference is slightly under 4 s because the other assets keep loading during the delay. A method that ignored the font gate would show no difference.

The scripted baseline (5.95 s, 6,301 kB) is somewhat below the hand-read one of section 2 (6.43 s, 6,624 kB). The two differ in their end point and in which requests they count, so only figures taken with the script are compared below.

## 5. Before and after self-hosted subset fonts

### Results

| Measure | Before (Google Fonts) | After (self-hosted subsets) |
| --- | --- | --- |
| Time to title, 10 Mbps (median) | 5.95 s | 2.13 s |
| Time to title, unthrottled (median) | 2.21 s | 0.77 s |
| Transferred by the title | 6,301 kB | 1,460 kB |
| Requests by the title | 174 | 80 |
| Font bytes (woff2 and CSS) | 5,627 kB | 785 kB |

Raw values in milliseconds:

* Before, 10 Mbps: 5952, 5956, 5940, 6029, 5858.
* After, 10 Mbps: 2398, 2075, 1986, 2075, 2127, 2042, 2096, 3001, 2203, 2194.
* Before, unthrottled: 2211, 2148, 2359.
* After, unthrottled: 777, 689, 766.

Earlier sets of runs of the after build gave medians of 2.09 s (five runs), 2.66 s (three runs, one of them 5.9 s) and 2.15 s (five runs, one of them 7.8 s). In the 3.0 s run above, the fonts and the bundle finished on time (0.97 s and 1.12 s), so the extra time came after them. The machine's CPU was under heavy load during these runs; the outliers are reported but their cause was not investigated, and the baseline runs showed none.

### By category, after

| Category | Requests | Size |
| --- | --- | --- |
| Font woff2 | 4 | 782.5 kB |
| Font CSS | 1 | 2.8 kB |
| JavaScript | 1 | 408.9 kB |
| Portraits | 7 | 124.6 kB |
| Atlas PNG | 21 | 87.8 kB |
| Maps | 17 | 22.3 kB |
| Atlas JSON | 22 | 19.7 kB |
| Tilesets | 5 | 8.8 kB |
| HTML and manifest | 2 | 2.2 kB |

### Where the time goes now

At 10 Mbps the four base subsets finish at about 1.0 s and the bundle at about 1.1 s. The fonts are preloaded from `index.html`, so they download alongside the bundle instead of waiting for it to run the font gate. The remaining second, from the bundle to the title, is Boot loading and decoding the rest: the manifest, then every atlas, map, tileset and portrait. The fonts are no longer the bottleneck.

### Against the 1.5 MB budget

The 1,460 kB total is now within the budget of art direction 13.7, but only by about 40 kB. The budget assumed that only the logo, the fonts and `atlas-common` load before the title. Beyond those, Boot still loads the JavaScript bundle (409 kB, mostly Phaser), every portrait (125 kB), every atlas other than `atlas-common`, and every map and tileset. Moving portraits and chapter atlases out of Boot is the follow-up that would restore a margin.

### The subsets

`tools/fonts/build_fonts.py` subsets each face to the boot corpus: the characters `bootCorpus` in `src/view/text/corpus.ts` gives the font gate, 906 today. `tools/check-fonts.ts --corpus` prints the same set from the content files, and a test compares it with the corpus the game builds from its bundle.

| Face | Base subset | Common-character slices |
| --- | --- | --- |
| Noto Sans TC 400 | 128.4 KiB | 899.6 KiB in 47 slices |
| Noto Sans TC 700 | 131.2 KiB | 918.2 KiB in 47 slices |
| LXGW WenKai TC 400 | 248.6 KiB | 1,690.7 KiB in 47 slices |
| LXGW WenKai TC 700 | 254.7 KiB | 1,741.5 KiB in 47 slices |
| Total | 762.9 KiB | 5,250.0 KiB in 188 slices |

**The safety net of art direction 8.2.** Putting about 3,500 common characters into the base subsets would have cost about 2.2 MB on the cold path, as measured with 3,072 characters in the first version of this change, which is over the budget on its own. The characters the content does not use are therefore served as slices instead. The slices hold the 5,401 common characters of Big5 level 1 and the Latin-1 letters, minus the base set: 4,683 characters per face, 100 per slice, 28 KiB per slice on average. Only `admitText` (`src/view/text/fonts.ts`) declares them, through `fonts-extra.css`, when the player types a host name with a character outside the corpus, and the browser then fetches only the slices that name needs. A two-character name such as 志豪 fetches eight slices, two for each face, 213 KiB in all. A name with a character outside Big5 level 1, such as 鑫, or an emoji is refused with a message.

**Why the ranges matter.** Each `@font-face` declares a `unicode-range` holding exactly the characters its file has, read back from the file by the build. Without it a face defaults to `U+0-10FFFF`, and the font gate would treat every character as drawable, including an emoji or a character the subset lacks, which the browser would then draw in a system font.

### Checks

* `node tools/check-fonts.ts` (in `npm run check`) fails when the content uses a character a base subset does not declare. The fix is to rerun `python tools/fonts/build_fonts.py`.
* `python tools/fonts/check_fonts.py` (in the CI art checks) opens every woff2 file the two stylesheets name and fails when a declared range promises a code point the file's `cmap` lacks, when two faces of one family and weight declare the same code point, or when a font file is named by no stylesheet. `tools/fonts/fixtures/rare-glyph.css` declares 龘 for a real base subset, and CI runs it with `--expect-missing` to prove the check can fail.
* With `fonts.googleapis.com` and `fonts.gstatic.com` blocked (`--block "*fonts.googleapis.com*" --block "*fonts.gstatic.com*"`), the after build reaches the title in 0.76 s with all four faces loaded; the before build never shows the title.
