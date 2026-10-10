/**
 * Parameter schema: the range, step, unit and cache tier of every parameter, used to validate input
 * (URLs, saved drawings, presets), to clamp values, and later to build the controls (src/ui/, M11).
 *
 * Ranges come from the reference's controls (`GROUPS`, app23.js:L1412–1435, built by
 * `buildControls`, app23.js:L1537). Thirteen keys of `DEF` have no control in the reference
 * (`seed`, `winding`, `kind`, `mBulge`, `mBar1`, `mBar2`, `mHorizon`, `unwrap`, `sersicN`, `re`,
 * `patchy`, `ringOnlyLines`, `irr`): they are set by presets and by `fromVotes`, and their ranges
 * here come from those uses (marked `control: false`).
 *
 * Tiers (ADR 0010): a change marks its tier and every tier below it dirty.
 * - `view`: the camera (`incl`, `az`, `pa`, `winding`) and the merger timeline `mTime`. An `incl`
 *   change that changes a discrete switch of structure also dirties the model; see
 *   `structureKey` in src/view/camera.ts (ADR 0017).
 * - `present`: the plates mode.
 * - `model`: everything else.
 */
import { structureKey } from '../view/camera';
import { DEF, PARAM_KEYS, type ParamKey, type Params } from './params';

export type Tier = 'model' | 'view' | 'present';

interface Common {
  tier: Tier;
  /** whether the reference has a control for it */
  control: boolean;
  label: string;
}

export interface NumberSpec extends Common {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface ChoiceSpec extends Common {
  kind: 'choice';
  options: readonly (string | number)[];
}

export type ParamSpec = NumberSpec | ChoiceSpec;

const num = (
  label: string,
  min: number,
  max: number,
  step: number,
  extra: { unit?: string; tier?: Tier; control?: boolean } = {},
): NumberSpec => ({
  kind: 'number',
  label,
  min,
  max,
  step,
  tier: extra.tier ?? 'model',
  control: extra.control ?? true,
  ...(extra.unit ? { unit: extra.unit } : {}),
});

const choice = (
  label: string,
  options: readonly (string | number)[],
  extra: { tier?: Tier; control?: boolean } = {},
): ChoiceSpec => ({
  kind: 'choice',
  label,
  options,
  tier: extra.tier ?? 'model',
  control: extra.control ?? true,
});

const off = { control: false } as const;
const ONOFF = [0, 1] as const;
const MTYPES = ['spiral', 'lenticular', 'elliptical'] as const;

export const SCHEMA: { readonly [K in ParamKey]: ParamSpec } = {
  seed: num('Seed', 1, 9999, 1, off),
  stars: num('Stars sampled', 2000, 40000, 500),
  bulge: num('Bulge fraction', 0, 1, 0.01),
  bulgeSize: num('Bulge size', 0.2, 1.4, 0.01),
  bulgeFlat: num('Bulge roundness', 0.3, 1, 0.01),
  thick: num('Disc thickness', 0.02, 0.3, 0.005),
  arms: num('Number of arms', 0, 6, 1),
  pitch: num('Pitch angle', 5, 45, 0.5, { unit: '°' }),
  armStrength: num('Arm contrast', 0, 1, 0.01),
  armWidth: num('Arm width', 0.12, 0.8, 0.01),
  flocc: num('Flocculence', 0, 1, 0.01),
  bar: num('Bar strength', 0, 1, 0.01),
  barLen: num('Bar length', 0.2, 0.9, 0.01),
  ring: num('Ring', 0, 1, 0.01),
  ringR: num('Ring radius', 0.8, 2.8, 0.01),
  halo: num('Halo stars', 0, 1, 0.01),
  dust: num('Dust lane', 0, 1, 0.01),
  knots: num('Knots on arms', 0, 1, 0.01),
  sparkle: num('Bright stars', 0, 1, 0.01),
  incl: num('Inclination', 0, 180, 0.5, { unit: '°', tier: 'view' }),
  pa: num('Roll', 0, 360, 1, { unit: '°', tier: 'view' }),
  winding: choice('Winding', [1, -1], { tier: 'view' }),
  // a toggle in the reference's controls (0 or 0.8), a strength in presets (0.5, 0.9)
  lines: num('Line strokes', 0, 1, 0.01),
  stroke: choice('Stroke kind', [
    'mixed',
    'plain',
    'beaded',
    'spurred',
    'broken',
    'dotted',
    'faint',
  ]),
  stipple: num('Stipple density', 0, 1.5, 0.01),
  outline: num('Disc outline arcs', 0, 1, 0.01),
  armStyle: choice('Arms drawn as', ['ribbons', 'drawn', 'none']),
  barStyle: choice('Bar', ['drawn', 'ribbon']),
  ringStyle: choice('Ring', ['drawn', 'ribbon']),
  whole: num('A whole drawing behind', 0, 1, 0.01),
  envelope: num('Halo or disc drawing', 0, 1, 0.01),
  nuclear: choice('Nuclear spiral', ONOFF),
  companions: num('Companions', 0, 1, 0.01),
  lens: num('Drawn arcs', 0, 1, 0.01, off),
  shells: num('Drawn shells', 0, 1, 0.01, off),
  tail: num('Tidal tail', 0, 1, 0.01),
  fgstars: num('Foreground stars', 0, 1, 0.01),
  trails: num('Satellite trail, cosmic rays', 0, 1, 0.01, off),
  arrow: num('A stray arrow through the deep field', 0, 1, 0.01, off),
  plates: choice('Plates', ['ink', 'slip', 'colour'], { tier: 'present' }),
  kind: choice(
    'Whole drawing type',
    [
      'auto',
      'smooth',
      'smooth:elongated',
      'edge-on',
      'edge-on:dust-lane',
      'edge-on:thick',
      'galaxy:spiral',
      'galaxy:barred-spiral',
      'galaxy:flocculent',
      'merger',
    ],
    off,
  ),
  pen: num('Pen weight', 1, 5, 0.1, { unit: ' px' }),
  vary: num('Variation', 0, 1, 0.01),
  merger: choice('Merger simulation', ONOFF),
  mRatio: num('Mass ratio', 0.1, 1, 0.01),
  mPeri: num('Closest approach', 0.6, 3, 0.01),
  mStage: num('Time since closest approach', -1.5, 6, 0.05),
  mSpin1: num('Big disc tilt', 0, 180, 1, { unit: '°' }),
  mSpin2: num('Small disc tilt', 0, 180, 1, { unit: '°' }),
  mFriction: num('Merging (friction)', 0, 1, 0.01),
  mStars: num('Stars simulated', 4000, 30000, 500),
  mBulge: num('Merger bulge', 0, 1, 0.01, off),
  mType1: choice('Big galaxy', MTYPES),
  mType2: choice('Small galaxy', MTYPES),
  mArms1: num('Big galaxy’s arms', 1, 4, 1),
  mArms2: num('Small galaxy’s arms', 1, 4, 1),
  mSize1: num('Big galaxy’s size', 0.6, 1.5, 0.01),
  mSize2: num('Small galaxy’s size', 0.6, 1.5, 0.01),
  mBar1: num('Big galaxy’s bar', 0, 1, 0.01, off),
  mBar2: num('Small galaxy’s bar', 0, 1, 0.01, off),
  mTilt: num('Orbit tilt', 0, 90, 1, { unit: '°' }),
  mEcc: num('Encounter speed (bound ← → fly-by)', 0.8, 1.2, 0.01),
  mHorizon: num('Timeline horizon', 1, 30, 1, off),
  subject: choice('Draw', ['galaxy', 'star', 'artefact']),
  artefact: choice('Artefact', ['trail', 'ghost', 'cosmic']),
  starBright: num('Brightness', 0, 1, 0.01),
  spikes: num('Diffraction spikes', 0, 1, 0.01),
  starRings: num('Rings in the glare', 0, 1, 0.01),
  bleed: num('Bleed column', 0, 1, 0.01),
  ovStar: num('A bright foreground star', 0, 1, 0.01),
  ovStarD: num('Its distance from the galaxy', 0, 3, 0.05),
  ovStarA: num('Its direction', 0, 360, 1, { unit: '°' }),
  ovArtefact: choice('An artefact across it', ['none', 'trail', 'ghost', 'cosmic']),
  // the timeline's end can reach 30 (`mHorizon`, v21's tlSetEnd, app23.js:L1659), so does the moment
  mTime: num('Moment in the merger', 0, 30, 0.005, { tier: 'view' }),
  az: num('Orbit round the axis', 0, 360, 1, { unit: '°', tier: 'view' }),
  starMix: num('Drawn stars among the dots', 0, 1, 0.01),
  dustScribble: num('Dust lanes, hatched with pen lines', 0, 1, 0.01),
  field: num('Deep field of drawn galaxies', 0, 1, 0.01),
  dustLines: num('Dust carved by pen lines', 0, 1, 0.01),
  bubbles: num('Closed curves as bubbles', 0, 1, 0.01, off),
  streams: num('Stellar streams from pen lines', 0, 1, 0.01),
  distort: num('Hand wobble', 0, 1, 0.01),
  rewind: choice('Rewind the drawings to this pitch', ONOFF),
  unwrap: choice('Log-polar view (forced off)', [0], off),
  lensSource: choice('What gets lensed', ['galaxy', 'drawing', 'quasar']),
  jet: num('Jets', 0, 1, 0.01),
  mWarp: choice('Tear the drawings in mergers', ONOFF),
  sersicN: num('Sérsic index', 0, 8, 0.1, off),
  re: num('Effective radius', 0.1, 3, 0.01, off),
  patchy: num('Patchiness', 0, 1, 0.01, off),
  ringOnlyLines: choice('Ring drawn with lines only', ONOFF, off),
  irr: num('Irregularity', 0, 1, 0.01, off),
  lensOn: choice('Lensed background galaxy', ONOFF),
  lensR: num('Einstein radius', 0.6, 2.2, 0.01),
  lensSrc: num('Source offset', 0, 0.8, 0.005),
  lensSrcA: num('Source direction', 0, 360, 1, { unit: '°' }),
  lensShear: num('External shear', 0, 0.3, 0.005),
  lensShearA: num('Shear angle', 0, 180, 1, { unit: '°' }),
  lensSize: num('Source size', 0.05, 0.6, 0.005),
  lensStars: num('Dots in the arcs', 500, 12000, 100),
  lensQ: num('Lens axis ratio', 0.4, 1, 0.01),
  lensAngle: num('Lens angle', 0, 180, 1, { unit: '°' }),
  lensCore: num('Lens core', 0, 0.4, 0.005),
  lensCluster: choice('A galaxy cluster', ONOFF),
  lensDouble: choice('A second source (double ring)', ONOFF),
  shellsOn: choice('Shells from a radial merger', ONOFF),
  shellTime: num('Time since infall', 20, 140, 1),
  shellAxis: num('Infall direction', 0, 180, 1, { unit: '°' }),
  shellStars: num('Stars', 1000, 12000, 250),
  dustAuto: choice('Natural dust', ONOFF),
  bulgeAuto: choice('Natural bulge', ONOFF),
  starsAuto: choice('Natural star spread', ONOFF),
  cosmicAuto: choice('Natural cosmic rays', ONOFF),
  lineWorld: choice('Line-work in 3D', ONOFF),
  strokesAuto: choice('Natural arm strokes', ONOFF),
  thinAuto: choice('Thin disc', ONOFF),
  popAuto: choice('Stellar populations', ONOFF),
  peanut: choice('Peanut bulge (barred)', ONOFF),
  occlAuto: choice('Natural star occlusion', ONOFF),
  lensLock: choice('Lensed source follows the orbit', [0, 1, 2]),
  depthAuto: choice('Depth', [0, 1, 2], { tier: 'view' }),
};

/** The tier a parameter belongs to. */
export function tierOf(key: ParamKey): Tier {
  return SCHEMA[key].tier;
}

const RANK: Record<Tier, number> = { model: 0, view: 1, present: 2 };

// incE and its buckets live with the camera (src/view/camera.ts); re-exported for the schema's
// users. camera.ts imports only types from core, so there is no cycle at run time.
export { incE, inclBucket } from '../view/camera';

/**
 * The highest tier that must be rebuilt when going from `a` to `b` (null when nothing changed).
 * A change marks its tier and every tier below it (model → view → present).
 */
export function dirtyTier(a: Params, b: Params): Tier | null {
  let best: Tier | null = null;
  for (const k of PARAM_KEYS) {
    if (a[k] === b[k]) continue;
    let t = tierOf(k);
    // a switch of structure on the inclination (incE thresholds, L1000's cos i): the model
    if (k === 'incl' && structureKey(a) !== structureKey(b)) t = 'model';
    if (best === null || RANK[t] < RANK[best]) best = t;
  }
  return best;
}

/** Clamps numbers to their range and checks choices; throws on a value that cannot be repaired. */
export function sanitise(p: Params): Params {
  const out = { ...p } as Record<ParamKey, number | string>;
  for (const k of PARAM_KEYS) {
    const s = SCHEMA[k];
    const v = out[k];
    if (s.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${k}: not a number`);
      // the camera angles wrap rather than clamp in the reference's orbit control
      out[k] = Math.min(s.max, Math.max(s.min, v));
    } else if (!s.options.includes(v)) {
      // numeric switches in the reference are truthy tests; keep any number for them
      if (!(typeof v === 'number' && s.options.every((o) => typeof o === 'number')))
        throw new Error(`${k}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.options)}`);
    }
  }
  return out as Params;
}

export { DEF };
