import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAM,
  CI_PREDICATES,
  INCE_USES,
  INCL_CONTINUOUS,
  INCL_BUCKETS,
  R_FG,
  SKY_RMAX,
  SKY_RMIN,
  UNIT_SCALE,
  basis,
  discM,
  incE,
  inclBucket,
  orient,
  perspective,
  project,
  rotFwd,
  rotInv,
  rotation,
  rotationOf,
  scenePoint,
  srcNow,
  structureKey,
  toScreen,
  toView,
  viewDesc,
  type Camera,
  type Orientation,
} from '../../src/view/camera';

/** tests/vectors/camera.json: v21's own functions evaluated (tools/camera-vectors.mjs). */
interface Vectors {
  constants: { CAM: number; RMIN: number; RMAX: number; R_FG: number; scale: number };
  incE: [number, number][];
  basis: { n: number[]; e: number[][] }[];
  cases: {
    camera: Camera;
    incE: number;
    discM: number[];
    project: { p: number[]; xy: number[] }[];
    rotFwd: { p: number[]; v: number[] }[];
    rotInv: { v: number[]; p: number[] }[];
    view: { w: number[]; v: number[]; k: number; screen: number[] }[];
    orient: { n: number[]; size: number; spin: number; flat?: number; m: number[] }[];
    home: Orientation;
    scenePoint: { sx: number; sy: number; depth: number; xy: number[] }[];
    srcNow: { bx: number; by: number; D: number; xy: number[] }[];
  }[];
}

const ROOT = resolve(import.meta.dirname, '../..');
const V = JSON.parse(readFileSync(resolve(ROOT, 'tests/vectors/camera.json'), 'utf8')) as Vectors;
const SRC = readFileSync(resolve(ROOT, 'assets/reference/rosse-source/app23.js'), 'utf8').split(
  '\n',
);

/** Largest absolute difference, and how many numbers were not bit-identical. */
function differ() {
  let worst = 0;
  let inexact = 0;
  let total = 0;
  const check = (a: readonly number[], b: readonly number[]) => {
    expect(a.length).toBe(b.length);
    a.forEach((x, i) => {
      const y = b[i] ?? NaN;
      total++;
      // === : JSON keeps no signed zeros
      if (x !== y) inexact++;
      worst = Math.max(worst, Math.abs(x - y));
    });
  };
  return { check, result: () => ({ worst, inexact, total }) };
}

describe("the camera against v21's own functions (tests/vectors/camera.json)", () => {
  it('constants', () => {
    expect(V.constants).toEqual({
      CAM,
      RMIN: SKY_RMIN,
      RMAX: SKY_RMAX,
      R_FG,
      scale: UNIT_SCALE,
    });
  });

  it('incE folds the inclination into 0–90°', () => {
    for (const [incl, e] of V.incE) expect(incE(incl), String(incl)).toBe(e);
    for (const c of V.cases) expect(incE(c.camera.incl)).toBe(c.incE);
  });

  it('project, discM, rotFwd, rotInv, toView, toScreen, perspective, orient, basis, scenePoint, srcNow are bit-identical', () => {
    const d = differ();
    for (const c of V.cases) {
      const cam = c.camera;
      const R = rotationOf(cam);
      d.check(discM(cam), c.discM);
      for (const x of c.project) d.check(project(x.p, cam), x.xy);
      for (const x of c.rotFwd) d.check(rotFwd(x.p, R), x.v);
      for (const x of c.rotInv) d.check(rotInv(x.v, R), x.p);
      for (const x of c.view) {
        const v = toView(x.w, R);
        d.check(v, x.v);
        const k = perspective(v[2]);
        d.check([k], [x.k]);
        d.check(toScreen(v, k, R, UNIT_SCALE * cam.zoom), x.screen);
      }
      for (const x of c.orient) d.check(orient(x.n, x.size, x.spin, x.flat, cam), x.m);
      for (const x of c.scenePoint) d.check(scenePoint(c.home, x.sx, x.sy, x.depth, cam), x.xy);
      for (const x of c.srcNow) d.check(srcNow(c.home, x.bx, x.by, x.D, cam), x.xy);
    }
    for (const b of V.basis) d.check(basis(b.n).flat(), b.e.flat());
    const r = d.result();
    expect(r.total).toBeGreaterThan(5000);
    expect(r.inexact, `${String(r.inexact)} of ${String(r.total)} differ`).toBe(0);
    expect(r.worst).toBe(0);
  });

  it('rotInv undoes rotFwd, and project is toScreen(rotFwd) at k = 1', () => {
    for (const c of V.cases) {
      const R = rotationOf(c.camera);
      for (const x of c.project) {
        const back = rotInv(rotFwd(x.p, R), R);
        back.forEach((y, i) => {
          expect(Math.abs(y - (x.p[i] ?? 0))).toBeLessThan(1e-12);
        });
      }
    }
  });

  it('viewDesc is the same rotation rounded to f32', () => {
    for (const c of V.cases) {
      const R = rotationOf(c.camera);
      const v = viewDesc(c.camera, 0, 1, 1);
      expect([v.cos_i, v.sin_i, v.cos_az, v.sin_az, v.cos_pa, v.sin_pa]).toEqual(
        [R.ci, R.si, R.cz, R.sz, R.cp, R.sp].map(Math.fround),
      );
      expect(v.scale).toBe(Math.fround(84 * c.camera.zoom));
      expect(v.winding).toBe(c.camera.winding);
    }
    expect(rotation({ incl: 0, az: 0, w: 1, pa: 0 })).toEqual({
      ci: 1,
      si: 0,
      cz: 1,
      sz: 0,
      cp: 1,
      sp: 0,
      w: 1,
    });
  });
});

describe('incE uses and buckets', () => {
  it('INCE_USES lists every use of incE() in app23.js, at its line, with its test', () => {
    const uses: number[] = [];
    SRC.forEach((line, i) => {
      const n = (line.match(/incE\(\)/g) ?? []).length;
      for (let k = 0; k < n; k++) uses.push(i + 1);
    });
    // the definition at L856 is the one line that does not call it
    expect(uses.filter((l) => l !== 856)).toEqual(INCE_USES.map((u) => u.line));
    for (const u of INCE_USES) {
      expect(SRC[u.line - 1], `L${String(u.line)}`).toContain(u.source);
      const m = /incE\(\) (<=|<|>) (\d+)/.exec(u.source);
      if (!m) throw new Error(u.source);
      const t = Number(m[2]);
      const want = (e: number) => (m[1] === '>' ? e > t : m[1] === '<' ? e < t : e <= t);
      for (const e of [0, t - 0.001, t, t + 0.001, 90]) expect(u.test(e), u.source).toBe(want(e));
    }
  });

  it('every use gives one answer per bucket, and every bucket edge is used', () => {
    const answers = new Map<number, string>();
    const incls: number[] = [];
    for (let x = -360; x <= 720; x += 0.05) incls.push(Math.round(x * 100) / 100);
    for (const t of [70, 72, 74, 78, 80])
      for (const base of [0, 180, 360])
        for (const s of [1, -1]) {
          const x = base + s * t;
          incls.push(x, x + 1e-9, x - 1e-9, x + 1e-6, x - 1e-6);
        }
    for (const incl of incls) {
      const b = inclBucket(incl);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(INCL_BUCKETS);
      const e = incE(incl);
      const sig = INCE_USES.map((u) => (u.test(e) ? '1' : '0')).join('');
      const prev = answers.get(b);
      if (prev === undefined) answers.set(b, sig);
      else expect(sig, `incl ${String(incl)} in bucket ${String(b)}`).toBe(prev);
    }
    // the buckets are as fine as the uses need and no finer
    expect(answers.size).toBe(INCL_BUCKETS);
    expect(new Set(answers.values()).size).toBe(INCL_BUCKETS);
    // exactly 80° is a bucket of its own (L1028 tests < 80, L788 > 80)
    expect(inclBucket(80)).not.toBe(inclBucket(79.99));
    expect(inclBucket(80)).not.toBe(inclBucket(80.01));
    expect(inclBucket(100)).toBe(inclBucket(80));
    // about 21,700 inclinations through every use: 2.7 s alone, over the default 5 s under load
  }, 60_000);
});

describe('every use of the inclination in app23.js is classified (ADR 0017)', () => {
  it('each P.incl, ci() and incE() is a structure predicate or a continuous view input', () => {
    const found: string[] = [];
    const tokens: [string, RegExp][] = [
      ['P.incl', /(?<![A-Za-z0-9_.])P\.incl(?![A-Za-z0-9_])/g],
      ['ci()', /(?<![A-Za-z0-9_.])ci\(\)/g],
      ['incE()', /(?<![A-Za-z0-9_.])incE\(\)/g],
    ];
    SRC.forEach((line, i) => {
      for (const [token, re] of tokens)
        for (let k = (line.match(re) ?? []).length; k > 0; k--)
          found.push(`${String(i + 1)} ${token}`);
    });
    const listed = [
      ...INCE_USES.map((u) => `${String(u.line)} incE()`),
      ...CI_PREDICATES.map((c) => `${String(c.line)} ci()`),
      ...INCL_CONTINUOUS.flatMap((c) =>
        Array.from({ length: c.count ?? 1 }, () => `${String(c.line)} ${c.token}`),
      ),
    ];
    const sort = (a: string[]) => [...a].sort();
    expect(sort(listed)).toEqual(sort(found));
    for (const c of CI_PREDICATES) expect(SRC[c.line - 1]).toContain(c.source);
  });

  it('the structure key separates what v21 separates and nothing else', () => {
    const P = { incl: 30, kind: 'auto', bulge: 1, bulgeFlat: 0.9 };
    // L1000's cos i is |cos i| in the port (ADR 0073; v21's signed one told 30° from 150°)
    expect(inclBucket(30)).toBe(inclBucket(150));
    expect(structureKey(P)).toBe(structureKey({ ...P, incl: 150 }));
    // it flips at bulgeFlat · cos i = 0.5, i = 56.25° for bulgeFlat 0.9, inside bucket 0
    expect(structureKey({ ...P, incl: 56.2 })).not.toBe(structureKey({ ...P, incl: 56.3 }));
    expect(inclBucket(56.2)).toBe(inclBucket(56.3));
    // v21 does not evaluate it for a galaxy with a disc, or with an explicit kind
    for (const q of [
      { ...P, bulge: 0.5 },
      { ...P, kind: 'smooth' },
    ])
      expect(structureKey({ ...q, incl: 30 })).toBe(structureKey({ ...q, incl: 150 }));
    // otherwise the incE buckets decide
    const elongated = (i: number) =>
      0.9 * Math.max(Math.abs(Math.cos((i * Math.PI) / 180)), 0.05) < 0.5;
    for (let a = 0; a <= 180; a += 0.5)
      for (const b of [a + 0.25, 180 - a]) {
        const same = structureKey({ ...P, incl: a }) === structureKey({ ...P, incl: b });
        const want = elongated(a) === elongated(b) && inclBucket(a) === inclBucket(b);
        expect(same, `${String(a)} ${String(b)}`).toBe(want);
      }
  });
});
