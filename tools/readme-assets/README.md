# tools/readme-assets

Draws every picture in the README (`docs/img/`) with the engine, and checks them.

```sh
npm run readme:assets                  # every stage, in order (about two hours on SwiftShader)
npm run readme:assets -- gz2           # one stage
npm run readme:assets -- gifs --only=merger-mice,lens-ring   # some films of a stage
npm run readme:assets -- gallery --fresh                     # ignore the plate cache
npm run readme:assets -- fetch-gz2     # the SDSS cutouts (network; not part of `all`)
npm run readme:check                   # every README image exists, every file is within its budget
```

Needs: Node 22, `npm ci`, Playwright's Chromium (`npx playwright install chromium`), `ffmpeg` and ImageMagick (`convert`) on the PATH. Only `fetch-gz2` uses the network. No GPU is needed: the plates are drawn on WebGPU through SwiftShader, as the golden tests are. Run it at low priority on a shared machine (`nice -n 15`).

## Stages

| stage | draws | into |
| --- | --- | --- |
| `banner` | the banner's two plates, then the banner pages | `docs/img/banner.png`, `banner-dark.png` |
| `renders` | warms the plate cache for every figure (the other stages draw what they need anyway) | `.cache/readme-assets/` (not committed) |
| `gallery` | the poster-grid stills of `plan.mjs` `FIGURES`, the pen-weight figure, the contact sheet of every preset | `docs/img/figures/*.jpg` |
| `anatomy` | the marks-by-layers figure and its film | `docs/img/figures/anatomy.jpg`, `docs/img/gifs/anatomy.gif` |
| `gz2` | the Galaxy Zoo 2 category plates and the real galaxies' photograph and drawing pairs | `docs/img/gz2/*.jpg`, `docs/img/real/*.jpg`, `gz2-picks.json` |
| `gifs` | every film but the anatomy one | `docs/img/gifs/*.gif` |
| `fetch-gz2` | the SDSS cutout of each GZ2 pick, once | `docs/img/gz2/cutouts/*.jpg` and `manifest.json` |
| `all` | everything above except `fetch-gz2` | |

Each stage re-draws only its own outputs. `docs/img/manifest.json` records what each picture resolved to (the catalogue's picks, the preset names, file sizes).

## Files

| file | what it is |
| --- | --- |
| `plan.mjs` | every shot (preset, seed, parameter overrides, camera), figure, film and the GZ2 selection rule. Change a picture here. |
| `camera.mjs` | the camera-path module: keyframes for `az`, `incl`, `pa`, `zoom`, `mTime` and any parameter, with monotone-cubic, stop-and-go or linear easing, closed paths for seamless loops, an optional damped spring |
| `build.mjs` | the stages |
| `figures.mjs` | the poster grid (HTML that Chromium screenshots): strips, the preset sheet, plate-and-data pairs |
| `render.html`, `render.ts` | the headless render page. It calls the engine's public classes the way `src/main.ts` does (merger, shells, lens, overlays, the sky) and returns the plate composited on Paper or Chalkboard. It changes no engine code. It also runs the catalogue decode and `fromVotes` for the GZ2 picks. |
| `lib.mjs` | the Playwright driver, PNG helpers, a static server |
| `check.mjs` | `npm run readme:check` |
| `gz2-picks.json` | the galaxies the `gz2` stage chose, with their votes and parameters (generated, committed, so a diff shows a change of engine or catalogue) |
| `poster/banner.html` | the banner, 1100 × 380 CSS px at 2x; `?theme=dark` is the Chalkboard variant |

## How a picture is made

- A **plate** is one shot drawn at 720 px (films at 600) and composited on Paper or Chalkboard. Plates are cached in `.cache/readme-assets/plates/` under a hash of the shot and of `git rev-parse HEAD:src`, so a new engine commit re-draws everything and an unchanged one re-draws nothing.
- A **figure** is plates laid on the poster grid (hairlines, Heros titles, IBM Plex Mono captions) and screenshotted at 2x, then saved as a JPEG.
- A **film** is frames along a camera path, drawn at 520 px, encoded as a GIF with ffmpeg's two-pass palette (`palettegen` and `paletteuse`, Bayer dither) and, if it is over 1.8 MB (the budget; 3 MB is the hard limit `readme:check` enforces), again with fewer colours, then a smaller size, then every second frame, until it is under. What it settled on is in the script's output and in `manifest.json`. A full-size H.264 MP4 of each film is written beside its GIF (`docs/img/gifs/*.mp4`): the GIF is the README's fallback, the MP4 is the film at its full frame rate and size. `--keep` keeps the frames in `.cache/readme-assets/frames/` and `--reencode` re-encodes from them.
- The engine's camera is `az`, `incl`, `pa` and `zoom`, looking at the galaxy's centre (there is no pan), as the page's orbit has it. A "push in" is the zoom.

## Galaxy Zoo 2 and the SDSS cutouts

The `gz2` stage decodes the catalogue with the engine's own code (`src/extras/catalogue`) in the render page and, for each category of its list of types, takes the galaxy of that type with the highest vote fraction for the category's defining question (the exact rule is in the comment of `GZ2_RULES` in `plan.mjs`). It draws each with `fromVotes` at the seed its object id gives.

The catalogue has votes, not pictures. A plate is drawn as "photograph | Rosse's drawing" only when the SDSS cutout for its object id is in `docs/img/gz2/cutouts/`. `npm run readme:assets -- fetch-gz2` downloads them once (SkyServer's `ImgCutout` for the object's RA and Dec, through `curl` and the configured proxy; TLS verification stays on) and writes `manifest.json` beside them with each object id, RA, Dec, URL and retrieval date. Commit the files; from then on regenerating needs no network. Without them the plate shows Rosse's drawing and the votes.

The 42 real galaxies of the asset pack come with their own photographs (160 px), so their pairs are always drawn.

Everything is deterministic for a given engine and adapter: fixed seeds, fixed parameters, no random choices in the script. Another adapter or another ffmpeg may differ in a mark or a palette entry.
