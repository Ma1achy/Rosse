# M11: the page and UI

The page: a plate, Paper and Chalkboard, controls generated from the schema, preset cards, the merger timeline, PNG export, a link that holds the drawing, and the "drawn on the CPU" note. It follows the design language (`assets/reference/design-language/`): type, grid and hairlines on flat cream paper with grain, one filled button, 44 px targets, a magenta focus ring, a 1 px slider track with a square thumb, a red-pencil note only for a limit. The engines are not touched: the golden hashes are unchanged.

| Paper (Galaxy tab) | Chalkboard (Choose tab) | Phone width |
| --- | --- | --- |
| ![The page on Paper](page-paper.jpg) | ![The page on the Chalkboard](page-chalkboard.jpg) | ![The page at 390 px](page-phone.jpg) |

## How it is built

- `src/ui/layout.ts`: v21's groups and tabs (`GROUPS`, app23.js:L1412–1435 and L1587–1590) laid over the schema. The schema gives every control its kind, range, step and unit; the layout says only where it sits. A unit test fails if a schema entry with `control: true` is placed in no group or in two (`unplaced()`).
- **Features.** `FEATURES` (`stars`, `merger`, `lens`) says what the engine draws. A control whose parameter belongs to a milestone that has not landed is not shown, and a preset that needs one is not offered (the Choose tab says how many are waiting). The pull request that lands M7, M8 or M9 in the page switches its flag on, and its controls, tab and presets appear. `?features=merger,lens,stars` previews the controls without the drawing.
- `src/ui/controls.ts`: sliders (native `input[type=range]` plus a typeable value, clamped), radio groups for up to three options and a menu for more, v21's off/on buttons for `lines`, `whole`, `envelope` and `outline`, tabs on the WAI-ARIA pattern, and a group whose switch (merger, lens, shells) is off as a disabled `fieldset`.
- `src/ui/page.ts`: the state the viewer edits (preset, parameters, zoom, surface), reported to `main.ts` through one `onChange`. `main.ts` keeps the engines; the engines gained one method, `snapshot()` (composite into a texture of its own and read back, on demand and in the frame queue), for the PNG.
- `src/ui/urlstate.ts`: the link holds `preset`, `seed`, the camera, `surface` and every parameter that differs from the preset (`?preset=Barred+spiral&arms=4&stroke=beaded`). Reading clamps numbers, ignores bad choices, and leaves `backend`, `present` and `variant` alone.
- `src/ui/timeline.ts`: play, scrub, end, loop and speed as v21's (6 s per unit of t at 1×); it writes only `mTime`, a view-tier input. It never starts by itself, and loops by default only when the viewer has not asked for reduced motion.
- `src/ui/surprise.ts`: v21's "Surprise me", draws in v21's order, with a random source that tests can fix; it adds only what the page draws.

## Checklist: v21's controls

Status: **done**, **waits for M7/M8/M9** (the control is built from the schema and appears when the feature flag is switched on), **M12** (left out on purpose), **changed**.

| v21 control | status |
| --- | --- |
| Presets, grouped (galaxies, mergers, lenses, stars and artefacts, scenes, creative) | done as text cards (name and what it draws, `aria-pressed`); thumbnails are not rebuilt (v21's are pre-rendered images in `assets/data/rosse`); presets for M7 to M9 wait |
| Surprise me | done (merger, star and artefact additions wait) |
| New stars (re-seed), seed number | done (the seed box is typeable, 1 to 9999) |
| Shape: bulge fraction, size, roundness, disc thickness, halo | done |
| Arms: number, pitch, contrast, width, flocculence, arms drawn as | done |
| Bar and ring: strength, length, ring, radius, bar and ring drawn as | done |
| Stars: stars sampled, stipple density, knots on arms, bright stars | done |
| Star or artefact: draw (galaxy, star, artefact), artefact, brightness, spikes, rings, bleed | waits for M7 |
| In the field: foreground star, distance, direction, artefact across it | waits for M7 |
| View: inclination, orbit round the axis, roll, dust lane, winding | done; the plate also orbits, rolls and zooms by pointer and keys (M3) and the sliders follow it |
| Oddities: companions, tidal tail, drawn arcs, drawn shells, trails, stray arrow, jet | done |
| Oddities: foreground stars | waits for M7 |
| Creative: dust carved by pen lines, bubbles, streams, hand wobble | done |
| Creative: deep field of drawn galaxies | waits for M7 |
| Stars and dust: drawn stars among the dots | waits for M7; dust lanes hatched with pen lines is done |
| Pen and variation: pen weight, variation | done |
| The drawings: line strokes, whole drawing, halo or disc drawing, outline arcs, stroke kind, nuclear spiral, rewind the drawings | done |
| Print: plates (ink, slipped CMY, colour by population) | done (Ink tab) |
| Paper and Chalkboard (v21's dark mode) | done, remembered, and in the link |
| Merger: moment, ratio, approach, time since closest approach, tilts, friction, arms, sizes, orbit tilt, speed, stars simulated, galaxy types, merger on, tearing | waits for M8 (built; see below) |
| Timeline: play, scrub, end, loop, speed | built and tested; shown for a merger once M8's flag is on |
| Lensing: every slider, source, cluster, second source, lens on | waits for M9 |
| Shells (simulated): time, direction, stars, on | waits for M8 |
| Quasar flare on the timeline | waits for M9 |
| PNG export | done (v21 had none; the file is the plate as shown, at its pixel size) |
| URL state | done (v21 had none) |
| "Drawn on the CPU" note | done (`#note`, red pencil, announced as a status) |
| Plate caption, "drag to orbit" hint, double-click reset | done |
| Export SVG | M12 |
| Export GIF | M12 |
| Any Galaxy Zoo 2 galaxy (random by type, find) and real galaxies with photos | M12 |
| v21's "recipe" rail of component cards, Principia post-it pile, taped print | not rebuilt: the tab bar and preset cards do the same job; the objects are photographed assets, a design decision for the owner |
| `winding` S-wise/Z-wise, `mTime` in the merger group | done |
| Line strokes and the other four switches | changed: v21's off/on buttons, and any value above 0 reads as on (a preset's 0.9 or 0.3 shows "on"); the URL and presets keep the exact value |

### Not buildable yet

- **M7**: star or artefact, in the field, foreground stars, deep field, drawn stars among the dots, and the presets that use them (`Star: …`, `Artefact: …`, `Layered: …` with a star or artefact).
- **M8, the page's side**: M8 is merged, but `main.ts` does not call `GpuMerger`, `CpuMerger` or the shells passes (only the golden harness does), and `GpuMerger.build` is asynchronous where the page's `draw` is not. A merger preset therefore draws as a single galaxy on the page. The wiring is a change to the engines' frame path, which M7 and M9 also change, so it is left to land after them (see the owner decisions). Until then `FEATURES.merger` is off.
- **M9**: the lens controls, the quasar flare and the lens presets.

## Accessibility

- Every control has a visible label tied to it (`label for`, or a `fieldset` with a `legend` for a group of radio buttons); the number box of a slider is named `<label>, value`. The Playwright test checks every visible input, select, button and tab has a name.
- Keyboard: the whole page is reachable in reading order (skip link, surface, plate, buttons, tabs, panel). Sliders take the arrow, Home, End and Page keys; the tabs take Left, Right, Home and End; the plate takes the arrows, Q and E, plus and minus, 0 (M3); typing in a number box does not turn the plate.
- Focus is a 2 px magenta ring on every control, never removed. Targets are at least 44 px high.
- Contrast: all text and the magenta and red-pencil inks are at least 4.5:1 on both grounds, in Paper and on the Chalkboard (`tests/unit/ui-contrast.test.ts`, WCAG 2.x). Hairlines are decoration, not information.
- Reduced motion: no transitions or animation; the timeline never plays by itself and does not loop by default; scrolling is not smoothed.
- Status messages (the CPU note, the mark counts, "Saved rosse-7.png", "Link copied") are `aria-live` regions. A group switched off is a disabled `fieldset`, announced as unavailable, with a line saying what turns it on.
- The plate is `role="application"` with a name that lists its keys; its pixels have no text alternative beyond the caption (a plain description of what is drawn, `aria-hidden` on the visible copy so it is not read twice) and the mark counts.
- Forced colours: the selected states use `Highlight`.
- Not done: a screen-reader pass with a real reader on a device, and a 200% zoom review on the phone, are not run here. Only Chromium is tested.

## Tests

- `tests/unit/ui-page.test.ts`: the layout places every schema control once and hides the gated ones; presets follow the flags; the link round-trips and clamps; the timeline's clock; Surprise me is valid for 200 random draws.
- `tests/unit/ui-contrast.test.ts`: the colour tokens.
- `tools/gpu-test/ui-smoke.mjs` (`npm run test:ui`, and in `npm run test:gpu`): on the CPU engine and on WebGPU (SwiftShader), the page loads without error; the tabs follow the keyboard; a slider and a number box change the drawing and the link; a preset card draws; Paper and Chalkboard; a link restores the drawing; New stars and Surprise me; a PNG of the plate's size is downloaded; every control has a name; reduced motion; the merger preview shows the timeline and scrubs `mTime`. `tools/gpu-test/plates-page.mjs` now drives the Plates choice in the Ink tab.

## Owner decisions

1. **Fonts.** The page loads Heros, IBM Plex Mono and Threshold Grain (as "Principia Hand") from `assets/fonts` through Vite. Their licences are open question Q1; settle them before the page is published.
2. **The M8 page wiring** (above): who does it, and when. Recommended: one small change after M7 and M9 have merged, as it touches the same frame path.
3. **Preset thumbnails and the photographed objects** (post-it pile, taped print, recipe rail): v21 has pre-rendered thumbnails and photographs; rebuilding them as real objects is a design task beyond this milestone.
4. **`mTime` range.** The schema limits `mTime` to 0 to 2 while v21's timeline end can reach 30 (`mHorizon`); the timeline sets `mHorizon` as v21 does but a link clamps `mTime` to 2. M8's owner should widen the schema range with the horizon.
