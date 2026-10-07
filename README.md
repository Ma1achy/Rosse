<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/banner-dark.png">
  <img src="docs/img/banner.png" alt="Rosse: galaxies, drawn by hand. A barred spiral on Paper, a grand-design spiral on Chalkboard, both drawn by the engine." width="100%">
</picture>

</div>

<br>

**Rosse** is a galaxy-drawing engine. Every mark it puts on the page comes from a library of real hand drawings: dots, strokes, knots, stars and whole galaxies, drawn with a fineliner, scanned and cut out. The engine builds each galaxy in three dimensions, then places, transforms and inks those drawings onto Paper or Chalkboard.

This repository is the rebuild of Rosse v21 (a single HTML page, kept in `assets/reference/` as the oracle) on **WebGPU and WGSL**, with a matching CPU engine for browsers that have no WebGPU. Every picture on this page, the banner's galaxies included, was drawn by this engine, not by v21.

| principle | in practice |
| --- | --- |
| **Hand-drawn, never procedural** | There is no generated mark. Dots, knots, strokes, cores, stars and 156 whole galaxies are scanned pen drawings; the engine only chooses where they go, how they are turned and how heavy the pen is. |
| **On the GPU** | Sampling, projection, culling, stroke expansion and merger integration run in WGSL compute passes. The CPU builds a small scene description and nothing is read back on the frame path. |
| **A CPU twin for every kernel** | Without WebGPU, TypeScript twins of the kernels run with the same random numbers, f32 arithmetic and a software rasteriser, and agree with the GPU within tolerance (`npm run test:gpu`). |
| **Deterministic** | A counter-based RNG keyed by seed, stream and index. The same seed gives the same galaxy, and orbiting the camera never re-rolls the marks. |
| **Measured against v21** | Parity is statistical (same structure, ink, pen weight and mark counts, not the same dots) and is tested against 582 captures of v21 with a calibrated metric. |

<br>

## An atlas

Every picture below was drawn by this engine, on SwiftShader (software WebGPU), at a fixed seed. The pictures are plates in the sense of an atlas: numbered, captioned, laid on a grid. Every galaxy, seed, parameter and camera path is in [`tools/readme-assets/plan.mjs`](tools/readme-assets/plan.mjs), and one command re-draws all of them (see [Regenerating](#regenerating-the-pictures)). The colour you see is the engine's own (the colour plates); nothing is added.

<br>

### Galaxies from the Zoo

[Galaxy Zoo 2](https://data.galaxyzoo.org/) asked volunteers a tree of questions about 239,695 SDSS galaxies. For each kind of galaxy in the catalogue's own list (smooth, spiral, barred, edge-on, merger, ring, irregular, many arms, tight arms, loose arms), these are the galaxies with the **highest vote fraction** for the question that defines it. Rosse draws each one from its votes alone (`fromVotes`), at the seed its object id gives, with the bars showing the votes it was given.

<img src="docs/img/gz2/overview.jpg" alt="Fig. 01: ten galaxies from Galaxy Zoo 2, one for each kind, drawn by Rosse from the volunteers' votes" width="100%">

Ties are common (a fraction of 1.00 is easy to reach), so the choice is: the highest fraction, then the most volunteers, then the lowest object id. The rule is written out in `GZ2_RULES` in the plan, and the choices (with their votes and parameters) are recorded in [`gz2-picks.json`](tools/readme-assets/gz2-picks.json).

<table>
<tr>
<td width="50%"><img src="docs/img/gz2/spiral.jpg" alt="Fig. 01.2: the spiral with the highest vote fraction, drawn by Rosse, with its votes"></td>
<td width="50%"><img src="docs/img/gz2/barred.jpg" alt="Fig. 01.3: the barred galaxy with the highest vote fraction"></td>
</tr>
<tr>
<td><img src="docs/img/gz2/ring.jpg" alt="Fig. 01.6: the ring galaxy with the highest vote fraction"></td>
<td><img src="docs/img/gz2/merger.jpg" alt="Fig. 01.5: the merger with the highest vote fraction"></td>
</tr>
<tr>
<td><img src="docs/img/gz2/edge-on.jpg" alt="Fig. 01.4: the edge-on galaxy with the highest vote fraction"></td>
<td><img src="docs/img/gz2/many-arms.jpg" alt="Fig. 01.8: the galaxy with the most arms by vote fraction"></td>
</tr>
</table>

<details>
<summary>The other four: smooth, irregular, tight arms, loose arms</summary>

<table>
<tr>
<td width="50%"><img src="docs/img/gz2/smooth.jpg" alt="Fig. 01.1: the smooth galaxy with the highest vote fraction"></td>
<td width="50%"><img src="docs/img/gz2/irregular.jpg" alt="Fig. 01.7: the irregular galaxy with the highest vote fraction"></td>
</tr>
<tr>
<td><img src="docs/img/gz2/tight-arms.jpg" alt="Fig. 01.9: the tightest-armed spiral by vote fraction"></td>
<td><img src="docs/img/gz2/loose-arms.jpg" alt="Fig. 01.10: the loosest-armed spiral by vote fraction"></td>
</tr>
</table>

</details>

#### Photograph and drawing

The catalogue has votes but no pictures. The asset pack does have the SDSS photographs of 42 real galaxies, so here they are side by side with Rosse's drawing of each, drawn from the same votes. (Photograph: 160 px, enlarged.) Where a cutout of a catalogue galaxy is in [`docs/img/gz2/cutouts/`](docs/img/gz2/cutouts/), the plates above show it too; see [Regenerating](#regenerating-the-pictures).

<table>
<tr>
<td width="50%"><img src="docs/img/real/15.jpg" alt="Fig. 02: a barred spiral, SDSS photograph and Rosse's drawing"></td>
<td width="50%"><img src="docs/img/real/10.jpg" alt="Fig. 02: a ringed disc, SDSS photograph and Rosse's drawing"></td>
</tr>
<tr>
<td><img src="docs/img/real/06.jpg" alt="Fig. 02: an edge-on disc with a dust lane, photograph and drawing"></td>
<td><img src="docs/img/real/12.jpg" alt="Fig. 02: a two-armed spiral, photograph and drawing"></td>
</tr>
</table>

<details>
<summary>Ten more pairs</summary>

<table>
<tr>
<td width="50%"><img src="docs/img/real/00.jpg" alt="a round elliptical, photograph and drawing"></td>
<td width="50%"><img src="docs/img/real/03.jpg" alt="a cigar-shaped elliptical, photograph and drawing"></td>
</tr>
<tr>
<td><img src="docs/img/real/41.jpg" alt="an edge-on disc, photograph and drawing"></td>
<td><img src="docs/img/real/08.jpg" alt="a spiral with a ring, photograph and drawing"></td>
</tr>
<tr>
<td><img src="docs/img/real/19.jpg" alt="a three-armed barred spiral, photograph and drawing"></td>
<td><img src="docs/img/real/26.jpg" alt="a four-armed barred spiral, photograph and drawing"></td>
</tr>
<tr>
<td><img src="docs/img/real/23.jpg" alt="a spiral, photograph and drawing"></td>
<td><img src="docs/img/real/27.jpg" alt="a six-armed spiral, photograph and drawing"></td>
</tr>
<tr>
<td><img src="docs/img/real/37.jpg" alt="an irregular galaxy, photograph and drawing"></td>
<td><img src="docs/img/real/34.jpg" alt="two galaxies merging, photograph and drawing"></td>
</tr>
</table>

</details>

<br>

### Every preset

All 45 presets of [`src/core/presets.ts`](src/core/presets.ts), as the page draws them at seed 7. The sheet is made from the preset list itself, so a new preset appears in it the next time the pictures are regenerated.

<img src="docs/img/figures/presets.jpg" alt="Fig. 03: a contact sheet of all 45 presets: spirals, ellipticals, mergers, stars, artefacts, lenses, the deep field and more" width="100%">

<br>

### In motion

Each film is a camera path through the engine's own camera (azimuth, inclination, roll, zoom), eased, timed, and looped where it can be. The marks are fixed in three dimensions, so nothing is re-rolled as the camera moves.

<table>
<tr>
<td width="50%"><img src="docs/img/gifs/spiral-orbit.gif" alt="Fig. 04: a spiral galaxy on the Chalkboard, turning once with the camera pushing in and out"><br><sub><b>04</b> &nbsp;ORBIT, SPIRAL<br>one turn; inclination 40 to 52 degrees; a slow push-in</sub></td>
<td width="50%"><img src="docs/img/gifs/edge-on-orbit.gif" alt="Fig. 05: an edge-on galaxy with a dust lane, the camera opening the disc and closing it again"><br><sub><b>05</b> &nbsp;ORBIT, EDGE-ON<br>the disc opens from 84 to 62 degrees and closes</sub></td>
</tr>
<tr>
<td><img src="docs/img/gifs/morph.gif" alt="Fig. 08: a barred spiral changing shape as its pitch, bar and arm width are swept"><br><sub><b>08</b> &nbsp;A GALAXY MORPHING<br>one seed; pitch, bar and arm width swept</sub></td>
<td><img src="docs/img/gifs/breathe.gif" alt="Fig. 07: the same spiral printed in one ink, then in slipped colour plates, then in population colours"><br><sub><b>07</b> &nbsp;THE PLATES BREATHING<br>one ink, slipped plates, population colours</sub></td>
</tr>
<tr>
<td colspan="2" align="center"><img src="docs/img/gifs/surfaces.gif" alt="Fig. 06: a line sweeping across a spiral, Chalkboard on its left and Paper on its right" width="50%"><br><sub><b>06</b> &nbsp;PAPER AND CHALKBOARD<br>one set of marks, two surfaces; only the last, cheap pass changes</sub></td>
</tr>
</table>

<br>

### Up close

The pen keeps its weight at any zoom, so a mark is always a mark. At the deepest zoom the nucleus resolves into the scanned core drawings it is made of, and a star into its drawn heart.

<img src="docs/img/figures/pen.jpg" alt="Fig. 09: one tightly wound spiral at three zooms, ending in individual hand-drawn core marks" width="100%">

<img src="docs/img/figures/star-zoom.jpg" alt="Fig. 10: a bright star at three zooms, from its spikes to its drawn heart" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/img/gifs/pen-dive.gif" alt="Fig. 11: the camera pushing in on the nucleus of a spiral to nine times, then back"><br><sub><b>11</b> &nbsp;PUSHING IN<br>x1.5 to x9 on the nucleus and back</sub></td>
<td width="50%"><img src="docs/img/gifs/star-dive.gif" alt="Fig. 12: the camera pushing in on a bright star from the whole star to its heart, then back"><br><sub><b>12</b> &nbsp;PUSHING IN ON A STAR<br>spikes, rings, then the drawn heart</sub></td>
</tr>
</table>

<br>

### By layers

A galaxy is a pile of kinds of mark, laid in a fixed order. Here is one galaxy, with each layer added in turn: dots, knots, strokes, drawings (pen lines and whole drawings), drawn stars and cores, and the sky.

<img src="docs/img/figures/anatomy.jpg" alt="Fig. 13: one spiral in six stages, from dots alone to every layer and the sky" width="100%">

<table>
<tr>
<td width="50%" align="center"><img src="docs/img/gifs/anatomy.gif" alt="Fig. 14: the same spiral drawn in layer by layer, each spreading from the centre outwards, while the camera drifts"><br><sub><b>14</b> &nbsp;DRAWN IN<br>each layer spreads from the centre; the camera drifts</sub></td>
</tr>
</table>

<br>

### Lenses

A lens is a galaxy (or a cluster) in front of a source: the source's drawing is bent into rings, arcs and images. The source can be a galaxy, a quasar or one of the owner's hand drawings (Fig. 36.6).

<img src="docs/img/figures/lenses.jpg" alt="Fig. 15: six lens presets: an Einstein ring, a double ring, a quasar cross, a quad, a cluster with arcs and a giant arc" width="100%">

<img src="docs/img/figures/lens-offset.jpg" alt="Fig. 16: the same lens with the source at three offsets: a full ring, an arc and two images" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/img/gifs/lens-ring.gif" alt="Fig. 17: an Einstein ring breaking into an arc and closing again as the source moves, with the camera pushing in"><br><sub><b>17</b> &nbsp;EINSTEIN RING<br>the source drifts: ring, arc, two images, ring</sub></td>
<td width="50%"><img src="docs/img/gifs/lens-quasar.gif" alt="Fig. 18: the four images of a lensed quasar circling the cross as the source circles"><br><sub><b>18</b> &nbsp;EINSTEIN CROSS<br>a quasar: four images follow the source round</sub></td>
</tr>
<tr>
<td colspan="2" align="center"><img src="docs/img/gifs/lens-double.gif" alt="Fig. 19: a double Einstein ring: two rings that part and close again as one source drifts, with the camera pushing in" width="50%"><br><sub><b>19</b> &nbsp;DOUBLE EINSTEIN RING<br>two sources behind one lens</sub></td>
</tr>
</table>

<br>

### Mergers

Mergers are simulated: a core track integrated on the CPU and test stars moved by the GPU, with the tides stretching the discs into tails. The merger's own timeline (`mTime`) runs from the approach to the settled remnant; each film below moves the camera with it.

<img src="docs/img/figures/mergers.jpg" alt="Fig. 20: nine merger presets, from the Mice to sketches torn apart" width="100%">

<img src="docs/img/figures/merger-sequence.jpg" alt="Fig. 21: the Mice at six moments, from approach to the settled remnant with long tails" width="100%">

<table>
<tr>
<td width="50%"><img src="docs/img/gifs/merger-mice.gif" alt="Fig. 22: two spirals approaching, passing and throwing out tails, filmed by a camera that dollies in and then draws back"><br><sub><b>22</b> &nbsp;THE MICE<br>a dolly in on the approach, a turn at the close pass, a draw back as the tails form</sub></td>
<td width="50%"><img src="docs/img/gifs/merger-tails.gif" alt="Fig. 23: a merger with long tidal tails on the Chalkboard, the camera orbiting"><br><sub><b>23</b> &nbsp;LONG TAILS<br>a slow orbit while the discs swing past</sub></td>
</tr>
<tr>
<td><img src="docs/img/gifs/merger-polar.gif" alt="Fig. 24: two discs at right angles colliding, the camera turning with them"><br><sub><b>24</b> &nbsp;POLAR COLLISION<br>discs at right angles</sub></td>
<td><img src="docs/img/gifs/merger-torn.gif" alt="Fig. 25: whole hand drawings stretched and torn by the tides"><br><sub><b>25</b> &nbsp;SKETCHES, TORN APART<br>whole drawings, torn by the tides</sub></td>
</tr>
</table>

Shells are what a minor merger leaves behind: faint arcs round a smooth galaxy, simulated and then drawn.

<img src="docs/img/figures/shells.jpg" alt="Fig. 26: a shell galaxy at three times: a sharp edge, spreading shells and wide faint shells" width="100%">

<table>
<tr>
<td width="50%" align="center"><img src="docs/img/gifs/shells.gif" alt="Fig. 27: the shells of a shell galaxy forming and spreading"><br><sub><b>27</b> &nbsp;SHELLS FORMING<br>shellTime 12 to 90, with a slow turn</sub></td>
</tr>
</table>

<br>

### The sky

Behind and in front of every galaxy there is sky: a deep field of small drawn galaxies, foreground stars with their spikes, rings and glare, and the faults of a real exposure (a satellite trail, a ghost reflection, cosmic rays). All of it is drawn from the same library of pen marks.

<img src="docs/img/figures/sky.jpg" alt="Fig. 28: the deep field: hundreds of small drawn galaxies round a central elliptical" width="100%">

<table>
<tr>
<td width="50%" align="center"><img src="docs/img/gifs/deep-field.gif" alt="Fig. 29: a slow glide over the deep field on the Chalkboard, turning the sky"><br><sub><b>29</b> &nbsp;THE DEEP FIELD<br>a long glide; the sky turns with the camera</sub></td>
</tr>
</table>

<img src="docs/img/figures/stars.jpg" alt="Fig. 30: six stars: the preset, a plain heart, long spikes, rings, glare and a faint one" width="100%">

<img src="docs/img/figures/artefacts.jpg" alt="Fig. 31: a satellite trail, a ghost reflection, cosmic rays and other seeds of each" width="100%">

<img src="docs/img/figures/layered.jpg" alt="Fig. 32: layered presets: a spiral beside a bright star, a barred spiral with a satellite trail, an edge-on with a star on top, a ringed galaxy with a ghost, a lensed merger" width="100%">

<img src="docs/img/figures/foreground.jpg" alt="Fig. 33: a spiral with no foreground, with foreground stars, and with stars and small companion galaxies" width="100%">

<br>

### Kinds of galaxy

<img src="docs/img/figures/arms.jpg" alt="Fig. 34: flocculent, tightly wound, loose, hand-drawn, dusty and armless discs" width="100%">

<img src="docs/img/figures/kinds.jpg" alt="Fig. 35: a ringed galaxy, a shell galaxy, a radio jet, stellar streams, a cigar-shaped and a round elliptical" width="100%">

<img src="docs/img/figures/hand.jpg" alt="Fig. 36: slipped colour plates, stellar populations, a wobbling hand, both on Paper and on Chalkboard, and a sketch lensed" width="100%">

<br>

### Regenerating the pictures

```sh
nice -n 15 npm run readme:assets                 # everything: banner, gallery, anatomy, gz2, gifs
nice -n 15 npm run readme:assets -- gz2          # one stage (banner, renders, gallery, anatomy, gz2, gifs)
nice -n 15 npm run readme:assets -- gifs --only=merger-mice
npm run readme:assets -- fetch-gz2               # the SDSS cutouts of the Galaxy Zoo 2 picks (needs the network)
npm run readme:check
```

Each stage re-draws only its own outputs, deterministically; the plan, the camera paths and the catalogue rule are in [`tools/readme-assets/`](tools/readme-assets/README.md) and [docs/readme-refresh.md](docs/readme-refresh.md). `fetch-gz2` downloads the SDSS cutout of each Galaxy Zoo 2 galaxy above once, into the repository; after that the plates show photograph and drawing together and regenerating needs no network.

<br>

## Run it

You need Node 22 or later and a browser with WebGPU for the GPU engine (any other browser draws on the CPU engine, and says so under the plate). To validate shaders you also need [naga](https://crates.io/crates/naga-cli) (`cargo install naga-cli`).

```sh
npm ci
npm run dev        # Vite dev server: the page (plate, controls, presets, timeline, exports)
```

The page has the plate on Paper or the Chalkboard, v21's controls as a recipe of cards, preset cards drawn by this engine, the merger's timeline, the 42 real galaxies with their photographs, the Galaxy Zoo 2 catalogue, and PNG, SVG (for pen plotters, one layer per pen) and GIF (the merger's timeline, a quasar's flare) export. Drag to orbit and tilt, shift-drag or Q/E to roll, wheel to zoom. A link holds the drawing: `?preset=` (or `?from=real:<n>`, `?from=gz2:<DR7 object id>`), `?seed=`, `?az=`, `?incl=`, `?pa=`, `?zoom=`, `?surface=paper|chalk`, any parameter by its name, and `?backend=cpu|webgpu`; for example `/?preset=Barred%20spiral&seed=11&backend=cpu`.

| command | what it does |
| --- | --- |
| `npm test` | unit tests (vitest) |
| `npm run test:gpu` | browser tests on WebGPU (SwiftShader): RNG vectors, CPU = GPU kernels and raster, the page's UI and extras smoke tests |
| `npm run golden` | the golden check against v21 (see below; slow) |
| `npm run lint`, `typecheck`, `validate:wgsl`, `build` | the other CI checks |
| `npm run readme:assets` | re-draws every picture on this page, by stage ([`tools/readme-assets`](tools/readme-assets/README.md); needs `ffmpeg` and ImageMagick) |
| `npm run readme:check` | fails if a README image is missing or a picture is over its size budget |
| `npm run screenshots` | screenshots of the plate on both surfaces and both engines |

The tools that drive a browser use Playwright's Chromium (`npx playwright install chromium`) with software rendering, so no GPU is needed.

<br>

## How it is built

```
parameters ──► schema: which tier is dirty?
                 │
  model dirty ───┼─► CPU  scene description (a few kB): variation, curves,
                 │        parts, merger core track
                 │   GPU  stipple samples · merger test stars · shells
  view dirty ────┼─► GPU  project + cull → scan → instances
                 │        curves → ribbons · vectors → capsules
  present ───────┴─► GPU  ink layers in v21's order → ink target
                          → composite: Paper | Chalkboard + plates
```

| tier | re-runs when | cost of an orbit frame |
| --- | --- | --- |
| **model** | a parameter that changes the galaxy | none |
| **view** | the camera or zoom moves | the view passes only |
| **present** | the surface or plates change | one composite pass |

- **Kernels with CPU twins.** Each compute kernel in [`src/shaders/compute/`](src/shaders/compute/) (`stipple`, `scan`, `project`, `ribbons`, `vector-expand`, `merger`, `merger-sprites`, `tide`, `shells`, and more) has a TypeScript twin in [`src/fallback/kernels/`](src/fallback/kernels/) and a parity test.
- **Two ink pipelines.** Instanced quads for bitmap drawings, and analytic capsule ribbons for pen lines, into an `rgba16float` ink target; the composite blends it onto Paper or Chalkboard.
- **Determinism.** A counter-based RNG (`pcg4d`), so each sample owns its randomness and no result depends on thread scheduling.
- **Deliberate differences from v21**: orbiting keeps the marks; integer-lattice noise replaces v21's `sin`-hash noise; drawings have separate mip chains. Listed in [docs/architecture.md](docs/architecture.md).

<br>

## Status

Each milestone is one reviewable pull request. The engine draws single galaxies, mergers, stars, artefacts and the sky, and lensing; the page and the extras are built on it. M0 to M12 are all built; M7, M9 and M12 are in the integration pull request (#15) and reach `main` with it.

| # | milestone | state |
| --- | --- | --- |
| M0 | Plan: reference notes, architecture, ADRs, v21 captures | merged |
| M1 | Paper and one bitmap mark; RNG, atlases, ink and composite | merged |
| M2 | Stipple disc from the model; the golden comparison harness | merged |
| M3 | Camera, orbit and zoom; the cache tiers | merged |
| M4 | Stroke ribbons and arms; dust lanes | merged |
| M5 | Vector marks: bars, rings, whole drawings, jets, streams | merged |
| M6 | The single-galaxy preset set; plates; Chalkboard | merged |
| M7 | Stars and artefacts; the sky | built (pull request #15) |
| M8 | Mergers and shell galaxies | merged |
| M9 | Lensing | built (pull request #15) |
| M10 | Performance pass: pooling, kept batches, the CPU engine in a worker, the profiling and L1 harnesses | merged; real-hardware numbers open |
| M11 | The page and its UI | merged |
| M12 | The extras: Galaxy Zoo 2 catalogue, real galaxies, SVG and GIF export | built (pull request #15), wired into the page |

Still open: everything that needs a real GPU (the budget table of [docs/architecture.md](docs/architecture.md), the L1 report on a second adapter, and recalibrating the golden thresholds, [Q14](docs/open-questions.md)); measurements on a phone; the licence ([Q1](docs/open-questions.md)) and the SDSS acknowledgement wording the page must show; and the owner's sign-off of the proposed ADRs (0035, 0036, 0061 among them).

Not yet proven: all parity numbers are measured on SwiftShader, a software adapter. Details per milestone are in [docs/roadmap.md](docs/roadmap.md) and [docs/milestones/](docs/milestones/).

<br>

## Testing

- **Unit tests** (vitest) cover the RNG vectors, schema and tiers, the scene description, camera maths, the WGSL resolver, struct layouts and the CPU kernels.
- **GPU tests** (`npm run test:gpu`) run the WGSL kernels and the CPU twins on the same input and compare them.
- **Golden images.** [`tests/golden/reference/`](tests/golden/README.md) holds 582 captures of v21 (ink, plate and parameters). Because v21 places dots from a sequential random stream and this engine from a parallel one, the dots land elsewhere by design, so plain pixel comparison would fail. The metric compares what must match: **total ink**, **structure** (SSIM of blurred density maps), **moments and extent**, **pen weight** (stroke widths from a distance transform) and **mark counts**, with thresholds calibrated from "same galaxy, other dots" re-draws and negative controls that must fail. The engine is also bit-exact against its own goldens on one adapter. See [tests/golden/README.md](tests/golden/README.md) and ADR [0013](docs/adr/0013-golden-image-metric.md) and [0015](docs/adr/0015-golden-metric-as-calibrated-in-m2.md).

<br>

## Documentation

| read | for |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | the WebGPU design, tiers, the hard parts and the ADR index |
| [docs/roadmap.md](docs/roadmap.md) | milestones M0 to M12 |
| [docs/reference-notes.md](docs/reference-notes.md) | how v21 works, stage by stage |
| [docs/open-questions.md](docs/open-questions.md) | decisions waiting for the owner |
| [assets/README.md](assets/README.md) | the asset pack: drawings, objects, fonts, data, and the reference page and source |
| [assets/reference/design-language/](assets/reference/design-language/DESIGN-LANGUAGE.md) | the design language this page borrows (Swiss grid, hairlines, cream paper) |
| [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) | how to contribute; what changed |

<br>

## Credits and licences

- **The drawings** are the owner's own pen drawings (dots, strokes, knots, stars, whole galaxies), scanned and cut out.
- **Galaxy Zoo 2.** The classifications behind the "Galaxies from the Zoo" plates and the real-galaxy pairs are from Galaxy Zoo 2 (Willett et al. 2013, MNRAS 435, 2835; Hart et al. 2016, MNRAS 461, 3663), the work of the volunteers of [galaxyzoo.org](https://www.galaxyzoo.org/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: each vote fraction is quantised to one byte and the catalogue is re-packed; the drawings are Rosse's, not Galaxy Zoo's or SDSS's.
- **SDSS.** The photographs of the 42 real galaxies (and any cutout fetched for the Galaxy Zoo 2 plates) are from the Sloan Digital Sky Survey. Funding for SDSS and its acknowledgement, as the survey publishes it: [sdss.org/collaboration/citing-sdss](https://www.sdss.org/collaboration/citing-sdss/). *The exact wording is the owner's to confirm and paste here (docs/readme-refresh.md).*
- **Fonts.** The banner is set in Heros (the files are TeX Gyre Heros, a Helvetica-like face) and IBM Plex Mono (SIL OFL 1.1, text in `assets/fonts/ibm-plex-mono/`). The handwriting fonts (Threshold Grain, Mark, Patina, Signs) are made from the owner's handwriting. Each keeps its own terms; they are listed in `assets/fonts/fonts.json`.
- **The project's licence is undecided.** Until the owner chooses one ([docs/open-questions.md](docs/open-questions.md), Q1), all rights are reserved; see [`LICENSE`](LICENSE). Third-party material in `assets/` remains under its own terms.
