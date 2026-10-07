// @ts-check
/**
 * Everything the README's pictures are made of: which galaxy, which seed, which parameters, which
 * camera. A picture is a pure function of this file and the engine, so `npm run readme:assets`
 * re-draws the same pictures (on SwiftShader, bit for bit on one machine; another adapter may
 * differ by a mark here and there, docs/open-questions.md Q14).
 *
 * A "shot" is `{preset, seed, over, zoom, az, incl, pa, mTime, plates}`: a preset (src/core/
 * presets.ts) at a seed, the engine's own parameters (src/core/params.ts) laid over it as the
 * page's controls would, and the camera (az, incl, pa: degrees; zoom: the page's zoom). Nothing
 * here is random. The sky (`fgstars`, `field`) is the preset's own unless a shot says otherwise.
 *
 * Sections, in README order: GZ2 (the Galaxy Zoo 2 plates), REAL (photograph and drawing),
 * FIGURES (stills, composed on the poster grid), GIFS (the films), BANNER (the banner's plates).
 * `docs/img/manifest.json` (written by the script) records what each picture resolved to: the
 * catalogue's picks, the preset names, sizes.
 */
import { EASE, logZoom, there, turn } from './camera.mjs';

/** The size of the plate render for stills (CSS px; the engine draws at 1x). */
export const PLATE_CSS = 720;

/** The brightest, firmest look for a hero spiral (more stars, firmer arms: the engine's own). */
const HERO = { stars: 15000, armStrength: 1, armWidth: 0.22, lines: 1 };

/**
 * @typedef {{preset: string, seed: number, over?: Record<string, unknown>, zoom?: number,
 *   az?: number, incl?: number, pa?: number, mTime?: number, plates?: string}} Shot
 * @param {string} preset @param {number} seed @param {Record<string, unknown>} [over]
 * @param {Partial<Shot>} [view]
 * @returns {Shot}
 */
const S = (preset, seed, over = {}, view = {}) => ({ preset, seed, over, ...view });

/** Named galaxies used more than once. */
export const GALAXIES = /** @type {Record<string, Shot>} */ ({
  spiral: S('Grand design', 12, { ...HERO, pitch: 14, knots: 0.5, incl: 15, bulge: 0.2, halo: 0.05, fgstars: 0.1, field: 0.1 }, { zoom: 1.35 }),
  spiralTilted: S('Grand design', 7, { ...HERO, armWidth: 0.22, stars: 16000, knots: 0.6, incl: 22, bulge: 0.15, fgstars: 0.1, field: 0.1 }, { zoom: 1.5 }),
  barred: S('Barred spiral', 11, { ...HERO, stars: 16000, knots: 0.6, incl: 25, fgstars: 0.1, field: 0.1 }, { zoom: 1.5 }),
  edgeOn: S('Edge-on with dust', 4, { stars: 20000, incl: 80, pa: 170, thick: 0.1, bulge: 0.55, dust: 1, dustScribble: 1, dustLines: 1, fgstars: 0.1, field: 0.1 }, { zoom: 1.8 }),
  tight: S('Tightly wound', 7, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 30, fgstars: 0, field: 0 }, { zoom: 1.5 }),
  populations: S('Stellar populations', 7, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25, fgstars: 0.1, field: 0.1 }, { zoom: 1.5 }),
  mice: S('Merger: the Mice', 7, {}, { zoom: 1 }),
});

/**
 * The banner's plates (docs/img/banner*.png, tools/readme-assets/poster/banner.html). Kept as the
 * approved banner has them: the galaxy alone, no sky.
 */
export const BANNER = [
  { id: 'banner-spiral', shot: S('Grand design', 12, { ...HERO, pitch: 14, knots: 0.5, incl: 15, bulge: 0.2, halo: 0.05, fgstars: 0, field: 0 }, { zoom: 1.35 }), dpr: 2, keep: ['ink', 'plate-chalk', 'plate-paper'] },
  { id: 'banner-barred', shot: S('Barred spiral', 11, { ...HERO, stars: 16000, knots: 0.6, incl: 25, fgstars: 0, field: 0 }, { zoom: 1.5 }), dpr: 2, keep: ['ink', 'plate-paper'] },
];

// ---------------------------------------------------------------------------------------------
// Galaxy Zoo 2: the category plates
// ---------------------------------------------------------------------------------------------

/**
 * One plate per category of the catalogue's own list of types (`GALAXY_TYPES`,
 * src/extras/catalogue/tools.ts; "any" is not a category). For each, the galaxy of that type
 * (the type's own test, in bytes as v21 writes it, `ofType`) with the HIGHEST VOTE FRACTION for the
 * category's defining question: the score is the largest of the listed vote fields, each a byte
 * over 15 (clamped to 1; 16 and 17 are rounding headroom). Ties, which are many (a fraction of 1 is
 * common), go to the galaxy with the most volunteers (`nvotes`, capped at 255 by the catalogue),
 * then to the lowest DR7 object id. Rosse draws it with `fromVotes` at the seed the catalogue's
 * object id gives (`objid % 9973 + 1`, as the page does) and the camera of its own parameters.
 */
export const GZ2_RULES = [
  { id: 'smooth', type: 'smooth', fields: ['smooth'], label: 'Smooth', q: 'smooth or features? "smooth"' },
  { id: 'spiral', type: 'a spiral', fields: ['spiral'], label: 'Spiral', q: 'any spiral structure? "yes"' },
  { id: 'barred', type: 'barred', fields: ['bar'], label: 'Barred', q: 'a bar? "yes"' },
  { id: 'edge-on', type: 'edge-on', fields: ['edge'], label: 'Edge-on', q: 'edge-on disc? "yes"' },
  { id: 'merger', type: 'merger', fields: ['merger'], label: 'Merger', q: 'odd feature: "merger"' },
  { id: 'ring', type: 'ring', fields: ['ring'], label: 'Ring', q: 'odd feature: "ring"' },
  { id: 'irregular', type: 'irregular', fields: ['irregular'], label: 'Irregular', q: 'odd feature: "irregular"' },
  { id: 'many-arms', type: 'many arms', fields: ['amore', 'a4'], label: 'Many arms', q: 'how many arms? "four" or "more than four"' },
  { id: 'tight-arms', type: 'tight arms', fields: ['tight'], label: 'Tight arms', q: 'how tight? "tight"' },
  { id: 'loose-arms', type: 'loose arms', fields: ['loose'], label: 'Loose arms', q: 'how tight? "loose"' },
];

/** The vote fields shown as bars beside each plate, in order. */
export const GZ2_BARS = ['smooth', 'feat', 'edge', 'bar', 'spiral', 'ring', 'merger', 'irregular'];

/** The camera the catalogue plates are drawn with, and the plate size. */
export const GZ2_VIEW = { zoom: 1.45, plate: 720 };

/** Where a fetched cutout lives (`npm run readme:assets -- fetch-gz2`), and its manifest. */
export const GZ2_CUTOUTS = 'docs/img/gz2/cutouts';
export const SDSS_CUTOUT = (/** @type {number} */ ra, /** @type {number} */ dec) =>
  `https://skyserver.sdss.org/dr19/SkyServerWS/ImgCutout/getjpeg?ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&scale=0.4&width=424&height=424`;

/**
 * The real galaxies shown as "photograph | Rosse drawing" (indices into
 * assets/data/rosse/real-galaxies/real-galaxies.json), a few per category where the galaxy
 * belongs to one. Each is drawn with `fromReal`'s parameters at the seed the object id gives.
 */
export const REAL_PAIRS = [
  { i: 0, cat: 'smooth' },
  { i: 3, cat: 'smooth' },
  { i: 6, cat: 'edge-on' },
  { i: 41, cat: 'edge-on' },
  { i: 10, cat: 'ring' },
  { i: 8, cat: 'ring' },
  { i: 15, cat: 'barred' },
  { i: 19, cat: 'barred' },
  { i: 26, cat: 'barred' },
  { i: 12, cat: 'spiral' },
  { i: 23, cat: 'spiral' },
  { i: 27, cat: 'many arms' },
  { i: 37, cat: 'irregular' },
  { i: 34, cat: 'merger' },
];
export const REAL_VIEW = { zoom: 1.45, plate: 720 };

// ---------------------------------------------------------------------------------------------
// Stills, composed on the poster grid
// ---------------------------------------------------------------------------------------------

/**
 * A figure: a title, a grid of plates with mono captions. `kind: 'strip'` is `cols` columns of
 * `cells`; each cell is a shot with a `label` and a `sub`, and `surface` ('paper' or 'chalk').
 * `width` is the plate's CSS px in the poster (the figure is 1100 wide, shot at 2x).
 * @typedef {Shot & {label: string, sub?: string, surface?: 'paper' | 'chalk'}} Cell
 * @type {Array<{id: string, fig: string, title: string, kind: 'strip', cols: number, cells: Cell[], note?: string}>}
 */
export const FIGURES = [
  {
    id: 'stars',
    fig: '20',
    title: 'Stars',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Star: bright, with spikes', 7), label: 'Star: bright, with spikes', sub: 'the preset' },
      { ...S('Star: bright, with spikes', 7, { spikes: 0, starRings: 0, bleed: 0, starBright: 1 }), label: 'heart', sub: 'spikes 0, rings 0, bleed 0' },
      { ...S('Star: bright, with spikes', 7, { spikes: 1, starRings: 0, bleed: 0.1, starBright: 0.95 }), label: 'spikes', sub: 'spikes 1' },
      { ...S('Star: bright, with spikes', 7, { spikes: 0.2, starRings: 1, bleed: 0.2, starBright: 0.95 }), label: 'rings', sub: 'rings 1' },
      { ...S('Star: bright, with spikes', 7, { spikes: 0.3, starRings: 0.3, bleed: 1, starBright: 1 }), label: 'glare', sub: 'bleed 1' },
      { ...S('Star: faint', 7), label: 'Star: faint', sub: 'the preset' },
    ],
  },
  {
    id: 'star-zoom',
    fig: '21',
    title: 'Into a star',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Star: bright, with spikes', 7, {}, { zoom: 1 }), label: 'x1', sub: 'the whole star' },
      { ...S('Star: bright, with spikes', 7, {}, { zoom: 4 }), label: 'x4', sub: 'the diffraction spikes' },
      { ...S('Star: bright, with spikes', 7, {}, { zoom: 11 }), label: 'x11', sub: 'the drawn heart' },
    ],
  },
  {
    id: 'artefacts',
    fig: '22',
    title: 'Artefacts',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Artefact: satellite trail', 7), label: 'Artefact: satellite trail', sub: 'a streak across the exposure' },
      { ...S('Artefact: ghost reflection', 7), label: 'Artefact: ghost reflection', sub: 'a star and its reflection' },
      { ...S('Artefact: cosmic rays', 7), label: 'Artefact: cosmic rays', sub: 'hits on the detector' },
      { ...S('Deep field', 7, { arrow: 1, field: 0.9 }, { zoom: 0.8 }), label: 'a stray arrow', sub: 'arrow 1, in the deep field' },
      { ...S('Artefact: satellite trail', 21, { starBright: 0.9, spikes: 0.9 }), label: 'trail, other seed', sub: 'seed 21' },
      { ...S('Artefact: ghost reflection', 5, { starBright: 0.95, bleed: 0.8 }), label: 'ghost, other seed', sub: 'seed 5' },
    ],
  },
  {
    id: 'layered',
    fig: '23',
    title: 'Layered',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Layered: spiral beside a bright star', 7), label: 'Layered: spiral beside a bright star', sub: 'a galaxy and a foreground star' },
      { ...S('Layered: barred spiral, satellite trail', 7), label: 'Layered: barred spiral, satellite trail', sub: 'a trail across the plate' },
      { ...S('Layered: edge-on, star on top', 7), label: 'Layered: edge-on, star on top', sub: 'a star over the disc' },
      { ...S('Layered: ringed galaxy, ghost reflection', 7), label: 'Layered: ringed galaxy, ghost', sub: 'a ring and a reflection' },
      { ...S('Layered: lensed merger', 7), label: 'Layered: lensed merger', sub: 'a merger behind a lens' },
      { ...S('Layered: spiral beside a bright star', 3, { ovArtefact: 'cosmic', ovStarA: 215 }), label: 'star and cosmic rays', sub: 'seed 3, a layer added' },
    ],
  },
  {
    id: 'sky',
    fig: '24',
    title: 'The deep field',
    kind: 'strip',
    cols: 1,
    cells: [{ ...S('Deep field', 7, { field: 1, fgstars: 0.5 }, { zoom: 0.32 }), label: 'Deep field', sub: 'field 1, zoom x0.32: every dot a drawn galaxy' }],
  },
  {
    id: 'foreground',
    fig: '25',
    title: 'Foreground stars and companions',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Grand design', 12, { ...HERO, incl: 15, fgstars: 0, field: 0 }, { zoom: 1.2 }), label: 'fgstars 0', sub: 'no foreground' },
      { ...S('Grand design', 12, { ...HERO, incl: 15, fgstars: 0.6, field: 0.3 }, { zoom: 1.2 }), label: 'fgstars 0.6, field 0.3', sub: 'stars in front of it' },
      { ...S('Grand design', 12, { ...HERO, incl: 15, fgstars: 1, field: 0.6, companions: 1 }, { zoom: 1.2 }), label: 'fgstars 1, companions 1', sub: 'and small neighbours' },
    ],
  },
  {
    id: 'arms',
    fig: '26',
    title: 'Arms',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Flocculent', 7, { incl: 20 }, { zoom: 1.4 }), label: 'Flocculent', sub: 'patchy arms' },
      { ...S('Tightly wound', 7, { incl: 30 }, { zoom: 1.4 }), label: 'Tightly wound', sub: 'pitch 9' },
      { ...S('Loose, open arms', 7, {}, { zoom: 1.4 }), label: 'Loose, open arms', sub: 'a wide pitch' },
      { ...S('Hand-drawn arms', 7, {}, { zoom: 1.4 }), label: 'Hand-drawn arms', sub: 'arms as whole drawings' },
      { ...S('Dusty spiral', 7, {}, { zoom: 1.4 }), label: 'Dusty spiral', sub: 'dust in pen hatching' },
      { ...S('Disc, no arms', 7, {}, { zoom: 1.4 }), label: 'Disc, no arms', sub: 'a lenticular' },
    ],
  },
  {
    id: 'kinds',
    fig: '27',
    title: 'Other kinds',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Ringed', 3, { incl: 35 }, { zoom: 1.7 }), label: 'Ringed', sub: 'a drawn ring and bar' },
      { ...S('Shell galaxy', 7, {}, { zoom: 1.3 }), label: 'Shell galaxy', sub: 'shells from a simulated minor merger' },
      { ...S('Radio jet', 7, {}, { zoom: 1.2 }), label: 'Radio jet', sub: 'jet 1' },
      { ...S('Stellar streams', 7, {}, { zoom: 1.2 }), label: 'Stellar streams', sub: 'streams 1' },
      { ...S('Cigar-shaped', 7, {}, { zoom: 1.5 }), label: 'Cigar-shaped', sub: 'an elliptical seen edge-on' },
      { ...S('Smooth, round', 7, { stars: 18000 }, { zoom: 1.5 }), label: 'Smooth, round', sub: 'a sersic profile, no arms' },
    ],
  },
  {
    id: 'hand',
    fig: '28',
    title: 'Plates and hand',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Plates slipped', 7, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25 }, { zoom: 1.5 }), label: 'Plates slipped', sub: 'misregistered colour plates' },
      { ...S('Stellar populations', 7, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25 }, { zoom: 1.5 }), label: 'Stellar populations', sub: 'one ink per population' },
      { ...S('Hand wobble', 7, {}, { zoom: 1.4 }), label: 'Hand wobble', sub: 'distort 0.8' },
      { ...S('Plates slipped', 12, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25 }, { zoom: 1.5 }), surface: 'chalk', label: 'Plates slipped, Chalkboard', sub: 'seed 12' },
      { ...S('Stellar populations', 12, { stars: 16000, armStrength: 1, armWidth: 0.25, incl: 40 }, { zoom: 1.5 }), surface: 'chalk', label: 'Stellar populations, Chalkboard', sub: 'seed 12' },
      { ...S('A sketch, lensed', 7), label: 'A sketch, lensed', sub: 'a drawing as the lensed source' },
    ],
  },
  {
    id: 'lenses',
    fig: '30',
    title: 'Lenses',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Lens: Einstein ring', 7), label: 'Lens: Einstein ring', sub: 'source behind the lens' },
      { ...S('Lens: double Einstein ring', 7), label: 'Lens: double Einstein ring', sub: 'lensDouble 1' },
      { ...S('Lens: Einstein cross (quasar)', 7), label: 'Lens: Einstein cross (quasar)', sub: 'four images of one quasar' },
      { ...S('Lens: a quad', 7), label: 'Lens: a quad', sub: 'four images' },
      { ...S('Lens: galaxy cluster', 7), label: 'Lens: galaxy cluster', sub: 'arcs round a cluster' },
      { ...S('Lens: giant arc', 7), label: 'Lens: giant arc', sub: 'a long arc' },
    ],
  },
  {
    id: 'lens-offset',
    fig: '31',
    title: 'Moving the source',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Lens: Einstein ring', 7, { lensSrc: 0 }), label: 'source offset 0', sub: 'a full ring' },
      { ...S('Lens: Einstein ring', 7, { lensSrc: 0.15 }), label: 'source offset 0.15', sub: 'the ring breaks into an arc' },
      { ...S('Lens: Einstein ring', 7, { lensSrc: 0.4 }), label: 'source offset 0.4', sub: 'two images' },
    ],
  },
  {
    id: 'mergers',
    fig: '32',
    title: 'Mergers',
    kind: 'strip',
    cols: 3,
    cells: [
      { ...S('Merger: the Mice', 7), label: 'Merger: the Mice', sub: 'two spirals, two tails' },
      { ...S('Merger: long tails', 7), label: 'Merger: long tails', sub: 'a long, slow encounter' },
      { ...S('Merger: minor, a stream', 7), label: 'Merger: minor, a stream', sub: 'a small galaxy torn into a stream' },
      { ...S('Merger: spiral meets elliptical', 7), label: 'Merger: spiral meets elliptical', sub: 'a disc and a round galaxy' },
      { ...S('Merger: dry (two ellipticals)', 7), label: 'Merger: dry (two ellipticals)', sub: 'no gas, no young stars' },
      { ...S('Merger: polar collision', 7), label: 'Merger: polar collision', sub: 'discs at right angles' },
      { ...S('Merger: three-armed pair', 7), label: 'Merger: three-armed pair', sub: 'mArms 3' },
      { ...S('Merger: coalescing', 7), label: 'Merger: coalescing', sub: 'late stage, friction 0.8' },
      { ...S('Sketches, torn apart', 7), label: 'Sketches, torn apart', sub: 'whole drawings, torn by the tides' },
    ],
  },
  {
    id: 'merger-sequence',
    fig: '33',
    title: 'A merger in six moments',
    kind: 'strip',
    cols: 3,
    cells: [0.08, 0.28, 0.45, 0.62, 0.8, 1].map((t, i) => ({
      ...S('Merger: the Mice', 7, {}, { mTime: t, zoom: 1 }),
      label: `mTime ${t}`,
      sub: ['approach', 'first pass', 'tails grow', 'return', 'close', 'settled'][i],
    })),
  },
  {
    id: 'shells',
    fig: '34',
    title: 'Shells',
    kind: 'strip',
    cols: 3,
    cells: [20, 45, 80].map((t) => ({
      ...S('Shell galaxy', 7, { shellTime: t }, { zoom: 1.3 }),
      label: `shellTime ${t}`,
      sub: t === 20 ? 'young: the shells are tight' : t === 45 ? 'they spread outwards' : 'old: wide and faint',
    })),
  },
];

/** The pen-weight figure: one plate at three zooms. */
export const ZOOM_FIG = { id: 'pen', fig: '14', shot: GALAXIES.tight, zooms: [1.5, 4, 9] };

/**
 * The anatomy figure and film: the same galaxy by layers. Each stage keeps these kinds of mark
 * (render.ts `roleOf`) and the stages accumulate; the last is everything, sky included.
 */
export const ANATOMY = {
  fig: '15',
  shot: S('Grand design', 12, { ...HERO, pitch: 14, knots: 0.5, incl: 22, bulge: 0.2, halo: 0.05, fgstars: 0.15, field: 0.2, starMix: 0.6 }, { zoom: 1.5 }),
  stages: [
    { id: 'dots', label: 'dots', sub: 'the stipple: where the stars are', only: ['dots'] },
    { id: 'knots', label: '+ knots', sub: 'star-forming clumps', only: ['dots', 'knots'] },
    { id: 'strokes', label: '+ strokes', sub: 'ribbons along the arms', only: ['dots', 'knots', 'strokes'] },
    { id: 'drawings', label: '+ drawings', sub: 'pen lines and whole drawings', only: ['dots', 'knots', 'strokes', 'drawings'] },
    { id: 'stars', label: '+ stars and cores', sub: 'drawn stars, the core', only: ['dots', 'knots', 'strokes', 'drawings', 'stars'] },
    { id: 'all', label: '+ the sky', sub: 'foreground stars, the deep field', only: undefined },
  ],
};

/** The contact sheet of every preset: seed, zoom, plate size, columns. */
export const SHEET = { fig: '04', seed: 7, zoom: 1, plate: 360, cols: 6 };

// ---------------------------------------------------------------------------------------------
// Films
// ---------------------------------------------------------------------------------------------

/**
 * A film: `shot` at each frame's view, from `path` (tools/readme-assets/camera.mjs: keyframes for
 * az, incl, pa, zoom, mTime and any parameter, eased; `closed` for a loop). `seconds` at `fps`
 * frames a second, drawn at `PLATE` px and scaled to `size`. `hold: [a, b]` repeats the first
 * frame `a` times and the last `b` times (a film that does not loop on itself). The encoder tries
 * `colours` and then smaller until the GIF is under `budgetMB`.
 *
 * kind: 'plate' (a camera path), 'wipe' (a line sweeping between surfaces), 'anatomy' (the layers
 * drawn in), 'breathe' (the colour plates fading through the states).
 * @typedef {{id: string, fig: string, title: string, sub: string, kind: 'plate' | 'wipe' | 'anatomy' | 'breathe',
 *   shot: Shot, surface: 'paper' | 'chalk', seconds: number, fps: number, size: number, colours: number,
 *   path?: import('./camera.mjs').PathSpec, hold?: [number, number], budgetMB?: number, plate?: number,
 *   states?: Array<Record<string, unknown>>}} Film
 * @type {Film[]}
 */
export const GIFS = [
  {
    id: 'spiral-orbit',
    fig: '05',
    title: 'Orbit, spiral',
    sub: 'one turn about the axis; the inclination breathes between 40 and 62 degrees; a slow push-in and back',
    kind: 'plate',
    shot: GALAXIES.spiralTilted,
    surface: 'chalk',
    seconds: 5,
    fps: 18,
    size: 480,
    colours: 40,
    path: { closed: true, az: turn(0, 360), incl: [[0, 52], [0.5, 40], [1, 52]], pa: 20, zoom: logZoom([[0, 1.35], [0.5, 1.8], [1, 1.35]]) },
  },
  {
    id: 'edge-on-orbit',
    fig: '06',
    title: 'Orbit, edge-on',
    sub: 'the disc opens from 84 to 62 degrees and closes; the dust lane crosses the bulge',
    kind: 'plate',
    shot: GALAXIES.edgeOn,
    surface: 'paper',
    seconds: 5,
    fps: 18,
    size: 480,
    colours: 40,
    path: { closed: true, az: turn(0, 360), incl: [[0, 84], [0.5, 62], [1, 84]], zoom: logZoom([[0, 1.7], [0.5, 2.1], [1, 1.7]]) },
  },
  {
    id: 'pen-dive',
    fig: '07',
    title: 'Pushing in',
    sub: 'x1.5 to x9 on the nucleus and back: the marks keep their pen weight and resolve into the scanned drawings',
    kind: 'plate',
    shot: GALAXIES.tight,
    surface: 'paper',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 48,
    path: { closed: true, az: [[0, 0], [0.5, 30], [1, 0]], zoom: logZoom([[0, 1.5], [0.18, 1.5], [0.5, 9], [0.82, 1.5], [1, 1.5]]) },
  },
  {
    id: 'merger-mice',
    fig: '08',
    title: 'Merger: the Mice',
    sub: 'the camera dollies in on the approach, turns during the close pass, and draws back as the tails form (mTime 0.04 to 1)',
    kind: 'plate',
    shot: S('Merger: the Mice', 7, {}, {}),
    surface: 'paper',
    seconds: 7,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [6, 14],
    path: {
      ease: 'smooth',
      mTime: [[0, 0.04], [0.15, 0.2], [0.4, 0.5], [0.7, 0.85], [1, 1]],
      zoom: logZoom([[0, 1.2], [0.3, 1.55], [0.55, 1.35], [1, 0.95]]),
      az: [[0, -25], [0.4, 10], [0.7, 60], [1, 85]],
      incl: [[0, 35], [0.5, 50], [1, 38]],
    },
  },
  {
    id: 'merger-tails',
    fig: '09',
    title: 'Merger: long tails',
    sub: 'a slow orbit while the discs swing past each other and throw out tails',
    kind: 'plate',
    shot: S('Merger: long tails', 7, {}, {}),
    surface: 'chalk',
    seconds: 7,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [6, 14],
    path: {
      mTime: [[0, 0.04], [0.3, 0.3], [0.65, 0.7], [1, 1]],
      zoom: logZoom([[0, 1.4], [0.45, 1.1], [1, 0.9]]),
      az: [[0, 0], [1, 120]],
      incl: [[0, 30], [0.5, 55], [1, 35]],
    },
  },
  {
    id: 'merger-polar',
    fig: '10',
    title: 'Merger: polar collision',
    sub: 'two discs at right angles; the camera turns with the encounter',
    kind: 'plate',
    shot: S('Merger: polar collision', 7, {}, {}),
    surface: 'paper',
    seconds: 7,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [6, 14],
    path: {
      mTime: [[0, 0.04], [0.4, 0.5], [1, 1]],
      zoom: logZoom([[0, 1.15], [0.5, 1.4], [1, 1]]),
      az: [[0, 0], [1, 150]],
      incl: [[0, 25], [0.5, 60], [1, 40]],
    },
  },
  {
    id: 'merger-torn',
    fig: '11',
    title: 'Sketches, torn apart',
    sub: 'whole hand drawings, stretched and torn by the tides',
    kind: 'plate',
    shot: S('Sketches, torn apart', 7, {}, {}),
    surface: 'paper',
    seconds: 7,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [6, 14],
    path: {
      mTime: [[0, 0.04], [0.4, 0.5], [1, 1]],
      zoom: logZoom([[0, 1.3], [0.5, 1.3], [1, 1]]),
      az: [[0, -20], [1, 60]],
    },
  },
  {
    id: 'lens-ring',
    fig: '16',
    title: 'Lens: Einstein ring',
    sub: 'the source drifts across the lens: ring, arc, two images, ring; the camera pushes in on it',
    kind: 'plate',
    shot: S('Lens: Einstein ring', 7, {}, {}),
    surface: 'chalk',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 40,
    path: { closed: true, over: { lensSrc: [[0, 0], [0.5, 0.3], [1, 0]] }, zoom: logZoom([[0, 1.1], [0.5, 1.7], [1, 1.1]]) },
  },
  {
    id: 'lens-quasar',
    fig: '17',
    title: 'Lens: Einstein cross',
    sub: 'a quasar behind a lens: the four images travel round the cross as the source circles',
    kind: 'plate',
    shot: S('Lens: Einstein cross (quasar)', 7, { lensSrc: 0.08 }, {}),
    surface: 'chalk',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 40,
    path: { closed: true, over: { lensSrcA: turn(0, 360) }, zoom: logZoom([[0, 1.2], [0.5, 1.6], [1, 1.2]]) },
  },
  {
    id: 'lens-sketch',
    fig: '18',
    title: 'A sketch, lensed',
    sub: 'a hand drawing as the lensed source, stretched into arcs as it slides behind the lens',
    kind: 'plate',
    shot: S('A sketch, lensed', 7, {}, {}),
    surface: 'paper',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 40,
    path: { closed: true, over: { lensSrc: [[0, 0.05], [0.5, 0.4], [1, 0.05]] }, zoom: 1.1 },
  },
  {
    id: 'morph',
    fig: '12',
    title: 'A galaxy morphing',
    sub: 'one seed, parameters swept: pitch 10 to 26, a bar growing from nothing to 0.9, arm width opening',
    kind: 'plate',
    shot: S('Barred spiral', 11, { ...HERO, stars: 16000, knots: 0.6, incl: 20, fgstars: 0.1, field: 0.1 }, { zoom: 1.5 }),
    surface: 'paper',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 40,
    path: {
      closed: true,
      az: [[0, 0], [1, 40]],
      over: { pitch: [[0, 10], [0.5, 26], [1, 10]], bar: [[0, 0], [0.5, 0.9], [1, 0]], armWidth: [[0, 0.18], [0.5, 0.3], [1, 0.18]] },
    },
  },
  {
    id: 'shells',
    fig: '35',
    title: 'Shells forming',
    sub: 'a shell galaxy over time (shellTime 12 to 90) with a slow turn',
    kind: 'plate',
    shot: S('Shell galaxy', 7, {}, { zoom: 1.3 }),
    surface: 'paper',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [4, 10],
    path: { over: { shellTime: [[0, 12], [1, 90]] }, az: [[0, 0], [1, 60]] },
  },
  {
    id: 'deep-field',
    fig: '36',
    title: 'The deep field',
    sub: 'a long glide over a sky of drawn galaxies',
    kind: 'plate',
    shot: S('Deep field', 7, { field: 1, fgstars: 0.5 }, {}),
    surface: 'chalk',
    seconds: 7,
    fps: 18,
    size: 480,
    colours: 32,
    path: { closed: true, az: turn(0, 360), incl: [[0, 75], [0.5, 55], [1, 75]], zoom: logZoom([[0, 0.5], [0.5, 0.9], [1, 0.5]]) },
  },
  {
    id: 'star-dive',
    fig: '37',
    title: 'Pushing in on a star',
    sub: 'from the whole star to its drawn heart, and back',
    kind: 'plate',
    shot: S('Star: bright, with spikes', 7, {}, {}),
    surface: 'chalk',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 32,
    path: { closed: true, zoom: logZoom([[0, 1], [0.5, 9], [1, 1]]) },
  },
  {
    id: 'surfaces',
    fig: '13',
    title: 'Paper and Chalkboard',
    sub: 'one set of marks composited onto both surfaces; only the last, cheap pass changes',
    kind: 'wipe',
    shot: GALAXIES.spiral,
    surface: 'paper',
    seconds: 2.5,
    fps: 20,
    size: 480,
    colours: 64,
  },
  {
    id: 'breathe',
    fig: '19',
    title: 'The plates breathing',
    sub: 'the same marks printed in one ink, then in slipped colour plates, then in population colours',
    kind: 'breathe',
    shot: GALAXIES.populations,
    surface: 'paper',
    seconds: 6,
    fps: 18,
    size: 480,
    colours: 96,
    states: [{ plates: 'ink' }, { plates: 'slip' }, { plates: 'colour' }, { plates: 'slip' }],
  },
  {
    id: 'anatomy',
    fig: '15b',
    title: 'Drawn in, layer by layer',
    sub: 'dots, knots, strokes, drawings, stars and the sky arrive in turn, from the centre outwards, while the camera drifts',
    kind: 'anatomy',
    shot: ANATOMY.shot,
    surface: 'paper',
    seconds: 8,
    fps: 18,
    size: 480,
    colours: 40,
    hold: [4, 16],
    path: { az: [[0, -20], [1, 30]], incl: [[0, 40], [1, 24]], zoom: logZoom([[0, 1.3], [1, 1.5]]) },
  },
];

/** Size budgets for `npm run readme:check` (bytes). */
export const BUDGET = {
  gifMB: 3,
  stillMB: 1.2,
  totalMB: 50,
};

export { EASE, there };
