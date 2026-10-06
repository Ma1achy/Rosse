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
import { v21CurvePicks } from './v21-curves';
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

/** The golden family of a preset (thresholds.json `parity` keys). */
export function goldenFamily(preset: string): string {
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
   * Everything the comparison draws with besides the parameters: v21's variation (ADR 0015), from
   * M4 v21's stroke choices and noise field, and from M5 v21's part picks at this zoom (ADR 0021).
   */
  referenceOptions(P: Params, zoom = 1): SceneOptions {
    const variation = this.v21Variation(P);
    return {
      variation,
      curvePicks: this.v21CurvePicks(P, variation),
      noise: this.v21Noise(P.seed),
      partPicks: v21PartPicks(P, variation, this.cpu.meta, zoom),
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

  /** v21's own variation for these parameters, replayed offline (./v21.ts). */
  v21Variation(P: Params): Variation {
    return v21Variation(P, this.cpu.meta);
  }

  /**
   * The thresholds of a preset's family; at a zoomed camera, the family's zoom thresholds when
   * calibrated (`<family>@zoom`): at zoom 2 the plate holds the inner galaxy only, and a re-draw
   * of the same galaxy scatters more (docs/milestones/m4/README.md).
   */
  parity(preset: string, zoom = 1): Thresholds {
    const f = goldenFamily(preset);
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
   * Calibration (ADR 0013, 0015), source (ii): the new engine re-keying only its placement stream,
   * drawing v21's replayed variation, so every structural choice stays and the dots are re-drawn.
   * Pairs (key 0, key k) for k = 1..K per configuration. Also every negative control (ADR 0015)
   * that applies to the configuration, re-keyed, against key 0.
   */
  calibrateEngine(
    cases: { preset: string; base: string; family: string; params: Params; zoom?: number }[],
    keys: number,
    log: (s: string) => void,
  ) {
    const pairs: Record<string, (Comparison & { preset: string })[]> = {};
    const controls: Record<string, Record<string, { config: string; c: Comparison }[]>> = {};
    for (const c of cases) {
      const zoom = c.zoom ?? 1;
      const opts = this.referenceOptions(c.params, zoom);
      const base = measure(this.cpu.render(c.params, opts, zoom).alpha);
      const baseQ = momentsOf(base.alpha, base.extent.r90).q;
      for (let k = 1; k <= keys; k++) {
        const r = this.cpu.render(
          c.params,
          { ...opts, placementKey: (c.params.seed + k * 7_919_000) >>> 0 },
          zoom,
        );
        // tagged with the preset, for the per-preset axis-ratio tolerances
        (pairs[c.family] ??= []).push({
          ...compareMeasures(base, measure(r.alpha)),
          preset: c.base,
        });
      }
      const config = `${c.preset} s${String(c.params.seed)} incl ${String(c.params.incl)}${zoom === 1 ? '' : ` zoom ${String(zoom)}`}`;
      for (const ctl of NEGATIVE_CONTROLS) {
        if (!ctl.applies(c.params, baseQ)) continue;
        const P = ctl.params ? ctl.params(c.params) : c.params;
        const r = this.cpu.render(
          P,
          {
            ...this.referenceOptions(P, zoom),
            placementKey: (c.params.seed + 1) >>> 0,
            ...(ctl.scene ?? {}),
          },
          zoom,
        );
        ((controls[c.family] ??= {})[ctl.name] ??= []).push({
          config,
          c: compareMeasures(base, measure(r.alpha)),
        });
      }
      log(`  ${config}`);
    }
    return { pairs, controls };
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
