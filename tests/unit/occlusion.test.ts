/**
 * Depth occlusion for the star (ADR 0074): the occluder grid's helpers (src/model/occlusion.ts,
 * mirrored in src/shaders/common/occlusion.wgsl), the z convention they rest on, the star jobs'
 * z, and the star marks left out where something nearer is drawn (src/fallback/kernels/star-marks.ts).
 * The GPU = CPU comparison of the culled classes is tests/gpu/starmarks.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuStipple } from '../../src/fallback/stipple';
import { starMark, type StarInputs } from '../../src/fallback/kernels/star-marks';
import { INSTANCE_WORDS } from '../../src/fallback/kernels/project';
import { Cls } from '../../src/model/classes';
import {
  OCC_CELLS,
  OCC_EPS,
  OCC_GRID,
  OCC_HALO,
  OCC_INV,
  OCC_NEVER_Z,
  OCC_Z_RANGE,
  OCC_Z_SCALE,
  gridCell,
  occluded,
  quantZ,
  stampOccluder,
} from '../../src/model/occlusion';
import { buildScene } from '../../src/model/scene';
import { STAR_JOB_WORDS, packStarJobs, satelliteDepth, starJobs } from '../../src/model/stars';
import {
  PLATE,
  cameraOf,
  orientationOf,
  perspective,
  rotFwd,
  rotation,
  scenePoint,
  scenePointZ,
} from '../../src/view/camera';
import { META } from './support/vectors';

const NO_SKY = { field: 0, fgstars: 0, companions: 0 };

describe('the grid helpers (src/model/occlusion.ts = common/occlusion.wgsl)', () => {
  const wgsl = readFileSync(
    resolve(import.meta.dirname, '../../src/shaders/common/occlusion.wgsl'),
    'utf8',
  );
  const konst = (name: string) => {
    const m = new RegExp(`const ${name}: (?:i32|u32|f32) = ([0-9.]+)u?;`).exec(wgsl);
    if (!m) throw new Error(`${name} missing in occlusion.wgsl`);
    return Number(m[1]);
  };

  it('the constants are the same in both', () => {
    expect(konst('OCC_GRID')).toBe(OCC_GRID);
    expect(Math.fround(konst('OCC_INV'))).toBe(OCC_INV);
    expect(konst('OCC_PLATE')).toBe(PLATE);
    expect(konst('OCC_HALO')).toBe(OCC_HALO);
    expect(konst('OCC_Z_RANGE')).toBe(OCC_Z_RANGE);
    expect(konst('OCC_Z_SCALE')).toBe(OCC_Z_SCALE);
    expect(konst('OCC_EPS')).toBe(OCC_EPS);
    expect(OCC_CELLS).toBe(OCC_GRID * OCC_GRID);
  });

  it('quantZ is monotone in z, at least 1, and clamped', () => {
    let last = 0;
    for (let z = -OCC_Z_RANGE - 3; z <= OCC_Z_RANGE + 3; z += 0.37) {
      const k = quantZ(z);
      expect(k).toBeGreaterThanOrEqual(last);
      expect(k).toBeGreaterThanOrEqual(1);
      last = k;
    }
    expect(quantZ(-1e9)).toBe(1);
    expect(quantZ(1e9)).toBe(quantZ(OCC_Z_RANGE));
    expect(quantZ(OCC_NEVER_Z)).toBe(quantZ(1e9));
    expect(quantZ(0.5)).toBeGreaterThan(quantZ(0.4));
  });

  it('a table of vectors (the values the WGSL twin must give)', () => {
    const keys: [number, number][] = [
      [0, 131073],
      [1, 133121],
      [-1, 129025],
      [1.4, Math.floor((64 + Math.fround(1.4)) * 2048) + 1],
      [-1000, 1],
      [1000, 262145],
    ];
    for (const [z, k] of keys) expect(quantZ(z), `quantZ(${String(z)})`).toBe(k);
    const cells: [number, number, number][] = [
      [0, 0, 0],
      [403, 401, 64 * 128 + 64],
      [10, 790, 126 * 128 + 1],
      [799.99, 799.99, 127 * 128 + 127],
      [-0.5, 10, -1],
      [10, 800, -1],
      [Number.NaN, 10, -1],
    ];
    for (const [x, y, c] of cells)
      expect(gridCell(x, y), `gridCell(${String(x)}, ${String(y)})`).toBe(c);
  });

  it('a stamp is a max over the cell and its halo, in any order', () => {
    const a = new Uint32Array(OCC_CELLS);
    const b = new Uint32Array(OCC_CELLS);
    const marks: [number, number, number][] = [
      [100, 100, 5],
      [104, 100, 9],
      [140, 100, 7],
      [0, 0, 3],
      [799, 799, 4],
    ];
    for (const [x, y, k] of marks) stampOccluder(a, gridCell(x, y), k);
    for (const [x, y, k] of [...marks].reverse()) stampOccluder(b, gridCell(x, y), k);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = gridCell(100, 100);
    expect(a[c]).toBe(9);
    expect(a[c + 1]).toBe(9);
    expect(a[c - OCC_GRID - 1]).toBe(9);
    expect(a[gridCell(140, 100) - 1]).toBe(7);
    expect(a[c + 3]).toBe(0);
    // the corner has no neighbours beyond the plate
    expect(a[0]).toBe(3);
    expect(a[OCC_GRID + 1]).toBe(3);
    expect(a[OCC_CELLS - 1]).toBe(4);
  });

  it('occluded needs an occluder nearer by more than the epsilon', () => {
    const g = new Uint32Array(OCC_CELLS);
    const star = quantZ(1);
    g[5] = star + OCC_EPS;
    expect(occluded(g, 5, star)).toBe(false);
    g[5] = star + OCC_EPS + 1;
    expect(occluded(g, 5, star)).toBe(true);
    expect(occluded(g, 6, star)).toBe(false);
    expect(occluded(g, -1, star)).toBe(false);
    // a mark nothing occludes has the nearest key of all
    expect(occluded(g.fill(quantZ(1e9)), 5, quantZ(OCC_NEVER_Z))).toBe(false);
  });
});

describe('the z convention: z points towards the viewer, so larger is nearer', () => {
  const R = rotation({ incl: 90, az: 0, pa: 0, w: 1 });
  it('rotFwd: the edge of the disc tilted towards the viewer has positive z', () => {
    // incl 90: the galaxy's +y axis points at the viewer, -y away, the axis (z) is down the plate
    expect(rotFwd([0, 1, 0], R)[2]).toBeCloseTo(1, 12);
    expect(rotFwd([0, -1, 0], R)[2]).toBeCloseTo(-1, 12);
  });

  it('what is nearer is drawn bigger by the perspective camera, and has the larger z', () => {
    expect(perspective(2)).toBeGreaterThan(perspective(0));
    expect(perspective(0)).toBeGreaterThan(perspective(-2));
    expect(quantZ(2)).toBeGreaterThan(quantZ(0));
  });

  it('scenePointZ: a point at depth d in the home frame has z = d at the home camera', () => {
    const P = presetParams('Layered: spiral beside a bright star', 7, NO_SKY);
    const cam = cameraOf(P);
    const home = orientationOf(cam);
    for (const d of [-1.5, 0, 1.4, 3]) {
      const p = scenePointZ(home, 0.6, -0.3, d, cam);
      expect(p[2]).toBeCloseTo(d, 9);
      const q = scenePoint(home, 0.6, -0.3, d, cam);
      expect([p[0], p[1]]).toEqual(q);
    }
  });
});

describe('the star jobs carry the star z', () => {
  const sceneOf = (P: ReturnType<typeof presetParams>) => {
    const home = orientationOf(cameraOf(P));
    const scene = buildScene(P, META, { home });
    if (!scene.stars) throw new Error('no stars');
    return { scene, D: scene.stars, home };
  };
  const drawn = (jobs: ReturnType<typeof starJobs>['jobs']) => jobs.filter((j) => j.kind === 5);

  it('the overlay star and its satellites: the scene point z, at the home camera and orbited', () => {
    const P = presetParams('Layered: spiral beside a bright star', 7, NO_SKY);
    const { D, home } = sceneOf(P);
    const ctx = D.ctxs[0];
    const o = ctx?.place;
    if (!ctx || !o) throw new Error('no overlay');
    for (const [dAz, dIncl] of [
      [0, 0],
      [35, 20],
      [180, 0],
    ] as const) {
      const cam = cameraOf({ ...P, az: P.az + dAz, incl: P.incl + dIncl });
      const rows = drawn(starJobs(D, P, cam, home).jobs);
      expect(rows.length).toBe(ctx.picks.stars.length);
      rows.forEach((j, i) => {
        const s = ctx.picks.stars[i];
        if (!s) throw new Error('pick');

        const want =
          i === 0
            ? scenePointZ(home, o.x, o.y, o.depth, cam)
            : scenePointZ(home, o.x + s.ux, o.y + s.uy, o.depth + satelliteDepth(s), cam);
        expect(j.z).toBeCloseTo(want[2], 5);
      });
      if (dAz === 0) expect(rows[0]?.z).toBeCloseTo(1.4, 5);
    }
    // every job of a star carries its star's z (the glare, the spikes ...)
    const cam = cameraOf(P);
    const { jobs } = starJobs(D, P, cam, home);
    const rows = drawn(jobs);
    let star = -1;
    for (const j of jobs) {
      if (j.kind === 0) star++;
      expect(j.z).toBeCloseTo(rows[star]?.z ?? NaN, 6);
    }
  });

  it('a subject star is at the centre plane, its satellites in the scene', () => {
    const P = presetParams('Star: bright, with spikes', 7, NO_SKY);
    const { D, home } = sceneOf(P);
    const cam = cameraOf({ ...P, az: P.az + 35, incl: P.incl + 20 });
    const rows = drawn(starJobs(D, P, cam, home).jobs);
    expect(rows[0]?.z).toBe(0);
    const ctx = D.ctxs[0];
    ctx?.picks.stars.forEach((s, i) => {
      if (i === 0) return;
      const want = scenePointZ(home, s.ux, s.uy, satelliteDepth(s), cam)[2];
      expect(rows[i]?.z).toBeCloseTo(want, 5);
    });
  });

  it('artefacts (trail, cosmic rays, ghost) are never occluded', () => {
    for (const name of [
      'Artefact: satellite trail',
      'Artefact: ghost reflection',
      'Artefact: cosmic rays',
    ]) {
      const P = presetParams(name, 7, NO_SKY);
      const { D, home } = sceneOf(P);
      const { jobs } = starJobs(D, P, cameraOf(P), home);
      const art = jobs.filter((j) => j.kind >= 6);
      expect(art.length).toBeGreaterThan(0);
      for (const j of art) expect(j.z, `${name} kind ${String(j.kind)}`).toBe(OCC_NEVER_Z);
    }
    // the overlay trail and rays on a galaxy too
    for (const ov of ['trail', 'cosmic', 'ghost'] as const) {
      const P = {
        ...presetParams('Layered: spiral beside a bright star', 7, NO_SKY),
        ovArtefact: ov,
      };
      const { D, home } = sceneOf(P);
      const art = starJobs(D, P, cameraOf(P), home).jobs.filter((j) => j.kind >= 6);
      expect(art.length).toBeGreaterThan(0);
      for (const j of art) expect(j.z).toBe(OCC_NEVER_Z);
    }
  });

  it('packStarJobs writes z in the word that was pad0', () => {
    const P = presetParams('Layered: spiral beside a bright star', 7, NO_SKY);
    const { D, home } = sceneOf(P);
    const { jobs } = starJobs(D, P, cameraOf(P), home);
    const f = new Float32Array(packStarJobs(jobs));
    jobs.forEach((j, i) => {
      expect(f[i * STAR_JOB_WORDS + 13]).toBe(Math.fround(j.z));
    });
  });
});

describe('the star marks left out where something nearer is drawn', () => {
  const P = {
    ...presetParams('Layered: spiral beside a bright star', 7, NO_SKY),
    ovArtefact: 'trail' as const,
  };
  const home = orientationOf(cameraOf(P));
  const scene = buildScene(P, META, { home });
  const cam = cameraOf(P);
  const sj = scene.stars ? starJobs(scene.stars, P, cam, home) : null;
  if (!sj) throw new Error('no stars');
  const jb = packStarJobs(sj.jobs);
  const X = (occ?: Uint32Array): StarInputs => ({
    jobsF: new Float32Array(jb),
    jobsU: new Uint32Array(jb),
    u: {
      n_jobs: sj.jobs.length,
      n_slots: sj.nSlots,
      key: scene.galaxy.g.key,
      n_dot_pool: scene.galaxy.g.n_dot_pool,
      pen_dot: scene.galaxy.g.pen_dot,
      wobble: 0,
      out_base: 0,
    },
    pool: scene.galaxy.pool,
    dotBase: scene.galaxy.dotBase,
    noise: scene.galaxy.noise,
    ...(occ ? { occ } : {}),
  });
  const run = (occ?: Uint32Array) => {
    const f = new Float32Array(sj.nSlots * INSTANCE_WORDS);
    const u = new Uint32Array(f.buffer);
    const x = X(occ);
    const classes = new Uint32Array(sj.nSlots);
    for (let i = 0; i < sj.nSlots; i++) classes[i] = starMark(x, i, f, u);
    return { classes, f };
  };
  const none = run();
  const starZ = (slot: number) => {
    let j = 0;
    while (j + 1 < sj.jobs.length && (sj.jobs[j + 1]?.first ?? Infinity) <= slot) j++;
    return sj.jobs[j]?.z ?? 0;
  };

  it('an empty grid, or one with only farther marks, changes nothing', () => {
    expect(Array.from(run(new Uint32Array(OCC_CELLS)).classes)).toEqual(Array.from(none.classes));
    const far = new Uint32Array(OCC_CELLS).fill(quantZ(-1.5));
    // the overlay star is at z 1.4, its satellites between 0.6 and 2.2: all nearer than -1.5
    expect(Array.from(run(far).classes)).toEqual(Array.from(none.classes));
  });

  it('a nearer occluder everywhere drops every star mark on the plate and keeps the artefacts', () => {
    const near = new Uint32Array(OCC_CELLS).fill(quantZ(50));
    const got = run(near);
    let dropped = 0;
    let kept = 0;
    for (let i = 0; i < sj.nSlots; i++) {
      const was = none.classes[i];
      const o = i * INSTANCE_WORDS;
      const cell = gridCell(none.f[o] ?? 0, none.f[o + 1] ?? 0);
      const sentinel = starZ(i) === OCC_NEVER_Z;
      if (was === Cls.none || sentinel || cell < 0) expect(got.classes[i]).toBe(was);
      else {
        expect(got.classes[i]).toBe(Cls.none);
        dropped++;
      }
      if (sentinel && was !== Cls.none) kept++;
    }
    expect(dropped).toBeGreaterThan(1000);
    expect(kept).toBeGreaterThan(0);
  });

  it('only the marks in the nearer occluder cells are lost: a rectangle of the plate', () => {
    // the right half of the plate holds an occluder 1 unit nearer than the overlay star's z (1.4)
    const grid = new Uint32Array(OCC_CELLS);
    for (let y = 0; y < OCC_GRID; y++)
      for (let x = OCC_GRID / 2; x < OCC_GRID; x++) grid[y * OCC_GRID + x] = quantZ(2.9);
    const got = run(grid);
    let lost = 0;
    let stayed = 0;
    for (let i = 0; i < sj.nSlots; i++) {
      const was = none.classes[i];
      if (was === Cls.none) continue;
      const o = i * INSTANCE_WORDS;
      const cell = gridCell(none.f[o] ?? 0, none.f[o + 1] ?? 0);
      const occ = cell >= 0 && grid[cell] !== 0 && quantZ(2.9) > quantZ(starZ(i)) + OCC_EPS;
      expect(got.classes[i], `slot ${String(i)}`).toBe(occ ? Cls.none : was);
      if (occ) lost++;
      else stayed++;
    }
    expect(lost).toBeGreaterThan(100);
    expect(stayed).toBeGreaterThan(100);
  });

  it('a whole pipeline: the galaxy in front of the star takes marks from it and from nothing else', () => {
    // seen from below the disc (incl 125), the galaxy covers the overlay star
    const cpu = new CpuStipple(scene);
    const below = cameraOf({ ...P, incl: 125 });
    const on = cpu.view(below);
    cpu.occlusion = false;
    const off = cpu.view(below);
    const n = scene.galaxy.g.n + scene.galaxy.g.n_extra;
    expect(Array.from(on.classes.subarray(0, n))).toEqual(Array.from(off.classes.subarray(0, n)));
    const count = (c: Uint32Array) => c.subarray(n).filter((x) => x <= Cls.knot).length;
    expect(count(on.classes)).toBeLessThan(count(off.classes));
    for (let i = n; i < on.classes.length; i++)
      expect([off.classes[i], Cls.none]).toContain(on.classes[i]);
    // the drawn star's vector mark (rstar) is all or nothing, and the artefacts stay
    expect(on.perClass[Cls.rstar]).toBeLessThanOrEqual(off.perClass[Cls.rstar] ?? 0);
  });

  it('with no star on a galaxy, or no galaxy under a star, nothing changes', () => {
    const subject = presetParams('Star: bright, with spikes', 7, NO_SKY);
    const s = buildScene(subject, META, { home: orientationOf(cameraOf(subject)) });
    const cpu = new CpuStipple(s);
    const c = cameraOf({ ...subject, incl: 125 });
    const on = cpu.view(c);
    cpu.occlusion = false;
    const off = cpu.view(c);
    expect(Array.from(on.classes)).toEqual(Array.from(off.classes));
    expect(Array.from(on.perClass)).toEqual(Array.from(off.perClass));
  });
});
