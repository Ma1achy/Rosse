/**
 * Strong lensing, the scene description (ADR 0003, 0008, 0050): cored elliptical lenses (Keeton
 * 2001) plus external shear, the solver's grid, the source galaxies and where they sit. Reference:
 * `lensModel`, `lensSolver`, `buildSourceGalaxy`, `lensMarks` and `lensSprites10`
 * (app23.js:L594–707), and `srcNow` (L450).
 *
 * This file is the CPU half, built in the model tier in microseconds: halos, solver geometry,
 * the sources' own scenes (each a galaxy described exactly as a single one is, in its own plane;
 * nothing global is swapped, unlike `buildSourceGalaxy`), their curves resampled in the source
 * plane, their drawn parts, the quasar and the cluster's member galaxies. The kernels that solve
 * and emit are compute/lens-*.wgsl and their twins in src/fallback/kernels/lens.ts; the
 * orchestration is src/render/lens.ts (WebGPU) and src/fallback/lens.ts (CPU).
 *
 * Random numbers are the counter-based ones (ADR 0004), on `Stream.lens`: v21 draws the cluster's
 * layout, every source's options and the member galaxies from sequential streams. Golden runs hand
 * in v21's own picks (`LensPicks`, replayed by tests/golden/compare/v21-lens.ts), as they do for
 * the variation, the strokes and the parts (ADR 0015, 0021).
 *
 * Deliberate divergence (docs/architecture.md, Q3): the orientation at which the sources are fixed
 * in 3D is explicit (`LensHome`, src/core/home.ts), not the camera of the first render.
 */
import { lensHomeOf, type LensHome } from '../core/home';
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import type { Instance } from '../marks/instance';
import { coreInstances, vectorRows, type VectorRow } from '../model/parts';
import type { GalaxyScene, SceneOptions } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';
import { PLATE, UNIT_SCALE, project, srcNow, viewScale, type Camera } from '../view/camera';

const f = Math.fround;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const DEG = Math.PI / 180;

/** Indices on the `lens` stream (scene picks). Emission draws use `EMIT_INDEX` and up. */
export const LensIndex = {
  halos: 1,
  /** member halo i uses `members + i` */
  members: 100,
  drawing: 50,
  /** source i (in build order) uses `sources + i` */
  sources: 200,
  /** the cluster's member galaxy i (drawn in) uses `memberTiles + i` */
  memberTiles: 300,
} as const;

/** Emission draws are keyed (mark · 8 + image) from here up, clear of the scene picks. */
export const EMIT_INDEX = 1 << 20;

/** The most images a source point is given (ADR 0008; v21 has no cap, five is the most seen). */
export const MAX_IMAGES = 8;
/** A triangle covering more bins than this straddles a caustic and is skipped (app23.js:L620). */
export const MAX_BINS = 400;
/** v21's source galaxy scale: `VIEW.scale` while one is built (app23.js:L631). */
export const SRC_SCALE = 70;

/** One cored isothermal ellipsoid (`lensModel`'s halo). */
export interface Halo {
  x: number;
  y: number;
  /** Einstein-radius-like strength */
  b: number;
  /** axis ratio */
  q: number;
  /** position angle, radians */
  ang: number;
  /** core radius */
  s: number;
  member?: boolean;
}

/** Halos, shear and the strength factor of a source plane (`lensModel(f)`, L594). */
export interface LensModel {
  halos: Halo[];
  /** shear magnitude and its angle's cos 2φ, sin 2φ */
  g: number;
  c2: number;
  s2: number;
  /** the source plane's strength relative to the main one */
  f: number;
}

/** The halos: a single cored ellipsoid, or the cluster's 1 + 7–11 (L594–598). */
export function lensHalos(P: Params, picks?: LensPicks): Halo[] {
  const thE = P.lensR;
  if (!P.lensCluster)
    return [
      {
        x: 0,
        y: 0,
        b: thE,
        q: P.lensQ,
        ang: ((P.lensAngle || 0) * Math.PI) / 180,
        s: thE * P.lensCore,
      },
    ];
  const halos: Halo[] = [{ x: 0, y: 0, b: thE * 1.55, q: 0.72, ang: 0.35, s: thE * 0.22 }];
  if (picks?.halos) return halos.concat(picks.halos);
  const nm = 7 + Math.floor(new Draws(P.seed, Stream.lens, LensIndex.halos).f32() * 5);
  for (let i = 0; i < nm; i++) {
    const r = new Draws(P.seed, Stream.lens, LensIndex.members + i);
    const a = r.f32() * 6.2832;
    const d = thE * (0.55 + 1.7 * Math.sqrt(r.f32()));
    halos.push({
      x: d * Math.cos(a),
      y: d * Math.sin(a),
      b: thE * (0.07 + 0.17 * r.f32()),
      q: 0.6 + 0.35 * r.f32(),
      ang: r.f32() * 3.1416,
      s: thE * 0.01,
      member: true,
    });
  }
  return halos;
}

export function lensModel(P: Params, factor: number, picks?: LensPicks): LensModel {
  const phi = P.lensShearA * DEG;
  return {
    halos: lensHalos(P, picks),
    g: P.lensShear,
    c2: Math.cos(2 * phi),
    s2: Math.sin(2 * phi),
    f: factor,
  };
}

/** The deflection α(x, y) of the model, in f64 (v21's `alpha`, L599–605). Test oracle and the weak lens. */
export function deflection(M: LensModel, x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const h of M.halos) {
    const dx = x - h.x;
    const dy = y - h.y;
    const ca = Math.cos(h.ang);
    const sa = Math.sin(h.ang);
    const u = dx * ca + dy * sa;
    const v = -dx * sa + dy * ca;
    const q = clamp(h.q, 0.2, 0.995);
    const e = Math.sqrt(1 - q * q);
    const ps = Math.sqrt(q * q * (h.s * h.s + u * u) + v * v);
    const kk = (h.b * q) / e;
    const au = kk * Math.atan((e * u) / (ps + h.s));
    const av = kk * Math.atanh(clamp((e * v) / (ps + q * q * h.s), -0.999999, 0.999999));
    ax += au * ca - av * sa;
    ay += au * sa + av * ca;
  }
  ax += M.g * (M.c2 * x + M.s2 * y);
  ay += M.g * (M.s2 * x - M.c2 * y);
  return [ax * M.f, ay * M.f];
}

/** The lensing potential, approximate (v21's `psi`, L606): enough to order the time delays. */
export function potential(M: LensModel, x: number, y: number): number {
  let pp = 0;
  for (const h of M.halos) {
    const dx = x - h.x;
    const dy = y - h.y;
    const ca = Math.cos(h.ang);
    const sa = Math.sin(h.ang);
    const u = dx * ca + dy * sa;
    const v = -dx * sa + dy * ca;
    pp += h.b * Math.sqrt(h.q * u * u + (v * v) / h.q + h.s * h.s);
  }
  return (pp + 0.5 * M.g * (M.c2 * (x * x - y * y) + 2 * M.s2 * x * y)) * M.f;
}

// ---------------------------------------------------------------------------------------------
// The solver's geometry, as the kernels read it

/** Floats per halo in the packed table: x y cos sin | q s e kk | b q_raw 0 0. */
export const HALO_WORDS = 12;

/** One image-plane grid: where it is, how fine, which source plane, which halos. */
export interface SolverDesc {
  /** half width of the image plane, lens units */
  R: number;
  /** cells per side (vertices G + 1) */
  G: number;
  /** the source plane's strength factor */
  f: number;
  /** a cell's size, 2R/G, f32 */
  cell: number;
  halos: Float32Array<ArrayBuffer>;
  nHalo: number;
  /** g, cos 2φ, sin 2φ, f32 */
  shear: [number, number, number];
}

export function packHalos(halos: readonly Halo[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(1, halos.length) * HALO_WORDS);
  halos.forEach((h, i) => {
    const q = clamp(h.q, 0.2, 0.995);
    const e = Math.sqrt(1 - q * q);
    out.set(
      [h.x, h.y, Math.cos(h.ang), Math.sin(h.ang), q, h.s, e, (h.b * q) / e, h.b, h.q, 0, 0],
      i * HALO_WORDS,
    );
  });
  return out;
}

export function solverDesc(M: LensModel, R: number, G: number): SolverDesc {
  return {
    R: f(R),
    G,
    f: f(M.f),
    cell: f((2 * f(R)) / G),
    halos: packHalos(M.halos),
    nHalo: M.halos.length,
    shear: [f(M.g), f(M.c2), f(M.s2)],
  };
}

// ---------------------------------------------------------------------------------------------
// Sources

/** v21's source-galaxy options (`o` of `buildSourceGalaxy`, L630). */
export interface SourceOpts {
  arms: number;
  pitch?: number;
  bulge: number;
  bar?: number;
  incl?: number;
  pa?: number;
  stars?: number;
  lines?: number;
  flocc?: number;
  knots?: number;
  irr?: number;
}

/**
 * The parameters of a source galaxy: the main ones with what `buildSourceGalaxy` overrides
 * (app23.js:L632–634). Nothing else about it is special: it is described and drawn as any galaxy.
 */
export function sourceParams(P: Params, seed: number, o: SourceOpts): Params {
  return {
    ...P,
    merger: 0,
    lensOn: 0,
    lensCluster: 0,
    lensDouble: 0,
    shellsOn: 0,
    subject: 'galaxy',
    field: 0,
    fgstars: 0,
    trails: 0,
    companions: 0,
    arrow: 0,
    jet: 0,
    rewind: 0,
    unwrap: 0,
    distort: 0,
    ring: 0,
    whole: 0,
    envelope: 0,
    outline: 0,
    seed,
    arms: o.arms,
    pitch: o.pitch || 22,
    bulge: o.bulge,
    bar: o.bar || 0,
    incl: o.incl || 25,
    az: 0,
    pa: o.pa || 0,
    winding: 1,
    stars: o.stars || 2400,
    stipple: 1,
    halo: 0.03,
    lines: o.lines == null ? 0.6 : o.lines,
    flocc: o.flocc || 0,
    knots: o.knots == null ? 0.6 : o.knots,
    sparkle: 0.3,
    dustScribble: 0.25,
    irr: o.irr || 0,
  };
}

/** A source galaxy's camera: its own orientation at v21's scale of 70 (L631, L633). */
export function sourceCamera(Ps: Params): Camera {
  return { incl: Ps.incl, az: 0, pa: Ps.pa, winding: 1, zoom: SRC_SCALE / UNIT_SCALE };
}

/** One of the source's curves, resampled in the source plane at half a grid cell (L650). */
export interface LensCurve {
  /** resampled points, source plane (f32) */
  pts: [number, number][];
  /** the stroke (row of the strokes sheet), width in pens, ink alpha, stretched or re-spaced */
  k: number;
  w: number;
  a: number;
  stretch: boolean;
}

/** The most points a resampled curve keeps (v21 has no cap; curves have tens). */
export const MAX_CURVE_POINTS = 256;

export function resampleCurve(b: readonly [number, number][], cell: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 1; i < b.length; i++) {
    const [sx, sy] = b[i - 1] as [number, number];
    const [ex, ey] = b[i] as [number, number];
    const L = Math.hypot(ex - sx, ey - sy);
    const st = Math.max(1, Math.ceil(L / (cell * 0.5)));
    for (let s = 0; s < st; s++) pts.push([sx + ((ex - sx) * s) / st, sy + ((ey - sy) * s) / st]);
  }
  if (b.length) pts.push(b[b.length - 1] as [number, number]);
  if (pts.length <= MAX_CURVE_POINTS) return pts.map(([x, y]) => [f(x), f(y)]);
  // thin evenly, keeping both ends (never reached by the presets)
  return Array.from({ length: MAX_CURVE_POINTS }, (_, i) => {
    const [x, y] = pts[Math.round((i * (pts.length - 1)) / (MAX_CURVE_POINTS - 1))] as [
      number,
      number,
    ];
    return [f(x), f(y)] as [number, number];
  });
}

/** A source mark that is not stipple: the drawn core (and nuclear spiral), a sprite row. */
export interface LensExtraMark {
  kind: 'core';
  /** source plane, f32 */
  b: [number, number];
  inst: Instance;
}

/** A drawn vector part of a source, to be warped into every image (the `vecs` of L641). */
export interface LensVec {
  row: VectorRow;
  b: [number, number];
}

export type SourceKind = 'galaxy' | 'host' | 'cluster' | 'double' | 'drawing';

/** One lensed source. */
export interface LensSource {
  kind: SourceKind;
  /** its position before the home orientation moves it: lens-frame offset and depth (`srcNow`'s arguments) */
  bx: number;
  by: number;
  depth: number;
  /** which solver (0 main, 1 the double source plane's) */
  solver: number;
  /** the stipple budget `dens` of `lensMarks` */
  dens: number;
  /** the source plane's scale: plate px at the source's scale of 70 → source-plane units */
  k: number;
  /** the source galaxy, described as any other (null for a drawing) */
  Ps: Params | null;
  scene: GalaxyScene | null;
  cam: Camera | null;
  curves: LensCurve[];
  extras: LensExtraMark[];
  vecs: LensVec[];
}

/** A cluster member drawn in at its halo (L668): a `smooth` whole drawing. */
export interface LensMember {
  halo: Halo;
  tile: number;
}

/** The model tier's description of a lensed scene. */
export interface LensScene {
  home: LensHome;
  /** thE, the Einstein radius */
  thE: number;
  models: LensModel[];
  solvers: SolverDesc[];
  sources: LensSource[];
  quasar: boolean;
  members: LensMember[];
  /** the deep field's weak-lensing model of a cluster (`lensModel(1.3)`, L669), else null */
  weak: LensModel | null;
  /** the golden runs' record of what was picked, for the report */
  picks: LensPicks;
}

/** One source's options and scene options, as a golden run replays them. */
export interface LensPickSource {
  /** the source galaxy's options (v21's `o`), whole */
  opts?: Partial<SourceOpts>;
  /** cluster only: the angle, distance and size drawn for it (L664) */
  a?: number;
  d?: number;
  sz?: number;
  /** scene options for the source's own galaxy (variation, strokes, parts: ADR 0015, 0021) */
  scene?: SceneOptions;
}

/**
 * Discrete choices of the lens stage, as data. The engine makes them with its counter streams;
 * a golden run hands in v21's, replayed from its streams (ADR 0015, 0021).
 */
export interface LensPicks {
  /** the cluster's member halos (the main halo is fixed) */
  halos?: Halo[];
  /** per source in build order: [the single or host galaxy] or [the cluster's, in order], then the double's */
  sources?: LensPickSource[];
  /** the drawing source's `whole` tile */
  drawing?: number;
  /** the member galaxies' `whole` tiles, in halo order */
  members?: number[];
}

/** What lensing needs besides the parameters. */
export interface LensOptions {
  home?: LensHome;
  picks?: LensPicks;
  /** the placement key of the main galaxy, when it is not the seed: the sources are re-keyed with it */
  placementKey?: number;
}

export type SceneBuilder = (P: Params, meta: DrawingsMeta, opts: SceneOptions) => GalaxyScene;

/** The 3D position of a source, as the camera sees it (`srcNow`, app23.js:L450): lens-frame units. */
export function sourceOffset(
  home: LensHome,
  cam: Camera,
  bx: number,
  by: number,
  depth: number,
): [number, number] {
  return srcNow({ incl: home.incl, az: home.az, w: home.w, pa: 0 }, bx, by, depth, cam);
}

/** The depths of v21's sources (`srcNow`'s third argument). */
export const sourceDepth = {
  main: (thE: number) => 2.5 * thE,
  cluster: (thE: number, i: number) => thE * (1.5 + 2 * ((i * 0.618034) % 1)),
  double: (thE: number) => 3.5 * thE,
};

function describeSource(
  P: Params,
  meta: DrawingsMeta,
  build: SceneBuilder,
  base: Omit<LensSource, 'Ps' | 'scene' | 'cam' | 'curves' | 'extras' | 'vecs' | 'k'>,
  seed: number,
  sizeGU: number,
  o: SourceOpts,
  pick: LensPickSource | undefined,
  cell: number,
  rekey: number | undefined,
): LensSource {
  const opts: SourceOpts = { ...o, ...pick?.opts };
  const Ps = sourceParams(P, seed, opts);
  const scene = build(Ps, meta, {
    ...pick?.scene,
    ...(rekey === undefined ? {} : { placementKey: (seed + rekey) >>> 0 }),
  });
  const cam = sourceCamera(Ps);
  const k = sizeGU / (4.2 * SRC_SCALE);
  const ts = (X: number, Y: number): [number, number] => [
    f((X - PLATE / 2) * k),
    f((Y - PLATE / 2) * k),
  ];
  const curves: LensCurve[] = scene.ribbons.curves.map((c) => ({
    pts: resampleCurve(
      c.pts.map((p) => {
        const q = project(p, cam);
        return ts(q[0], q[1]);
      }),
      cell,
    ),
    k: c.k,
    w: c.w,
    a: c.a,
    stretch: c.stretch,
  }));
  const extras: LensExtraMark[] = coreInstances(
    Ps,
    meta,
    cam,
    scene.galaxy.noise,
    scene.vectors.parts.picks.nuclear,
  ).map((inst) => ({ kind: 'core', b: ts(inst.x, inst.y), inst }));
  const vecs: LensVec[] = vectorRows(Ps, scene.variation, meta, scene.vectors.parts, cam).map(
    (row) => ({ row, b: ts(row.x, row.y) }),
  );
  return { ...base, k: f(k), Ps, scene, cam, curves, extras, vecs };
}

/**
 * Every discrete choice the engine makes for a lens by itself (docs/adr/0051): the cluster's
 * member halos, each source's options, the sketch's drawing and the member galaxies' drawings, on
 * `Stream.lens`. The draws are v21's, in v21's order within each group, on counter indices of
 * their own (`LensIndex`), so a source's choices depend on it alone.
 */
export function ownLensPicks(P: Params, meta: DrawingsMeta): LensPicks {
  const thE = P.lensR;
  const at = (i: number) => new Draws(P.seed, Stream.lens, LensIndex.sources + i);
  const sources: LensPickSource[] = [];
  const picks: LensPicks = { sources };
  const whole = meta.vectors?.whole?.type ?? [];
  const tiles = (prefix: string) => {
    const pool: number[] = [];
    whole.forEach((t, i) => {
      if (t.startsWith(prefix)) pool.push(i);
    });
    return pool;
  };
  if (P.lensSource === 'quasar') sources.push({ opts: {} });
  else if (P.lensSource === 'drawing') {
    const pool = tiles('galaxy');
    const r = new Draws(P.seed, Stream.lens, LensIndex.drawing);
    picks.drawing = pool.length ? (pool[Math.floor(r.f32() * pool.length)] ?? 0) : 0;
  } else if (P.lensCluster) {
    picks.halos = lensHalos(P).slice(1);
    const nS = 6 + Math.floor(at(0).f32() * 4);
    for (let i = 0; i < nS; i++) {
      const r = at(1 + i);
      const a = r.f32() * 6.2832;
      const d = thE * (0.08 + 1.5 * Math.pow(r.f32(), 0.8));
      const sz = thE * (0.14 + 0.2 * r.f32());
      sources.push({
        a,
        d,
        sz,
        opts: {
          arms: 1 + Math.floor(r.f32() * 3),
          bulge: 0.1 + 0.3 * r.f32(),
          flocc: r.f32() < 0.3 ? 0.5 : 0,
          incl: r.f32() * 60,
          pa: r.f32() * 180,
        },
      });
    }
    const smooth = tiles('smooth');
    picks.members = picks.halos.map((_, i) => {
      const r = new Draws(P.seed, Stream.lens, LensIndex.memberTiles + i);
      return smooth.length ? (smooth[Math.floor(r.f32() * smooth.length)] ?? 0) : 0;
    });
  } else {
    const r = at(0);
    sources.push({
      opts: {
        arms: 2 + Math.floor(r.f32() * 2),
        incl: 20 + 30 * r.f32(),
        pa: r.f32() * 180,
      },
    });
  }
  if (P.lensDouble) sources.push({ opts: {} });
  return picks;
}

/**
 * The lensed scene of `P` (L688–707): the halos, the solver geometry, the sources and what they
 * are made of. `build` is `buildScene`, passed in so that the source galaxies are described by the
 * engine's own scene description. `opts.picks` replaces the engine's own choices where given.
 */
export function describeLens(
  P: Params,
  meta: DrawingsMeta,
  build: SceneBuilder,
  opts: LensOptions = {},
): LensScene {
  const own = ownLensPicks(P, meta);
  const given = opts.picks ?? {};
  const picks: LensPicks = {
    ...(own.halos || given.halos ? { halos: given.halos ?? own.halos ?? [] } : {}),
    sources: (own.sources ?? []).map((s, i) => given.sources?.[i] ?? s),
    ...(own.drawing !== undefined || given.drawing !== undefined
      ? { drawing: given.drawing ?? own.drawing ?? 0 }
      : {}),
    ...(own.members || given.members ? { members: given.members ?? own.members ?? [] } : {}),
  };
  const rekey = opts.placementKey === undefined ? undefined : opts.placementKey - P.seed;
  const home = opts.home ?? lensHomeOf(P);
  const thE = P.lensR;
  const model = lensModel(P, 1, picks);
  const R = (P.lensCluster ? 3.6 : 2.5) * thE;
  const G = P.lensCluster ? 250 : 210;
  const models = [model];
  const solvers = [solverDesc(model, R, G)];
  if (P.lensDouble) {
    const m2 = lensModel(P, 1.42, picks);
    models.push(m2);
    solvers.push(solverDesc(m2, R * 1.2, 200));
  }
  const cell0 = (solvers[0] as SolverDesc).cell;
  const sa = P.lensSrcA * DEG;
  const mainPos = {
    bx: P.lensSrc * thE * Math.cos(sa),
    by: P.lensSrc * thE * Math.sin(sa),
    depth: sourceDepth.main(thE),
  };
  const sources: LensSource[] = [];
  const members: LensMember[] = [];
  let pickIndex = 0;
  const nextPick = () => picks.sources?.[pickIndex++];
  const stub = (kind: SourceKind, pos: typeof mainPos, solver: number, dens: number) => ({
    kind,
    ...pos,
    solver,
    dens,
  });

  if (P.lensSource === 'quasar') {
    // a faint host galaxy under the quasar (L691)
    sources.push(
      describeSource(
        P,
        meta,
        build,
        stub('host', mainPos, 0, P.lensStars * 0.18),
        P.seed * 17 + 5,
        2 * P.lensSize,
        { arms: 2, bulge: 0.25, stars: 1400, lines: 0.2, knots: 0.15 },
        nextPick(),
        cell0,
        rekey,
      ),
    );
  } else if (P.lensSource === 'drawing') {
    // one of the user's drawings as the source (L692–694): a `whole` galaxy drawing, 140 px wide
    const Sd = SRC_SCALE;
    const row: VectorRow = {
      atlas: 'whole',
      tile: picks.drawing ?? 0,
      x: PLATE / 2,
      y: PLATE / 2,
      m: [Sd * 2, 0, 0, Sd * 2],
      ps: 1,
      alpha: 1,
    };
    sources.push({
      ...stub('drawing', mainPos, 0, 0),
      k: f((2 * P.lensSize) / (Sd * 2)),
      Ps: null,
      scene: null,
      cam: null,
      curves: [],
      extras: [],
      vecs: [{ row, b: [0, 0] }],
    });
  } else if (P.lensCluster) {
    // 6–9 background galaxies, each at its own depth (L695–699)
    const nS = (picks.sources?.length ?? 0) - (P.lensDouble ? 1 : 0);
    for (let i = 0; i < nS; i++) {
      const pk = nextPick();
      const a = pk?.a ?? 0;
      const d = pk?.d ?? 0;
      sources.push(
        describeSource(
          P,
          meta,
          build,
          stub(
            'cluster',
            { bx: d * Math.cos(a), by: d * Math.sin(a), depth: sourceDepth.cluster(thE, i) },
            0,
            (P.lensStars / nS) * 1.1,
          ),
          P.seed * 29 + i * 7 + 3,
          pk?.sz ?? thE * 0.2,
          { arms: 1, bulge: 0.2, stars: 1200, lines: 0.45 },
          pk,
          cell0,
          rekey,
        ),
      );
    }
    // the member galaxies, drawn in (L700)
    const memberHalos = model.halos.filter((h) => h.member);
    const nWhole = (meta.vectors?.whole?.type ?? []).some((t) => t.startsWith('smooth'));
    memberHalos.forEach((halo, i) => {
      if (nWhole) members.push({ halo, tile: picks.members?.[i] ?? 0 });
    });
  } else {
    // one source galaxy, lensed mark by mark (L702)
    sources.push(
      describeSource(
        P,
        meta,
        build,
        stub('galaxy', mainPos, 0, P.lensStars),
        P.seed * 17 + 5,
        2 * P.lensSize,
        { arms: 2, bulge: 0.2, stars: 2200, lines: 0.35, knots: 0.35 },
        nextPick(),
        cell0,
        rekey,
      ),
    );
  }
  if (P.lensDouble) {
    // a second source, farther away, gives a second and wider ring (L704)
    const s2 = solvers[1] as SolverDesc;
    sources.push(
      describeSource(
        P,
        meta,
        build,
        stub(
          'double',
          { bx: 0.02 * thE, by: -0.015 * thE, depth: sourceDepth.double(thE) },
          1,
          P.lensStars * 0.45,
        ),
        P.seed * 41 + 9,
        2 * P.lensSize * 0.9,
        { arms: 0, bulge: 0.1, stars: 1600, lines: 0.15, knots: 0.3, flocc: 0.6, irr: 1 },
        nextPick(),
        s2.cell,
        rekey,
      ),
    );
  }
  return {
    home,
    thE,
    models,
    solvers,
    sources,
    quasar: P.lensSource === 'quasar',
    members,
    weak:
      P.lensCluster && P.lensSource !== 'quasar' && P.lensSource !== 'drawing'
        ? lensModel(P, 1.3, picks)
        : null,
    picks,
  };
}

// ---------------------------------------------------------------------------------------------
// The view: where the sources are, and the numbers of the plate

/** Everything a view adds to the model tier's lens scene. */
export interface LensView {
  /** per source, its image-plane position `srcNow` + the offset of the source's own marks (f32) */
  bc: [number, number][];
  /** plate px per lens unit (VIEW.scale), cos and sin of the roll, f32 */
  U: number;
  ca: number;
  sa: number;
}

export function lensView(L: LensScene, cam: Camera): LensView {
  const pa = cam.pa * DEG;
  return {
    bc: L.sources.map((s) => {
      const [x, y] = sourceOffset(L.home, cam, s.bx, s.by, s.depth);
      return [f(x), f(y)];
    }),
    U: f(viewScale(cam.zoom)),
    ca: f(Math.cos(pa)),
    sa: f(Math.sin(pa)),
  };
}

/** The member galaxies as placed rows for a camera (L668): `z = b · U · 3.2`, flattened by q. */
export function memberRows(L: LensScene, cam: Camera): VectorRow[] {
  const U = viewScale(cam.zoom);
  const pa = cam.pa * DEG;
  const ca = Math.cos(pa);
  const sa = Math.sin(pa);
  return L.members.map(({ halo: h, tile }) => {
    const z = h.b * U * 3.2;
    return {
      atlas: 'whole' as const,
      tile,
      x: PLATE / 2 + (h.x * ca - h.y * sa) * U,
      y: PLATE / 2 + (h.x * sa + h.y * ca) * U,
      m: [
        z * Math.cos(h.ang),
        z * Math.sin(h.ang),
        -z * Math.sin(h.ang) * h.q,
        z * Math.cos(h.ang) * h.q,
      ],
      ps: 1,
      alpha: 1,
    };
  });
}

/**
 * Weak lensing of one deep-field drawing round a cluster (app23.js:L1273–1278): the 2 × 2 that
 * stretches it tangentially, from finite differences of the 1.3-strength deflection. `null` where
 * the field's magnification is too strong to trust (|det| < 0.25). The M7 deep field calls this
 * for each of its `bg` drawings and applies the result as a `post` warp about the drawing's own
 * centre (`c + S (q − c)`, the hook of src/model/vectors.ts); until the deep field exists nothing
 * calls it. `X, Y` is the drawing's plate position.
 */
export function weakLensing(
  M: LensModel,
  X: number,
  Y: number,
  cam: Camera,
): [number, number, number, number] | null {
  const Uw = viewScale(cam.zoom);
  const paw = cam.pa * DEG;
  const cw = Math.cos(paw);
  const sw = Math.sin(paw);
  const dx = (X - PLATE / 2) / Uw;
  const dy = (Y - PLATE / 2) / Uw;
  const x = dx * cw + dy * sw;
  const y = -dx * sw + dy * cw;
  const h = 0.01;
  const a0 = deflection(M, x, y);
  const ax1 = deflection(M, x + h, y);
  const ay1 = deflection(M, x, y + h);
  const axx = (ax1[0] - a0[0]) / h;
  const axy = (ay1[0] - a0[0]) / h;
  const ayx = (ax1[1] - a0[1]) / h;
  const ayy = (ay1[1] - a0[1]) / h;
  const A11 = 1 - axx;
  const A12 = -axy;
  const A21 = -ayx;
  const A22 = 1 - ayy;
  const det = A11 * A22 - A12 * A21;
  if (Math.abs(det) < 0.25) return null;
  const M11 = A22 / det;
  const M12 = -A12 / det;
  const M21 = -A21 / det;
  const M22 = A11 / det;
  const S11 = cw * (M11 * cw - M12 * sw) - sw * (M21 * cw - M22 * sw);
  const S12 = cw * (M11 * sw + M12 * cw) - sw * (M21 * sw + M22 * cw);
  const S21 = sw * (M11 * cw - M12 * sw) + cw * (M21 * cw - M22 * sw);
  const S22 = sw * (M11 * sw + M12 * cw) + cw * (M21 * sw + M22 * cw);
  // column-major, as every 2 × 2 here: out = c + S·(q − c)
  return [S11, S21, S12, S22];
}
