/**
 * The merger's test stars as marks on the CPU engine (ADR 0009, 0011): the twin of
 * src/shaders/compute/merger-sprites.wgsl, function for function. Reference: mergerSprites
 * (app23.js:L481–536) and the debris of render() (L1234–1238). The class of each mark is the
 * stipple's (`Cls`), so the compaction and the layers are the stipple's too.
 */
import { cosF, randGaussF, sinF } from '../../core/f32math';
import { randF32 } from '../../core/rng';
import { Stream } from '../../core/streams';
import type { StructLayout } from '../../marks/instance';
import { Cls } from '../../model/classes';
import { INSTANCE_WORDS } from './project';
import type { TideData } from './tide';

const f = Math.fround;

/** Slots per star: 0–10 the knots or the one mark, 11 a drawn star (merger-sprites.wgsl `SLOTS`). */
export const MERGER_SLOTS = 12;
const KNOT_POOL = 24;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max(f(f(x - a) / f(b - a)), 0), 1);
  return f(f(t * t) * f(3 - f(2 * t)));
};
const wrapPi = (a: number) => {
  const t = f(a + f(3.141592653589793));
  return f(
    f(t - f(f(6.283185307179586) * Math.floor(f(t / f(6.283185307179586))))) - f(3.141592653589793),
  );
};

const FIELDS: [string, 'f32' | 'u32' | 'vec4<f32>'][] = [
  ['c0', 'vec4<f32>'],
  ['c1', 'vec4<f32>'],
  ['ea0', 'vec4<f32>'],
  ['eb0', 'vec4<f32>'],
  ['pa0', 'vec4<f32>'],
  ['ea1', 'vec4<f32>'],
  ['eb1', 'vec4<f32>'],
  ['pa1', 'vec4<f32>'],
  ['cos_i', 'f32'],
  ['sin_i', 'f32'],
  ['cos_az', 'f32'],
  ['sin_az', 'f32'],
  ['cos_pa', 'f32'],
  ['sin_pa', 'f32'],
  ['sc', 'f32'],
  ['fcx', 'f32'],
  ['fcy', 'f32'],
  ['fcz', 'f32'],
  ['persp', 'f32'],
  ['zshrink', 'f32'],
  ['vcx', 'f32'],
  ['vcy', 'f32'],
  ['star_mix', 'f32'],
  ['knots', 'f32'],
  ['sparkle', 'f32'],
  ['pen_dot', 'f32'],
  ['spike', 'f32'],
  ['keep_dots', 'f32'],
  ['keep_knots', 'f32'],
  ['keep_rstars', 'f32'],
  ['n', 'u32'],
  ['n0', 'u32'],
  ['key', 'u32'],
  ['n_dot_pool', 'u32'],
  ['n_knot_pool', 'u32'],
  ['n_star_tiles', 'u32'],
  ['hot0', 'u32'],
  ['hot1', 'u32'],
  ['mauto', 'f32'],
  ['stage', 'f32'],
];

/** The `MView` uniform of merger-sprites.wgsl. */
export const MVIEW_LAYOUT: StructLayout = (() => {
  let off = 0;
  const fields = FIELDS.map(([name, type]) => {
    const size = type === 'vec4<f32>' ? 16 : 4;
    const e = { name, type, offset: off, size };
    off += size;
    return e;
  });
  return { name: 'MView', size: Math.ceil(off / 16) * 16, align: 16, fields };
})();

/** The debris's thinning (render(), app23.js:L1236–1238). */
export const KEEP = { dots: 0.16, knots: 0.6, rstars: 0.5 } as const;

export interface MergerSprites {
  /** MERGER_SLOTS entries per star, INSTANCE_WORDS words each */
  f32: Float32Array;
  u32: Uint32Array;
  /** the class of each entry (Cls.none when the slot is empty) */
  classes: Uint32Array;
  /** the stars' plate positions, 2 per star */
  scr: Float32Array;
}

/** The marks of every star at this view (`sprites`), and the plate positions the tidal map reads. */
export function runMergerSprites(
  mv: Record<string, number | readonly number[]>,
  cur: ArrayLike<number>,
  ic: ArrayLike<number>,
  pool: ArrayLike<number>,
  dotBase: ArrayLike<number>,
  tide?: TideData,
): MergerSprites {
  const n = mv.n as number;
  const buf = new ArrayBuffer(Math.max(1, n * MERGER_SLOTS) * INSTANCE_WORDS * 4);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const classes = new Uint32Array(Math.max(1, n * MERGER_SLOTS)).fill(Cls.none);
  const scr = new Float32Array(Math.max(1, n * 2));
  const num = (k: string) => mv[k] as number;
  const c0 = mv.c0 as readonly number[];
  const c1 = mv.c1 as readonly number[];
  const key = num('key');
  const pen0 = f(num('pen_dot'));
  const nDot = num('n_dot_pool');
  const nKnot = num('n_knot_pool');

  const put = (
    slot: number,
    cls: number,
    x: number,
    y: number,
    tile: number,
    alpha: number,
    m: readonly number[],
  ) => {
    const o = slot * INSTANCE_WORDS;
    f32[o] = x;
    f32[o + 1] = y;
    u32[o + 2] = tile;
    f32[o + 3] = alpha;
    f32.set(m, o + 4);
    classes[slot] = cls;
  };
  const simple = (size: number, rot: number): number[] => {
    const c = cosF(rot);
    const s = sinF(rot);
    return [f(c * size), f(s * size), f(-f(s * size)), f(c * size)];
  };

  for (let i = 0; i < n; i++) {
    const u01 = (d: number) => randF32(key, Stream.mergerSprites, i, d);
    const gauss = (d: number) => randGaussF(key, Stream.mergerSprites, i, d);
    const o = i * MERGER_SLOTS;
    const rx = f(cur[i * 4] as number);
    const ry = f(cur[i * 4 + 1] as number);
    const rz = f(cur[i * 4 + 2] as number);
    const second = i >= num('n0');
    const core = second ? c1 : c0;
    const ea = (second ? mv.ea1 : mv.ea0) as readonly number[];
    const eb = (second ? mv.eb1 : mv.eb0) as readonly number[];
    const pa = (second ? mv.pa1 : mv.pa0) as readonly number[];
    const mauto = num('mauto') !== 0;
    // ADR 0093: a disc keeps its inner stars where they started (the arms and the lanes read), the
    // outer ones follow the tides; the hold lets go as the cores come together
    let px = rx;
    let py = ry;
    let pz = rz;
    const rn = f(ic[i * 4 + 2] as number);
    if (mauto && (ea[3] as number) > 0) {
      const w = f(1 - f(f(ea[3] as number) * f(1 - smooth(0.25, 0.7, rn))));
      const rm = f(core[3] as number);
      const ax = f(f(ic[i * 4] as number) * rm);
      const ay = f(f(ic[i * 4 + 1] as number) * rm);
      const gx = f(
        f(core[0] as number) + f(f(ax * f(ea[0] as number)) + f(ay * f(eb[0] as number))),
      );
      const gy = f(
        f(core[1] as number) + f(f(ax * f(ea[1] as number)) + f(ay * f(eb[1] as number))),
      );
      const gz = f(
        f(core[2] as number) + f(f(ax * f(ea[2] as number)) + f(ay * f(eb[2] as number))),
      );
      px = f(gx + f(w * f(rx - gx)));
      py = f(gy + f(w * f(ry - gy)));
      pz = f(gz + f(w * f(rz - gz)));
    }
    // view(x, y, z) (L500), then px (L516)
    const xr = f(f(px * num('cos_az')) - f(py * num('sin_az')));
    const yr = f(f(px * num('sin_az')) + f(py * num('cos_az')));
    const yy = f(f(yr * num('cos_i')) - f(pz * num('sin_i')));
    const vx = f(f(xr * num('cos_pa')) - f(yy * num('sin_pa')));
    const vy = f(f(xr * num('sin_pa')) + f(yy * num('cos_pa')));
    const X = f(num('vcx') + f(f(vx - num('fcx')) * num('sc')));
    const Y = f(num('vcy') + f(f(vy - num('fcy')) * num('sc')));
    // the debris's size follows its depth (ADR 0084); exactly 1 without `persp`
    const persp = num('persp');
    let pen = pen0;
    let dk = 1;
    if (persp !== 0) {
      const vz = f(f(yr * num('sin_i')) + f(pz * num('cos_i')));
      dk = f(1 / Math.max(f(1 - f(f(vz - num('fcz')) * persp)), f(0.3)));
      pen = f(f(pen0 * dk) * num('zshrink'));
    }
    scr[i * 2] = X;
    scr[i * 2 + 1] = Y;
    if (tide) {
      tide.fl[tide.L.starOff + i * 4] = X;
      tide.fl[tide.L.starOff + i * 4 + 1] = Y;
      // the merging galaxies' marks take the same depth scale (ADR 0088)
      tide.fl[tide.L.dkOff + i] = f(dk * (persp !== 0 ? num('zshrink') : 1));
    }
    const hot = (second ? num('hot1') : num('hot0')) !== 0;
    const dx = f(rx - f(core[0] as number));
    const dy = f(ry - f(core[1] as number));
    const dz = f(rz - f(core[2] as number));
    const dcore = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
    const inTail = !hot && dcore > f(f(1.15) * f(core[3] as number));
    const outer = (ic[i * 4 + 2] as number) > f(0.45);
    const roll = u01(0);
    const lane = f(pa[2] as number);
    const rm = f(core[3] as number);
    const stage = num('stage');
    if (mauto && lane > 0) {
      // dust lanes on the trailing edge of each arm, carried along with the stars that make them
      const R = f(rn * rm);
      if (R > f(0.12) && (pa[0] as number) > 0) {
        const th0 = Math.atan2(f(ic[i * 4 + 1] as number), f(ic[i * 4] as number));
        const base = f(f(Math.log(f(Math.max(R, f(0.1)) / f(0.1)))) / f(pa[1] as number));
        let near = f(9);
        for (let k = 0; k < (pa[0] as number); k++) {
          const ph = f(f(base + f(f(f(6.283185307179586) * k) / f(pa[0] as number))) - f(0.22));
          near = Math.min(near, Math.abs(wrapPi(f(th0 - ph))));
        }
        if (near < f(0.09) && u01(190) < f(lane * f(0.85))) continue;
      }
      // a dusty bridge between the two galaxies, while they are still apart
      const ox = f(f(c1[0] as number) - f(c0[0] as number));
      const oy = f(f(c1[1] as number) - f(c0[1] as number));
      const oz = f(f(c1[2] as number) - f(c0[2] as number));
      const L2 = f(f(f(ox * ox) + f(oy * oy)) + f(oz * oz));
      if (L2 > f(1e-6)) {
        const qx = f(rx - f(c0[0] as number));
        const qy = f(ry - f(c0[1] as number));
        const qz = f(rz - f(c0[2] as number));
        const t = f(f(f(f(qx * ox) + f(qy * oy)) + f(qz * oz)) / L2);
        if (t > f(0.12) && t < f(0.88)) {
          const ex = f(qx - f(t * ox));
          const ey = f(qy - f(t * oy));
          const ez = f(qz - f(t * oz));
          const d2 = f(f(f(ex * ex) + f(ey * ey)) + f(ez * ez));
          if (d2 < f(f(0.01) * L2) && u01(191) < f(f(0.6) * f(lane * smooth(0.2, 0.7, stage))))
            continue;
        }
      }
    }
    const smoothHalo = mauto && (pa[3] as number) !== 0;

    /** mstar (L511–512): a drawn star, classified and counted (M7 draws it) */
    const mstar = (base: number, bright: boolean) => {
      if (u01(base + 6) >= num('keep_rstars')) return;
      let size = f(f(Math.exp(f(Math.log(4.6) + f(f(0.38) * gauss(base + 2))))) * pen);
      let alpha = f(0.42);
      if (bright) {
        const t = f(Math.exp(f(f(2.4) * f(Math.log(Math.max(u01(base + 1), 1e-9))))));
        size = f(f(9 + f(9 * t)) * pen);
        alpha = f(0.58);
      }
      const rot = f(num('spike') + f(gauss(base + 4) * f(0.2)));
      put(o + 11, Cls.rstar, X, Y, 0, alpha, simple(size, rot));
    };

    let pStar = f(f(0.05) * num('star_mix'));
    if (inTail) pStar = f(pStar * f(1.6));
    if (!hot && num('star_mix') > f(0.01) && u01(1) < pStar) {
      mstar(3, inTail && u01(2) < 0.25);
      continue;
    }
    const tailK = mauto ? f(3) : f(1);
    if (inTail && roll < f(f(f(0.012) * tailK) * f(f(0.4) + num('knots')))) {
      // a tidal dwarf: a tight, brighter clump of new stars
      const dwarf = mauto && u01(11) < f(0.2);
      const nk = dwarf ? 11 : 5 + Math.floor(f(u01(10) * 7));
      const spread = dwarf ? f(2.2) : f(5);
      const grow = dwarf ? f(1.3) : f(1);
      for (let j = 0; j < nk; j++) {
        const b = 20 + j * 8;
        if (u01(172 + j) < num('keep_knots')) {
          const kx = f(X + f(f(gauss(b) * spread) * pen));
          const ky = f(Y + f(f(gauss(b + 2) * spread) * pen));
          const t = pool[Math.floor(f(u01(b + 4) * nKnot))] as number;
          put(
            o + j,
            Cls.knot,
            kx,
            ky,
            t,
            1,
            simple(f(f(f(3 + f(4 * u01(b + 5))) * grow) * pen), f(u01(b + 6) * f(6.28))),
          );
        }
      }
      mstar(130, true);
      continue;
    }
    // star formation where the discs press on each other
    const oc = second ? c0 : c1;
    const ddx = f(rx - f(oc[0] as number));
    const ddy = f(ry - f(oc[1] as number));
    const ddz = f(rz - f(oc[2] as number));
    const comp =
      mauto &&
      !hot &&
      f(Math.sqrt(f(f(f(ddx * ddx) + f(ddy * ddy)) + f(ddz * ddz)))) <
        f(f(0.9) * f(oc[3] as number));
    const knotP = f(f(0.035) * f(f(0.4) + num('knots')));
    if (!hot && ((outer && roll < knotP) || (comp && roll < f(knotP * f(1.6))))) {
      if (u01(171) < num('keep_knots')) {
        const t = pool[Math.floor(f(u01(140) * nKnot))] as number;
        put(
          o,
          Cls.knot,
          X,
          Y,
          t,
          1,
          simple(f(f(4 + f(5 * u01(141))) * pen), f(u01(142) * f(6.28))),
        );
      }
      continue;
    }
    if (roll > f(1 - f(f(0.004) * f(f(0.3) + num('sparkle'))))) {
      const tile = Math.floor(f(u01(150) * num('n_star_tiles')));
      put(o, Cls.star, X, Y, tile, 1, simple(f(10 + f(10 * u01(151))), f(u01(152) * f(6.28))));
      continue;
    }
    if (u01(170) < f(num('keep_dots') * (smoothHalo ? f(1.5) : f(1)))) {
      const t = pool[KNOT_POOL + Math.floor(f(u01(160) * nDot))] as number;
      put(
        o,
        outer ? Cls.young : Cls.disc,
        X,
        Y,
        t,
        1,
        simple(
          smoothHalo
            ? f(f(dotBase[t] as number) * f(f(0.55) + f(f(0.45) * smooth(0, 0.35, rn))))
            : (dotBase[t] as number),
          f(u01(161) * f(6.28)),
        ),
      );
    }
  }
  return { f32, u32, classes, scr };
}
