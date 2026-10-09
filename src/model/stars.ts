/**
 * A star or an artefact drawn as fully as a galaxy (the reference's `starSprites`, app23.js:L398–439),
 * and the overlays that lay a bright foreground star and an artefact over any subject
 * (`overlaySprites`, L453–465). Two halves, by tier (ADR 0010):
 *
 * - **Model tier, `describeStars`**: every discrete choice of `starSprites`, as data (`StarPicks`):
 *   which stars (a bright one at the centre, a few fainter ones nearby, or one placed by the
 *   artefact), where, their brightness and spike angle, which of the star drawings sits at each
 *   core, a trail's angle, offset and second line, a ghost's angle and radii, a cosmic ray's hits.
 *   v21 draws them from one sequential stream (`mulberry32(P.seed · 911 + 17)`) interleaved with
 *   every mark; here each choice has its own index on the `stars` stream (ADR 0004). The golden
 *   runner passes v21's own (`SceneOptions.starPicks`, replayed from v21's `starSprites` by
 *   tests/golden/compare/v21-stars.ts, ADR 0031).
 * - **View tier, `starJobs`**: the jobs of one view, a few dozen records: a job is a run of
 *   consecutive mark slots of one kind (the heart's knots, the glare, one spike, one ring, the
 *   bleed column, a trail's line, the ghost, one cosmic ray, a drawn star) with the numbers it
 *   needs at this zoom (the star's centre, `U` = pixels per galaxy unit). The marks themselves,
 *   thousands of them, are made one per slot on the GPU by compute/star-marks.wgsl (CPU twin
 *   src/fallback/kernels/star-marks.ts): each on its own counter of the `stars` stream, so a zoom
 *   that adds marks keeps the ones it had (ADR 0004).
 *
 * Overlays are placed in the scene with an **explicit home orientation** (open question Q3,
 * option b): v21 remembers the camera at which an overlay was first placed (`homeFor`), so the same
 * parameters render differently depending on navigation history; here the home is a parameter
 * (`SceneOptions.home`, by default the camera itself, which pins the overlay to the plate) and the
 * camera moves round the overlay. Deliberate divergence 2 (docs/architecture.md, ADR 0008, 0030).
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import type { StructLayout } from '../marks/instance';
import {
  PLATE,
  UNIT_SCALE,
  ZOOM_MAX,
  rotationOf,
  sceneGalaxyPoint,
  scenePoint,
  viewScale,
  type Camera,
  type Orientation,
} from '../view/camera';
import { dustTau } from '../fallback/kernels/project';
import { starPools } from './galaxy';
import type { DrawingsMeta, Variation } from './variation';

const f = Math.fround;

/** The kinds of job (the `kind` of a `StarJob`). */
export const StarKind = {
  /** the saturated heart: knots round the core */
  heart: 0,
  /** the glare, a power-law fall-off of dots */
  glare: 1,
  /** one of the four diffraction spikes */
  spike: 2,
  /** one faint ring in the glare */
  ring: 3,
  /** the saturation bleed column */
  bleed: 4,
  /** one drawn star at the core (a vector `sstars` drawing) */
  drawn: 5,
  /** one line of a satellite trail */
  trail: 6,
  /** the ghost's disc */
  ghostDisc: 7,
  /** the ghost's edge */
  ghostRing: 8,
  /** one cosmic-ray hit */
  cosmic: 9,
} as const;

/** One call of v21's `aStar(x, y, B, full)` and what it draws from the stream. */
export interface StarPick {
  /** its centre, in galaxy units from the plate's centre (the plate x and y, over `U`) */
  ux: number;
  uy: number;
  /** brightness, 0–1 */
  B: number;
  /** with spikes, rings and the bleed column, and the full glare */
  full: boolean;
  /** the spike direction, `r() · 0.4 − 0.2 + VAR.spike` */
  spikeA: number;
  /** the `sstars` drawing at its core */
  tile: number;
}

/** A cosmic-ray hit. */
export interface CosmicPick {
  ux: number;
  uy: number;
  /** its direction, and its length (3 + 30 u², px) */
  ha: number;
  hl: number;
  /** a knot at its head (probability 0.15) */
  knot: boolean;
}

/** The choices of one `starSprites` call. */
export interface StarCtxPicks {
  stars: StarPick[];
  /** a satellite trail: its angle, its offset from the centre (units), a second line, its gap (px) */
  trail?: { ta: number; off: number; dbl: boolean; sep: number };
  /** a ghost: where its star sits (the angle, at 1.1 units), and its radii, over `U` */
  ghost?: { sa: number; k1: number; k0: number };
  cosmic?: CosmicPick[];
}

/** Every context of a scene: the subject (a star or an artefact), and the two overlays. */
export interface StarPicks {
  subject?: StarCtxPicks;
  ovStar?: StarCtxPicks;
  ovArt?: StarCtxPicks;
  /** the overlay ghost's star: its angle in the scene, at 1.1 units and depth 1.4 (`ga0`, L462) */
  ovGhostAngle?: number;
}

/** Context ids: the high bits of a mark's stream index. */
export const StarCtx = { subject: 0, ovStar: 1, ovArt: 2 } as const;

/** What a context draws: the parameters v21 gives `starSprites` through `P`. */
export interface StarCtxDesc {
  id: number;
  /** drawn as an overlay (`P._ov`): no faint stars, no extra star with an artefact */
  overlay: boolean;
  /** `star` or `artefact` */
  subject: 'star' | 'artefact';
  artefact: 'trail' | 'ghost' | 'cosmic';
  picks: StarCtxPicks;
  /** the overlay star is placed in the scene at this offset (units) and depth */
  place?: { x: number; y: number; depth: number };
}

export interface StarsDesc {
  ctxs: StarCtxDesc[];
  /** the drawn stars these contexts add (their capacity in the drawn stars' rows) */
  nDrawn: number;
}

/** The `sstars` drawings a core takes: the bright ones (outline, burst) when there are any. */
export function corePool(meta: DrawingsMeta): number[] {
  const p = starPools(meta, true);
  const pool = p.bright.length ? p.bright : p.small;
  return pool.map((t) => t & 0x7fffffff);
}

const TAU = 2 * Math.PI;

/**
 * A satellite star's depth from the primary's, in units: a deterministic function of its
 * brightness pick (0.06 to 0.26 maps to -0.8 to 0.8), so that a cluster is a constellation and
 * not a flat disc, with no new draw (the picks, and v21's replayed ones, stay as they are).
 */
export const satelliteDepth = (s: StarPick): number => f(f(s.B - f(0.16)) * f(8));

/** Stream indices of the descriptors: above the marks' (bit 31), one range per context. */
const descIndex = (ctx: number, k: number) => (0x80000000 | (ctx << 16) | k) >>> 0;

/** `aStar`'s own draws of the engine: the spike direction and the core's drawing. */
function ownStar(
  r: Draws,
  V: Variation,
  pool: readonly number[],
  ux: number,
  uy: number,
  B: number,
  full: boolean,
): StarPick {
  const spikeA = f(f(f(r.f32() * f(0.4)) - f(0.2)) + f(V.spike || 0));
  const tile = pool.length ? (pool[Math.floor(r.f32() * pool.length)] ?? 0) : 0;
  return { ux, uy, B, full, spikeA, tile };
}

/** One context's choices, on the engine's counter streams (v21's rules, L419–437). */
export function ownCtxPicks(
  V: Variation,
  meta: DrawingsMeta,
  ctx: number,
  subject: 'star' | 'artefact',
  artefact: 'trail' | 'ghost' | 'cosmic',
  overlay: boolean,
  starBright: number,
  key: number,
  /** `cosmicAuto` (ADR 0078): fewer cosmic rays, spread over the whole plate */
  spread = false,
): StarCtxPicks {
  const pool = corePool(meta);
  const at = (k: number) => new Draws(key, Stream.stars, descIndex(ctx, k));
  const out: StarCtxPicks = { stars: [] };
  if (subject === 'star') {
    out.stars.push(ownStar(at(0), V, pool, 0, 0, starBright, true));
    // v21 parity: the bound of the loop is drawn afresh at every test (`f < 3 + Math.floor(r()
    // * 5)`, app23.js:L420), so 3 stars are certain and each test stops with probability
    // 1/5, 2/5 … 1 (3 with 0.2, 4 with 0.32, 5 with 0.288, 6 with 0.154, 7 with 0.038). v21
    // draws no satellites for an overlay star (`P._ov ? 0 : …`); here it has them too (ADR 0055)
    const r = at(1);
    for (let i = 0; i < 3 + Math.floor(r.f32() * 5); i++) {
      const q = at(10 + i);
      const fa = f(q.f32() * f(TAU));
      const fd = f(f(1.6) + f(f(2.2) * q.f32()));
      const B = f(f(0.06) + f(f(0.2) * q.f32()));
      out.stars.push(ownStar(q, V, pool, f(Math.cos(fa) * fd), f(Math.sin(fa) * fd), B, false));
    }
    return out;
  }
  if (artefact === 'trail') {
    const r = at(2);
    const ta = f(r.f32() * f(Math.PI));
    const off = f(f(r.f32() - f(0.5)) * f(0.8));
    const dbl = r.f32() < f(0.4);
    const sep = f(f(7) + f(f(5) * r.f32()));
    out.trail = { ta, off, dbl, sep };
    if (!overlay) {
      const q = at(3);
      const ux = f(f(q.f32() - f(0.5)) * f(1.6));
      const uy = f(f(q.f32() - f(0.5)) * f(1.6));
      out.stars.push(ownStar(q, V, pool, ux, uy, f(f(0.25) + f(f(0.25) * q.f32())), true));
    }
  } else if (artefact === 'ghost') {
    const r = at(4);
    const sa = f(r.f32() * f(TAU));
    const k1 = f(f(0.55) + f(f(0.25) * r.f32()));
    const k0 = f(f(0.45) + f(f(0.15) * r.f32()));
    out.ghost = { sa, k1, k0 };
    // the star of the ghost, 1.1 units out (in the scene as an overlay: placed by the view)
    out.stars.push(
      ownStar(r, V, pool, f(Math.cos(sa) * f(1.1)), f(Math.sin(sa) * f(1.1)), f(0.85), true),
    );
  } else {
    // v21 parity: the loop's bound is drawn afresh at every test too (`c < 70 + Math.floor(r() *
    // 60)`, L433): 70 hits are certain, then a test stops with probability 1/60, 2/60 …
    const r = at(5);
    const hits: CosmicPick[] = [];
    // ADR 0078: 40 to 70 hits, anywhere on the plate (v21: 70 to 130 in a box of 5.2 units round
    // the star, so they read as part of it)
    const nSpread = 40 + Math.floor(r.f32() * 31);
    const reach = f(f(PLATE) / f(UNIT_SCALE));
    for (let c = 0; spread ? c < nSpread : c < 70 + Math.floor(r.f32() * 60); c++) {
      const q = at(1000 + c);
      const ux = f(f(q.f32() - f(0.5)) * (spread ? reach : f(5.2)));
      const uy = f(f(q.f32() - f(0.5)) * (spread ? reach : f(5.2)));
      const ha = f(q.f32() * f(TAU));
      const u = q.f32();
      const hl = f(f(3) + f(f(u * u) * f(30)));
      hits.push({ ux, uy, ha, hl, knot: q.f32() < f(0.15) });
    }
    out.cosmic = hits;
    if (!overlay) {
      const q = at(6);
      const ux = f(f(q.f32() - f(0.5)));
      const uy = f(f(q.f32() - f(0.5)));
      out.stars.push(ownStar(q, V, pool, ux, uy, f(0.3), true));
    }
  }
  return out;
}

/** What the parameters draw as star contexts (`render` and `overlaySprites`, L1229, L453–465). */
export function wantsStars(P: Params): boolean {
  return (
    P.subject === 'star' ||
    P.subject === 'artefact' ||
    P.ovStar > 0.02 ||
    (!!P.ovArtefact && P.ovArtefact !== 'none')
  );
}

/** The model tier's stars: the engine's picks, or the ones given (v21's, for the golden runner). */
export function describeStars(
  P: Params,
  V: Variation,
  meta: DrawingsMeta,
  given?: StarPicks,
  key: number = P.seed,
): StarsDesc | null {
  if (!wantsStars(P)) return null;
  const ctxs: StarCtxDesc[] = [];
  const art = (P.artefact || 'trail') as 'trail' | 'ghost' | 'cosmic';
  if (P.subject === 'star' || P.subject === 'artefact') {
    const subject = P.subject;
    ctxs.push({
      id: StarCtx.subject,
      overlay: false,
      subject,
      artefact: art,
      picks:
        given?.subject ??
        ownCtxPicks(
          V,
          meta,
          StarCtx.subject,
          subject,
          art,
          false,
          P.starBright,
          key,
          P.cosmicAuto > 0,
        ),
    });
  }
  if (P.ovStar > 0.02) {
    const a = (P.ovStarA * Math.PI) / 180;
    ctxs.push({
      id: StarCtx.ovStar,
      overlay: true,
      subject: 'star',
      artefact: art,
      picks:
        given?.ovStar ??
        ownCtxPicks(V, meta, StarCtx.ovStar, 'star', art, true, P.ovStar, key, P.cosmicAuto > 0),
      place: { x: P.ovStarD * Math.cos(a), y: P.ovStarD * Math.sin(a), depth: 1.4 },
    });
  }
  if (P.ovArtefact && P.ovArtefact !== 'none') {
    const oa = P.ovArtefact as 'trail' | 'ghost' | 'cosmic';
    const ga =
      given?.ovGhostAngle ?? new Draws(key, Stream.stars, descIndex(StarCtx.ovArt, 7)).f32() * TAU;
    const picks =
      given?.ovArt ??
      ownCtxPicks(V, meta, StarCtx.ovArt, 'artefact', oa, true, 0.8, key, P.cosmicAuto > 0);
    ctxs.push({
      id: StarCtx.ovArt,
      overlay: true,
      subject: 'artefact',
      artefact: oa,
      picks,
      // the ghost's star in the scene, at 1.1 units and depth 1.4 (L462)
      ...(oa === 'ghost'
        ? { place: { x: Math.cos(ga) * 1.1, y: Math.sin(ga) * 1.1, depth: 1.4 } }
        : {}),
    });
  }
  let nDrawn = 0;
  for (const c of ctxs) nDrawn += c.picks.stars.length;
  return { ctxs, nDrawn };
}

// ---------------------------------------------------------------------------------------------
// The view tier: jobs

/** One run of mark slots: the `StarJob` struct of compute/star-marks.wgsl (64 bytes). */
export const STAR_JOB_LAYOUT: StructLayout = (() => {
  const fields: [string, 'u32' | 'f32' | 'vec2<f32>'][] = [
    ['c', 'vec2<f32>'],
    ['a', 'f32'],
    ['b', 'f32'],
    ['p0', 'f32'],
    ['p1', 'f32'],
    ['p2', 'f32'],
    ['p3', 'f32'],
    ['kind', 'u32'],
    ['first', 'u32'],
    ['n', 'u32'],
    ['index', 'u32'],
    ['q', 'u32'],
    ['keep', 'f32'],
    ['pad1', 'u32'],
    ['pad2', 'u32'],
  ];
  let off = 0;
  const out = fields.map(([name, type]) => {
    const size = type === 'vec2<f32>' ? 8 : 4;
    const e = { name, type, offset: off, size };
    off += size;
    return e;
  });
  return { name: 'StarJob', size: off, align: 8, fields: out };
})();
export const STAR_JOB_WORDS = STAR_JOB_LAYOUT.size / 4;

/** The `StarU` uniform of compute/star-marks.wgsl. */
export const STAR_UNIFORM_LAYOUT: StructLayout = {
  name: 'StarU',
  size: 48,
  align: 4,
  fields: [
    'n_jobs',
    'n_slots',
    'key',
    'n_dot_pool',
    'pen_dot',
    'wobble',
    'out_base',
    'pad0',
    'pad1',
    'pad2',
    'pad3',
    'pad4',
  ].map((name, i) => ({
    name,
    type: i < 4 || i === 6 || i > 6 ? ('u32' as const) : ('f32' as const),
    offset: i * 4,
    size: 4,
  })),
};

/** A job, as numbers. */
export interface StarJob {
  c: [number, number];
  a: number;
  b: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  kind: number;
  first: number;
  n: number;
  index: number;
  q: number;
  /**
   * The share of the star's marks the dust in front of it lets through, exp(−tau) (ADR 0074): each
   * mark survives when its draw is below it, so the whole star thins evenly. 1 for what no dust
   * dims (the subject star, a merger's overlay, an artefact's lines, a cosmic ray, the ghost).
   */
  keep: number;
}

const round = (x: number) => Math.floor(x + 0.5);

/** A job before its slots and stream index are assigned. */
type JobIn = Omit<StarJob, 'first' | 'index' | 'n'>;
/** A job of a star: `starJobsOf` gives it the star's keep. */
type JobOf = Omit<JobIn, 'keep'>;

/** The numbers of an `aStar` (L405–418), at this zoom, as jobs. */
function starJobsOf(
  P: Params,
  s: StarPick,
  cx: number,
  cy: number,
  U: number,
  keep: number,
  push: (j: JobIn, n: number) => void,
): void {
  const B = s.B;
  // the star's light that reaches the camera sets its reach (ADR 0074): dust in front dims it, so
  // the core, the glare, the spikes and the bleed column are drawn shorter, by sqrt(keep). The
  // marks of each job keep their counts (so the slots and buffers do not move) and are thinned by
  // `keep` as well. 1 for a star with nothing in front of it, so v21's picture is unchanged.
  const r = f(Math.sqrt(keep));
  const Ur = f(U * r);
  const core = f(f(f(0.1) + f(f(0.2) * B)) * Ur);
  const c: [number, number] = [f(cx), f(cy)];
  const job = (kind: number, n: number, extra: Partial<JobOf>) => {
    push({ c, a: core, b: 0, p0: 0, p1: 0, p2: 0, p3: 0, kind, q: 0, keep: f(keep), ...extra }, n);
  };
  job(StarKind.heart, round(20 + 90 * B), {});
  job(StarKind.glare, round((1500 + 7500 * B) * (s.full ? 1 : 0.22)), {
    b: f(Ur * f(1.3 + 2.3 * B)),
  });
  if (s.full && P.spikes > 0.02) {
    const L0 = f(U * f(0.9 + 3.4 * P.spikes * B));
    const L = f(L0 * r);
    for (let q = 0; q < 4; q++)
      job(StarKind.spike, round(L0 / 0.8), {
        b: L,
        q,
        p0: f(s.spikeA + (q * Math.PI) / 2 + (q % 2 ? 0 : 0.004)),
      });
  }
  if (s.full && P.starRings > 0.02) {
    const nr = 1 + round(2 * P.starRings);
    for (let ri = 1; ri <= nr; ri++)
      job(StarKind.ring, round(260 * P.starRings * ri), {
        q: ri,
        b: f(f(core * f(2.6 + 2.2 * ri)) * f(0.8 + 0.5 * B)),
      });
  }
  if (s.full && P.bleed > 0.02 && B > 0.45) {
    const bl0 = f(U * f(2.6 * P.bleed * B));
    job(StarKind.bleed, round(bl0 * 1.4), { a: f(bl0 * r) });
  }
  job(StarKind.drawn, 1, {
    a: f(core * f(2.6 + 2.4 * B)),
    p0: f(s.spikeA),
    p1: f(0.7 + 0.4 * B),
    q: s.tile,
  });
}

/**
 * The jobs of a view (src/model/stars.ts header): the stars' centres and the artefacts' lines at
 * zoom `cam.zoom`, the overlays in the scene seen from `home`. Slots run on from `firstSlot`.
 */
export function starJobs(
  D: StarsDesc,
  P: Params,
  cam: Camera,
  home: Orientation,
  /** the galaxy's dust (`GalaxyDesc.dust`): 0 where there is no galaxy to dim the overlay star */
  dust = 0,
): { jobs: StarJob[]; nSlots: number } {
  const U = f(viewScale(cam.zoom));
  // the zoom-1 scale: an overlay's trail and cosmic rays are fixed to the camera, the screen, and
  // do not grow with the zoom (a deliberate divergence from v21, ADR 0055)
  const U1 = f(viewScale(1));
  const jobs: StarJob[] = [];
  let slot = 0;
  const cx0 = PLATE / 2;
  for (const ctx of D.ctxs) {
    let jobIx = 0;
    const base = (k: number) => ((ctx.id << 25) | (k << 15)) >>> 0;
    const push = (j: JobIn, n: number) => {
      jobs.push({ ...j, n, first: slot, index: base(jobIx++) });
      slot += n;
    };
    const place = ctx.place
      ? scenePoint(home, ctx.place.x, ctx.place.y, ctx.place.depth, cam)
      : null;
    // the dust in front of an overlay star: tau of its place in the galaxy's frame along the line of
    // sight (the galaxy marks' own dustTau), 1 for a star with nothing to dim it (ADR 0074)
    const dims = dust > 0 && ctx.overlay && ctx.subject === 'star';
    const cosI = f(rotationOf(cam).ci);
    const keepAt = (sx: number, sy: number, depth: number) => {
      if (!dims) return 1;
      const g = sceneGalaxyPoint(home, sx, sy, depth);
      return f(Math.exp(-dustTau(g[0], g[1], g[2], cosI, dust)));
    };
    const pk = ctx.picks;
    const UA = ctx.overlay ? U1 : U;
    // the stars: at the plate centre plus their offset, or (an overlay) at the scene point
    pk.stars.forEach((s, i) => {
      let x = cx0 + s.ux * U;
      let y = cx0 + s.uy * U;
      let keep = 1;
      // the overlay star sits at the scene point; an overlay ghost's star too (its offset is the
      // angle on 1.1 units)
      if (place && (ctx.subject === 'star' || ctx.artefact === 'ghost') && i === 0) {
        x = place[0];
        y = place[1];
        keep = keepAt(ctx.place?.x ?? 0, ctx.place?.y ?? 0, ctx.place?.depth ?? 0);
      } else if (ctx.subject === 'star' && i > 0) {
        // a satellite is a point in the scene beside its primary, at a depth near the primary's,
        // so the cluster is a constellation under orbit and zoom (ADR 0055)
        const o = ctx.place ?? { x: 0, y: 0, depth: 0 };
        const depth = o.depth + satelliteDepth(s);
        const p = scenePoint(home, o.x + s.ux, o.y + s.uy, depth, cam);
        x = p[0];
        y = p[1];
        keep = keepAt(o.x + s.ux, o.y + s.uy, depth);
      }
      starJobsOf(P, s, x, y, U, keep, push);
    });
    if (pk.trail) {
      const t = pk.trail;
      const half = f(UA * f(3.2));
      const off = f(t.off * UA);
      const tx = f(cx0 - f(Math.sin(t.ta) * off));
      const ty = f(cx0 + f(Math.cos(t.ta) * off));
      [0, t.dbl ? t.sep : null].forEach((sep, li) => {
        if (sep === null) return;
        push(
          {
            c: [tx, ty],
            a: half,
            b: f(sep),
            p0: f(t.ta),
            p1: 0,
            p2: 0,
            p3: 0,
            kind: StarKind.trail,
            q: li,
            keep: 1,
          },
          round(half * 2.2 * (li ? 0.55 : 1)),
        );
      });
    }
    if (pk.ghost) {
      const g = pk.ghost;
      // the star of the ghost: the first of the context's stars (placed in the scene as an overlay)
      const st = pk.stars[0];
      let sx = cx0 + (st?.ux ?? 0) * U;
      let sy = cx0 + (st?.uy ?? 0) * U;
      if (place) {
        sx = place[0];
        sy = place[1];
      }
      const gx = f(cx0 - f(f(sx - cx0) * f(0.32)));
      const gy = f(cx0 - f(f(sy - cx0) * f(0.32)));
      const R1 = f(U * g.k1);
      const R0 = f(R1 * g.k0);
      const g0 = {
        c: [gx, gy] as [number, number],
        a: R0,
        b: R1,
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
        q: 0,
        keep: 1,
      };
      push({ ...g0, kind: StarKind.ghostDisc }, 2600);
      push({ ...g0, kind: StarKind.ghostRing }, 500);
    }
    for (const h of pk.cosmic ?? []) {
      const n = Math.max(2, round(h.hl / 1.5));
      push(
        {
          c: [f(cx0 + h.ux * UA), f(cx0 + h.uy * UA)],
          a: f(h.hl),
          b: f(Math.max(1, h.hl / 1.5)),
          p0: f(h.ha),
          p1: h.knot ? 1 : 0,
          p2: 0,
          p3: 0,
          kind: StarKind.cosmic,
          q: n,
          keep: 1,
        },
        n + 1,
      );
    }
  }
  return { jobs, nSlots: slot };
}

/** The most mark slots a view of these stars can need (at the largest zoom): the buffers' size. */
export function starSlotCapacity(D: StarsDesc, P: Params, home: Orientation): number {
  const cam: Camera = { incl: P.incl, az: P.az || 0, pa: P.pa, winding: P.winding, zoom: ZOOM_MAX };
  return starJobs(D, P, cam, home).nSlots;
}

/** The jobs as the `StarJob` array the kernels read. */
export function packStarJobs(jobs: readonly StarJob[]): ArrayBuffer {
  const buf = new ArrayBuffer(Math.max(1, jobs.length) * STAR_JOB_LAYOUT.size);
  const fl = new Float32Array(buf);
  const u = new Uint32Array(buf);
  jobs.forEach((j, i) => {
    const o = i * STAR_JOB_WORDS;
    fl[o] = f(j.c[0]);
    fl[o + 1] = f(j.c[1]);
    fl[o + 2] = f(j.a);
    fl[o + 3] = f(j.b);
    fl[o + 4] = f(j.p0);
    fl[o + 5] = f(j.p1);
    fl[o + 6] = f(j.p2);
    fl[o + 7] = f(j.p3);
    u[o + 8] = j.kind;
    u[o + 9] = j.first;
    u[o + 10] = j.n;
    u[o + 11] = j.index;
    u[o + 12] = j.q;
    fl[o + 13] = f(j.keep);
  });
  return buf;
}
