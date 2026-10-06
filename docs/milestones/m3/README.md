# M3: camera and orbit

The plate now orbits, rolls and zooms with v21's own controls, and a camera move re-runs only the view tier: projection, culls and compaction. The stipple samples of the model tier are never touched. All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Smooth, round`, seed 7, zoom 2 | `smooth-round-s7-zoom.jpg` |
| `Disc, no arms`, seed 4242, zoom 2 | `disc-no-arms-s4242-zoom.jpg` |
| `Cigar-shaped`, seed 7, orbit camera | `cigar-shaped-s7-orbit.jpg` |

These are the stipple-only variants, taken with `node tools/gpu-test/side-by-side.mjs --set m3`, which gives the page the capture's camera and zoom. As in M2, the page draws with the engine's own hand. The golden comparison uses v21's hand.

## What is built

- **`view/camera`, one rotation.** v21 writes the camera's rotation out five times: `project` (L153), `discM` (L126), `rotFwd`/`rotInv` (L440–441) and `toView`/`toScreen` (L859–860). Here `rotation(o)` evaluates the trigonometry once, and these functions read it:
  - `rotFwd`, `rotInv`, `toView`, `toScreen` and `project`;
  - the deep-field perspective `perspective(z)` = CAM / (CAM − z), with CAM = 30;
  - `discM`, `basis`, `orient`, `scenePoint` and `srcNow`. The last two take the home orientation as an argument rather than remembering it as `homeFor` does (deliberate divergence 2);
  - `viewDesc`, the same numbers rounded to f32 once, which both engines read.

  `common/camera.wgsl` holds the `View` struct and the same rotation (`rot_fwd`, `to_plate`, `to_screen`, `perspective_k`). `project.wgsl` now uses it. After that change the 12 M2 goldens are still bit-identical to their engine hashes.
- **Checked against v21's own functions.** `tools/camera-vectors.mjs` (`npm run vectors:camera`) cuts v21's camera functions out of `app23.js` by name and evaluates them unchanged with v21's globals. It writes `tests/vectors/camera.json`: 40 cameras (incl −10 to 200°, mirrored, zoom 0.15 to 12) × points, world positions, normals and homes. **All 5,384 numbers match bit for bit** (`tests/unit/camera.test.ts`). The vectors keep no signed zeros, so ±0 compare equal.
- **Zoom.** `VIEW.scale` = 84 · zoom (L1227), clamped to 0.15–12. The zoom is page state and a view-tier input, as v21's `ZOOM` is. The page also reads `?zoom=`, `?az=`, `?incl=` and `?pa=`.
- **`incE` and its buckets.** `INCE_USES` lists every use of `incE()` in v21 with its line. A test checks the list against `app23.js` (no use missing, each test as written). The buckets are the intervals between the uses' tests. **Exactly 80° is a bucket of its own**, because L1028 tests `< 80` and L788 tests `> 80`. M2's buckets put 80° with 79.9°. A model-tier consumer of L1028 would then have kept a stale answer at exactly 80°. That makes 7 buckets. Within one bucket, every use gives the same answer, and each pair of neighbouring buckets differs in at least one use. Both properties are tested over −360° to 720° in 0.05° steps, plus each threshold and its folds ± 10⁻⁹.

| line | test | switches | milestone |
| ---: | --- | --- | --- |
| 201 | `incE() > 72` | dust-carving pen lines: one midplane lane instead of one per arm | M4 |
| 207 | `incE() > 72` | dust-carving lines laid along the midplane | M4 |
| 788 | `incE() > 80` | the edge-on midplane stroke | M4 |
| 928 | `incE() > 74` | dust clouds: the edge-on scribble count | M4 |
| 950 | `incE() > 74` | hatched lanes on the edge-on midplane | M4 |
| 960 | `incE() <= 74` | the hatched lane just inside a ring | M4 |
| 965 | `incE() > 74` | no hatched arm lanes when edge-on | M4 |
| 1000 | `incE() > 70` | whole-drawing type `smooth:elongated` | M5 |
| 1001 | `incE() > 78` | whole-drawing types `edge-on…` | M5 |
| 1028 | `incE() < 80` | the drawn core | M2 (built) |
| 1029 | `incE() > 70` | the core's dotted style | M2 (built) |
| 1031 | `incE() > 78` | the core flattened to 0.55 | M5 |
| 1000 | `P.bulgeFlat * Math.max(ci(), 0.05) < 0.5` (raw cos i, not `incE`) | whole-drawing type `smooth:elongated` (only for kind auto, bulge ≥ 0.95) | M5 |
| 788 | `P.lines * (P.incl - 72) / 18` (continuous) | the midplane stroke's alpha: a **view-tier input**, not a switch | M4 |

**Inclination and the model tier (review fix, [ADR 0017](../../adr/0017-model-tier-key-is-a-structure-signature.md)).** The `incE` buckets alone were not a sufficient model key:

- L1000 switches on the raw cos i. `Smooth, round` (bulgeFlat 0.95) changes its whole drawing at 58.2°, inside bucket 0, and 30° differs from 150°.
- The model tier's key is now `structureKey(P)`: the answer of every discrete inclination switch (the 12 `incE` tests, and L1000 under its own guard). `dirtyTier` rebuilds the model when it changes.
- Every other use of the inclination (23, among them L788's alpha, the flattenings by `max(bulgeFlat, cos i)` and the dust optical depth) is listed in `INCL_CONTINUOUS` as a view-tier input.
- `tests/unit/camera.test.ts` scans `app23.js`, and every `P.incl`, `ci()` and `incE()` must be in one of the two lists.

This clarifies ADR 0010's "the `incE` bucket" without changing its tiers.

- **The view tier (ADR 0010), driven by the schema.** `render/tiers.ts` decides what each frame rebuilds:
  - `dirtyTier` reads the tier tags of the changed parameters;
  - a model parameter, or an inclination that changes the structure signature (`structureKey`, ADR 0017), rebuilds the model tier and everything after it;
  - the camera, `mTime` or the zoom re-runs only the view tier;
  - a stage that throws invalidates the state, so the next frame rebuilds everything.

  `GpuStipple.frame` and its CPU twin `CpuStippleTiers` both go through this rule, and the page uses them.
- **Input** (`ui/orbit.ts`), as v21's L1833–1876. The maths is in pure functions:
  - drag: `az += 0.45·dx`, `incl = clamp(incl + 0.45·dy, 0, 180)`;
  - shift-drag or right-drag: roll by the pointer's angle about the plate's centre;
  - two fingers: pinch zoom and twist roll;
  - wheel: k = 0.0015, or 0.012 with ctrl;
  - Safari's `gesturestart`/`gesturechange`/`gestureend`;
  - double-click resets the zoom;
  - keys: arrows (az ±5, incl ∓4), Q/E (roll ∓5), `+`/`=` and `−`/`_` (×/÷ 1.15), `0`;
  - `touch-action: none`, the grab cursor, `tabIndex` 0, and no context menu.

  `tests/unit/orbit.test.ts` runs v21's own `orbit()` block, cut from `app23.js`, on a stand-in canvas and sends it and ours the same event sequences. After every event, az, incl, pa, zoom, the cursor and `preventDefault` are identical.
- **Frames.** Every frame request goes through M1's frame queue via `schedule()`: camera moves, resizes, surface toggles, preset and seed changes, and engine switches. It coalesces: with a frame already waiting it returns, and the waiting frame draws the latest state when it starts, so at most one frame ever waits. Camera moves and resizes also wait for the next animation frame (`requestFrame`). The orbit check interleaves 9 surface toggles and a seed change with a drag and still sees at most one waiting. Changing the preset resets the angles, a new seed keeps them, and the zoom persists, as in v21.
- **URL camera** (`ui/url.ts`): `?az`, `?incl`, `?pa` and `?zoom`. An empty or non-numeric value is absent, so `?incl=` keeps the preset's inclination. Values are brought into range as the controls do, so `?zoom=0` becomes 0.15. Unit-tested.
- **Accessibility:** the plate has an accessible name with the key hints and keeps the focus across an engine switch. `orbit.ts` documents the v21 quirks kept on purpose: there is no `lostpointercapture` handler; Ctrl with + or − is swallowed by the plate; the wheel ignores `deltaMode`.

## Acceptance

### Goldens: both cameras plus zoom, M2 set

The six zoom captures were made with `npm run capture:reference -- --extra tests/golden/extra-cases.json --cameras zoom`. Each shows the home view at zoom 2, set through v21's `__GEN.zoom(2)`, which makes `VIEW.scale` 168, and is recorded as `"zoom": 2`. Only the cases that list seeds under `zoom` in `extra-cases.json` get a zoom capture: the three M2 stipple presets at seeds 7 and 4242. `--verify` reproduces all 34 extra captures bit for bit. At zoom 2, v21's counts are the same as at home.

The table shows the results after merging M2's round-1 fixes: the metric of ADR 0015 and v21's variation replayed. All numbers are WebGPU; the CPU engine gives the same to the last digit, except a p90 width of 0.0% for `Disc, no arms` s4242 and a coarse SSIM of 0.946 for `Smooth, round` s7. Fine SSIM (b) is not gated any more. The moment and extent gate compares r25, r50 and r90 (relative), the outer ink and q (axis ratio, whole and inner, as differences) and the position angle. The position angle is gated only where q < 0.8.

| case (zoom 2) | ink | (b′) coarse | median | p90 | r25 | r50 | r90 | outer | Δq | Δq inner | Δpa | dots (ours/v21) | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smooth-round s7 | +1.1% | 0.945 | +0.2% | +2.3% | −1.1% | −0.3% | +1.5% | +0.004 | −0.013 | −0.006 | (q 0.99: not gated) | 9,500/9,500 | pass |
| smooth-round s4242 | −0.3% | 0.943 | −0.4% | −2.7% | +0.0% | +2.1% | +1.3% | +0.004 | +0.014 | −0.010 | (q 0.98: not gated) | 9,500/9,500 | pass |
| cigar-shaped s7 | +1.0% | 0.952 | +0.3% | −1.8% | +0.9% | +0.5% | −1.5% | −0.003 | +0.020 | +0.013 | +0.1° | 9,500/9,500 | pass |
| cigar-shaped s4242 | −0.3% | 0.953 | +0.1% | −0.1% | −0.8% | −0.8% | −1.1% | −0.003 | −0.001 | −0.002 | −1.6° | 9,500/9,500 | pass |
| disc-no-arms s7 | −0.5% | 0.898 | −0.5% | +0.8% | −2.2% | −2.0% | −1.0% | −0.006 | −0.014 | +0.013 | +0.0° | 9,459/9,442 | pass |
| disc-no-arms s4242 | −0.0% | 0.909 | +1.2% | +0.1% | −1.3% | −1.3% | −1.4% | −0.008 | −0.015 | −0.026 | −1.7° | 9,472/9,469 | pass |

The thresholds are from `tests/golden/thresholds.json`, as M2 calibrated them:

- smooth: r25 ±3.7%, r50 ±5.6%, r90 ±9.0%, outer ±0.019, q ±0.057, q inner ±0.039, pa ±4.5°, coarse ≥ 0.91;
- spiral, which includes `Disc, no arms`: r25 ±4.1%, r50 ±4.6%, r90 ±5.1%, outer ±0.016, q ±0.037, q inner ±0.044, pa ±3.8°, coarse ≥ 0.88.

The tightest margins at zoom are both `Disc, no arms`: q inner for s4242 (−0.026 against ±0.044) and r50 for s7 (−2.0% against ±4.6%).

- **`npm run golden`: 34/34 required cases pass**, on WebGPU and on the CPU engine: M2's 28 home and orbit cases and the 6 zoom cases. The 12/12 drawn-star gates also pass.
- **CPU against WebGPU (L1, strict):** every case passes. At zoom, ink, widths and moments agree to within 0.0%, coarse SSIM is 1.000, and the counts are identical.
- **L0:** two WebGPU renders are identical on every case.
- **(e) against `engine-hashes.json`:** M2's 28 hashes are identical under the merged engine. Six zoom hashes were added. The `Disc, no arms` zoom hashes changed from M3's first run because M2 now draws with v21's replayed variation.

### Orbiting changes no model buffer (hashes)

The same check runs on the GPU (`tests/gpu/tiers.ts`, in `npm run test:gpu`) and on the CPU (`tests/unit/tiers.test.ts`). It covers 5 scenes on the GPU: the 3 stipple-only cases, `Grand design`, and `Edge-on with dust` (incl 88°, with the dust cull). The CPU covers 4. For each scene, after one build, the camera makes 7–10 moves inside its bucket: az + 35°, pa + 47°, the winding mirrored, zoom 2, 12 and 0.15, `mTime`, incl ± a few degrees, and incl → 180° − incl. After every move:

- the tier rule ran the view tier only;
- the sample buffer is the same buffer, and its SHA-256 (read back) is unchanged;
- the projected instances changed (except for `mTime`, which M3 does not use);
- without dust, the per-class counts are unchanged.

Crossing a bucket (to 75°, or to 30° from 88°) rebuilds the model once, and the next camera move does not. **All pass, on both engines.** A third test checks that the tier tags are true: no view-tagged parameter changes the scene description's packed buffers (galaxy uniform, shape, pools, dot sizes).

### The orbit on the page (Playwright)

The orbit check in `npm run test:gpu` (`tools/gpu-test/orbit.mjs`) drives the page with the mouse, on WebGPU and on the CPU engine. It uses `Smooth, round`, stipple-only, seed 7:

- **Drag, 24 moves:** az 0 → 97.2000° and incl 10 → 32.5000°. That is exactly v21's formulas, replayed over the same pointer positions, to within 10⁻⁹.
  - The plate's pixels changed, and the counts did not (9,500 dots).
  - The model tier ran 0 times, and at most 1 frame waited in the queue.
  - WebGPU drew the 24 moves in 3 frames (coalesced). The CPU engine, which keeps up, drew 24.
- **Right-drag:** pa 20 → 50.9638°, which is v21's angle about the plate's centre. az and incl are unchanged.
- **Zoom:** wheel −200, then `+`, gives zoom 1.5523, which is v21's exp(0.3) · 1.15. Double-click returns the zoom to 1. The model tier still ran only once in all.

### Orbit frame cost (indicative only: SwiftShader)

This is wall time to queue completion, as the median of 15 runs (`tests/gpu/tiers.ts`):

| scene | orbit frame | of which compute (view tier) | parameter change | of which compute (scene + model + view) | ink pass |
| --- | ---: | ---: | ---: | ---: | ---: |
| Smooth, round (stipple) s7 | 305 ms | 14 ms | 325 ms | 21 ms | 302 ms |
| Cigar-shaped (stipple) s4242 | 314 ms | 18 ms | 317 ms | 22 ms | 295 ms |
| Disc, no arms (stipple) s7 | 319 ms | 18 ms | 323 ms | 21 ms | 303 ms |
| Grand design s7 | 314 ms | 17 ms | 331 ms | 34 ms | 292 ms |
| Edge-on with dust s7 | 187 ms | 16 ms | 215 ms | 34 ms | 177 ms |

On SwiftShader the sprite ink pass dominates: it rasterises about 10,000 quads at 800² on the CPU. The view tier's compute is 14–18 ms against 21–34 ms for a parameter change. Most of that is fixed dispatch and synchronisation cost in SwiftShader, so these numbers do not predict real hardware. The roadmap's 60 fps orbit on real hardware is a manual check that has not been made here. Recording the numbers is for M10.

## Not done, or left for later

- **60 fps on real hardware** (manual acceptance item): not measured. Every check here ran on SwiftShader.
- **The `incE` uses** are listed and bucketed, but only the two core uses (L1028, L1029) have consumers. The rest arrive with M4 and M5, and the bucket rebuild is ready for them. As in v21, a threshold has no hysteresis. Orbiting back and forth across 72–80° rebuilds the model at each crossing, which shows as a change of structure, not a re-roll (the roadmap's "flicker" risk). No consumer exists yet to judge whether hysteresis would be wanted.
- **`toView`, `orient`, `scenePoint`, `srcNow` and `perspective`** are built and checked against v21 but unused until the sky (M7) and the lens (M9). The home orientation as a saved parameter (divergence 2) comes with them.
- **The counts line under the plate** still awaits a read-back of the indirect arguments after each frame (as in M2). It does not block the GPU and is only for the statistics line. Moving it fully off the frame path, or reading it only when the counts can change, is left to M10.
- **Zoom-dependent inputs still to come, all view-tier.** Zoom never rebuilds the model, so when these land they must be computed in the view tier, not baked into model buffers:
  - the drawn stars' size factor `ZL = (VIEW.scale / 84)^0.45` (L183);
  - the lane radius `LR` (L194);
  - the dust clouds' and hatching's `zf` (L936, L947);
  - the breathing-room grid round bright stars, which is in screen pixels.

  v21 computes all of them inside `generate`, `dustClouds` and `dustLanes`, which re-run on every zoom. Here they must be view-tier culls and expansions over the stored model.
- **`setLayers` on every view frame** re-creates the sprite batches' small uniform buffers (6 layers). It is cheap, but it could be kept across view frames in M10.

## Checks

- `npm run lint`, `typecheck` and `build`: pass.
- `npm run test`: 128 tests, all passing after the M2 merge. M3 added 24 of them: camera 7, orbit 10, tiers 7.
- `npm run validate:wgsl`: 18 files valid.
- `npm run test:gpu`: 6/6 pass (one mark, RNG vectors, stipple kernels, tiers, surface, orbit).
- `npm run golden`: 220/220 captures intact; 34/34 required cases and 12/12 drawn-star gates pass.
