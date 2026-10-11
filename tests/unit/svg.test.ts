import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CpuStipple } from '../../src/fallback/stipple';
import { exportSvgCpu } from '../../src/extras/export/engine';
import { exportLayersOf } from '../../src/extras/export/read-layers';
import {
  SVG_LAYERS,
  buildSvg,
  chain,
  type ExportLayer,
  type SvgLayerName,
  type SvgResult,
} from '../../src/extras/export/svg';
import { presetParams } from '../../src/core/presets';
import { buildScene } from '../../src/model/scene';
import { cameraOf, incE } from '../../src/view/camera';
import { GoldenNode } from '../golden/compare/node';
import { countAllowance, type ThresholdFile } from '../golden/compare/thresholds';

const ROOT = join(import.meta.dirname, '../..');
interface V21Svg {
  cases: {
    preset: string;
    seed: number;
    overrides: Record<string, number>;
    counts: Record<SvgLayerName, number>;
    layers: SvgLayerName[];
  }[];
}
const v21 = JSON.parse(readFileSync(join(ROOT, 'tests/vectors/svg-v21.json'), 'utf8')) as V21Svg;
const thresholds = JSON.parse(
  readFileSync(join(ROOT, 'tests/golden/thresholds.json'), 'utf8'),
) as ThresholdFile;

/**
 * A well-formedness check for the SVG this module writes: tags balance, attributes are quoted,
 * and no number is NaN or infinite. (Chromium's own parser checks it too: tests/gpu/svg.ts.)
 */
export function checkSvg(svg: string): { ok: boolean; problems: string[]; layers: string[] } {
  const problems: string[] = [];
  if (!svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')) problems.push('no header');
  if (/NaN|Infinity|undefined|null/.test(svg)) problems.push('a bad number or value');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;
  const stripped = svg.replace(/<\?xml[^>]*\?>/, '').replace(/<title>[^<]*<\/title>/, '');
  let last = 0;
  for (const m of stripped.matchAll(tag)) {
    if (stripped.slice(last, m.index).trim()) problems.push('text outside a tag');
    last = m.index + m[0].length;
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) problems.push(`unbalanced </${String(m[2])}>`);
    } else stack.push(m[2] as string);
  }
  if (stripped.slice(last).trim()) problems.push('unparsed text');
  if (stack.length) problems.push(`unclosed <${stack.join('> <')}>`);
  const layers = [...svg.matchAll(/<g id="(\w+)" inkscape:groupmode="layer"/g)].map(
    (m) => m[1] as string,
  );
  return { ok: !problems.length, problems, layers };
}

describe('the SVG builder', () => {
  it('chains segments whose ends meet into one path, and breaks where they do not', () => {
    const segs: [number, number, number, number, number][] = [
      [0, 0, 1, 0, 2],
      [1, 0, 2, 1, 4],
      [10, 10, 11, 10, 1],
    ];
    const paths = chain(3, (i) => segs[i] as [number, number, number, number, number]);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.pts).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
    ]);
    expect(paths[0]?.w).toBe(3);
  });

  it('writes dots as circles, stars as rays, cores as nested rings, lines as paths', () => {
    const layers: ExportLayer[] = [
      {
        kind: 'sprites',
        atlas: 'dots',
        gain: 1,
        instances: [{ x: 10, y: 20, layer: 0, alpha: 1, m: [8, 0, 0, 8] }],
      },
      {
        kind: 'sprites',
        atlas: 'stars',
        gain: 1,
        instances: [{ x: 30, y: 40, layer: 0, alpha: 1, m: [10, 0, 0, 10] }],
      },
      {
        kind: 'sprites',
        atlas: 'cores',
        gain: 1,
        instances: [{ x: 400, y: 400, layer: 0, alpha: 1, m: [20, 0, 0, 10] }],
      },
      {
        kind: 'capsules',
        gain: 1,
        count: 3,
        hatch: 1,
        caps: new Float32Array([
          0, 0, 5, 5, 0.5, 1, 0, 0, 0, 0, 5, 5, 9, 9, 0.5, 1, 0, 0, 9, 9, 12, 12, 20, 20, 0.5, 1, 0,
          0,
        ]),
      },
    ];
    const r = buildSvg(layers, { seed: 7, dotSize: [16] });
    expect(r.counts).toEqual({
      background: 0,
      drawings: 2,
      arms: 0,
      dust: 1,
      cores: 1,
      knots: 0,
      dots: 1,
      stars: 1,
    });
    expect(r.svg).toContain('<circle cx="10" cy="20" r="1.6"');
    expect(r.svg).toContain('<ellipse rx="6.3" ry="3.15"');
    expect(checkSvg(r.svg).problems).toEqual([]);
    expect(checkSvg(r.svg).layers).toEqual(['drawings', 'dust', 'cores', 'dots', 'stars']);
  });

  it('leaves out what is off the plate, and unfinite points', () => {
    const r = buildSvg(
      [
        {
          kind: 'sprites',
          atlas: 'dots',
          gain: 1,
          instances: [{ x: 900, y: 20, layer: 0, alpha: 1, m: [8, 0, 0, 8] }],
        },
      ],
      { seed: 1, dotSize: [8] },
    );
    expect(r.counts.dots).toBe(0);
    expect(r.svg).not.toContain('id="dots"');
  });
});

describe('an export source with asynchronous layers (the CPU engine in a worker, M10)', () => {
  it('awaits the layers, on the CPU path, and builds the same SVG as the direct path', async () => {
    const node = new GoldenNode(ROOT);
    const P = presetParams('Dusty spiral', 7, { starMix: 0, field: 0, fgstars: 0 });
    const stipple = new CpuStipple(buildScene(P, node.cpu.meta));
    const view = stipple.view(cameraOf(P, 1));
    const direct = exportSvgCpu(stipple, view);
    const source = {
      device: () => null,
      layers: () =>
        new Promise<typeof view.layers>((ok) =>
          setTimeout(() => {
            ok(view.layers);
          }, 10),
        ),
    };
    const layers = await exportLayersOf(source, stipple.scene.ribbons.nCaps);
    const viaSource = buildSvg(layers, { seed: P.seed, dotSize: node.cpu.meta.dots.size });
    expect(viaSource.counts.dust).toBe(direct.counts.dust);
    expect(viaSource.counts.dots).toBe(direct.counts.dots);
    expect(viaSource.counts.arms).toBe(direct.counts.arms);
    // a synchronous source works too
    expect((await exportLayersOf({ device: () => null, layers: () => view.layers })).length).toBe(
      layers.length,
    );
  });
});

describe('the SVG of the CPU engine against v21 (five presets)', () => {
  const node = new GoldenNode(ROOT);
  const base = thresholds.parity.spiral;
  if (!base) throw new Error('no spiral thresholds');

  for (const c of v21.cases) {
    it(`${c.preset}: v21's layers, and per layer v21's count within the count rule`, () => {
      const P = presetParams(c.preset, c.seed, c.overrides);
      // v21's own variation, stroke choices and picks, as the golden comparison draws (ADR 0015, 0018, 0021)
      const opts = node.referenceOptions(P);
      const stipple = new CpuStipple(buildScene(P, node.cpu.meta, opts));
      const view = stipple.view(cameraOf(P, 1));
      const r: SvgResult = exportSvgCpu(stipple, view);
      const check = checkSvg(r.svg);
      expect(check.problems).toEqual([]);
      expect(check.layers).toEqual(SVG_LAYERS.filter((k) => r.counts[k] > 0));
      // v21 drops the drawn core from incE 80; the port keeps it, edge-on (ADR 0079)
      const edgeOn = incE(P.incl) >= 80 && r.counts.cores > 0;
      expect(check.layers).toEqual(
        edgeOn ? SVG_LAYERS.filter((k) => k === 'cores' || c.layers.includes(k)) : c.layers,
      );
      const rows: string[] = [];
      for (const k of SVG_LAYERS) {
        const ref = c.counts[k];
        const got = r.counts[k];
        if (k === 'cores' && edgeOn) continue;
        const allow = countAllowance(ref, got, base, ref === 0);
        rows.push(`${k} ${String(got)}/${String(ref)}`);
        expect(
          Math.abs(got - ref),
          `${c.preset} ${k}: ${String(got)} against v21's ${String(ref)}`,
        ).toBeLessThanOrEqual(allow);
      }
      console.log(`${c.preset}: ${rows.join(', ')}`);
    }, 120_000);
  }
});
