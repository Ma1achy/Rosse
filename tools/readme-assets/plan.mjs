// @ts-check
/**
 * Everything the README's pictures are made of: which galaxy, which seed, which parameters. A
 * picture is a pure function of this file and the engine, so `npm run readme:assets` re-draws
 * the same pictures (on SwiftShader, bit for bit on one machine; another adapter may differ by
 * a mark here and there, docs/open-questions.md Q14).
 *
 * The parameters are the engine's own (src/core/params.ts) laid over a preset, as the page's
 * controls would set them. They are tuned by eye for a clean plate:
 *  - `fgstars: 0, field: 0`: the foreground stars and the deep field belong to the sky (M7),
 *    which is not in the engine yet, so the plates show the galaxy alone;
 *  - more stars (`stars`) and firmer arms (`armStrength: 1`, a narrower `armWidth`) so the
 *    structure reads at README size.
 */

/** The sky is M7's; keep it out of the pictures until it lands. */
const NO_SKY = { fgstars: 0, field: 0 };

/**
 * Named galaxies. `preset` is a preset name (src/core/presets.ts); `over` is laid over it.
 * @type {Record<string, {preset: string, seed: number, over?: Record<string, unknown>, cam?: {az?: number, incl?: number, pa?: number}}>}
 */
export const GALAXIES = {
  // a grand-design spiral, seen nearly face-on
  spiral: {
    preset: 'Grand design',
    seed: 12,
    over: {
      ...NO_SKY,
      stars: 14000,
      armStrength: 1,
      armWidth: 0.2,
      pitch: 14,
      lines: 1,
      knots: 0.5,
      incl: 15,
      bulge: 0.2,
      halo: 0.05,
    },
  },
  // the same preset, a looser pitch and a tilt
  spiralTilted: {
    preset: 'Grand design',
    seed: 7,
    over: {
      ...NO_SKY,
      stars: 16000,
      armStrength: 1,
      armWidth: 0.22,
      lines: 1,
      knots: 0.6,
      incl: 22,
      bulge: 0.15,
    },
  },
  barred: {
    preset: 'Barred spiral',
    seed: 11,
    over: { ...NO_SKY, stars: 16000, armStrength: 1, lines: 1, knots: 0.6, incl: 25 },
  },
  ringed: {
    preset: 'Ringed',
    seed: 3,
    over: { ...NO_SKY, stars: 16000, incl: 35 },
  },
  edgeOn: {
    preset: 'Edge-on with dust',
    seed: 4,
    over: {
      ...NO_SKY,
      stars: 20000,
      incl: 80,
      pa: 170,
      thick: 0.1,
      bulge: 0.55,
      dust: 1,
      dustScribble: 1,
      dustLines: 1,
    },
  },
  elliptical: {
    preset: 'Smooth, round',
    seed: 7,
    over: { ...NO_SKY, stars: 18000 },
  },
  tight: {
    preset: 'Tightly wound',
    seed: 7,
    over: { ...NO_SKY, stars: 16000, armStrength: 1, armWidth: 0.25, incl: 30 },
  },
  flocculent: {
    preset: 'Flocculent',
    seed: 7,
    over: { ...NO_SKY, stars: 16000, incl: 20 },
  },
  colour: {
    preset: 'Stellar populations',
    seed: 7,
    over: { ...NO_SKY, stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25 },
  },
  slipped: {
    preset: 'Plates slipped',
    seed: 7,
    over: { ...NO_SKY, stars: 16000, armStrength: 1, armWidth: 0.25, incl: 25 },
  },
  mice: {
    preset: 'Merger: the Mice',
    seed: 7,
    over: { ...NO_SKY },
  },
  longTails: {
    preset: 'Merger: long tails',
    seed: 7,
    over: { ...NO_SKY },
  },
};

/**
 * Stills: `id`, the galaxy, the view (zoom, camera, merger moment), the size (plate CSS px and
 * device pixel ratio) and what to keep: `plate-paper`, `plate-chalk` (composited as the page
 * shows them) and `ink` (the ink's alpha alone, for the posters).
 * @typedef {{id: string, galaxy: string, zoom?: number, az?: number, incl?: number, pa?: number,
 *   mTime?: number, dpr?: number, keep: Array<'plate-paper' | 'plate-chalk' | 'ink'>}} Still
 * @type {Still[]}
 */
export const STILLS = [
  // the banner
  {
    id: 'banner-spiral',
    galaxy: 'spiral',
    zoom: 1.35,
    dpr: 2,
    keep: ['ink', 'plate-chalk', 'plate-paper'],
  },
  { id: 'banner-barred', galaxy: 'barred', zoom: 1.5, dpr: 2, keep: ['ink', 'plate-paper'] },
  // the gallery (800 px plates)
  { id: 'g-spiral', galaxy: 'spiral', zoom: 1.35, keep: ['plate-paper'] },
  { id: 'g-spiral-chalk', galaxy: 'spiralTilted', zoom: 1.5, keep: ['plate-chalk'] },
  { id: 'g-barred', galaxy: 'barred', zoom: 1.5, keep: ['plate-paper'] },
  { id: 'g-ringed', galaxy: 'ringed', zoom: 1.8, keep: ['plate-paper'] },
  { id: 'g-edge-on', galaxy: 'edgeOn', zoom: 1.8, keep: ['plate-paper'] },
  { id: 'g-elliptical', galaxy: 'elliptical', zoom: 1.6, keep: ['plate-paper'] },
  { id: 'g-tight', galaxy: 'tight', zoom: 1.5, keep: ['plate-paper'] },
  { id: 'g-flocculent', galaxy: 'flocculent', zoom: 1.4, keep: ['plate-paper'] },
  { id: 'g-colour', galaxy: 'colour', zoom: 1.5, keep: ['plate-paper'] },
  { id: 'g-slipped', galaxy: 'slipped', zoom: 1.5, keep: ['plate-paper'] },
  { id: 'g-mice', galaxy: 'mice', keep: ['plate-paper'] },
  { id: 'g-long-tails', galaxy: 'longTails', keep: ['plate-paper'] },
  // the same plate at three zooms: the pen keeps its weight, the marks stay marks
  { id: 'z-1', galaxy: 'tight', zoom: 1.5, keep: ['plate-paper'] },
  { id: 'z-2', galaxy: 'tight', zoom: 4, keep: ['plate-paper'] },
  { id: 'z-3', galaxy: 'tight', zoom: 9, keep: ['plate-paper'] },
];

/** The preset names the README table lists, for the record. */
export const PLATE_CSS = 800;

/**
 * The GIFs: frames drawn at 800 px, scaled to `size`, palette of `colours`, `fps` frames a second.
 * `view(t)` is the view at t in [0, 1).
 *  - orbit: the camera turns once about the galaxy's axis (`az`), tilted; the loop closes
 *  - merger: the timeline of a merger, `mTime` from 0 to 1 (the loop jumps back to the start)
 *  - surfaces: a line sweeps across one plate; Chalkboard to its left, Paper to its right
 * @type {Array<{id: string, galaxy: string, kind: 'plate' | 'wipe', surface: 'paper' | 'chalk',
 *   frames: number, fps: number, size: number, colours: number,
 *   view: (t: number) => {zoom?: number, az?: number, incl?: number, pa?: number, mTime?: number}}>}
 */
export const GIFS = [
  {
    id: 'orbit',
    galaxy: 'spiralTilted',
    kind: 'plate',
    surface: 'chalk',
    frames: 40,
    fps: 16,
    size: 440,
    colours: 32,
    view: (t) => ({ zoom: 1.5, incl: 58, pa: 20, az: 360 * t }),
  },
  {
    id: 'merger',
    galaxy: 'mice',
    kind: 'plate',
    surface: 'paper',
    frames: 48,
    fps: 16,
    size: 480,
    colours: 48,
    view: (t) => ({ zoom: 1, mTime: 0.04 + 0.96 * t }),
  },
  {
    id: 'surfaces',
    galaxy: 'spiral',
    kind: 'wipe',
    surface: 'paper',
    frames: 48,
    fps: 20,
    size: 480,
    colours: 64,
    view: () => ({ zoom: 1.35 }),
  },
];
