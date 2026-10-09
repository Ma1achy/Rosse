/**
 * What the control panel holds, and where: v21's groups (`GROUPS`, app23.js:L1412–1435) and tabs
 * (L1587–1590), laid over the schema (src/core/schema.ts). The schema gives each control its kind,
 * range, step and unit; this file only says which groups there are, in which tab, in which order,
 * and what the choices are called. Nothing here is a range: a parameter that the schema changes
 * changes its control, and a parameter with a control that no group places lands in "More" (a
 * unit test keeps that group empty, so a new schema entry is placed on purpose).
 *
 * Features: the page shows controls for what the engine draws. A parameter that belongs to a
 * milestone that has not landed yet (the sky, the lens) is hidden until the engine's capability
 * for it is on (src/render/capabilities.ts), the one line each of M7 and M9 changes when it merges.
 * Everything here is pure (no DOM), so it is unit-tested.
 */
import type { ParamKey, Params } from '../core/params';
import type { VectorAtlas } from '../marks/vector';
import { PARAM_KEYS } from '../core/params';
import { SCHEMA } from '../core/schema';

/**
 * What the engine draws, by milestone. The engine says it (`Engine.capabilities`, src/render/
 * capabilities.ts) and the page reads it, so the page cannot offer a control for what is not drawn.
 */
export type FeatureName = 'stars' | 'merger' | 'lens';

export type Features = Record<FeatureName, boolean>;

/** The milestone behind each feature, for the notes on the page. */
export const FEATURE_MILESTONE: Record<FeatureName, string> = {
  stars: 'M7',
  merger: 'M8',
  lens: 'M9',
};

const keysOf = (...ks: ParamKey[]) => ks;

/** The feature each gated parameter needs (every other parameter is drawn since M6). */
export const KEY_FEATURE: Partial<Record<ParamKey, FeatureName>> = Object.fromEntries([
  ...keysOf(
    'starMix',
    'field',
    'fgstars',
    'subject',
    'artefact',
    'starBright',
    'spikes',
    'starRings',
    'bleed',
    'ovStar',
    'ovStarD',
    'ovStarA',
    'ovArtefact',
  ).map((k) => [k, 'stars']),
  ...keysOf(
    'merger',
    'mWarp',
    'mTime',
    'mRatio',
    'mPeri',
    'mStage',
    'mSpin1',
    'mSpin2',
    'mFriction',
    'mStars',
    'mType1',
    'mType2',
    'mArms1',
    'mArms2',
    'mSize1',
    'mSize2',
    'mTilt',
    'mEcc',
    'mHorizon',
    'shellsOn',
    'shellTime',
    'shellAxis',
    'shellStars',
  ).map((k) => [k, 'merger']),
  ...keysOf(
    'lensOn',
    'lensSource',
    'lensR',
    'lensSrc',
    'lensSrcA',
    'lensShear',
    'lensShearA',
    'lensSize',
    'lensStars',
    'lensQ',
    'lensAngle',
    'lensCore',
    'lensCluster',
    'lensDouble',
  ).map((k) => [k, 'lens']),
]) as Partial<Record<ParamKey, FeatureName>>;

export type TabId = 'choose' | 'galaxy' | 'merger' | 'sky' | 'ink';

/** v21's tabs and what each is for (L1587–1590). */
export const TABS: readonly { id: TabId; label: string; hint: string }[] = [
  { id: 'choose', label: 'Choose', hint: 'a preset to start from' },
  { id: 'galaxy', label: 'Galaxy', hint: 'the galaxy itself: its shape, arms, bar and stars' },
  { id: 'merger', label: 'Merger', hint: 'two galaxies meeting, and what the tides do' },
  { id: 'sky', label: 'Sky', hint: 'how it is seen, and what is around it' },
  { id: 'ink', label: 'Ink', hint: 'how it is drawn: pen, stars, dust and print' },
];

/** An icon: a drawing of v21's library, by sheet and index, or by a word of its type or kind. */
export type IconSpec = readonly [VectorAtlas, number | string];

/**
 * One card of the recipe (v21's `COMPONENTS`, app23.js:L1456–1478): a part of the picture with a
 * name, a summary of its settings in words, its main controls, and more behind a disclosure. A part
 * with `on` can be taken out and added back; a `gate` part is always there, and its controls are
 * disabled while its first control (the switch) is off.
 */
export interface Component {
  id: string;
  tab: TabId;
  name: string;
  icon: IconSpec;
  /** the card is built by hand: the subject (a galaxy, a star, an artefact) */
  custom?: 'subject';
  /** taking the part out sets `key` to `offVal`; adding it back to its last value, or `onVal` */
  on?: { key: ParamKey; onVal: number | string; offVal: number | string };
  gate?: boolean;
  show?: (P: Params) => boolean;
  main: readonly ParamKey[];
  more?: readonly ParamKey[];
  summary: (P: Params) => string;
  /** open when the page first opens */
  open?: boolean;
}

const pct = (v: number) => `${String(Math.round(v * 100))}%`;
const isGalaxy = (P: Params) => P.subject === 'galaxy' && !P.merger;

/** v21's components, in v21's order, with the tab each sits in. */
export const COMPONENTS: readonly Component[] = [
  {
    id: 'subject',
    tab: 'galaxy',
    name: 'What it is',
    icon: ['whole', 'galaxy:spiral'],
    custom: 'subject',
    main: ['subject'],
    open: true,
    summary: (P) =>
      P.merger
        ? 'two galaxies, merging'
        : P.subject === 'star'
          ? 'a lone star'
          : P.subject === 'artefact'
            ? 'an artefact'
            : 'a single galaxy',
  },
  {
    id: 'star',
    tab: 'galaxy',
    name: 'The star or artefact',
    icon: ['sstars', 'plus'],
    show: (P) => P.subject === 'star' || P.subject === 'artefact',
    main: ['starBright', 'spikes'],
    more: ['starRings', 'bleed', 'artefact'],
    summary: (P) =>
      P.subject === 'artefact'
        ? optionLabel('artefact', P.artefact)
        : `brightness ${pct(P.starBright)}, spikes ${pct(P.spikes)}`,
  },
  {
    id: 'bulge',
    tab: 'galaxy',
    name: 'Bulge',
    icon: ['sstars', 'burst'],
    on: { key: 'bulge', onVal: 0.5, offVal: 0 },
    show: isGalaxy,
    main: ['bulge', 'bulgeSize'],
    more: ['bulgeFlat', 'bulgeAuto'],
    summary: (P) =>
      `${P.bulge > 0.7 ? 'dominant' : P.bulge > 0.35 ? 'prominent' : 'modest'}, ${P.bulgeFlat < 0.6 ? 'flattened' : 'round'}`,
  },
  {
    id: 'disc',
    tab: 'galaxy',
    name: 'Disc',
    icon: ['env', 'disc'],
    show: isGalaxy,
    main: ['thick', 'halo'],
    summary: (P) => `${P.thick > 0.5 ? 'thick' : 'thin'}${P.halo > 0.08 ? ', with a halo' : ''}`,
  },
  {
    id: 'arms',
    tab: 'galaxy',
    name: 'Spiral arms',
    icon: ['arms', 34],
    on: { key: 'arms', onVal: 2, offVal: 0 },
    show: isGalaxy,
    open: true,
    main: ['arms', 'pitch', 'armStrength'],
    more: ['armWidth', 'flocc', 'armStyle', 'winding'],
    summary: (P) => {
      const n = Math.round(P.arms);
      return `${String(n)} arm${n > 1 ? 's' : ''}, ${P.pitch < 14 ? 'tightly wound' : P.pitch > 26 ? 'open' : 'moderately wound'}, ${String(Math.round(P.pitch))}°${P.flocc > 0.4 ? ', flocculent' : ''}`;
    },
  },
  {
    id: 'bar',
    tab: 'galaxy',
    name: 'Bar',
    icon: ['bars', 0],
    on: { key: 'bar', onVal: 0.6, offVal: 0 },
    show: isGalaxy,
    main: ['bar', 'barLen'],
    more: ['barStyle'],
    summary: (P) =>
      `${P.bar > 0.7 ? 'strong' : P.bar > 0.35 ? 'clear' : 'weak'}, ${P.barLen > 0.55 ? 'long' : 'short'}`,
  },
  {
    id: 'ring',
    tab: 'galaxy',
    name: 'Ring',
    icon: ['rings', 0],
    on: { key: 'ring', onVal: 0.6, offVal: 0 },
    show: isGalaxy,
    main: ['ring', 'ringR'],
    more: ['ringStyle'],
    summary: (P) => `strength ${pct(P.ring)}, at radius ${P.ringR.toFixed(1)}`,
  },
  {
    id: 'dust',
    tab: 'galaxy',
    name: 'Dust',
    icon: ['penlines', 0],
    on: { key: 'dust', onVal: 0.5, offVal: 0 },
    show: (P) => P.subject === 'galaxy',
    main: ['dust', 'dustLines'],
    more: ['dustAuto'],
    summary: (P) =>
      `${P.dust > 0.6 ? 'heavy' : 'light'}${P.dustLines > 0.1 ? ', with dust lanes' : ''}`,
  },
  {
    id: 'stars',
    tab: 'galaxy',
    name: 'Stars and knots',
    icon: ['sstars', 'spark'],
    main: ['stars', 'knots'],
    more: ['stipple', 'sparkle'],
    summary: (P) =>
      `${Math.round(P.stars).toLocaleString('en-GB')} stars, ${P.knots > 0.5 ? 'plenty of knots' : P.knots > 0.15 ? 'a few knots' : 'no knots'}`,
  },
  {
    id: 'merger',
    tab: 'merger',
    name: 'The merger',
    icon: ['companions', 0],
    gate: true,
    open: true,
    main: ['merger', 'mTime', 'mStage', 'mRatio', 'mPeri'],
    more: [
      'mSpin1',
      'mSpin2',
      'mFriction',
      'mArms1',
      'mSize1',
      'mArms2',
      'mSize2',
      'mTilt',
      'mEcc',
      'mStars',
      'mType1',
      'mType2',
      'mWarp',
    ],
    summary: (P) =>
      P.merger
        ? `mass ratio ${P.mRatio.toFixed(2)}, pericentre ${P.mPeri.toFixed(1)}`
        : 'not a merger',
  },
  {
    id: 'camera',
    tab: 'sky',
    name: 'Camera',
    icon: ['misc', 'arrow'],
    open: true,
    main: ['incl', 'az', 'pa'],
    summary: (P) => `tilted ${String(Math.round(P.incl))}°, turned ${String(Math.round(P.pa))}°`,
  },
  {
    id: 'lens',
    tab: 'sky',
    name: 'Lensing',
    icon: ['arcs', 'einstein-ring'],
    on: { key: 'lensOn', onVal: 1, offVal: 0 },
    main: ['lensR', 'lensSrc', 'lensSize'],
    more: [
      'lensSource',
      'lensCluster',
      'lensDouble',
      'lensSrcA',
      'lensShear',
      'lensShearA',
      'lensStars',
      'lensQ',
      'lensAngle',
      'lensCore',
    ],
    summary: (P) =>
      `${P.lensCluster ? 'a galaxy cluster' : P.lensSource === 'quasar' ? 'a lensed quasar' : P.lensDouble ? 'two sources behind' : 'a galaxy behind'}, Einstein radius ${P.lensR.toFixed(1)}`,
  },
  {
    id: 'fgstar',
    tab: 'sky',
    name: 'A foreground star',
    icon: ['sstars', 'asterisk'],
    on: { key: 'ovStar', onVal: 0.7, offVal: 0 },
    main: ['ovStar', 'ovStarD', 'ovStarA'],
    summary: (P) =>
      `brightness ${pct(P.ovStar)}, ${P.ovStarD < 0.6 ? 'on top of the galaxy' : 'beside it'}`,
  },
  {
    id: 'artefact',
    tab: 'sky',
    name: 'An artefact',
    icon: ['trails', 'trail'],
    on: { key: 'ovArtefact', onVal: 'trail', offVal: 'none' },
    main: ['ovArtefact'],
    summary: (P) => optionLabel('ovArtefact', P.ovArtefact),
  },
  {
    id: 'shells',
    tab: 'sky',
    name: 'Shells',
    icon: ['shells', 0],
    on: { key: 'shellsOn', onVal: 1, offVal: 0 },
    main: ['shellTime', 'shellAxis', 'shellStars'],
    summary: () => 'shells from a galaxy it swallowed',
  },
  {
    id: 'odd',
    tab: 'sky',
    name: 'Companions and oddities',
    icon: ['companions', 0],
    main: ['companions', 'tail'],
    more: ['lens', 'shells', 'fgstars', 'trails', 'arrow', 'jet'],
    summary: (P) => {
      const o: string[] = [];
      if (P.companions > 0.05) o.push('companions');
      if (P.tail > 0.05) o.push('a tidal tail');
      if (P.lens > 0.05) o.push('drawn arcs');
      if (P.fgstars > 0.05) o.push('field stars');
      if (P.trails > 0.05) o.push('trails');
      return o.length ? o.join(', ') : 'none';
    },
  },
  {
    id: 'field',
    tab: 'sky',
    name: 'The deep field',
    icon: ['whole', 'galaxy:flocculent'],
    main: ['field', 'bubbles'],
    more: ['streams', 'distort'],
    summary: (P) => (P.field > 0.05 ? `galaxies behind, ${pct(P.field)}` : 'a bare sky'),
  },
  {
    id: 'pen',
    tab: 'ink',
    name: 'Pen',
    icon: ['penlines', 3],
    open: true,
    main: ['pen', 'vary'],
    summary: (P) => `line weight ${P.pen.toFixed(1)}, variation ${pct(P.vary)}`,
  },
  {
    id: 'inkstars',
    tab: 'ink',
    name: 'Stars and dust',
    icon: ['sstars', 'asterisk'],
    main: ['starMix', 'dustScribble'],
    summary: (P) => `drawn stars ${pct(P.starMix)}, hatching ${pct(P.dustScribble)}`,
  },
  {
    id: 'drawings',
    tab: 'ink',
    name: 'The drawings',
    icon: ['whole', 'galaxy:spiral'],
    main: ['lines', 'whole', 'envelope', 'outline'],
    more: ['stroke', 'nuclear', 'rewind'],
    summary: () => 'which kinds of drawing are used',
  },
  {
    id: 'print',
    tab: 'ink',
    name: 'Print',
    icon: ['misc', 'spring'],
    open: true,
    main: ['plates'],
    summary: (P) => optionLabel('plates', P.plates),
  },
];

/**
 * Switches that v21 shows as off/on buttons although the parameter is a strength: the value the
 * button sets (`lines` on is 0.8, the others 1). Any value above 0 reads as on.
 */
export const TOGGLES: Partial<Record<ParamKey, number>> = {
  lines: 0.8,
  whole: 1,
  envelope: 1,
  outline: 1,
};

const ONOFF: Record<string, string> = { '0': 'off', '1': 'on' };

/** What v21 calls each choice (L1412–1435); anything not listed shows its own value. */
export const OPTION_LABELS: Partial<Record<ParamKey, Record<string, string>>> = {
  armStyle: { ribbons: 'straight strokes, bent', drawn: 'drawn curved arms', none: 'stars only' },
  barStyle: { drawn: 'a drawn bar', ribbon: 'a stroke' },
  ringStyle: { drawn: 'a drawn ring', ribbon: 'a stroke' },
  subject: { galaxy: 'a galaxy', star: 'a star', artefact: 'an artefact' },
  artefact: { trail: 'satellite trail', ghost: 'ghost reflection', cosmic: 'cosmic rays' },
  ovArtefact: {
    none: 'none',
    trail: 'satellite trail',
    ghost: 'ghost reflection',
    cosmic: 'cosmic rays',
  },
  winding: { '1': 'S-wise', '-1': 'Z-wise' },
  lensSource: { galaxy: 'a small galaxy', drawing: 'a drawn galaxy', quasar: 'a quasar' },
  plates: { ink: 'ink', slip: 'slipped CMY plates', colour: 'colour by population' },
  merger: ONOFF,
  nuclear: ONOFF,
  rewind: ONOFF,
  dustAuto: ONOFF,
  bulgeAuto: ONOFF,
  jet: ONOFF,
  mWarp: ONOFF,
  lensCluster: ONOFF,
  lensDouble: ONOFF,
  lensOn: ONOFF,
  shellsOn: ONOFF,
};

/** The label of one option of a choice. */
export function optionLabel(key: ParamKey, option: string | number): string {
  return OPTION_LABELS[key]?.[String(option)] ?? String(option);
}

/** Whether the engine draws what a parameter controls. */
export function isBuilt(key: ParamKey, features: Features): boolean {
  const f = KEY_FEATURE[key];
  return f === undefined || features[f];
}

/** A component with only the controls that are drawn; null when none are left. */
export function visibleComponent(c: Component, features: Features): Component | null {
  const keep = (ks: readonly ParamKey[]) =>
    ks.filter((k) => SCHEMA[k].control && isBuilt(k, features));
  const main = keep(c.main);
  const more = keep(c.more ?? []);
  if (!main.length && !more.length) return null;
  // a part switched by a key that is not drawn has no reason to exist
  if (c.on && !isBuilt(c.on.key, features)) return null;
  if (c.gate && !isBuilt(c.main[0] as ParamKey, features)) return null;
  // the subject has nothing to choose until there is more than a galaxy
  if (c.custom === 'subject' && !features.stars) return null;
  return { ...c, main, more };
}

/** The components of one tab that are drawn, in order. */
export function componentsOf(tab: TabId, features: Features): Component[] {
  return COMPONENTS.filter((c) => c.tab === tab)
    .map((c) => visibleComponent(c, features))
    .filter((c): c is Component => c !== null);
}

/**
 * The parameters that have a control in the reference and are placed in no component. Empty, and
 * kept empty by a unit test: a schema entry with `control: true` must be placed on purpose.
 */
export function unplaced(): ParamKey[] {
  // a part's switch (`on`) is its Take out and Add buttons
  const placed = new Set(
    COMPONENTS.flatMap((c) => [...c.main, ...(c.more ?? []), ...(c.on ? [c.on.key] : [])]),
  );
  return PARAM_KEYS.filter((k) => SCHEMA[k].control && !placed.has(k));
}

/** The decimals a step needs (0.005 → 3, 0.5 → 1, 1 → 0). */
export function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** A value as the number box shows it. */
export function formatValue(key: ParamKey, v: number): string {
  const s = SCHEMA[key];
  return s.kind === 'number' ? v.toFixed(decimalsOf(s.step)) : String(v);
}

/** The end labels of a slider (v21's `fmtN`: thousands as k). */
export function endLabel(v: number, step: number): string {
  const dec = decimalsOf(step);
  return Math.abs(v) >= 1000 ? `${String(v / 1000)}k` : String(+v.toFixed(dec));
}

/** Which tabs have anything to show now (a tab with no component is hidden). */
export function visibleTabs(features: Features): TabId[] {
  return TABS.filter((t) => t.id === 'choose' || componentsOf(t.id, features).length > 0).map(
    (t) => t.id,
  );
}

/** Whether a part is in the picture: no switch, or its switch is not at its off value. */
export function isOn(c: Component, P: Params): boolean {
  if (c.gate) return Number(P[c.main[0] as ParamKey]) > 0;
  if (!c.on) return true;
  const v = P[c.on.key];
  return typeof c.on.offVal === 'number' ? Number(v) > 0.02 : v !== c.on.offVal;
}
