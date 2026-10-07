/**
 * Shell galaxies: a cold satellite falling radially into a logarithmic potential, phase-wrapping
 * into interleaved shells (ADR 0003, 0009). Reference: `shellSprites`, `shellArcs`
 * (app23.js:L711–760).
 *
 * The CPU half, shared by both engines: the description (steps, the key of the counter RNG), the
 * shell arcs a detection found as curves, and a reference detection in TypeScript
 * (`detectArcsCpu`, the twin of compute/shells.wgsl `polar_hist` and `detect`). The stars are
 * integrated by compute/shells.wgsl, or by src/fallback/kernels/shells.ts.
 *
 * v21 parity (Q13, reference notes 20.14): the shells are a fixed 2D image: they follow neither
 * `incl`, `az` nor `pa`, only `shellAxis`, and they ignore the zoom's centre. The truncation at
 * `RMAX + 0.4` never fires (RMAX is 240 at run time, reference notes 20.7).
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import { strokeIndex, strokePools, type StrokesMeta } from '../marks/strokes';
import type { Curve } from '../model/curves';

/** The integrator's step and the potential's core (`dt`, `rc2`, app23.js:L714, L722). */
export const SHELL_DT = 0.02;
export const SHELL_RC2 = 0.3;
/** The radial histogram: 64 bins to 4.2 (L725). */
export const SHELL_BINS = 64;
export const SHELL_RMAX = 4.2;
/** Steps per submit on the GPU. */
export const SHELL_CHUNK = 1000;

export interface ShellParams {
  seed: number;
  shellTime: number;
  shellStars: number;
  shellAxis: number;
}

export function shellParamsOf(P: Params | ShellParams): ShellParams {
  return {
    seed: P.seed,
    shellTime: P.shellTime,
    shellStars: P.shellStars,
    shellAxis: P.shellAxis,
  };
}

/** The steps: `ceil(shellTime / dt)` (L722). */
export function shellSteps(p: ShellParams): number {
  return Math.ceil(p.shellTime / SHELL_DT);
}

/** The model tier's key (v21's `SCACHE` key, app23.js:L710: seed, time and star count). */
export function shellKey(p: ShellParams): string {
  return [p.seed, p.shellTime, p.shellStars].join('|');
}

/** A shell found: the radius, which side (the sign of x) and the opening half-angle (L737). */
export interface ShellArc {
  R: number;
  side: 1 | -1;
  open: number;
}

/**
 * The detection's arcs from the GPU's `arcs` buffer (6 vec4: radius, side, opening, valid), in
 * v21's order: the side with x > 0 first, each side's biggest drop first.
 */
export function arcsOf(buf: ArrayLike<number>): ShellArc[] {
  const out: ShellArc[] = [];
  for (let k = 0; k < 6; k++) {
    if ((buf[k * 4 + 3] as number) < 0.5) continue;
    out.push({
      R: buf[k * 4] as number,
      side: (buf[k * 4 + 1] as number) > 0 ? 1 : -1,
      open: buf[k * 4 + 2] as number,
    });
  }
  return out;
}

/**
 * `shellArcs()` (app23.js:L750–760): each shell as 41 points of an arc round the infall axis, in the
 * plate's frame (`pts2d`: no projection), a `faint` stroke of width 0.7. A curve's points are
 * (x, y, 0) in galaxy units: drawn through a face-on camera (incl, az and pa 0), as v21 draws them.
 *
 * `picks`: v21's stroke rows (replayed from `mulberry32(seed · 5 + 17)`), or the engine's own draws.
 */
export function shellCurves(
  arcs: readonly ShellArc[],
  p: ShellParams,
  strokes: StrokesMeta | undefined,
  picks?: readonly number[],
): Curve[] {
  const pools = strokePools(strokes?.kind ?? []);
  const ax = (p.shellAxis * Math.PI) / 180;
  return arcs.map((a, i) => {
    const pts: [number, number, number][] = [];
    const c0 = a.side > 0 ? 0 : Math.PI;
    for (let j = 0; j <= 40; j++) {
      const t = c0 - a.open + (2 * a.open * j) / 40;
      pts.push([a.R * Math.cos(t + ax), a.R * Math.sin(t + ax), 0]);
    }
    const u = new Draws(p.seed >>> 0, Stream.shells, 1000 + i).f32();
    return {
      pts,
      w: 0.7,
      k: picks?.[i] ?? strokeIndex('faint', pools, u),
      a: 1,
      taper: false,
      stretch: false,
      edgeAlpha: false,
      role: 'shell',
    };
  });
}

/**
 * The reference's detection (app23.js:L724–739) on the final positions (4 words per star), in f32
 * as compute/shells.wgsl does it: the same histogram, smoothing and tests, and the 85th percentile
 * of the polar angles by sorting (the GPU bisects on their bits to the same value).
 */
export function detectArcsCpu(xs: ArrayLike<number>, n: number): ShellArc[] {
  const f = Math.fround;
  const rr = new Float32Array(n);
  const th = new Float32Array(n);
  const hist = new Uint32Array(2 * SHELL_BINS);
  for (let i = 0; i < n; i++) {
    const x = xs[i * 4] as number;
    const y = xs[i * 4 + 1] as number;
    const z = xs[i * 4 + 2] as number;
    const r = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
    rr[i] = r;
    th[i] = f(Math.atan2(f(Math.sqrt(f(f(y * y) + f(z * z)))), Math.abs(x)));
    if (r < f(0.6) || r > f(SHELL_RMAX) || x === 0) continue;
    const bin = Math.floor(f(f(r / f(SHELL_RMAX)) * SHELL_BINS));
    if (bin >= SHELL_BINS) continue;
    const h = (x < 0 ? SHELL_BINS : 0) + bin;
    hist[h] = (hist[h] as number) + 1;
  }
  const arcs: ShellArc[] = [];
  for (const side of [1, -1] as const) {
    const o = side > 0 ? 0 : SHELL_BINS;
    const sm = new Float32Array(SHELL_BINS);
    for (let b = 1; b < SHELL_BINS - 1; b++)
      sm[b] = f(
        f(
          f((hist[o + b - 1] as number) + 2 * (hist[o + b] as number)) +
            (hist[o + b + 1] as number),
        ) / 4,
      );
    const found: { drop: number; b: number }[] = [];
    for (let b = 3; b < SHELL_BINS - 2; b++) {
      const sb = sm[b] as number;
      const drop = f(sb - (sm[b + 2] as number));
      if (
        sb >= (sm[b - 1] as number) &&
        sb >= (sm[b + 1] as number) &&
        f(drop * 100) > f(45 * sb) &&
        f(sb * 250) > n
      )
        found.push({ drop, b });
    }
    // the biggest drops first, the earlier bin on a tie
    found.sort((p, q) => q.drop - p.drop || p.b - q.b);
    for (const fd of found.slice(0, 3)) {
      const R = f(f(f(fd.b + f(0.8)) / SHELL_BINS) * f(SHELL_RMAX));
      const angs: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = xs[i * 4] as number;
        if (Math.abs(f((rr[i] as number) - R)) < f(0.12) && x * side > 0)
          angs.push(th[i] as number);
      }
      angs.sort((p, q) => p - q);
      const open = angs.length ? (angs[Math.floor(angs.length * 0.85)] as number) : 0.6;
      arcs.push({ R, side, open: Math.min(1.3, Math.max(0.35, open)) });
    }
  }
  return arcs;
}
