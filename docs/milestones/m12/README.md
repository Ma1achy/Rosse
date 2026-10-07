# M12: the extras

Roadmap row: the Galaxy Zoo 2 catalogue browser, `fromVotes`, the 42 real galaxies, SVG export for pen plotters, and GIF export. Everything is in new modules under `src/extras/`. M11's page (PR #12) needs hooks from its side to call them: "What M12 needs from M11" below says which, and what M11 provides. **Status: 19 of the 20 real-galaxy goldens pass (`Real galaxy 6` at home fails its r50 band, by 0.06 points; see 3), the quasar-flare GIF is deferred to M9 (accepted by the owner), and everything else listed below is done.** No output changed: `tests/golden/engine-hashes.json` is untouched, and no existing test, case or threshold was changed (the only edits outside `src/extras/` are listed under "What else changed").

**Attribution the page must carry** (docs/open-questions.md Q1), in `src/extras/attribution.ts` and carried by every `GalaxyCard` and `RealCard` (`card.attribution`: `credit`, `licence` with its link, `changes`, `sdss`, and `text` for one line), so a page that shows a card has it. Galaxy Zoo 2 is CC BY 4.0: the credit (the project and Willett et al. 2013, Hart et al. 2016), the licence link (https://creativecommons.org/licenses/by/4.0/) and the indication of changes (the votes quantised to a byte and re-packed, parameters derived from them). **The SDSS acknowledgement is not the published wording:** the pack (assets/) holds none, and I could not check SDSS's text from here, so `SDSS_ACKNOWLEDGEMENT` points to https://www.sdss.org/collaboration/citing-sdss/. **The owner must check what SDSS requires for the imagery and paste the wording in.**

## What was built

| item | where | tests |
| --- | --- | --- |
| `fromVotes`, `fromReal`, `describe`, `shortType` | `src/extras/from-votes.ts` | `tests/unit/from-votes.test.ts` against `tests/vectors/from-votes.json` (captured from v21) |
| catalogue decode, tools, worker | `src/extras/catalogue/` | `tests/unit/catalogue.test.ts` against `tests/vectors/gz2-catalogue.json` (from `decode_gz2_catalogue.py`), `tests/gpu/catalogue.ts` (the worker, in Chromium) |
| the 42 real galaxies | `src/extras/real/real-galaxies.ts` | `tests/unit/real-galaxies.test.ts`; goldens for 10 |
| SVG export | `src/extras/export/svg.ts`, `read-layers.ts`, `capsule-roles.ts`, `engine.ts` | `tests/unit/svg.test.ts` against `tests/vectors/svg-v21.json`, `tests/gpu/svg.ts` |
| GIF export | `src/extras/export/gif.ts`, `gif-worker.ts`, `gif-frames.ts`, `record.ts` | `tests/unit/gif.test.ts`, `tests/gpu/gif.ts` |

### Integration surface, and what M12 needs from M11

```ts
// the catalogue (a worker; load on first use, close to free 16 MiB)
import catalogueUrl from '../../assets/data/rosse/gz2-catalogue.json?url';
const cat = new CatalogueClient();
await cat.load(catalogueUrl);                       // idempotent; LoadStats: n, ms per step, heldBytes
const i = await cat.random('barred');               // v21's types: GALAXY_TYPE_NAMES
const card = await cat.card(i);                     // card.mapping.p is a full Params; card.caption.*, card.attribution
const r = await cat.find('588017703489241360');     // an object id, or "185.72, 15.82"
const page = await cat.filter({ type: 'a spiral', where: [{ field: 'gr', min: 0.8 }], limit: 50 });

// real galaxies
const cards = realCards();                          // photoUrl, postitUrl, caption, description, params, attribution, …

// SVG (the key ink, whatever plates show): inside the frame queue
const { svg, counts } = await exportSvgGpu(gpuStipple);        // or exportSvgCpu(cpuStipple, view)

// GIF: a source of ink frames, quantised as they arrive
const bytes = await recordGif(timelineSource(w, h, P, drawInk), { frames, end, speed, ...gifColours('paper'), mode: 'ramp' }, encodeInWorker, onProgress, restoreMTime);
```

To draw a catalogue or real galaxy, the page uses `card.mapping.p` / `cards[i].params` as it uses a preset's parameters. Overlays the engine places at the view where it first sees them follow the engine's rule (ADR 0030), not v21's `homeFor`.

**What M12 needs from M11, read from `origin/claude/m11-page-and-ui` (PR #12) on 2026-10-07, and what it provides today.** M12's modules are not wired into M11's page; the page's `Engine` interface (src/ui/page.ts, main.ts) is private and its export is PNG only (`snapshot(): Promise<Pixels>`), so each of these is a change on M11's side (the M11 agent is adding the first two):

| M12 needs | M11 today | to do |
| --- | --- | --- |
| an engine export hook: the current `GpuStipple` and the last `CpuStipple` and view, run inside the frame queue as `snapshot` is | none (`Engine` is not exported; `snapshot` returns pixels) | M11 adds the hook (being added); the page calls `exportSvgGpu` / `exportSvgCpu` through it, and `gpuInkFrame` / `cpuInkFrame` for GIF frames |
| the timeline's end and speed (and whether it is a merger or a quasar timeline) as page state | `TimelineState` lives in a closure in `page.ts`, not on `Page` | M11 adds accessors (being added) |
| a galaxy source that is not a preset, in the URL | `PageState.preset` must be a `PRESETS` name; `writeUrl` swallows the error for others; the URL is preset-plus-differences | M11 stops `writeUrl` failing silently (being added); a catalogue or real galaxy needs a URL form (an object id, `?gz2=<objid>` or `?real=<i>`, resolved to `Params` through `catalogueSeed`/`fromVotes`, then the usual differences), which is M11's `urlstate.ts` to define: until then a link to such a galaxy cannot be shared |
| Export SVG and Export GIF buttons, a Galaxy Zoo panel (types, search, find) and the real-galaxy gallery | PNG export only (`export.ts`'s `pngBlob`, `downloadBlob`, reusable for the blobs) | M11 builds the panel and buttons against this surface |
| attribution shown with a catalogue or real galaxy | none | show `card.attribution` |

## Results

### 1. `fromVotes`

A pure function, v21's line for line (including its `mulberry32` stream of `seed · 101 + 9`). `tools/capture-reference/votes.mjs` runs v21's own `fromVotes`, `fromReal`, `describe` and `shortType` in Chromium (a copy of the page with one line added to expose them) for all 42 real galaxies and 339 catalogue rows (every type of v21's buttons, 24 star-or-artefact rows, rows with `q`, `conc`, `gr` missing, and shell, merger, lens and ring cases), and 14 rows through v21's own `showCat` (whose captions the module writes word for word). **`toEqual` on every parameter, exactly.** The test also checks that every branch is covered (every odd feature, `merger`, `lensOn`, `shellsOn`, `irr`, `streams`, `jet`, `ovStar`, `whole`).

**One deliberate difference.** v21's star-or-artefact branch returns the bare parameters (not `{ p, odd }`), so its `showReal` and `showCat` fail on such a galaxy (`Cannot read properties of undefined (reading 'bulge')`, recorded from the page). 24 of the 339 sampled catalogue rows are such galaxies (about 7%). `fromVotes` returns `{ p, odd: null }` for them, with v21's parameters.

### 2. The catalogue

Decode matches `decode_gz2_catalogue.py` on every field: the SHA-256 of all 39 byte columns, RA, Dec and the 239,695 object ids (`tests/vectors/gz2-catalogue.json`, written by `tools/catalogue-reference/make_vectors.py` with numpy), and 245 sampled rows with every byte, RA, Dec and id compared exactly; in Node (`catalogue.test.ts`) and through the real worker in Chromium (`tests/gpu/catalogue.ts`). The ids exceed 2^53 and are held as a `BigUint64Array`. The types, random, find and filter tools are tested against numpy masks of v21's `TYPES` (the counts of all 11 types, and the first five matches of each).

Robustness: the client rejects every pending request if the worker crashes or sends an unreadable message, and when closed with requests in flight; `load` is idempotent (one decode for any number of calls); a malformed request gets an error reply; load failures (404, corrupt or truncated gzip) reject and the next call retries (`catalogue.test.ts`). The tools refuse NaN, an unknown type or field, and a cone outside the sky instead of matching everything, and right ascension wraps (a cone at RA 0.01° finds a galaxy at 359.99°).

Tools: v21's eleven types; `random` (uniform among every match in one scan, with an injected random source: v21 tries up to 400,000 random indices and gives up); find by object id (binary search: the ids ascend) or by position (within one arcminute, v21's metric); and what v21 has not: `filter` by any field's range (in the field's own units: fractions for votes) and a cone, paged, in one scan of 240k rows.

**The phone concern: measured cost.**

| | desktop, Chromium on SwiftShader (shared, loaded machine) |
| --- | --- |
| download | 7.3 MB (the packed JSON; 5.4 MB of gzip in base64) |
| fetch + JSON parse + base64 | 133 ms |
| gunzip (`DecompressionStream`) | 214 ms |
| columns, RA, Dec, ids | 60 ms |
| worker load, wall | 545 ms |
| retained | 16.3 MiB: the 11.3 MB of unpacked bytes (the 39 columns are views of it), RA and Dec as `Float64Array` (1.9 MB each) and the ids as a `BigUint64Array` (1.9 MB) |
| transient peak | about 30 to 35 MB, estimated (the text and the parsed string, the 5.4 MB of bytes, the 11.3 MB unpacked, the stream's chunks), not measured |

v21 keeps the same columns but the ids as 239,695 decimal strings (several times the 1.9 MB) and decodes on the main thread. Nothing here is measured on a phone: I had none. On a phone 4 to 8 times slower than this machine the load would take 2 to 5 seconds, in a worker, and hold about 16 MiB afterwards; the risk is the transient peak on a 2 GB phone while a WebGPU context is also alive. Mitigations that need no change of the data: load only when the browser panel is first opened (the client loads on `load()`), and `close()` the worker to free the 16 MiB when the panel is closed. A smaller form (RA and Dec as `Float32Array`, losing the exact `ra.toFixed(5)` of v21's caption; or dropping the unpacked id bytes) is an owner decision, not made here.

### 3. Real galaxies

`realCards()`: the 42 cards, with photo (160 px), post-it (webp), the print's words (`shortType`), the sentence under the plate (`describe`), v21's tilt of the print and of the post-it, the photo's axis ratio and angle beside the drawing's angle and inclination (the photo comparison), and the SkyServer link. `tests/unit/real-galaxies.test.ts` also checks that the golden captures' parameters, which v21 wrote, are `fromReal`'s plus the case's overrides.

**Goldens.** Ten galaxies captured from v21 (`capture:reference` gained `"real": i` in an `--extra` case: tools/capture-reference/README.md): indices 0, 3, 6, 10, 12, 15, 19, 23, 26 and 37, home and orbit, 20 captures, with only `starMix 0`, `field 0`, `fgstars 0` (M7's). The mergers (34 to 36), the lensed galaxy (39) and the shells need M8 and M9 and are not in the ten. A new family `real` (ADR 0060, **accepted** by the owner on 2026-10-07; calibrated once: 40 configurations, 120 re-draw pairs and the negative controls) and its results are below. **It is calibrated on engine re-draws only** (`v21Reroll: null`) and its 40 configurations include the 20 gated captures; only seed 3 is held out. ADR 0018 item 7 calibrates the `lines` family on held-out v21 captures as well; for `real` they are not made yet (they come with the `Real galaxy 6` re-captures), so the family is not out-of-sample.

**Result: 19 of 20 pass, 1 fails** (WebGPU against v21, the mean of K = 6 draws; the CPU engine gives the same numbers, CPU = GPU passes strict and L0 is identical in all 20; run once, `npm run golden -- --only real-galaxy`, 267 s after the re-draws). The family's bands (`thresholds.json`, `real`): coarse SSIM ≥ 0.89, ink ±5%, widths ±10%, r25 ±3.2%, r50 ±3.7%, r90 ±5.0%, outer ink ±1.4 points, with per-galaxy axis-ratio and widened moment bands (ADR 0026's rule).

| case | ink | coarse SSIM | median | p90 | r50 | r90 | dots / knots / stars / rstars | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| real-galaxy-0 s2009 home | 0.3% | 0.931 | -0.3% | 0.5% | 1.5% | -1.0% | 13742/13742 0/0 0/0 0/0 | pass |
| real-galaxy-0 s2009 orbit | 0.3% | 0.931 | 0.2% | 1.3% | 1.3% | -1.2% | 13742/13742 0/0 0/0 0/0 | pass |
| real-galaxy-3 s4288 home | 2.9% | 0.956 | 0.0% | -0.4% | 0.5% | 0.1% | 5480/5480 0/0 0/0 0/0 | pass |
| real-galaxy-3 s4288 orbit | 2.8% | 0.958 | 0.0% | 0.1% | 0.7% | 0.7% | 5480/5480 0/0 0/0 0/0 | pass |
| real-galaxy-6 s586 home | -2.2% | 0.959 | -0.3% | 3.1% | -4.0% | -1.1% | 4128/4110 97/109 5/8 0/0 | FAIL r50 -3.96% (±3.90%) |
| real-galaxy-6 s586 orbit | -1.3% | 0.964 | -1.0% | -3.9% | 1.0% | 2.5% | 5702/5771 120/126 7/11 0/0 | pass |
| real-galaxy-10 s7941 home | 0.6% | 0.925 | -0.8% | -0.6% | 0.8% | 1.3% | 10074/10091 49/47 10/10 15/15 | pass |
| real-galaxy-10 s7941 orbit | 1.2% | 0.956 | 0.3% | -0.3% | -0.0% | -2.6% | 9571/9641 49/47 9/16 15/15 | pass |
| real-galaxy-12 s6057 home | -1.2% | 0.940 | 0.5% | 1.7% | -0.5% | 0.6% | 9815/9807 150/162 21/18 0/0 | pass |
| real-galaxy-12 s6057 orbit | -1.4% | 0.948 | -0.9% | 2.3% | -0.5% | 0.8% | 9728/9720 148/154 21/16 0/0 | pass |
| real-galaxy-15 s9946 home | 1.2% | 0.960 | -0.3% | -0.4% | 1.1% | 1.7% | 10099/10096 115/104 8/9 12/12 | pass |
| real-galaxy-15 s9946 orbit | 0.8% | 0.970 | 1.3% | 2.2% | 1.7% | 1.3% | 10070/10086 116/115 8/9 12/12 | pass |
| real-galaxy-19 s1884 home | 0.6% | 0.909 | 0.3% | 1.6% | -0.5% | 0.0% | 10131/10099 70/78 7/9 0/0 | pass |
| real-galaxy-19 s1884 orbit | 1.0% | 0.936 | 0.7% | 2.7% | 0.5% | -0.8% | 10014/9978 69/74 7/10 0/0 | pass |
| real-galaxy-23 s8748 home | -1.3% | 0.973 | 0.4% | -0.7% | 0.4% | -1.6% | 9449/9470 162/174 21/20 0/0 | pass |
| real-galaxy-23 s8748 orbit | 0.0% | 0.966 | 0.1% | 3.2% | 0.5% | 0.8% | 8282/8296 149/159 18/15 0/0 | pass |
| real-galaxy-26 s7121 home | 1.9% | 0.945 | -0.1% | 0.9% | -0.4% | 1.7% | 9714/9732 92/91 11/9 0/0 | pass |
| real-galaxy-26 s7121 orbit | 1.2% | 0.950 | 0.6% | 2.1% | 0.8% | 2.5% | 9620/9646 92/88 11/8 0/0 | pass |
| real-galaxy-37 s3937 home | -0.1% | 0.949 | 0.1% | -0.7% | -0.5% | -0.9% | 8024/8094 52/44 8/4 0/0 | pass |
| real-galaxy-37 s3937 orbit | -0.0% | 0.966 | -1.2% | 1.5% | 0.5% | -1.0% | 8024/8094 52/44 8/4 0/0 | pass |

**The one failure** is `Real galaxy 6` (an edge-on disc with a dust lane) at home: r50 -3.96% against its band of ±3.90%, a miss of 0.06 points; every other measure of it passes, and its orbit passes. The M5 `Edge-on with dust` cases fail the same way, by one moment measure just past the calibrated band (docs/milestones/m5). I did not widen the band: it is the calibration's, and a second calibration with more held-out configurations of that galaxy could move it either way. Owner decision (2026-10-07): the band is not widened. The case stays failing, and is re-checked against the mean of K ≥ 6 v21 re-captures of that configuration (`--reroll`) once M7's mechanism for that is in main (watch origin/main; new ADR if needed).

The calibration (`npm run golden -- --calibrate --only-family real --keys 6 --controls-every 3`, once): 40 configurations (the 20 captures, and the ten galaxies' seed 3 at home and orbit), 120 re-draw pairs; the coarse SSIM of two engine draws of the same real galaxy has median 0.952 and 5th percentile 0.919. The negative controls (every third configuration): a turned galaxy (±30°) and an orbit are caught in 12 of 12, bigger dots in 15 of 15, a truncated disc (RMAX 4.2) in 14 of 15, a disc three times thicker in 11 of 12, a flatter or rounder bulge in 3 of 3; a removed halo in 5 of 15, as in the other families.


### 4. SVG export

One layer per pen (`background`, `drawings`, `arms`, `dust`, `cores`, `knots`, `dots`, `stars`, v21's names and order), every line a path, every dot a circle, stars as rays, cores as nested rings, as `exportSVG`. It is built from the frame's ink layers, in the forms the frame draws them (`InkLayer`), so both engines go through one function: the CPU engine's arrays directly, the WebGPU engine's buffers copied back on demand (`readInkLayers`: the sprites' instances by their indirect counts, the ribbon segments, the capsules), never on the frame path.

- **Polylines.** v21 records each polyline it draws; the engine's buffers hold segments. A ribbon's quads are chained back (consecutive segments whose ends meet) into the centre line of their corners, with the stroke's width (`quad · thick / h`, v21 L822); capsules are chained the same way. For all five presets the arm and dust layers have **exactly** v21's counts.
- **Which layer.** The hatching's capsules are the first of the capsule layer (`dust`); the placed drawings' are assigned to `stars` (v21's drawn stars, sheet `sstars`) or `drawings` by replaying the compaction on the capsule slots (`capsule-roles.ts`). `LayerBase.svgLayer` (src/render/layers.ts, optional, no effect on drawing) lets a layer name its SVG layer: M7's deep field should set `'background'`.
- **What is compared, and how GPU parity is shown.** Against v21 only the element counts per layer are compared, not coordinates, widths or colours (v21's SVG is not stored; its counts are in `tests/vectors/svg-v21.json`). GPU parity is chained through the CPU: the CPU engine's SVG is compared with v21's counts (Node), and the WebGPU SVG with the CPU's (Chromium); there is no direct WebGPU-against-v21 comparison. The re-rasterised comparison is against the engine's own plate, not v21's.
- **GPU export rules.** It copies live buffers with several awaited reads, so it must run inside the frame queue (like M11's snapshot); a second export of one engine at once is refused, an export during which the view tier ran is refused as stale, and the placed drawings are laid out for the camera of the last view (`GpuStipple.lastCamera`), not a zoom the caller passes. `tests/gpu/svg.ts` exports after a zoom and after an orbit (view-only changes) and checks the counts against the CPU's, and checks both refusals.
- **Checks** (`tests/unit/svg.test.ts` and `tests/gpu/svg.ts`):
  - **Valid:** well-formed in a structural check in Node, and parsed by Chromium's `DOMParser`, whose layer groups hold as many elements as the counts say.
  - **Same layers, same counts as v21** for five presets (Grand design, Flocculent, Dusty spiral, Smooth round, Edge-on with dust; the golden `single` overrides, seed 7), the CPU engine drawing with v21's variation and picks as the golden comparison does, each layer's count within the count rule of test (d) (±3%, ±10% under 100, 3 · √(v21 + engine) under 2,000). The counts are printed by the test; for example Grand design `arms 27/27, dust 155/155, cores 1/1, knots 183/181, dots 9398/9376, stars 19/21`.
  - **GPU = CPU:** the same layers and, per layer, the same counts (within 0.1%, at least 1) on seven cases (home and orbit): in every case equal.
  - **Re-rasterised, it matches the plate's ink at the structure threshold:** Chromium rasterises the SVG, and the coarse density maps (σ = 16 px, ADR 0013 b′) of it and of the plate's ink score 0.93 to 0.97 (CPU and WebGPU SVG identical to the thousandth) against the family's band (0.89 spiral, 0.91 smooth); the same galaxy turned 30° scores 0.61 to 0.80, under the band. The SVG's ink is 0.73 to 0.78 of the plate's (circles and strokes are simplified, as in v21's own, whose SVG has 0.77 to 0.86 of its plate).
- **Deferred.** A fifth preset, `Barred spiral`, is not in the five: v21's `stars` layer has 93 drawn stars there (`sstars` from the stipple's drawn-star class, `rstars`), which the engine draws from M7 on; the engine has 10. The `background` layer (deep field and foreground stars) is empty for the same reason. The merged capsule buffer holds the hatching and the placed drawings of one frame, so `drawings` includes v21's `background` drawings (none of the five has any).

### 5. GIF export

v21's encoder (`gifEncode`) is ported unchanged and tested against an independent decoder (`tests/unit/support/gif-decode.ts`: header, palette, extensions, variable-width LZW including the 4,096-entry table reset) and, once, against Pillow (3 frames of noise through a reset: every pixel equal). v21's two palettes: the 256-step ramp from the surface to the ink for the key ink (an ink pixel is its alpha, to 8 bits, on the paper and on the chalkboard: tested for both), and the 6 × 7 × 6 colour cube plus the surface for colour plates. The frame's times (`k / n · end`, so the GIF loops) and the delay (`round(12 / speed · end / 2 / n · 100)`, at least 2 cs) are v21's. The frames are the engine's ink target at the GIF's size, read back (`cpuInkFrame`, `gpuInkFrame`); the encoder runs in a worker (`encodeInWorker`). **Memory:** each frame is quantised to one byte a pixel as it arrives and its RGBA is dropped (v21's `frames`), so a recording holds `frames × width × height` bytes (49 MB at v21's largest, 640 px and 120 frames; the first version held every RGBA frame, about 200 MB); `tests/unit/gif.test.ts` checks that the encoder receives one byte a pixel. One recording at a time (v21's `GIFBUSY`), sizes and delays above 65,535 and empty frames are refused, `done` runs however a recording ends (restore `mTime` there), and the worker is terminated in a `finally`. **Palettes:** the colour cube's entry 252 is the surface and is what an empty pixel maps to (the first version mapped an empty Paper plate to a pink and an empty Chalkboard to a purple); the tests use the engine's own surfaces, Paper #e6dece (230, 222, 206) and Chalkboard #262b28 (38, 43, 40), through `gifColours`.

- **Frames match single renders at those moments,** index for index: on the CPU engine in Node (`gif.test.ts`: the orbit swept through the timeline, on paper and on the chalkboard), and on WebGPU through the real worker in Chromium (`tests/gpu/gif.ts`: 4 frames, delay 150 cs at speed 2, 29 KB at 160 px). GPU frames are within 2/255 of the CPU's on all but 0.1% of pixels (measured: worst difference 1).
- **The merger timeline and the quasar flare.** `recordGif` takes any source, `frame(t)` giving the ink at time t; for the merger v21 sets `mTime = t` and renders (L1722). `timelineSource` (`sources.ts`) is that: `frame(t)` draws `{ ...params, mTime: t }`. With M8 merged, **the merger timeline is wired and tested on both engines**: the Mice at `mTime` 0, 0.5, 1 and 1.5, one simulation with `mTime` re-blended per frame (`CpuMerger.view(1, t)`, `GpuMerger.view(1, t)`), and every frame equals a fresh build at that moment (CPU in Node, WebGPU through the worker in Chromium); consecutive frames differ in hundreds of pixels; WebGPU against the CPU engine scores a coarse SSIM of 1.000 on all four frames (strict band 0.98).
- **Quasar flare: deferred until M9 merges, an owner-accepted deferral (2026-10-07).** The lens source `quasar` and its flare are M9's; the source is the same `mTime` (`isTimeline` already accepts it), so the page wires it when M9 lands.

## What else changed

- `tools/capture-reference/capture.mjs`: a case with `"real": i` (documented in its header and README); `votes.mjs`, `svg.mjs`; `tools/catalogue-reference/make_vectors.py`.
- `tests/golden`: 10 cases in `extra-cases.json`, 20 captures and their manifest entries, `goldenFamily` returns `real` for variant `real`, the calibration's `--only-family real` (held-out configurations from the captures), and the merge into `thresholds.json` and `calibration.json` now keeps the other families' configurations in order and formats them with Prettier. The family `real` is the only change to the thresholds.
- Edits to the engine's files, all additive: `src/render/layers.ts` (optional `svgLayer`, honoured for sprite layers), `src/render/stipple.ts` (a `lastCamera` getter), and `COPY_SRC` on the static indirect-argument buffers of the hatching, placed drawings and shells (`ribbons.ts`, `vectors.ts`, `shells.ts`) so an export can read their counts.
- `capture:reference` leaves a camera's `runs` record alone on a run narrowed with `--only` or `--variants` (the manifest's `generated` stamps for the other captures are the originals), and `golden --only … --update-engine` adds to `engine-hashes.json` and changes none of the hashes already there.
- `docs/adr/0060-the-real-galaxies-are-their-own-golden-family.md` (accepted by the owner, 2026-10-07; listed in docs/architecture.md).

## Owner decisions

Made on 2026-10-07: ADR 0060 accepted; the catalogue's memory accepted as it is (16.3 MiB held, about 30 to 35 MB peak: not shrunk); the page draws the star-or-artefact catalogue galaxies (as `fromVotes` now returns them); the attribution kept and made complete; the `Real galaxy 6` band not widened (re-capture mechanism above); the quasar-flare GIF deferred to M9.

Still open:

1. **The SDSS acknowledgement wording** (above): not in the pack, not verified.
2. The real family's held-out v21 captures (with `Real galaxy 6`'s re-captures, once M7's mechanism is in main).
3. The overrides `starMix 0, field 0, fgstars 0` of the real cases retire with M7: re-capture without them.
4. SVG: the `stars` layer for the engine's drawn stars and the `background` layer come with M7; `Barred spiral` joins the five then.

## Not done, or deferred

- The quasar-flare GIF (M9): `isTimeline` already accepts `lensOn` with `lensSource: 'quasar'`, and the source is the same `mTime`; it needs M9's engine to draw it.
- The SVG export of a merger, shells or lens: `readInkLayers` and `buildSvg` take any frame's layers, but the capsule roles (hatching against placed drawings) are known only for a single galaxy's frame, so those frames would put every capsule in `drawings`. Not tested; not wired.
- The real galaxies that are mergers, lensed or have shells (indices 34 to 36, 39) as goldens: M8 and M9 families.
- Engine hashes: written for the 20 new cases only (`--only real-galaxy --update-engine`); the existing hashes are unchanged.
- Wiring into M11's page: see "What M12 needs from M11".
- Measurements on a phone.
