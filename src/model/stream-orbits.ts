/**
 * The stellar streams' orbits (ADR 0085, 0089, 0090): the arc a stream follows round the galaxy, and
 * the tilt of its plane out of the galaxy's. The streams' strokes (curves.ts), the halo stars that
 * trace them (the stipple kernel) and v21's pen-line streams (parts.ts) all read it, so a stream is
 * one thing drawn three ways. The picks are on the `parts` stream: `PartIndex.streams` (20) draws a
 * tile (unused here), the radius, the span and the start angle; `PartIndex.streamTilt` (40) the tilt.
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';

export interface StreamOrbit {
  R0: number;
  span: number;
  a0: number;
  tilt: number;
}

/** How many streams the parameters ask for (v21: one, two above 0.6). */
export function streamCount(P: Params): number {
  return P.streams > 0.02 ? 1 + (P.streams > 0.6 ? 1 : 0) : 0;
}

/** Stream q's orbit. */
export function streamOrbit(seed: number, q: number): StreamOrbit {
  const r = new Draws(seed, Stream.parts, 20 + q);
  r.f32();
  const R0 = 2.0 + 1.2 * r.f32();
  const span = 2.0 + 1.6 * r.f32();
  const a0 = r.f32() * 6.28;
  const tilt = 0.35 + 0.95 * new Draws(seed, Stream.parts, 40 + q).f32();
  return { R0, span, a0, tilt };
}

/**
 * A point of stream q: `t` along its arc (0 to 1), `lat` across it and `lift` off its plane, both in
 * units of the band's width there, which is narrow at the progenitor and fans out along the orbit.
 */
export function streamPoint(
  o: StreamOrbit,
  t: number,
  lat: number,
  lift: number,
): [number, number, number] {
  const width = 0.03 + 0.3 * t * t;
  const ang = o.a0 + o.span * t;
  const R = o.R0 * (1 - 0.25 * t) + lat * width;
  const y = R * Math.sin(ang);
  const z0 = lift * width;
  return [
    R * Math.cos(ang),
    y * Math.cos(o.tilt) - z0 * Math.sin(o.tilt),
    y * Math.sin(o.tilt) + z0 * Math.cos(o.tilt),
  ];
}
