# Rosse and Almagest: the asset pack

Everything Rosse (the hand-drawn galaxy engine) and Almagest · the Plate are built from, unpacked from the pages' embedded data into ordinary files, with the formats documented. Taken from **Rosse v21** and **Almagest · the Plate v6**, 3 October 2026.

Every mark Rosse draws comes from a library of real hand drawings — dots, strokes, knots, stars and whole galaxies drawn with a fineliner, scanned and cut out. Nothing is procedurally invented at the mark level: the engine builds a galaxy in 3D, then places, transforms and inks these drawings.

## Layout

```
drawings/
  bitmap/            raster sheets: <atlas>.png (or .webp) + <atlas>.json (grid and metadata)
  vector/            <atlas>.json (all records), <atlas>_contact.png (numbered preview),
                     <atlas>/NNN_<source>.svg (one SVG per drawing)
objects/             the photographed physical objects: post-its, tabs (plain, folded,
                     hand-lettered), pins, luggage tag, paper textures, Polaroid frame and backs,
                     reference photos
fonts/               every typeface used, with fonts.json (family, weight, origin)
data/
  rosse/             the Galaxy Zoo 2 catalogue, the real galaxies with photos, and the
                     pre-drawn post-it thumbnails (presets, real galaxies)
  almagest/          the Plate's preview sheets (pre-rendered marker drawings)
embedded-other/      every other image embedded in either page (textures, icons, glyphs,
                     UI objects), named by the CSS variable or key that uses it; index.json
                     gives each file's source context
reference/           the two pages, Rosse's source (app23.js, head23.html, build23.sh), the
                     Plate's carved engine, and the design language
_inventory.json      counts
```

## Drawings

### Bitmap sheets (`drawings/bitmap/`)

Each sheet is a grid of square cells, read row-major: drawing `i` is at column `i % cols`, row `floor(i / cols)`, at pixel `(col × cell, row × cell)`, size `cell × cell`. Ink is in the alpha channel (black ink on transparent).

| atlas | cells | what it is | used for |
|---|---|---|---|
| `dots` | 500 at 32 px | single pen dots; `size` gives each dot's measured size | stipple: the stars of discs, bulges, haloes and the deep field |
| `knots` | 160 at 48 px | small clustered marks | star-forming knots along arms; quasar hearts |
| `stars` | 48 at 64 px | small drawn stars | brighter individual stars |
| `cores` | 27 at 128 px | dense bulge cores; `style`, `kind` | the bright centres of bulges |
| `fgstars` | 29 at 96 px | foreground star drawings; `kind` | stars in front of the galaxy |
| `pieces` | 638 at 32 px | short fragments cut from strokes | broken-up stroke texture, dust and stipple variety |
| `strokes` | 60 rows, each 512 × 64 px | whole pen strokes laid out one per row; `kind`, `thick` (pen width in px), `pieces` | textured ribbons: arms and other curves drawn as one continuous stroke |

### Vector drawings (`drawings/vector/`)

Each record has three parts, in a unit tile from −0.5 to 0.5 on both axes (y down, as on screen):

- **`l` — lines:** a list of polylines, each a flat list `[x0, y0, x1, y1, …]`.
- **`d` — dots:** a list of `[x, y, r]`, filled circles of radius `r`.
- **`b` — blobs:** a list of `[cx, cy, rx, ry, θ]`, filled ellipses, rotated by `θ` radians.

The SVGs draw exactly this (lines at width 0.006 of the tile). In Rosse, lines are drawn as pen ribbons at the current pen weight, and dots and blobs as filled ink.

| atlas | count | what it is | notes |
|---|---|---|---|
| `whole` | 156 | complete drawn galaxies | `type` (e.g. `galaxy:spiral`, `smooth:…`), `winding`, `pitch`, `lineish`; `icon` groups indices by look (spiral, barred, edge, merger…). Used for the deep field, companions, member galaxies of clusters, lensed sources and Almagest's markers |
| `arms` | 44 | single drawn spiral arms | `meta` = [tightness, shape, end style, flag] |
| `rings` | 51 | rings and closed curves | `kind` |
| `bars` | 10 | drawn bars | `solid` (filled or outline) |
| `env` | 21 | disc and halo envelopes | `kind` (`disc`, `halo`) |
| `arcs` | 15 | lensed arcs and Einstein rings | `kind` |
| `shells` | 5 | shell systems | dots only |
| `companions` | 10 | small companion galaxies | `kind` |
| `trails` | 13 | satellite trails and cosmic rays | `kind` |
| `penlines` | 25 | plain pen lines | dust-lane hatching; also reused to give drawn lines (histogram outlines, frames) a hand wobble |
| `sstars` | 77 | star shapes | `kind`: `outline`, `burst`, `plus`, `spark`, `asterisk`. Bright stars, quasar images, sparkle |
| `misc` | 2 | a spring and an arrow | the jet; direction arrows |

Every record's `src` names the original drawing it was cut from.

## Objects (`objects/`)

The photographed objects the pages are dressed with:

- **`postits/`** — the kit's post-it photos (flat and curled, yellow, blue, green, pink, and a stack). Rosse's preset and real-galaxy thumbnails are drawings composited onto these. A post-it is 76 mm square against a Polaroid's 88 × 107 mm: on a Polaroid's back it spans 86% of the width (see `reference-photos/postit-on-polaroid-scale-reference.jpeg`).
- **`tabs/`** — plain flat and folded index tabs, and **`hand-lettered/`** CHOOSE, GALAXY, MERGER, SKY, INK, cut from the photo in `reference-photos/`.
- **`luggage-tag/`** — the original, and `luggage-tag-body-only_used-in-rosse.png` with its string cut away (Rosse ties it on "from behind"; the eyelet is at 38%, 11% of the image).
- **`pins/`**, **`paper/`** (including the cream paper texture used for the rail), **`polaroid/`** (the blank frame — image window at left 6.25%, top 5.561%, width 87.75%, height 73.326% — and four real backs).

## Fonts (`fonts/`)

- **Heros** (400, 700, 400 italic): the page typeface (a Helvetica-like face).
- **Threshold Grain**: the handwriting. The design pass loads it under the family name "Principia Hand", so the pages didn't need changing; `ThresholdGrain_loaded-as-Principia-Hand.woff2` is that file.
- **Principia Hand** (`.ttf`): the earlier handwriting, before the design pass.
- **Threshold Mark**, and the kit's originals of the whole Threshold family (Grain, Mark, Patina, Signs) in `kit-originals/`.
- **IBM Plex Mono** (400, 600, 700, 400 italic): small capitals and numbers. Both pages load it from Google Fonts; the files and its OFL licence are included.

## Data

- **`data/rosse/gz2-catalogue.json`** — the catalogue behind "Any Galaxy Zoo 2 galaxy": 239,695 galaxies, packed as base64 → gzip → one byte column per field (vote fractions, axis ratio, position angle, winding, vote count, concentration, size, colour, redshift, de Vaucouleurs fraction), then RA and Dec as 24-bit values, then object IDs as delta-coded varints. `decode_gz2_catalogue.py` beside it decodes it and documents every field's scaling. Rosse turns a galaxy's values into drawing parameters with `fromVotes`.
- **`data/rosse/real-galaxies/`** — the 42 galaxies with photos: `real-galaxies.json` (each galaxy's identity, votes and shape, with photo fields pointing at `photos/`).
- **`data/rosse/preset-postits/`** (46) and **`real-galaxy-postits/`** (42) — pre-drawn thumbnails: each drawing rendered by Rosse v11/v19, the ink lifted off the paper, composited onto a post-it.
- **`data/almagest/preview-sheets/`** — the Plate's pre-rendered marker drawings (sheets plus `preview-sheets.json`). The Plate's galaxies themselves are still the prototype's synthetic set; the real-data format is separate (`plate.bin`, in the research repo).

## Design tokens

| token | value | use |
|---|---|---|
| ink | `#1d1b19` | all marks and text |
| paper | `#efe9dc` | the page |
| plate / field | `#e2d9c6` | the darker cream behind figures |
| ink 2 | `#6f6a5f` | secondary text |
| red pencil | `#b8321f` | imagined things, annotations |
| vermilion | `#cc4514` | the selection |
| magenta | `#b80f5e` | focus, one per view |
| chalkboard | `#262b28` | the plate in Chalkboard mode |

The full design language is in `reference/design-language/`.

## Reimplementing Rosse in shaders: where to look

The current renderer (`reference/rosse-source/app23.js`) builds each galaxy on the CPU and draws it with WebGL as instanced, textured sprites. The parts worth knowing:

- **`generate()`** — the 3D model: bulge, disc, arms (with spurs and clumps), bar, ring, dust and halo, sampled into stipple and knots in the galaxy's own frame.
- **`project()`** — the camera: inclination, spin about the galaxy's axis, and twist on screen. Orbiting changes these angles; `rotFwd` / `rotInv` are the same rotation with depth.
- **`curves()` / `buildCurves()`** — arms and other curves as ribbons, textured from the `strokes` sheet.
- **`parts()`** — vector drawings placed as marks (cores, bars, rings, envelopes, whole galaxies…), each with an affine matrix; `expandVector()` turns a vector record into ribbon geometry.
- **`mergerSprites()`** — a simulated merger: restricted N-body tidal tails, then the drawings carried along.
- **`lensSprites10()`** — lensing: cored elliptical lenses (Keeton 2001), a triangle-mesh solver for every image of a source point with its local Jacobian and parity, the source galaxy lensed mark by mark, and sources fixed in 3D behind the lens (`srcNow`).
- **`starSprites()` / `overlaySprites()`** — stars and artefacts (diffraction spikes, glare, bleed, satellite trails, ghosts, cosmic rays), as subjects or as overlays fixed in the scene.
- **Instances:** every mark is one textured quad with a per-instance affine matrix and alpha (`inst()`); vector marks become triangle strips. All marks share one pen weight per drawing.
- **`DEF`** — every parameter and its default; the presets are in the same file.

`reference/almagest-engine/engine4.js` is the same engine carved out for the Plate (no page code), with `carve_engine16.py`, which produced it.
