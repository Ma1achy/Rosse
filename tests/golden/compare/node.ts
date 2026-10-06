/**
 * The Node half of the golden runner, loaded by ./compare.mjs through Vite's SSR loader (so it can
 * import the engine's TypeScript): reading reference captures, the CPU engine, the metric, the
 * thresholds, reports, and the calibration of ADR 0013 and 0015.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { Params } from '../../../src/core/params';
import { presetFamily, presetParams } from '../../../src/core/presets';
import type { MarkCounts, SceneOptions } from '../../../src/model/scene';
import type { Variation } from '../../../src/model/variation';
import { CpuGolden } from './engine-cpu';
import { v21CurvePicks, v21DustPicks, v21RingKnots } from './v21-curves';
import { v21NoiseTables } from './v21-noise';
import type { NoiseTable } from '../../../src/core/noise';
import type { CurvePicks } from '../../../src/model/curves';
import {
  alphaFromRgba8,
  compareMeasures,
  grey,
  measure,
  momentsOf,
  quantile,
  type Comparison,
  type Grey,
  type ImageMeasures,
} from './metrics';
import { reportHtml } from './report';
import {
  countAllowance,
  evaluate,
  impossibleClasses,
  type Evaluation,
  type ThresholdFile,
  type Thresholds,
} from './thresholds';
import { v21Variation } from './v21';
import { v21PartPicks } from './v21-parts';

export { compareMeasures, countAllowance, evaluate, impossibleClasses, measure };
export type { Comparison, Evaluation, Grey, ImageMeasures, Thresholds };

export interface CaptureRecord {
  name: string;
  preset: string;
  variant?: string;
  seed: number;
  camera: string;
  /** the reference's ZOOM at capture (2 for the zoom camera) */
  zoom?: number;
  stats: { dots: number; knots: number; stars: number; rstars: number };
  params: Params;
  hand?: number[];
}

/**
 * The golden family of a capture (thresholds.json `parity` keys): its preset's, except the
 * line-work-only captures (variant `lines`, M4's review), which have their own (ADR 0018).
 */
export function goldenFamily(preset: string, variant?: string): string {
  if (variant === 'lines') return 'lines';
  const f = presetFamily(preset);
  if (f === 'merger' || f === 'lens' || f === 'star' || f === 'artefact') return f;
  if (preset === 'Layered: lensed merger') return 'merger';
  const smooth = [
    'Smooth, round',
    'Cigar-shaped',
    'Deep field',
    'Radio jet',
    'Stellar streams',
    'Shell galaxy',
  ];
  return smooth.includes(preset) ? 'smooth' : 'spiral';
}

/** v21's statistics and ours, as the classes test (d) compares. */
export function countsOf(s: { dots: number; knots: number; stars: number; rstars: number }) {
  return { dots: s.dots, knots: s.knots, stars: s.stars, rstars: s.rstars };
}

export function engineCounts(c: MarkCounts) {
  return { dots: c.dots, knots: c.knots, stars: c.stars, rstars: c.rstars };
}

export function readPngAlpha(file: string): Grey {
  const p = PNG.sync.read(readFileSync(file));
  return alphaFromRgba8(p.width, p.height, p.data);
}

export function alphaFromBase64(b64: string, width: number, height: number): Grey {
  const bytes = Buffer.from(b64, 'base64');
  const g = grey(width, height);
  for (let i = 0; i < width * height; i++) g.data[i] = (bytes[i] ?? 0) / 255;
  return g;
}

export function alphaHash(a: Grey): string {
  const bytes = new Uint8Array(a.data.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round((a.data[i] ?? 0) * 255);
  return createHash('sha256').update(bytes).digest('hex');
}

export class GoldenNode {
  readonly cpu: CpuGolden;
  readonly thresholds: ThresholdFile;

  constructor(readonly root: string) {
    this.cpu = new CpuGolden(root);
    this.thresholds = JSON.parse(
      readFileSync(join(root, 'tests/golden/thresholds.json'), 'utf8'),
    ) as ThresholdFile;
  }

  record(name: string): CaptureRecord {
    return JSON.parse(
      readFileSync(join(this.root, 'tests/golden/reference', `${name}.json`), 'utf8'),
    ) as CaptureRecord;
  }

  reference(name: string): Grey {
    return readPngAlpha(join(this.root, 'tests/golden/reference', `${name}.ink.png`));
  }

  renderCpu(P: Params, opts: SceneOptions = {}, zoom = 1) {
    return this.cpu.render(P, opts, zoom);
  }

  /**
   * Everything the comparison draws with besides the parameters: v21's variation (ADR 0015), and
   * from M4 (ADR 0018) v21's stroke choices, noise field, dust choices (each hatch's numbers and
   * pen line, the carving lines' pen lines) and ring-knot clusters. With them, every random choice
   * the two engines make differently is v21's, and only the marks differ: the placement key
   * re-draws nothing else. From M5 (ADR 0021) also v21's part picks at this zoom.
   */
  referenceOptions(P: Params, zoom = 1): SceneOptions {
    const variation = this.v21Variation(P);
    const kinds = this.cpu.meta.strokes?.kind ?? [];
    return {
      variation,
      curvePicks: this.v21CurvePicks(P, variation),
      noise: this.v21Noise(P.seed),
      partPicks: v21PartPicks(P, variation, this.cpu.meta, zoom),
      dustPicks: v21DustPicks(this.root, P, variation, kinds, this.cpu.meta.penlines?.n ?? 0),
      ringKnotPicks: v21RingKnots(this.root, P, variation, kinds),
    };
  }

  /** v21's own noise corners for a seed (./v21-noise.ts), as plain arrays (they cross to the page). */
  v21Noise(seed: number): NoiseTable[] {
    return v21NoiseTables(this.root, seed).map((t) => ({ ...t, values: Array.from(t.values) }));
  }

  /** v21's own stroke choices for these parameters and variation (./v21-curves.ts). */
  v21CurvePicks(P: Params, V: Variation): CurvePicks {
    return v21CurvePicks(this.root, P, V, this.cpu.meta.strokes?.kind ?? []);
  }

  /**
   * Whether ring knots or clumps make knots whatever `knots` says (v21's variation decides how
   * many clumps there are): the class is then possible with `knots: 0`.
   */
  groupKnots(P: Params): boolean {
    if (P.ring > 0.1 && !P.merger) return true;
    return (P.arms >= 1 || P.irr > 0) && P.bulge < 0.9 && this.v21Variation(P).clumps.length > 0;
  }

  /** v21's own variation for these parameters, replayed offline (./v21.ts). */
  v21Variation(P: Params): Variation {
    return v21Variation(P, this.cpu.meta);
  }

  /**
   * The thresholds of a preset's family; at a zoomed camera, the family's zoom thresholds when
   * calibrated (`<family>@zoom`): at zoom 2 the plate holds the inner galaxy only, and a re-draw
   * of the same galaxy scatters more (docs/milestones/m4/README.md).
   */
  parity(preset: string, zoom = 1, variant?: string): Thresholds {
    const f = goldenFamily(preset, variant);
    const t =
      (zoom !== 1 ? this.thresholds.parity[`${f}@zoom`] : undefined) ?? this.thresholds.parity[f];
    if (!t) throw new Error(`no parity thresholds for ${preset}`);
    // the family's thresholds, with the preset's own where calibrated (axis ratios)
    const { byPreset, ...family } = t;
    return { ...family, ...(byPreset?.[preset] ?? {}) };
  }

  writeReport(
    name: string,
    ref: { label: string; alpha: Grey; measures: ImageMeasures },
    render: { label: string; alpha: Grey; measures: ImageMeasures },
    c: Comparison,
    e: Evaluation,
    extra: string[] = [],
  ): string {
    const dir = join(this.root, 'tests/golden/diff');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.html`);
    writeFileSync(file, reportHtml(name, ref, render, c, e, extra));
    return file;
  }

  /**
   * Calibration (ADR 0013, 0015, 0018), source (ii): the new engine re-keying only its placement
   * stream, drawing v21's replayed variation, so every structural choice stays and the dots are
   * re-drawn. As the comparison (ADR 0018) sets one drawing (v21's) against the mean over K
   * engine draws, so does the calibration: each of `standIns` drawings (keys `STAND_IN_KEY + r`)
   * stands in for v21, against the K draws of keys 0..K − 1 (the comparison's own keys). Every
   * negative control (ADR 0015) that applies is drawn with the same K keys, against the first
   * stand-in. Each entry holds the K comparisons, in key order, so that the runner can take the
   * mean over any K' ≤ K of them (the first K').
   */
  calibrateEngine(
    cases: CalibrationCase[],
    keys: number,
    standIns: number,
    log: (s: string) => void,
    withControls = true,
  ) {
    const pairs: Record<string, { preset: string; config: string; cs: Comparison[] }[]> = {};
    const controls: Record<string, Record<string, { config: string; cs: Comparison[] }[]>> = {};
    const heldOut: Record<string, { preset: string; config: string; cs: Comparison[] }[]> = {};
    for (const c of cases) {
      const zoom = c.zoom ?? 1;
      const opts = this.referenceOptions(c.params, zoom);
      const draw = (P: Params, o: SceneOptions, k: number) =>
        measure(this.cpu.render(P, keyed(o, P.seed, k), zoom).alpha);
      const stand = Array.from({ length: standIns }, (_, r) =>
        draw(c.params, opts, STAND_IN_KEY + r),
      );
      const drawn = Array.from({ length: keys }, (_, k) => draw(c.params, opts, k));
      const config = configLabel(c);
      // a held-out v21 capture (ADR 0018): v21 against the same K draws, for the renderers' own
      // differences, which re-draws of line-work drawn the same at every key cannot show
      if (c.heldOut) {
        const v21 = measure(this.reference(c.heldOut));
        (heldOut[c.family] ??= []).push({
          preset: c.base,
          config,
          cs: drawn.map((m) => compareMeasures(v21, m)),
        });
      }
      for (const ref of stand)
        // tagged with the preset, for the per-preset axis-ratio tolerances
        (pairs[c.family] ??= []).push({
          preset: c.base,
          config,
          cs: drawn.map((m) => compareMeasures(ref, m)),
        });
      const ref = stand[0];
      if (!ref || !withControls) {
        log(`  ${config}`);
        continue;
      }
      const refQ = momentsOf(ref.alpha, ref.extent.r90).q;
      for (const ctl of NEGATIVE_CONTROLS) {
        if (!ctl.applies(c.params, refQ)) continue;
        const P = ctl.params ? ctl.params(c.params) : c.params;
        const o = { ...this.referenceOptions(P, zoom), ...(ctl.scene ?? {}) };
        const cs: Comparison[] = [];
        for (let k = 0; k < keys; k++) cs.push(compareMeasures(ref, draw(P, o, k)));
        ((controls[c.family] ??= {})[ctl.name] ??= []).push({ config, cs });
      }
      log(`  ${config}`);
    }
    return { pairs, controls, heldOut };
  }

  /**
   * The comparison's re-draws (ADR 0018): the CPU engine drawing a required case with keys
   * 1..K − 1, each compared with v21's capture; key 0, the canonical draw, is each engine's own.
   */
  redraws(name: string, keys: number): { c: Comparison; counts: Record<string, number> }[] {
    const rec = this.record(name);
    const opts = this.referenceOptions(rec.params, rec.zoom ?? 1);
    const ref = measure(this.reference(name));
    const out: { c: Comparison; counts: Record<string, number> }[] = [];
    for (let k = 1; k < keys; k++) {
      const r = this.cpu.render(rec.params, keyed(opts, rec.params.seed, k), rec.zoom ?? 1);
      out.push({ c: compareMeasures(ref, measure(r.alpha)), counts: engineCounts(r.counts) });
    }
    return out;
  }

  /** Calibration, source (i): v21's own re-roll pairs (capture tool --reroll). */
  calibrateReroll(dir: string, log: (s: string) => void) {
    const pairs: Record<string, (Comparison & { preset: string })[]> = {};
    if (!existsSync(dir)) return { pairs, used: 0 };
    let used = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('__home.json'))) {
      const base = f.replace('__home.json', '');
      const a = JSON.parse(readFileSync(join(dir, `${base}__home.json`), 'utf8')) as CaptureRecord;
      const b = JSON.parse(
        readFileSync(join(dir, `${base}__reroll.json`), 'utf8'),
      ) as CaptureRecord;
      const changed =
        a.stats.dots !== b.stats.dots ||
        a.stats.knots !== b.stats.knots ||
        a.stats.rstars !== b.stats.rstars;
      if (!changed) continue;
      used++;
      const c = compareMeasures(
        measure(readPngAlpha(join(dir, `${base}__home.ink.png`))),
        measure(readPngAlpha(join(dir, `${base}__reroll.ink.png`))),
      );
      (pairs[goldenFamily(a.preset)] ??= []).push({ ...c, preset: a.preset });
      log(`  v21 re-roll ${base}: ssim ${c.ssim.toFixed(3)}`);
    }
    return { pairs, used };
  }
}

/**
 * The placement key of draw k of a configuration (ADR 0018): k = 0 is the engine's own key (the
 * canonical draw, which L0, the engine hashes and test (e) use); other keys re-key the placement
 * stream only, as the calibration's re-draws always have.
 */
export function rekey(seed: number, k: number): number | undefined {
  return k === 0 ? undefined : (seed + k * 7_919_000) >>> 0;
}

/** Scene options drawing with key k (`rekey`). */
export function keyed(o: SceneOptions, seed: number, k: number): SceneOptions {
  const key = rekey(seed, k);
  return key === undefined ? o : { ...o, placementKey: key };
}

/** The calibration's stand-ins for v21 use keys from here on, apart from any comparison's K. */
export const STAND_IN_KEY = 1000;

/** The mean of an angle of period 180° (twice the angle, averaged on the circle), in [lo, lo + 180). */
function meanAxis(degrees: number[], lo: number): number {
  let s = 0;
  let c = 0;
  for (const d of degrees) {
    s += Math.sin((d * Math.PI) / 90);
    c += Math.cos((d * Math.PI) / 90);
  }
  const m = (Math.atan2(s, c) * 90) / Math.PI;
  return ((((m - lo) % 180) + 180) % 180) + lo;
}

/**
 * The mean of each measure over K comparisons with the same reference (ADR 0018): arithmetic
 * means, and axial means for the position angles.
 */
export function meanComparison(cs: Comparison[]): Comparison {
  const first = cs[0];
  if (!first) throw new Error('meanComparison: no comparisons');
  if (cs.length === 1) return first;
  const mean = (f: (c: Comparison) => number) => cs.reduce((a, c) => a + f(c), 0) / cs.length;
  return {
    inkRel: mean((c) => c.inkRel),
    ssim: mean((c) => c.ssim),
    ssimCoarse: mean((c) => c.ssimCoarse),
    medianRel: mean((c) => c.medianRel),
    p90Rel: mean((c) => c.p90Rel),
    r25Rel: mean((c) => c.r25Rel),
    r50Rel: mean((c) => c.r50Rel),
    r90Rel: mean((c) => c.r90Rel),
    outerDiff: mean((c) => c.outerDiff),
    qDiff: mean((c) => c.qDiff),
    qInnerDiff: mean((c) => c.qInnerDiff),
    paDiff: meanAxis(
      cs.map((c) => c.paDiff),
      -90,
    ),
    ref: first.ref,
    render: {
      ink: mean((c) => c.render.ink),
      median: mean((c) => c.render.median),
      p90: mean((c) => c.render.p90),
      r50: mean((c) => c.render.r50),
      r90: mean((c) => c.render.r90),
      q: mean((c) => c.render.q),
      pa: meanAxis(
        cs.map((c) => c.render.pa),
        0,
      ),
    },
  };
}

/** The mean count of each class over K draws (ADR 0018). */
export function meanCounts(list: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list) for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  for (const k of Object.keys(out)) out[k] = (out[k] ?? 0) / list.length;
  return out;
}

/** One configuration of the calibration. */
export interface CalibrationCase {
  preset: string;
  base: string;
  family: string;
  params: Params;
  zoom?: number;
  /** a v21 capture of this configuration held out for the calibration (ADR 0018) */
  heldOut?: string;
}

/** A configuration's label in calibration.json, unique within a calibration. */
export function configLabel(c: CalibrationCase): string {
  const zoom = c.zoom ?? 1;
  return `${c.preset} s${String(c.params.seed)} incl ${String(c.params.incl)}${zoom === 1 ? '' : ` zoom ${String(zoom)}`}`;
}

/** Summary statistics of a list. */
export function summary(xs: number[]) {
  const s = Float64Array.from(xs).sort();
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    n: s.length,
    min: r(s[0] ?? 0),
    p5: r(quantile(s, 0.05)),
    median: r(quantile(s, 0.5)),
    p95: r(quantile(s, 0.95)),
    max: r(s[s.length - 1] ?? 0),
  };
}

export function presetCase(preset: string, seed: number, extra: Partial<Params> = {}): Params {
  return presetParams(preset, seed, extra);
}

/**
 * The negative controls of ADR 0015: the same galaxy with one structural or pen change, which the
 * metric must fail. Each applies only where it changes the drawing (a disc's thickness needs a
 * disc; a position angle needs a galaxy that is not round on the sky).
 */
export const NEGATIVE_CONTROLS: {
  name: string;
  /** whether it changes this drawing; `q` is the drawing's axis ratio within its r90 */
  applies: (P: Params, q: number) => boolean;
  params?: (P: Params) => Params;
  scene?: SceneOptions;
}[] = (() => {
  const sersic = (P: Params) => P.sersicN > 0 && P.bulge >= 0.95;
  // a turn of the sky or an orbit changes only a drawing that is not round (axis ratio < 0.8)
  const notRound = (_: Params, q: number) => q < 0.8;
  return [
    { name: 'pa +30°', applies: notRound, params: (P) => ({ ...P, pa: P.pa + 30 }) },
    { name: 'pa −30°', applies: notRound, params: (P) => ({ ...P, pa: P.pa - 30 }) },
    {
      name: 'pa +90°',
      applies: () => true,
      params: (P) => ({ ...P, pa: P.pa + 90 }),
    },
    {
      name: 'bulgeFlat +0.1',
      applies: (P) => P.bulge >= 0.95 && P.bulgeFlat <= 0.9,
      params: (P) => ({ ...P, bulgeFlat: P.bulgeFlat + 0.1 }),
    },
    {
      name: 'bulgeFlat +0.15',
      applies: (P) => P.bulge >= 0.3 && P.bulgeFlat + 0.15 <= 1,
      params: (P) => ({ ...P, bulgeFlat: P.bulgeFlat + 0.15 }),
    },
    {
      name: 'bulgeFlat −0.15',
      applies: (P) => P.bulge >= 0.3 && P.bulgeFlat - 0.15 >= 0.3,
      params: (P) => ({ ...P, bulgeFlat: P.bulgeFlat - 0.15 }),
    },
    {
      name: 'bulgeSize ×1.5',
      applies: (P) => P.bulge >= 0.3 && !sersic(P),
      params: (P) => ({ ...P, bulgeSize: P.bulgeSize * 1.5 }),
    },
    { name: 'halo off', applies: (P) => P.halo > 0, params: (P) => ({ ...P, halo: 0 }) },
    { name: 'RMAX 4.2', applies: () => true, scene: { rmax: 4.2 } },
    {
      name: 'thick ×3',
      applies: (P) => P.bulge < 0.95 && Math.abs(Math.cos((P.incl * Math.PI) / 180)) < 0.9,
      params: (P) => ({ ...P, thick: P.thick * 3 }),
    },
    { name: 'dot size ×1.3', applies: () => true, scene: { dotScale: 1.3 } },
    {
      name: 'orbit 35°',
      applies: notRound,
      params: (P) => ({ ...P, az: (P.az || 0) + 35, incl: Math.min(180, P.incl + 20) }),
    },
  ];
})();
