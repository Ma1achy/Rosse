/**
 * The camera in the page's URL: `?az=`, `?incl=`, `?pa=` (degrees) and `?zoom=`. A missing,
 * empty or non-numeric value is absent (so `?incl=` keeps the preset's inclination rather than
 * meaning 0). Values are brought into range the way the orbit control does: az and pa wrap into
 * [0, 360), incl is clamped to 0–180, and the zoom to 0.15–12 (so `?zoom=0` is 0.15, as 0.1 and
 * −3 are).
 */
import { clamp, clampZoom, wrapDeg } from '../view/camera';

export interface UrlView {
  az?: number;
  incl?: number;
  pa?: number;
  zoom?: number;
}

/** A finite number, or undefined for a missing, empty or non-numeric value. */
export function urlNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export function parseUrlView(params: URLSearchParams): UrlView {
  const out: UrlView = {};
  const az = urlNumber(params, 'az');
  const incl = urlNumber(params, 'incl');
  const pa = urlNumber(params, 'pa');
  const zoom = urlNumber(params, 'zoom');
  if (az !== undefined) out.az = wrapDeg(az);
  if (incl !== undefined) out.incl = clamp(incl, 0, 180);
  if (pa !== undefined) out.pa = wrapDeg(pa);
  if (zoom !== undefined) out.zoom = clampZoom(zoom);
  return out;
}
