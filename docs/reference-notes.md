# Rosse v21: reference notes

How the current engine works, stage by stage, as a specification for the WebGPU/WGSL reimplementation.
The source of truth is `assets/reference/rosse-source/app23.js` (1880 lines). The same script is inlined,
byte for byte, near the end of `assets/reference/pages/rosse-v21.html`, after `window.__ATLASES`,
`window.__REAL` and `window.__CAT`. Every reference below is written `app23.js:L123`. `head23.html`
references are to `assets/reference/rosse-source/head23.html`.

Sizes and costs come from `docs/data/reference-profile.json`, produced by
`tools/profile-reference/profile.mjs` (see its README). It covers all 45 presets at seed 7, on an 800 × 800
canvas at device pixel ratio 1, in headless Chromium 141 with **SwiftShader** (software WebGL). CPU stage
times are useful relative to one another but vary by 20–50 % between runs. Wall times are dominated by
software rasterisation and say little about a real GPU. Every timing below carries this caveat.

## Contents

1. [The pipeline at a glance](#1-the-pipeline-at-a-glance)
2. [Parameters](#2-parameters)
3. [Random numbers](#3-random-numbers)
4. [Per-galaxy variation](#4-per-galaxy-variation)
5. [The camera](#5-the-camera)
6. [The 3D model: `generate`](#6-the-3d-model-generate)
7. [Curves and stroke ribbons](#7-curves-and-stroke-ribbons)
8. [Vector marks: `parts`, `expandVector`, `WARPS`](#8-vector-marks-parts-expandvector-warps)
9. [Dust](#9-dust)
10. [The sky](#10-the-sky)
11. [Mergers](#11-mergers)
12. [Shells](#12-shells)
13. [Lensing](#13-lensing)
14. [Stars and artefacts](#14-stars-and-artefacts)
15. [The instance format and `USED`](#15-the-instance-format-and-used)
16. [The WebGL renderer](#16-the-webgl-renderer)
17. [`render()`, frame by frame](#17-render-frame-by-frame)
18. [Sizes and costs across presets](#18-sizes-and-costs-across-presets)
19. [Global state and order dependence](#19-global-state-and-order-dependence)
20. [Things that look like bugs or surprises (flagged, not fixed)](#20-things-that-look-like-bugs-or-surprises-flagged-not-fixed)

---

## 1. The pipeline at a glance

Each call to `render()` (`app23.js:L1220`) rebuilds the whole drawing from the parameters `P` on the
CPU, then draws it with WebGL2 as instanced textured quads plus triangle ribbons. Nothing persists
between frames except a few single-entry caches (merger and shell simulations, the sky catalogue, the
dust lanes) and the "home" camera orientations of lensed sources and overlays.

```
P ──► makeVariation (VAR) ──┬─ subject star/artefact ─► starSprites ─────────────────────────┐
                            ├─ merger ─► simulateMerger (cached) ─► mergerSprites (debris)   │
                            │            └─ per galaxy: generate · curves · buildCurves ·    │
                            │               parts, all carried by the tidal warp (SM)        │
                            └─ galaxy ─► generate ─► curves ─► [lensSprites10] [shellSprites]│
                                         ─► buildCurves ─► parts (incl. skyParts, dustLanes) │
     overlaySprites (bright star, artefact) ◄────────────────────────────────────────────────┘
     ─► expandVector (every vector drawing → solid ribbons + dot and blob sprites)
     ─► scene(): ~30 draw calls, 1 or 4 passes (plates) ─► STATS
```

Three kinds of geometry reach the GPU:

| kind | built by | drawn by | per frame (median / max over presets) |
| --- | --- | --- | --- |
| bitmap sprites (`dots`, `knots`, `stars`, `cores`, `pieces`, `fgstars`) | `inst()` in every stage | `drawSprites`, instanced quads | 9,176 / 20,433 instances |
| textured stroke ribbons (`strokes` sheet) | `buildCurves` | `drawRibbons(V)` | 804 / 27,648 vertices |
| solid ribbons (vector line-work) | `expandVector` | `drawRibbons(…, 'solid')` | 336,102 / 1,976,634 vertices |

The solid ribbons are the surprise: most of them are the **drawn stars** (`starMix`, default 0.6), each a
vector `sstars` record of about 36 segments, which is 215 vertices, expanded on the CPU. Grand design has
1,570 of them and 357,282 solid vertices (section 18).

---

## 2. Parameters

### 2.1 `DEF` (`app23.js:L11–19`)

Every parameter, with its default. `P` starts as a copy (`app23.js:L68`). A preset is
`Object.assign({}, DEF, PRESETS[name], { seed: P.seed })` (`app23.js:L1549`, `app23.js:L1879`), so presets
are sparse overrides and the seed is kept.

| group | parameters (default) |
| --- | --- |
| identity, density, pen | `seed` 7, `stars` 9500, `stipple` 1, `starMix` 0.6 (drawn stars among the dots), `vary` 0.6 (per-galaxy variation), `pen` 2.4 (line weight) |
| shape | `bulge` 0.2, `bulgeSize` 0.5, `bulgeFlat` 0.8, `thick` 0.08, `halo` 0.15, `sersicN` 0 (>0 with `bulge` ≥ 0.95 gives a Sérsic elliptical), `re` 0.9, `patchy` 0, `irr` 0 |
| arms | `arms` 2, `pitch` 18°, `armStrength` 0.8, `armWidth` 0.35, `flocc` 0, `winding` 1 (±1, mirror), `armStyle` `'ribbons'` (`'drawn'`, `'none'`) |
| bar and ring | `bar` 0, `barLen` 0.45, `ring` 0, `ringR` 1.6, `barStyle` `'drawn'`, `ringStyle` `'drawn'`, `ringOnlyLines` 0 |
| knots and sparkle | `knots` 0.35, `sparkle` 0.35 |
| dust | `dust` 0 (extinction), `dustScribble` 0.5 (hatched lanes), `dustLines` 0 (dust carved by pen lines), `bubbles` 0.4 |
| view | `incl` 30°, `pa` 20° (roll), `az` 0° (orbit round the axis); zoom is the global `ZOOM`, not a parameter |
| line-work | `lines` 0.7, `stroke` `'mixed'`, `outline` 0, `whole` 0, `envelope` 0, `nuclear` 0, `kind` `'auto'`, `rewind` 1, `distort` 0, `unwrap` 0 (forced to 0) |
| field and oddities | `field` 0.3 (deep field), `fgstars` 0.3, `companions` 0, `lens` 0 (drawn arcs), `shells` 0 (drawn shells), `tail` 0, `trails` 0, `arrow` 0, `streams` 0, `jet` 0 |
| plates | `plates` `'ink'` (`'slip'`, `'colour'`) |
| star or artefact | `subject` `'galaxy'` (`'star'`, `'artefact'`), `artefact` `'trail'` (`'ghost'`, `'cosmic'`), `starBright` 0.7, `spikes` 0.7, `starRings` 0.4, `bleed` 0.3 |
| overlays | `ovStar` 0, `ovStarD` 1.9, `ovStarA` 40°, `ovArtefact` `'none'` |
| merger | `merger` 0, `mRatio` 0.6, `mPeri` 1.4, `mStage` 1.2, `mSpin1` 25°, `mSpin2` 40°, `mFriction` 0, `mStars` 11000, `mBulge` 0.2, `mType1`/`mType2` `'spiral'`, `mArms1`/`mArms2` 2, `mSize1`/`mSize2` 1, `mBar1`/`mBar2` 0, `mTilt` 0°, `mEcc` 1, `mHorizon` 2, `mTime` 1, `mWarp` 1 |
| lens | `lensOn` 0, `lensR` 1.3 (Einstein radius), `lensSrc` 0.12, `lensSrcA` 30°, `lensShear` 0.06, `lensShearA` 20°, `lensSize` 0.28, `lensStars` 6000, `lensQ` 0.8, `lensAngle` 0, `lensCore` 0.05, `lensCluster` 0, `lensDouble` 0, `lensSource` `'galaxy'` (`'quasar'`, `'drawing'`) |
| shells | `shellsOn` 0, `shellTime` 70, `shellAxis` 30°, `shellStars` 6000 |

Parameters read but not in `DEF`: `P.mFit` (`app23.js:L515`, defaults to 0.74 there), the internal
overlay flag `P._ov` (`app23.js:L457`) and the `__was_<key>` stash of the recipe cards
(`app23.js:L1513`). Units: lengths are "galaxy units", where the disc scale length `H` is 1
(`app23.js:L121`) and one unit is `VIEW.scale` = 84 × `ZOOM` pixels (`app23.js:L1227`).

### 2.2 The presets (`app23.js:L20–66`)

Forty-five presets in seven families. The UI groups them by name prefix (`app23.js:L1544`).

| family | presets | what they exercise |
| --- | --- | --- |
| single galaxies (11) | Grand design (`{}`, pure `DEF`), Barred spiral, Flocculent, Hand-drawn arms, Tightly wound, Loose, open arms, Ringed, Disc, no arms, Smooth, round, Cigar-shaped, Edge-on with dust | `generate`, `curves`, `parts`; `armStyle: 'drawn'`; `stroke` kinds; envelopes; extinction `dust` at `incl` 88 |
| mergers (9) | Merger: the Mice, long tails, minor, a stream, spiral meets elliptical, dry (two ellipticals), polar collision, three-armed pair, coalescing; Sketches, torn apart | `simulateMerger`, `mergerSprites`, the tidal warp; `mType*`, `mFriction`, `mTilt`, `mEcc`, `mBar1`; `mWarp` (on by default, so every merger tears whole drawings) |
| layered (5) | spiral beside a bright star, barred spiral with satellite trail, edge-on with star on top, lensed merger, ringed galaxy with ghost reflection | `overlaySprites` (`ovStar`, `ovArtefact`); a merger that lenses |
| star (2) | Star: bright, with spikes; Star: faint | `starSprites` as subject |
| artefact (3) | satellite trail, ghost reflection, cosmic rays | `starSprites` artefact branch |
| lens (7) | Lens: Einstein ring, Einstein cross (quasar), galaxy cluster, double Einstein ring, giant arc, a quad; A sketch, lensed (`lensSource: 'drawing'`) | `lensSprites10` and all its branches; the hosts are Sérsic ellipticals (`bulge` 1, `sersicN` 4–5, `incl` 88) |
| creative (8) | Deep field, Radio jet, Stellar streams, Dusty spiral, Hand wobble, Shell galaxy, Plates slipped, Stellar populations | `field` 1; `jet`; `streams`; `dustLines`, `bubbles`; `distort`; `shellsOn`; plates `'slip'` and `'colour'` |

Real galaxies do not come from presets: `fromVotes` (`app23.js:L1321`) maps Galaxy Zoo 2 vote fractions,
axis ratio, position angle and extras (concentration, g−r colour, r90, fdev) to a full `P`, using its
own stream `mulberry32(seed * 101 + 9)` (`app23.js:L1322`). It can switch on any family: star or
artefact subjects, Sérsic ellipticals, edge-ons, mergers with random types, lenses, shells, streams,
jets, rings and overlays. "Surprise me" (`app23.js:L1743`) builds `P` from a random preset with
`Math.random`.

---

## 3. Random numbers

### 3.1 Primitives (`app23.js:L71–86`)

- `mulberry32(a)` (`app23.js:L71`): a 32-bit state, one `uint32 / 2^32` per call. Every stage makes its
  own generator from an integer seed; within a stage it is one **sequential stream**.
- `gauss(r)` (`app23.js:L72`): Box–Muller, two draws, one normal (the second is discarded).
- `hash2(x, y)` (`app23.js:L73`): `fract(sin(127.1x + 311.7y) × 43758.5453)`. Not a stream: a hash of
  coordinates.
- `vnoise(x, y)` (`app23.js:L74`): value noise on the integer lattice, smoothstep interpolation of
  `hash2` corners. Used for patchiness everywhere (ring clumps, flocculence, dust lanes, `patchy`,
  `irr`, glare rings, trail flicker, ghost gaps, `distort`).
- `gammaS(k, r)` (`app23.js:L76`): Marsaglia–Tsang gamma sampler, a **rejection loop** that draws a
  variable number of values (used for Sérsic radii).
- `pick(r, arr)` (`app23.js:L85`), `unit3(r)` (`app23.js:L858`): one and two draws.
- `Math.random` is used only by the UI: reseed, Surprise me, random catalogue galaxy
  (`app23.js:L1742–1814`).

### 3.2 Every seeded stream

`P.seed` is an integer (1–9999 from the UI). Streams are re-created from scratch on every render, so a
render is a function of `P` and the global state listed in section 19, never of the previous frame's
streams.

| stage | seed expression | line |
| --- | --- | --- |
| `makeVariation` | `P.seed * 7919 + 13` | `app23.js:L97` |
| `generate`, main stream (all components, `rstar`, clumps) | `P.seed * 9973 + 1` | `app23.js:L176` |
| `generate`, pen lines that carve dust (`dustLines`) | `P.seed * 431 + 9` | `app23.js:L201` |
| `generate`, ring knots | `P.seed * 577 + 41` | `app23.js:L283` |
| `simulateMerger` | `P.seed * 3301 + 7` | `app23.js:L307` |
| `mergerGalaxyParams` (per galaxy `g`) | `P.seed * 97 + g * 131`; the galaxy's own seed is `P.seed * 7 + g * 101 + 1` | `app23.js:L382–383` |
| `starSprites` | `P.seed * 911 + 17` (with `P.seed` swapped to `seed * 7 + 3` for the overlay star, `seed * 11 + 5` for the overlay artefact) | `app23.js:L400`, `app23.js:L459`, `app23.js:L463` |
| `overlaySprites`, artefact placement | `keep.seed * 977 + 3` | `app23.js:L460` |
| `mergerSprites` | `P.seed * 17 + 3` | `app23.js:L493` |
| `lensSprites` (dead code) | `P.seed * 613 + 5` | `app23.js:L557` |
| `lensModel` (cluster members) | `P.seed * 431 + 9` | `app23.js:L595` |
| `buildSourceGalaxy`: `curves`, `parts` arguments | `P.seed * 31 + 5` (ignored, see `curves`), `P.seed * 57 + 3` with the source's seed | `app23.js:L635` |
| `lensMarks` | `P.seed * 733 + Math.round(bc[0] * 997)` (depends on the source position, so on the camera) | `app23.js:L647` |
| `lensSprites10` | `P.seed * 613 + 5` | `app23.js:L679` |
| lensed source galaxies | single and quasar host `P.seed * 17 + 5`; cluster `P.seed * 29 + i * 7 + 3`; double ring `P.seed * 41 + 9` | `app23.js:L687`, `app23.js:L694`, `app23.js:L701`, `app23.js:L704` |
| `shellSprites`, simulation | `P.seed * 977 + 3` | `app23.js:L714` |
| `shellSprites`, dots | `P.seed * 31 + 1` | `app23.js:L741` |
| `shellArcs` | `P.seed * 5 + 17` | `app23.js:L752` |
| `curves` | `VAR.strokeSeed` (from `makeVariation`); the argument `r` is overwritten | `app23.js:L771` |
| `buildSky` | `P.seed * 1013 + 71` | `app23.js:L869` |
| `skyParts`, each background galaxy | `o.seed` = `floor(r() * 1e9)` from `buildSky` | `app23.js:L873`, `app23.js:L890` |
| `skyParts`, companions | `P.seed * 331 + 17` | `app23.js:L913` |
| `dustClouds` (never called) | `P.seed * 733 + 29` | `app23.js:L928` |
| `dustLanes` | `P.seed * 733 + 29` | `app23.js:L949` |
| `parts` | `P.seed * 57 + 3` | `app23.js:L1230`, `app23.js:L1234`, `app23.js:L1251`, `app23.js:L1271` |
| `parts`, hatch drawing picks | `P.seed * 919 + 3` | `app23.js:L1047` |
| `render`, merger debris thinning | `P.seed * 13 + 9` | `app23.js:L1236` |
| `render`, merger (unused) | `P.seed * 5 + 1` | `app23.js:L1258` |
| `render`, `mWarp` drawing picks | `P.seed * 211 + 7` | `app23.js:L1261` |
| `render`, `curves` argument | `P.seed * 31 + 5` (ignored) | `app23.js:L1250`, `app23.js:L1268` |
| `fromVotes` | `seed * 101 + 9` | `app23.js:L1322` |

Not from a stream: the tile of a dot or blob inside a vector drawing is a hash of its coordinates
(`app23.js:L1215`, `app23.js:L1217`), and `strokeIndex` takes whatever stream it is given
(`app23.js:L762`).

Shared seeds: `P.seed * 431 + 9` drives both the dust-carving pen lines and the cluster members;
`P.seed * 733 + 29` both `dustLanes` and the dead `dustClouds`; `seed * 977 + 3` both the overlay
artefact's placement and the shell simulation. Identical seeds produce identical sequences, so these
choices are correlated (section 20).

---

## 4. Per-galaxy variation

`makeVariation()` (`app23.js:L96–119`) is called at the start of every render (`app23.js:L1227`), and
again for every merger galaxy and lensed source galaxy, with `P` swapped. It returns `VAR`:

| field | contents | scaled by |
| --- | --- | --- |
| `arms[k]` (max(1, `arms`) entries) | `pitch` factor 1 + 0.28v·N, `amp` 1 − 0.55v·U, `phase` 0.35v·N, `rmax` 2.1–2.7, wiggle `wig`, `wf`, `wp` | `vary` |
| `spurs` (round(v(2–6)·min(1, arms))) | arm `k`, start radius `R0` 0.8–2.4, `len` 0.5–1.4, pitch factor `pk` 1.7–2.5 | `vary` |
| `clumps` (round(v(4–14)(1 + 2·patchy))) | radius 0.7–2.9, `t`, size `s` 0.05–0.13, count `n` 20–79 | `vary`, `patchy` |
| `dust` (round(5v·U)) | holes: `R`, `th`, `s` | `vary` |
| `lop`, `lopA` | lopsidedness offset, `v(0.22 + 0.7·patchy)(0.5–1)` | `vary`, `patchy` |
| `warp`, `warpA` | outer-disc warp amplitude ≤ 0.35v | `vary` |
| `dotPool` | the dot tiles of 1–3 pens (source drawings whose median dot size ≥ 7 px and with ≥ 8 dots; all 500 tiles when `vary` < 0.15 or fewer than 12 qualify) | |
| `knotPool` | 24 knot tiles drawn with replacement from all 160 | |
| `spike` | a common rotation for star spikes, ±0.25 rad | |
| `strokeSeed` | the seed of the `curves` stream | |

It is a single sequential stream: changing `arms` changes how many `arms[k]` and spurs are drawn, which
shifts every later field (pools, `lop`, `warp`, `strokeSeed`). Cost: 0.2–1.5 ms per render, mostly the
`bySrc` grouping of the 500 dots (`app23.js:L107–109`), which is the same every time.

`armPhase(R, k)` (`app23.js:L127`): a logarithmic spiral from `r0` = `barLen` (if barred) or 0.25,
`ln(max(R, r0)/r0) / tan(pitch × VAR.arms[k].pitch)`, plus the arm's phase and wiggle.
`armProfile(R, θ)` (`app23.js:L132–144`) is the arm density: a Gaussian in the angular offset to the
nearest arm (width `armWidth` of half the inter-arm angle) times `amp`, faded beyond `rmax`, the maximum
of that and the spurs, scaled by flocculent `vnoise`, and ramped to zero inside the bar or 0.3.

---

## 5. The camera

### 5.1 Projections

| function | maps | notes |
| --- | --- | --- |
| `project(p)` (`app23.js:L153`) | galaxy frame (x, y, z) → screen px | `x` mirrored by `winding`; rotate by `az` about z; tilt by `incl` about x (`y' = y cos i − z sin i`); roll by `pa`; × `VIEW.scale`, + (`VIEW.cx`, `VIEW.cy`) = (400, 400). **Orthographic.** |
| `discM()` (`app23.js:L126`) | the same as a 2 × 2 for the disc plane | `R(pa)·S(1, cos i)·R(az)·S(winding, 1)`, column-major like GLSL `mat2` (`app23.js:L89–92`). Used to lay drawings on the disc. |
| `rotFwd(p, o)` / `rotInv(v, o)` (`app23.js:L440–441`) | galaxy ↔ view frame with depth, for an orientation `o = {incl, az, w, pa}` | `rotFwd` is `project` before the roll, keeping z' = `ya sin i + z cos i` (towards the viewer). |
| `toView(w)` (`app23.js:L859`) | world → view (x, y, depth) | the same rotation without the mirror; used by the sky |
| `toScreen(v, k)` (`app23.js:L860`) | view → px with perspective factor `k` | |
| `orient(n, size, spin, flat)` (`app23.js:L863`) | a 2 × 2 that lays a drawing on a plane with normal `n` | foreshortened by \|n_z\| (at least `flat`, default 0.12), mirrored when the plane faces away |

`incE()` (`app23.js:L856`) folds `incl` (0–180 from the orbit drag) into 0–90. Its thresholds switch
behaviour discretely:

- above 70 and 78: which whole drawing type (`app23.js:L1000–1001`); dotted cores above 70
  (`app23.js:L1029`);
- above 72: the dust-carving lines run along the midplane (`app23.js:L201`, `app23.js:L207`);
- above 74: the hatched lanes switch to the edge-on midplane (`app23.js:L950`, `app23.js:L960`,
  `app23.js:L965`);
- above 80: the edge-on midplane stroke (`app23.js:L788`); from 80 up, no core drawing
  (`app23.js:L1028`).

### 5.2 Zoom and view

`VIEW = { W: 800, cx: 400, cy: 400, scale: 84 }` (`app23.js:L122`). All geometry is in an 800-unit
space; the shaders divide by `uRes` = 800 whatever the canvas's pixel size. `VIEW.scale` = 84 × `ZOOM`
(`app23.js:L1227`), `ZOOM` in [0.15, 12] (wheel, pinch, keys, double-click; `app23.js:L1853`,
`app23.js:L1861`, `app23.js:L1865–1868`). There is no pan. Zoom is not a parameter, but it changes
`VIEW.scale`, which is part of some cache keys and of screen-space radii (lane thinning, star sizes
through `ZL = (scale/84)^0.45`, `app23.js:L183`).

### 5.3 Orbit controls (`app23.js:L1833–1876`)

Drag: `az += 0.45·dx`, `incl = clamp(incl + 0.45·dy, 0, 180)` (`app23.js:L1849`). Shift- or
right-drag and two-finger twist: roll (`pa`). Pinch, ctrl-wheel, wheel and keys: `ZOOM`. Arrows ±5° in
`az`, ±4° in `incl`; Q/E roll ±5°. Every change calls `req()`, a full `render()` on the next animation
frame (`app23.js:L1316`). **Orbiting costs a complete rebuild**: in the profile a 5° orbit costs the
same as a fresh render (orbit wall time median 583 ms vs warm 616 ms, SwiftShader), and changes the
mark counts of every preset with view-dependent culling (section 6.4).

### 5.4 The perspective camera of the extras (`app23.js:L853–857`)

The galaxy itself is orthographic. The sky (background galaxies, foreground stars, companions) is seen
by a perspective camera at distance `CAM` = 30 galaxy units on the view axis: `k = CAM / (CAM − depth)`
(`app23.js:L884`). Background galaxies fill a shell from `RMIN` 40 to 240 units, foreground stars sit
at `R_FG` 42. Because the sky uses the same `incl`/`az`, orbiting gives parallax.

### 5.5 Things fixed in the scene: `homeFor`, `scenePoint`, `srcNow` (`app23.js:L444–452`)

Overlays and lensed sources are specified in screen terms ("1.9 units at 40°", "this offset behind the
lens") but should then stay fixed in 3D while the camera moves. `homeFor(H, key)` (`app23.js:L445`)
records `orientNow()` the first time it sees `key` and returns that orientation ever after.
`scenePoint` (`app23.js:L446`) undoes the home roll, lifts the offset to depth `depth` in the home view
frame, rotates it into the galaxy frame with `rotInv(home)`, and projects it with the current camera.
`srcNow(bx, by, D)` (`app23.js:L450`) does the same for a lensed source a distance `D` behind the lens,
returning lens-plane offsets. The keys: `OVHOME` uses
`[seed, ovStar on, ovStarD, ovStarA, ovArtefact]` (`app23.js:L458`); `LHOME` uses
`[seed, lensSrc, lensSrcA, lensR, lensQ, lensCluster, lensDouble, lensSource, lensSize, merger]`
(`app23.js:L451`). The home therefore depends on **when** the key was first seen, not on `P`
(section 20, item 2).

---

## 6. The 3D model: `generate`

`generate()` (`app23.js:L175–299`) samples the galaxy into marks, in screen space. It is called once per
render for a single galaxy, once per merger galaxy (two) and once per lensed source galaxy (one to
ten), each time with `P`, `VAR`, `VIEW.scale` and `SM` swapped.

**Inputs:** `P`, `VAR`, `VIEW`, `PEN`, `SM`, `AT.sstars`, the `dustLanes()` cache.
**Outputs:** `{ old, disc, young, knots, stars, rstars }`, lists of instance rows (section 15).
`old` is bulge and halo stipple, `young` is stipple on arms (`arm` > 0.55), clumps and ring knots,
`disc` is the rest; `rstars` are drawn stars from the vector `sstars` sheet.

### 6.1 Sampling

`N = round(stars × stipple × (1 + 0.28·starMix))` proposals (`app23.js:L176`): 11,096 for `DEF`. Each
proposal picks a component by weight (`app23.js:L178`): bulge `bulge`, halo `0.25·halo`, bar
`0.4·bar·(1 − bulge)`, ring `0.34·ring·(1 − bulge)`, disc the rest (at least 0).

| component | sampling | line |
| --- | --- | --- |
| Sérsic (when `sersicN` > 0 and `bulge` ≥ 0.95) | exact Sérsic radius `re·(Γ(2n)/b)^n`, b = 2n − 1/3 (`gammaS`, a rejection loop); **2D**: x, y·`bulgeFlat`, rotated by `pa` only, so `incl` and `az` do nothing; two strip rejections fake a dust lane when `dust` > 0.25; 9 %·`starMix` become drawn stars | `app23.js:L223–233` |
| bulge | Hernquist-like radius `a·√u/(1 − √u)`, a = 0.22·`bulgeSize`, u ≤ 0.985; isotropic direction; z × `bulgeFlat` | `app23.js:L235–237` |
| halo | exponential radius, scale 1.4; isotropic; z × 0.7 | `app23.js:L238–240` |
| bar | x = sign·\|U\|^0.8·`barLen`, y and z Gaussian | `app23.js:L241–242` |
| ring | angle accepted against `vnoise` (up to 6 tries, a clumpy ring); radius `ringR`(1 + 0.035 N) | `app23.js:L243–245` |
| disc | radius `−H ln(u₁u₂)` (Gamma(2): an exponential surface density); up to 30 tries against `patchy` noise and the arm acceptance `(1 − armStrength) + armStrength·armProfile`; the 30th try is kept whatever; then `irr` noise rejection, exponential z of scale `thick` with random sign, outer warp, lopsided offset, rejection inside `VAR.dust` holes (80 %) | `app23.js:L246–261` |

Truncations `R > RMAX` (`app23.js:L249`, `app23.js:L254`), `rh > RMAX + 0.5` (`app23.js:L240`) and
`rS > RMAX + 0.8` (`app23.js:L225`) were meant to use `RMAX` = 4.2 (`app23.js:L121`), but the variable
is declared again as 240 at `app23.js:L857`, so they never fire (section 20, item 7).

### 6.2 Culls and assignment, per proposal

In this order (`app23.js:L262–273`):

1. **Extinction** (`dust` > 0, not halo): reject if `r() > exp(−τ)`. `dustTau` (`app23.js:L145–152`)
   is the path length towards the viewer inside the slab |z| < 0.06, capped at 6, times
   `9·dust·exp(−R/1.6)`, zero beyond R 3.2.
2. `q = project(p)`, and `roll = r()` is drawn.
3. **Dust-carving pen lines** (`dustLines` > 0.02): the longest polyline of 1–3 `penlines` drawings is
   laid along the arms (or along the midplane when edge-on) and projected (`app23.js:L199–213`). A disc,
   bar or ring proposal within `4 + 5·dustLines` px of it is rejected with probability 0.9·`dustLines`
   (`app23.js:L214–220`, `app23.js:L264`). The lines themselves are never drawn.
4. **Lane thinning**: a disc proposal within `LR = (3.5 + 3·dustScribble)·scale/84` px of any
   `dustLanes().pts` point is rejected with probability 0.7 (`app23.js:L194–198`, `app23.js:L265`).
   The test is in **screen space**, through a 16-px hash grid.
5. **Drawn stars**: within R 2.7, with probability `0.34·starMix` × (bulge 0.4, ring 1.6, arm 1.35,
   else 0.85) × (0.55 beyond R 2.1), the proposal becomes `rstar` (`app23.js:L266–269`).
6. Otherwise a **knot** (disc on an arm, `roll < 0.12·knots·arm`), a **sparkle star** (disc or ring,
   `roll > 1 − 0.012·sparkle·(0.4 + arm)`) or a **dot** in `old`, `young` or `disc`
   (`app23.js:L270–273`).

Sizes: dots use `dotSprite(t, k)` (`app23.js:L81`), which sizes the quad so that the dot itself reads
at 1.9–3.4 px × `PEN.dot` (the quad is about 40/size times larger, 8–10 px for a typical dot); knots
`(5 + 6U)·PEN.dot` px; sparkle stars 10–23 px (not scaled by the pen); drawn stars log-normal around
4.6 px, or 9–18 px for bright ones (`app23.js:L186–188`). `PEN.dot = 0.75 + 0.1·pen`
(`app23.js:L1227`).

### 6.3 After the loop

- **Breathing room** (`app23.js:L275–281`): every bright drawn star (outline kind) clears the dots
  within 0.4 × its size, through a 24-px grid. Knots and sparkle stars are not cleared.
- **Ring knots** (`ring` > 0.1, not a merger; `app23.js:L282–288`): `round(6 + 10·ring)` clusters of
  5–12 marks (half knots, half dots) on its own stream, each with a drawn star at its centre. The
  drawn star uses the **main** stream `r`, not `rr0`.
- **Clumps** (`app23.js:L289–297`): each `VAR.clumps` entry on its arm (or scattered when `irr`), `n`
  marks of which 25 % knots, plus 1–4 drawn stars; main stream.

Ring-knot and clump drawn stars are added after the breathing-room pass, so they clear nothing.

### 6.4 Sizes, cost, order dependence

| | Grand design | Smooth, round | Edge-on with dust | Lens: Einstein ring (main + source) | max over presets |
| --- | --- | --- | --- | --- | --- |
| proposals `N` | 11,096 | 11,096 | 11,096 | 11,096 + 2,570 | |
| dots, knots, sparkle stars, drawn stars | 8,133 / 136 / 18 / 1,570 | 7,785 / 0 / 0 / 720 | 3,401 / 122 / 5 / 298 | 11,910 / 131 / 15 / 1,920 (after lensing) | 19,085 dots (Layered: ringed galaxy, ghost reflection, with the ghost's stipple) |
| `generate` CPU, warm | 43 ms | 17 ms | 40 ms | 34 ms (2 calls) | 74 ms (1 call), 61 ms over 9 calls (Lens: galaxy cluster) |

Median over the 40 presets that call it: 32 ms (SwiftShader run, CPU only; noisy).

What is order-dependent or random:

- **One sequential stream** for all components, rejections and assignments. Every rejection loop
  (`gammaS`, the ring's angle loop, the disc's 30 tries) consumes a variable number of draws, and every
  conditional `r()` (the 0.7 lane test, the `dustLines` test, the drawn-star test, the knot/sparkle
  branches that draw extra values) shifts everything after it.
- **Screen-space decisions inside the stream**: the lane test (`inLane`, `app23.js:L265`) and the
  `dustLines` test (`nearDust`, `app23.js:L264`) depend on the projected position, so a change of camera
  changes which proposals survive *and* shifts the stream for all later proposals: the stipple is
  re-rolled on orbit (section 20, item 1). Breathing room is also in screen space.
- **View-independent pieces**: the Sérsic component and shells (both 2D), and merger galaxies (built
  face-on, then warped).
- Global state read: `P`, `VAR`, `VIEW.scale`, `SM` (via `inst`), `PEN`, `USED`, the `LANES` cache.

---

## 7. Curves and stroke ribbons

### 7.1 `curves()` (`app23.js:L768–800`)

Builds control polylines in the galaxy frame (`pts`, projected later) or already in the lens plane
(`pts2d`). The stream is `mulberry32(VAR.strokeSeed)`; the `r` argument is overwritten
(`app23.js:L771`). Nothing at all when `lines` ≤ 0.

| curve | condition | points | width `w` | stroke kind |
| --- | --- | --- | --- | --- |
| arms | `arms` ≥ 1, `bulge` < 0.95, `armStyle` ribbons, not `ringOnlyLines` | 161 per arm, `r0` to `min(VAR rmax, 2.1 + 0.5(1 − bulge))`, with the lopsided offset; `taper` | 1 | `stroke` |
| flocculent arms | `flocc` > 0.3 | the arm split where `vnoise` falls below `0.25 + 0.35·flocc`, pieces of > 6 points | 0.8 | `stroke` |
| spurs | 60 % of `VAR.spurs` | 31 | 0.7 | `spurred` when `stroke` is `mixed` |
| ring | `ring` > 0.1, `ringStyle` ribbon | 181 | 0.45 | `stroke`, alpha × `ring` |
| bar | `bar` > 0.1, `barStyle` ribbon | 3, `stretch` | 1.2 + 1.6·bar | `plain` |
| edge-on midplane | `incE()` > 80, not `kind: 'merger'`, `bulge` < 0.95 | 3, `stretch` | 0.8 | `faint` when `dust` > 0.3; alpha `lines·(incl − 72)/18` |
| outline | `outline` > 0.05 | two arcs of 41 at R 2.6 | 0.55 | `faint` |
| tail | `tail` > 0.05 | 91 | 0.9 | `faint` or `broken` |

`strokeIndex(kind, r)` (`app23.js:L762`) picks a row of the `strokes` sheet with that kind (`mixed` =
plain, beaded or spurred).

### 7.2 `buildCurves(C, V, pieceList)` (`app23.js:L802–839`)

For each curve: screen points `q` (`project`, or `VIEW.c + pts2d·scale`), cumulative arc length `L`
and total `tot`. The ribbon width in px is

`cw = clamp(PEN.line · c.w · h / thick[k], 6, 90)` (`app23.js:L807`),

where `h` = 64 is the row height of the strokes sheet and `thick[k]` (3–18 px) is the measured ink width
of that stroke: the ribbon is scaled so that the **ink** is `PEN.line × c.w` px wide, and the ribbon is
`h/thick` times wider than the ink. `kpx = cw / h` is the sheet-to-screen scale, the stroke image
(512 px long) covers `pat = 512·kpx` px, and it repeats `reps = max(1, round(tot / (1.4·pat)))` times,
so the drawing is stretched about 1.4× along the curve (`stretch` curves: once).

Two paths:

- **Re-spaced pieces** (`app23.js:L811–821`), when the stroke has `pieces` (29 of the 60 rows: 9 of the
  10 beaded, and all the broken and dotted ones) and is not `stretch`: each recorded piece `[x, y, size, tile]` of each repeat
  is placed at its own arc position `(rep·512 + x)·tot/(reps·512)`, offset across the curve by
  `(y − 32)·kpx·taper`, sized `size·kpx·taper`, rotated to the tangent, as a `pieces` sprite with the
  curve's alpha. So beads keep their spacing and shape however the curve bends. The segment is found by
  a linear search from the start for every piece.
- **Tiled ribbon** (`app23.js:L822–838`): two triangles per polyline segment (6 vertices of
  `[x, y, u, v, a]`, no sharing), normals from central differences, half width `cw·taper/2`,
  `u = (L/tot)·reps` (the strokes texture repeats in u), `v` the stroke's row with a 2 % inset. In a
  merger galaxy (`SEAMMAX` 30) a segment is dropped if it is longer than 30 px or was stretched more
  than 1.8× along or across by the tidal warp (`app23.js:L833–834`).

`taper` = 1.1 − 0.45 × (arc fraction): 1.1 at the root, 0.65 at the tip.

**Sizes:** an arm is 160 segments, 960 vertices. Strokes vertices per pass: 0 (Flocculent, all pieces;
Hand-drawn arms) to 1,320 (Grand design: one arm as a ribbon, the other beaded as 24 pieces, and two spurs), 6,420 for the quasar
(the host's arms traced through four images), 27,648 for the cluster. Pieces: 0–432 for galaxies, 825
for the cluster. **Cost:** median 0.7 ms; 12–17 ms when lensed curves are traced. **Order:**
`strokeIndex` consumes the `curves` stream in curve order; `pieces` and ribbons are deterministic given
the curve.

---

## 8. Vector marks: `parts`, `expandVector`, `WARPS`

### 8.1 `parts(r)` (`app23.js:L987–1086`)

Places the drawings, each as one instance row with an affine matrix (section 15), in a fixed order on
the stream `mulberry32(P.seed * 57 + 3)`:

| part | condition | drawing and placement | line |
| --- | --- | --- | --- |
| envelope | `envelope` > 0.5 | an `env` halo or disc drawing, 7.2 units across, on the disc (or round for a pure bulge) | `app23.js:L991–997` |
| whole drawing | `whole` > 0.5 | a `whole` drawing of the right type (from `kind`, or inferred from `bulge`, `incE`, `dust`, `flocc`, `bar`, `arms`); laid on the disc; mirrored to match the winding, or **rewound** (`rewind`) to the model's pitch through a warp | `app23.js:L999–1014` |
| drawn arms | `armStyle` drawn | an `arms` drawing of the pitch class (tight < 14°, medium < 26°, loose), copied `arms` times round the centre | `app23.js:L1016–1024` |
| bar, ring | `bar` / `ring` > 0.1, style drawn | an outline `bars` drawing; a `rings` drawing at alpha 0.55 | `app23.js:L1026–1027` |
| core | 0.03 < `bulge` < 0.97, not Sérsic, `incE()` < 80 | a `cores` bitmap chosen by `bulge^0.6`, dotted or line style; optional nuclear spiral | `app23.js:L1028–1035` |
| oddities | `lens`, `shells`, `tail`, `trails` | drawn arcs, shells, a pen-line tail, satellite trails and cosmic rays (in fixed 800-px screen positions) | `app23.js:L1037–1045` |
| sky | always | `skyParts(L, r)` (section 10) | `app23.js:L1046` |
| hatching | always | one `penlines` drawing per `dustLanes()` stroke, flattened to 0.28, pen scale 0.38, on its own stream | `app23.js:L1047–1050` |
| arrow | `field` and `arrow` | a `misc` arrow | `app23.js:L1052` |
| bubbles | `bubbles` > 0.02, arms or `irr`, not a merger | a `rings` curve at a `VAR.clumps` position, with probability `0.6·bubbles` | `app23.js:L1054–1062` |
| jet | `jet` > 0.5 | the `misc` spring, stretched both ways | `app23.js:L1063–1068` |
| streams | `streams` > 0.02 | dots and knots along a pen line bent round the galaxy (`sdots`, `sknots`) | `app23.js:L1069–1084` |

Cost: 1–5 ms (mostly `skyParts`). Order: one stream; every condition that draws (envelope type, whole
pick and spin, arm picks, ring pick, arc counts…) shifts the rest. `skyParts` does not draw from `r`,
so it does not shift what follows it.

### 8.2 `expandVector(k, row, VL, VD, VB)` (`app23.js:L1190–1219`)

Every row of a vector atlas (`whole`, `arms`, `rings`, `bars`, `env`, `arcs`, `shells`, `companions`,
`trails`, `penlines`, `misc`, `sstars`) is turned into geometry on the CPU at the end of `render()`
(`app23.js:L1283`, `app23.js:L1287`):

- **Lines** (`l`): each polyline segment becomes a quad of half width `w = PEN.line/2 × ps`
  (`ps` = row[8], default 1), extended by 0.9w at both ends so joins close, 6 vertices
  `[x, y, 0.5, 0.5, 1]` into `VL` (`app23.js:L1199–1213`). The texture is `solid` (a 4 × 4 black
  canvas), so these are hard-edged quads, smoothed only by MSAA. **All drawings share one pen weight**,
  whatever their size. The vertex alpha is always 1: the row's alpha is ignored.
- **Dots** (`d`): a `dots` sprite into `VD`, tile hashed from the coordinates, size from the recorded
  radius × matrix scale, clamped to 0.8–1.6 × the stipple size (`app23.js:L1215–1216`).
- **Blobs** (`b`): a `knots` sprite into `VB` with the blob's ellipse matrix (`app23.js:L1217–1218`).

The transform `tf(x, y)` (`app23.js:L1194–1198`) is `SM(x0 + M·(x, y))`, possibly through a warp.

### 8.3 `WARPS` (`app23.js:L172`)

A global array, reset each render (`app23.js:L1227`); a row's column 9 holds an index into it. Three
kinds:

| kind | made by | effect in `tf` |
| --- | --- | --- |
| `{ fn }` | rewind (`app23.js:L1010`) | warps tile coordinates **before** the matrix: `θ += dk·ln(r/0.08)` with `dk = cot(target pitch) − cot(drawn pitch)` (`app23.js:L842–845`) |
| `{ post }` | merger galaxies (`app23.js:L1249`), lensed vectors (the image's Jacobian, `app23.js:L660`), weak lensing of the deep field (`app23.js:L1278`) | warps the **screen** position after the matrix |
| `{ screen: true, fn, scale }` | `mWarp` (`app23.js:L1262`) | replaces the whole transform: tile coordinates go straight to screen through `tidal()`; blobs are skipped and `scale` replaces the matrix scale for dot sizes |

With any warp, polylines are first resampled to 0.012 tile units (`app23.js:L1202`), segments longer
than 22 px are dropped, and with a `post` warp segments stretched more than 1.8× are dropped
(`app23.js:L1206–1208`).

**Sizes:** the typical record: `sstars` 36 segments (215 vertices), `whole` 75 (451) plus 16 dots,
`rings` 56 (337), `penlines` 58 (346), `env` 74 (447). Calls per render: 24–38 for stars and
artefacts, 150–2,600 for galaxies, mergers and lenses (median over all presets 1,268), 4,945 for the
cluster. **Cost:** the largest CPU stage: median 59 ms, 366 ms for the cluster, about half of `render()` for most presets
(SwiftShader run). **Order:** deterministic given the rows; it reads `VAR.dotPool` and `VAR.knotPool`
(so the main galaxy's pools are used for every vector mark, including those of merger and source
galaxies) and adds to `USED`.

---

## 9. Dust

Four separate mechanisms:

| mechanism | parameter | where | what it does |
| --- | --- | --- | --- |
| extinction | `dust` | `dustTau`, `generate` (`app23.js:L145`, `app23.js:L262`); the Sérsic strips (`app23.js:L227–228`) | removes stars behind a thin dusty midplane; for ellipticals, two strips |
| hatched lanes | `dustScribble` (default 0.5), also any `ring` > 0.1 | `dustLanes` (`app23.js:L944–986`) and `parts` (`app23.js:L1047–1050`) | pen-line hatches along the inner edge of each arm, inside a ring, or along an edge-on midplane; **and** thinning of the disc stipple near them |
| carving lines | `dustLines` | `generate` (`app23.js:L199–220`, `app23.js:L264`) | undrawn pen lines that cut gaps in the stipple |
| clouds | — | `dustClouds` (`app23.js:L923–940`) | never called |

### 9.1 `dustLanes()` (`app23.js:L944–986`)

Cached in `LANES` with key `[seed, dustScribble, arms, pitch, incl, az, pa, bulge, winding, bar, barLen,
VIEW.scale, vary, merger, irr, ring, ringR]` (`app23.js:L945`): the camera is in the key, so every orbit
recomputes it. Skipped for `bulge` ≥ 0.9, mergers and `irr`. Stream `P.seed * 733 + 29`; patchiness from
`vnoise`, keep threshold `0.3 + 0.55·max(dustScribble, ring ? 0.5 : 0)`.

- Edge-on (`incE()` > 74): three rows at z −0.022, 0, +0.022, x from −2.8 to 2.8 in steps of 0.055;
  every middle-row point goes to `pts`; a hatch where the noise allows and `r()` < 0.85, its length
  falling off with |x|.
- Ring (`ring` > 0.1, not edge-on): every 0.07 rad at 0.9 `ringR`.
- Arms: for each arm, R from 0.45 to 0.95 `rmax` in steps of `0.035 + 0.02R`, slightly behind the arm
  phase (the inner, trailing edge), with Gaussian jitter and an occasional feather (probability
  `0.14·dustScribble`).

Output `{ strokes: [x, y, angle, length], pts: [screen points] }`, all already projected. In `parts`,
each stroke becomes a `penlines` vector drawing scaled (length, 0.28·length), pen scale 0.38, on the
stream `P.seed * 919 + 3`. Hatches are therefore expanded as solid ribbons with the rest of the vector
marks.

**Order:** the hatches themselves are a deterministic function of the key. The problem is what
`generate` does with `pts` (section 6.2, item 4, and section 20, item 1). The same cache is shared by
the main galaxy, merger galaxies and lensed source galaxies, so it is recomputed several times per frame
in those presets (18 calls per render for the cluster).

---

## 10. The sky

### 10.1 `buildSky()` (`app23.js:L867–877`)

Cached in `SKY` with key `[seed, field, fgstars]`. Stream `P.seed * 1013 + 71`.

- Background galaxies: `min(6000, round(field·26/0.0145))` (538 at the default 0.3, 1,793 at 1), each
  at a volume-uniform radius in the shell 40–240 units, with a random normal, a drawing from the pool of
  all `whole`, `env`, `companions` and `arms` records (231), radius 1.4–4.6, spin, 2–3 copies for an arm
  drawing, its own seed and bulge fraction.
- Foreground stars: `min(2500, round(fgstars·7/0.021))` (100 at 0.3), on a sphere of radius 42
  (± 15 %), an `fgstars` tile, size 16–42 px, small rotation.

### 10.2 `skyParts(L, r)` (`app23.js:L878–920`)

Every render, for the current camera:

- A background galaxy is kept if it is behind the galaxy (`k ≤ 0.8`, which means depth ≤ −7.5), at
  least 2 units in front of the camera, within 120·zoom px of the canvas, and smaller than 140 px
  (`app23.js:L884–885`). Only a few dozen of the 538–1,793 pass (about 40 for Deep field). They are
  sorted far to near (`app23.js:L886`).
- For each: `clamp(2.2·apparent radius, 10, 150)` dots of a little 3D galaxy (bulge or a two-armed disc)
  on its own stream `mulberry32(o.seed)`, perspective-projected point by point, into `L.bgdots`
  (`app23.js:L889–899`); plus its drawing laid on the same plane with `orient`, pen scale 0.42, into
  `L.bg` (`app23.js:L901–905`).
- **Weak-lensing look**: when the subject is `massive` (`bulge` > 0.5, a lens, a merger or Sérsic), each
  drawing is stretched tangentially round the centre by `γ = min(0.45, 0.35·θE/r)`, θE = 1.3 units
  (`app23.js:L902`). For a lens cluster the real deflection field is applied as well, after `parts`
  (section 13.6).
- Foreground stars (`app23.js:L908–912`): perspective size `size·min(2.2, k/0.42)`, into `L.fgstars`
  (a bitmap atlas).
- Companions (`companions` > 0.05; `app23.js:L913–919`): 1–4 `companions` drawings at 3.4–4.6 units,
  in front of the galaxy (`L.front`) or behind (`L.bg`) depending on their depth.

**Sizes:** `L.bgdots` 536–2,711 sprites (604 at the default `field`); 10–40 `L.bg` drawings, whose
expansion gives 3,800–27,000 solid vertices. **Cost:** 1–5 ms, plus `buildSky`
0.3 ms (up to 3 ms) whenever its key changes. **Order:** the catalogue is fixed per key; what is visible,
its perspective, and the `massive` shear depend on the camera; the far-to-near sort depends on the view.
The `SKY` cache is single-entry and is overwritten by merger galaxies and lensed sources (whose `field`
is 0), so in those presets the catalogue is rebuilt every frame.

---

## 11. Mergers

### 11.1 `simulateMerger()` (`app23.js:L304–380`)

A restricted three-body simulation in the manner of Toomre and Toomre. Cached in `MCACHE` with key
`[seed, mRatio, mPeri, mStage, mSpin1, mSpin2, mFriction, mStars, vary, mBulge, mType1, mType2, mArms1,
mArms2, mSize1, mSize2, mBar1, mBar2, mTilt, mEcc, mHorizon]` (`app23.js:L305`): the camera and `mTime`
are not in it.

- **Cores:** masses 1 and q = `mRatio`, Plummer softening 0.22 and 0.22√q. They start on a parabolic
  orbit with pericentre `mPeri`, at true anomaly −2.2 rad, in the centre-of-mass frame; their velocity
  is scaled by `mEcc` (< 1 bound, > 1 a fly-by); the orbital plane is tilted by `mTilt` about x
  (`app23.js:L307–314`). The time from the start to pericentre, `t0`, comes from Barker's equation
  (`app23.js:L311`).
- **Test stars** (`app23.js:L315–339`): `n0 = round(mStars(1 − 0.6·mBulge)/(1 + √q))` in the big
  galaxy and `max(800, n0√q)` in the small one (9,679 in total for the Mice). Discs: exponential, scale
  `0.32√M·size`, truncated at `1.7√M·size`, spin axis tilted by `mSpin` with a random azimuth from the
  stream; half the stars of a spiral start on log spirals, barred discs put 35 % of the inner stars on a
  bar; circular velocities from the Plummer potential. Ellipticals: a hot, isotropic ball. Each star
  keeps its initial disc coordinates (`DX`, `DY`, `R0`) for the tidal map.
- **Integrator** (`app23.js:L340–368`): kick–drift–kick leapfrog, dt 0.012, from the start to
  `mStage` after pericentre, at most 1,400 steps. The cores attract each other (softening 0.02) with an
  optional drag on their relative velocity (`mFriction`, falling off as `exp(−d/1.5)`); the stars feel
  both cores and not each other. Snapshots every `max(1, floor(steps/90))` steps (90–180 frames for
  `mTime` < 1; 105 for the Mice).
- **The future** (`app23.js:L369–378`): integration continues for `5·(HZ − 1)` time units,
  HZ = clamp(`mHorizon`, 2, 30), with up to 420 snapshots, for `mTime` > 1.

**Cost:** 210–340 ms on a cold render (Mice 223 ms, long tails 337 ms), zero when cached. Memory: every
snapshot is a full `Float32Array` of positions (105 + 84 frames × 29,037 floats ≈ 22 MB for the Mice
at HZ 2; HZ 30 integrates about 12,000 more steps and keeps up to 420 frames). **Order:** one
stream for the initial conditions; the integration is deterministic floating point (f64 on the CPU,
`Float32Array` storage).

### 11.2 `mergerGalaxyParams(g, S0)` (`app23.js:L381–389`)

Describes each merging galaxy as a single galaxy: face-on (`incl`, `az`, `pa` 0), seed
`P.seed * 7 + g * 101 + 1`, stars `0.42·mStars·share + 700`, no field, no extras. Ellipticals become
Sérsic (n 3–4); lenticulars a bulge of 0.55 with no arms; spirals `mArms`, a pitch of 14–32°, a bulge from
`mBulge`, optional bar, lighter lines (`lines` ≤ 0.45, `dustScribble` ≤ 0.3).

### 11.3 `mergerSprites()` (`app23.js:L481–553`)

- Picks the state: the chosen moment, a blend of two snapshots for `mTime` < 1 (`snapAt`,
  `app23.js:L390`), or the future for `mTime` > 1, with a frame (centre and radius) eased between the
  whole encounter and the final framing (`app23.js:L483–492`).
- Projects every star orthographically with the current camera (`view`, `app23.js:L500`), and frames it
  from the 3D extent: `sc = 0.74·W/(2r)·scale/84` (`app23.js:L515`), so the framing is steady under
  orbit.
- Classifies every star on stream `P.seed * 17 + 3` (`app23.js:L518–528`): a drawn star (5 % ×
  `starMix`, more in tails), a knot of new stars in a tidal tail (beyond 1.15 `rmax`), an outer knot, a
  sparkle star, or a dot (`young` for outer stars, else `disc`).
- Bulge dots round each core (`app23.js:L529–535`): `round(1500·M·(1 + 3.5·BUL))` per core into `old`.
- Returns `tidal(g, flip)` (`app23.js:L538–551`): a map from a galaxy's initial disc coordinates
  (−0.5…0.5 tile units, doubled to −1…1) to the screen. It looks up the stars of galaxy `g` in a
  20 × 20 grid of initial positions, searching rings of cells until it has candidates, keeps the 4
  nearest by initial position and returns the inverse-distance-weighted average (`1/(d + 0.02)`) of
  their **current** screen positions.

### 11.4 In `render()` (`app23.js:L1231–1266`)

1. `MS = mergerSprites()`; `parts` for the main `P` (sky, trails, streams), with its galaxy drawings
   cleared (`app23.js:L1234`).
2. The debris: only 16 % of the simulated `disc` and `young` dots are kept, 60 % of the knots and 50 %
   of the drawn stars, on stream `P.seed * 13 + 9` (`app23.js:L1236–1238`). The bulge dots (`MS.S.old`)
   and `MS.cores` are never used.
3. For each galaxy (`app23.js:L1241–1257`): sample `tidal(g)` once on a **49 × 49 grid** (`GNm` 48) and
   interpolate it bilinearly (`tfn`); set `P` to the galaxy's parameters, `VIEW.scale` to
   `s0 = MS.sc·RMAX_g/4.2` (so the model's radius 4.2 matches the simulated disc), `VAR` to its own
   variation, and `SM` to `post ∘ SM`, where `post` maps the galaxy's screen offset over
   `R2 = 8.4·s0` px into the grid; then run `generate`, `curves`, `buildCurves` (with `SEAMMAX` 30) and
   `parts`. Every bitmap mark is warped at `inst` time, every vector mark gets the `post` warp, drawn
   stars are moved but keep their shape. Restore the globals.
4. `mWarp` (`app23.js:L1260–1264`): one `whole` spiral drawing per galaxy, warped through `tidal()`
   itself (not the grid) as a `screen` warp, mirrored by its recorded winding.
5. A lens and shells, if asked for, are applied to the merged scene.

**Sizes:** 6,800–7,900 dots, 0–400 knots, 140–1,240 drawn stars; 35,000–380,000 solid vertices.
**Cost (warm):** `mergerSprites` 7–34 ms, two `generate` calls 14–43 ms, `render()` self time
27–64 ms (mostly the 2 × 2,401 `tidal()` calls, each sorting its candidates), `expandVector`
20–115 ms (warped drawings are resampled at 0.012). **Order:** the debris classification is
view-independent (it uses 3D distances), but its screen positions, the tidal grid, and therefore
which ribbon segments are torn and which dots are cleared by drawn stars, depend on the camera
(section 20, item 8).

---

## 12. Shells

`shellSprites(out)` (`app23.js:L711–748`), cached in `SCACHE` with key `[seed, shellTime, shellStars]`.

- **Simulation:** `shellStars` (6,000) test stars released as a cold cloud at x ≈ 3 with a small inward
  velocity, integrated in a logarithmic potential (force `−r/(r² + 0.3)`, a flat rotation curve) by
  semi-implicit Euler, dt 0.02, `shellTime/dt` steps (3,500 for the preset): 21 million star-steps,
  about 250 ms cold (`app23.js:L714–722`).
- **Shell detection** (`app23.js:L724–739`): for each side (x > 0, x < 0) a 64-bin radial histogram to
  4.2, smoothed `[1, 2, 1]/4`; peaks with a sharp outer drop (> 45 %) holding more than 0.4 % of the
  stars, the three biggest per side; for each, the opening angle is the 85th percentile of the stars'
  polar angles.
- **Drawing** (`app23.js:L741–747`): every star becomes a dot, from x and y only, rotated by `shellAxis`,
  on stream `P.seed * 31 + 1`. `shellArcs()` (`app23.js:L750–760`) draws each shell as a 41-point
  `faint` stroke, in `pts2d` (no projection).

The shells are therefore a fixed 2D image: they do not follow `incl`, `az` **or** `pa` (section 20,
item 14). Warm cost 2.6 ms.

---

## 13. Lensing

`lensSprites10(out, V, PIE)` (`app23.js:L678–708`), the current lensing ("v10"). The older
`lensSprites` (`app23.js:L556–591`) is dead.

### 13.1 The lens: `lensModel(f)` (`app23.js:L594–606`)

One or more **non-singular isothermal ellipsoids** (Keeton 2001), each with strength `b`, axis ratio
`q` (clamped 0.2–0.995), angle and core `s`; deflection by the closed form with `atan` and `atanh`
(`app23.js:L600–602`), plus external shear `γ` at angle φ. `f` scales the deflection for a farther
source plane (1.3 for the cluster's weak lensing, 1.42 for the second source of the double ring).

- Single lens: `b = lensR`, `q = lensQ`, angle `lensAngle`, core `lensR·lensCore`.
- Cluster (`lensCluster`): a central halo `b = 1.55·lensR`, q 0.72, plus 7–11 member halos
  (`b` 0.07–0.24 `lensR`) at random positions on stream `P.seed * 431 + 9`.

`psi(x, y)` (`app23.js:L604`) is an *approximate* potential, used only to order the quasar's time
delays.

### 13.2 The solver: `lensSolver(model, R, G)` (`app23.js:L608–628`)

- A regular grid of (G + 1)² image-plane nodes over ±R (R = 2.5·`lensR`, 3.6 for the cluster), each
  traced to the source plane, `β = θ − α(θ)`. G = 210 (44,521 deflections), 250 for the cluster (63,001
  × 8–12 halos), 200 for the double ring's second solver.
- 2G² triangles, binned into a G × G grid over the source-plane bounding box. A triangle covering more
  than 400 bins is skipped: it straddles a caustic (`app23.js:L617`).
- `images(px, py)` (`app23.js:L620–627`): find the bin, test every triangle in it with barycentric
  coordinates in the **source** plane, and map each hit back to the image plane with the same
  barycentrics. The local Jacobian `J = ∂θ/∂β` comes from the triangle's two edge matrices, and
  `μ = det J` is the signed magnification (negative: mirrored image). Hits within 0.6 cell of an image
  already found are merged.

So the solver is a piecewise-linear inverse of the lens map, and every source point gets every image,
each with its own stretch and parity. Cost: 11–60 ms per solver (cluster 59 ms).

### 13.3 The source galaxy: `buildSourceGalaxy(seed, sizeGU, o)` (`app23.js:L630–645`)

Builds a whole galaxy exactly as a single one is built, by swapping the globals: `P` becomes a copy of
the main `P` with the extras off and the source's arms, bulge, inclination, roll, stars and lines;
`VIEW.scale` 70; a new `VAR`; `SM` the identity (`app23.js:L631–634`). It runs `generate`, `curves`
and `parts`, then records every mark with its offset from the centre in source-plane units
(`k = sizeGU/(4.2·70)`): `sprites` (bitmap marks and drawn stars), `curves` (projected control points)
and `vecs` (vector drawings). Then it restores the globals (`app23.js:L643`). There is no `try/finally`.

### 13.4 Every mark into every image: `lensMarks(M, solver, bc, out, LQ, CV, dens)` (`app23.js:L646–670`)

With `bc` the source centre (from `srcNow`), stream `P.seed * 733 + round(bc[0]·997)`:

- **Stipple keeps its surface brightness:** for each dot sprite and each image, `floor(κ|μ| + U)` copies
  (|μ| capped at 30), scattered by a Gaussian of 1.3k in the source plane and mapped through `J`. `κ` is
  chosen so the total is about `0.5·dens` (`app23.js:L651–654`). So the number of dots is set by
  `lensStars` (6,000), not by the source's own `stars`.
- Knots and sparkle stars: 45 % dropped, the rest scaled by `|μ|^0.25` (0.7–1.3).
- Drawn stars: copied to each image unchanged.
- Bitmap parts of the source (`L:` keys such as its core): positioned only, into `LQ`.
- Vector drawings: one copy per image with |μ| ≤ 40, carried by a `post` warp that applies that image's
  `J` (`app23.js:L659–661`).
- Curves (`app23.js:L662–669`): resampled at half a solver cell, each sample traced into all its images,
  and the images chained into branches by nearest neighbour (within 4 cells); a branch ends when no
  image is near; each branch of ≥ 3 points becomes a `pts2d` curve without taper.

### 13.5 The branches of `lensSprites10`

| source | what happens | line |
| --- | --- | --- |
| `quasar` | the images of the source centre with \|μ\| > 0.08; arrival time `½|θ − β|² − ψ(θ)`, normalised to 0.18–0.73 of a cycle; the flare at `now = (mTime/2) mod 1` brightens each image in turn (Gaussian, σ 0.05); each image is a `lensStar` (a knot heart, glare dots, an outline star); plus a faint host galaxy (1,400 stars, `dens` 0.18·`lensStars`) | `app23.js:L682–687`, `app23.js:L672–676` |
| `drawing` | one `whole` galaxy drawing, warped into every image as a vector | `app23.js:L688–690` |
| cluster | 6–9 source galaxies, each at its own position and depth behind the lens, through one solver; the member halos are drawn as `smooth` drawings; `LENSWL = lensModel(1.3)` for weak lensing | `app23.js:L691–699` |
| galaxy (default) | one source galaxy of 2–3 arms, 2,200 stars | `app23.js:L700–702` |
| `lensDouble` | a second source farther back (`lensModel(1.42)`, its own solver of G 200 at 1.2R) | `app23.js:L703–706` |

Then `buildCurves(CV, V, PIE)` draws the traced curves and `LENSQ = LQ` hands the lensed drawings to
`render()` (`app23.js:L707`). Every source is placed with `srcNow(…, D)`, D = 2.5 `lensR` (cluster:
`lensR·(1.5 + 2·frac(0.618i))`; second source 3.5 `lensR`), so orbiting changes the alignment.

### 13.6 Weak lensing of the field (`app23.js:L1273–1278`)

For a cluster, after `parts`: for each background drawing in `L.bg`, a numerical Jacobian of
`LENSWL.alpha` (step 0.01, 5 evaluations), inverted to a magnification matrix, rotated into screen
axes, and applied as a `post` warp about the drawing's centre. Drawings with |det A| < 0.25 are left
alone. Only the drawings are warped, not their `bgdots`, and only in the non-merger branch.

### 13.7 Sizes, cost, order

| preset | dots / knots / drawn stars | stroke / solid vertices | `lensSprites10` | of which solver / `buildSourceGalaxy` / `lensMarks` (warm) |
| --- | --- | --- | --- | --- |
| Lens: Einstein ring | 11,910 / 131 / 1,920 | 864 / 603,504 | 67 ms | 36 / 10 / 18 ms |
| Lens: Einstein cross (quasar) | 13,280 / 315 / 1,506 | 6,420 / 469,284 | 46 ms | 12 / 8 / 6 ms |
| Lens: galaxy cluster | 14,029 / 1,070 / 4,228 | 27,648 / 1,948,986 | 141 ms | 59 / 46 (8 calls) / 24 ms |
| Lens: double Einstein ring | 13,865 / 233 / 2,510 | 534 / 693,702 | 65 ms | 21 (2 solvers) / 13 (2 calls) / 31 ms |
| A sketch, lensed | 8,429 / 0 / 401 | 0 / 106,086 | 24 ms | 24 / — / 0.1 ms |

Order dependence: `lensSprites10`'s stream picks the source's parameters before building it, so the
cluster's sources are built in a fixed order; the `lensMarks` seed depends on `bc[0]`, which depends on
the camera (`srcNow`) and on the home orientation (`LHOME`); the whole of `P`, `VAR`, `VIEW.scale` and
`SM` are swapped during `buildSourceGalaxy`, and the source galaxy also overwrites the single-entry
`SKY` and `LANES` caches.

---

## 14. Stars and artefacts

### 14.1 `starSprites()` (`app23.js:L399–438`)

Stream `P.seed * 911 + 17`. Positions are in screen px round `VIEW.cx, VIEW.cy`, with `U = VIEW.scale`.

`aStar(x, y, B, full)` (`app23.js:L405–418`), one star of brightness B:

| part | marks |
| --- | --- |
| saturated heart | `round(20 + 90B)` knots within `0.6·core` |
| glare | `round((1500 + 7500B)·(full ? 1 : 0.22))` dots at power-law radii `core·(1 − 0.99U)^−0.62`, cut at `U(1.3 + 2.3B)` |
| diffraction spikes (`spikes` > 0.02) | 4 spikes of `round(L/0.8)` dots, L = `U(0.9 + 3.4·spikes·B)`, with a common rotation from `VAR.spike` |
| rings in the glare (`starRings` > 0.02) | `1 + round(2·starRings)` rings of `260·starRings·i` dots, gaps from `vnoise` |
| bleed column (`bleed` > 0.02, B > 0.45) | `round(1.4·bl)` dots in a vertical column |
| the drawing | one outline or burst `sstars` drawing at the core |

Subjects: a star (`aStar` plus 3–7 faint neighbours, `app23.js:L419–420`); a satellite trail (dots along
a line, sometimes doubled, flickering with `vnoise`, and a star; `app23.js:L423–428`); a ghost
reflection (a bright star and a ring of 2,600 + 500 dots opposite it through the centre;
`app23.js:L429–432`); cosmic rays (70–129 short hits of dots, some knots, a star; `app23.js:L433–435`).
Sizes: 5,200–12,600 dots and 50–300 knots; cost 2–6 ms warm (17 ms cold for the ghost overlay).

### 14.2 `overlaySprites(S)` (`app23.js:L453–465`)

Adds a bright foreground star and/or an artefact over any subject. It saves `subject`, `artefact`,
`starBright`, `seed`, `_ov` and `VIEW.cx/cy`, sets `P._ov = 1`, and inside `try/finally`:

- the star: placed with `scenePoint(OVHOME, …, depth 1.4)`, moves `VIEW.cx/cy` there, sets
  `subject = 'star'`, `starBright = ovStar`, `seed = seed·7 + 3`, and merges `starSprites()` (with
  `_ov`, no faint neighbours);
- the artefact: stream `seed * 977 + 3` for its geometry; the ghost's star via `scenePoint` (`OVG`);
  seed `seed·11 + 5`. `OVT` is set to null before `starSprites` runs, so the trail is drawn in screen
  space round the centre, not through the scene (`app23.js:L461`; the comment says this is intended:
  "a satellite near Earth doesn't turn with the galaxy").

Cost: 0.6–6 ms warm (17 ms cold for the ghost, whose star and reflection add some 11,000 dots).

---

## 15. The instance format and `USED`

`inst(list, atlas, x, y, tile, alpha, M)` (`app23.js:L171`) appends

`[x, y, tile, alpha, m0, m1, m2, m3]`

where `(m0, m1, m2, m3)` is a column-major 2 × 2 (`mat2(m0, m1, m2, m3)`), usually
`simple(size, rot) = R(rot)·S(size)` (`app23.js:L173`). The vertex shader computes
`p = M·corner + (x, y)` for the corners ±0.5, so the matrix carries size, rotation, foreshortening and
mirroring. For bitmap atlases `inst` first passes (x, y) through `SM` (hand wobble, merger tides);
vector atlases get `SM` later, per vertex, in `expandVector`.

Optional columns, used only by vector rows (which never reach `drawSprites`):

- `[8]` **pen scale** `ps`: line half-width multiplier and dot-size factor in `expandVector`. Drawn
  stars 0.36–0.58 (by size, `app23.js:L190`), merger stars 0.42/0.58, quasar images `0.7 + 0.5B`,
  background drawings 0.42, hatches 0.38, arrow 0.5, bubbles 0.6, jet 1.1, `mWarp` drawings 0.9/0.75.
- `[9]` **warp id** into `WARPS`.

`drawSprites` packs rows with `d.set(row, k·8)` into a `Float32Array` of 8 floats per instance
(`app23.js:L1116`): `i0 = (x, y, tile, alpha)`, `i1 = (m0, m1, m2, m3)`.

`USED` (`app23.js:L161`, reset at `app23.js:L1227`) is a `Set` of **source drawing names**
(`AT[atlas].src[tile]`), added by `inst`, by `buildCurves` (the stroke's source), by `expandVector`
(the source of each vector dot) and by the parts that bypass `inst`. `STATS.used` is its size, shown as
"N of the 469 drawings" (`TOTAL_DRAWINGS` hard-coded, `app23.js:L3`). 50–180 per preset.

---

## 16. The WebGL renderer

### 16.1 Context and resources (`app23.js:L1088–1111`)

- WebGL2, `premultipliedAlpha: true`, `alpha: true`, `antialias: true` (MSAA),
  `preserveDrawingBuffer: true` (for the GIF and SVG exports).
- Textures: every atlas with a `uri` (`dots` 800 × 640 = 25 × 20 cells of 32 px, `knots` 16 × 10 of
  48 px, `stars` 12 × 4 of 64 px, `cores` 9 × 3 of 128 px, `pieces` 32 × 20 of 32 px, `fgstars` 10 × 3 of
  96 px, `strokes` 512 × 3,840 = 60 rows of 64 px), plus `solid`, a 4 × 4 black canvas
  (`app23.js:L1109–1110`). RGBA8 from PNG, **`generateMipmap` over the whole sheet**,
  `LINEAR_MIPMAP_LINEAR` / `LINEAR`, clamp to edge except `strokes`, which repeats in s
  (`app23.js:L1100–1107`). Ink is the alpha channel. The vector atlases have no texture.
- One VAO, one instance buffer and one ribbon buffer, refilled with `bufferData(DYNAMIC_DRAW)` for every
  draw call; uniform locations looked up on every call.

### 16.2 Shaders (`app23.js:L1092–1097`)

- Sprites: `p = mat2(i1)·corner + i0.xy + uOff`, to clip space through `uRes` = 800 (y flipped).
  `vUV = (vec2(col, row) + corner + 0.5) / uGrid`, with `col = mod(tile, cols)`, `row = floor(tile/cols)`:
  the quad spans exactly one cell, with no inset.
- Ribbons: position and UV per vertex, alpha per vertex.
- Fragment (shared, `precision mediump float`): `a = smoothstep(uEdge.x, uEdge.y, texture.a)·vA·uGain`,
  output `(uInk·a, a)`. `uEdge` is (0.12, 0.55) for every textured draw; the `MAGNIFIED` threshold
  (0.46, 0.62) (`app23.js:L1124`) applies only to atlases that are all vector, so it is never used.
- Blending: `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied "over"), cleared to transparent
  (`app23.js:L1226`).

### 16.3 Draw order: `scene(inkOf, off, gain)` (`app23.js:L1289–1301`)

| # | layer | atlas or texture | ink |
| --- | --- | --- | --- |
| 1 | background galaxies' dots (`L.bgdots`) | dots | line |
| 2–4 | background drawings: lines, dots, blobs | solid, dots, knots | line |
| 5 | `env`, `whole`, `shells` sprites | (always empty: vector, expanded into 7–9) | line |
| 6 | stroke ribbons (`V`: arms, spurs, lensed curves, shells) | strokes | line |
| 7–9 | all other vector drawings: drawn stars, whole drawings, envelopes, arms, bars, rings, bubbles, arcs, hatching, trails, jet, lensed drawings (lines, dots, blobs) | solid, dots, knots | line |
| 10 | pieces | pieces | young |
| 11–13 | stipple `old`, `disc`, `young` | dots | old, disc, young |
| 14–15 | stream dots and knots | dots, knots | old |
| 16 | knots | knots | hii |
| 17 | sparkle stars | stars | young |
| 18–20 | `bars`, `rings` (empty), cores, then `arcs`, `companions`, `penlines` (empty) | cores | old |
| 21–23 | front companions (lines, dots, blobs) | solid, dots, knots | line |
| 24 | foreground stars | fgstars | star |
| 25 | `trails` (empty) | | line |

So line-work is drawn **under** the stipple, cores over it, and foreground stars last. 26
`drawSprites` and 4 `drawRibbons` calls per pass; the empty ones return early.

### 16.4 Plates, palettes, surface

- `ink` (`app23.js:L1307`): one pass, everything in `INK`.
- `slip` (`app23.js:L1302–1304`): the whole scene four times: cyan, magenta and yellow at offsets
  (−3.6, −1.2), (3.4, 1.0), (0.6, 3.8) px and gains 0.32, 0.30, 0.42, then the key ink. Four times the
  draw work: Plates slipped is the second-slowest preset on SwiftShader (1.9 s warm) with ordinary CPU
  cost.
- `colour` (`app23.js:L1305–1306`): ink by population: old, young, hii, disc, star and line.
- Palettes (`app23.js:L1143–1146`): `light` (ink ≈ `#1d1b19`, disc ink a little lighter) and `dark`
  (cream inks, warmer population colours).
  `applyTheme` (`app23.js:L1147–1152`) swaps the ink colours and sets `data-surface` on `.plate` to
  `paper` or `chalk`; the page's own `data-theme` stays light. The canvas is transparent, so the
  **Chalkboard** surface is pure CSS: `.plate[data-surface="chalk"]` with background `#262b28`,
  `soft-light` blending and an inset shadow (`head23.html:L375`).

### 16.5 Mip levels actually used

From the profile (all presets, warm render, each instance's `round(log2(cell / quad side))`):

| atlas (cell) | mip 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| dots (32 px) | 0.1 % | 15 % | 59 % | 24 % | 1 % | |
| knots (48 px) | | 0.4 % | 7 % | 46 % | 46 % | |
| pieces (32 px) | | 3 % | 13 % | 30 % | 43 % | 10 % |
| stars (64 px) | | 5 % | 85 % | 10 % | | |
| fgstars (96 px) | | 30 % | 68 % | 2 % | | |

Most dots are drawn from mip 2–3 (a 32-px cell shown at 4–8 px) and most knots from mip 3–4. Because
the mip chain is built over the whole sheet and the quad's UVs reach the cell's edges, these levels mix
neighbouring cells (section 20, item 3).

---

## 17. `render()`, frame by frame

`render()` (`app23.js:L1220–1315`), called by `req()` on the next animation frame
(`app23.js:L1316`), by `__GEN.set` and `__GEN.preset` directly, by the timeline on every animation
frame while playing (`app23.js:L1656–1662`), and twice by the SVG export (`app23.js:L1157`).

1. Return if textures are still loading (`pending`). Force `P.unwrap = 0`. Refresh the recipe cards
   (DOM).
2. Size the canvas to `clientWidth × min(2, dpr)` (reassigning `width`, which reallocates the drawing
   buffer every frame), clear, set blending (`app23.js:L1224–1226`).
3. `VIEW.scale = 84·ZOOM`; `USED`, `WARPS` reset; `VAR = makeVariation()`; `PEN.line = pen`,
   `PEN.dot = 0.75 + 0.1·pen` (`app23.js:L1227`).
4. The subject (`app23.js:L1229–1279`):
   - **star or artefact:** `starSprites()`, `parts` (galaxy drawings cleared: the sky, trails, arrow,
     jet and streams survive);
   - **merger:** section 11.4, then the lens and shells if on;
   - **galaxy:** `generate()`, `curves()`, `lensSprites10` if `lensOn`, `shellSprites` and
     `shellArcs` if `shellsOn`, `buildCurves`, `parts`, the lensed drawings from `LENSQ`, weak lensing
     if `LENSWL`.
5. `overlaySprites(S)` (`app23.js:L1280`).
6. Pack `V` into a `Float32Array`; expand `L.bg` and `L.front` (`app23.js:L1281–1284`).
7. `L.sstars = S.rstars`; expand every vector atlas in `MAGNIFIED` order into `VLa`, `VD`, `VB`, and
   empty those lists (`app23.js:L1285–1288`).
8. `scene()` once or four times (plates).
9. `STATS` and the DOM text (`app23.js:L1308–1314`). `STATS.dots` counts `old + disc + young` only (not
   background, vector or stream dots); `STATS.curves` is the main `C`, so 0 for mergers.

### Profiled cost of one frame (SwiftShader run, warm)

| stage | median | max (preset) |
| --- | --- | --- |
| `expandVector` (all calls) | 59 ms | 366 ms (Lens: galaxy cluster) |
| `generate` (all calls) | 32 ms | 74 ms |
| `lensSprites10` | 65 ms (8 presets) | 141 ms (cluster) |
| `lensSolver` | 32 ms | 59 ms |
| `buildSourceGalaxy` | 12 ms | 46 ms (8 calls) |
| `lensMarks` | 18 ms | 31 ms |
| `simulateMerger` (cold only) | 266 ms | 337 ms (Merger: long tails) |
| `shellSprites` (cold / warm) | 258 ms / 2.6 ms | |
| `mergerSprites` | 15 ms | 34 ms |
| `starSprites` | 3 ms | 6 ms (17 ms cold) |
| `parts` (incl. `skyParts`) | 1.5 ms | 5 ms (Deep field) |
| `buildCurves` | 0.7 ms | 15 ms (lensed curves) |
| `makeVariation`, `curves`, `dustLanes`, `buildSky` | < 1 ms each | 1.5 ms |
| `drawSprites` (CPU side, all calls) | 1.8 ms | 7 ms |
| `drawRibbons` (CPU side, all calls) | 1 ms | 75 ms (cluster: ~2 M vertices uploaded) |
| `render()` inclusive | 124 ms | 698 ms (cluster) |
| wall time including SwiftShader rasterisation | 616 ms | 2,200 ms (cluster); 1,932 ms (Plates slipped) |

`render()`'s self time (what is not in a wrapped stage) is 1–20 ms for stars and single galaxies
(array packing, DOM), 27–64 ms for mergers (the tidal grids) and about 90 ms for the cluster (weak
lensing, and packing some 10 million floats).

---

## 18. Sizes and costs across presets

Seed 7, 800 × 800, warm render. "instances" is the number of rows handed to `drawSprites` per pass;
"off-screen" those whose centre is more than 64 px outside the view; "vector marks" is the number of
`expandVector` calls. Timings: SwiftShader, CPU noisy.

| preset | dots | knots | drawn stars | instances | off-screen | pieces | stroke verts | solid verts | vector marks | `render()` CPU ms | wall ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Grand design | 8,133 | 136 | 1,570 | 9,248 | 413 | 24 | 1,320 | 357,282 | 1,604 | 124 | 659 |
| Barred spiral | 5,772 | 194 | 1,761 | 7,053 | 360 | 24 | 1,320 | 415,662 | 1,846 | 141 | 670 |
| Flocculent | 8,950 | 65 | 1,260 | 10,456 | 378 | 432 | 0 | 308,490 | 1,350 | 94 | 626 |
| Disc, no arms | 8,011 | 0 | 1,016 | 9,218 | 494 | 0 | 480 | 224,754 | 1,031 | 81 | 510 |
| Smooth, round | 7,785 | 0 | 720 | 8,994 | 966 | 0 | 0 | 162,630 | 733 | 56 | 403 |
| Edge-on with dust | 3,401 | 122 | 298 | 4,947 | 329 | 0 | 2,292 | 111,444 | 422 | 70 | 313 |
| Merger: the Mice | 7,592 | 318 | 1,206 | 9,176 | 248 | 18 | 900 | 330,174 | 1,266 | 233 | 666 |
| Merger: dry (two ellipticals) | 7,850 | 0 | 140 | 8,764 | 334 | 0 | 0 | 35,310 | 152 | 96 | 428 |
| Layered: ringed galaxy, ghost reflection | 19,085 | 296 | 1,905 | 20,433 | 116 | 24 | 1,320 | 445,206 | 1,988 | 126 | 1,116 |
| Star: bright, with spikes | 12,558 | 231 | 5 | 15,349 | 384 | 0 | 0 | 8,874 | 32 | 18 | 501 |
| Artefact: cosmic rays | 5,383 | 60 | 1 | 8,002 | 384 | 0 | 0 | 8,130 | 28 | 8 | 243 |
| Lens: Einstein ring | 11,910 | 131 | 1,920 | 14,003 | 647 | 451 | 864 | 603,504 | 2,066 | 244 | 1,016 |
| Lens: Einstein cross (quasar) | 13,280 | 315 | 1,506 | 15,072 | 492 | 45 | 6,420 | 469,284 | 1,613 | 147 | 923 |
| Lens: galaxy cluster | 14,029 | 1,070 | 4,228 | 20,158 | 1,727 | 825 | 27,648 | 1,948,986 | 4,945 | 698 | 2,200 |
| Deep field | 8,886 | 0 | 401 | 12,593 | 1,517 | 0 | 0 | 103,980 | 441 | 45 | 446 |
| Shell galaxy | 14,067 | 0 | 397 | 15,380 | 449 | 0 | 960 | 93,414 | 414 | 78 | 563 |
| Plates slipped (per pass; drawn 4×) | 7,577 | 161 | 1,525 | 8,718 | 412 | 16 | 1,320 | 345,654 | 1,559 | 159 | 1,932 |
| **min over 45** | 3,401 | 0 | 1 | 4,947 | | 0 | 0 | 7,176 | 24 | 8 | 243 |
| **median over 45** | 7,850 | | | 9,176 | | | | 336,102 | | 124 | 616 |
| **max over 45** | 19,085 | 1,070 | 4,228 | 20,433 | 1,727 | 825 | 27,648 | 1,948,986 | 4,945 | 698 | 2,200 |

Cold renders (first render with a parameter set) add the merger simulation (210–340 ms) or the shell
simulation (≈ 250 ms). The first preset of a run also pays for JIT warm-up. The full per-preset data,
including the per-atlas instance counts, the draw log in order and the caller-to-callee edges, is in
the JSON.

Observations that matter for the port:

- **Drawn stars dominate the geometry**: about 215 solid vertices each, so 1,000–2,000 per galaxy
  produce 220,000–440,000 vertices, far more than the stipple's 8,000–20,000 quads.
- `expandVector` is the biggest CPU stage almost everywhere; `generate` is second.
- 0.6–12 % of instances are off-screen (most for Deep field and the cluster, whose background galaxies
  spill over the edges, and for Smooth, round, whose halo is not truncated, section 20 item 7).

---

## 19. Global state and order dependence

The engine is a set of functions over shared mutable globals. A reimplementation must make all of these
explicit.

| global | what it is | written by | swapped temporarily by |
| --- | --- | --- | --- |
| `P` | the parameters | UI, presets, `fromVotes`; `render` forces `unwrap` 0 | `buildSourceGalaxy` (`app23.js:L632`, `app23.js:L643`), merger galaxies (`app23.js:L1246`, `app23.js:L1256`), `overlaySprites` mutates `subject`, `artefact`, `starBright`, `seed`, `_ov` in place (`app23.js:L457–464`) |
| `VAR` | per-galaxy variation | `render` (`app23.js:L1227`) | the same two |
| `VIEW.scale`, `VIEW.cx/cy` | zoom and centre | `render` | scale: the same two; centre: `overlaySprites` |
| `SM` | screen map (wobble, tides) | — | `buildSourceGalaxy` (identity), merger galaxies (tidal) |
| `SEAMMAX` | tear threshold for ribbons | merger galaxies (30, then 0) | |
| `PEN`, `ZOOM` | pen weight, zoom | `render`, UI | |
| `USED`, `WARPS` | used drawings, warp table | reset in `render`, appended everywhere | |
| `LENSQ`, `LENSWL` | lensed drawings, weak-lensing model | `lensSprites10`, consumed by `render` | |
| `LHOME`, `OVHOME`, `OVT`, `OVG` | home orientations; overlay hand-offs | `homeFor`, `overlaySprites` | |
| `MCACHE`, `SCACHE`, `SKY`, `LANES`, `CLOUDS` | single-entry caches | their stages | overwritten by nested galaxies |
| `REC` | SVG recording | `exportSVG` | |
| `STATS` | the facts row | `render` | |

Only `overlaySprites` restores with `try/finally`. An exception inside `buildSourceGalaxy` or the
merger loop would leave `P`, `VAR`, `VIEW.scale` and `SM` swapped for every later frame.

Order dependence, summarised:

1. **Sequential streams with variable consumption** everywhere: a change to any parameter that changes
   how many values a stage draws (a rejection, a conditional draw, a count) re-rolls everything after it
   in that stage, but not other stages (each has its own seed).
2. **Screen-space decisions inside streams**: lane thinning and dust carving in `generate`, so the
   camera changes the stipple (section 20, item 1). Merger galaxies are immune because they are built
   face-on.
3. **Screen-space decisions after streams**: breathing room, sky visibility, off-screen culls in
   `skyParts`, ribbon tearing in mergers, the 22-px and 1.8× drops in warped vector expansion.
4. **History**: `homeFor` (item 2 below); the caches are keyed, so they do not change results (except the
   `LANES` key, which misses `patchy`).
5. **Floating point and transcendental functions**: `hash2` relies on `Math.sin` at large arguments;
   `vnoise` on `Math.floor` of the same; `atanh`, `Math.cbrt`, `Math.exp` and `Math.log` everywhere.
   The merger and shell integrators are long f64 loops whose results are chaotic in the initial
   conditions.

---

## 20. Things that look like bugs or surprises (flagged, not fixed)

Each item was checked against the code, and those marked **verified** were also reproduced in the
browser (`checks` in the profile JSON, or the probes noted).

1. **Orbiting re-rolls the stipple when dust lanes are on** (the default `dustScribble` 0.5).
   `inLane(q)` (`app23.js:L196`) tests the *projected* position against the projected lane points, and
   the `continue` at `app23.js:L265` skips the rest of the proposal, including its later draws, so the
   whole `mulberry32` stream from that point on shifts. **Verified:** Grand design, seed 7, `az` 0° →
   0.3° changes knots 136 → 162, dots 8,133 → 8,119 and drawn stars 1,570 → 1,564; with
   `dustScribble` 0 the counts stay fixed (7,737 / 152 / 1,566 at both angles) apart from tiny changes
   from the screen-space breathing room. The `dustLines` test (`app23.js:L264`) has the same problem.
   Over all presets, a 5° orbit changed the counts of every galaxy and merger preset.
2. **`render()` is not a pure function of `P`.** `homeFor` (`app23.js:L444–451`) remembers the camera
   when a key is first seen, so lensed sources and overlays depend on navigation history. **Verified:**
   Lens: giant arc at `az` 40° gives 8,895 dots, 0 knots and 401 drawn stars when reached as "preset,
   then orbit", but 11,760 dots, 83 knots and 1,520 drawn stars after nudging `lensSrc` and putting it
   back while at 40° (the home is re-recorded at 40°). Repeating the first sequence afterwards gives the
   second result, because the key is unchanged and the home stays at 40°: the same calls produce
   different pictures depending on what was rendered before.
3. **Atlas mipmaps bleed between cells.** Each sheet is one 2D texture mipmapped as a whole with no
   padding between cells (`app23.js:L1100–1107`), and the sprite UVs run exactly to the cell's edges
   (`app23.js:L1095`). **Verified (sizes):** 59 % of dots are drawn at about mip 2 and 24 % at mip 3
   (a 32-px cell at 4–8 px); 92 % of knots at mip 3–4; 53 % of pieces at mip 4–5 (section 16.5). At
   those levels a texel spans 4–32 source pixels, so trilinear filtering reaches into the neighbouring
   drawings. (Mip ~3 would overstate it for dots: the dot's *ink* is ~3 px, but the quad is 8–10 px,
   because `dotSprite` (`app23.js:L81`) sizes the quad at about 40/size times the ink.)
4. **`hash2` depends on the engine's `sin` at large arguments**: `fract(sin(127.1x + 311.7y)·43758.5453)`
   (`app23.js:L73`). Arguments reach about 3 × 10⁶ (`vnoise` is fed `P.seed`, up to 9,999, as a
   coordinate offset), where `sin` implementations differ in the last bits and the ×43758 amplifies them.
   WGSL's `sin` is not specified to be accurate there at all.
5. **Dead code** (each checked by searching for every use):
   - `lensSprites` (`app23.js:L556–591`) is never called; `lensSprites10` replaced it.
   - `dustClouds` and `CLOUDS` (`app23.js:L922–940`) are never called.
   - `sflat` (`app23.js:L1031`) is computed and never used.
   - `if (P.lines > 0 || true)` (`app23.js:L1269`) is always true.
   - `P.unwrap` is forced to 0 at the start of every render (`app23.js:L1222`), but the log-polar code
     paths remain in `SM` (`app23.js:L165–167`), `seam` (`app23.js:L170`), `buildCurves`
     (`app23.js:L833`) and the `unwrapnote` (`app23.js:L1312`).
   - The overlay trail branch in `starSprites` (`P._ov && OVT`, `app23.js:L424`) is dead:
     `overlaySprites` sets `OVT = null` before calling `starSprites` (`app23.js:L461`), and nothing
     ever sets it to anything else (`app23.js:L444`).
   - `P.mFit` is read (`app23.js:L515`) but is not in `DEF`, has no control, and is never set.
   - In `render`'s merger branch, `keep` (`app23.js:L1233`), `nCore` and `rc` (`app23.js:L1258`) are
     unused; `mergerSprites`' `xs`/`ys` (`app23.js:L501`) and its returned `cores` (`app23.js:L552`)
     are unused; `base` in `generate` (`app23.js:L263`) and `prev` in `dustLanes` (`app23.js:L967`,
     `app23.js:L973`) are unused.
   - `curves(r)` ignores its argument (`app23.js:L771`), so the `mulberry32(P.seed * 31 + 5)` built by
     its callers (`app23.js:L635`, `app23.js:L1250`, `app23.js:L1268`) is never used.
   - The `MAGNIFIED` edge thresholds (`app23.js:L1124`) never apply: every atlas in `MAGNIFIED` is a
     vector atlas with no texture, expanded and emptied before drawing (`app23.js:L1287`).
6. **The fragment shader uses `precision mediump float`** (`app23.js:L1092`). Where mediump is really
   16-bit (many mobile GPUs), `vUV` has 11 bits of mantissa: near v = 1 on the 3,840-px strokes sheet
   that is about 1.9 texels, more than the 1.3-texel inset between stroke rows (`app23.js:L829`), and
   ribbon `u` values of 2–4 lose a texel of the 512-px stroke. Desktop GPUs usually run mediump at
   32 bits, so the problem would only show on some devices.
7. **`RMAX` is declared twice at the top of the IIFE**: `var H = 1.0, RMAX = 4.2` (`app23.js:L121`) and
   `var SKY = …, RMIN = 40, RMAX = 240, …` (`app23.js:L857`). The second assignment runs at load time, so
   `RMAX` is 240 for every render (**verified** with the profiler's probe). The galaxy truncations meant
   for 4.2 never fire: disc (`app23.js:L249`, `app23.js:L254`; the disc proposal puts 7.8 % of its mass
   beyond 4.2), halo (`app23.js:L240`; 3.5 % beyond 4.7), Sérsic (`app23.js:L225`) and shells
   (`app23.js:L743`). Stars therefore reach 20 units (1,700 px) out; some are visible between 4.2 and
   the canvas edge (4.76 units), the rest are off-screen instances (966 for Smooth, round).
8. **The breathing room compares positions in two different spaces.** `inst` applies `SM` to bitmap
   marks only (`app23.js:L171`), while the bright drawn stars that clear them are vector rows and are
   recorded *before* `SM` (`app23.js:L190–191`). The clearing (`app23.js:L275–280`) therefore compares
   warped dots with unwarped stars whenever `SM` is not the identity: in every merger galaxy (the tidal
   warp, `app23.js:L1248`) and with `distort` (up to ±13 px per unit of `distort`, `app23.js:L163`). It
   also runs before the ring-knot and clump drawn stars are added (`app23.js:L288`, `app23.js:L296`), so
   those clear nothing.
9. **Merger work that is thrown away.** `mergerSprites` builds bulge stipple round each core
   (`app23.js:L529–535`, up to ~2,500 dots per core) into `MS.S.old`, which `render` never reads
   (`app23.js:L1236`); 84 % of the simulated disc stars it classifies are then dropped
   (`app23.js:L1237`). `STATS.curves` is 0 for every merger (`C = []`, `app23.js:L1232`) although
   both galaxies draw curves.
10. **Vector marks ignore their alpha.** `expandVector` writes alpha 1 into every ribbon vertex and every
    dot and blob (`app23.js:L1212`, `app23.js:L1216`, `app23.js:L1218`), so the drawn ring placed at
    alpha 0.55 "so the ring reads as stars first" (`app23.js:L1027`) is drawn at full strength.
11. **Single-entry caches thrash.** `SKY` (`app23.js:L868`) and `LANES` (`app23.js:L945`) hold one key
    each, and merger galaxies and lensed source galaxies run `parts()` and `generate()` with their own
    seeds, so in those presets the main galaxy's sky and lanes are rebuilt every frame (`buildSky` runs
    3 times per Mice render, `dustLanes` 18 times per cluster render). The `LANES` key also misses
    `P.patchy`, which changes `VAR.lop` (`app23.js:L116`) and so the lane positions: after changing
    `patchy` through `__GEN.set` the hatching is stale (it has no UI control). `dustLanes` is keyed on
    the camera, so it is recomputed on every orbit anyway.
12. **The edge-on midplane stroke uses `incl`, not `incE()`, for its alpha**: `a: P.lines·(P.incl −
    72)/18` (`app23.js:L788`), so for inclinations between 90° and 100°, reachable by dragging
    (`app23.js:L1849`), the alpha exceeds `lines` and can exceed 1.
13. **Two shears on the deep field of a cluster.** `skyParts` already stretches background drawings
    tangentially when the subject is `massive` (`app23.js:L902`), and the cluster then applies the real
    weak-lensing Jacobian on top (`app23.js:L1273–1278`). In a merger that lenses, `LENSWL` is computed
    by the cluster branch but never applied, because weak lensing exists only in the non-merger branch
    (`app23.js:L1265` vs `app23.js:L1273`).
14. **Sérsic galaxies and shells are 2D.** The Sérsic component (`app23.js:L223–233`) ignores `incl` and
    `az` (it uses only `bulgeFlat` and `pa`), and the shell stipple and arcs (`app23.js:L741–747`,
    `app23.js:L750–760`) ignore `incl`, `az` *and* `pa`. Rolling the camera on Shell galaxy turns the
    host but not its shells; orbiting a lens's elliptical host changes only its halo and the sky.
15. **Screen-fixed things in a 3D scene.** The hand wobble (`distort`) is a noise field in screen
    coordinates (`app23.js:L163`), so the galaxy slides through it when orbited or zoomed. Trails,
    cosmic-ray marks and the arrow are placed at fixed 800-px positions (`app23.js:L1041–1042`,
    `app23.js:L1052`), ignoring `ZOOM`.
16. **Per-frame waste in the renderer.** The canvas `width` is reassigned on every render
    (`app23.js:L1225`), which reallocates and clears the drawing buffer even when the size is unchanged;
    every draw call re-uploads its buffer and looks up every uniform location (`app23.js:L1112–1139`);
    the timeline re-runs the whole `render()` on every animation frame (`app23.js:L1656–1662`).
17. **`drawSprites` assumes 8-column rows.** It packs with `d.set(row, k·8)` into an array of exactly
    `8·rows` floats (`app23.js:L1115–1116`). A row with a pen-scale or warp column would overwrite the
    next row's `x`, or throw a `RangeError` if it were last. It is safe today only because every such
    row belongs to a vector atlas and is expanded before drawing.
18. **Correlated streams from shared seeds.** `P.seed * 431 + 9` drives both the dust-carving pen lines
    (`app23.js:L201`) and the cluster's members (`app23.js:L595`); `seed * 977 + 3` both the overlay
    artefact's placement (`app23.js:L460`) and the shell simulation (`app23.js:L714`). The streams are
    identical, so those choices are not independent. Harmless today, but worth not copying.
19. **The disc's arm acceptance gives up after 30 tries and keeps the last proposal**
    (`app23.js:L248–253`), rejected or not. With the defaults the chance is below 0.8³⁰ ≈ 0.1 %, but
    with `armStrength` near 1 and a strong `patchy` the inter-arm gaps and patchy holes are filled a
    little more than the profile says.
20. **Nested galaxies inherit unexpected parameters.** `buildSourceGalaxy` copies the main `P` and
    overrides only a listed set (`app23.js:L632–633`), so a lensed source inherits, for example,
    `streams`, `bubbles`, `starMix`, `dustLines`, `patchy`, `dust`, `thick` and `stroke` from the lens
    preset. `mergerGalaxyParams` (`app23.js:L383`) likewise passes `dust`, `dustLines`, `streams`,
    `bubbles` and `patchy` through from the main `P`. For the shipped presets these are mostly zero, so
    the effect is latent.
21. **Without a `try/finally`, an exception in a nested build corrupts every later frame**
    (`app23.js:L630–645`, `app23.js:L1241–1257`; only `overlaySprites` restores safely,
    `app23.js:L457–464`).
