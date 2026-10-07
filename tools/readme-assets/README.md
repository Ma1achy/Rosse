# tools/readme-assets

Draws the pictures in the README (`docs/img/`) with the engine. `npm run readme:assets` re-makes all of them; `npm run readme:assets -- banner` (or `renders`, `gallery`, `gifs`) re-makes one stage.

Needs: Node 22, `npm ci`, Playwright's Chromium (`npx playwright install chromium`), `ffmpeg`, and ImageMagick (`convert`, `montage`) on the PATH. Nothing is downloaded. No GPU is needed: the plates are drawn on WebGPU through SwiftShader, as the golden tests are.

| file | what it is |
| --- | --- |
| `plan.mjs` | every galaxy (preset, seed, parameter overrides), still and GIF, with its view. Change a picture here. |
| `render.html`, `render.ts` | the headless render page. It calls the engine's public classes the way `src/main.ts` and the golden runner do (the engine's own picks, not v21's) and returns ink alpha or the composited plate. It changes no engine code. |
| `lib.mjs` | the Playwright driver, PNG helpers and a small static server for the posters |
| `build.mjs` | the stages: `renders` (into `.cache/readme-assets/`, not committed), `banner`, `gallery`, `gifs` |
| `poster/banner.html` | the banner, 1100 × 380 CSS px at 2x; `?theme=dark` is the Chalkboard variant |

Everything is deterministic for a given engine and adapter: fixed seeds, fixed parameters, no random choices in the script. Another adapter or another ffmpeg may differ in a mark or a palette entry.

The parameters are the engine's own, laid over a preset and tuned by eye for a clean plate (more stars, firmer arms). The foreground stars and deep field are switched off (`fgstars: 0, field: 0`) because the sky belongs to M7, which is not merged; when it lands, the plan can switch them back on (docs/readme-refresh.md).
