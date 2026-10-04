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

- **The view tier (ADR 0010), driven by the schema.** `render/tiers.ts` decides what each frame rebuilds:
  - `dirtyTier` reads the tier tags of the changed parameters;
  - a model parameter, or an inclination that crosses a bucket, rebuilds the model tier and everything after it;
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
- **Frames.** Camera moves and resizes go through M1's frame queue via `requestFrame`, which requests one animation frame. While a frame is requested or waiting, further moves only update the wanted camera, so at most one frame ever waits. Changing the preset resets the angles, a new seed keeps them, and the zoom persists, as in v21.

## Acceptance

### Goldens: both cameras plus zoom, M2 set

The six zoom captures come from `npm run capture:reference -- --extra tests/golden/extra-cases.json --cameras zoom`. They show the home view at zoom 2 through v21's `__GEN.zoom(2)`, which gives `VIEW.scale` = 168, and are recorded as `"zoom": 2`. `--verify` reproduces all 18 extra captures bit for bit. v21's counts at zoom 2 equal those at home, because zoom changes nothing in v21's stipple stream for these presets.

| case (zoom 2) | ink | SSIM | coarse SSIM | median width | p90 width | dots (ours/v21) | sparkle stars | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smooth-round s7 | +1.1% | 0.530 | 0.945 (CPU 0.946) | +0.2% | +2.3% | 9,500/9,500 | 0/0 | pass |
| smooth-round s4242 | −0.3% | 0.536 | 0.943 | −0.4% | −2.7% | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s7 | +1.0% | 0.587 | 0.952 | +0.3% | −1.8% | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s4242 | −0.3% | 0.592 | 0.953 | +0.1% | −0.1% | 9,500/9,500 | 0/0 | pass |
| disc-no-arms s7 | −1.3% | 0.327 | 0.885 | −1.1% | −0.2% | 9,355/9,442 (−0.9%) | 0/1 | pass |
| disc-no-arms s4242 | +0.9% | 0.330 | 0.904 | +0.9% (CPU +1.0%) | +0.3% | 9,500/9,469 (+0.3%) | 0/3 | pass |

- **`npm run golden`: 18/18 required cases pass**: the 12 home and orbit cases of M2, unchanged, and the 6 zoom cases. They pass on WebGPU and on the CPU engine, at the family thresholds calibrated in M2 (smooth: SSIM ≥ 0.36, coarse ≥ 0.89; spiral, which includes `Disc, no arms`: ≥ 0.29, ≥ 0.87).
- **CPU against WebGPU (L1, strict):** pass on all 18. At zoom the ink differs by at most 0.0%, SSIM and coarse SSIM are 1.000, and widths are within 0.1%, with identical counts.
- **L0:** two WebGPU renders are identical on every case.
- **(e) against `engine-hashes.json`:** the 12 M2 cases are identical, after the camera refactor in WGSL. The 6 zoom hashes were added.
- The tightest margin is `Disc, no arms` s7 at zoom 2, with coarse SSIM 0.885 against 0.87. At zoom 2 the plate shows the inner 2.4 units only, so the coarse map holds fewer independent structures.

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
- **`setLayers` on every view frame** re-creates the sprite batches' small uniform buffers (6 layers). It is cheap, but it could be kept across view frames in M10.

## Checks

- `npm run lint`, `typecheck` and `build`: pass.
- `npm run test`: 117 tests. New this milestone: camera 7, orbit 10, tiers 7.
- `npm run validate:wgsl`: 18 files valid.
- `npm run test:gpu`: 6/6 pass (one mark, RNG vectors, stipple kernels, tiers, surface, orbit).
- `npm run golden`: 204/204 captures intact; 18/18 required cases pass.
