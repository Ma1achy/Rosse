/**
 * The scene description of a merger (ADR 0003, 0009), shared by both engines: what render() builds
 * round `simulateMerger` (app23.js:L1231–1266).
 *
 * - the **simulation**: `describeMerger` (src/sim/merger.ts): the core track in f64 and the stars'
 *   frames, then the test stars (GPU or CPU kernels);
 * - **each merging galaxy** described as a single galaxy would be (`mergerGalaxyParams`: face-on,
 *   its own seed and variation) and built as one (`buildScene`), carried by its tides;
 * - the **debris**: the test stars as marks (compute/merger-sprites.wgsl), thinned;
 * - **`mWarp`**: one whole spiral drawing per galaxy, torn through the tidal map itself;
 * - the **framing** of a moment: the snapshots `mTime` selects, the frame holding the pair, the scale
 *   `MS.sc`, and each galaxy's camera (`s0 = MS.sc · rmax / 4.2`, R2 = 2 · 4.2 · s0).
 *
 * - the **sky host**: the main parameters' own sky, trails, arrow, jet, streams and overlay star or
 *   artefact (L1234, L1281), described once and placed by the real camera, never by a galaxy's.
 *
 * The lens and shells of the merged scene (L1265–1266) are the other milestones'.
 */
import type { Params } from '../core/params';
import { Draws } from '../core/rng';
import { Stream } from '../core/streams';
import { MVIEW_LAYOUT, KEEP } from '../fallback/kernels/merger-sprites';
import { DRAWING_WORDS } from '../marks/vector';
import { PLATE, UNIT_SCALE, cameraOf, rotationOf, viewDesc, type Camera } from '../view/camera';
import {
  blendCores,
  describeMerger,
  frameFromRadii,
  framingAt,
  mergerGalaxyParams,
  snapSelect,
  typeOf,
  type MergerDesc,
  type MergerFrame,
  type MergerPicks,
  type SnapSelect,
} from '../sim/merger';
import { buildScene, type GalaxyScene, type SceneOptions } from './scene';
import { NO_PICKS } from './parts';
import { packedLibrary } from './vectors';
import { WarpKind, VINST_LAYOUT, VINST_WORDS, type VectorDesc, type VectorView } from './vectors';
import { KNOT_POOL } from './galaxy';
import { handArrays } from './hand';
import type { ShellSceneOptions } from './shells';
import { makeVariation, penWeights, type DrawingsMeta, type Variation } from './variation';

const f = Math.fround;

/** v21's `P.mFit || 0.74`: the fraction of the plate the frame fills (app23.js:L515). */
export const MERGER_FIT = 0.74;

export interface MergerSceneOptions {
  /** the galaxy-level draws (spin, pitch, `mergerGalaxyParams`): the engine's own, or v21's (replayed) */
  picks?: MergerPicks;
  /** the whole picture's variation (the debris's hand and knot pool, spike): v21's, replayed */
  variation?: Variation;
  /** each galaxy's own scene options: variation, curve and part picks, noise, placement key */
  galaxy?: [SceneOptions, SceneOptions];
  /** `mWarp`'s whole drawings, by index into the `whole` sheet (v21's replayed picks) */
  mwarp?: [number, number];
  /**
   * Re-key the placement: the test stars' draws and the two galaxies' stipple, keeping every
   * structural choice (the calibration of ADR 0015). The seed by default.
   */
  placementKey?: number;
  /** calibration only (negative controls, ADR 0015): every dot's quad scaled by this */
  dotScale?: number;
  /** the simulated shells of `P.shellsOn`, drawn over the merged scene (app23.js:L1266) */
  shells?: ShellSceneOptions;
  /**
   * The lens host's scene options (`P.lensOn`, M9): the options of the unmerged parameters, which
   * give the lens its pool, noise and own picks (v21's, replayed, in the goldens).
   */
  lens?: SceneOptions;
  /** The sky host's scene options (sky catalogue, star picks, overlay home: v21's, replayed). */
  sky?: SceneOptions;
}

/** `mWarp`: the two whole drawings the tides tear (app23.js:L1260–1264). */
export interface MWarpDesc {
  drawings: [number, number];
  /** mirrored: the drawing winds S-wise (`AT.whole.winding[wi] === 'S'`) */
  flip: [boolean, boolean];
}

export interface MergerScene {
  P: Params;
  meta: DrawingsMeta;
  desc: MergerDesc;
  /** the whole picture's variation: the debris's hand */
  variation: Variation;
  /** the knot pool (24) then the dot pool, and each dot tile's size at k = 1 */
  pool: Uint32Array<ArrayBuffer>;
  dotBase: Float32Array<ArrayBuffer>;
  /** the two merging galaxies' parameters and scenes (built face-on, carried by their tides) */
  galaxyParams: [Params, Params];
  galaxies: [GalaxyScene, GalaxyScene];
  /**
   * A merging pair can lens a galaxy behind it (app23.js:L1724, M9): the unmerged parameters as a
   * scene whose lens is drawn over the merger. Only its lens is used; the plate's camera places it.
   */
  lensHost?: GalaxyScene;
  /**
   * The main parameters' own sky and overlays (v21's render() merger branch calls `parts` with the
   * main P): a scene without a galaxy, placed by the real camera. Only its sky, vector rows and
   * overlay stars are used. Absent when the picture asks for none of them.
   */
  skyHost?: GalaxyScene;
  mwarp: MWarpDesc | null;
  hot: [boolean, boolean];
}

/** The `whole` drawings `mWarp` may pick: spirals, barred and flocculent (app23.js:L1261). */
export function mwarpPool(types: readonly string[]): number[] {
  const out: number[] = [];
  types.forEach((t, i) => {
    if (t === 'galaxy:spiral' || t === 'galaxy:barred-spiral' || t === 'galaxy:flocculent')
      out.push(i);
  });
  return out;
}

/** Whether the main parameters draw anything of their own over a merger: a sky, a part or an overlay. */
export function needsSkyHost(P: Params): boolean {
  return (
    P.field > 0.02 ||
    P.fgstars > 0.02 ||
    P.trails > 0.02 ||
    P.arrow > 0.02 ||
    P.jet > 0.5 ||
    P.streams > 0.02 ||
    P.ovStar > 0.02 ||
    (!!P.ovArtefact && P.ovArtefact !== 'none')
  );
}

export function buildMergerScene(
  P: Params,
  meta: DrawingsMeta,
  opts: MergerSceneOptions = {},
): MergerScene {
  const desc = describeMerger(P, opts.picks, opts.placementKey);
  const variation = opts.variation ?? makeVariation(P, meta);
  const galaxyParams = [0, 1].map((g) => ({
    ...P,
    ...mergerGalaxyParams(P, g as 0 | 1, opts.picks),
    // the overlay star and artefact are the whole picture's (the sky host's, on the real camera),
    // not each face-on galaxy's, which v21's galaxies are never asked for (L1281)
    ovStar: 0,
    ovArtefact: 'none',
  })) as [Params, Params];
  const galaxies = [0, 1].map((g) =>
    buildScene(galaxyParams[g] as Params, meta, {
      ...(opts.dotScale !== undefined ? { dotScale: opts.dotScale } : {}),
      ...(opts.placementKey !== undefined
        ? { placementKey: (opts.placementKey + g * 7919) >>> 0 }
        : {}),
      ...opts.galaxy?.[g],
      tide: g as 0 | 1,
    }),
  ) as [GalaxyScene, GalaxyScene];

  const { pool, dotBase } = handArrays(P, variation, meta);
  if (opts.dotScale !== undefined)
    for (let i = 0; i < dotBase.length; i++)
      dotBase[i] = Math.fround((dotBase[i] as number) * (opts.dotScale ?? 1));

  let mwarp: MWarpDesc | null = null;
  if (P.mWarp) {
    const whole = meta.vectors?.whole;
    const wpool = mwarpPool(whole?.type ?? []);
    if (wpool.length) {
      const pick = (g: number) => {
        const u = new Draws(P.seed >>> 0, Stream.parts, 2000 + g).f32();
        return wpool[Math.floor(u * wpool.length)] as number;
      };
      const drawings: [number, number] = opts.mwarp ?? [pick(0), pick(1)];
      mwarp = {
        drawings,
        flip: [whole?.winding?.[drawings[0]] === 'S', whole?.winding?.[drawings[1]] === 'S'],
      };
    }
  }
  const lensHost =
    P.lensOn && P.subject === 'galaxy'
      ? buildScene({ ...P, merger: 0 }, meta, {
          ...opts.lens,
          ...(opts.placementKey !== undefined ? { placementKey: opts.placementKey } : {}),
        })
      : undefined;
  // the sky, trails, arrow and overlays of the main parameters (companions stay empty, L1234)
  const skyHost = needsSkyHost(P)
    ? buildScene({ ...P, companions: 0 }, meta, {
        ...opts.sky,
        ...(opts.placementKey !== undefined ? { placementKey: opts.placementKey } : {}),
        skyHost: true,
      })
    : undefined;
  return {
    P,
    meta,
    desc,
    variation,
    pool,
    dotBase,
    galaxyParams,
    galaxies,
    ...(lensHost ? { lensHost } : {}),
    ...(skyHost ? { skyHost } : {}),
    mwarp,
    hot: [typeOf(P.mType1) === 'elliptical', typeOf(P.mType2) === 'elliptical'],
  };
}

/** One merging galaxy's camera and tides at a moment. */
export interface GalaxyFraming {
  /** v21's `VIEW.scale` for this galaxy, `s0 = MS.sc · rmax / 4.2` */
  s0: number;
  /** the camera's zoom giving that scale (`s0 / 84`) */
  zoom: number;
  /** the plate px the tidal grid spans, `R2 = 2 · 4.2 · s0` */
  r2: number;
  camera: Camera;
}

/** Everything a moment fixes: the snapshots, the frame, the scale and each galaxy's camera. */
export interface MergerFraming {
  sel: SnapSelect;
  frame: MergerFrame;
  /** the cores' positions, blended (f64) */
  cores: [[number, number, number], [number, number, number]];
  /** plate px per galaxy unit (`MS.sc`) and the frame's centre in the view frame */
  sc: number;
  fcx: number;
  fcy: number;
  /** `MS.scale`, `sc · 0.3`: the dots of mWarp's drawings */
  scale: number;
  galaxies: [GalaxyFraming, GalaxyFraming];
}

/**
 * The framing at `mTime` for the main camera and zoom, from the star-dependent frames (`frameOf`
 * at the chosen moment and at the horizon's end, from the stars' distances).
 */
export function mergerFraming(
  scene: MergerScene,
  zoom: number,
  frames: { chosen: MergerFrame; end: MergerFrame },
): MergerFraming {
  const { P, desc } = scene;
  const track = desc.track;
  const sel = snapSelect(track, P.mTime);
  const frame = framingAt(track, P.mTime, frames.chosen, frames.end);
  const cores = blendCores(track, sel);
  const cam = cameraOf(P, zoom);
  const R = rotationOf(cam);
  // view(x, y, z) of the frame's centre (app23.js:L500, L514)
  const [x, y, z] = frame.c;
  const xr = x * R.cz - y * R.sz;
  const yr = x * R.sz + y * R.cz;
  const yy = yr * R.ci - z * R.si;
  const fcx = xr * R.cp - yy * R.sp;
  const fcy = xr * R.sp + yy * R.cp;
  const sc = ((MERGER_FIT * PLATE) / Math.max(2 * frame.r, 1e-3)) * ((UNIT_SCALE * zoom) / 84);
  const galaxies = [0, 1].map((g): GalaxyFraming => {
    const rmax = desc.gals[g]?.rmax ?? 1.7;
    const s0 = (sc * rmax) / 4.2;
    const gz = s0 / UNIT_SCALE;
    return {
      s0,
      zoom: gz,
      r2: 2 * 4.2 * s0,
      camera: cameraOf(scene.galaxyParams[g] as Params, gz),
    };
  }) as [GalaxyFraming, GalaxyFraming];
  return { sel, frame, cores, sc, fcx, fcy, scale: sc * 0.3, galaxies };
}

/** The values of the `MView` uniform of compute/merger-sprites.wgsl. */
export function mergerViewUniform(
  scene: MergerScene,
  fr: MergerFraming,
  zoom: number,
): Record<string, number | number[]> {
  const { P, desc } = scene;
  const cam = cameraOf(P, zoom);
  const v = viewDesc(cam, 0, desc.total, 0);
  const core = (g: number) => [...fr.cores[g as 0 | 1].map(f), f(desc.gals[g]?.rmax ?? 1.7)];
  return {
    c0: core(0),
    c1: core(1),
    cos_i: v.cos_i as number,
    sin_i: v.sin_i as number,
    cos_az: v.cos_az as number,
    sin_az: v.sin_az as number,
    cos_pa: v.cos_pa as number,
    sin_pa: v.sin_pa as number,
    sc: f(fr.sc),
    fcx: f(fr.fcx),
    fcy: f(fr.fcy),
    vcx: PLATE / 2,
    vcy: PLATE / 2,
    star_mix: f(P.starMix),
    knots: f(P.knots),
    sparkle: f(P.sparkle),
    pen_dot: f(penWeights(P.pen).dot),
    spike: f(scene.variation.spike),
    keep_dots: f(KEEP.dots),
    keep_knots: f(KEEP.knots),
    keep_rstars: f(KEEP.rstars),
    n: desc.total,
    n0: desc.n[0],
    key: desc.key,
    n_dot_pool: scene.variation.dotPool.length,
    n_knot_pool: KNOT_POOL,
    n_star_tiles: scene.meta.stars.count,
    hot0: scene.hot[0] ? 1 : 0,
    hot1: scene.hot[1] ? 1 : 0,
  };
}

/** The `MView` uniform, packed. */
export function packMergerView(u: Record<string, number | number[]>): ArrayBuffer {
  const buf = new ArrayBuffer(MVIEW_LAYOUT.size);
  const fl = new Float32Array(buf);
  const w = new Uint32Array(buf);
  for (const fd of MVIEW_LAYOUT.fields) {
    const x = u[fd.name];
    if (x === undefined) throw new Error(`MView.${fd.name} missing`);
    const o = fd.offset / 4;
    if (Array.isArray(x)) fl.set(x, o);
    else if (fd.type === 'u32') w[o] = x;
    else fl[o] = x;
  }
  return buf;
}

/**
 * `mWarp`'s two whole drawings as placed vector drawings (app23.js:L1260–1264): a drawing each, at
 * the identity matrix, torn through the tidal map itself, pen scale 0.9 and 0.75.
 */
export function mwarpDesc(scene: MergerScene): VectorDesc | null {
  const mw = scene.mwarp;
  if (!mw) return null;
  const lib = packedLibrary(scene.meta.vectors);
  const first = lib.first.whole;
  const drawings = mw.drawings.map((wi) => first + wi);
  const caps: number[] = [];
  const dots: number[] = [];
  const blobs: number[] = [];
  let nCap = 0;
  let nDot = 0;
  let nBlob = 0;
  for (const d of drawings) {
    const o = d * DRAWING_WORDS;
    caps.push(nCap);
    dots.push(nDot);
    blobs.push(nBlob);
    // every warped drawing is densified (L1202): the densified piece count
    nCap += lib.table[o + 7] ?? 0;
    nDot += lib.table[o + 3] ?? 0;
    nBlob += lib.table[o + 5] ?? 0;
  }
  const pen = penWeights(scene.P.pen);
  return {
    lib,
    parts: { picks: NO_PICKS, wholeType: null, streams: [] },
    drawings,
    warps: drawings.map(() => WarpKind.tideScreen),
    capFirst: caps,
    dotFirst: dots,
    blobFirst: blobs,
    nInst: drawings.length,
    nCapSlots: nCap,
    nDots: nDot,
    nBlobs: nBlob,
    penLine: pen.line,
    penDot: pen.dot,
    streamKeep: 0,
  };
}

/** The view of `mWarp`'s drawings: their instance rows and the uniform (no streams). */
export function mwarpView(scene: MergerScene, D: VectorDesc, fr: MergerFraming): VectorView {
  const mw = scene.mwarp;
  if (!mw) throw new Error('no mWarp');
  const inst = new ArrayBuffer(Math.max(1, D.nInst) * VINST_LAYOUT.size);
  const fl = new Float32Array(inst);
  const u = new Uint32Array(inst);
  const ps = [0.9, 0.75];
  for (let i = 0; i < D.nInst; i++) {
    const o = i * VINST_WORDS;
    fl.set([1, 0, 0, 1], o);
    fl[o + 6] = f(ps[i] ?? 1);
    // the dots' and blobs' scale is the tidal map's (`WF.scale`, L1196)
    fl[o + 7] = f(fr.scale);
    fl[o + 8] = i;
    fl[o + 9] = mw.flip[i as 0 | 1] ? 1 : 0;
    u[o + 16] = D.drawings[i] ?? 0;
    u[o + 17] = D.warps[i] ?? 0;
    u[o + 18] = D.capFirst[i] ?? 0;
    u[o + 19] = D.dotFirst[i] ?? 0;
    u[o + 20] = D.blobFirst[i] ?? 0;
  }
  return {
    rows: [],
    inst,
    nStreamSegs: 0,
    nStreamSlots: 0,
    streamSegs: new ArrayBuffer(32),
    uniform: {
      n_inst: D.nInst,
      n_cap_slots: D.nCapSlots,
      n_dots: D.nDots,
      n_blobs: D.nBlobs,
      n_stream_segs: 0,
      n_stream_slots: 0,
      key: scene.P.seed >>> 0,
      n_dot_pool: scene.variation.dotPool.length,
      pen_line: f(D.penLine),
      wobble: 0,
      stream_keep: 0,
      pen_dot: f(D.penDot),
    },
  };
}

/** `frameOf` from the star distances read back at the chosen moment and at the horizon's end. */
export function framesFromRadii(
  scene: MergerScene,
  chosen: ArrayLike<number>,
  end: ArrayLike<number>,
): { chosen: MergerFrame; end: MergerFrame } {
  const { track } = scene.desc;
  return {
    chosen: frameFromRadii(track.C, track.M, chosen),
    end: frameFromRadii(track.Cend, track.M, end),
  };
}
