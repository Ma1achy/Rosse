# profile-reference

Profiles the reference Rosse engine (`assets/reference/pages/rosse-v21.html`, whose inlined script is
`assets/reference/rosse-source/app23.js` byte for byte) stage by stage, for every preset, in headless
Chromium. The output, `docs/data/reference-profile.json`, is the source of the size and cost figures in
`docs/reference-notes.md`.

## Running it

```sh
node tools/profile-reference/profile.mjs                  # all 45 presets, about 3 minutes
node tools/profile-reference/profile.mjs --only 'Grand design' --out /tmp/gd.json
node tools/profile-reference/profile.mjs --repeat 5       # more timing-only repeats of the warm render
```

It needs Playwright and its Chromium. The script loads `playwright` from the repository first and falls
back to the global install at `/opt/node22/lib/node_modules` (plus anything on `NODE_PATH`), so no
`npm install` is needed in the container. No other dependencies.

## What it does

1. Reads `rosse-v21.html` and patches it **in memory** (the asset file is never written):
   - every stage function `foo` (`generate`, `curves`, `buildCurves`, `parts`, `skyParts`, `buildSky`,
     `expandVector`, `simulateMerger`, `mergerSprites`, `lensSolver`, `lensMarks`, `lensSprites10`,
     `buildSourceGalaxy`, `starSprites`, `overlaySprites`, `shellSprites`, `dustLanes`, `makeVariation`,
     `drawSprites`, `drawRibbons`, `render`) is renamed `foo__raw`, and a wrapper `function foo()` is
     injected into the same IIFE just before the `window.__GEN` hook. Function declarations hoist, so
     every call site, including `loadTex`'s first `render()`, goes through the wrapper;
   - the wrapper keeps a call stack and accumulates, per stage, the number of calls, **inclusive** time
     (only for the outermost activation of a name, so nothing is counted twice) and **self** time
     (inclusive minus the time spent in wrapped callees). `edges` records `caller>callee` pairs, which
     separates, for example, `render>generate` from `buildSourceGalaxy>generate` (lensed sources) and
     shows `lensSprites10>buildCurves`;
   - `drawSprites` also counts instances per atlas (`rows.length`), how many of them are more than 64 px
     outside the 800 × 800 view, and a histogram of each instance's approximate mip level
     (`round(log2(cell / quad side))`); `drawRibbons` counts vertices (`V.length / 5`) per texture
     (`strokes` for arm ribbons, `solid` for expanded vector line-work);
   - `window.__PROBE()` exposes a few closure variables (`RMAX`, `CAM`, `VIEW`, `LHOME`, `OVHOME`);
   - CSS pins `#gl` to 800 × 800 CSS px; with `deviceScaleFactor: 1` the script checks `canvas.width === 800`.
2. Serves the patched page from a local `node:http` server and opens it in Chromium launched with
   `--use-angle=swiftshader --enable-unsafe-swiftshader`. Requests leaving localhost (Google Fonts) are
   aborted.
3. Extracts the `var PRESETS = {…};` literal from `app23.js` (evaluated with `new Function`), sets seed 7,
   and for every preset measures three renders:
   - **cold**: `__GEN.preset(name)`, the first render with those parameters (merger and shell simulations
     are computed here);
   - **warm**: `__GEN.set({})` immediately afterwards (simulation caches warm), plus `--repeat` timing-only
     renders whose median is reported;
   - **orbit**: `__GEN.set({ az: az + 5 })`, showing that a 5° orbit costs a full rebuild.

   Each measurement records CPU time of the call, wall time including a 1-pixel `readPixels` (which waits
   for SwiftShader to finish rasterising), the per-stage profile and `__GEN.stats()`.

4. Runs two determinism checks: Grand design at az 0° and 0.3° with `dustScribble` 0.5 and 0 (the
   orbit re-rolls the stipple), and the same lens preset reached by two navigation paths (the lensed
   source depends on navigation history through `homeFor`).
5. Writes `docs/data/reference-profile.json`: `meta` (date, Chromium version, flags, renderer string,
   viewport, definitions of every field), `headline` (min, median and max across presets, slowest
   presets), `checks`, and `presets[]` with `stats`, `summary.{cold,warm,orbit}` and the full profiles.

## Caveats

- **Timings are SwiftShader software rendering on a shared container CPU.** Wall times are dominated by
  rasterisation in software and say little about a real GPU. CPU stage times (`prof.fn`) are
  meaningful relative to one another, but they vary by 20–50 % from run to run; the first preset also
  pays for JIT warm-up (Grand design's cold render is always the slowest of its family).
- `render()` includes some DOM work (the stats text and the recipe cards via `__refreshCards`); the
  measured `cpuMs` of a `__GEN.set` / `__GEN.preset` call also includes `sync()`, which runs before
  `render()`. Draw-call CPU time (`drawSprites`, `drawRibbons`) includes the `Float32Array` packing and
  the `bufferData` uploads.
- Instances are also counted when their atlas has no texture (`drawSprites` returns early); in
  practice every such call has zero rows, because vector atlases are expanded first.
- `plates: 'slip'` draws the whole scene four times; per-pass figures divide by four, the raw profile
  does not.
- Instance counts are what is handed to `drawSprites`. Vector atlases (`whole`, `arms`, `rings`,
  `sstars`, …) never reach `drawSprites` with rows: they are expanded into ribbon triangles (`solid`)
  plus dot and blob sprites.
- The patch relies on each stage being declared exactly once as `function name(`; the script stops
  with an error if that ever stops being true.
