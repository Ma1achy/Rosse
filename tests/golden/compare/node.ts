/**
 * The Node half of the golden runner, loaded by ./compare.mjs through Vite's SSR loader (so it can
 * import the engine's TypeScript): reading reference captures, the CPU engine, the metric, the
 * thresholds, reports, and the calibration of ADR 0013.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { Params } from '../../../src/core/params';
import { presetFamily, presetParams } from '../../../src/core/presets';
import type { MarkCounts } from '../../../src/model/scene';
import { CpuGolden } from './engine-cpu';
import {
  alphaFromRgba8,
  compareMeasures,
  gray,
  measure,
  quantile,
  type Comparison,
  type Gray,
  type ImageMeasures,
} from './metrics';
import { reportHtml } from './report';
import { evaluate, type Evaluation, type ThresholdFile, type Thresholds } from './thresholds';

export { compareMeasures, evaluate, measure };
export type { Comparison, Evaluation, Gray, ImageMeasures, Thresholds };

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

export function readPngAlpha(file: string): Gray {
  const p = PNG.sync.read(readFileSync(file));
  return alphaFromRgba8(p.width, p.height, p.data);
}

export function alphaFromBase64(b64: string, width: number, height: number): Gray {
  const bytes = Buffer.from(b64, 'base64');
  const g = gray(width, height);
  for (let i = 0; i < width * height; i++) g.data[i] = (bytes[i] ?? 0) / 255;
  return g;
}

export function alphaHash(a: Gray): string {
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

  reference(name: string): Gray {
    return readPngAlpha(join(this.root, 'tests/golden/reference', `${name}.ink.png`));
  }

  renderCpu(P: Params, opts: { hand?: number[]; placementKey?: number } = {}, zoom = 1) {
    return this.cpu.render(P, opts, zoom);
  }

  parity(preset: string): Thresholds {
    const t = this.thresholds.parity[goldenFamily(preset)];
    if (!t) throw new Error(`no parity thresholds for ${preset}`);
    return t;
  }

  writeReport(
    name: string,
    ref: { label: string; alpha: Gray; measures: ImageMeasures },
    render: { label: string; alpha: Gray; measures: ImageMeasures },
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
   * Calibration (ADR 0013), source (ii): the new engine re-keying only its placement stream, so
   * every structural choice stays and the dots are re-drawn. Pairs (key 0, key k) for k = 1..K,
   * per preset, seed and camera. Also, for comparison, "other structure" pairs: the orbit camera
   * (az + 35°, incl + 20°) against home, re-keyed.
   */
  calibrateEngine(
    cases: { preset: string; family: string; params: Params; hand?: number[] }[],
    keys: number,
    log: (s: string) => void,
  ) {
    const pairs: Record<string, Comparison[]> = {};
    const structure: Record<string, Comparison[]> = {};
    for (const c of cases) {
      const base = this.cpu.render(c.params, { ...(c.hand ? { hand: c.hand } : {}) });
      const m0 = measure(base.alpha);
      for (let k = 1; k <= keys; k++) {
        const r = this.cpu.render(c.params, {
          ...(c.hand ? { hand: c.hand } : {}),
          placementKey: (c.params.seed + k * 7_919_000) >>> 0,
        });
        (pairs[c.family] ??= []).push(compareMeasures(m0, measure(r.alpha)));
      }
      const o = {
        ...c.params,
        az: (c.params.az || 0) + 35,
        incl: Math.min(180, c.params.incl + 20),
      };
      const ro = this.cpu.render(o, {
        ...(c.hand ? { hand: c.hand } : {}),
        placementKey: (c.params.seed + 1) >>> 0,
      });
      (structure[c.family] ??= []).push(compareMeasures(m0, measure(ro.alpha)));
      log(`  ${c.preset} s${String(c.params.seed)} incl ${String(c.params.incl)}`);
    }
    return { pairs, structure };
  }

  /** Calibration, source (i): v21's own re-roll pairs (capture tool --reroll). */
  calibrateReroll(dir: string, log: (s: string) => void) {
    const pairs: Record<string, Comparison[]> = {};
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
      (pairs[goldenFamily(a.preset)] ??= []).push(c);
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
