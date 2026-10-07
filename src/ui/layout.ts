/**
 * What the control panel holds, and where: v21's groups (`GROUPS`, app23.js:L1412–1435) and tabs
 * (L1587–1590), laid over the schema (src/core/schema.ts). The schema gives each control its kind,
 * range, step and unit; this file only says which groups there are, in which tab, in which order,
 * and what the choices are called. Nothing here is a range: a parameter that the schema changes
 * changes its control, and a parameter with a control that no group places lands in "More" (a
 * unit test keeps that group empty, so a new schema entry is placed on purpose).
 *
 * Features: the page shows controls for what the engine draws. A parameter that belongs to a
 * milestone that has not landed yet (the sky, the merger, the lens) is hidden until its flag in
 * `FEATURES` is switched on, which is the one line each of M7, M8 and M9 changes when it merges.
 * Everything here is pure (no DOM), so it is unit-tested.
 */
import type { ParamKey, Params } from '../core/params';
import { PARAM_KEYS } from '../core/params';
import { SCHEMA } from '../core/schema';

/** What the engine draws, by milestone; each flag is flipped by the milestone that lands it. */
export type FeatureName = 'stars' | 'merger' | 'lens';

/**
 * M7 (stars, artefacts, overlays, the sky), M8 (the merger, its timeline and the simulated
 * shells) and M9 (the lens) switch their flag on in the pull request that merges them.
 */
export const FEATURES: Record<FeatureName, boolean> = {
  stars: false,
  merger: false,
  lens: false,
};

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

export interface Group {
  id: string;
  title: string;
  tab: TabId;
  /** the controls, in order: sliders first, then choices, as v21 */
  items: readonly ParamKey[];
  /**
   * A switch that turns the group on: its other controls are disabled while it is off, and the
   * page says so. Used by the merger, the lens and the shells.
   */
  switch?: ParamKey;
}

/** v21's groups with the tab each sits in (TABOF, L1590), in the order the tabs show them. */
export const GROUPS: readonly Group[] = [
  {
    id: 'shape',
    title: 'Shape',
    tab: 'galaxy',
    items: ['bulge', 'bulgeSize', 'bulgeFlat', 'thick', 'halo'],
  },
  {
    id: 'arms',
    title: 'Arms',
    tab: 'galaxy',
    items: ['arms', 'pitch', 'armStrength', 'armWidth', 'flocc', 'armStyle'],
  },
  {
    id: 'bar',
    title: 'Bar and ring',
    tab: 'galaxy',
    items: ['bar', 'barLen', 'ring', 'ringR', 'barStyle', 'ringStyle'],
  },
  {
    id: 'stars',
    title: 'Stars',
    tab: 'galaxy',
    items: ['stars', 'stipple', 'knots', 'sparkle'],
  },
  {
    id: 'subject',
    title: 'Star or artefact',
    tab: 'galaxy',
    items: ['starBright', 'spikes', 'starRings', 'bleed', 'subject', 'artefact'],
  },
  {
    id: 'merger',
    title: 'Merger',
    tab: 'merger',
    switch: 'merger',
    items: [
      'merger',
      'mTime',
      'mRatio',
      'mPeri',
      'mStage',
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
  },
  {
    id: 'view',
    title: 'View',
    tab: 'sky',
    items: ['incl', 'az', 'pa', 'dust', 'winding'],
  },
  {
    id: 'field',
    title: 'In the field',
    tab: 'sky',
    items: ['ovStar', 'ovStarD', 'ovStarA', 'ovArtefact'],
  },
  {
    id: 'oddities',
    title: 'Oddities',
    tab: 'sky',
    items: ['companions', 'tail', 'lens', 'shells', 'fgstars', 'trails', 'arrow', 'jet'],
  },
  {
    id: 'creative',
    title: 'Creative',
    tab: 'sky',
    items: ['field', 'dustLines', 'bubbles', 'streams', 'distort'],
  },
  {
    id: 'lensing',
    title: 'Lensing',
    tab: 'sky',
    switch: 'lensOn',
    items: [
      'lensOn',
      'lensR',
      'lensSrc',
      'lensSrcA',
      'lensSize',
      'lensShear',
      'lensShearA',
      'lensStars',
      'lensQ',
      'lensAngle',
      'lensCore',
      'lensSource',
      'lensCluster',
      'lensDouble',
    ],
  },
  {
    id: 'shells',
    title: 'Shells',
    tab: 'sky',
    switch: 'shellsOn',
    items: ['shellsOn', 'shellTime', 'shellAxis', 'shellStars'],
  },
  {
    id: 'pen',
    title: 'Pen and variation',
    tab: 'ink',
    items: ['pen', 'vary'],
  },
  {
    id: 'mix',
    title: 'Stars and dust',
    tab: 'ink',
    items: ['starMix', 'dustScribble'],
  },
  {
    id: 'drawings',
    title: 'The drawings',
    tab: 'ink',
    items: ['lines', 'whole', 'envelope', 'outline', 'stroke', 'nuclear', 'rewind'],
  },
  {
    id: 'print',
    title: 'Print',
    tab: 'ink',
    items: ['plates'],
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
export function isBuilt(key: ParamKey, features: Record<FeatureName, boolean> = FEATURES): boolean {
  const f = KEY_FEATURE[key];
  return f === undefined || features[f];
}

/** A group with only the controls that are drawn and have one; null when none are left. */
export function visibleGroup(
  g: Group,
  features: Record<FeatureName, boolean> = FEATURES,
): Group | null {
  const items = g.items.filter((k) => SCHEMA[k].control && isBuilt(k, features));
  if (!items.length) return null;
  // a switch that is not drawn leaves the group without a reason to exist
  if (g.switch && !isBuilt(g.switch, features)) return null;
  return { ...g, items };
}

/** The groups of one tab that are visible, in order. */
export function groupsOf(tab: TabId, features: Record<FeatureName, boolean> = FEATURES): Group[] {
  return GROUPS.filter((g) => g.tab === tab)
    .map((g) => visibleGroup(g, features))
    .filter((g): g is Group => g !== null);
}

/**
 * The parameters that have a control in the reference and are placed in no group. Empty, and kept
 * empty by a unit test: a schema entry with `control: true` must be placed on purpose.
 */
export function unplaced(): ParamKey[] {
  const placed = new Set(GROUPS.flatMap((g) => g.items));
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

/** Which tabs have anything to show now (a tab with no group is hidden). */
export function visibleTabs(features: Record<FeatureName, boolean> = FEATURES): TabId[] {
  return TABS.filter((t) => t.id === 'choose' || groupsOf(t.id, features).length > 0).map(
    (t) => t.id,
  );
}

/** Whether a group's switch is on for these parameters. */
export function groupOn(g: Group, P: Params): boolean {
  return g.switch === undefined || Number(P[g.switch]) > 0;
}
