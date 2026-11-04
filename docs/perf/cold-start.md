# Cold start

Sections 1 to 3 are the Phase 1 baseline of issue #15, with the game loading its fonts from Google Fonts. Sections 4 and 5 compare it with Phase 2, which self-hosts subset fonts. Section 6 is the re-measurement of issue #72 and holds the current baseline and budget.

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

## 6. Re-measurement and the budget (issue #72)

Content grew after section 5 was written, and by the time of issue #72 the title transferred 1,861.6 kB on `main` (`e0d57c1`), over the 1,460 kB recorded after issue #15. This section records a new baseline taken with the scripted method of section 4, the one change made to the cold path, and a revised budget with a check that enforces it. Both builds were produced on one machine in one session, and every setting has five runs except where stated. The script gained two figures in this round. "Settled" is the bytes that finished within three seconds after the `title-ready` mark, which catches a download that starts at the first frame of the title and so is missed by the bytes finished by the mark. `--prologue` presses Enter after the title (new game, confirm the host name) and reports the time of the first frame of the prologue room, set as the `prologue-ready` mark by `WorldScene`.

### Results

| Measure at 10 Mbps, median of five | `main` | After |
| --- | --- | --- |
| Time to title | 2.72 s | 2.39 s |
| Transferred by the title | 1,861.6 kB | 1,640.1 kB |
| Requests by the title | 110 | 97 |
| Transferred, settled | 1,861.6 kB | 1,861.8 kB |
| Time to prologue (target 8 s) | not measured | 3.28 s |

Raw values in milliseconds: `main` to title 2791, 3193, 2723, 2582, 2575; after to title 2389, 2403, 2368, 2388, 2446; after to prologue 3305, 3278, 3420, 3265, 3258. Unthrottled, the after build reaches the title in 0.59 s (583, 620, 585, 586, 640). With `fonts.googleapis.com` and `fonts.gstatic.com` blocked the title still appears, at 2.47 s (three runs). In `npm run dev`, `?fontDelay=4000` moves the title from 1.04 s to 4.96 s, so the gate still holds the title for the fonts. The prologue time is a floor: the keys are sent right after the title, where a person would read it first.

The bytes by the title after the change, by category: font woff2 979.7 kB in 4 requests, JavaScript 483.8 kB, atlas PNG 86.8 kB in 21, maps 51.6 kB in 39, atlas JSON 19.5 kB in 22, tilesets 13.1 kB in 7, font CSS 3.4 kB, `manifest.json` 1.3 kB and `index.html` 0.9 kB. The four base font subsets hold the 1,115 characters of the boot corpus (906 at issue #15) and weigh 978.4 kB (955.5 KiB): Noto Sans TC 164.5 kB at 400 and 168.4 kB at 700, LXGW WenKai TC 318.4 kB at 400 and 327.1 kB at 700. The margin of about 40 kB that section 5 describes no longer exists.

### What changed on the cold path

One thing moved: the 13 dialogue portraits, 221.7 kB, no longer load in `BootScene`. `TitleScene` starts loading them after its first frame, and `DialogueScene` loads a missing one itself and redraws when it arrives, so a conversation that starts early (a dev URL that skips the title) still shows its portrait. This lowers the bytes by the title by 221.7 kB and the time to title by about a third of a second, but it does not lower the total: the settled figure is the same as on `main`, because the portraits download right behind the title.

Dropping the Bold faces from the cold path was tried and rejected. Weight 700 is used by the title itself and by the host name, course, dialogue name tag, exam and pause screens, so the browser fetches the two Bold files (496 kB) the moment the title draws. The bytes by the title then look 496 kB smaller, because the files are still in flight at the mark, and the saving is only that the mark is taken before they arrive. The settled figure shows this, and keeping the Bold faces in the font gate also keeps the guarantee of section 5 that no text is drawn in a fallback font. Removing a face changes how the game looks and was left to the maintainer, who kept both weights.

### The budget

Art direction 13.7 gave 1.5 MB for "Boot and the title (logo, fonts, `atlas-common`)". That list does not include the JavaScript bundle, about 480 kB and mostly Phaser, yet issues #15 and #72 compare the budget with everything the title transfers, which is the reading that left the title 140 kB over. The document does not record how 1.5 MB was derived. The measurements here give some context: at 10 Mbps the title took 2.13 s at 1,460 kB (section 5), 2.39 s at 1,640 kB and 2.72 s at 1,862 kB, so even `main` was inside the 3 s target and the byte budget is a margin for slower machines and the venue network, not a limit the target needs. The limit is therefore now 1,750 kB for everything that finishes before the title, bundle included, about 110 kB above today's 1,640 kB. It is a guard against drift rather than a derived constant, and art direction 13.7 says so.

`tools/check-perf-budget.ts` enforces it and runs at the end of `npm run build`, so it is part of `npm run verify` and of the CI `verify` job. It adds up the files Boot loads from a production build in `dist/`, using the same lists as `BootScene`: the files `index.html` names, every face the font stylesheet declares, the manifest, the atlas index, the scene atlases (`SCENE_ATLASES` in `src/app/assets.ts`, shared with Boot), the atlas of every manifest entry, every room map of every chapter and the tileset images those maps use. Text files count as gzip and the rest as they are, with 350 bytes per request for headers. On the build measured above it gives 1,638.6 kB across 97 files, against 1,640.1 kB and 97 requests in the browser. A file the cold path needs and the build lacks is a failure, not zero bytes. `test/tools/perf-budget.test.ts` shows that it can fail: it builds a `dist/` from the real assets with a bundle of 400 kB, which passes, and with 900 kB, which fails, and it fails on a lowered limit and on a deleted font file.

### Levers left

If the title ever needs to move well under the limit, the largest one is splitting each base font subset into the characters the title draws and the rest, and loading the rest behind the title. By an estimate that was not measured, it would take the bytes by the title to roughly 760 kB, but the settled total would not change, and it needs changes to `tools/fonts/build_fonts.py`, the font gate and the title scene. Dropping the two Bold faces saves 496 kB for real and costs the bold look. The bundle cannot be split in a useful way, because Phaser is most of it.
