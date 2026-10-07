/**
 * The page's state in its URL, so a link shares a drawing: `?preset=`, `?seed=`, the camera
 * (`az`, `incl`, `pa`, `zoom`, as src/ui/url.ts), `?surface=paper|chalk`, and any parameter by its
 * own name (`?arms=3&pitch=14&stroke=beaded`). Only what differs from the named preset at that seed
 * is written, so a link stays short and keeps meaning the same preset's other values.
 *
 * Reading is as forgiving as the camera's: a missing, empty or non-numeric value is absent, a
 * number is clamped to its range in the schema, and a choice that is not one of the options is
 * ignored. Other query parameters (`backend`, `present`, `variant`) are the page's own and are
 * left alone.
 */
import type { ParamKey, Params } from '../core/params';
import { PARAM_KEYS } from '../core/params';
import { PRESET_NAMES } from '../core/presets';
import { needs } from './describe';
import { isBuilt, type Features } from './layout';
import { SCHEMA } from '../core/schema';
import { clamp } from '../view/camera';
import { parseUrlView, urlNumber, type UrlView } from './url';

export type Surface = 'paper' | 'chalk';

export interface UrlState {
  preset?: string;
  /** a galaxy that is not a preset (M12's catalogue and real galaxies), as the page wrote it */
  from?: string;
  seed?: number;
  /** parameters that the link sets (not the camera angles, which are in `view`) */
  overrides: Partial<Params>;
  view: UrlView;
  surface?: Surface;
}

/** The query keys the page writes, and so replaces. */
const CAMERA: readonly ParamKey[] = ['az', 'incl', 'pa'];
const MANAGED = new Set<string>([
  'preset',
  'from',
  'seed',
  'zoom',
  'surface',
  'features',
  ...PARAM_KEYS,
]);

/** One parameter from its text, or undefined when it is absent or not valid. */
export function parseParam(key: ParamKey, raw: string | null): number | string | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const s = SCHEMA[key];
  if (s.kind === 'number') {
    const v = Number(raw);
    return Number.isFinite(v) ? clamp(v, s.min, s.max) : undefined;
  }
  return s.options.find((o) => String(o) === raw);
}

/**
 * What a link says. A preset or a parameter that the engine does not draw (`features`: what the
 * engine reports it draws) is dropped, so a link cannot show a control or a drawing that is not
 * there.
 */
export function parseUrlState(params: URLSearchParams, features: Features): UrlState {
  const out: UrlState = { overrides: {}, view: parseUrlView(params) };
  const preset = params.get('preset');
  if (preset !== null && PRESET_NAMES.includes(preset) && needs(preset).every((f) => features[f]))
    out.preset = preset;
  const from = params.get('from');
  if (from !== null && from.trim() !== '') out.from = from;
  const seed = urlNumber(params, 'seed');
  if (seed !== undefined) out.seed = clamp(Math.round(seed), 1, 9999);
  const surface = params.get('surface');
  if (surface === 'paper' || surface === 'chalk') out.surface = surface;
  const o = out.overrides as Record<string, number | string>;
  for (const k of PARAM_KEYS) {
    if (k === 'seed' || CAMERA.includes(k) || !isBuilt(k, features)) continue;
    const v = parseParam(k, params.get(k));
    if (v !== undefined) o[k] = v;
  }
  return out;
}

/** A number written short and exactly enough (at most 4 decimals, no trailing zeros). */
export function writeNumber(v: number): string {
  return String(+v.toFixed(4));
}

export interface UrlInput {
  /** the preset, or null for a galaxy that is not one (then `from` says which) */
  preset: string | null;
  from?: string;
  /** the preset's own parameters at this seed (what a link without overrides would draw) */
  base: Params;
  P: Params;
  zoom: number;
  surface: Surface;
}

/**
 * The query string of a state: the managed keys are rewritten and the page's own are kept. The
 * camera is written when it differs from the preset's, the zoom when it is not 1.
 */
export function buildQuery(input: UrlInput, existing: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  existing.forEach((v, k) => {
    if (!MANAGED.has(k)) q.append(k, v);
  });
  if (input.preset !== null) q.set('preset', input.preset);
  if (input.from !== undefined) q.set('from', input.from);
  q.set('seed', String(input.P.seed));
  for (const k of PARAM_KEYS) {
    if (k === 'seed') continue;
    const a = input.P[k];
    if (a === input.base[k]) continue;
    // camera angles are written to two decimals; a sub-hundredth difference is not a change
    if (
      CAMERA.includes(k) &&
      typeof a === 'number' &&
      writeNumber(a) === writeNumber(Number(input.base[k]))
    )
      continue;
    q.set(k, typeof a === 'number' ? writeNumber(a) : a);
  }
  if (input.zoom !== 1) q.set('zoom', writeNumber(input.zoom));
  // always written: a link means the same on a viewer whose own choice or colour scheme differs
  q.set('surface', input.surface);
  return q;
}
