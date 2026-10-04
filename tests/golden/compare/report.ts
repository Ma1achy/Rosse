/**
 * The side-by-side report of one golden case (ADR 0013): the reference and the render, both
 * density maps, the signed density difference as a heat map, the stroke-width histograms and the
 * numbers. Written to tests/golden/diff/<name>.html (not committed; CI uploads it).
 */
import { PNG } from 'pngjs';
import type { Comparison, Gray, ImageMeasures } from './metrics';
import type { Evaluation } from './thresholds';

function png(width: number, height: number, rgba: (i: number) => [number, number, number]): string {
  const p = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = rgba(i);
    p.data[i * 4] = r;
    p.data[i * 4 + 1] = g;
    p.data[i * 4 + 2] = b;
    p.data[i * 4 + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(p).toString('base64')}`;
}

/** Ink on paper: α as dark on white. */
function inkImage(a: Gray): string {
  return png(a.width, a.height, (i) => {
    const v = Math.round(255 * (1 - (a.data[i] ?? 0)));
    return [v, v, v];
  });
}

function densityImage(d: Gray, max: number): string {
  return png(d.width, d.height, (i) => {
    const v = Math.round(255 * (1 - Math.min(1, (d.data[i] ?? 0) / max)));
    return [v, v, v];
  });
}

/** Render − reference: red where the render has more ink, blue where it has less. */
function diffImage(ref: Gray, render: Gray, max: number): string {
  return png(ref.width, ref.height, (i) => {
    const t = Math.max(-1, Math.min(1, ((render.data[i] ?? 0) - (ref.data[i] ?? 0)) / max));
    const k = Math.round(255 * (1 - Math.abs(t)));
    return t >= 0 ? [255, k, k] : [k, k, 255];
  });
}

function histogram(ref: Float32Array, render: Float32Array): string {
  const bins = 24;
  const top = 8;
  const count = (w: Float32Array) => {
    const h = new Array<number>(bins).fill(0);
    for (const x of w) {
      const i = Math.min(bins - 1, Math.floor((x / top) * bins));
      h[i] = (h[i] ?? 0) + 1 / w.length;
    }
    return h;
  };
  const a = count(ref);
  const b = count(render);
  const peak = Math.max(...a, ...b, 1e-9);
  const W = 480;
  const H = 160;
  const bw = W / bins / 2;
  const bars = a
    .map((v, i) => {
      const hb = b[i] ?? 0;
      return (
        `<rect x="${(i * 2 * bw).toFixed(1)}" y="${(H - (v / peak) * H).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${((v / peak) * H).toFixed(1)}" fill="#555"/>` +
        `<rect x="${(i * 2 * bw + bw).toFixed(1)}" y="${(H - (hb / peak) * H).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${((hb / peak) * H).toFixed(1)}" fill="#c33"/>`
      );
    })
    .join('');
  const ticks = [0, 2, 4, 6, 8]
    .map(
      (t) =>
        `<text x="${((t / top) * W).toFixed(0)}" y="${String(H + 14)}" font-size="11">${String(t)} px</text>`,
    )
    .join('');
  return `<svg width="${String(W + 30)}" height="${String(H + 20)}" role="img" aria-label="stroke-width histograms">${bars}${ticks}</svg>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export interface ReportSide {
  label: string;
  alpha: Gray;
  measures: ImageMeasures;
}

export function reportHtml(
  name: string,
  ref: ReportSide,
  render: ReportSide,
  c: Comparison,
  e: Evaluation,
  extra: string[] = [],
): string {
  let max = 1e-6;
  for (const v of ref.measures.density.data) max = Math.max(max, v);
  for (const v of render.measures.density.data) max = Math.max(max, v);
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  const rows = [
    ['total ink Σα', ref.measures.ink.toFixed(1), render.measures.ink.toFixed(1), pct(c.inkRel)],
    ['density SSIM', '', '', c.ssim.toFixed(4)],
    ['coarse density SSIM', '', '', c.ssimCoarse.toFixed(4)],
    ['median stroke width', c.ref.median.toFixed(3), c.render.median.toFixed(3), pct(c.medianRel)],
    ['p90 stroke width', c.ref.p90.toFixed(3), c.render.p90.toFixed(3), pct(c.p90Rel)],
    ...Object.entries(e.counts).map(([k, v]) => [k, String(v.ref), String(v.render), pct(v.rel)]),
  ]
    .map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`)
    .join('');
  const fig = (src: string, cap: string) =>
    `<figure><img src="${src}" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#222}
figure{display:inline-block;margin:0 12px 12px 0}img{width:400px;image-rendering:pixelated;border:1px solid #ccc}
td{padding:2px 10px;border-bottom:1px solid #eee}.fail{color:#b00}.pass{color:#070}</style></head><body>
<h1>${esc(name)}</h1>
<p class="${e.pass ? 'pass' : 'fail'}">${e.pass ? 'PASS' : `FAIL: ${esc(e.failures.join('; '))}`}</p>
${extra.map((x) => `<p>${esc(x)}</p>`).join('')}
<table><tr><th></th><th>${esc(ref.label)}</th><th>${esc(render.label)}</th><th>difference</th></tr>${rows}</table>
<div>${fig(inkImage(ref.alpha), ref.label)}${fig(inkImage(render.alpha), render.label)}</div>
<div>${fig(densityImage(ref.measures.density, max), `${ref.label}: density`)}${fig(densityImage(render.measures.density, max), `${render.label}: density`)}${fig(diffImage(ref.measures.density, render.measures.density, max / 2), 'density difference (red: more ink in the render)')}</div>
<h2>Stroke widths (grey: ${esc(ref.label)}, red: ${esc(render.label)})</h2>
${histogram(ref.measures.strokes.widths, render.measures.strokes.widths)}
</body></html>
`;
}
