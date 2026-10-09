/**
 * Stipple sampling, CPU twin of src/shaders/compute/stipple.wgsl (ADR 0011, 0014): one call per
 * candidate sample, the same per-element function, the same random draws (Stream.stipple, index =
 * sample, draw = a counter local to the sample), f32 arithmetic through `Math.fround`.
 *
 * Reference: the proposal loop of `generate` (app23.js:L221–273). Each sample picks a component by
 * weight (bulge, halo, bar, ring, disc, or the Sérsic profile of a smooth galaxy), runs its bounded
 * rejection loop on its own draws, and is classified as a dot (old, disc or young population), a
 * knot, a sparkle star or a drawn star (`rstar`: its drawing, size and spin are drawn here, on the
 * sample's own counter; the view tier scales it with the zoom, compute/project.wgsl). A sample the
 * model rejects is class NONE. Nothing here depends on the camera: the dust
 * optical depth is a view cull (./project.ts), which reads the uniform stored here in `u_tau`, so
 * orbiting never re-rolls the stipple (ADR 0004, 0010).
 *
 * The dust lanes and the dust-carving pen lines (app23.js:L264–265) are view culls too: a sample
 * carries flags saying which apply to it (`lane` for the disc, `carve` for the disc, bar and ring),
 * and ./project.ts filters it on per-sample uniforms of the `stippleCull` stream.
 *
 * After the proposals come the marks of the ring knots and clumps (app23.js:L282–297, groups
 * described in src/model/clumps.ts): `sampleExtra`, the twin of stipple.wgsl's `extra` entry point.
 *
 * The breathing room round the bright drawn stars (app23.js:L275–281) is a pure view filter on
 * these samples (./breathe.ts).
 */
import { cosF, randGaussF, sinF, tanF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { NoiseSalt, vnoise } from '../../core/noise';
import { Stream } from '../../core/streams';
import {
  GROUP_WORDS,
  GalaxyFlag,
  KNOT_POOL,
  SHAPE,
  STAR_ASTERISK,
  sampleCount,
  type GalaxyDesc,
} from '../../model/galaxy';
import { GROUP_STRIDE, GroupKind } from '../../model/clumps';
import type { StructLayout } from '../../marks/instance';
import { CLASS_COUNT, Cls, SampleFlag } from '../../model/classes';

const f = Math.fround;
const PI = f(Math.PI);
const TAU = f(2 * Math.PI);

export { Cls, CLASS_COUNT, SampleFlag };

/** One sample, as written by the kernel. */
export const SAMPLE_LAYOUT: StructLayout = {
  name: 'Sample',
  size: 32,
  align: 16,
  fields: [
    { name: 'pos', type: 'vec3<f32>', offset: 0, size: 12 },
    { name: 'cls', type: 'u32', offset: 12, size: 4 },
    { name: 'tile', type: 'u32', offset: 16, size: 4 },
    { name: 'size', type: 'f32', offset: 20, size: 4 },
    { name: 'rot', type: 'f32', offset: 24, size: 4 },
    { name: 'u_tau', type: 'f32', offset: 28, size: 4 },
  ],
};
export const SAMPLE_WORDS = SAMPLE_LAYOUT.size / 4;

/** The draws of one sample. */
export class Rng {
  d = 0;
  constructor(
    readonly seed: number,
    readonly i: number,
    readonly stream: number = Stream.stipple,
  ) {}
  next(): number {
    return randF32(this.seed, this.stream, this.i, this.d++);
  }
  gauss(): number {
    const g = randGaussF(this.seed, this.stream, this.i, this.d);
    this.d += 2;
    return g;
  }
}

const cos = cosF;
const sin = sinF;
const log = (x: number) => f(Math.log(x));
const exp = (x: number) => f(Math.exp(x));
const sqrt = (x: number) => f(Math.sqrt(x));
const pow = (x: number, y: number) => f(Math.pow(x, y));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const DEG = f(Math.PI / 180);

/** `wrapPi` (app23.js:L131): an angle into [−π, π). */
export function wrapPi(a: number): number {
  let x = f(f(a + PI) - f(TAU * Math.floor(f(f(a + PI) / TAU))));
  if (x >= TAU) x = f(x - TAU);
  return f(x - PI);
}

function shapeAt(G: GalaxyDesc, entry: number, c: number): number {
  return G.shape[entry * 4 + c] ?? 0;
}

/** `armPhase(R, k)` (app23.js:L127). */
export function armPhase(G: GalaxyDesc, R: number, k: number): number {
  const g = G.g;
  const r0 = g.arm_r0;
  const a = (k % g.n_var_arms) * 2 + SHAPE.arms;
  const pitch = f(g.pitch * shapeAt(G, a, 0));
  let ph = f(log(f(Math.max(R, r0) / r0)) / tanF(f(clamp(pitch, 4, 60) * DEG)));
  const wig = shapeAt(G, a + 1, 0);
  const wf = shapeAt(G, a + 1, 1);
  const wp = shapeAt(G, a + 1, 2);
  ph = f(f(ph + shapeAt(G, a, 2)) + f(wig * sin(f(f(R * wf) + wp))));
  return ph;
}

/** `armProfile(R, θ)` (app23.js:L132–144): the arm density, with spurs and flocculence. */
export function armProfile(G: GalaxyDesc, R: number, th: number): number {
  const g = G.g;
  const arms = g.arms;
  if (arms < 1) return 0;
  const per = f(TAU / arms);
  const half = f(per / 2);
  const w = g.arm_width;
  const w2 = f(w * w);
  let fv = 0;
  for (let k = 0; k < arms; k++) {
    const a = (k % g.n_var_arms) * 2 + SHAPE.arms;
    const rmax = shapeAt(G, a, 3);
    if (R > f(rmax + 0.4)) continue;
    const d = wrapPi(f(f(th - armPhase(G, R, k)) - f(per * k)));
    const x = f(d / half);
    let gk = f(exp(f(-f(x * x) / w2)) * shapeAt(G, a, 1));
    if (R > rmax) gk = f(gk * Math.max(0, f(1 - f(f(R - rmax) / 0.4))));
    if (gk > fv) fv = gk;
  }
  for (let i = 0; i < g.n_spurs; i++) {
    const e = SHAPE.spurs + i;
    const sk = shapeAt(G, e, 0);
    const R0 = shapeAt(G, e, 1);
    const len = shapeAt(G, e, 2);
    const pk = shapeAt(G, e, 3);
    if (R < R0 || R > f(R0 + len)) continue;
    const base = f(armPhase(G, R0, sk) + f(per * sk));
    const want = f(base + f(log(f(R / R0)) / tanF(f(clamp(f(g.pitch * pk), 10, 70) * DEG))));
    const ds = f(wrapPi(f(th - want)) / half);
    const gs = f(f(f(0.8) * exp(f(-f(ds * ds) / f(f(0.5) * w2)))) * f(1 - f(f(R - R0) / len)));
    if (gs > fv) fv = gs;
  }
  const flocc = g.flocc;
  if (flocc > 0) {
    const n = vnoise(
      f(f(R * f(2.2)) + 11),
      f(f(th - armPhase(G, R, 0)) * f(1.6)),
      g.seed,
      NoiseSalt.flocc,
      G.noise,
    );
    fv = f(fv * f(f(1 - flocc) + f(flocc * Math.max(0, f(f(n - f(0.35)) * f(2.2))))));
  }
  const inner = g.arm_inner;
  if (R < inner) fv = f(fv * f(R / inner));
  return fv;
}

/**
 * Marsaglia and Tsang's gamma sampler (`gammaS`, app23.js:L76), bounded at 64 tries (the
 * acceptance rate is above 95%, so the bound is never reached in practice; if it were, the mode
 * would be returned).
 */
export function gammaS(k: number, r: Rng): number {
  let boost = 1;
  let kk = k;
  if (kk < 1) {
    // gammaS(k) = gammaS(k + 1) · u^(1/k); the u is drawn first here
    boost = pow(r.next(), f(1 / kk));
    kk = f(kk + 1);
  }
  const d = f(kk - f(1 / 3));
  const c = f(1 / sqrt(f(9 * d)));
  for (let t = 0; t < 64; t++) {
    const x = r.gauss();
    const b = f(1 + f(c * x));
    const v = f(f(b * b) * b);
    if (v <= 0) continue;
    const u = r.next();
    if (log(u) < f(f(f(f(f(f(0.5) * x) * x) + d) - f(d * v)) + f(d * log(v))))
      return f(f(d * v) * boost);
  }
  return f(d * boost);
}

/**
 * A drawn star's drawing, size and spin (`rstar`, app23.js:L184–190), on the sample's own draws.
 * `young` raises the chance of a bright one (0.18 against 0.05) unless `forced`. The size is before
 * the zoom's growth (ZL), which the view tier applies.
 */
export function drawStar(
  r: Rng,
  G: GalaxyDesc,
  young: boolean,
  forced: boolean,
): { tile: number; size: number; rot: number; bright: boolean } {
  const g = G.g;
  const ns = g.n_ss_small;
  const nb = g.n_ss_bright;
  // without an `sstars` sheet the star is classified (and counted) but has nothing to draw
  if (ns === 0) return { tile: 0, size: 0, rot: 0, bright: false };
  let br = forced;
  if (!br) br = r.next() < (young ? f(0.18) : f(0.05));
  const off = KNOT_POOL + g.n_dot_pool;
  let tile: number;
  let asterisk = false;
  if (br && nb > 0) {
    tile = G.pool[off + ns + Math.min(nb - 1, Math.floor(f(r.next() * nb)))] ?? 0;
  } else {
    const e = G.pool[off + Math.min(ns - 1, Math.floor(f(r.next() * ns)))] ?? 0;
    asterisk = (e & STAR_ASTERISK) !== 0;
    tile = e & 0x7fffffff;
  }
  const pd = g.pen_dot;
  const size = br
    ? f(f(f(9) + f(f(9) * pow(r.next(), f(2.4)))) * pd)
    : f(exp(f(log(f(4.6)) + f(f(0.38) * r.gauss()))) * pd);
  const sd = br ? f(0.1) : asterisk ? f(0.35) : f(0.2);
  const rot = f(g.spike + f(r.gauss() * sd));
  return { tile, size, rot, bright: br };
}

/** Writes sample `i` into `out` (SAMPLE_WORDS per sample) as stipple.wgsl's `main` does. */
export function sampleStipple(i: number, G: GalaxyDesc, fo: Float32Array, uo: Uint32Array): void {
  const g = G.g;
  const o = i * SAMPLE_WORDS;
  const put = (
    x: number,
    y: number,
    z: number,
    cls: number,
    tile: number,
    size: number,
    rot: number,
    uTau: number,
  ) => {
    fo[o] = x;
    fo[o + 1] = y;
    fo[o + 2] = z;
    uo[o + 3] = cls >>> 0;
    uo[o + 4] = tile >>> 0;
    fo[o + 5] = size;
    fo[o + 6] = rot;
    fo[o + 7] = uTau;
  };
  const none = () => {
    put(0, 0, 0, Cls.none, 0, 0, 0, 0);
  };
  const r = new Rng(g.key, i);
  const rmax = g.rmax;
  const flags = g.flags;
  const dotTile = (): number => {
    const n = g.n_dot_pool;
    return G.pool[KNOT_POOL + Math.min(n - 1, Math.floor(f(r.next() * n)))] ?? 0;
  };
  const dotSize = (t: number, k: number) => f((G.dotBase[t] ?? 0) * k);

  const u = f(r.next() * g.tot);
  // components: 0 bulge, 1 halo, 2 bar, 3 ring, 4 disc
  let comp: number;
  if (u < g.c_bulge) comp = 0;
  else if (u < g.c_halo) comp = 1;
  else if (u < g.c_bar) comp = 2;
  else if (u < g.c_ring) comp = 3;
  else comp = 4;

  if (comp === 0 && flags & GalaxyFlag.sersic) {
    // a smooth galaxy: an exact Sérsic radius, in 2D (v21 parity: app23.js:L223–233)
    const nS = g.sersic_n;
    const rS = f(g.re * pow(f(gammaS(f(2 * nS), r) / g.sersic_b), nS));
    if (rS > f(rmax + f(0.8))) {
      none();
      return;
    }
    const thS = f(r.next() * f(6.28));
    const xS = f(rS * cos(thS));
    const yS = f(f(rS * sin(thS)) * g.bulge_flat);
    const dust = g.dust;
    const re = g.re;
    if (
      dust > f(0.25) &&
      Math.abs(f(yS - f(f(0.08) * xS))) < f(f(0.09) * dust) &&
      Math.abs(xS) < f(f(f(2.2) * re) + f(0.4)) &&
      r.next() < f(0.85)
    ) {
      none();
      return;
    }
    if (
      dust > f(0.3) &&
      Math.abs(f(yS + f(0.04))) < f(f(0.05) + f(f(0.03) * dust)) &&
      Math.abs(xS) < f(f(f(1.8) * re) + f(0.6)) &&
      r.next() < f(f(0.85) * dust)
    ) {
      none();
      return;
    }
    const starMix = g.star_mix;
    if (starMix > f(0.01) && rS < f(f(2.2) * re) && r.next() < f(f(0.09) * starMix)) {
      const st = drawStar(r, G, false, false);
      put(
        xS,
        yS,
        0,
        Cls.rstar | SampleFlag.sersic2d | (st.bright ? SampleFlag.bright : 0),
        st.tile,
        st.size,
        st.rot,
        0,
      );
      return;
    }
    const t = dotTile();
    const size = dotSize(t, f(0.9));
    put(xS, yS, 0, Cls.old | SampleFlag.sersic2d, t, size, f(r.next() * f(6.28)), 0);
    return;
  }

  let px: number;
  let py: number;
  let pz: number;
  let arm = 0;
  if (comp === 0) {
    const a = g.bulge_a;
    let rr: number;
    if (flags & GalaxyFlag.bulgeSersic) {
      // a deprojected Sérsic bulge (ADR 0076): the mass inside r is a gamma of shape n (3 − p)
      const nB = g.sersic_n;
      const pB = f(f(f(1 - f(f(0.6097) / nB)) + f(f(0.05463) / f(nB * nB))));
      const re3 = f(f(1.788) * a);
      const k = f(nB * f(3 - pB));
      rr = Math.min(f(re3 * pow(f(gammaS(k, r) / g.sersic_b), nB)), f(f(20) * a));
    } else {
      const sq = sqrt(Math.min(r.next(), f(0.985)));
      rr = f(f(a * sq) / f(1 - sq));
    }
    const cz = f(f(2 * r.next()) - 1);
    const ph = f(TAU * r.next());
    const sz = sqrt(f(1 - f(cz * cz)));
    px = f(f(rr * sz) * cos(ph));
    py = f(f(rr * sz) * sin(ph));
    pz = f(f(rr * cz) * g.bulge_flat);
    if (flags & GalaxyFlag.bulgePeanut) {
      // the bulge of a barred galaxy is boxy-peanut (ADR 0076): longer along the bar, thinner across
      // it, and taller either side of the centre than at it
      const t = Math.min(f(Math.abs(px) / f(f(1.1) * g.bar_len)), 1);
      const w = f(1 - t);
      px = f(px * f(1 + f(f(0.4) * w)));
      py = f(py * f(1 - f(f(0.25) * w)));
      pz = f(pz * f(1 + f(f(f(3.6) * t) * w)));
    }
  } else if (comp === 1) {
    // −1.4 ln(1 − u) rather than −1.4 ln(u): the same distribution, finite at u = 0
    const rh = f(f(-1.4) * log(f(1 - r.next())));
    const cz = f(f(2 * r.next()) - 1);
    const ph = f(TAU * r.next());
    const s2 = sqrt(f(1 - f(cz * cz)));
    if (rh > f(rmax + f(0.5))) {
      none();
      return;
    }
    px = f(f(rh * s2) * cos(ph));
    py = f(f(rh * s2) * sin(ph));
    pz = f(f(rh * cz) * f(0.7));
  } else if (comp === 2) {
    const bl = g.bar_len;
    let x = f(f(r.next() * 2) - 1);
    x = f(f(Math.sign(x) * pow(Math.abs(x), f(0.8))) * bl);
    px = x;
    py = f(f(r.gauss() * f(0.1)) * bl);
    pz = f(r.gauss() * f(0.04));
  } else if (comp === 3) {
    // a clumpy ring: the angle accepted against noise, up to 6 tries (app23.js:L243–245)
    let th: number;
    let rt = 0;
    for (;;) {
      th = f(TAU * r.next());
      rt++;
      if (rt >= 6) break;
      const nz = vnoise(f(cos(th) * f(2.2)), f(sin(th) * f(2.2)), g.seed, NoiseSalt.ring, G.noise);
      if (!(r.next() > f(f(0.45) + f(f(0.55) * nz)))) break;
    }
    const R = f(g.ring_r * f(1 + f(r.gauss() * f(0.035))));
    px = f(R * cos(th));
    py = f(R * sin(th));
    pz = f(f(r.gauss() * g.thick) * f(0.5));
  } else {
    let R2 = 0;
    let th2 = 0;
    const patchy = g.patchy;
    const armsOn = (flags & GalaxyFlag.armsOn) !== 0;
    const as = g.arm_strength;
    for (let tries = 0; tries < 30;) {
      const u1 = r.next();
      const u2 = r.next();
      R2 = f(-log(f(f(u1 * u2) + f(1e-9))));
      th2 = f(TAU * r.next());
      tries++;
      if (R2 > rmax) continue;
      if (patchy > 0) {
        const nz = vnoise(
          f(f(R2 * cos(th2)) * f(1.4)),
          f(f(R2 * sin(th2)) * f(1.4)),
          g.seed,
          NoiseSalt.patchy,
          G.noise,
        );
        if (r.next() > f(f(1 - patchy) + f(f(patchy * pow(nz, f(2.2))) * f(2.2)))) continue;
      }
      if (!armsOn) break;
      arm = armProfile(G, R2, th2);
      if (r.next() < f(f(1 - as) + f(as * arm))) break;
    }
    if (R2 > rmax) {
      none();
      return;
    }
    const irr = g.irr;
    if (irr > 0) {
      const nz = vnoise(
        f(f(R2 * cos(th2)) * f(1.3)),
        f(f(R2 * sin(th2)) * f(1.3)),
        g.seed,
        NoiseSalt.irr,
        G.noise,
      );
      if (r.next() > f(f(0.5) + f(f(1.1) * Math.max(0, f(nz - f(0.3)))))) {
        none();
        return;
      }
    }
    let z = f(f(-g.thick) * log(f(1 - r.next())));
    if (r.next() < f(0.5)) z = f(-z);
    const warp = g.warp;
    if (warp > 0 && R2 > f(1.8)) {
      const dr = f(R2 - f(1.8));
      z = f(z + f(f(f(warp * dr) * dr) * sin(f(th2 - g.warp_a))));
    }
    const lop = g.lop;
    const lopA = g.lop_a;
    px = f(f(R2 * cos(th2)) + f(f(f(lop * R2) * cos(lopA)) * f(0.35)));
    py = f(f(R2 * sin(th2)) + f(f(f(lop * R2) * sin(lopA)) * f(0.35)));
    pz = z;
    for (let d = 0; d < g.n_dust; d++) {
      const e = SHAPE.dust + d;
      const DR = shapeAt(G, e, 0);
      const Dth = shapeAt(G, e, 1);
      const Ds = shapeAt(G, e, 2);
      const dx = f(px - f(DR * cos(Dth)));
      const dy = f(py - f(DR * sin(Dth)));
      if (sqrt(f(f(dx * dx) + f(dy * dy))) < Ds && r.next() < f(0.8)) {
        none();
        return;
      }
    }
  }

  // the view culls of the dust lanes (disc) and the carving lines (disc, bar, ring)
  let flagsOut = comp === 4 ? SampleFlag.lane | SampleFlag.carve : comp >= 2 ? SampleFlag.carve : 0;
  let uTau = 0;
  if (g.dust > 0 && comp !== 1) {
    // the extinction cull's random number, stored for the view tier (app23.js:L262)
    uTau = r.next();
    flagsOut |= SampleFlag.tau;
  }
  const roll = r.next();
  const starMix = g.star_mix;
  if (starMix > f(0.01) && comp !== 1) {
    const Rg = sqrt(f(f(px * px) + f(py * py)));
    const kc = comp === 0 ? f(0.4) : comp === 3 ? f(1.6) : arm > f(0.55) ? f(1.35) : f(0.85);
    if (Rg < f(2.7) && r.next() < f(f(f(f(0.34) * starMix) * kc) * (Rg > f(2.1) ? f(0.55) : 1))) {
      const st = drawStar(r, G, comp === 3 || (comp === 4 && arm > f(0.55)), false);
      put(
        px,
        py,
        pz,
        Cls.rstar | flagsOut | (st.bright ? SampleFlag.bright : 0),
        st.tile,
        st.size,
        st.rot,
        uTau,
      );
      return;
    }
  }
  if (comp === 4 && arm > f(0.55) && roll < f(f(g.knots * f(0.12)) * arm)) {
    const tile = G.pool[Math.min(KNOT_POOL - 1, Math.floor(f(r.next() * KNOT_POOL)))] ?? 0;
    const size = f(f(5 + f(6 * r.next())) * g.pen_dot);
    put(px, py, pz, Cls.knot | flagsOut, tile, size, f(r.next() * f(6.28)), uTau);
    return;
  }
  if ((comp === 4 || comp === 3) && roll > f(1 - f(f(g.sparkle * f(0.012)) * f(f(0.4) + arm)))) {
    const n = g.n_star_tiles;
    const tile = Math.min(n - 1, Math.floor(f(r.next() * n)));
    const size = f(10 + f(13 * r.next()));
    put(px, py, pz, Cls.star | flagsOut, tile, size, f(r.next() * f(6.28)), uTau);
    return;
  }
  const t = dotTile();
  const size = dotSize(t, comp === 0 ? f(0.85) : 1);
  const cls = comp === 0 || comp === 1 ? Cls.old : arm > f(0.55) ? Cls.young : Cls.disc;
  put(px, py, pz, cls | flagsOut, t, size, f(r.next() * f(6.28)), uTau);
}

/**
 * Writes extra sample `j` (a ring knot's or a clump's mark, app23.js:L282–297) at index `n + j`, as
 * stipple.wgsl's `extra` entry point does. Its group is found by binary search on the groups'
 * first sample; its draws are on the group's stream (ring knots or clumps), index
 * `id · GROUP_STRIDE + local`, keyed by the placement key.
 */
export function sampleExtra(
  j: number,
  G: GalaxyDesc,
  fo: Float32Array,
  uo: Uint32Array,
  gu: Uint32Array = new Uint32Array(G.groups),
  gf: Float32Array = new Float32Array(G.groups),
): void {
  const g = G.g;
  const o = (g.n + j) * SAMPLE_WORDS;
  const ng = g.n_groups;
  // the last group whose first sample is at or before j
  let lo = 0;
  let hi = ng;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if ((gu[mid * GROUP_WORDS + 4] ?? 0) <= j) lo = mid;
    else hi = mid;
  }
  const go = lo * GROUP_WORDS;
  const cx = gf[go] ?? 0;
  const cy = gf[go + 1] ?? 0;
  const cz = gf[go + 2] ?? 0;
  const s = gf[go + 3] ?? 0;
  const local = j - (gu[go + 4] ?? 0);
  const count = gu[go + 5] ?? 0;
  const tag = gu[go + 7] ?? 0;
  const kind = tag & 0xff;
  const ring = kind === GroupKind.ringKnots;
  const r = new Rng(
    g.key,
    ((tag >>> 8) * GROUP_STRIDE + local) >>> 0,
    ring ? Stream.ringKnots : Stream.clumps,
  );
  const put = (
    x: number,
    y: number,
    z: number,
    cls: number,
    tile: number,
    size: number,
    rot: number,
  ) => {
    fo[o] = x;
    fo[o + 1] = y;
    fo[o + 2] = z;
    uo[o + 3] = cls >>> 0;
    uo[o + 4] = tile >>> 0;
    fo[o + 5] = size;
    fo[o + 6] = rot;
    fo[o + 7] = 0;
  };
  if (local >= count) {
    // a drawn star: at the ring knot's centre (bright with probability 0.6), or scattered over the
    // clump (the first bright with probability 0.55), always `young` (app23.js:L288, L296)
    let x = cx;
    let y = cy;
    let z = cz;
    let forced: boolean;
    if (ring) forced = r.next() < f(0.6);
    else {
      const ss = f(s * f(1.3));
      x = f(cx + f(r.gauss() * ss));
      y = f(cy + f(r.gauss() * ss));
      z = 0;
      forced = local - count === 0 && r.next() < f(0.55);
    }
    const st = drawStar(r, G, true, forced);
    put(x, y, z, Cls.rstar | (st.bright ? SampleFlag.bright : 0), st.tile, st.size, st.rot);
    return;
  }
  const x = f(cx + f(r.gauss() * s));
  const y = f(cy + f(r.gauss() * s));
  const z = ring ? cz : f(cz + f(r.gauss() * f(0.02)));
  if (r.next() < (ring ? f(0.5) : f(0.25))) {
    const tile = G.pool[Math.min(KNOT_POOL - 1, Math.floor(f(r.next() * KNOT_POOL)))] ?? 0;
    const size = f(f(3 + f(4 * r.next())) * g.pen_dot);
    put(x, y, z, Cls.knot, tile, size, f(r.next() * f(6.28)));
    return;
  }
  const n = g.n_dot_pool;
  const t = G.pool[KNOT_POOL + Math.min(n - 1, Math.floor(f(r.next() * n)))] ?? 0;
  const k = f((ring ? f(0.9) : f(0.8)) + f(f(0.5) * r.next()));
  const size = f((G.dotBase[t] ?? 0) * k);
  put(x, y, z, Cls.young, t, size, f(r.next() * f(6.28)));
}

/**
 * Runs the kernel over every sample: the model tier's output, SAMPLE_WORDS words per sample. The
 * proposals come first, then the ring knots' and clumps' marks.
 */
export function runStipple(G: GalaxyDesc): { f32: Float32Array; u32: Uint32Array; n: number } {
  const n0 = G.g.n;
  const n = sampleCount(G);
  const buf = new ArrayBuffer(Math.max(1, n) * SAMPLE_LAYOUT.size);
  const fo = new Float32Array(buf);
  const uo = new Uint32Array(buf);
  for (let i = 0; i < n0; i++) sampleStipple(i, G, fo, uo);
  const gu = new Uint32Array(G.groups);
  const gf = new Float32Array(G.groups);
  for (let j = 0; j < n - n0; j++) sampleExtra(j, G, fo, uo, gu, gf);
  return { f32: fo, u32: uo, n };
}
